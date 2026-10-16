import { createMarket } from './market.js';
import { initMarket } from './ui-market.js';
import { initReveal, initProgress, initSpotlight, initParallax } from './motion.js';
import { copyText, flashDone } from './copy.js';

const register = JSON.parse(document.getElementById('register').textContent);
const rec = (id) => register.records.find((r) => r.id === id);

initProgress(document.getElementById('progress-bar'));
initReveal();
initSpotlight();
initParallax(document.getElementById('art'), document.querySelector('.hero'));

// Contract slot: the button exists only when the record is stated.
const caBtn = document.querySelector('[data-copy-ca]');
if (caBtn) {
  caBtn.addEventListener('click', async () => {
    const ca = rec('ca');
    if (!ca || ca.state !== 'stated' || !ca.value) return;
    const ok = await copyText(ca.value);
    flashDone(caBtn, ok, ['Copy', 'Copied']);
    document.getElementById('announce').textContent = ok ? 'Contract address copied' : 'Copy failed';
  });
}

// Tabs
const board = document.getElementById('board');
const tabs = [...document.querySelectorAll('.tab')];
function pick(tab) {
  tabs.forEach((t) => { const on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
  board.classList.toggle('tiles-view', tab.dataset.view === 'tiles');
  board.setAttribute('aria-labelledby', tab.id);
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => pick(t));
  t.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    const n = tabs[(i + d + tabs.length) % tabs.length];
    pick(n); n.focus(); e.preventDefault();
  });
});

// Market follows the market-source record and nothing else.
const ui = initMarket({
  rowsEl: document.getElementById('rows'),
  boardEl: board,
  tkA: document.getElementById('tk-a'),
  tkB: document.getElementById('tk-b'),
  pill: document.getElementById('status-pill'),
  pillText: document.getElementById('status-text'),
  msg: document.getElementById('mk-msg'),
});
const market = createMarket({ record: rec('market-source'), onData: ui.onData, onState: ui.onState });
document.addEventListener('visibilitychange', () => market.visibilityChanged());
market.start();
