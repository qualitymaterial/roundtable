import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { extractDocument } from '../src/documents.js';
import { Attachments } from '../src/attachments.js';
import { SQLiteArtifactStore, artifactBytes } from '../src/artifacts.js';
import { captureSession, restoreBundle, readBundle, writeBundle } from '../src/session-bundles.js';
import { fixture, agent, tool, noop } from './helpers.js';
import type { Artifact } from '../src/domain.js';

const office = (path: string, xml: string) => zipSync({ '[Content_Types].xml': strToU8('<Types/>'), [path]: strToU8(xml) });
const word = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Memory &amp; evidence</w:t></w:r></w:p></w:body></w:document>';
function pdf(): Buffer {
  const stream = 'BT /F1 12 Tf 40 100 Td (Persistent memory design) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let data = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((value, i) => { offsets.push(Buffer.byteLength(data)); data += `${i + 1} 0 obj\n${value}\nendobj\n`; });
  const offset = Buffer.byteLength(data); data += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${offset}\n%%EOF`;
  return Buffer.from(data);
}

test('document workers extract real PDF text and bounded DOCX/PPTX/XLSX content without evaluating formulas', async () => {
  const parsed = await extractDocument('design.pdf', pdf()); assert.match(parsed.text, /Persistent memory design/); assert.equal(parsed.parts, 1);
  assert.match((await extractDocument('design.docx', office('word/document.xml', word))).text, /Memory & evidence/);
  assert.match((await extractDocument('slides.pptx', office('ppt/slides/slide1.xml', '<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>Independent agents</a:t></a:r></a:p></p:sld>'))).text, /Independent agents/);
  const sheet = zipSync({ 'xl/sharedStrings.xml': strToU8('<sst><si><t>Cached result</t></si></sst>'), 'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1"><f>2+2</f><v>4</v></c></row></sheetData></worksheet>') });
  const cells = await extractDocument('book.xlsx', sheet); assert.match(cells.text, /A1: Cached result/); assert.match(cells.text, /B1: 4/); assert.doesNotMatch(cells.text, /2\+2/);
});

test('document parsing rejects malformed, unsafe, oversized and cancelled inputs', async () => {
  await assert.rejects(extractDocument('bad.pdf', Buffer.from('bad')), /signature/);
  await assert.rejects(extractDocument('old.doc', Buffer.from('old')), /Supported/);
  await assert.rejects(extractDocument('huge.pdf', Buffer.alloc(2 * 1024 * 1024 + 1)), /2 MiB/);
  await assert.rejects(extractDocument('bad.docx', office('word/document.xml', '<broken>')), /unclosed/);
  await assert.rejects(extractDocument('bad.docx', office('word/document.xml', '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///secrets">]><x>&secret;</x>')), /declarations/);
  await assert.rejects(extractDocument('bad.docx', office('../word/document.xml', word)), /Unsafe/);
  await assert.rejects(extractDocument('bomb.docx', office('word/document.xml', ' '.repeat(9 * 1024 * 1024))), /expansion/);
  await assert.rejects(extractDocument('long.docx', office('word/document.xml', '<document><t>' + 'a'.repeat(65000) + '</t></document>')), /64,000/);
  await assert.rejects(extractDocument('cancel.docx', office('word/document.xml', word), AbortSignal.abort()), /cancelled/);
});

test('selected documents reach only their audience as text and survive export, versioning and portable recovery', async () => {
  const seen: string[] = []; const f = fixture(async () => ({ ...noop, prompt: async (body: string) => { seen.push(body); } }));
  try {
    const a = await agent(f.engine, 'A'); const b = await agent(f.engine, 'B'); const path = join(f.home, 'design.docx'); const bytes = office('word/document.xml', word); writeFileSync(path, bytes);
    const inputs = new Attachments(f.repo, f.session.id);
    await assert.rejects(inputs.addFiles([path, join(f.home, 'missing.pdf')], [a.id])); assert.equal(inputs.list().length, 0);
    const [entry] = await inputs.addFiles([path], [a.id]); assert.ok(entry);
    assert.throws(() => inputs.read(entry.id, b.id), /authorized/);
    f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body: 'Inspect', attachments: [entry.id] }); await f.engine.idle();
    assert.equal(seen.length, 1); assert.match(seen[0]!, /Memory & evidence/); assert.doesNotMatch(seen[0]!, /UEsDB/);
    const out = join(f.home, 'export.docx'); inputs.export(entry.id, out); assert.deepEqual(readFileSync(out), Buffer.from(bytes));
    const [next] = await inputs.addFiles([path], [a.id], entry.id); assert.equal(inputs.lineage(next!.id).length, 2);
    await f.engine.pause(); await f.engine.idle();
    const bundlePath = join(f.home, 'docs.rtbundle'); writeBundle(captureSession(f.engine), bundlePath);
    const restored = restoreBundle(f.repo, readBundle(bundlePath), f.home);
    const restoredInputs = new Attachments(f.repo, restored.id); const restoredEntry = restoredInputs.read(restoredInputs.list()[0]!.id);
    assert.equal(restoredEntry.extraction?.text, entry.extraction?.text); assert.equal(restoredEntry.hash, entry.hash);
    const corrupted = { ...entry, extraction: { ...entry.extraction!, text: 'tampered' } }; f.repo.put('attachment', corrupted); assert.throws(() => inputs.read(entry.id), /integrity/);
  } finally { await f.close(); }
});

test('binary artifacts enforce read permission, preserve exact bytes through recovery and detect tampering', async () => {
  const f = fixture();
  try {
    const a = await agent(f.engine); const store = new SQLiteArtifactStore(f.repo); const bytes = pdf(); writeFileSync(join(f.session.workspace, 'design.pdf'), bytes);
    a.permissions = a.permissions.filter(p => p !== 'workspace.read'); f.repo.put('agent', a);
    assert.equal((await tool(f.engine, a, 'roundtable_artifact_publish_file', { path: 'design.pdf', provenance: 'Fixture' })).ok, false);
    a.permissions.push('workspace.read'); f.repo.put('agent', a);
    const result = await tool<Artifact>(f.engine, a, 'roundtable_artifact_publish_file', { path: 'design.pdf', provenance: 'Fixture' }); assert.equal(result.ok, true); assert.equal(result.data.content, undefined);
    const saved = store.read(f.session.id, result.data.id); assert.deepEqual(artifactBytes(saved), bytes);
    assert.throws(() => store.read('other-session', saved.id), /Unknown/);
    assert.throws(() => store.publishBinary(f.session.id, a.id, { name: 'bad.pdf', bytes: Buffer.from('bad'), provenance: '' }), /signature/);
    assert.throws(() => store.publishBinary(f.session.id, a.id, { name: 'huge.pdf', bytes: Buffer.alloc(2 * 1024 * 1024 + 1), provenance: '' }), /size/);
    await f.engine.pause(); await f.engine.idle(); const branch = restoreBundle(f.repo, captureSession(f.engine), f.home);
    const branched = f.repo.list<Artifact>('artifact', branch.id)[0]!; assert.deepEqual(artifactBytes(store.read(branch.id, branched.id)), bytes);
    const corrupted = { ...saved, content: Buffer.from('%PDF-tampered').toString('base64') }; f.repo.put('artifact', corrupted); assert.throws(() => store.read(f.session.id, saved.id), /integrity/);
  } finally { await f.close(); }
});
