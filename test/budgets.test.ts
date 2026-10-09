import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, agent, tool } from './helpers.js';
import { id } from '../src/domain.js';
test('provider request, tool and usage budgets pause gracefully', async () => {
  const f = fixture(undefined, { limits: { providerRequests: { test: 1 }, toolCalls: 1, tokens: 10 } });
  try {
    const a = await agent(f.engine); f.engine.request(a); assert.throws(() => f.engine.request(a), /Provider request budget/);
    assert.equal(f.engine.session().providerRequests.test, 1); assert.equal(f.engine.session().state, 'paused');
    f.engine.resume(); assert.equal((await tool(f.engine, a, 'roundtable_agents_list')).ok, true);
    assert.equal((await tool(f.engine, a, 'roundtable_agents_list')).ok, false); assert.equal(f.engine.session().state, 'paused');
    f.engine.resume(); f.engine.recordUsage(a.id, 11, 0, 'fixture'); assert.equal(f.engine.session().state, 'paused');
  } finally { await f.close(); }
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
