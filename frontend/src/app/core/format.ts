export const STATUS_LABELS: Record<string, string> = {
  equal: 'Sin cambios',
  different: 'Hay cambios',
  missing_in_a: 'Falta en la región Destino',
  missing_in_b: 'Falta en la región de Origen',
  none: 'No existe en ninguna región',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function objectLabel(type: string): string {
  return type === 'procedure' ? 'stored procedure' : 'tabla';
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string') {
    try {
      return JSON.stringify(JSON.parse(v), null, 2);
    } catch {
      return v;
    }
  }
  return JSON.stringify(v, null, 2);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return (
    d.toLocaleDateString('es-AR') +
    ' ' +
    d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  );
}

export function preText(content: string | null | undefined, empty: string): string {
  return content ? content : empty;
}