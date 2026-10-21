import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { redact } from './domain.js';
import { webUrl } from './web-http.js';
import { WebError } from './web-types.js';

type Node = DefaultTreeAdapterMap['node'];
const clean = (s: string) => redact(s).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
const ignored = new Set(['script', 'style', 'noscript', 'template', 'nav', 'footer', 'header', 'aside', 'form', 'svg', 'iframe', 'object']);
const blocks = new Set(['p', 'div', 'article', 'section', 'main', 'h1', 'h2', 'h3', 'h4', 'li', 'tr', 'br']);
function nodeText(root: Node, skip = true): string {
  const parts: string[] = []; const stack: (Node | string)[] = [root];
  while (stack.length) {
    const node = stack.pop()!; if (typeof node === 'string') { parts.push(node); continue; }
    if ('value' in node && node.nodeName === '#text') { parts.push(node.value); continue; }
    if ('tagName' in node && skip && (ignored.has(node.tagName) || node.attrs.some(a => a.name === 'hidden' || a.name === 'aria-hidden' && a.value === 'true'))) continue;
    if ('childNodes' in node) { const block = 'tagName' in node && blocks.has(node.tagName); if (block) parts.push('\n'); if (block) stack.push('\n'); stack.push(...[...node.childNodes].reverse()); }
  }
  return clean(parts.join(' '));
}
export function extractPage(raw: string, mediaType: string, url: URL) {
  if (Buffer.byteLength(raw) > 1024 * 1024) throw new WebError('response_too_large', 'Web response exceeds 1 MiB');
  let title = url.hostname; let canonicalUrl = url.href; let text = ''; const warnings: string[] = [];
  if (/^(text\/html|application\/xhtml\+xml)\b/i.test(mediaType)) {
    const document = parse(raw); const stack: Node[] = [document]; let main: Node | undefined;
    while (stack.length) {
      const n = stack.pop()!;
      if ('tagName' in n) {
        if (n.tagName === 'title') title = nodeText(n, false);
        if (!main && ['main', 'article'].includes(n.tagName)) main = n;
        if (n.tagName === 'link' && n.attrs.find(a => a.name === 'rel')?.value.toLowerCase().split(/\s+/).includes('canonical')) {
          const href = n.attrs.find(a => a.name === 'href')?.value;
          try { if (href) { const candidate = webUrl(new URL(href, url).href); if (candidate.origin === url.origin) canonicalUrl = candidate.href; else warnings.push('Cross-origin canonical URL ignored'); } } catch { warnings.push('Invalid canonical URL ignored'); }
        }
      }
      if ('childNodes' in n) stack.push(...[...n.childNodes].reverse());
    }
    text = nodeText(main ?? document);
  } else if (/^application\/json\b/i.test(mediaType)) {
    try { JSON.parse(raw); } catch { throw new WebError('extraction_failed', 'Invalid JSON page'); }
    text = redact(raw).trim(); // Preserve structured string values and their spacing.
  } else if (/^text\/plain\b/i.test(mediaType)) text = clean(raw);
  else throw new WebError('unsupported_media', 'Only HTML, plain text and JSON pages are supported');
  if (!text) throw new WebError('extraction_failed', 'Page has no readable text');
  if (!/(?:charset=\s*["']?utf-?8|^[^;]+$)/i.test(mediaType)) warnings.push('Text decoded as UTF-8; other charsets are not supported');
  return { title: clean(title).slice(0, 1000), canonicalUrl, text: text.slice(0, 64000), truncated: text.length > 64000, warnings: [...new Set(warnings)].slice(0, 10), mediaType: mediaType.slice(0, 200) };
}
export function snippetText(raw: string): string { return nodeText(parse(raw)).slice(0, 1500); }
