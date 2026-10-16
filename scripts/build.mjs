import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, readJson, validateRegister, publicRegister, getRecord, readTokens, renderCa, renderSocials, renderTiles, renderRecords } from './lib.mjs';

export function build({ register = path.join(ROOT, 'register.json'), out = path.join(ROOT, 'dist') } = {}) {
  const reg = typeof register === 'string' ? readJson(register) : register;
  const problems = validateRegister(reg);
  if (problems.length) throw new Error('register invalid:\n  ' + problems.join('\n  '));
  for (const id of ['chain', 'market-source', 'ca', 'x', 'github', 'supply', 'holders']) {
    if (!getRecord(reg, id)) throw new Error('register is missing record ' + id);
  }
  const src = path.join(ROOT, 'src');
  const tokens = readTokens(path.join(src, 'css', 'tokens.css'));
  for (const k of ['ground', 'ink']) if (!tokens[k]) throw new Error('token missing: ' + k);

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const cp = (rel) => {
    const to = path.join(out, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(path.join(src, rel), to, { recursive: true });
  };
  cp('css'); cp('js');
  fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
  for (const f of fs.readdirSync(path.join(src, 'assets'))) {
    if (f.endsWith('.tpl.svg')) continue;
    fs.copyFileSync(path.join(src, 'assets', f), path.join(out, 'assets', f));
  }
  const fav = fs.readFileSync(path.join(src, 'assets', 'favicon.tpl.svg'), 'utf8')
    .replace('{{ground}}', tokens.ground).replace('{{ink}}', tokens.ink);
  fs.writeFileSync(path.join(out, 'favicon.svg'), fav);

  const pub = publicRegister(reg);
  const json = JSON.stringify(pub).replace(/</g, '\\u003c');
  let html = fs.readFileSync(path.join(src, 'index.template.html'), 'utf8');
  const fill = {
    ground: tokens.ground,
    social: renderSocials(reg),
    ca: renderCa(getRecord(reg, 'ca')),
    tiles: renderTiles(reg),
    records: renderRecords(reg),
    register: json,
  };
  html = html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in fill ? fill[k] : m));
  if (/\{\{\w+\}\}/.test(html)) throw new Error('unfilled placeholder in index.html');
  fs.writeFileSync(path.join(out, 'index.html'), html);

  fs.writeFileSync(path.join(out, '_headers'), [
    '/*',
    "  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://cdn.dexscreener.com https://dd.dexscreener.com; connect-src 'self' https://api.dexscreener.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
    '',
  ].join('\n'));
  return { out, pub };
}

const entry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (entry) {
  const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > 0 ? path.resolve(process.argv[i + 1]) : undefined; };
  const r = build({ register: arg('register'), out: arg('out') });
  console.log('built ->', path.relative(ROOT, r.out) || '.');
}
