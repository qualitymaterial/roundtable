import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, agent, tool, noop } from './helpers.js';
import { requireValidation, validateContract, recoveryReport, repairTask, taskValidation } from '../src/recovery.js';
import { completionReport } from '../src/completion.js';
import { providerFailure, recoverProvider, setFallback } from '../src/provider-recovery.js';
import type { Task, Artifact } from '../src/domain.js';
import { createServer } from 'node:http';
import { ProviderRegistry } from '../src/providers.js';
import { PiAdapter } from '../src/pi-adapter.js';
import { parseSandboxArgv } from '../src/sandbox.js';

test('required checks bind current artifact hashes, reject self review, and gate completion', async () => {
  const f = fixture(); try {
    const writer = await agent(f.engine); const reviewer = await agent(f.engine, 'Independent');
    const task = (await tool<Task>(f.engine, writer, 'roundtable_task_create', { title: 'Deliver a result' })).data;
    await tool(f.engine, writer, 'roundtable_task_claim', { taskId: task.id });
    const check = requireValidation(f.engine, { taskId: task.id, artifactName: 'result.json', description: 'Expected answer', validator: { kind: 'json', required: ['answer'], equals: { answer: 42 } } });
    const a = (await tool<Artifact>(f.engine, writer, 'roundtable_artifact_publish', { name: 'result.json', content: '{"answer":42}', provenance: 'test' })).data;
    assert.equal((await tool(f.engine, writer, 'roundtable_task_update', { taskId: task.id, state: 'done', findings: 'claimed success' })).ok, false);
    await assert.rejects(() => validateContract(f.engine, check.id, a.id, writer.id), /different participant/);
    assert.equal((await validateContract(f.engine, check.id, a.id, reviewer.id)).passed, true);
    assert.equal((await tool(f.engine, writer, 'roundtable_task_update', { taskId: task.id, state: 'done', findings: 'verified' })).ok, true);
    await tool(f.engine, writer, 'roundtable_artifact_publish', { name: 'result.json', content: '{"answer":0}', provenance: 'new version' });
    assert.equal(taskValidation(f.engine, task.id)[0]?.passed, false);
    assert.ok(completionReport(f.engine).failures.some(e => e.kind === 'required validation'));
  } finally { await f.close(); }
});

test('sandbox argument entry preserves quoted values without shell expansion', () => {
  assert.deepEqual(parseSandboxArgv('/bin/sh -c "echo $HOME; echo done"'), ['/bin/sh', '-c', 'echo $HOME; echo done']);
  assert.deepEqual(parseSandboxArgv("python3 -c 'print(42)'"), ['python3', '-c', 'print(42)']);
  assert.throws(() => parseSandboxArgv('/bin/sh "broken'), /Unclosed/);
});

test('real Pi HTTP admission surfaces expired authentication and keeps the participant paused', { timeout: 20000 }, async () => {
  const server = createServer((_request, response) => { response.writeHead(401, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'Token expired; log in again', type: 'authentication_error' } })); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  let registry: ProviderRegistry; const f = fixture((a, engine) => PiAdapter.create(registry, a, engine));
  try {
    registry = await ProviderRegistry.create(f.home); const address = server.address(); assert.ok(address && typeof address !== 'string');
    registry.addEndpoint({ provider: 'expired-fixture', baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'test-model', contextWindow: 32000 });
    await assert.rejects(f.engine.addAgent({ name: 'Expired', provider: 'expired-fixture', model: 'test-model' }), error => providerFailure(error).category === 'authentication');
    assert.equal(f.engine.agents()[0]?.state, 'paused'); assert.equal(f.repo.deliveries(f.session.id).length, 0);
  } finally { await f.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
test('recovery diagnoses stalled claims and cancelled dependencies; repair rejects cycles and needs pause', async () => {
  const f = fixture(); try {
    const a = await agent(f.engine);
    const first = (await tool<Task>(f.engine, a, 'roundtable_task_create', { title: 'First' })).data;
    const second = (await tool<Task>(f.engine, a, 'roundtable_task_create', { title: 'Second', dependencies: [first.id] })).data;
    await tool(f.engine, a, 'roundtable_task_claim', { taskId: first.id });
    assert.ok(recoveryReport(f.engine, 1, Date.now() + 1000).some(t => t.taskId === first.id));
    assert.throws(() => repairTask(f.engine, first.id, 'release', 'reassign'), /Pause/);
    await f.engine.pause();
    assert.throws(() => repairTask(f.engine, first.id, 'dependencies', 'bad graph', [second.id]), /cycle/);
    repairTask(f.engine, first.id, 'cancel', 'obsolete');
    assert.ok(recoveryReport(f.engine).some(t => t.taskId === second.id));
    repairTask(f.engine, second.id, 'dependencies', 'removed obsolete prerequisite', []);
    assert.equal(recoveryReport(f.engine).length, 0);
  } finally { await f.close(); }
});
test('provider fallback preserves identity and failed deliveries; failed probes keep previous model', async () => {
  const f = fixture(async a => { if (a.model === 'broken') throw new Error('401 expired token'); return { ...noop, prompt: async () => { throw new Error('503 unavailable'); } }; });
  try {
    const a = await agent(f.engine); f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body: 'work' }); await f.engine.idle();
    setFallback(f.engine, a.id, 'other', 'broken'); await assert.rejects(recoverProvider(f.engine, a.id, true), /401/);
    assert.equal(f.engine.agents()[0]?.model, a.model);
    setFallback(f.engine, a.id, 'other', 'available'); await recoverProvider(f.engine, a.id, true);
    assert.equal(f.engine.agents()[0]?.id, a.id); assert.equal(f.engine.agents()[0]?.model, 'available');
    assert.equal(f.repo.deliveries(f.session.id, ['failed']).length, 1);
    assert.equal(providerFailure('401 expired token').category, 'authentication');
    assert.equal(providerFailure('429 quota').category, 'capacity');
    assert.equal(providerFailure('503 unavailable').category, 'unavailable');
  } finally { await f.close(); }
});
