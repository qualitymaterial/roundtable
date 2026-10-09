import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { Repository } from '../src/storage.js';
import { Engine } from '../src/engine.js';
import { ProviderRegistry } from '../src/providers.js';
import { PiAdapter } from '../src/pi-adapter.js';
import { runDemo, mockStream, registerMock, validateMemoryArtifact } from '../src/demo.js';
import { type AgentRecord, type Artifact, type Task } from '../src/domain.js';
import { fixture, agent, noop, tool } from './helpers.js';

test('three independent Pi sessions exchange tool findings, update tasks and persist a validated artifact', async () => {
  const home = mkdtempSync(join(tmpdir(), 'roundtable-pi-')); const dbPath = join(home, 'test.db'); let repo = new Repository(dbPath);
  try {
    const result = await runDemo(repo, home);
    assert.equal(result.validation.valid, true);
    const members = repo.list<AgentRecord>('agent', result.sessionId); assert.equal(members.length, 3);
    const messages = repo.messages(result.sessionId); const alpha = members.find(a => a.model === 'alpha')!; const beta = members.find(a => a.model === 'beta')!;
    assert.ok(messages.some(m => m.sender === alpha.id && m.recipients.includes(beta.id)));
    assert.ok(messages.some(m => m.sender === beta.id && m.recipients.includes(alpha.id)));
    const activity = repo.events(result.sessionId).filter(e => e.type === 'tool_result');
    assert.equal(new Set(activity.map(e => (e.data as { agentId: string }).agentId)).size, 3);
    const paths = members.map(m => join(home, 'sessions', result.sessionId, m.id));
    const contexts = paths.map(path => readFileSync(join(path, readdirSync(path).find(name => name.endsWith('.jsonl'))!), 'utf8'));
    assert.equal(contexts.length, 3); assert.notEqual(contexts[0], contexts[1]);
    assert.ok(contexts[1]?.includes('Please compare JSONL')); assert.equal(contexts[1]?.includes('Contribute an independent artifact'), false);
    const originalMessages = messages.length; repo.close(); repo = new Repository(dbPath);
    assert.equal(repo.messages(result.sessionId).length, originalMessages);
    assert.equal(repo.list<Task>('task', result.sessionId)[0]?.state, 'done');
    assert.equal(validateMemoryArtifact(repo.list<Artifact>('artifact', result.sessionId)[0]!).valid, true);
    const registry = await ProviderRegistry.create(home); await registerMock(registry);
    const restored = new Engine(repo, result.sessionId, PiAdapter.factory(registry, mockStream));
    try { await restored.connect(); assert.equal(restored.agents().length, 3); assert.equal(repo.deliveries(result.sessionId).length, 0); }
    finally { await restored.close(); }
  } finally { repo.close(); rmSync(home, { recursive: true, force: true }); }
});
test('routing is asynchronous, bounded and ordered per agent with global concurrency', async () => {
  const seen = new Map<string, string[]>(); let running = 0; let peak = 0;
  const f = fixture(async actor => ({ ...noop, prompt: async text => {
    running++; peak = Math.max(peak, running); const input = JSON.parse(text) as { incoming: { body: string } };
    seen.set(actor.id, [...(seen.get(actor.id) ?? []), input.incoming.body]);
    await new Promise(r => setTimeout(r, 30)); running--;
  } }), { limits: { concurrency: 2 } });
  try {
    const a = await agent(f.engine, 'A'); const b = await agent(f.engine, 'B'); const c = await agent(f.engine, 'C');
    const first = f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: ['*'], type: 'human', body: 'first' });
    const second = f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: ['*'], type: 'human', body: 'second' });
    assert.ok(second.sequence > first.sequence); assert.equal(running, 0); await f.engine.idle();
    assert.equal(peak, 2); for (const actor of [a, b, c]) assert.deepEqual(seen.get(actor.id), ['first', 'second']);
    assert.equal(f.repo.deliveries(f.session.id, ['acknowledged']).length, 6);
  } finally { await f.close(); }
});
test('inflight delivery recovers after reopen and failure requires explicit retry', async () => {
  const f = fixture(); let restored: Engine | undefined;
  try {
    const a = await agent(f.engine); const m = f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body: 'recover' });
    f.repo.delivery(m.id, a.id, 'inflight'); await f.engine.close();
    let fail = true;
    restored = new Engine(f.repo, f.session.id, async () => ({ ...noop, prompt: async () => { if (fail) throw new Error('provider unavailable'); } }));
    assert.equal(f.repo.deliveries(f.session.id)[0]?.messageId, m.id); await restored.connect(); await restored.idle();
    assert.equal(f.repo.deliveries(f.session.id, ['failed']).length, 1); fail = false; restored.retryFailed(); await restored.idle();
    assert.equal(f.repo.deliveries(f.session.id, ['acknowledged']).length, 1);
  } finally { await restored?.close(); await f.close(); }
});
test('permission denial is audited without mutating the workspace', async () => {
  const f = fixture(); try {
    const a = await agent(f.engine); const response = await tool(f.engine, a, 'workspace_write', { path: 'forbidden.txt', content: 'x' });
    assert.equal(response.ok, false); assert.deepEqual(readdirSync(f.session.workspace), []);
    assert.ok(f.repo.events(f.session.id).some(e => e.type === 'tool_result' && JSON.stringify(e.data).includes('Permission denied')));
  } finally { await f.close(); }
});
test('pause cancels active work and resume redelivers an unacknowledged message', async () => {
  let release: (() => void) | undefined; let entered: (() => void) | undefined; const start = new Promise<void>(r => { entered = r; }); let calls = 0;
  const f = fixture(async () => ({ ...noop, prompt: async () => { calls++; entered?.(); if (calls === 1) await new Promise<void>(r => { release = r; }); }, abort: async () => { release?.(); } }));
  try {
    const a = await agent(f.engine); f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body: 'cancel me' });
    await start; await f.engine.pause(); await f.engine.idle(); assert.equal(f.repo.deliveries(f.session.id).length, 1);
    f.engine.resume(); await f.engine.idle(); assert.equal(calls, 2); assert.equal(f.repo.deliveries(f.session.id, ['acknowledged']).length, 1);
  } finally { await f.close(); }
});
test('recursive messaging stops at the exchange budget; identical loops are suppressed', async () => {
  const f = fixture(async (actor, engine) => ({ ...noop, prompt: async text => {
    const input = JSON.parse(text) as { incoming: { sender: string } };
    const peer = engine.agents().find(a => a.id !== actor.id)!;
    if (input.incoming.sender) engine.send({ sessionId: engine.sessionId, sender: actor.id, recipients: [peer.id], type: 'direct', body: `turn-${engine.session().usage.exchanges}` });
  } }), { limits: { exchanges: 8 } });
  try {
    const a = await agent(f.engine, 'A'); await agent(f.engine, 'B');
    f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body: 'start' });
    await f.engine.idle(); assert.equal(f.engine.session().state, 'paused'); assert.equal(f.engine.session().usage.exchanges, 8);
  } finally { await f.close(); }
});
test('provider protocol probe rejects text-only endpoints and checks result receipt', async () => {
  const home = mkdtempSync(join(tmpdir(), 'roundtable-provider-'));
  try {
    const registry = await ProviderRegistry.create(home); await registerMock(registry);
    registry.runtime.registerProvider('probe-fixture', { baseUrl: 'http://127.0.0.1:1', api: 'openai-completions', apiKey: 'test-only', models: [{ id: 'probe-model', name: 'fixture', reasoning: false, input: ['text'], contextWindow: 32000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }], streamSimple: (model, context) => {
      const stream = createAssistantMessageEventStream();
      const response: AssistantMessage = { role: 'assistant', content: [{ type: 'text', text: 'No tool support' }], provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(), stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      if (context.messages.some(m => m.role === 'toolResult')) response.content = [{ type: 'text', text: context.messages.filter(m => m.role === 'toolResult').map(m => m.content.filter(c => c.type === 'text').map(c => c.text).join('')).join('') }];
      stream.push({ type: 'start', partial: response }); stream.push({ type: 'done', reason: 'stop', message: response }); return stream;
    } });
    await assert.rejects(registry.validate('probe-fixture', 'probe-model'), /Tool compatibility failed/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('CLI subprocesses create, export, validate and restore a demo after process exit', () => {
  const home = mkdtempSync(join(tmpdir(), 'roundtable-cli-'));
  const run = (args: string[], input?: string) => spawnSync(process.execPath, [resolve('dist/cli.js'), ...args], { encoding: 'utf8', input, env: { ...process.env, ROUNDTABLE_HOME: home }, timeout: 60000 });
  try {
    assert.equal(run(['--help']).status, 0); assert.equal(run(['init']).status, 0); assert.equal(run(['doctor']).status, 0);
    const empty = run([], 'Empty session\nhello\n/status\n/exit\n');
    assert.equal(empty.status, 0, empty.stdout + empty.stderr);
    assert.ok(empty.stdout.includes('No agents connected; message was not sent'));
    assert.ok(!empty.stdout.includes('[message] human'));
    const missing = run(['--agents', join(home, 'missing.json')], 'Objective\n/exit\n');
    assert.equal(missing.status, 1); assert.ok(missing.stdout.includes('[error]'));
    const demo = run(['demo']); assert.equal(demo.status, 0, demo.stderr + demo.stdout);
    const match = demo.stdout.match(/"sessionId": "([a-f0-9-]+)"/g)?.at(-1)?.match(/[a-f0-9-]{36}/)?.[0]; assert.ok(match);
    assert.equal(run(['session', 'list']).status, 0); assert.equal(run(['validate', match]).status, 0);
    const verified = run(['session', 'verify', match]); assert.equal(verified.status, 0, verified.stderr + verified.stdout);
    assert.equal(JSON.parse(verified.stdout).matchesLastAcceptance, true);
    const output = join(home, 'export.json'); assert.equal(run(['session', 'export', match, output]).status, 0);
    const exported = JSON.parse(readFileSync(output, 'utf8')) as { agents: unknown[]; tasks: Task[] }; assert.equal(exported.agents.length, 3); assert.equal(exported.tasks[0]?.state, 'done');
    const resumed = run(['session', 'resume', match], '/status\n/exit\n'); assert.equal(resumed.status, 0, resumed.stderr); assert.ok(resumed.stdout.includes('"objective"'));
  } finally { rmSync(home, { recursive: true, force: true }); }
});
