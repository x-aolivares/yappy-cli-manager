import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../api-gen/api';
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  updateSessionItem,
} from '../../api-gen/functions';
import {
  CreateSessionRequest,
  DeleteResponse,
  SessionDetailResponse,
  SessionItemInfo,
  SessionsListResponse,
  UpdateSessionItemRequest,
} from '../../api-gen/models';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly api = inject(Api);
  private readonly http = inject(HttpClient);

  create(request: CreateSessionRequest): Promise<SessionDetailResponse> {
    return this.api.invoke(createSession, { body: request });
  }

  list(): Promise<SessionsListResponse> {
    return this.api.invoke(listSessions, {});
  }

  get(sessionId: string): Promise<SessionDetailResponse> {
    return this.api.invoke(getSession, { session_id: sessionId });
  }

  delete(sessionId: string): Promise<DeleteResponse> {
    return this.api.invoke(deleteSession, { session_id: sessionId });
  }

  updateItem(
    sessionId: string,
    request: UpdateSessionItemRequest,
  ): Promise<SessionItemInfo> {
    return this.api.invoke(updateSessionItem, { session_id: sessionId, body: request });
  }

  createItem(sessionId: string, request: UpdateSessionItemRequest): Promise<SessionItemInfo> {
    return firstValueFrom(
      this.http.post<SessionItemInfo>(`/api/sessions/${encodeURIComponent(sessionId)}/items/create`, request),
    );
  }

  reportMarkdown(sessionId: string): Promise<string> {
    return firstValueFrom(
      this.http.get(`/api/sessions/${encodeURIComponent(sessionId)}/report.md`, { responseType: 'text' }),
    );
  }
}