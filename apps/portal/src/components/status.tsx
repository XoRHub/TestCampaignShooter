const STYLES: Record<string, { className: string; label: string }> = {
  pending: { className: '', label: 'en attente' },
  running: { className: 'busy', label: 'en cours' },
  succeeded: { className: 'good', label: 'succès' },
  passed: { className: 'good', label: 'succès' },
  failed: { className: 'bad', label: 'échec' },
  error: { className: 'bad', label: 'erreur' },
  timeout: { className: 'warn', label: 'timeout' },
  cancelled: { className: 'warn', label: 'annulé' },
  skipped: { className: '', label: 'ignoré' },
};

/** Status badge — icon (dot) + label so state is never conveyed by color alone. */
export function StatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? { className: '', label: status };
  return (
    <span className={`badge ${style.className}`}>
      <span className="dot" aria-hidden />
      {style.label}
    </span>
  );
}
