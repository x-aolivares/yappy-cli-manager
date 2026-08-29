import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SessionSummaryInfo } from '../api-gen/models';
import { SessionService } from '../core/services/session.service';
import { toApiError } from '../core/services/api-error';
import { fmtDate } from '../core/format';
import { StatusBadge } from '../shared/status-badge';

@Component({
  selector: 'app-sessions-page',
  imports: [RouterLink, StatusBadge],
  template: `
    <h1>Sesiones de parámetros</h1>
    <p class="muted">
      Una sesión es una lista de parámetros que vas a sincronizar entre una región de
      <strong>origen</strong> y una de <strong>destino</strong>. La creás desde
      <a routerLink="/params-read">Leer Parámetros</a> pegando tu lista (o desde tu hoja de
      cálculo), y después vas iterando ítem por ítem: cada uno se abre en
      <strong>Parámetros</strong> para ver el diff y ejecutar el cambio. Acá queda guardado el
      progreso de todo — sin tocar AWS.
    </p>

    <div class="panel" style="margin-top:0;">
      <label for="session-search">Filtrar por nombre</label>
      <input
        id="session-search"
        type="text"
        [value]="filterText()"
        (input)="filterText.set($any($event.target).value)"
        placeholder="release/REP-000000 o /prod/api/..."
      />
    </div>
 
    @if (error()) {
     <div class="error-box">{{ error() }}</div>
    }
 
    @if (busy() && !sessions()) {
     <div class="panel"><span class="spinner"></span>Cargando sesiones…</div>
    }

    @for (s of filteredSessions(); track s.id) {
      <div class="panel">
        <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
          <div style="flex:1; min-width:220px;">
            <div><strong>{{ s.title }}</strong></div>
            <div class="muted">
              {{ s.env_b }} → {{ s.env_a }} · {{ s.item_count }} parámetros · {{ fmtDate(s.created_at) }}
            </div>
          </div>
          <app-badge status="ok" label="Aplicado" /> <span class="muted">{{ s.status_counts?.['aplicado'] ?? 0 }}</span>
          <app-badge status="equal" label="Revisado" /> <span class="muted">{{ s.status_counts?.['revisado'] ?? 0 }}</span>
          <app-badge status="none" label="Pendiente" /> <span class="muted">{{ s.status_counts?.['pendiente'] ?? 0 }}</span>
          @if (s.status_counts!['saltado']) {
            <app-badge status="missing_in_b" label="Saltado" />
            <span class="muted">{{ s.status_counts!['saltado'] }}</span>
          }
        </div>
        <div class="actions" style="margin-top:10px;">
          <a
            class="primary"
            style="text-decoration:none;"
            [routerLink]="['/sessions', s.id]"
          >Continuar / Revisar</a>
          <button type="button" class="secondary" (click)="remove(s.id)" [disabled]="deleting()">
            Eliminar
          </button>
        </div>
      </div>
    } @empty {
      @if (sessions() !== null) {
        <div class="panel" style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <span class="muted">Todavía no hay sesiones.</span>
          <a class="primary" routerLink="/params-read" style="margin-left:auto;">Crear una nueva sesión</a>
        </div>
      }
    }
  `,
})
export class SessionsPage {
  private readonly sessionService = inject(SessionService);

  readonly sessions = signal<SessionSummaryInfo[] | null>(null);
  readonly filterText = signal('');
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly deleting = signal(false);

  constructor() {
    void this.load();
  }

  filteredSessions(): SessionSummaryInfo[] {
    const q = this.filterText().trim().toLowerCase();
    const all = this.sessions() ?? [];
    if (!q) return all;
    return all.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        `${s.env_a} ${s.env_b}`.toLowerCase().includes(q),
    );
  }

  load() {
    this.busy.set(true);
    this.error.set(null);
    return this.sessionService.list().then(
      (d) => {
        this.busy.set(false);
        this.sessions.set(d.sessions);
      },
      (err) => {
        this.busy.set(false);
        this.error.set(toApiError(err).message);
      },
    );
  }

  remove(id: string) {
    if (!confirm('¿Eliminar DEFINITIVAMENTE esta sesión y su progreso?\nNo se puede deshacer.')) return;
    this.deleting.set(true);
    this.sessionService.delete(id).then(
      () => {
        this.deleting.set(false);
        void this.load();
      },
      (err) => {
        this.deleting.set(false);
        this.error.set(toApiError(err).message);
      },
    );
  }

  protected readonly fmtDate = fmtDate;
}