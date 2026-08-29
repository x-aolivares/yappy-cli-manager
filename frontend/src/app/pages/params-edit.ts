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
    <h1>Editar un parámetro</h1>

    <div class="form-grid">
      <div>
        <label for="env">Ambiente</label>
        <app-env-select [environments]="environments()" [(value)]="env" />
      </div>
      <div>
        <label for="name">Nombre del parámetro</label>
        <input
          id="name"
          type="text"
          [value]="name()"
          (input)="name.set($any($event.target).value)"
          placeholder="p. ej. /yappy/dev/rate"
          spellcheck="false"
          (keydown.enter)="read()"
        />
      </div>
    </div>
    <button type="button" [disabled]="busy()" (click)="read()">Ver valor actual</button>

    @if (error()) {
      <div class="error-box">{{ error() }}</div>
    }

    @if (busy() && !loaded()) {
      <div class="panel"><span class="spinner"></span>Leyendo…</div>
    }

    @if (loaded()) {
      <div class="panel">
        <div class="muted" style="margin-bottom:8px;">{{ env() }} — {{ valueType() }}</div>
        <label for="value">Valor</label>
        <textarea
          id="value"
          spellcheck="false"
          [value]="value()"
          (input)="value.set($any($event.target).value)"
        ></textarea>
        <button type="button" [disabled]="busy()" (click)="save()">Guardar</button>
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