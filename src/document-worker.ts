import { parentPort, workerData } from 'node:worker_threads';
import { extname } from 'node:path';
import { Unzip, UnzipInflate } from 'fflate';
import { SaxesParser, type SaxesTagPlain } from 'saxes';
import type { Extraction } from './documents.js';

const MAX_XML = 8 * 1024 * 1024;
function officeParts(bytes: Uint8Array): Map<string, string> {
  const parts = new Map<string, string>(); const seen = new Set<string>(); let total = 0; let pending = 0;
  const zip = new Unzip(file => {
    if (++count > 1000 || seen.has(file.name) || /(^\/|\\|:|(^|\/)\.\.?(\/|$))/.test(file.name)) throw new Error('Unsafe or excessive Office ZIP entries');
    seen.add(file.name);
    if (/vbaProject\.bin$/i.test(file.name)) throw new Error('Macro-enabled documents are unsupported');
    if (!/^(word\/document|ppt\/slides\/slide\d+|xl\/sharedStrings|xl\/worksheets\/sheet\d+)\.xml$/.test(file.name)) return;
    if (file.originalSize && file.originalSize > MAX_XML) throw new Error('Office expansion limit exceeded');
    pending++; const chunks: Uint8Array[] = [];
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      total += chunk.length; if (total > MAX_XML) { file.terminate(); throw new Error('Office expansion limit exceeded'); }
      chunks.push(chunk);
      if (final) { pending--; parts.set(file.name, new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    };
    file.start();
  });
  let count = 0; zip.register(UnzipInflate);
  for (let i = 0; i < bytes.length; i += 8192) zip.push(bytes.subarray(i, i + 8192), i + 8192 >= bytes.length);
  if (pending || !parts.size) throw new Error('Incomplete or unsupported Office document');
  return parts;
}

function xmlRead(xml: string, open: (tag: SaxesTagPlain) => void, close: (name: string) => void, text: (value: string) => void): void {
  const parser = new SaxesParser({ xmlns: false }); let depth = 0;
  parser.on('doctype', () => { throw new Error('Document type declarations are unsupported'); });
  parser.on('opentag', tag => { if (++depth > 100) throw new Error('Office XML is too deeply nested'); open(tag); });
  parser.on('closetag', tag => { close(tag.name.split(':').at(-1)!); depth--; });
  parser.on('text', text); parser.on('cdata', text); parser.write(xml).close();
}

async function extract(name: string, bytes: Uint8Array): Promise<Extraction> {
  const format = extname(name).slice(1).toLowerCase() as Extraction['format'];
  const chunks: string[] = []; let length = 0; let parts = 0;
  const append = (value: string) => { length += value.length; if (length > 64000) throw new Error('Extracted text exceeds 64,000 characters; split the document'); chunks.push(value); };
  if (format === 'pdf') {
    if (Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-') throw new Error('Invalid PDF signature');
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // No resource URLs, form execution, rendering, or document scripts are requested.
    class NoExternalData { async fetch(): Promise<never> { throw new Error('External PDF resources are disabled'); } }
    const task = getDocument({ data: bytes, verbosity: 0, stopAtErrors: true, useWorkerFetch: false, useWasm: false, useSystemFonts: false, disableFontFace: true, enableXfa: false, BinaryDataFactory: NoExternalData });
    try {
      const pdf = await task.promise; parts = pdf.numPages;
      if (parts > 200) throw new Error('PDF page limit is 200');
      for (let i = 1; i <= parts; i++) {
        const page = await pdf.getPage(i); const text = await page.getTextContent();
        append(`\n[Page ${i}]\n`);
        let found = false;
        for (const item of text.items) if ('str' in item) { append(item.str + (item.hasEOL ? '\n' : ' ')); if (item.str.trim()) found = true; }
        if (!found) append('[No embedded text on this page; OCR may be required]\n');
        page.cleanup();
      }
    } finally { await task.destroy(); }
    return { text: chunks.join('').trim(), format, parts, warnings: ['Text extraction only. Reading order may differ from the page. Images, scanned text and layout are not interpreted.'] };
  }
  const files = officeParts(bytes);
  if (format === 'xlsx') {
    const strings: string[] = []; let capture = false; let item = '';
    if (files.has('xl/sharedStrings.xml')) xmlRead(files.get('xl/sharedStrings.xml')!, tag => { const local = tag.name.split(':').at(-1); if (local === 'si') item = ''; if (local === 't') capture = true; }, local => { if (local === 't') capture = false; if (local === 'si') strings.push(item); }, value => { if (capture) item += value; });
    for (const [path, xml] of [...files].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))) {
      if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) continue;
      if (++parts > 200) throw new Error('Office part limit is 200'); append(`\n[${path}]\n`);
      let cell = ''; let type = ''; let value = ''; let taking = false;
      xmlRead(xml, tag => { const local = tag.name.split(':').at(-1); if (local === 'c') { cell = tag.attributes.r ?? '?'; type = tag.attributes.t ?? ''; value = ''; } if (local === 'v' || local === 't') taking = true; }, local => {
        if (local === 'v' || local === 't') taking = false;
        if (local === 'c') { const output = type === 's' ? strings[Number(value)] : value; if (output === undefined) throw new Error('Invalid shared-string reference'); append(`${cell}: ${output}\n`); }
      }, text => { if (taking) value += text; });
    }
  } else {
    const selected = [...files].filter(([path]) => format === 'docx' ? path === 'word/document.xml' : /^ppt\/slides\/slide\d+\.xml$/.test(path)).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }));
    for (const [path, xml] of selected) {
      if (++parts > 200) throw new Error('Office part limit is 200'); append(`\n[${path}]\n`); let taking = false;
      xmlRead(xml, tag => { if (tag.name.split(':').at(-1) === 't') taking = true; }, local => { if (local === 't') taking = false; if (local === 'p' || local === 'tr') append('\n'); if (local === 'tc') append('\t'); }, value => { if (taking) append(value); });
    }
  }
  if (!parts) throw new Error('Document has no supported content parts');
  return { text: chunks.join('').trim(), format, parts, warnings: ['Text extraction only: main document, slides or cell values. Layout, charts, images, notes and embedded objects are omitted. Formulas and macros are never executed.'] };
}

if (parentPort) {
  const { name, bytes } = workerData as { name: string; bytes: Uint8Array };
  void extract(name, bytes).then(result => parentPort!.postMessage(result), error => parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) }));
}
