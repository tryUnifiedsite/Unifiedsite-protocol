export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

export function flashDone(btn, ok = true, label) {
  clearTimeout(btn._t);
  const text = btn.querySelector('[data-label]');
  if (ok) btn.dataset.done = '1';
  if (text && label) text.textContent = ok ? label[1] : 'Failed';
  btn._t = setTimeout(() => {
    delete btn.dataset.done;
    if (text && label) text.textContent = label[0];
  }, 1600);
}
