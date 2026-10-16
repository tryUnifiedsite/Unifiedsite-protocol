(() => {
  const vw = innerWidth, de = document.documentElement;
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'; };
  const targets = [...document.querySelectorAll('a[href],button,[role=tab],.soc')].filter(vis);
  const small = targets.map((e) => { const r = e.getBoundingClientRect(); return { el: (e.className || e.tagName) + '|' + (e.getAttribute('aria-label') || e.textContent.trim().slice(0, 14)), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((t) => t.w < 44 || t.h < 44);
  const over = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > vw + 1 || r.left < -1) && !e.closest('.mesh,.ticker,.art,.grid-lines'); }).slice(0, 6).map((e) => e.className || e.tagName);
  const top = document.querySelector('.top').getBoundingClientRect();
  const soc = [...document.querySelectorAll('.soc')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.right), Math.round(r.top), Math.round(r.width)]; });
  const ca = document.querySelector('.ca-val');
  return JSON.stringify({ vw, docW: de.scrollWidth, overflowX: de.scrollWidth > vw, over, headerH: Math.round(top.height), headerTop: Math.round(top.top), soc, caFont: getComputedStyle(ca).fontSize, caH: Math.round(ca.getBoundingClientRect().height), smallTargets: small, h1: getComputedStyle(document.querySelector('h1')).fontSize, rows: document.querySelectorAll('#rows .row').length });
})()
