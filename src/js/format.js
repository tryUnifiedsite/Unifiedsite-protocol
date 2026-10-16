const DASH = '—';

export function fmtPrice(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  const a = Math.abs(v);
  if (a === 0) return '$0.00';
  if (a >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (a >= 1) return '$' + v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00');
  const dec = Math.min(12, Math.max(4, 3 - Math.floor(Math.log10(a))));
  return '$' + v.toFixed(dec);
}

export function fmtCompact(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  const a = Math.abs(v);
  const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [n, s] of units) if (a >= n) return '$' + (v / n).toFixed(a / n >= 100 ? 0 : a / n >= 10 ? 1 : 2) + s;
  return '$' + v.toFixed(0);
}

export function fmtPct(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  const a = Math.abs(v);
  const s = a >= 1000 ? a.toLocaleString('en-US', { maximumFractionDigits: 0 }) : a.toFixed(a >= 100 ? 0 : 2);
  return (v >= 0 ? '▲ +' : '▼ −') + s + '%';
}

export function tileLetter(symbol) {
  const m = String(symbol || '').match(/[A-Za-z0-9]/);
  return m ? m[0].toUpperCase() : '?';
}
