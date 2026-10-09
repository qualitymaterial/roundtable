import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, agent, tool } from './helpers.js';
import { id } from '../src/domain.js';
import { Engine } from '../src/engine.js';
test('provider request, tool and usage budgets pause gracefully', async () => {
  const f = fixture(undefined, { limits: { providerRequests: { test: 1 }, toolCalls: 1, tokens: 10 } });
  try {
    const a = await agent(f.engine); f.engine.request(a); assert.throws(() => f.engine.request(a), /Provider request budget/);
    assert.equal(f.engine.session().providerRequests.test, 1); assert.equal(f.engine.session().state, 'paused');
    assert.throws(() => f.engine.resume(), /Provider request budget/);
    f.engine.updateLimits({ providerRequests: { test: 2 } });
    assert.equal(f.engine.session().limits.toolCalls, 1, 'editing one limit must preserve all other limits');
    f.engine.resume(); assert.equal((await tool(f.engine, a, 'roundtable_agents_list')).ok, true);
    assert.equal((await tool(f.engine, a, 'roundtable_agents_list')).ok, false); assert.equal(f.engine.session().state, 'paused');
    f.engine.updateLimits({ toolCalls: 2 });
    f.engine.resume(); f.engine.recordUsage(a.id, 11, 0, 'fixture'); assert.equal(f.engine.session().state, 'paused');
  } finally { await f.close(); }
});

test('new sessions have no token cap and existing sessions can explicitly disable only that cap', async () => {
  const f = fixture();
  try {
    const a = await agent(f.engine); assert.equal(f.engine.session().limits.tokens, null);
    f.engine.recordUsage(a.id, 900000, 0.1, 'fixture'); assert.equal(f.engine.session().state, 'active');
    f.engine.updateLimits({ tokens: 1000000 }); f.engine.recordUsage(a.id, 200000, 0.1, 'fixture');
    assert.equal(f.engine.session().state, 'paused');
    f.engine.updateLimits({ tokens: null }); f.engine.resume();
    assert.equal(f.engine.session().usage.tokens, 1100000); assert.equal(f.engine.session().limits.dollars, 10);
    f.engine.recordUsage(a.id, 1, 10, 'fixture'); assert.match(f.engine.session().reason!, /Estimated spending budget reached/);
  } finally { await f.close(); }
});

test('concurrent usage pauses once, reports the precise cap and requires explicit recovery', async () => {
  const f = fixture(undefined, { limits: { tokens: 10, dollars: 10 } });
  try {
    const a = await agent(f.engine); const b = await agent(f.engine, 'B'); const activities: { type: string; text?: string }[] = [];
    f.engine.on('activity', event => activities.push(event));
    f.engine.recordUsage(a.id, 8, 0.01, 'fixture'); f.engine.recordUsage(a.id, 1, 0.01, 'fixture');
    assert.equal(activities.filter(a => a.type === 'budget_warning').length, 1);
    f.engine.recordUsage(a.id, 2, 0.01, 'fixture'); f.engine.recordUsage(b.id, 3, 0.01, 'fixture');
    assert.match(f.engine.session().reason!, /Token budget reached: 11 \/ 10/);
    assert.equal(f.repo.events(f.session.id).filter(e => e.type === 'paused').length, 1);
    assert.equal(activities.filter(a => a.type === 'paused').length, 1);
    assert.throws(() => f.engine.resume(), /14 \/ 10/);
    assert.throws(() => f.engine.updateLimits({ token: 30 }), /Unrecognized/);
    assert.throws(() => f.engine.updateLimits({ tokens: -1 }));
    f.engine.updateLimits({ tokens: 30 }); assert.equal(f.engine.session().state, 'paused');
    f.engine.resume(); assert.equal(f.engine.session().state, 'active'); assert.equal(f.engine.session().usage.tokens, 14);
  } finally { await f.close(); }
});

test('completed work at the token cap is acknowledged and not replayed on resume', async () => {
  let calls = 0;
  const f = fixture(async (a, engine) => ({ prompt: async () => { calls++; engine.recordUsage(a.id, 10, 0.01, 'fixture'); engine.assistant(a, 'Finished and saved.'); }, abort: async () => {}, dispose: () => {} }), { limits: { tokens: 10 } });
  try {
    const a = await agent(f.engine);
    f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body: 'Complete this' });
    await f.engine.idle();
    assert.equal(f.repo.deliveries(f.session.id, ['acknowledged']).length, 1);
    assert.ok(f.repo.messages(f.session.id).some(m => m.body === 'Finished and saved.'));
    f.engine.updateLimits({ tokens: 30 }); f.engine.resume(); await f.engine.idle(); assert.equal(calls, 1);
  } finally { await f.close(); }
});

test('budget interruption stays pending without showing a provider error', async () => {
  const f = fixture(async (a, engine) => ({ prompt: async () => { engine.recordUsage(a.id, 10, 0, 'fixture'); engine.request(a); }, abort: async () => {}, dispose: () => {} }), { limits: { tokens: 10 } });
  try {
    const events: { type: string }[] = []; f.engine.on('activity', event => events.push(event));
    const a = await agent(f.engine);
    f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body: 'Interrupted turn' });
    await f.engine.idle(); assert.equal(f.repo.deliveries(f.session.id, ['pending']).length, 1);
    assert.equal(events.filter(e => e.type === 'error').length, 0);
    assert.ok(f.repo.events(f.session.id).some(e => e.type === 'delivery_interrupted'));
  } finally { await f.close(); }
});

test('restored budget pause does not probe providers until explicit budget change and resume', async () => {
  const f = fixture(undefined, { limits: { tokens: 10 } }); let restored: Engine | undefined; let connections = 0;
  try {
    const a = await agent(f.engine); f.engine.recordUsage(a.id, 11, 0, 'fixture'); await f.engine.close();
    restored = new Engine(f.repo, f.session.id, async () => { connections++; return { prompt: async () => {}, abort: async () => {}, dispose: () => {} }; });
    await restored.connect(); assert.equal(connections, 0); assert.equal(restored.agents()[0]!.state, 'active');
    restored.updateLimits({ tokens: null }); restored.resume(); await restored.connect(); assert.equal(connections, 1);
  } finally { await restored?.close(); await f.close(); }
});
test('cached tool results cannot bypass revocation or tool-call input identity', async () => {
  const f = fixture(); try {
    const a = await agent(f.engine); const callId = id();
    assert.equal((await f.engine.tools.execute(a, 'roundtable_memory_write', { text: 'one' }, callId) as { ok: boolean }).ok, true);
    assert.equal((await f.engine.tools.execute(a, 'roundtable_memory_write', { text: 'changed' }, callId) as { ok: boolean }).ok, false);
    a.permissions = ['collaborate']; f.repo.put('agent', a);
    assert.equal((await f.engine.tools.execute(a, 'roundtable_memory_write', { text: 'one' }, callId) as { ok: boolean }).ok, false);
    assert.equal(f.repo.list('note', f.session.id).length, 1);
  } finally { await f.close(); }
});
test('queue capacity rejects overflow without partially inserting a message', async () => {
  const f = fixture(undefined, { limits: { queue: 1 } }); try {
    const a = await agent(f.engine); const b = await agent(f.engine, 'B');
    assert.throws(() => f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id, b.id], type: 'human', body: 'too many deliveries' }), /queue full/);
    assert.equal(f.repo.messages(f.session.id).length, 0); assert.equal(f.engine.session().usage.exchanges, 0);
  } finally { await f.close(); }
});
test('recent identical agent messages and self delivery are suppressed', async () => {
  const f = fixture(); try {
    const a = await agent(f.engine); const b = await agent(f.engine, 'B');
    const message = { sessionId: f.session.id, sender: a.id, recipients: [b.id], type: 'direct' as const, body: 'same output' };
    f.engine.send(message); assert.throws(() => f.engine.send(message), /Repeated/);
    assert.throws(() => f.engine.send({ ...message, recipients: [a.id] }), /Self/);
  } finally { await f.close(); }
});
