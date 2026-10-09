import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, symlink, writeFile, realpath } from 'node:fs/promises';
import { Type } from 'typebox';
import { AgentInput, Limits, id, redact, type Approval, type Artifact, type Task } from '../src/domain.js';
import { workspacePath } from '../src/tools.js';
import { fixture, agent, tool, noop } from './helpers.js';

test('schema boundaries reject malformed agents, budgets and messages', async () => {
  assert.throws(() => AgentInput.parse({ name: '', provider: 'x', model: 'x' }));
  assert.throws(() => Limits.parse({ concurrency: 0 }));
  const f = fixture(); try { await agent(f.engine); assert.throws(() => f.engine.send({ sender: 'human', sessionId: f.session.id, recipients: ['missing'], type: 'human', body: 'Hello' })); } finally { await f.close(); }
});
test('message IDs deduplicate, reject collisions and preserve deterministic order', async () => {
  const f = fixture(); try {
    const a = await agent(f.engine); await f.engine.pause();
    const s = f.engine.session(); s.state = 'active'; f.repo.put('session', s);
    const input = { id: id(), sessionId: s.id, sender: 'human', recipients: [a.id], type: 'human' as const, body: 'one' };
    const first = f.engine.send(input); const duplicate = f.engine.send(input);
    assert.equal(first.sequence, duplicate.sequence); assert.equal(f.repo.messages(s.id).length, 1);
    assert.throws(() => f.engine.send({ ...input, body: 'collision' }), /collision/);
    const second = f.engine.send({ ...input, id: id(), body: 'two' }); assert.ok(second.sequence > first.sequence);
    assert.equal(f.repo.deliveries(s.id).length, 2);
  } finally { await f.close(); }
});
test('agent lifecycle preserves identity and tool permissions are checked against fresh state', async () => {
  const f = fixture(); try {
    const a = await agent(f.engine); await f.engine.setAgentState(a.id, 'paused');
    assert.equal((await tool(f.engine, a, 'roundtable_agents_list')).ok, false);
    await f.engine.setAgentState(a.id, 'active'); assert.equal((await tool(f.engine, a, 'roundtable_agents_list')).ok, true);
    await f.engine.setAgentState(a.id, 'removed'); assert.equal(f.engine.agents()[0]?.id, a.id);
  } finally { await f.close(); }
});

test('failed agent resumption remains paused and reconnect does not duplicate adapters', async () => {
  let fail = false; let created = 0;
  const f = fixture(async () => { if (fail) throw new Error('Admission unavailable'); created++; return noop; });
  try {
    const a = await agent(f.engine);
    await f.engine.connect(); await f.engine.connect(); assert.equal(created, 1);
    await f.engine.setAgentState(a.id, 'paused'); fail = true;
    await assert.rejects(f.engine.setAgentState(a.id, 'active'), /Admission unavailable/);
    assert.equal(f.engine.agents()[0]?.state, 'paused');
    fail = false; await f.engine.setAgentState(a.id, 'active'); assert.equal(created, 2);
  } finally { await f.close(); }
});
test('registry supports registration, schema validation and removal', async () => {
  const f = fixture(); try {
    const a = await agent(f.engine); f.engine.tools.register('example_sum', 'Sum', Type.Object({ x: Type.Number(), y: Type.Number() }), 'collaborate', args => args.x + args.y);
    assert.equal((await tool<number>(f.engine, a, 'example_sum', { x: 2, y: 3 })).data, 5);
    assert.equal((await tool(f.engine, a, 'example_sum', { x: '2' })).ok, false);
    assert.throws(() => f.engine.tools.register('example_sum', '', Type.Object({}), 'collaborate', () => 0));
    f.engine.tools.remove('example_sum'); assert.equal((await tool(f.engine, a, 'example_sum', { x: 1, y: 1 })).ok, false);
  } finally { await f.close(); }
});
test('approval requires a human decision and session policy is an upper bound', async () => {
  const f = fixture(); try {
    const a = await agent(f.engine);
    assert.equal((await tool(f.engine, a, 'workspace_write', { path: 'a.txt', content: 'hello' })).ok, false);
    const request = await tool<Approval>(f.engine, a, 'roundtable_tool_request', { capability: 'workspace.write', reason: 'Create output' });
    assert.equal(f.engine.agents()[0]?.permissions.includes('workspace.write'), false);
    f.engine.decide(request.data.id, true);
    assert.equal((await tool(f.engine, a, 'workspace_write', { path: 'a.txt', content: 'hello' })).ok, true);
    const no = await tool<Approval>(f.engine, a, 'roundtable_tool_request', { capability: 'unrestricted.shell', reason: 'test' });
    assert.throws(() => f.engine.decide(no.data.id, true), /policy/); f.engine.decide(no.data.id, false);
  } finally { await f.close(); }
});
test('task transitions enforce atomic claims, dependencies and owner completion', async () => {
  const f = fixture(); try {
    const a = await agent(f.engine, 'A'); const b = await agent(f.engine, 'B');
    const first = (await tool<Task>(f.engine, a, 'roundtable_task_create', { title: 'Evidence' })).data;
    const next = (await tool<Task>(f.engine, b, 'roundtable_task_create', { title: 'Synthesis', dependencies: [first.id] })).data;
    assert.equal((await tool(f.engine, b, 'roundtable_task_claim', { taskId: next.id })).ok, false);
    const claims = await Promise.all([tool(f.engine, a, 'roundtable_task_claim', { taskId: first.id }), tool(f.engine, b, 'roundtable_task_claim', { taskId: first.id })]);
    assert.deepEqual(claims.map(c => c.ok), [true, false]);
    assert.equal((await tool(f.engine, b, 'roundtable_task_update', { taskId: first.id, findings: 'Independent finding' })).ok, true);
    assert.equal((await tool(f.engine, b, 'roundtable_task_update', { taskId: first.id, findings: 'Unauthorized completion', state: 'done' })).ok, false);
    assert.equal((await tool(f.engine, a, 'roundtable_task_update', { taskId: first.id, findings: 'Validated', state: 'done' })).ok, true);
    assert.equal((await tool(f.engine, b, 'roundtable_task_claim', { taskId: next.id })).ok, true);
    assert.equal((await tool(f.engine, a, 'roundtable_task_create', { title: 'Bad dependency', dependencies: ['missing'] })).ok, false);
  } finally { await f.close(); }
});
test('artifact integrity and session isolation are enforced', async () => {
  const f = fixture(); const other = fixture(); try {
    const a = await agent(f.engine); const artifact = (await tool<Artifact>(f.engine, a, 'roundtable_artifact_publish', { name: 'evidence', content: 'Verified evidence', provenance: 'test fixture' })).data;
    assert.equal((await tool<Artifact>(f.engine, a, 'roundtable_artifact_read', { artifactId: artifact.id })).data.hash, artifact.hash);
    const tampered = { ...artifact, content: 'tampered' }; f.repo.put('artifact', tampered);
    assert.equal((await tool(f.engine, a, 'roundtable_artifact_read', { artifactId: artifact.id })).ok, false);
    f.repo.put('artifact', { ...artifact, sessionId: other.session.id });
    assert.equal((await tool(f.engine, a, 'roundtable_artifact_read', { artifactId: artifact.id })).ok, false);
  } finally { await f.close(); await other.close(); }
});
test('workspace paths reject traversal, hidden files, absolute paths, ADS and symlinks', async () => {
  const f = fixture(); try {
    for (const path of ['../secret', '.env', 'C:/Windows/test', 'safe.txt:stream', 'a/../../secret', 'auth.json', 'a\\b', '/etc/passwd']) await assert.rejects(workspacePath(f.session.workspace, path));
    assert.equal(await workspacePath(f.session.workspace, 'output.txt'), join(await realpath(f.session.workspace), 'output.txt'));
    const outside = join(f.home, 'outside'); await mkdir(outside); await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(outside, join(f.session.workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(workspacePath(f.session.workspace, 'escape/secret.txt'), /Symlinks/);
  } finally { await f.close(); }
});
test('tool calls are idempotent by agent and call ID', async () => {
  const f = fixture(); try {
    const a = await agent(f.engine); const callId = id();
    const one = await f.engine.tools.execute(a, 'roundtable_memory_write', { text: 'one' }, callId);
    const two = await f.engine.tools.execute(a, 'roundtable_memory_write', { text: 'one' }, callId);
    assert.deepEqual(one, two); assert.equal(f.repo.list('note', f.session.id).length, 1);
  } finally { await f.close(); }
});
test('resource budgets pause without losing committed messages', async () => {
  const f = fixture(undefined, { limits: { exchanges: 1 } }); try {
    const a = await agent(f.engine); const send = (body: string) => f.engine.send({ sender: 'human', sessionId: f.session.id, recipients: [a.id], type: 'human', body });
    send('one'); assert.throws(() => send('two'), /Budget/); assert.equal(f.engine.session().state, 'paused'); assert.equal(f.repo.messages(f.session.id).length, 1);
  } finally { await f.close(); }
});
test('redaction removes configured credentials and bearer tokens', () => {
  const key = 'roundtable-fixture-secret-123'; process.env.ROUNDTABLE_TEST_TOKEN = key;
  try { assert.equal(redact(`prefix ${key} Bearer abcdefghijklm`), 'prefix [REDACTED] [REDACTED]'); } finally { delete process.env.ROUNDTABLE_TEST_TOKEN; }
});
