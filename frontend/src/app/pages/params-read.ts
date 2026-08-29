import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EnvironmentInfo, ParamsReadResponse, ReadEntryResultInfo } from '../api-gen/models';
import { EnvironmentService } from '../core/services/environment.service';
import { ParamsService } from '../core/services/params.service';
import { SessionService } from '../core/services/session.service';
import { toApiError } from '../core/services/api-error';
import { formatValue } from '../core/format';
import { RegionControlsComponent } from '../shared/region-controls';
import { StatusBadge } from '../shared/status-badge';

@Component({
  selector: 'app-params-read-page',
  imports: [RegionControlsComponent, StatusBadge, RouterLink],
  template: `
    <h1>Leer Parámetros / Secretos</h1>

    <app-region-controls
      [environments]="environments()"
      [(envB)]="envB"
      [(envA)]="envA"
      [(service)]="service"
    />
    <label for="entries">Lista de parámetros — una clave por línea o un JSON como {{ exampleJson }}</label>
    <textarea
      id="entries"
      spellcheck="false"
      [value]="entries()"
      (input)="entries.set($any($event.target).value)"
      placeholder="/prod/ecommerce/db/master_url"
    ></textarea>
    <button type="button" [disabled]="busy()" (click)="read()">Leer valores</button>

    @if (error()) {
      <div class="error-box">{{ error() }}</div>
    }

    @if (busy()) {
      <div class="panel"><span class="spinner"></span>Leyendo…</div>
    }

    @if (sessionCreated()) {
      <div class="ok-box">
        Sesión de trabajo <strong>{{ sessionCreated()!.title }}</strong> lista ·
        <a [routerLink]="['/sessions', sessionCreated()!.id]">Abrir en Sesiones →</a>
      </div>
    }

    @if (result()) {
      @if (result()!.ok_count === result()!.results.length) {
        <div class="ok-box">
          <strong>Listo.</strong> {{ result()!.results.length }} valor{{ result()!.results.length === 1 ? '' : 'es' }}
          leído{{ result()!.results.length === 1 ? '' : 's' }} en {{ result()!.env }}.
        </div>
      } @else {
        <div class="error-box">
          <strong>{{ result()!.err_count }} entrada{{ result()!.err_count === 1 ? '' : 's' }} con error</strong>
          de {{ result()!.results.length }} en {{ result()!.env }}.
        </div>
      }
      <div class="panel">
        <div class="section-title"><strong>Valores en {{ result()!.env }}</strong></div>
        <table>
          <thead>
            <tr><th>Nombre</th><th>Servicio</th><th>Estado</th><th>Valor</th><th></th></tr>
          </thead>
          <tbody>
            @for (r of result()!.results; track r.key) {
              <tr>
                <td><code>{{ r.key }}</code></td>
                <td>
                  @if (r.is_secret) {
                    <app-badge status="secret" label="Secreto" />
                  } @else {
                    <span class="muted">SSM</span>
                  }
                </td>
                <td>
                  @if (r.ok) {
                    <app-badge status="ok" label="OK" />
                  } @else {
                    <app-badge status="error" label="Error" />
                  }
                </td>
                <td><pre>{{ r.ok ? formatValue(r.value) : (r.error || '—') }}</pre></td>
                <td>
                  <a
                    class="diff-link"
                    [routerLink]="['/params-diff']"
                    [queryParams]="diffQuery(r)"
                    title="Comparar en Parámetros"
                  >Sincronizar →</a>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class ParamsReadPage {
  private readonly envService = inject(EnvironmentService);
  private readonly paramsService = inject(ParamsService);
  private readonly sessionService = inject(SessionService);

  readonly exampleJson = '[{"key": "/path", "is_secret": false}]';

  readonly environments = signal<EnvironmentInfo[] | null>(null);
  readonly envB = signal('');
  readonly envA = signal('');
  readonly service = signal<string>('ssm');
  readonly entries = signal('');

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<ParamsReadResponse | null>(null);
  readonly sessionCreated = signal<{ title: string; id: string } | null>(null);

  constructor() {
    this.envService.list().then(
      (envs) => this.environments.set(envs.environments),
      (err) => this.error.set('No se pudieron cargar los ambientes: ' + toApiError(err).message),
    );
  }

  collectEntries(): unknown[] {
    const raw = this.entries().trim();
    if (raw.startsWith('[')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        throw new Error(
          'El JSON no es válido: ' +
            (e as Error).message +
            ' — formato esperado: [{ "key": "/path", "is_secret": false }] o una clave por línea',
        );
      }
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error(
          'El JSON debe ser una lista, por ejemplo: [{ "key": "/yappy/dev/rate", "is_secret": false }]',
        );
      }
      return parsed;
    }
    const entries = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((key) => ({ key, is_secret: false }));
    if (entries.length === 0) {
      throw new Error(
        'Pegá una clave por línea, por ejemplo: /prod/ecommerce/db/master_url — o un JSON como [{ "key": "/path", "is_secret": false }]',
      );
    }
    return entries;
  }

  diffQuery(r: ReadEntryResultInfo): Record<string, string> {
    return {
      env_b: this.envB(),
      env_a: this.envA(),
      service: r.service || 'ssm',
      name: r.key,
      with_secret: r.is_secret ? '1' : '0',
    };
  }

  read() {
    const env = this.envB();
    if (!env) {
      this.error.set('Seleccioná la región de origen.');
      return;
    }

    let entries: unknown[];
    try {
      entries = this.collectEntries();
    } catch (e) {
      this.error.set((e as Error).message);
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    this.sessionCreated.set(null);

    this.paramsService.read(env, entries as never).then(
      (d) => {
        this.busy.set(false);
        this.result.set(d);
        this.ensureSession(entries);
      },
      (err) => {
        this.busy.set(false);
        this.error.set(toApiError(err).message);
      },
    );
  }

  private ensureSession(entries: unknown[]) {
    const envB = this.envB();
    const envA = this.envA();
    if (!envA || envA === envB) return;
    const keys = entries
      .map((e) => (typeof e === 'string' ? e : (e as { key?: string; name?: string }).key || (e as { name?: string }).name || ''))
      .filter((k) => k !== '');
    if (!keys.length) return;
    this.sessionService
      .create({
        env_a: envA,
        env_b: envB,
        service: this.service(),
        keys,
        reuse: true,
      })
      .then(
        (body) => this.sessionCreated.set({ title: body.title, id: body.id }),
        () => null,
      );
  }

  protected readonly formatValue = formatValue;
}