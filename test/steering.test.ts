import test from 'node:test';
import assert from 'node:assert/strict';
import { Type } from 'typebox';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { ProviderRegistry } from '../src/providers.js';
import { PiAdapter, type ModelStream } from '../src/pi-adapter.js';
import { Engine } from '../src/engine.js';
import { fixture, agent, noop } from './helpers.js';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

test('real independent Pi session consumes steering at a tool boundary exactly once', async () => {
  const started = deferred(); const release = deferred();
  let calls = 0; const contexts: string[] = []; let registry: ProviderRegistry;
  const stream: ModelStream = (model, context) => {
    contexts.push(JSON.stringify(context.messages)); calls++;
    const response: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), content: calls === 1 ? [{ type: 'toolCall', id: 'block-once', name: 'fixture_wait', arguments: {} }] : [{ type: 'text', text: 'Followed revised instruction' }], stopReason: calls === 1 ? 'toolUse' : 'stop', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const events = createAssistantMessageEventStream(); events.push({ type: 'start', partial: response }); events.push({ type: 'done', reason: response.stopReason === 'toolUse' ? 'toolUse' : 'stop', message: response }); return events;
  };
  const f = fixture(async (a, engine) => PiAdapter.create(registry, a, engine, stream));
  try {
    registry = await ProviderRegistry.create(f.home);
    registry.runtime.registerProvider('steer-fixture', { baseUrl: 'http://127.0.0.1:1', api: 'openai-completions', apiKey: 'nonsecret-fixture', models: [{ id: 'fixture', name: 'Fixture', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
    f.engine.tools.register('fixture_wait', 'Deterministic tool boundary fixture', Type.Object({}), 'collaborate', async () => { started.resolve(); await release.promise; return 'tool finished'; });
    const a = await f.engine.addAgent({ name: 'One', provider: 'steer-fixture', model: 'fixture' }, false);
    f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body: 'Start' });
    await started.promise;
    const update = await f.engine.steer('Use the revised design', [a.id]); assert.equal(update.steering, 1); assert.equal(update.queued, 0);
    assert.equal(f.repo.deliveries(f.session.id, ['inflight']).filter(d => d.messageId === update.message.id).length, 1);
    release.resolve(); await f.engine.idle();
    assert.equal(calls, 2); assert.match(contexts[1]!, /Use the revised design/);
    assert.equal(f.repo.deliveries(f.session.id, ['acknowledged']).filter(d => d.messageId === update.message.id).length, 1);
    assert.equal(f.repo.list<{ state: string }>('steering', f.session.id)[0]?.state, 'delivered');
  } finally { release.resolve(); await f.close(); }
});

test('idle and unsupported agents receive steering as an ordinary durable next turn', async () => {
  const seen: string[] = []; const f = fixture(async () => ({ ...noop, prompt: async body => { seen.push(JSON.parse(body).incoming.body); } }));
  try {
    const a = await agent(f.engine); await f.engine.pause();
    const result = await f.engine.steer('Review instead', [a.id]); assert.equal(result.queued, 1); assert.equal(result.steering, 0);
    assert.equal(f.engine.queuedHumanMessages().length, 1); f.engine.resume(); await f.engine.idle(); assert.deepEqual(seen, ['Review instead']);
  } finally { await f.close(); }
});

test('unconsumed steering returns to durable queue on pause and crash-uncertain steering is not replayed', async () => {
  const started = deferred(); const released = deferred();
  const f = fixture(async () => ({ ...noop, prompt: async () => { started.resolve(); await released.promise; }, steer: async () => true, abort: async () => { released.resolve(); } }));
  try {
    const a = await agent(f.engine);
    f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body: 'First' }); await started.promise;
    const next = await f.engine.steer('Changed direction', [a.id]); await f.engine.pause(); await f.engine.idle();
    assert.ok(f.engine.queuedHumanMessages().some(m => m.id === next.message.id));
    await f.engine.close();
    const record = { id: `${next.message.id}:${a.id}`, sessionId: f.session.id, agentId: a.id, messageId: next.message.id, state: 'queued' };
    f.repo.put('steering', record); f.repo.delivery(next.message.id, a.id, 'inflight');
    const restored = new Engine(f.repo, f.session.id, async () => noop);
    try { assert.equal(f.repo.deliveries(f.session.id, ['failed']).filter(d => d.messageId === next.message.id).length, 1); assert.ok(!restored.queuedHumanMessages().some(m => m.id === next.message.id)); }
    finally { await restored.close(); }
  } finally { await f.close(); }
});
