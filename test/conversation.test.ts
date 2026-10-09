import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.js';
import { courtesyReply } from '../src/conversation.js';
import { PresentationController } from '../src/ui/controller.js';
import { fixture, agent, tool, noop } from './helpers.js';
import { ProviderRegistry } from '../src/providers.js';
import { PiAdapter } from '../src/pi-adapter.js';
import { registerMock } from '../src/demo.js';

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

test('courtesy handling is narrow and does not swallow real requests', () => {
  for (const text of ['hello', 'HELLO!', 'hi team', 'good morning', 'hello?', 'thank you']) assert.ok(courtesyReply(text));
  for (const text of ['hello, please review this', 'Thanks, now fix it', 'Write a hello world app', 'hello\ninspect my files', 'bonjour']) {
    assert.equal(courtesyReply(text), undefined);
  }
});

test('hello across three independent Pi sessions causes zero model calls, tools, tasks or artifacts', async () => {
  const f = fixture(); await f.engine.close();
  const registry = await ProviderRegistry.create(f.home); await registerMock(registry);
  let calls = 0;
  const engine = new Engine(f.repo, f.session.id, PiAdapter.factory(registry, () => { calls++; throw new Error('A greeting must not invoke a model'); }));
  try {
    for (const model of ['alpha', 'beta', 'gamma']) await engine.addAgent({ name: model, provider: 'roundtable-mock', model });
    const message = engine.send({ sender: 'human', sessionId: f.session.id, recipients: ['*'], type: 'human', body: 'hello' });
    await engine.idle();
    assert.equal(calls, 0); assert.equal(engine.session().usage.toolCalls, 0); assert.equal(engine.session().usage.exchanges, 0);
    assert.equal(f.repo.list('task', f.session.id).length, 0); assert.equal(f.repo.list('artifact', f.session.id).length, 0);
    assert.equal(f.repo.messages(f.session.id).length, 2);
    assert.equal(f.repo.messages(f.session.id)[1]!.body, 'Hello! What would you like to work on?');
    assert.equal(f.repo.deliveries(f.session.id, ['acknowledged']).filter(d => d.messageId === message.id).length, 3);
    await engine.pause();
    engine.send({ sender: 'human', sessionId: f.session.id, recipients: ['*'], type: 'human', body: 'thanks' });
    assert.equal(engine.session().state, 'paused'); assert.equal(calls, 0);
  } finally { await engine.close(); await f.close(); }
});

test('peer notifications persist without triggering acknowledgment chains; explicit requests still wake', async () => {
  let calls = 0;
  const f = fixture(async (actor, engine) => ({ ...noop, prompt: async text => {
    calls++; const incoming = JSON.parse(text).incoming;
    if (incoming.sender !== 'human') await tool(engine, actor, 'roundtable_send', { recipients: [incoming.sender], body: 'Acknowledged. Ready when you are.' });
  } }));
  try {
    const a = await agent(f.engine, 'A'); const b = await agent(f.engine, 'B');
    f.engine.send({ sender: 'human', sessionId: f.session.id, recipients: [a.id], type: 'human', body: 'Compare storage designs' }); await f.engine.idle();
    await tool(f.engine, a, 'roundtable_send', { recipients: [b.id], body: 'I am ready.' }); await f.engine.idle(); assert.equal(calls, 1);
    const request = await tool<{ id: string }>(f.engine, a, 'roundtable_send', { recipients: [b.id], body: 'Please assess SQLite locking.', expectsReply: true });
    assert.equal(request.ok, true); await f.engine.idle(); assert.equal(calls, 2);
    assert.ok(f.repo.messages(f.session.id).some(m => m.body === 'Acknowledged. Ready when you are.'));
    assert.equal(f.repo.deliveries(f.session.id).length, 0);
    assert.throws(() => f.engine.send({ id: request.data.id, sender: a.id, sessionId: f.session.id, recipients: [b.id], type: 'direct', body: 'Please assess SQLite locking.', expectsReply: false }), /collision/);
  } finally { await f.close(); }
});

test('waiting blocks fresh and cached tools, survives restart, and only targeted human/system input wakes it', async () => {
  const f = fixture(); let restored: Engine | undefined; let calls = 0;
  try {
    const a = await agent(f.engine, 'A'); const b = await agent(f.engine, 'B');
    assert.equal((await f.engine.tools.execute(a, 'roundtable_agents_list', {}, 'cached') as { ok: boolean }).ok, true);
    assert.equal((await tool(f.engine, a, 'roundtable_wait')).ok, true);
    assert.equal((await f.engine.tools.execute(a, 'roundtable_agents_list', {}, 'cached') as { ok: boolean }).ok, false);
    assert.equal((await tool(f.engine, a, 'roundtable_task_create', { title: 'Invented work' })).ok, false);
    assert.throws(() => f.engine.send({ sender: a.id, sessionId: f.session.id, recipients: [b.id], type: 'direct', body: 'Wake up', expectsReply: true }), /Waiting/);
    await f.engine.close();
    restored = new Engine(f.repo, f.session.id, async () => ({ ...noop, prompt: async () => { calls++; } }));
    await restored.connect(); assert.equal(restored.waiting(a.id), true);
    const peer = restored.send({ sender: b.id, sessionId: f.session.id, recipients: [a.id], type: 'task_request', body: 'Please invent a task' });
    await restored.idle(); assert.equal(calls, 0); assert.ok(f.repo.deliveries(f.session.id, ['cancelled']).some(d => d.messageId === peer.id));
    restored.send({ sender: 'human', sessionId: f.session.id, recipients: [b.id], type: 'human', body: 'Inspect task state' }); await restored.idle(); assert.equal(restored.waiting(a.id), true);
    restored.send({ sender: 'human', sessionId: f.session.id, recipients: [a.id], type: 'human', body: 'Now compare the two designs' }); await restored.idle(); assert.equal(restored.waiting(a.id), false); assert.equal(calls, 2);
    restored.waitForHuman(a.id); restored.notify(a.id, 'approval-fixture', 'Human-approved result available'); await restored.idle(); assert.equal(restored.waiting(a.id), false); assert.equal(calls, 3);
  } finally { await restored?.close(); await f.close(); }
});

test('a peer suggestion without a human request cannot activate tool work', async () => {
  let result: { ok: boolean } | undefined;
  const f = fixture(async (actor, engine) => ({ ...noop, prompt: async () => { result = await tool(engine, actor, 'roundtable_task_create', { title: 'Unrequested demo' }); } }));
  try {
    const a = await agent(f.engine, 'A'); const b = await agent(f.engine, 'B');
    f.engine.send({ sender: a.id, sessionId: f.session.id, recipients: [b.id], type: 'task_request', body: 'Let us review the repository' }); await f.engine.idle();
    assert.equal(result?.ok, false); assert.equal(f.repo.list('task', f.session.id).length, 0);
  } finally { await f.close(); }
});

test('session timeout excludes connection and idle time but interrupts active work', async () => {
  let release: (() => void) | undefined;
  const f = fixture(async () => { await delay(55); return { ...noop, prompt: async () => { await new Promise<void>(r => { release = r; }); }, abort: async () => { release?.(); } }; }, { limits: { timeoutMs: 40, turnTimeoutMs: 1000 } });
  try {
    const a = await agent(f.engine); await f.engine.connect(); await delay(65); assert.equal(f.engine.session().state, 'active');
    f.engine.send({ sender: 'human', sessionId: f.session.id, recipients: [a.id], type: 'human', body: 'Start actual work' }); await f.engine.idle();
    assert.equal(f.engine.session().reason, 'Session timeout');
    f.engine.resume(); f.engine.cancelQueued(f.repo.deliveries(f.session.id)[0]!.messageId); await delay(65); assert.equal(f.engine.session().state, 'active');
  } finally { await f.close(); }
});

test('every failed or timed-out turn clears live presentation and preserves failure evidence', async () => {
  let release: (() => void) | undefined;
  const controller = new PresentationController();
  const f = fixture(async () => ({ ...noop, prompt: async () => { await new Promise<void>(r => { release = r; }); }, abort: async () => { release?.(); } }), { limits: { turnTimeoutMs: 30 } });
  try {
    const a = await agent(f.engine); controller.update({ live: [{ id: a.id, label: a.name, model: a.model, text: 'Partial answer', running: 0, done: 0, failed: 0 }] });
    const events: string[] = []; f.engine.on('activity', event => { events.push(event.type); if (event.type === 'turn_end') controller.endTurn(event.agentId); });
    f.engine.send({ sender: 'human', sessionId: f.session.id, recipients: [a.id], type: 'human', body: 'Try this task' }); await f.engine.idle();
    assert.equal(controller.snapshot().live.length, 0); assert.ok(events.includes('error')); assert.equal(events.at(-1), 'turn_end');
    assert.match(f.repo.deliveries(f.session.id, ['failed'])[0]!.error!, /timed out/);
  } finally { controller.close(); await f.close(); }
});

test('courtesy input during a running turn never steers or resumes work', async () => {
  let release!: () => void; let entered!: () => void; const start = new Promise<void>(r => { entered = r; }); let steering = 0;
  const f = fixture(async () => ({ ...noop, prompt: async () => { entered(); await new Promise<void>(r => { release = r; }); }, abort: async () => { release?.(); }, steer: async () => { steering++; return true; } }));
  try {
    const a = await agent(f.engine); f.engine.send({ sender: 'human', sessionId: f.session.id, recipients: [a.id], type: 'human', body: 'Review the design' }); await start;
    const reply = await f.engine.steer('hello', [a.id]); assert.equal(reply.steering, 0); assert.equal(reply.queued, 0); assert.equal(steering, 0);
    release(); await f.engine.idle();
  } finally { await f.close(); }
});
