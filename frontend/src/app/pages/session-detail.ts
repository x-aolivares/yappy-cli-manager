import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SessionDetailResponse, SessionItemInfo } from '../api-gen/models';
import { SessionService } from '../core/services/session.service';
import { toApiError } from '../core/services/api-error';
import { fmtDate } from '../core/format';
import { StatusBadge } from '../shared/status-badge';

const STATUS_META: Record<string, [string, string]> = {
  pendiente: ['none', 'Pendiente'],
  revisado: ['equal', 'Revisado'],
  aplicado: ['ok', 'Aplicado'],
  saltado: ['missing_in_b', 'Saltado'],
};

@Component({
  selector: 'app-session-detail-page',
  imports: [RouterLink, StatusBadge],
  template: `
    @if (error()) {
      <div class="error-box">{{ error() }}</div>
    }
    @if (busy() && !session()) {
      <div class="panel"><span class="spinner"></span>Cargando sesión…</div>
    }

    @if (session(); as session) {
      <a routerLink="/sessions" class="muted" style="text-decoration:none;">← Sesiones</a>
      <h1>{{ session.title }}</h1>
      <p class="muted">
        {{ session.env_b }} (origen) → {{ session.env_a }} (destino) ·
        creada {{ fmtDate(session.created_at) }} · {{ session.items.length }} parámetros
      </p>
      <div class="panel">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <div class="muted">{{ doneCount(session) }} de {{ session.items.length }} cerrados</div>
          <div class="progress-track">
            <div class="progress-fill" [style.width.%]="donePct(session)"></div>
          </div>
          <div class="muted">{{ donePct(session) }}%</div>
        </div>
      </div>
      @if (nextItem(session); as next) {
        <p style="margin-top:12px;">
          <a class="primary" style="text-decoration:none;" [routerLink]="['/params-diff']" [queryParams]="diffQuery(next, session)">
            Siguiente pendiente →
          </a>
          <span class="muted">({{ pendingCount(session) }} en cola)</span>
        </p>
      }
      <div class="panel" style="margin-top:12px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:space-between;">
        <a class="primary" [href]="reportUrl()" target="_blank" rel="noreferrer" style="text-decoration:none;">Descargar reporte .md</a>
        <div class="muted">Trackeo del cambio de la sesión</div>
      </div>
      <div class="panel" style="margin-top:12px; display:grid; gap:8px;">
        <label for="session-filter">Filtrar por nombre</label>
        <input
          id="session-filter"
          type="text"
          [value]="filterText()"
          (input)="filterText.set($any($event.target).value)"
          placeholder="/prod/api/..."
        />
      </div>
      <div class="panel" style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap; align-items:end;">
        <div style="flex:1; min-width:220px;">
          <label for="session-new-name">Agregar parámetro a la sesión</label>
          <input id="session-new-name" type="text" [value]="newItemName()" (input)="newItemName.set($any($event.target).value)" placeholder="/prod/new/param" />
        </div>
        <button type="button" class="secondary" [disabled]="actBusy()" (click)="addItem()">Agregar</button>
      </div>
      <div style="margin-top:12px;" class="panel">
        <table>
          <thead>
            <tr><th>#</th><th>Nombre</th><th>Servicio</th><th>Estado</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            @for (item of filteredItems(); track item.name) {
              <tr>
                <td class="muted">{{ item.position + 1 }}</td>
                <td><code>{{ item.name }}</code></td>
                <td>
                  @if (item.service === 'secretsmanager' || item.is_secret) {
                    <app-badge status="secret" label="Secreto" />
                  } @else {
                    <span class="muted">SSM</span>
                  }
                </td>
                <td>
                  @if (statusMeta(item.status); as meta) {
                    <app-badge [status]="meta[0]" [label]="meta[1]" />
                  }
                </td>
                <td>
                  <a
                    class="primary"
                    style="text-decoration:none; display:inline-block;"
                    [routerLink]="['/params-diff']"
                    [queryParams]="diffQuery(item, session)"
                  >Abrir en Parámetros →</a>
                  @if (item.status !== 'aplicado') {
                    <button type="button" class="secondary" [disabled]="actBusy()" (click)="setStatus(item.name, 'aplicado')">
                      Marcar aplicado
                    </button>
                  }
                  @if (item.status === 'pendiente') {
                    <button type="button" class="secondary" [disabled]="actBusy()" (click)="setStatus(item.name, 'saltado')">
                      Saltar
                    </button>
                  }
                  @if (item.status === 'saltado' || item.status === 'aplicado') {
                    <button type="button" class="secondary" [disabled]="actBusy()" (click)="setStatus(item.name, 'pendiente')">
                      Reabrir
                    </button>
                  }
                  @if (itemDetailsText(item); as text) {
                    <details style="margin-top:6px;">
                      <summary class="muted" style="font-size:12px; cursor:pointer;">Ver guardado</summary>
                      <pre class="script-block" style="margin-top:6px; overflow:auto;">{{ text }}</pre>
                    </details>
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
export class SessionDetailPage {
  private readonly sessionService = inject(SessionService);

  readonly sessionId = input.required<string>();

  readonly session = signal<SessionDetailResponse | null>(null);
  readonly busy = signal(false);
  readonly actBusy = signal(false);
  readonly error = signal<string | null>(null);
  readonly filterText = signal('');
  readonly newItemName = signal('');

  constructor() {
    effect(() => {
      const id = this.sessionId();
      if (id) void this.load(id);
    });
  }

  load(id: string) {
    this.busy.set(true);
    this.error.set(null);
    return this.sessionService.get(id).then(
      (d) => {
        this.busy.set(false);
        this.session.set(d);
      },
      (err) => {
        this.busy.set(false);
        this.error.set(toApiError(err).message);
      },
    );
  }

  setStatus(name: string, status: string) {
    const id = this.sessionId();
    if (!id) return;
    this.actBusy.set(true);
    this.error.set(null);
    this.sessionService.updateItem(id, { name, status }).then(
      () => {
        this.actBusy.set(false);
        void this.load(id);
      },
      (err) => {
        this.actBusy.set(false);
        this.error.set(toApiError(err).message);
      },
    );
  }

  doneCount(session: SessionDetailResponse): number {
    if (!session.status_counts) return 0;
    return (session.status_counts['aplicado'] || 0) + (session.status_counts['saltado'] || 0);
  }

  donePct(session: SessionDetailResponse): number {
    const total = session.items.length;
    return total ? Math.round((this.doneCount(session) / total) * 100) : 0;
  }

  pendingCount(session: SessionDetailResponse): number {
    return session.items.filter((i) => i.status === 'pendiente').length;
  }

  filteredItems(): SessionItemInfo[] {
    const session = this.session();
    if (!session) return [];
    const q = this.filterText().trim().toLowerCase();
    if (!q) return session.items;
    return session.items.filter((item) => item.name.toLowerCase().includes(q));
  }

  addItem() {
    const id = this.sessionId();
    const name = this.newItemName().trim();
    if (!id || !name) return;
    this.actBusy.set(true);
    this.error.set(null);
    this.sessionService
      .createItem(id, { name, status: 'pendiente', service: this.session()?.service || 'ssm' })
      .then(
        () => {
          this.actBusy.set(false);
          this.newItemName.set('');
          void this.load(id);
        },
        (err) => {
          this.actBusy.set(false);
          this.error.set(toApiError(err).message);
        },
      );
  }

  nextItem(session: SessionDetailResponse): SessionItemInfo | null {
    return session.items.find((i) => i.status === 'pendiente') ?? null;
  }

  diffQuery(item: SessionItemInfo, session: SessionDetailResponse): Record<string, string> {
    return {
      session: session.id,
      env_a: session.env_a,
      env_b: session.env_b,
      service: item.service || session.service || 'ssm',
      name: item.name,
      with_secret: item.is_secret ? '1' : '0',
    };
  }

  statusMeta(status: string): [string, string] {
    return STATUS_META[status] ?? ['none', status];
  }

  itemDetailsText(item: SessionItemInfo): string {
    const parts: string[] = [];
    if (item.diff_err) parts.push(`Error al diferir:\n${item.diff_err}`);
    if (item.notes) parts.push(item.notes);
    if (item.script) parts.push(`Comando:\n${item.script}`);
    if (item.preview) parts.push(`Valor a aplicar:\n${item.preview}`);
    return parts.join('\n\n');
  }

  reportUrl(): string {
    const id = this.sessionId();
    return id ? `/api/sessions/${encodeURIComponent(id)}/report.md` : '#';
  }

  protected readonly fmtDate = fmtDate;
}