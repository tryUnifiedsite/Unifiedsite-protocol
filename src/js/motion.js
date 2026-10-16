// Motion toolkit: damped-spring solver, staggered reveal, parallax, spotlight,
// scroll progress and number tweening. Every path has an instant fallback.

const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => mq.matches;

// Closed-form solution of a damped harmonic oscillator going 0 -> 1.
export function spring({ stiffness = 170, damping = 20, mass = 1 } = {}) {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  let at;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    at = (t) => 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  } else {
    at = (t) => 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  }
  // time until the envelope is within 0.2% of rest
  const settle = Math.min(3, -Math.log(0.002) / Math.max(0.5, zeta * w0));
  return { at, settle };
}

export function runSpring(cfg, step, done) {
  if (reduced()) { step(1); if (done) done(); return; }
  const s = spring(cfg);
  const t0 = performance.now();
  function frame(now) {
    const t = (now - t0) / 1000;
    if (t >= s.settle) { step(1); if (done) done(); return; }
    step(s.at(t));
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

export function enter(el, delayMs = 0, dy = 26) {
  if (reduced()) { el.classList.add('in'); el.style.opacity = '1'; return; }
  el.style.opacity = '0';
  el.style.transform = 'translate3d(0,' + dy + 'px,0)';
  setTimeout(() => {
    runSpring({ stiffness: 150, damping: 17 }, (p) => {
      el.style.opacity = String(Math.max(0, Math.min(1, p * 1.5)));
      el.style.transform = 'translate3d(0,' + (dy * (1 - p)).toFixed(2) + 'px,0)';
    }, () => {
      el.classList.add('in');
      el.style.opacity = '1';
      el.style.transform = '';
    });
  }, delayMs);
}

export function initReveal() {
  const els = [...document.querySelectorAll('[data-reveal]')];
  if (reduced() || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => {
    const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    hit.forEach((e, i) => { io.unobserve(e.target); enter(e.target, i * 80); });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  els.forEach((e) => io.observe(e));
}

export function initProgress(bar) {
  let queued = false;
  function paint() {
    queued = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
    bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
  }
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(paint); } }, { passive: true });
  addEventListener('resize', paint);
  paint();
}

export function initSpotlight() {
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest && e.target.closest('[data-spot]');
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', (e.clientX - r.left).toFixed(1) + 'px');
    t.style.setProperty('--my', (e.clientY - r.top).toFixed(1) + 'px');
  }, { passive: true });
}

export function initParallax(root, hero) {
  const layers = [...root.querySelectorAll('[data-depth]')].map((el) => ({ el, d: Number(el.dataset.depth) || 0 }));
  if (!layers.length) return;
  const tgt = { x: 0, y: 0, s: 0 };
  const cur = { x: 0, y: 0, s: 0 };
  let running = false;
  let last = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    const k = 1 - Math.exp(-dt * 9); // frame-rate independent critical smoothing
    cur.x += (tgt.x - cur.x) * k;
    cur.y += (tgt.y - cur.y) * k;
    cur.s += (tgt.s - cur.s) * k;
    for (const l of layers) {
      const x = cur.x * l.d * 22;
      const y = cur.y * l.d * 16 - cur.s * l.d * 0.1;
      l.el.style.transform = 'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,0)';
    }
    const settled = Math.abs(tgt.x - cur.x) + Math.abs(tgt.y - cur.y) + Math.abs(tgt.s - cur.s) < 0.002;
    if (settled) { running = false; return; }
    requestAnimationFrame(frame);
  }
  const kick = () => { if (!running && !reduced()) { running = true; last = performance.now(); requestAnimationFrame(frame); } };
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    tgt.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
    tgt.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
    kick();
  }, { passive: true });
  hero.addEventListener('pointerleave', () => { tgt.x = 0; tgt.y = 0; kick(); });
  addEventListener('scroll', () => {
    const r = hero.getBoundingClientRect();
    tgt.s = Math.max(-200, Math.min(600, -r.top));
    kick();
  }, { passive: true });
}

// Tween the text of an element. Flash on change after the first paint.
export function tweenNumber(el, to, fmt, { first = false } = {}) {
  const prev = el._v;
  el._v = to;
  if (to === null || to === undefined) { cancel(el); el.textContent = '—'; return; }
  if (prev === to) return;
  const from = prev === undefined || prev === null ? 0 : prev;
  if (reduced()) { cancel(el); el.textContent = fmt(to); return; }
  if (!first && prev !== undefined && prev !== null) {
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }
  cancel(el);
  const t0 = performance.now();
  const dur = first ? 900 : 650;
  function frame(now) {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 4);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) el._raf = requestAnimationFrame(frame); else el.textContent = fmt(to);
  }
  el._raf = requestAnimationFrame(frame);
}
function cancel(el) { if (el._raf) cancelAnimationFrame(el._raf); el._raf = 0; }
