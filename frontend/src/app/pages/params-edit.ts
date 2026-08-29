import { Component, inject, signal } from '@angular/core';
import { EnvironmentInfo } from '../api-gen/models';
import { EnvironmentService } from '../core/services/environment.service';
import { ParamsService } from '../core/services/params.service';
import { toApiError } from '../core/services/api-error';
import { EnvSelectComponent } from '../shared/env-select';

@Component({
  selector: 'app-params-edit-page',
  imports: [EnvSelectComponent],
  template: `
    <h1>Editar / actualizar un parámetro</h1>
    <p class="muted">
      Elegís un ambiente y un nombre: el valor se lee (con decodificación si es
      <code>SecureString</code>), lo editás y lo guardás con <strong>tu confirmación</strong>.
      Si no existe el parámetro, podés crearlo desde acá (overwrite).
    </p>

    <div class="panel">
      <label for="env">Ambiente</label>
      <app-env-select [environments]="environments()" [(value)]="env" />

      <label for="name" style="margin-top:16px;">Nombre del parámetro</label>
      <input
        id="name"
        type="text"
        [value]="name()"
        (input)="name.set($any($event.target).value)"
        placeholder="/yappy/dev/config"
        spellcheck="false"
        style="max-width: 420px;"
        (keydown.enter)="read()"
      />

      <div class="actions" style="justify-content:flex-end; margin-top:10px;">
        <button type="button" class="secondary" [disabled]="busy()" (click)="read()">Leer</button>
      </div>
    </div>

    @if (error()) {
      <div class="error-box">{{ error() }}</div>
    }

    @if (busy() && !loaded()) {
      <div class="panel"><span class="spinner"></span>Leyendo…</div>
    }

    @if (loaded()) {
      <div class="panel">
        <div class="section-title">
          <strong>Valor actual</strong>
          <span class="muted">{{ env() }} — {{ valueType() }}</span>
        </div>
        <textarea
          id="value"
          class="change-input"
          rows="6"
          spellcheck="false"
          style="max-height:none; min-height:120px; white-space:pre-wrap;"
          [value]="value()"
          (input)="value.set($any($event.target).value)"
        ></textarea>

        <div style="margin-top:16px;">
          <label for="value-type">Tipo</label>
          <select
            id="value-type"
            style="max-width: 260px;"
            [value]="valueType()"
            (change)="valueType.set($any($event.target).value)"
          >
            <option value="String">String</option>
            <option value="StringList">StringList</option>
            <option value="SecureString">SecureString</option>
          </select>
        </div>

        <div class="actions" style="justify-content:flex-end; margin-top:10px;">
          <button type="button" [disabled]="busy()" (click)="save()">Guardar</button>
        </div>
        @if (resultMsg()) {
          <div class="note {{ resultIsError() ? 'err' : 'ok' }}">{{ resultMsg() }}</div>
        }
      </div>
    }

    @if (busy() && loaded()) {
      <div class="panel"><span class="spinner"></span>Guardando…</div>
    }
  `,
})
export class ParamsEditPage {
  private readonly envService = inject(EnvironmentService);
  private readonly paramsService = inject(ParamsService);

  readonly environments = signal<EnvironmentInfo[] | null>(null);
  readonly env = signal('');
  readonly name = signal('');
  readonly value = signal('');
  readonly valueType = signal('String');
  readonly loaded = signal(false);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly resultMsg = signal<string | null>(null);
  readonly resultIsError = signal(false);

  constructor() {
    this.envService.list().then(
      (envs) => this.environments.set(envs.environments),
      (err) => this.error.set('No se pudieron cargar los ambientes: ' + toApiError(err).message),
    );
  }

  read() {
    const env = this.env();
    const name = this.name().trim();
    if (!name) {
      this.error.set('Ingresá el nombre del parámetro.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    this.resultMsg.set(null);
    this.paramsService.get(env, name).then(
      (d) => {
        this.busy.set(false);
        this.value.set(d.value);
        this.valueType.set(d.value_type);
        this.loaded.set(true);
      },
      (err) => {
        this.busy.set(false);
        this.loaded.set(false);
        this.error.set(toApiError(err).message);
      },
    );
  }

  save() {
    const env = this.env();
    const name = this.name().trim();
    if (!name) {
      this.error.set('Ingresá el nombre del parámetro.');
      return;
    }
    if (!confirm(`¿Guardar ${name} en ${env}? (put-parameter, overwrite)\nCada región usa su profile/región configurados.`)) {
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    this.resultMsg.set(null);
    this.paramsService
      .multi({
        name,
        value: this.value(),
        value_type: this.valueType(),
        envs: [env],
        dry_run: false,
        confirm: true,
      })
      .then(
        (d) => {
          this.busy.set(false);
          const first = d.results[0];
          if (first?.ok) {
            this.resultIsError.set(false);
            this.resultMsg.set(first.message ?? 'Parámetro guardado.');
          } else {
            this.resultIsError.set(true);
            this.resultMsg.set(first?.error || 'No se pudo guardar.');
          }
        },
        (err) => {
          this.busy.set(false);
          this.error.set(toApiError(err).message);
        },
      );
  }
}