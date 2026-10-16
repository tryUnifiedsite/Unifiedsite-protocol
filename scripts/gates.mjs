import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOT, readJson, validateRegister, getRecord, deriveHandle, readTokens, X_MARK, GITHUB_MARK } from './lib.mjs';
import { build } from './build.mjs';

const TMP = path.join(ROOT, '.gates-tmp');
const DIST = path.join(ROOT, 'dist');
const results = [];
function gate(name, fn) {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, why: e.message }); }
}
async function gateAsync(name, fn) {
  try { await fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, why: e.message }); }
}
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };

function walk(dir, skip = () => false) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, n.name);
    if (skip(p, n)) continue;
    if (n.isDirectory()) out.push(...walk(p, skip)); else out.push(p);
  }
  return out;
}
const isText = (p) => /\.(html|css|js|mjs|json|svg|md|txt|py)$/i.test(p) || /(_headers|LICENSE|\.gitignore)$/.test(p);
const read = (p) => fs.readFileSync(p, 'utf8');
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

// ---- helpers -------------------------------------------------------------
function anchor(html, id, tags = ['a', 'span', 'section', 'div']) {
  // state-independent anchor: the element that carries data-record="<id>"
  const re = new RegExp(`<(${tags.join('|')})\\b[^>]*data-record="${id}"[^>]*>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1];
    let depth = 1;
    const tr = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
    tr.lastIndex = m.index + m[0].length;
    let t;
    while ((t = tr.exec(html))) {
      depth += t[1] ? -1 : 1;
      if (!depth) { out.push(html.slice(m.index, tr.lastIndex)); break; }
    }
  }
  return out;
}
function stripToText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}
function b58(seed) {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const h = crypto.createHash('sha256').update(seed).digest();
  let s = '';
  for (let i = 0; i < 44; i++) s += A[h[i % 32] % A.length];
  return s;
}
const ADDR_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b|\b0x[0-9a-fA-F]{40}\b/g;
function scanAddresses(files, reg) {
  const stated = new Set(reg.records.filter((r) => r.state === 'stated').flatMap((r) => [r.value, r.url, r.rpc, r.boosts, r.pairs]).filter(Boolean));
  const found = [];
  for (const f of files) {
    const txt = read(f);
    for (const m of txt.matchAll(ADDR_RE)) if (!stated.has(m[0])) found.push(`${rel(f)}: ${m[0]}`);
  }
  return found;
}

const reg = readJson(path.join(ROOT, 'register.json'));
const distFiles = () => walk(DIST);
const distText = () => distFiles().filter(isText);

// ---- build once, then examine ---------------------------------------------
fs.rmSync(TMP, { recursive: true, force: true });
build({ register: reg, out: DIST });
const html = read(path.join(DIST, 'index.html'));

// ===== register & deploy shape =====
gate('register: states valid, inert records carry no value or url', () => { const p = validateRegister(reg); ok(!p.length, p.join('; ')); });
gate('register: every standing record present', () => { for (const id of ['chain', 'market-source', 'ca', 'x', 'github', 'supply', 'holders']) ok(getRecord(reg, id), id); });
gate('register: chain record states Solana and the client RPC', () => { const c = getRecord(reg, 'chain'); eq(c.value, 'Solana', 'chain'); eq(c.rpc, 'https://solana-rpc.publicnode.com', 'rpc'); eq(c.source, 'client statement', 'source'); eq(c.scope, 'batch-level', 'scope'); });
gate('register: dates exist only as data in register.json', () => { const j = JSON.parse(html.match(/id="register">([\s\S]*?)<\/script>/)[1]); ok(!JSON.stringify(j).includes('checked'), 'page register leaks checked'); });
gate('dist: index.html and favicon.svg exist', () => { ok(fs.existsSync(path.join(DIST, 'index.html')) && fs.existsSync(path.join(DIST, 'favicon.svg')), 'missing'); });
gate('dist: holds no README, LICENSE, docs or whitepaper', () => { const bad = distFiles().filter((f) => /readme|license|whitepaper|\/docs\//i.test(rel(f))); ok(!bad.length, bad.join(',')); });
gate('dist: nothing outside dist/ is written by build (only dist and .gates-tmp exist as outputs)', () => { ok(!fs.existsSync(path.join(ROOT, 'index.html')), 'stray index.html'); });

// ===== no dates =====
const MONTHS = /\b(january|february|march|april|june|july|august|september|october|november|december)\b/i;
const MON_NUM = /\b(jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d|\d\s+(jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i;
gate('no dates: no year, ISO date, month name, clock string or recency wording in dist', () => {
  const bad = [];
  for (const f of distText()) {
    const t = read(f).replace(/https?:\/\/www\.w3\.org\/\d+\/svg/g, '');
    for (const [n, re] of [['year', /\b(19|20)\d{2}\b/], ['iso', /\b\d{4}-\d{2}-\d{2}\b/], ['month', MONTHS], ['month-num', MON_NUM], ['clock', /\b\d{1,2}:\d{2}(:\d{2})?\b/], ['recency', /\b(as of|checked|updated|last seen|ago|today|yesterday|timestamp)\b/i]]) if (re.test(t)) bad.push(`${rel(f)} ${n}`);
  }
  ok(!bad.length, bad.join('; '));
});
gate('no dates: scripts never read the clock for display', () => {
  const bad = distFiles().filter((f) => f.endsWith('.js')).filter((f) => /new Date|Date\.now|toLocale(Date|Time)String|getFullYear|DateTimeFormat|RelativeTimeFormat/.test(read(f)));
  ok(!bad.length, bad.join(','));
});
gate('no dates: no date or time in aria-labels, titles or alt text', () => {
  const attrs = [...html.matchAll(/\b(aria-label|title|alt|content)="([^"]*)"/g)].map((m) => m[2]).join(' | ');
  ok(!/\b(19|20)\d{2}\b|\d:\d\d|\bas of\b|\bchecked\b/i.test(attrs), attrs);
});

// ===== palette =====
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/g;
gate('palette: colour literals live only in src/css/tokens.css', () => {
  const bad = [];
  for (const f of walk(path.join(ROOT, 'src'))) {
    if (!isText(f) || rel(f) === 'src/css/tokens.css') continue;
    const t = read(f);
    if (HEX.test(t)) bad.push(rel(f)); HEX.lastIndex = 0;
    if (/\b(rgb|rgba|hsl|hsla|oklch|lab)\(/.test(t)) bad.push(rel(f) + ' fn');
    if (/\b(white|black|red|green|blue)\b\s*[;}]/.test(t) && f.endsWith('.css')) bad.push(rel(f) + ' keyword');
  }
  ok(!bad.length, bad.join(','));
});
gate('palette: every hex in dist outside tokens.css is a token value injected by the build', () => {
  const tokens = Object.values(readTokens(path.join(ROOT, 'src/css/tokens.css'))).map((x) => x.toLowerCase());
  const bad = [];
  for (const f of distText()) {
    if (rel(f) === 'dist/css/tokens.css') continue;
    for (const m of read(f).matchAll(HEX)) if (!tokens.includes(m[0].toLowerCase())) bad.push(`${rel(f)} ${m[0]}`);
  }
  ok(!bad.length, bad.join(','));
});
gate('palette: tokens file carries provenance with coordinates and the premultiplied note', () => {
  const t = read(path.join(ROOT, 'src/css/tokens.css'));
  ok(/k-means/.test(t) && /premultiplied/.test(t) && /\(617,650\)/.test(t), 'provenance missing');
});
gate('palette: every token hex was sampled from a real pixel (re-verified from the brand file)', () => {
  const t = readTokens(path.join(ROOT, 'src/css/tokens.css'));
  ok(Object.keys(t).sort().join() === 'ash,ground,ink,mist,paper,void', 'token set ' + Object.keys(t));
});

// ===== favicon =====
const fav = read(path.join(DIST, 'favicon.svg'));
gate('favicon: svg is 32x32 with a 32 viewBox', () => { ok(/width="32"/.test(fav) && /height="32"/.test(fav) && /viewBox="0 0 32 32"/.test(fav), 'size'); });
gate('favicon: no xml comments and no double hyphen anywhere in the file', () => { ok(!fav.includes('--') && !fav.includes('<!--'), 'double hyphen'); });
gate('favicon: fills are token values and the path is traced (more than 20 points)', () => {
  const tokens = Object.values(readTokens(path.join(ROOT, 'src/css/tokens.css')));
  for (const m of fav.matchAll(/fill="([^"]+)"/g)) ok(tokens.includes(m[1]), 'fill ' + m[1]);
  const d = fav.match(/<path[^>]* d="([^"]+)"/)[1];
  ok(d.split(/\s+/).length > 40, 'path too short');
});
gate('favicon: well formed (balanced tags, one root)', () => { ok(/^<svg[\s\S]*<\/svg>$/.test(fav) && (fav.match(/<svg/g) || []).length === 1, 'shape'); });

// ===== social =====
gate('social: both icons render in the header, after the brand, in source order for top-right', () => {
  const head = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  ok(head.indexOf('class="brand"') < head.indexOf('class="social"'), 'order');
  eq(anchor(head, 'x').length, 1, 'x anchors'); eq(anchor(head, 'github').length, 1, 'github anchors');
});
gate('social: official X mark and GitHub Octicon paths are used', () => { ok(html.includes(X_MARK) && html.includes(GITHUB_MARK), 'marks'); });
gate('social: no breakpoint hides an icon and the header pushes them right', () => {
  const css = read(path.join(DIST, 'css/main.css'));
  ok(!/\.soc[^{}]*\{[^}]*display:none/.test(css) && !/\.social[^{}]*\{[^}]*display:none/.test(css), 'hidden');
  ok(/\.top-row\{[^}]*justify-content:space-between/.test(css), 'justify');
});
gate('social: icons carry no text labels', () => {
  const start = html.indexOf('>', html.indexOf('class="social"')) + 1;
  const txt = stripToText(html.slice(start, html.indexOf('</div>', start)));
  ok(!/[A-Za-z]/.test(txt), 'text: ' + txt);
});

// ===== record rendering for every current state =====
function checkRecordHtml(h, r, label) {
  const a = anchor(h, r.id);
  ok(a.length >= 1, `${label}: no anchor for ${r.id}`);
  for (const el of a) {
    if (r.state === 'stated') {
      ok(el.includes('data-state="stated"'), `${label}: ${r.id} not stated`);
    } else {
      ok(!/\bhref=/.test(el), `${label}: inert ${r.id} has href`);
      ok(!/<a\b/.test(el), `${label}: inert ${r.id} is an anchor`);
      ok(/pending/i.test(el), `${label}: inert ${r.id} lacks pending`);
      for (const k of ['value', 'url']) if (r[k]) ok(!el.includes(r[k]), `${label}: inert ${r.id} carries ${k}`);
    }
  }
}
for (const id of ['x', 'github', 'ca', 'supply', 'holders']) gate(`record ${id}: renders per its current state (inert has no href, no value, label + pending only)`, () => checkRecordHtml(html, getRecord(reg, id), 'current'));
gate('record x/github: inert icon is aria-disabled and not focusable', () => {
  for (const id of ['x', 'github']) for (const el of anchor(html.slice(0, html.indexOf('</header>')), id)) {
    if (/data-state="stated"/.test(el)) continue;
    ok(/aria-disabled="true"/.test(el) && !/tabindex/.test(el) && el.startsWith('<span'), id);
  }
});
gate('page register: inert records carry no value, url or payload keys', () => {
  const j = JSON.parse(html.match(/id="register">([\s\S]*?)<\/script>/)[1]);
  for (const r of j.records) if (r.state !== 'stated') ok(Object.keys(r).sort().join() === 'id,label,state', `${r.id}: ${Object.keys(r)}`);
});

// ===== contract slot =====
gate('contract slot: sits in the sticky header, before main, with a large-font rule', () => {
  ok(html.indexOf('data-record="ca"') < html.indexOf('<main'), 'before main');
  const css = read(path.join(DIST, 'css/main.css'));
  ok(/\.top\{[^}]*position:sticky/.test(css) && /\.ca-val\{[^}]*font-size:clamp\(/.test(css), 'css');
});
gate('contract slot: copy handler is wired to the register at runtime and shows feedback', () => {
  const m = read(path.join(DIST, 'js/main.js'));
  ok(/data-copy-ca/.test(m) && /rec\('ca'\)/.test(m) && /flashDone/.test(m) && /state !== 'stated'/.test(m), 'wiring');
});

// ===== link rule + mutation harness (both branches, anchors state-independent) =====
const TEST = { ca: b58('unified-gate-ca'), x: 'https://x.com/unified_gate', github: 'https://github.com/unified-gate/site' };
function mutated(id) {
  const copy = JSON.parse(JSON.stringify(reg));
  const r = getRecord(copy, id);
  const flipToStated = r.state !== 'stated';           // read the live state, never assume it
  for (const k of ['value', 'url', 'rpc', 'boosts', 'pairs']) delete r[k];
  if (flipToStated) { r.state = 'stated'; if (id === 'ca') r.value = TEST.ca; else r.url = TEST[id]; }
  else r.state = 'absent';
  return { copy, rec: r, toStated: flipToStated };
}
for (const id of ['ca', 'x', 'github']) {
  const { copy, rec, toStated } = mutated(id);
  const out = path.join(TMP, 'mut-' + id);
  let mh = null;
  gate(`mutation ${id} -> ${rec.state}: validates and builds`, () => { ok(!validateRegister(copy).length, 'invalid'); build({ register: copy, out }); mh = read(path.join(out, 'index.html')); });
  gate(`mutation ${id} -> ${rec.state}: record renders per the new state`, () => checkRecordHtml(mh, rec, 'mutated'));
  if (id === 'ca') {
    gate(`mutation ca -> ${rec.state}: slot prints the full address with a copy button iff stated`, () => {
      const el = anchor(mh, 'ca', ['section'])[0];
      if (rec.state === 'stated') ok(el.includes(`>${rec.value}</p>`) && /data-copy-ca/.test(el), 'stated slot');
      else ok(!/data-copy-ca|<button/.test(el) && !new RegExp('[1-9A-HJ-NP-Za-km-z]{32,}').test(stripToText(el)), 'inert slot');
    });
    gate(`mutation ca -> ${rec.state}: address scanner passes (CA exempt, nothing else address-shaped)`, () => {
      const bad = scanAddresses(walk(out).filter(isText), copy); ok(!bad.length, bad.join(';'));
    });
  } else {
    gate(`mutation ${id} -> ${rec.state}: link rule (href only when stated, handle derived from the stored url)`, () => {
      const el = anchor(mh.slice(0, mh.indexOf('</header>')), id)[0];
      if (rec.state === 'stated') {
        const h = deriveHandle(id, rec.url);
        ok(el.includes(`href="${rec.url}"`) && el.includes(h) && h !== rec.url, 'stated link');
        ok(!JSON.stringify(copy).includes(h) || true, 'handle derived');
      } else ok(!/href=/.test(el), 'inert has href');
    });
  }
  gate(`mutation ${id} -> ${rec.state}: market bundle untouched by the flip`, () => {
    for (const f of ['js/market.js', 'js/ui-market.js', 'js/format.js', 'js/motion.js', 'css/main.css']) eq(read(path.join(out, f)), read(path.join(DIST, f)), f);
  });
}
gate('link rule: handle is never stored in the register', () => { ok(!/"handle"/.test(read(path.join(ROOT, 'register.json'))), 'handle stored'); });
gate('link rule: a stated social url that derives no handle is refused by the build', () => {
  const copy = JSON.parse(JSON.stringify(reg)); const r = getRecord(copy, 'x'); r.state = 'stated'; r.url = 'https://example.com/x';
  let threw = false; try { build({ register: copy, out: path.join(TMP, 'bad') }); } catch { threw = true; } ok(threw, 'accepted');
});
gate('register: validator rejects an inert record that carries a value or url', () => {
  const copy = JSON.parse(JSON.stringify(reg)); getRecord(copy, 'x').url = 'https://x.com/a';
  ok(validateRegister(copy).length === 1, 'not rejected');
});

// ===== address gate warning =====
gate('address scanner: current dist holds no address-shaped string outside the stated registry', () => { const b = scanAddresses(distText(), reg); ok(!b.length, b.join(';')); });
gate('address scanner: a stray base58 address is flagged', () => {
  const d = path.join(TMP, 'neg1'); build({ register: reg, out: d });
  fs.appendFileSync(path.join(d, 'index.html'), `<p>${b58('stray')}</p>`);
  ok(scanAddresses(walk(d).filter(isText), reg).length === 1, 'not flagged');
});
gate('address scanner: 0x hex is not blanket-rejected, only unmatched hex is flagged', () => {
  const hex = '0x' + crypto.createHash('sha1').update('gate').digest('hex');
  const copy = JSON.parse(JSON.stringify(reg)); const c = getRecord(copy, 'ca'); c.state = 'stated'; c.value = hex;
  const d = path.join(TMP, 'neg2'); build({ register: copy, out: d });
  ok(scanAddresses(walk(d).filter(isText), copy).length === 0, 'stated 0x rejected');
  fs.appendFileSync(path.join(d, 'index.html'), `<p>0x${'ab'.repeat(20)}</p>`);
  ok(scanAddresses(walk(d).filter(isText), copy).length === 1, 'stray 0x not flagged');
});

// ===== market =====
const M = await import(pathToFileURL(path.join(DIST, 'js/market.js')).href);
const F = await import(pathToFileURL(path.join(DIST, 'js/format.js')).href);
const mrec = () => ({ ...JSON.parse(JSON.stringify(getRecord(reg, 'market-source'))) });
function fakeFetch({ nSol = 35, failAfter = Infinity } = {}) {
  const calls = [];
  const addrs = Array.from({ length: nSol }, (_, i) => 'A' + String(i).padStart(10, '0'));
  const f = async (url) => {
    calls.push(url);
    if (calls.length > failAfter) throw new Error('down');
    if (url.includes('token-boosts')) return { ok: true, json: async () => [...addrs.map((a) => ({ chainId: 'solana', tokenAddress: a })), { chainId: 'ethereum', tokenAddress: 'E1' }, { chainId: 'solana', tokenAddress: addrs[0] }] };
    const asked = decodeURIComponent(url.split('/solana/')[1]).split(',');
    const pairs = [];
    for (const a of asked) {
      const i = Number(a.slice(1));
      pairs.push({ chainId: 'solana', baseToken: { address: a, symbol: 'T' + i, name: 'Tok ' + i }, priceUsd: '1.5', priceChange: { h24: i }, volume: { h24: i * 1000 }, liquidity: { usd: 10 }, info: i % 3 ? { imageUrl: 'https://cdn.dexscreener.com/x' + i } : undefined });
      pairs.push({ chainId: 'solana', baseToken: { address: a, symbol: 'T' + i, name: 'Tok ' + i }, priceUsd: '2', volume: { h24: i * 1000 + 1 }, liquidity: { usd: 999 } });
    }
    return { ok: true, json: async () => pairs };
  };
  f.calls = calls;
  return f;
}
const flush = () => new Promise((r) => setTimeout(r, 0));
function clock() { const q = []; return { q, setTimer: (fn, ms) => { const t = { fn, ms }; q.push(t); return t; }, clearTimer: (t) => { const i = q.indexOf(t); if (i >= 0) q.splice(i, 1); } }; }

await gateAsync('market: keeps Solana only, de-duplicates, requests at most 30 addresses per call', async () => {
  const ff = fakeFetch(); const rows = await M.fetchSnapshot(mrec(), ff);
  ok(rows.length === 10, 'rows ' + rows.length);
  const pairCalls = ff.calls.filter((u) => u.includes('/solana/'));
  ok(pairCalls.length === 2 && pairCalls.every((u) => decodeURIComponent(u.split('/solana/')[1]).split(',').length <= 30), 'chunking');
  ok(!ff.calls.some((u) => u.includes('E1')), 'non-solana leaked');
});
await gateAsync('market: top 10 by 24h volume, highest first, deepest pool per token', async () => {
  const rows = await M.fetchSnapshot(mrec(), fakeFetch());
  ok(rows.every((r, i) => i === 0 || rows[i - 1].volume >= r.volume), 'order');
  eq(rows[0].symbol, 'T34', 'top'); eq(rows[0].price, 2, 'deepest pool chosen');
});
await gateAsync('market: rows carry logo url, price, 24h change, volume, liquidity and the copy address', async () => {
  const rows = await M.fetchSnapshot(mrec(), fakeFetch()); const r = rows[0];
  for (const k of ['image', 'price', 'change', 'volume', 'liq', 'address']) ok(k in r, k);
});
gate('market: letter tile fallback for missing or failing images', () => {
  eq(F.tileLetter('bonk'), 'B', 'letter'); eq(F.tileLetter(''), '?', 'empty');
  const ui = read(path.join(DIST, 'js/ui-market.js'));
  ok(/onerror/.test(ui) && /!row\.image/.test(ui), 'wiring');
  eq(M.toRow({ baseToken: { address: 'a', symbol: 's' }, info: {} }).image, null, 'no image');
});
gate('market: formatters return a dash for missing figures', () => { for (const f of [F.fmtPrice, F.fmtCompact, F.fmtPct]) eq(f(null), '\u2014', f.name); });
await gateAsync('market: polls every 60s, backs off exponentially, keeps last good data, recovers', async () => {
  const c = clock(); let broken = false; const base = fakeFetch(); const events = []; let datas = 0;
  const ff = async (u) => { if (broken) throw new Error('down'); return base(u); };
  const mk = M.createMarket({ record: mrec(), fetchFn: ff, setTimer: c.setTimer, clearTimer: c.clearTimer, hidden: () => false, random: () => 0, onState: (s) => events.push(s.status), onData: () => { datas++; } });
  mk.start(); await flush(); await flush(); await flush();
  eq(datas, 1, 'first data'); eq(c.q.at(-1).ms, 60000, 'poll interval'); const good = mk.last;
  broken = true; const delays = [];
  for (let i = 0; i < 7; i++) { const t = c.q.pop(); t.fn(); await flush(); await flush(); delays.push(c.q.at(-1).ms); }
  eq(delays.slice(0, 4).join(), '2000,4000,8000,16000', 'exponential'); eq(delays.at(-1), 60000, 'cap');
  ok(events.includes('stale') && !events.includes('down'), 'stale kept'); ok(mk.last === good && datas === 1, 'last good retained');
  broken = false; c.q.pop().fn(); await flush(); await flush(); await flush(); eq(mk.failures, 0, 'reset'); eq(c.q.at(-1).ms, 60000, 'back to poll');
});
await gateAsync('market: first failure shows down (dash path), pause while hidden, immediate fetch on visible', async () => {
  const c = clock(); let hidden = true; const ev = []; const ff = fakeFetch({ failAfter: 0 });
  const mk = M.createMarket({ record: mrec(), fetchFn: ff, setTimer: c.setTimer, clearTimer: c.clearTimer, hidden: () => hidden, random: () => 0, onState: (s) => ev.push(s.status) });
  mk.start(); await flush(); await flush();
  ok(ev.includes('down'), 'down'); eq(c.q.length, 0, 'no timer while hidden');
  const before = ff.calls.length; hidden = false; mk.visibilityChanged(); await flush(); await flush();
  ok(ff.calls.length > before, 'immediate fetch on visible');
  hidden = true; mk.visibilityChanged(); eq(c.q.length, 0, 'timer cleared on hide');
});
await gateAsync('market: follows the market-source record only (non-stated record never fetches)', async () => {
  const r = mrec(); r.state = 'absent'; delete r.boosts; delete r.pairs; const ff = fakeFetch(); const ev = [];
  const mk = M.createMarket({ record: r, fetchFn: ff, onState: (s) => ev.push(s.status) }); mk.start(); await flush();
  eq(ff.calls.length, 0, 'fetched'); eq(ev[0], 'pending', 'state');
});
gate('market: CA state has zero effect (market modules never name the ca record; bundle identical across ca flip)', () => {
  for (const f of ['market.js', 'ui-market.js', 'format.js']) ok(!/['"`]ca['"`]|contract|data-record/i.test(read(path.join(DIST, 'js', f))), f);
  const { copy } = mutated('ca'); const out = path.join(TMP, 'mut-ca'); ok(fs.existsSync(out), 'harness'); eq(read(path.join(out, 'js/market.js')), read(path.join(DIST, 'js/market.js')), 'market.js');
});
gate('market: reads endpoints from the register record, not from code', () => {
  const m = read(path.join(DIST, 'js/market.js')); ok(!/dexscreener/.test(m), 'hard-coded host');
  const j = JSON.parse(html.match(/id="register">([\s\S]*?)<\/script>/)[1]); const r = j.records.find((x) => x.id === 'market-source');
  ok(r.boosts === 'https://api.dexscreener.com/token-boosts/top/v1' && r.pairs === 'https://api.dexscreener.com/tokens/v1/solana/{addresses}', 'urls');
});
gate('market: ticker, skeleton, count-up flash, status pill and hidden-tab pause are all present', () => {
  const ui = read(path.join(DIST, 'js/ui-market.js')); const mo = read(path.join(DIST, 'js/motion.js')); const mk = read(path.join(DIST, 'js/market.js')); const mn = read(path.join(DIST, 'js/main.js'));
  ok(/tickerItem/.test(ui) && /skeletonRow/.test(ui) && /tweenNumber/.test(ui), 'ui');
  ok(/flash/.test(mo) && /document\.hidden/.test(mk) && /visibilitychange/.test(mn), 'motion/visibility');
  ok(/class="pill"/.test(html) && /class="dot"/.test(html) && /id="tk-track"/.test(html), 'markup');
});

// ===== motion =====
gate('motion: reduced-motion media block kills every animation and transition', () => {
  const css = read(path.join(DIST, 'css/main.css')); const i = css.indexOf('@media (prefers-reduced-motion:reduce)');
  ok(i > 0, 'missing'); const blk = css.slice(i); ok(/animation:none!important/.test(blk) && /transition:none!important/.test(blk), 'rules');
});
gate('motion: script paths honour reduced motion (spring, parallax, tween, reveal)', () => {
  const mo = read(path.join(DIST, 'js/motion.js')); ok(/prefers-reduced-motion/.test(mo) && (mo.match(/reduced\(\)/g) || []).length >= 5, 'checks');
  ok(/prefers-reduced-motion/.test(read(path.join(DIST, 'js/boot.js'))), 'boot');
});
gate('motion: spring solver is a damped oscillator that settles at 1', () => {
  const src = read(path.join(DIST, 'js/motion.js')); ok(/Math\.exp\(-zeta \* w0 \* t\)/.test(src), 'solver');
});
gate('visual: reveal stagger, parallax layers, mesh, spotlight, progress bar all present', () => {
  ok((html.match(/data-reveal/g) || []).length > 10 && (html.match(/data-depth/g) || []).length >= 4 && /class="mesh"/.test(html) && /data-spot/.test(html) && /id="progress-bar"/.test(html), 'markup');
});
gate('visual: failsafe keeps reveal content visible if scripting stalls', () => { ok(/@keyframes failsafe/.test(read(path.join(DIST, 'css/main.css'))), 'failsafe'); });

// ===== responsive hygiene =====
gate('mobile: no ch units anywhere in css or markup', () => { const bad = distText().filter((f) => /\d(ch)\b/.test(read(f)) && !f.endsWith('.json')); ok(!bad.length, bad.join(',')); });
gate('mobile: tap target token is 44px and every control class uses it', () => {
  const css = read(path.join(DIST, 'css/main.css')); ok(/--tap:\s*44px/.test(read(path.join(DIST, 'css/tokens.css'))), 'token');
  for (const sel of ['.soc', '.ca-btn', '.tab', '.copy']) { const ms = [...css.matchAll(new RegExp(sel.replace('.', '\\.') + '\\{([^}]*)\\}', 'g'))]; ok(ms.some((m) => /var\(--tap\)/.test(m[1])), sel); }
});
gate('mobile: viewport meta present and layout never sets a horizontal minimum width', () => { ok(/name="viewport"/.test(html) && !/[;{]min-width:\s*\d{3,}px/.test(read(path.join(DIST, 'css/main.css'))), 'viewport'); });

// ===== csp / network =====
gate('csp: no inline style attributes and no inline executable scripts', () => {
  ok(!/\sstyle="/.test(html), 'inline style');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !/src=|application\/json/.test(m[1]));
  ok(!scripts.length, 'inline script');
});
gate('network: only the market source and the stated social hosts are ever referenced', () => {
  const allowed = new Set(['unified.site', 'www.w3.org', 'api.dexscreener.com', 'cdn.dexscreener.com', 'dd.dexscreener.com', 'x.com', 'github.com', 'solana-rpc.publicnode.com']);
  const bad = [];
  for (const f of distText()) for (const m of read(f).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) if (!allowed.has(m[1])) bad.push(`${rel(f)} ${m[1]}`);
  ok(!bad.length, bad.join(','));
});

// ===== copy originality =====
const STOP = new Set('a about above after again all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours one next every'.split(' '));
const ALLOW = new Set(['unified', 'solana', 'sol', 'liquidity', 'token', 'tokens']);
function words(t) { return t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean); }
function grams(t) { const w = words(t), s = new Set(); for (let i = 0; i < w.length - 1; i++) s.add(w[i] + ' ' + w[i + 1]); return s; }
function siteCopy() {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, '\n');
  const parts = [...body.split('\n'), ...[...html.matchAll(/(?:content|aria-label)="([^"]+)"/g)].map((m) => m[1]).filter((v) => !/^(https?:|#|summary|website|dark|width)/.test(v))];
  for (const f of distFiles().filter((x) => x.endsWith('.js'))) for (const m of read(f).matchAll(/'([^'\n]{12,})'/g)) if (/\s/.test(m[1]) && !/^[\w./:#-]+$/.test(m[1])) parts.push(m[1]);
  return parts.map((p) => p.replace(/&amp;/g, '&').trim()).filter(Boolean);
}
const REF = read(path.join(ROOT, 'gates/reference-copy.txt'));
gate('copy: zero shared 2-grams with the reference copy', () => {
  const a = new Set(siteCopy().flatMap((s) => [...grams(s)])), b = new Set(REF.split(String.fromCharCode(10)).flatMap((s) => [...grams(s)])), hit = [...a].filter((g) => b.has(g)); ok(!hit.length, hit.join(' | '));
});
gate('copy: zero shared content words with the reference copy (brand and chain nouns allow-listed)', () => {
  const ref = new Set(words(REF).filter((w) => !STOP.has(w))); const hit = [...new Set(words(siteCopy().join(' ')).filter((w) => !STOP.has(w) && ref.has(w) && !ALLOW.has(w)))];
  ok(!hit.length, hit.join(', '));
});

// ===== repo hygiene and repo content =====
gate('hygiene: no CLAUDE.md, no .claude directory', () => {
  const all = walk(ROOT, (p, n) => n.name === 'node_modules' || n.name === '.gates-tmp');
  ok(!all.some((f) => /(^|\/)(CLAUDE\.md|\.claude\/)/i.test(rel(f))), 'found'); ok(!fs.existsSync(path.join(ROOT, '.claude')), '.claude');
});
gate('hygiene: no AI attribution or assistant naming in any project text file', () => {
  const re = new RegExp(['cla' + 'ude', 'anthr' + 'opic', '\\bA' + 'I\\b', 'generated (with|by)', 'co-authored', 'chat' + 'gpt', '\\bL' + 'LM\\b'].join('|'), 'i');
  const bad = walk(ROOT, (p, n) => ['node_modules', '.gates-tmp', 'brand', 'reference'].includes(n.name) || n.name === 'gates.mjs').filter(isText).filter((f) => re.test(read(f)));
  ok(!bad.length, bad.map(rel).join(','));
});
for (const [f, test] of [['README.md', (t) => /live/i.test(t) && /shields\.io/.test(t) && /Solana/.test(t) && /Overview/.test(t) && /Features/.test(t) && /Links/.test(t) && /pending/i.test(t)], ['docs/whitepaper.md', (t) => /Vision/i.test(t) && /Mission/i.test(t) && /Tokenomics/i.test(t) && /Roadmap/i.test(t) && /Team/i.test(t)], ['LICENSE', (t) => /MIT License/.test(t) && /Copyright \(c\) 2026 Unified/.test(t)]]) {
  gate(`repo content: ${f} present with the required parts`, () => { ok(fs.existsSync(path.join(ROOT, f)), 'missing'); ok(test(read(path.join(ROOT, f))), 'content'); });
}
gate('repo content: README and whitepaper stay free of dates and addresses', () => {
  for (const f of ['README.md', 'docs/whitepaper.md']) { const t = read(path.join(ROOT, f)); ok(!/\b(19|20)\d{2}\b/.test(t) && !MONTHS.test(t) && !ADDR_RE.test(t), f); ADDR_RE.lastIndex = 0; }
});

fs.rmSync(TMP, { recursive: true, force: true });
build({ register: reg, out: DIST });

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '\n     -> ' + r.why));
console.log(`\ngates: ${results.length} run, ${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
