// Market data engine. No DOM and no knowledge of any record except the
// market-source record handed in by the caller.

export const TOP_N = 10;
export const POLL_MS = 60000;
export const BACKOFF_BASE_MS = 2 * 1000;
export const BACKOFF_MAX_MS = 60000;
export const CHUNK = 30;
export const TIMEOUT_MS = 12000;

export function backoffDelay(failures, random = Math.random) {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, Math.max(0, failures - 1)));
  return Math.min(BACKOFF_MAX_MS, exp + Math.floor(random() * 250));
}

export function pickSolana(boosts) {
  const seen = new Set();
  const out = [];
  if (!Array.isArray(boosts)) return out;
  for (const b of boosts) {
    if (!b || b.chainId !== 'solana' || typeof b.tokenAddress !== 'string') continue;
    if (seen.has(b.tokenAddress)) continue;
    seen.add(b.tokenAddress);
    out.push(b.tokenAddress);
  }
  return out;
}

export function chunk(list, size = CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// One pair per token: the base-token pool with the deepest liquidity.
export function bestPairs(pairs, wanted) {
  const best = new Map();
  if (!Array.isArray(pairs)) return [];
  for (const p of pairs) {
    if (!p || p.chainId !== 'solana' || !p.baseToken) continue;
    const a = p.baseToken.address;
    if (wanted && !wanted.has(a)) continue;
    const liq = num(p.liquidity && p.liquidity.usd) || 0;
    const cur = best.get(a);
    if (!cur || liq > cur.liq) best.set(a, { liq, p });
  }
  return [...best.values()].map((x) => x.p);
}

export function toRow(p) {
  const info = p.info || {};
  return {
    address: p.baseToken.address,
    symbol: String(p.baseToken.symbol || '?'),
    name: String(p.baseToken.name || ''),
    image: typeof info.imageUrl === 'string' && info.imageUrl ? info.imageUrl : null,
    price: num(p.priceUsd),
    change: num(p.priceChange && p.priceChange.h24),
    volume: num(p.volume && p.volume.h24),
    liq: num(p.liquidity && p.liquidity.usd),
  };
}

export function rank(rows, n = TOP_N) {
  return rows
    .slice()
    .sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1))
    .slice(0, n);
}

async function getJson(fetchFn, url, ms) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;
  try {
    const res = await fetchFn(url, ctl ? { signal: ctl.signal, headers: { accept: 'application/json' } } : undefined);
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchSnapshot(record, fetchFn) {
  const boosts = await getJson(fetchFn, record.boosts, TIMEOUT_MS);
  const addrs = pickSolana(boosts);
  if (!addrs.length) throw new Error('empty');
  const wanted = new Set(addrs);
  const all = [];
  for (const part of chunk(addrs)) {
    const url = record.pairs.replace('{addresses}', part.join(','));
    const data = await getJson(fetchFn, url, TIMEOUT_MS);
    all.push(...bestPairs(data, wanted));
  }
  const rows = rank(bestPairs(all, wanted).map(toRow));
  if (!rows.length) throw new Error('no pairs');
  return rows;
}

// status: pending | loading | live | stale | down
export function createMarket({
  record,
  fetchFn = (...a) => fetch(...a),
  onData = () => {},
  onState = () => {},
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
  hidden = () => typeof document !== 'undefined' && document.hidden,
  random = Math.random,
} = {}) {
  let timer = null;
  let failures = 0;
  let inflight = false;
  let last = null;
  let stopped = false;

  const usable = !!record && record.state === 'stated' && !!record.boosts && !!record.pairs;

  function schedule(ms) {
    clearTimer(timer);
    timer = null;
    if (stopped || hidden()) return;
    timer = setTimer(load, ms);
  }

  async function load() {
    if (!usable || inflight || stopped) return;
    inflight = true;
    clearTimer(timer);
    timer = null;
    onState({ status: last ? 'syncing' : 'loading' });
    let rows;
    try {
      rows = await fetchSnapshot(record, fetchFn);
    } catch (err) {
      failures += 1;
      inflight = false;
      onState({ status: last ? 'stale' : 'down', error: String((err && err.message) || err) });
      schedule(backoffDelay(failures, random));
      return;
    }
    last = rows;
    failures = 0;
    inflight = false;
    try { onData(rows); onState({ status: 'live' }); } catch (e) { onState({ status: 'live', error: 'render' }); }
    schedule(POLL_MS);
  }

  function visibilityChanged() {
    if (!usable || stopped) return;
    if (hidden()) {
      clearTimer(timer);
      timer = null;
    } else {
      load();
    }
  }

  return {
    start() {
      if (!usable) {
        onState({ status: 'pending' });
        return;
      }
      load();
    },
    stop() { stopped = true; clearTimer(timer); timer = null; },
    visibilityChanged,
    get last() { return last; },
    get failures() { return failures; },
    get usable() { return usable; },
  };
}
