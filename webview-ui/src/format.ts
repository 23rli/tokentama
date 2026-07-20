export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${formatCompact(n / 1_000_000)}M`;
  if (abs >= 1000) return `${formatCompact(n / 1000)}k`;
  return Math.round(n).toLocaleString();
}

export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '$0';
  const digits = Math.abs(n) < 0.01 ? 4 : 2;
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatCompact(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}
