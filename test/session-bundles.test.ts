import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { captureSession, writeBundle, readBundle, restoreBundle } from '../src/session-bundles.js';
import { fixture, agent, tool, noop } from './helpers.js';
import { Engine } from '../src/engine.js';
import { Attachments } from '../src/attachments.js';
import type { Artifact, Task } from '../src/domain.js';

test('portable branches preserve independent Pi histories, task references and snapshots without replay or grants', async () => {
  const f = fixture();
  try {
    const a = await agent(f.engine, 'A'); const b = await agent(f.engine, 'B');
    const task = (await tool<Task>(f.engine, a, 'roundtable_task_create', { title: 'Carry this forward' })).data;
    await tool(f.engine, a, 'roundtable_task_claim', { taskId: task.id });
    const artifact = (await tool<Artifact>(f.engine, a, 'roundtable_artifact_publish', { name: 'ID as literal content', content: a.id, provenance: 'Regression fixture' })).data;
    writeFileSync(join(f.session.workspace, 'design.txt'), 'versioned design');
    writeFileSync(join(f.session.workspace, '.env'), 'PRIVATE=excluded');
    const attachment = new Attachments(f.repo, f.session.id).add(join(f.session.workspace, 'design.txt'), [a.id, b.id]);
    for (const member of [a, b]) {
      const path = join(f.home, 'sessions', f.session.id, member.id); mkdirSync(path, { recursive: true });
      writeFileSync(join(path, 'history.jsonl'), [
        { type: 'session', version: 3, id: member.id, timestamp: new Date().toISOString(), cwd: f.session.workspace },
        { type: 'message', id: 'first', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: `${member.name} private context`, timestamp: Date.now() } },
      ].map(e => JSON.stringify(e)).join('\n') + '\n');
    }
    await f.engine.pause(); await f.engine.idle();
    const sent = f.engine.send({ sessionId: f.session.id, sender: 'human', type: 'human', recipients: [a.id, b.id], body: 'Keep queued in source', artifacts: [artifact.id], attachments: [attachment.id], taskId: task.id });
    const bundle = captureSession(f.engine); assert.ok(bundle.excluded.includes('workspace/.env'));
    const path = join(f.home, 'copy.rtbundle'); writeBundle(bundle, path); assert.throws(() => writeBundle(bundle, path), /EEXIST/);
    const restored = restoreBundle(f.repo, readBundle(path), f.home, 'Alternate approach');
    assert.equal(restored.state, 'paused'); assert.equal(restored.hostAccess, undefined); assert.equal(restored.usage.requests, 0);
    assert.equal(readFileSync(join(restored.workspace, 'design.txt'), 'utf8'), 'versioned design');
    assert.equal(f.repo.list('approval', restored.id).length, 0); assert.equal(f.repo.list('operation', restored.id).length, 0);
    assert.equal(f.repo.deliveries(restored.id).length, 0); assert.equal(f.repo.deliveries(f.session.id).filter(d => d.messageId === sent.id).length, 2);
    const restoredArtifact = f.repo.list<Artifact>('artifact', restored.id)[0]!;
    assert.equal(restoredArtifact.content, a.id); assert.equal(restoredArtifact.hash, artifact.hash); assert.notEqual(restoredArtifact.author, a.id);
    const restoredTask = f.repo.list<Task>('task', restored.id)[0]!;
    assert.equal(restoredTask.state, 'open'); assert.equal(restoredTask.owner, undefined);
    const messages = f.repo.messages(restored.id); assert.equal(messages.at(-1)?.taskId, restoredTask.id);
    for (const member of [a, b]) {
      const newId = restored.referenceMap![member.id]!;
      const manager = SessionManager.continueRecent(restored.workspace, join(f.home, 'sessions', restored.id, newId));
      const history = JSON.stringify(manager.getEntries());
      assert.match(history, new RegExp(`${member.name} private context`)); assert.doesNotMatch(history, new RegExp(`${member === a ? b.name : a.name} private context`));
      assert.equal(manager.getCwd(), restored.workspace);
    }
    const branch = new Engine(f.repo, restored.id, async () => noop);
    try {
      assert.equal(branch.agents().length, 2); branch.resume(); await branch.connect(); assert.equal(f.repo.deliveries(restored.id).length, 0);
      await branch.pause(); await branch.idle();
      const secondBranch = restoreBundle(f.repo, captureSession(branch), f.home);
      assert.equal(secondBranch.referenceMap![a.id], secondBranch.referenceMap![restored.referenceMap![a.id]!]!);
      assert.equal(secondBranch.referenceMap![artifact.id], f.repo.list<Artifact>('artifact', secondBranch.id)[0]!.id);
    }
    finally { await branch.close(); }
  } finally { await f.close(); }
});

test('imports reject tampering, unsafe files, malformed entities and dependency cycles atomically', async () => {
  const f = fixture();
  try {
    const a = await agent(f.engine); const one = (await tool<Task>(f.engine, a, 'roundtable_task_create', { title: 'One' })).data;
    const two = (await tool<Task>(f.engine, a, 'roundtable_task_create', { title: 'Two', dependencies: [one.id] })).data;
    await f.engine.pause(); await f.engine.idle(); const baseline = captureSession(f.engine);
    const before = readdirSync(join(f.home, 'workspaces'));
    for (const path of ['../escape', 'C:/escape', 'nested/.env', 'trailing.', 'a\\b']) {
      const bundle = structuredClone(baseline); const data = Buffer.from('untrusted');
      bundle.files.push({ area: 'workspace', path, data: data.toString('base64'), hash: createHash('sha256').update(data).digest('hex') });
      assert.throws(() => restoreBundle(f.repo, bundle, f.home), /Unsafe archive/);
      assert.deepEqual(readdirSync(join(f.home, 'workspaces')), before); assert.equal(f.repo.list('session').length, 1);
    }
    const invalid = structuredClone(baseline); invalid.entities.find(e => e.kind === 'task')!.value.dependencies = [two.id];
    assert.throws(() => restoreBundle(f.repo, invalid, f.home), /Cyclic/);
    invalid.entities.find(e => e.kind === 'task')!.value.dependencies = 42;
    assert.throws(() => restoreBundle(f.repo, invalid, f.home));
    const duplicate = structuredClone(baseline); duplicate.agents.push(duplicate.agents[0]!);
    assert.throws(() => restoreBundle(f.repo, duplicate, f.home), /Duplicate/);
    const file = join(f.home, 'tampered.rtbundle'); writeBundle(baseline, file);
    const envelope = JSON.parse(readFileSync(file, 'utf8')); envelope.payload.session.objective = 'tampered'; writeFileSync(file, JSON.stringify(envelope));
    assert.throws(() => readBundle(file), /checksum/);
  } finally { await f.close(); }
});

test('CLI backup and import run offline, then resume for inspection without inference', async () => {
  const f = fixture();
  try {
    const run = (args: string[], input = '') => spawnSync(process.execPath, [resolve('dist/cli.js'), ...args], { input, encoding: 'utf8', timeout: 30000, env: { ...process.env, ROUNDTABLE_HOME: f.home } });
    const path = join(f.home, 'backup with spaces.rtbundle');
    const first = run(['session', 'new', 'Portable project'], `/backup "${path}"\n/fork alternate\n/status\n/exit\n`);
    assert.equal(first.status, 0, first.stdout + first.stderr); assert.doesNotMatch(first.stdout, /\[error\]/);
    assert.match(first.stdout, /Created [a-f0-9-]+\. Review participants/);
    const imported = run(['session', 'import', path, f.home]);
    assert.equal(imported.status, 0, imported.stdout + imported.stderr); const key = /Imported paused branch ([a-f0-9-]+)/.exec(imported.stdout)![1]!;
    const opened = run(['session', 'resume', key], '/status\n/exit\n');
    assert.equal(opened.status, 0, opened.stdout + opened.stderr); assert.match(opened.stdout, /Imported branch/); assert.doesNotMatch(opened.stdout, /\[error\]/);
  } finally { await f.close(); }
});
