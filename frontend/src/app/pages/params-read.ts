import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
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
    <p class="muted">
      Elegí la <strong>región de origen</strong> (de donde se leen los valores), pegá las claves,
      <strong>una por línea</strong> (se detectan los secretos automáticamente), o como JSON con
      <code>is_secret: true|false</code>. Lo marcado como secreto se lee de <strong>Secrets
      Manager</strong>; el resto de <strong>SSM Parameter Store</strong> (con respaldo automático en
      Secrets Manager si no existe en SSM). Al leer, la consulta queda <strong>anotada como sesión</strong>
      de <em>origen → destino</em> con un link para seguir el progreso ítem por ítem.
    </p>

    <div class="panel">
      <app-region-controls
        [environments]="environments()"
        [(envB)]="envB"
        [(envA)]="envA"
        [(service)]="service"
      />
      @if (requireAlias()) {
        <label for="session-alias">Alias o nombre de la iniciativa</label>
        <input
          id="session-alias"
          type="text"
          [value]="sessionAlias()"
          (input)="sessionAlias.set($any($event.target).value)"
          placeholder="release/REP-325073"
        />
      }
      <label for="entries">Lista de parámetros</label>
      <textarea
        id="entries"
        spellcheck="false"
        [value]="entries()"
        (input)="entries.set($any($event.target).value)"
        placeholder="/prod/ecommerce/db/master_url&#10;/prod/payment/stripe/secret_key"
      ></textarea>
      <div class="actions" style="justify-content:flex-end; margin-top:0.625rem;">
        <button type="button" [disabled]="busy()" (click)="read()">Leer valores <span class="muted">(desde Origen)</span></button>
      </div>
    </div>

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

  private readonly router = inject(Router);

  readonly environments = signal<EnvironmentInfo[] | null>(null);
  readonly envB = signal('');
  readonly envA = signal('');
  readonly service = signal<string>('');
  readonly sessionAlias = signal('');
  readonly requireAlias = signal(false);
  readonly entries = signal('');

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<ParamsReadResponse | null>(null);
  readonly sessionCreated = signal<{ title: string; id: string } | null>(null);

  constructor() {
    const q = new URLSearchParams(location.search);
    const sessionAlias = q.get('alias') ?? q.get('session_alias') ?? '';
    const fromSession = q.get('from_session') === '1' || q.get('session_id') !== null || q.get('session') !== null;
    this.requireAlias.set(fromSession);
    if (sessionAlias) {
      this.sessionAlias.set(sessionAlias);
    }

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
    const alias = this.sessionAlias().trim();
    const payload = {
      env_a: envA,
      env_b: envB,
      service: this.service() || 'ssm',
      keys,
      alias,
      title: alias,
      reuse: true,
    };
    this.sessionService
      .create(payload)
      .then(
        (body) => {
          this.sessionCreated.set({ title: body.title, id: body.id });
          this.router.navigate(['/sessions', body.id]);
        },
        () => null,
      );
  }

  protected readonly formatValue = formatValue;
}