import { Component, computed, inject, signal } from '@angular/core';
import { EnvironmentInfo, MultiResultInfo, ParamsMultiResponse } from '../api-gen/models';
import { EnvironmentService } from '../core/services/environment.service';
import { ParamsService } from '../core/services/params.service';
import { toApiError } from '../core/services/api-error';
import { StatusBadge } from '../shared/status-badge';
import { CopyButton } from '../shared/copy-button';

@Component({
  selector: 'app-params-create-page',
  imports: [StatusBadge, CopyButton],
  template: `
    <h1>Crear en varias regiones</h1>

    <div class="form-grid">
      <div>
        <label for="name">Nombre del parámetro</label>
        <input
          id="name"
          type="text"
          [value]="name()"
          (input)="name.set($any($event.target).value)"
          placeholder="p. ej. /yappy/dev/rate"
          spellcheck="false"
        />
      </div>
      <div>
        <label for="value-type">Tipo</label>
        <select
          id="value-type"
          [disabled]="withSecret()"
          [value]="valueType()"
          (change)="valueType.set($any($event.target).value)"
        >
          <option value="String">String</option>
          <option value="StringList">StringList</option>
          <option value="SecureString">SecureString</option>
        </select>
      </div>
    </div>
    <div class="checkbox-row">
      <label class="chk">
        <input
          type="checkbox"
          [checked]="createSecret()"
          (change)="createSecret.set($any($event.target).checked)"
        />
        Crear también el secreto en Secrets Manager (parámetro SecureString)
      </label>
    </div>
    <label for="value">Valor</label>
    <textarea
      id="value"
      spellcheck="false"
      [value]="value()"
      (input)="value.set($any($event.target).value)"
      placeholder="El valor a guardar"
    ></textarea>

    <label>Regiones destino</label>
    <div class="env-checks">
      @for (e of environments() ?? []; track e.env) {
        <label class="env-check">
          <input
            type="checkbox"
            [checked]="envsSelected()[e.env]"
            (change)="toggleEnv(e.env, $any($event.target).checked)"
          />
          <span>
            <strong>{{ e.env }}</strong>
            — {{ e.region || '' }}
            <span class="muted">({{ e.profile || '' }})</span>
          </span>
        </label>
      }
    </div>
    @if (envLoadError()) {
      <span class="muted">No se pudieron cargar los ambientes: {{ envLoadError() }}</span>
    }

    <div class="actions" style="margin-top:16px;">
      <button type="button" class="secondary" [disabled]="busy()" (click)="run(true)">
        Generar comandos
      </button>
      <button type="button" [disabled]="busy()" (click)="run(false)">Ejecutar</button>
    </div>

    @if (error()) {
      <div class="error-box">{{ error() }}</div>
    }

    @if (busy()) {
      <div class="panel"><span class="spinner"></span>{{ dryRun() ? 'Generando comandos…' : 'Ejecutando…' }}</div>
    }

    @if (result()) {
      @if (result()!.err_count === 0) {
        <div class="ok-box">
          <strong>Listo.</strong> {{ result()!.ok_count }} región{{ result()!.ok_count === 1 ? '' : 'es' }}
          @if (dryRun()) {
            con comando generado
          }
          para {{ result()!.name }}{{ result()!.create_secret ? ' (secreto + parámetro SSM)' : '' }}.
        </div>
      } @else {
        <div class="error-box">
          <strong>{{ result()!.err_count }} región{{ result()!.err_count === 1 ? '' : 'es' }} con error</strong>
          de {{ result()!.results.length }} para {{ result()!.name }}.
        </div>
      }
      <div class="panel">
        <div class="section-title">
          <strong>{{ dryRun() ? 'Comandos por región' : 'Resultado de la ejecución' }}</strong>
        </div>
        <table>
          <thead>
            <tr><th>Región</th><th>Estado</th><th>{{ dryRun() ? 'Comando' : 'Detalle' }}</th></tr>
          </thead>
          <tbody>
            @for (r of result()!.results; track r.env) {
              <tr>
                <td><strong>{{ r.env }}</strong></td>
                <td>
                  @if (r.ok) {
                    <app-badge status="ok" label="OK" />
                  } @else {
                    <app-badge status="error" label="Error" />
                  }
                </td>
                <td>
                  @if (r.ok) {
                    @if (r.script) {
                      <div style="display:flex; flex-direction:column; gap:8px;">
                        <pre>{{ r.script }}</pre>
                        @if (dryRun()) {
                          <span><app-copy-button [text]="r.script" label="Copiar comando" /></span>
                        }
                      </div>
                    } @else {
                      <div class="note ok">{{ r.message ?? '' }}</div>
                    }
                  } @else {
                    <div class="note err">{{ r.error || 'Error desconocido' }}</div>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class ParamsCreatePage {
  private readonly envService = inject(EnvironmentService);
  private readonly paramsService = inject(ParamsService);

  readonly environments = signal<EnvironmentInfo[] | null>(null);
  readonly envLoadError = signal<string | null>(null);
  readonly name = signal('');
  readonly value = signal('');
  readonly valueType = signal<string>('String');
  readonly createSecret = signal(false);
  readonly envsSelected = signal<Record<string, boolean>>({});

  readonly busy = signal(false);
  readonly dryRun = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<ParamsMultiResponse | null>(null);

  readonly withSecret = computed(() => this.createSecret());

  constructor() {
    this.envService.list().then(
      (envs) => this.environments.set(envs.environments),
      (err) => this.envLoadError.set(toApiError(err).message),
    );
  }

  toggleEnv(env: string, checked: boolean) {
    this.envsSelected.update((sel) => ({ ...sel, [env]: checked }));
  }

  private bundle(dryRun: boolean) {
    return {
      name: this.name().trim(),
      value: this.value(),
      value_type: this.withSecret() ? 'SecureString' : this.valueType(),
      envs: Object.entries(this.envsSelected())
        .filter(([, on]) => on)
        .map(([env]) => env),
      create_secret: this.withSecret(),
      dry_run: dryRun,
      confirm: !dryRun,
    };
  }

  run(dryRun: boolean) {
    const p = this.bundle(dryRun);
    if (!p.name) {
      this.error.set('Ingresá el nombre del parámetro.');
      return;
    }
    if (!p.envs.length) {
      this.error.set('Marcá al menos una región destino.');
      return;
    }
    if (!dryRun) {
      const secret = this.withSecret();
      const ops = secret
        ? 'crear/actualizar el secreto en Secrets Manager Y el parámetro SSM (SecureString)'
        : 'ejecutar put-parameter';
      if (!confirm(`¿${ops} de ${p.name} en: ${p.envs.join(', ')}?\nCada región usa su profile/región configurados.`)) {
        return;
      }
    }

    this.busy.set(true);
    this.dryRun.set(dryRun);
    this.error.set(null);
    this.result.set(null);

    this.paramsService.multi(p).then(
      (d) => {
        this.busy.set(false);
        this.result.set(d);
      },
      (err) => {
        this.busy.set(false);
        this.error.set(toApiError(err).message);
      },
    );
  }
}