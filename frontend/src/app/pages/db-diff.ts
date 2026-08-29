import { Component, computed, inject, signal } from '@angular/core';
import { DiffResponse, EnvironmentInfo } from '../api-gen/models';
import { EnvironmentService } from '../core/services/environment.service';
import { DbService } from '../core/services/db.service';
import { toApiError } from '../core/services/api-error';
import { objectLabel } from '../core/format';
import { StatusBadge } from '../shared/status-badge';
import { CopyButton } from '../shared/copy-button';
import { RegionControlsComponent } from '../shared/region-controls';

@Component({
  selector: 'app-db-diff-page',
  imports: [RegionControlsComponent, StatusBadge, CopyButton],
  template: `
    <h1>Diff de Base de Datos</h1>

    <app-region-controls
      [environments]="environments()"
      [withService]="false"
      [(envB)]="envB"
      [(envA)]="envA"
    />
    <div class="form-grid">
      <div>
        <label for="schema">Schema</label>
        <input
          id="schema"
          type="text"
          [value]="schema()"
          (input)="schema.set($any($event.target).value)"
          placeholder="p. ej. prod"
          spellcheck="false"
        />
      </div>
      <div>
        <label for="object-name">Objeto</label>
        <input
          id="object-name"
          type="text"
          [value]="objectName()"
          (input)="objectName.set($any($event.target).value)"
          placeholder="p. ej. t_comandas"
          spellcheck="false"
        />
      </div>
    </div>
    <div class="radio-row">
      <label class="chk">
        <input
          type="radio"
          name="object-type"
          value="table"
          [checked]="objectType() === 'table'"
          (change)="objectType.set('table')"
        />
        Tabla
      </label>
      <label class="chk">
        <input
          type="radio"
          name="object-type"
          value="procedure"
          [checked]="objectType() === 'procedure'"
          (change)="objectType.set('procedure')"
        />
        Stored procedure
      </label>
    </div>
    <div class="checkbox-row" style="margin-top:10px;">
      <label class="chk">
        <input
          type="checkbox"
          [checked]="includeDeletes()"
          (change)="includeDeletes.set($any($event.target).checked)"
        />
        Incluir eliminaciones
      </label>
    </div>
    <button type="button" [disabled]="busy()" (click)="compare()">Comparar</button>

    @if (error()) {
      <div class="error-box">{{ error() }}</div>
    }

    @if (busy()) {
      <div class="panel"><span class="spinner"></span>{{ busyText() }}</div>
    }

    @if (result()) {
      <div class="panel">
        <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
          <app-badge [status]="result()!.status" />
          <span class="muted">
            {{ result()!.object_type }} {{ result()!.schema_name }}.{{ result()!.object_name }}
          </span>
          <span class="muted">{{ result()!.env_b }} → {{ result()!.env_a }}</span>
        </div>
        @for (n of result()!.notes ?? []; track n) {
          <div class="note">• {{ n }}</div>
        }
      </div>

      @if (result()!.status === 'missing_in_b') {
        <div class="panel">
          <div class="section-title"><strong>Región Destino ({{ result()!.env_a }})</strong></div>
          <pre>{{ pre(result()!.code_a, 'No existe en ' + result()!.env_b + ' (origen)') }}</pre>
        </div>
        @if (result()!.script) {
          <div class="panel">
            <div class="section-title">
              <strong>Script de eliminación (ejecutar en la región destino: {{ result()!.env_a }})</strong>
            </div>
            <pre>{{ result()!.script }}</pre>
            <div class="actions" style="margin-top:10px;">
              <app-copy-button [text]="result()!.script ?? ''" />
            </div>
          </div>
        }
      }

      @if (result()!.status === 'different' || result()!.status === 'missing_in_a') {
        <div class="columns">
          <div class="panel">
            <div class="section-title"><strong>Región de Origen — {{ result()!.env_b }}</strong></div>
            <pre>{{ pre(result()!.code_b, 'No existe en la región de origen') }}</pre>
          </div>
          <div class="panel">
            <div class="section-title"><strong>Región Destino — {{ result()!.env_a }}</strong></div>
            <pre>{{ pre(result()!.code_a, 'No existe en la región destino') }}</pre>
          </div>
        </div>
        <div class="panel">
          <div class="section-title">
            <strong>Script de actualización (ejecutar en la región destino: {{ result()!.env_a }})</strong>
          </div>
          @if (result()!.script) {
            <pre>{{ result()!.script }}</pre>
            <div class="actions" style="margin-top:10px;">
              <app-copy-button [text]="result()!.script ?? ''" />
            </div>
          } @else {
            <pre class="empty">No se detectaron cambios de estructura ejecutables.</pre>
          }
        </div>
      }
    }
  `,
})
export class DbDiffPage {
  private readonly envService = inject(EnvironmentService);
  private readonly dbService = inject(DbService);

  readonly environments = signal<EnvironmentInfo[] | null>(null);
  readonly envA = signal('');
  readonly envB = signal('');
  readonly schema = signal('');
  readonly objectName = signal('');
  readonly objectType = signal<'table' | 'procedure'>('table');
  readonly includeDeletes = signal(false);

  readonly busy = signal(false);
  readonly busyText = signal('');
  readonly error = signal<string | null>(null);
  readonly result = signal<DiffResponse | null>(null);

  constructor() {
    this.envService.list().then(
      (envs) => this.environments.set(envs.environments),
      (err) => this.error.set('No se pudieron cargar los ambientes: ' + toApiError(err).message),
    );
  }

  compare() {
    const schema = this.schema().trim();
    const objectName = this.objectName().trim();
    if (!this.envA() || !this.envB()) {
      this.error.set('Seleccioná las dos regiones.');
      return;
    }
    if (!schema || !objectName) {
      this.error.set('Completá el schema y el nombre del objeto.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    this.busyText.set(
      `Comparando ${objectLabel(this.objectType())} ${schema}.${objectName} de origen ${this.envB()} a destino ${this.envA()}...`,
    );

    this.dbService
      .diff({
        env_a: this.envA(),
        env_b: this.envB(),
        schema_name: schema,
        object_type: this.objectType(),
        object_name: objectName,
        include_deletes: this.includeDeletes(),
      })
      .then(
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

  pre(v: string | null | undefined, empty: string): string {
    return v ?? empty;
  }
}