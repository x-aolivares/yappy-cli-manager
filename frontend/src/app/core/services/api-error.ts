import { HttpErrorResponse } from '@angular/common/http';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { detail?: unknown } | null;
    const detail = body?.detail;
    if (typeof detail === 'string') {
      return new ApiError(detail, err.status);
    }
    if (Array.isArray(detail)) {
      const msgs = detail
        .map((d) => (typeof d === 'object' && d !== null && 'msg' in d ? String(d.msg) : String(d)))
        .join('; ');
      return new ApiError(msgs || err.statusText || `Error ${err.status}`, err.status);
    }
    return new ApiError(err.statusText || `Error ${err.status}`, err.status);
  }
  return new ApiError(err instanceof Error ? err.message : String(err));
}