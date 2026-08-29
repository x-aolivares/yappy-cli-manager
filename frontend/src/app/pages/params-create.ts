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
    <h1>Crear / Actualizar en múltiples regiones</h1>
    <p class="muted">
      Un solo valor, varias regiones. Sin marcar la opción de secreto, es un
      parámetro de SSM (o lo actualizás si ya existe). Marcando
      <strong>"Crear también en Secrets Manager"</strong>, por cada región se crea/actualiza el
      secreto <em>y</em> además se escribe el parámetro SSM como <code>SecureString</code>.
      "Ver comandos" genera los comandos por región (sin tocar nada); "Crear en las regiones" los
      ejecuta <strong>con tus credenciales y solo tras tu confirmación</strong>.
    </p>

    <div class="panel">
      <label for="name">Nombre del parámetro / secreto</label>
      <input
        id="name"
        type="text"
        [value]="name()"
        (input)="name.set($any($event.target).value)"
        placeholder="/yappy/dev/config"
        spellcheck="false"
        style="max-width: 420px;"
      />

      <label for="value" style="margin-top:16px;">Valor</label>
      <textarea
        id="value"
        class="change-input"
        rows="4"
        spellcheck="false"
        [value]="value()"
        (input)="value.set($any($event.target).value)"
        placeholder='{"rate": 20}'
      ></textarea>

      <label class="chk" style="margin-top:16px;">
        <input
          type="checkbox"
          [checked]="createSecret()"
          (change)="createSecret.set($any($event.target).checked)"
        />
        Crear también el secreto en Secrets Manager
      </label>

      <div style="margin-top:16px;">
        <label for="value-type">Tipo del parámetro SSM</label>
        <select
          id="value-type"
          style="max-width: 260px;"
          [disabled]="withSecret()"
          [value]="valueType()"
          (change)="valueType.set($any($event.target).value)"
          title="Con secreto, el parámetro se escribe como SecureString"
        >
          <option value="String">String</option>
          <option value="StringList">StringList</option>
          <option value="SecureString">SecureString</option>
        </select>
      </div>

      <label style="margin-top:16px;">Regiones destino</label>
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

      <div class="actions" style="justify-content:flex-end; margin-top:10px;">
        <button type="button" class="secondary" [disabled]="busy()" (click)="run(true)">
          Ver comandos
        </button>
        <button type="button" [disabled]="busy()" (click)="run(false)">Crear en las regiones</button>
      </div>
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