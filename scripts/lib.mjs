import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STATES = ['stated', 'absent', 'unconfirmed'];
export const PAYLOAD_KEYS = ['value', 'url', 'rpc', 'boosts', 'pairs'];
export const DATA_ONLY_KEYS = ['checked'];

export const X_MARK = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
export const GITHUB_MARK = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

export function getRecord(reg, id) { return reg.records.find((r) => r.id === id); }

export function validateRegister(reg) {
  const problems = [];
  const seen = new Set();
  for (const r of reg.records) {
    if (seen.has(r.id)) problems.push(`duplicate id ${r.id}`);
    seen.add(r.id);
    if (!STATES.includes(r.state)) problems.push(`${r.id}: bad state ${r.state}`);
    const payload = PAYLOAD_KEYS.filter((k) => r[k] !== undefined);
    if (r.state === 'stated' && payload.length === 0) problems.push(`${r.id}: stated without a value or url`);
    if (r.state !== 'stated' && payload.length) problems.push(`${r.id}: inert record carries ${payload.join(',')}`);
  }
  return problems;
}

// Link rule: only the URL is stored; the handle is always derived.
export function deriveHandle(id, url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\./, '');
  const parts = u.pathname.split('/').filter(Boolean);
  if (id === 'x' && (host === 'x.com' || host === 'twitter.com') && parts[0]) return '@' + parts[0];
  if (id === 'github' && host === 'github.com' && parts[0]) return parts.slice(0, 2).join('/');
  return null;
}

export function readTokens(cssPath) {
  const css = fs.readFileSync(cssPath, 'utf8');
  const out = {};
  for (const m of css.matchAll(/--([a-z]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

// Registers go to the page without dates and without anything an inert record must not hold.
export function publicRegister(reg) {
  return {
    name: reg.name,
    records: reg.records.map((r) => {
      const o = { id: r.id, label: r.label, state: r.state };
      if (r.state === 'stated') for (const k of PAYLOAD_KEYS) if (r[k] !== undefined) o[k] = r[k];
      return o;
    }),
  };
}

export function renderCa(rec) {
  if (rec.state === 'stated') {
    return `    <section class="ca" data-record="ca" data-state="stated" aria-label="${esc(rec.label)}">
      <span class="ca-lab">${esc(rec.label)}</span>
      <p class="ca-val" data-ca-value>${esc(rec.value)}</p>
      <button class="ca-btn" type="button" data-copy-ca aria-label="Copy contract address"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2.5"/><path d="M13 7V5.5A2.5 2.5 0 0 0 10.5 3h-5A2.5 2.5 0 0 0 3 5.5v5A2.5 2.5 0 0 0 5.5 13H7"/></svg><span data-label>Copy</span></button>
    </section>`;
  }
  return `    <section class="ca" data-record="ca" data-state="${rec.state}" aria-label="${esc(rec.label)}">
      <span class="ca-lab">${esc(rec.label)}</span>
      <p class="ca-val">Pending</p>
    </section>`;
}

function renderSocial(rec, mark, name) {
  const handle = rec.state === 'stated' && rec.url ? deriveHandle(rec.id, rec.url) : null;
  if (rec.state === 'stated' && handle) {
    return `        <a class="soc" data-record="${rec.id}" data-state="stated" href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer" aria-label="${name}, ${esc(handle)}">${mark}</a>`;
  }
  if (rec.state === 'stated') throw new Error(`${rec.id}: stated url does not derive a handle`);
  return `        <span class="soc" data-record="${rec.id}" data-state="${rec.state}" role="link" aria-disabled="true" aria-label="${name}, pending">${mark}</span>`;
}

export function renderSocials(reg) {
  return [renderSocial(getRecord(reg, 'x'), X_MARK, 'X'), renderSocial(getRecord(reg, 'github'), GITHUB_MARK, 'GitHub')].join('\n');
}

function tile(rec, label, mono) {
  const stated = rec.state === 'stated';
  const body = stated
    ? `<div class="v${mono ? ' mono' : ''}">${esc(rec.value)}</div>`
    : '<div class="v pend">Pending</div>';
  return `      <div class="tile" data-reveal data-spot data-record="${rec.id}" data-state="${rec.state}"><div class="k">${label}</div>${body}</div>`;
}

export function renderTiles(reg) {
  return [
    tile(getRecord(reg, 'chain'), 'Network'),
    tile(getRecord(reg, 'ca'), 'Contract', true),
    tile(getRecord(reg, 'supply'), 'Supply'),
    tile(getRecord(reg, 'holders'), 'Holders'),
  ].join('\n');
}

function recCard(rec, label) {
  let chip;
  if (rec.state !== 'stated') chip = `<span class="chip" data-state="${rec.state}">Pending</span>`;
  else if (rec.url) {
    const h = deriveHandle(rec.id, rec.url) || rec.url;
    chip = `<a class="chip" data-state="stated" href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer">${esc(h)}</a>`;
  } else if (rec.value) chip = `<span class="chip" data-state="stated">${esc(rec.value)}</span>`;
  else chip = '<span class="chip" data-state="stated">Active</span>';
  return `      <div class="rec" data-reveal data-spot data-record="${rec.id}" data-state="${rec.state}"><span class="l">${label}</span>${chip}</div>`;
}

export function renderRecords(reg) {
  const rows = [['chain', 'Network'], ['ca', 'Contract'], ['x', 'X'], ['github', 'GitHub'], ['supply', 'Supply'], ['holders', 'Holders'], ['market-source', 'Market feed']];
  return rows.map(([id, l]) => recCard(getRecord(reg, id), l)).join('\n');
}
