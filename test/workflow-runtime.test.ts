import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, agent, tool } from './helpers.js';
import { advanceStage, stageStatus } from '../src/policy.js';
import { completionReport } from '../src/completion.js';
import { tasksView, artifactsView, summaryView, usageView, transcriptView } from '../src/views.js';
import { AgentInput } from '../src/domain.js';
import { ProviderRegistry } from '../src/providers.js';
import { PiAdapter } from '../src/pi-adapter.js';
import { registerMock, mockStream } from '../src/demo.js';

test('blind stages enforce sharing barriers, artifact requirements and human advancement', async () => {
  const f = fixture(undefined, { stages: [{ name: 'Explore', objective: 'Independent designs', blind: true, requireArtifact: true }, { name: 'Compare', objective: 'Compare evidence' }] });
  try {
    const a = await agent(f.engine, 'A'); const b = await agent(f.engine, 'B');
    assert.throws(() => f.engine.send({ sessionId: f.session.id, sender: a.id, recipients: [b.id], type: 'direct', body: 'Spoiler' }), /independent/);
    assert.equal((await tool(f.engine, a, 'roundtable_thread_read', { threadId: 'main' })).ok, false);
    assert.equal((await tool(f.engine, a, 'roundtable_stage_ready')).ok, false);
    for (const actor of [a, b]) {
      assert.equal((await tool(f.engine, actor, 'roundtable_artifact_publish', { name: `${actor.name} design`, content: `Independent ${actor.name}`, provenance: 'Reasoning' })).ok, true);
      assert.equal((await tool(f.engine, actor, 'roundtable_stage_ready')).ok, true);
      if (actor === a) assert.throws(() => advanceStage(f.engine), /all participants/);
    }
    assert.equal(stageStatus(f.engine)?.waiting.length, 0);
    advanceStage(f.engine); await f.engine.idle();
    assert.equal(stageStatus(f.engine)?.current?.name, 'Compare');
    assert.equal((await tool(f.engine, a, 'roundtable_thread_read', { threadId: 'main' })).ok, true);
    assert.equal(completionReport(f.engine).stage?.history.length, 1);
    assert.doesNotThrow(() => f.engine.send({ sessionId: f.session.id, sender: a.id, recipients: [b.id], type: 'direct', body: 'Compare now' }));
    await f.engine.idle();
  } finally { await f.close(); }
});

test('readable views show user results and filtered conversation without serializing records', async () => {
  const f = fixture();
  try {
    const a = await agent(f.engine, 'Explorer');
    await tool(f.engine, a, 'roundtable_task_create', { title: 'Compare designs' });
    await tool(f.engine, a, 'roundtable_artifact_publish', { name: 'Design', content: 'Verified result', provenance: 'Independent check' });
    f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body: 'Find evidence' });
    await f.engine.idle();
    assert.match(tasksView(f.engine).join('\n'), /OPEN  Compare designs/);
    assert.match(artifactsView(f.engine).join('\n'), /Design  \/  Explorer/);
    assert.match(summaryView(f.engine).join('\n'), /1 open · 1 artifacts/);
    assert.match(usageView(f.engine).join('\n'), /estimated/);
    assert.match(transcriptView(f.engine, 'evidence').join('\n'), /Find evidence/);
    assert.deepEqual(transcriptView(f.engine, 'unrelated'), []);
  } finally { await f.close(); }
});

test('model controls are validated and survive participant replacement', async () => {
  const f = fixture();
  try {
    assert.equal(AgentInput.safeParse({ name: 'A', provider: 'test', model: 'test', effort: 'imaginary' }).success, false);
    const a = await agent(f.engine);
    await f.engine.changeModel(a.id, a.provider, a.model, { effort: 'high', maxOutputTokens: 2048, contextWindowTokens: 16000 });
    const current = f.engine.agents()[0]!;
    assert.equal(current.id, a.id); assert.equal(current.effort, 'high'); assert.equal(current.maxOutputTokens, 2048);
  } finally { await f.close(); }
});

test('evidence and independent JSON checks bind to the actual artifact hash', async () => {
  const f = fixture();
  try {
    const a = await agent(f.engine, 'Author'); const b = await agent(f.engine, 'Peer');
    const artifact = (await tool<{ id: string; hash: string }>(f.engine, a, 'roundtable_artifact_publish', { name: 'Data', content: '{"answer":42}', provenance: 'Fixture calculation' })).data;
    const args = { artifactId: artifact.id, requiredFields: ['answer'] };
    assert.equal((await tool(f.engine, a, 'roundtable_artifact_validate_json', args)).ok, false);
    assert.equal((await tool(f.engine, b, 'roundtable_artifact_validate_json', { ...args, requiredFields: ['missing'] })).ok, false);
    const verified = await tool<{ hash: string }>(f.engine, b, 'roundtable_artifact_validate_json', args);
    assert.equal(verified.ok, true); assert.equal(verified.data.hash, artifact.hash);
    const finding = await tool<{ artifacts: { hash: string }[] }>(f.engine, b, 'roundtable_evidence_add', { kind: 'finding', claim: 'Expected field exists; semantic accuracy not tested.', artifacts: [artifact.id] });
    assert.equal(finding.data.artifacts[0]?.hash, artifact.hash);
    assert.equal(completionReport(f.engine).checks.length, 1);
  } finally { await f.close(); }
});

test('real Pi SDK activates only permitted configured tools and rejects unsupported model controls', async () => {
  const f = fixture();
  try {
    const registry = await ProviderRegistry.create(f.home); await registerMock(registry);
    const a = await f.engine.addAgent({ name: 'A', provider: 'roundtable-mock', model: 'alpha', permissions: ['collaborate'], maxOutputTokens: 1024 }, false);
    const adapter = await PiAdapter.create(registry, a, f.engine, mockStream);
    try {
      assert.ok(adapter.session.getActiveToolNames().includes('roundtable_send'));
      assert.ok(!adapter.session.getActiveToolNames().includes('workspace_write'));
      assert.ok(!adapter.session.getActiveToolNames().includes('host_execute'));
    } finally { adapter.dispose(); }
    await assert.rejects(PiAdapter.create(registry, { ...a, effort: 'high' }, f.engine, mockStream), /unsupported/);
    await assert.rejects(PiAdapter.create(registry, { ...a, maxOutputTokens: 9999999 }, f.engine, mockStream), /maximum/);
  } finally { await f.close(); }
});
