import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Attachments } from '../src/attachments.js';
import { fixture, agent, noop } from './helpers.js';
import { Engine } from '../src/engine.js';

test('selected file/image snapshots cross independent session boundaries and survive restart', async () => {
  const received: { agent: string; prompt: string; images: number }[] = [];
  const f = fixture(async a => ({ ...noop, prompt: async (prompt, images) => { received.push({ agent: a.id, prompt, images: images?.length ?? 0 }); } }));
  try {
    const a = await agent(f.engine, 'A'); const b = await agent(f.engine, 'B'); const store = new Attachments(f.repo, f.session.id);
    const csv = join(f.home, 'data.csv'); writeFileSync(csv, 'name,value\nA,42');
    const png = join(f.home, 'screenshot.png'); const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJXcAAAAASUVORK5CYII=', 'base64'); writeFileSync(png, bytes);
    const data = store.add(csv, [a.id]); const image = store.add(png, [a.id]);
    assert.throws(() => store.read(data.id, b.id), /authorized/);
    assert.throws(() => f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [b.id], type: 'human', body: 'No access', attachments: [data.id] }), /authorized/);
    f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body: 'Compare the image and CSV', attachments: [data.id, image.id] });
    await f.engine.idle(); assert.equal(received.length, 1); assert.equal(received[0]?.agent, a.id); assert.equal(received[0]?.images, 1); assert.match(received[0]!.prompt, /A,42/);
    await f.engine.close(); const restored = new Engine(f.repo, f.session.id, async () => noop);
    const recovered = new Attachments(f.repo, f.session.id); const destination = join(f.home, 'export.png'); recovered.export(image.id, destination);
    assert.deepEqual(readFileSync(destination), bytes); assert.throws(() => recovered.export(image.id, destination), /EEXIST/);
    assert.equal(recovered.read(data.id).hash, data.hash); await restored.close();
  } finally { await f.close(); }
});

test('attachment guards reject credential paths, binary text, unsupported documents and tampering', async () => {
  const f = fixture();
  try {
    const a = await agent(f.engine); const store = new Attachments(f.repo, f.session.id);
    for (const [file, content] of [['.env', 'SECRET=hidden'], ['bad.txt', 'binary\0data'], ['document.pdf', '%PDF-1.4']]) {
      const path = join(f.home, file!); writeFileSync(path, content!); assert.throws(() => store.add(path, [a.id]));
    }
    const path = join(f.home, 'safe.txt'); writeFileSync(path, 'Original'); const entry = store.add(path, [a.id]);
    entry.data = Buffer.from('Tampered').toString('base64'); f.repo.put('attachment', entry);
    assert.throws(() => store.read(entry.id), /integrity/);
  } finally { await f.close(); }
});
