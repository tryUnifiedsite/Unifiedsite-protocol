import { fmtPrice, fmtCompact, fmtPct, tileLetter } from './format.js';
import { enter, tweenNumber, reduced } from './motion.js';
import { copyText, flashDone } from './copy.js';

const COPY_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2.5"/><path d="M13 7V5.5A2.5 2.5 0 0 0 10.5 3h-5A2.5 2.5 0 0 0 3 5.5v5A2.5 2.5 0 0 0 5.5 13H7"/></svg>';
const DASH = '—';
const SLOTS = 10;

const STATUS = {
  pending: ['wait', 'Feed pending'],
  loading: ['wait', 'Connecting'],
  syncing: ['live', 'Syncing'],
  live: ['live', 'Feed live'],
  stale: ['stale', 'Holding last data'],
  down: ['down', 'Feed offline'],
};

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function cell(key, label) {
  const c = el('div', 'cell');
  c.dataset.k = key;
  c.append(el('span', 'lbl', label), el('span', 'num'));
  return c;
}

function logoNode(row) {
  const box = el('span', 'logo');
  const letter = () => { box.textContent = tileLetter(row.symbol); };
  if (!row.image) { letter(); return box; }
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.onerror = () => { img.remove(); letter(); };
  img.src = row.image;
  box.append(img);
  return box;
}

function makeRow(row, i) {
  const r = el('div', 'row');
  r.setAttribute('role', 'row');
  r.dataset.spot = '';
  r.dataset.addr = row.address;
  const rk = el('span', 'rk', String(i + 1));
  const tok = el('div', 'tok');
  const nm = el('span', 'nm');
  nm.append(el('b', '', row.symbol), el('i', '', row.name));
  tok.append(logoNode(row), nm);
  const btn = el('button', 'copy');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Copy address for ' + row.symbol);
  btn.insertAdjacentHTML('beforeend', COPY_ICON);
  btn.addEventListener('click', async () => {
    const ok = await copyText(row.address);
    flashDone(btn, ok);
    document.getElementById('announce').textContent = ok ? 'Address copied for ' + row.symbol : 'Copy failed';
  });
  r.append(rk, tok, cell('price', 'Price'), cell('change', '24h'), cell('volume', 'Volume'), cell('liq', 'Depth'), btn);
  return r;
}

function fill(r, row, i, first) {
  r.querySelector('.rk').textContent = String(i + 1);
  const set = (k, v, f) => tweenNumber(r.querySelector('[data-k="' + k + '"] .num'), v, f, { first });
  set('price', row.price, fmtPrice);
  set('volume', row.volume, fmtCompact);
  set('liq', row.liq, fmtCompact);
  set('change', row.change, fmtPct);
  const ch = r.querySelector('[data-k="change"] .num');
  ch.classList.add('chg');
  ch.classList.toggle('dn', row.change !== null && row.change < 0);
}

function skeletonRow() {
  const r = el('div', 'row');
  r.setAttribute('aria-hidden', 'true');
  const tok = el('div', 'tok');
  const nm = el('span', 'nm');
  const a = el('span', 'sk w2'); const b = el('span', 'sk w1'); b.style.marginTop = '6px';
  nm.append(a, b);
  tok.append(el('span', 'sk round'), nm);
  const mk = (k, w) => { const c = el('div', 'cell'); c.dataset.k = k; c.append(el('span', 'sk ' + w)); return c; };
  r.append(el('span', 'rk', ''), tok, mk('price', 'w1'), mk('change', 'w2'), mk('volume', 'w3'), mk('liq', 'w3'), el('span'));
  return r;
}

function dashRow() {
  const r = el('div', 'row');
  const tok = el('div', 'tok');
  tok.append(el('span', 'logo', DASH), el('span', 'nm'));
  tok.querySelector('.nm').append(el('b', '', DASH));
  const mk = (k) => { const c = el('div', 'cell'); c.dataset.k = k; c.append(el('span', 'lbl', k === 'liq' ? 'Depth' : k === 'change' ? '24h' : k[0].toUpperCase() + k.slice(1)), el('span', 'num dash', DASH)); return c; };
  r.append(el('span', 'rk', DASH), tok, mk('price'), mk('change'), mk('volume'), mk('liq'), el('span'));
  return r;
}

function tickerItem(row) {
  const t = el('span', 'tk');
  const ch = el('span', 'c' + (row.change !== null && row.change < 0 ? ' dn' : ''), fmtPct(row.change));
  t.append(el('b', '', row.symbol), el('span', 'px', fmtPrice(row.price)), ch);
  return t;
}

export function initMarket({ rowsEl, boardEl, tkA, tkB, pill, pillText, msg }) {
  const live = new Map();
  let shown = false;
  let skeleton = true;

  function tickerSkeleton() {
    for (const g of [tkA, tkB]) {
      g.textContent = '';
      for (let i = 0; i < 8; i++) { const t = el('span', 'tk'); t.append(el('span', 'sk')); g.append(t); }
    }
  }
  function showSkeleton() {
    rowsEl.textContent = '';
    for (let i = 0; i < SLOTS; i++) rowsEl.append(skeletonRow());
    tickerSkeleton();
    skeleton = true;
  }
  showSkeleton();

  function renderTicker(rows) {
    for (const g of [tkA, tkB]) {
      g.textContent = '';
      for (const r of rows) g.append(tickerItem(r));
    }
  }

  function onData(rows) {
    const first = !shown;
    if (skeleton) { rowsEl.textContent = ''; skeleton = false; live.clear(); }
    const keep = new Set(rows.map((r) => r.address));
    for (const [a, node] of live) if (!keep.has(a)) { node.remove(); live.delete(a); }
    rows.forEach((row, i) => {
      let node = live.get(row.address);
      const isNew = !node;
      if (isNew) { node = makeRow(row, i); live.set(row.address, node); }
      fill(node, row, i, isNew);
      if (rowsEl.children[i] !== node) rowsEl.insertBefore(node, rowsEl.children[i] || null);
      if (isNew) enter(node, first ? i * 70 : 0, 18);
    });
    renderTicker(rows);
    shown = true;
  }

  function onState(s) {
    const [d, text] = STATUS[s.status] || STATUS.loading;
    pill.dataset.s = d;
    pill.dataset.err = s.error || '';
    pillText.textContent = text;
    if (s.status === 'down' && !shown) {
      rowsEl.textContent = '';
      for (let i = 0; i < SLOTS; i++) rowsEl.append(dashRow());
      for (const g of [tkA, tkB]) { g.textContent = ''; const t = el('span', 'tk'); t.append(el('span', 'c', DASH + ' no data')); g.append(t); }
      skeleton = true; // placeholders are replaced on the first good data
    }
    if (s.status === 'down') msg.textContent = 'Source unreachable. Figures show a dash and the request is retried with growing pauses.';
    else if (s.status === 'stale') msg.textContent = 'Latest refresh failed. Showing the last good figures while retrying.';
    else if (s.status === 'pending') msg.textContent = 'The market feed is waiting on its source record.';
    else if (s.status === 'live') msg.textContent = '';
  }

  return { onData, onState, reduced };
}
