// Couleurs et petites valeurs communes (mêmes teintes que web/style.css).
export const C = {
  bg: '#0B1220',
  card: '#111a2e',
  card2: '#16213a',
  line: '#1e293b',
  border: '#334155',
  text: '#f8fafc',
  text2: '#cbd5e1',
  muted: '#94a3b8',
  dim: '#64748b',
  accent: '#2563eb',
  ok: '#22c55e',
  warn: '#f59e0b',
  bad: '#fca5a5',
  gold: '#f59e0b',
};

export const fmtDate = (iso: string, withTime = false) => {
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' })
    : d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
};
