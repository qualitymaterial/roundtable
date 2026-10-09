import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, agent, tool, noop } from './helpers.js';
import { Engine } from '../src/engine.js';
import { completionReport, resolveFailure } from '../src/completion.js';
import { previewCheckpoint, undoCheckpoint } from '../src/host-tools.js';
import type { Task } from '../src/domain.js';

test('removed owners release claims; human transfer preserves findings and enforces dependencies', async () => {
  const f = fixture();
  try {
    const a = await agent(f.engine, 'A'); const b = await agent(f.engine, 'B');
    const task = (await tool<Task>(f.engine, a, 'roundtable_task_create', { title: 'Continue after removal' })).data;
    await tool(f.engine, a, 'roundtable_task_claim', { taskId: task.id });
    await tool(f.engine, a, 'roundtable_task_update', { taskId: task.id, findings: 'Keep my evidence' });
    await f.engine.setAgentState(a.id, 'removed');
    assert.equal(f.repo.get<Task>('task', task.id)?.state, 'open');
    assert.equal((await tool(f.engine, b, 'roundtable_task_claim', { taskId: task.id })).ok, true);
    assert.match(f.engine.reassignTask(task.id).findings, /Keep my evidence/);
    assert.equal(f.engine.reassignTask(task.id, b.id).owner, b.id);
    const dependent = (await tool<Task>(f.engine, b, 'roundtable_task_create', { title: 'Dependent', dependencies: [task.id] })).data;
    assert.throws(() => f.engine.reassignTask(dependent.id, b.id), /dependencies/);
    // Recovery repairs claims created by older releases too.
    const stranded = f.repo.get<Task>('task', task.id)!; stranded.owner = a.id; f.repo.put('task', stranded);
    await f.engine.close(); const restored = new Engine(f.repo, f.session.id, async () => noop);
    assert.equal(f.repo.get<Task>('task', task.id)?.state, 'open'); await restored.close();
  } finally { await f.close(); }
});

test('workspace writes reject clobbers, serialize competing edits and support review/undo', async () => {
  const f = fixture();
  try {
    const a = await f.engine.addAgent({ name: 'Editor', provider: 'test', model: 'test', permissions: ['workspace.read', 'workspace.write'] }, false);
    const created = await tool<{ checkpointId: string; sha256: string }>(f.engine, a, 'workspace_write', { path: 'nested/a.txt', content: 'original' });
    assert.equal(created.ok, true);
    assert.equal((await tool(f.engine, a, 'workspace_write', { path: 'nested/a.txt', content: 'clobber' })).ok, false);
    const read = await tool<{ sha256: string }>(f.engine, a, 'workspace_read', { path: 'nested/a.txt' });
    const edits = await Promise.all(['one', 'two'].map(content => tool<{ checkpointId: string }>(f.engine, a, 'workspace_write', { path: 'nested/a.txt', content, expectedHash: read.data.sha256 })));
    assert.equal(edits.filter(e => e.ok).length, 1);
    const checkpoint = edits.find(e => e.ok)!.data.checkpointId;
    assert.match(await previewCheckpoint(f.engine, checkpoint), /-original/);
    await undoCheckpoint(f.engine, checkpoint);
    assert.equal(readFileSync(join(f.session.workspace, 'nested/a.txt'), 'utf8'), 'original');
    await undoCheckpoint(f.engine, created.data.checkpointId);
    assert.equal(existsSync(join(f.session.workspace, 'nested/a.txt')), false);
  } finally { await f.close(); }
});

test('failed, cancelled and interrupted jobs cannot appear successful; resolutions are explicit', async () => {
  const f = fixture();
  try {
    for (const state of ['failed', 'cancelled', 'interrupted']) f.repo.put('job', { id: state, sessionId: f.session.id, state, command: 'validation' } as { id: string; sessionId: string });
    const report = completionReport(f.engine);
    assert.equal(report.state, 'needs review'); assert.equal(report.failures.length, 3);
    assert.throws(() => resolveFailure(f.engine, 'job:failed', ''), /reason/);
    for (const failure of report.failures) resolveFailure(f.engine, failure.id, 'Validated replacement result separately');
    assert.equal(completionReport(f.engine).state, 'idle');
    assert.equal(completionReport(f.engine).acceptance, 'not accepted');
    assert.equal(f.repo.list('job', f.session.id).length, 3);
  } finally { await f.close(); }
});

test('prepared tool operations are not replayed after interruption', async () => {
  const f = fixture();
  try {
    const a = await agent(f.engine); let effects = 0;
    const { Type } = await import('typebox');
    f.engine.tools.register('test_effect', 'Effect', Type.Object({}), 'collaborate', () => { effects++; return 'done'; });
    await f.engine.tools.execute(a, 'test_effect', {}, 'persistent-id');
    const key = `${f.session.id}:${a.id}:persistent-id`;
    const operation = f.repo.get<{ id: string; sessionId: string; state: string }>('operation', key)!;
    operation.state = 'prepared'; f.repo.put('operation', operation);
    f.repo.db.prepare('DELETE FROM tool_results WHERE id=?').run(key);
    const result = await f.engine.tools.execute(a, 'test_effect', {}, 'persistent-id') as { ok: boolean; data: string };
    assert.equal(result.ok, false); assert.match(result.data, /uncertain/); assert.equal(effects, 1);
  } finally { await f.close(); }
});

test('project identity survives session restoration independently of the launch folder', async () => {
  const f = fixture();
  try {
    const session = Engine.create(f.repo, join(f.home, 'workspaces'), 'Project identity', { projectRoot: f.home });
    const restored = new Engine(f.repo, session.id, async () => noop);
    assert.equal(restored.session().projectRoot, f.home); await restored.close();
  } finally { await f.close(); }
});

test('literal patches preserve unrelated content and reject ambiguous or stale matches', async () => {
  const f = fixture();
  try {
    const a = await f.engine.addAgent({ name: 'Editor', provider: 'test', model: 'test', permissions: ['workspace.read', 'workspace.write'] }, false);
    const created = await tool<{ sha256: string }>(f.engine, a, 'workspace_write', { path: 'patch.txt', content: 'header\nold\nfooter' });
    const args = { path: 'patch.txt', before: 'old', after: 'new', expectedHash: created.data.sha256 };
    assert.equal((await tool(f.engine, a, 'workspace_patch', args)).ok, true);
    assert.equal(readFileSync(join(f.session.workspace, 'patch.txt'), 'utf8'), 'header\nnew\nfooter');
    assert.equal((await tool(f.engine, a, 'workspace_patch', args)).ok, false);
    const current = await tool<{ sha256: string }>(f.engine, a, 'workspace_read', { path: 'patch.txt' });
    assert.equal((await tool(f.engine, a, 'workspace_patch', { ...args, expectedHash: current.data.sha256, before: 'e' })).ok, false);
  } finally { await f.close(); }
});

test('completion notifications persist while paused and deliver once on resume', async () => {
  const received: string[] = []; const f = fixture(async () => ({ ...noop, prompt: async text => { received.push(text); } }));
  try {
    const a = await agent(f.engine); await f.engine.pause();
    f.engine.notify(a.id, 'job:example', 'Inspect the finished job');
    f.engine.notify(a.id, 'job:example', 'Inspect the finished job');
    await f.engine.idle(); assert.equal(received.length, 0);
    f.engine.resume(); await f.engine.idle(); assert.equal(received.length, 1);
    assert.match(received[0]!, /Inspect the finished job/);
    f.engine.notify(a.id, 'job:example', 'Inspect the finished job'); await f.engine.idle(); assert.equal(received.length, 1);
  } finally { await f.close(); }
});

test('concurrent live tools are not mistaken for interrupted operations', async () => {
  const f = fixture();
  try {
    const a = await agent(f.engine); const b = await agent(f.engine, 'B'); const { Type } = await import('typebox');
    let finish!: () => void; const pending = new Promise<void>(r => { finish = r; });
    f.engine.tools.register('test_wait', 'Wait', Type.Object({}), 'collaborate', () => pending);
    const running = tool(f.engine, a, 'test_wait');
    assert.equal((await tool(f.engine, b, 'data_json_validate', { content: '{"value":42}' })).ok, true);
    finish(); assert.equal((await running).ok, true);
  } finally { await f.close(); }
});

test('paused queue editing preserves original history and delivers only the replacement', async () => {
  const received: string[] = []; const f = fixture(async () => ({ ...noop, prompt: async text => { received.push(text); } }), { limits: { queue: 1 } });
  try {
    const a = await agent(f.engine); await f.engine.pause();
    const original = f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body: 'Old instructions' });
    const next = f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body: 'Corrected instructions', correlationId: original.id }, original.id);
    assert.equal(f.engine.queuedHumanMessages()[0]?.id, next.id);
    assert.equal(f.repo.message(original.id)?.body, 'Old instructions');
    f.engine.resume(); await f.engine.idle(); assert.equal(received.length, 1); assert.match(received[0]!, /Corrected instructions/);
    assert.equal(f.repo.deliveries(f.session.id, ['cancelled']).length, 1);
  } finally { await f.close(); }
});
