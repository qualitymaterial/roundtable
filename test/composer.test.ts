import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, agent, noop } from './helpers.js';
import { completeFileMention, mentionedFiles, editDraft } from '../src/composer.js';
import { Attachments } from '../src/attachments.js';
import { Engine } from '../src/engine.js';

test('project file completion handles spaces and blocks traversal and credential references', async () => {
  const f = fixture();
  try {
    const root = f.session.workspace; mkdirSync(join(root, 'source files')); writeFileSync(join(root, 'source files', 'one.txt'), 'one'); writeFileSync(join(root, '.env'), 'secret');
    assert.deepEqual(completeFileMention('Read @sou', root)[0], ['Read @"source files/']);
    assert.deepEqual(completeFileMention('Read @"source files/o', root)[0], ['Read @"source files/one.txt"']);
    assert.deepEqual(mentionedFiles('Read @"source files/one.txt" twice @"source files/one.txt"', root), [join(root, 'source files', 'one.txt')]);
    assert.deepEqual(completeFileMention('Read @../', root)[0], []);
    assert.throws(() => mentionedFiles('Read @.env', root), /credential/);
    assert.throws(() => mentionedFiles('Read @../../test.db', root), /inside the project/);
    assert.deepEqual(mentionedFiles('mail@example.com', root), []);
  } finally { await f.close(); }
});

test('external editor preserves multiline drafts, uses literal arguments and keeps recovery files on failure', async () => {
  const f = fixture();
  try {
    const script = join(f.home, 'editor.cjs');
    writeFileSync(script, "const fs=require('fs'); if(process.argv[2] !== 'literal;$()') process.exit(3); fs.appendFileSync(process.argv[3], '\\nsecond line');");
    const edited = await editDraft(f.home, 'first line', { executable: process.execPath, args: [script, 'literal;$()'] }, false);
    assert.equal(edited.exitCode, 0); assert.equal(edited.body, 'first line\nsecond line'); assert.deepEqual(readdirSync(join(f.home, 'drafts')), []);
    const unchanged = await editDraft(f.home, 'no edit yet', { executable: process.execPath, args: ['-e', 'process.exit(0)'] }, false); assert.ok(unchanged.recoveryPath);
    await assert.rejects(editDraft(f.home, 'recover me', { executable: join(f.home, 'missing-executable'), args: [] }, false), /Recovery file:/);
    assert.equal(readdirSync(join(f.home, 'drafts')).length, 2);
  } finally { await f.close(); }
});

test('multi-file selection is atomic and attachment version history retains old snapshots', async () => {
  const f = fixture();
  try {
    const a = await agent(f.engine); const store = new Attachments(f.repo, f.session.id);
    const file = join(f.home, 'one.txt'); writeFileSync(file, 'first');
    assert.throws(() => store.addMany([file, join(f.home, 'missing.txt')], [a.id])); assert.equal(store.list().length, 0);
    const first = store.addMany([file], [a.id])[0]!; writeFileSync(file, 'second'); const second = store.add(file, [a.id], first.id);
    assert.deepEqual(store.lineage(second.id).map(a => a.id), [second.id, first.id]);
    assert.equal(Buffer.from(store.read(first.id).data, 'base64').toString(), 'first');
  } finally { await f.close(); }
});

test('arbitrary queue ordering survives engine restart without rewriting or replaying the transcript', async () => {
  const seen: string[] = []; const factory = async () => ({ ...noop, prompt: async (prompt: string) => { seen.push(JSON.parse(prompt).incoming.body); } });
  const f = fixture(factory);
  try {
    const a = await agent(f.engine); await f.engine.pause();
    const messages = ['first', 'second', 'third'].map(body => f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body }));
    assert.throws(() => f.engine.reorderQueue([messages[0]!.id]), /exactly once/);
    f.engine.reorderQueue([messages[2]!.id, messages[0]!.id, messages[1]!.id]);
    assert.deepEqual(f.repo.messages(f.session.id).map(m => m.body), ['first', 'second', 'third']);
    await f.engine.close(); const restored = new Engine(f.repo, f.session.id, factory);
    try { assert.deepEqual(restored.queuedHumanMessages().map(m => m.body), ['third', 'first', 'second']); restored.resume(); await restored.connect(); await restored.idle(); assert.deepEqual(seen, ['third', 'first', 'second']); }
    finally { await restored.close(); }
  } finally { await f.close(); }
});
