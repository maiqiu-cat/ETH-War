export function fmtUsd(v: number) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return `$${Math.round(v)}`;
}

export function fmtPrice(v: number) {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString('en-GB', { hour12: false });
}
