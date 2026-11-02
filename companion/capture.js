// Serialized by chrome.scripting into the isolated world. Keep this function self-contained.
export function captureSelectedPage() {
  const limit = 16000;
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
  const visibility = new WeakMap();
  const visible = element => {
    if (visibility.has(element)) return visibility.get(element);
    let current = element; let depth = 0;
    while (current && depth++ < 40) {
      if (current.matches('script,style,noscript,input,textarea,select,[hidden],[aria-hidden="true"],[contenteditable],[data-roundtable-private]')) { visibility.set(element, false); return false; }
      const css = getComputedStyle(current);
      if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || css.opacity === '0') { visibility.set(element, false); return false; }
      current = current.parentElement;
    }
    const value = !current; visibility.set(element, value); return value;
  };
  let text = ''; let visited = 0; let truncated = false; let node;
  while ((node = walker.nextNode())) {
    if (++visited > 10000) { truncated = true; break; }
    if (!node.parentElement || !visible(node.parentElement)) continue;
    const value = node.textContent.replace(/\s+/gu, ' ').trim();
    if (!value) continue;
    const remaining = limit - text.length;
    if (value.length + (text ? 1 : 0) > remaining) { text += (' ' + value).slice(0, remaining); truncated = true; break; }
    text += (text ? ' ' : '') + value;
  }
  return { url: location.href, title: document.title.slice(0, 500), text, truncated };
}
