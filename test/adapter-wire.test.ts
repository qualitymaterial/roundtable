import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './helpers.js';
import { completionReport } from '../src/completion.js';
import { Engine } from '../src/engine.js';
import { compareSessions } from '../src/evaluation.js';
import { requireValidation, validateContract } from '../src/recovery.js';
import type { Artifact, Message, Task } from '../src/domain.js';
import { saveResearch } from '../src/research.js';
import { MockSearchProvider } from '../src/web-providers.js';
import { WebConfig } from '../src/web-types.js';
import { ProviderRegistry } from '../src/providers.js';
import { PiAdapter } from '../src/pi-adapter.js';

// Real Pi SDK provider adapters (openai-completions, anthropic-messages) speak their actual wire protocols
// to a loopback scripted model. No streamSimple override and no external network.
type Call = { name: string; args: unknown };
type Turn = { protocol: 'openai' | 'anthropic'; model: string; tools: string[]; user: string; results: { text: string; error: boolean }[] };
type Reply = { text: string } | { call: Call };
type WireReply = Reply | { unauthorized: true };
const rows = [{ url: 'https://example.com/page', title: 'A title', snippet: 'A source excerpt' }];

function script(turn: Turn): Reply {
  if (turn.user.includes('Compatibility test.')) {
    if (turn.results.length) return { text: turn.results[0]!.text };
    return { call: { name: 'roundtable_probe', args: { nonce: turn.user.match(/nonce ([a-f0-9-]{36})/)?.[1] ?? '' } } };
  }
  const tag = turn.model;
  // Unsupported tool, malformed arguments, then a valid call; a final reply only after real results.
  if (turn.results.length === 0) return { call: { name: 'web__delete', args: { url: 'https://example.com' } } };
  // A number where a string is required must be rejected, not coerced to "7" and executed.
  if (turn.results.length === 1) return { call: { name: 'web__search', args: { query: 7 } } };
  if (turn.results.length === 2) return { call: { name: 'web__search', args: { q: 'missing required query' } } };
  if (turn.results.length === 3) return { call: { name: 'web__search', args: { query: `evidence "for ${tag}"`, count: 3, language: 'en' } } };
  return { text: `final ${tag}: ${turn.results.at(-1)!.text}` };
}
const text = (value: unknown): string => typeof value === 'string' ? value : Array.isArray(value) ? value.map(v => typeof v === 'string' ? v : (v as { text?: string }).text ?? '').join('') : '';

function parseOpenAI(body: Record<string, unknown>): Turn {
  const messages = body.messages as { role: string; content: unknown }[];
  const last = messages.findLastIndex(m => m.role === 'user');
  return { protocol: 'openai', model: String(body.model), tools: ((body.tools ?? []) as { function: { name: string } }[]).map(t => t.function.name).sort(), user: text(messages[last]?.content),
    results: messages.slice(last + 1).filter(m => m.role === 'tool').map(m => ({ text: text(m.content), error: false })) };
}
function parseAnthropic(body: Record<string, unknown>): Turn {
  const messages = body.messages as { role: string; content: unknown }[];
  const blocks = (m: { content: unknown }) => Array.isArray(m.content) ? m.content as Record<string, unknown>[] : [{ type: 'text', text: m.content }];
  const last = messages.findLastIndex(m => m.role === 'user' && blocks(m).some(b => b.type === 'text'));
  const tools = new Set(((body.tools ?? []) as { name: string }[]).map(t => t.name));
  for (const m of messages) for (const b of blocks(m)) if (b.type === 'tool_addition') tools.add(((b.tool as { definition: { name: string } }).definition).name);
  return { protocol: 'anthropic', model: String(body.model), tools: [...tools].sort(), user: blocks(messages[last]!).filter(b => b.type === 'text').map(b => String(b.text)).join(''),
    results: messages.slice(last + 1).flatMap(m => blocks(m)).filter(b => b.type === 'tool_result').map(b => ({ text: text(b.content), error: b.is_error === true })) };
}
function sse(res: ServerResponse, events: [string | undefined, unknown][]) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  for (const [event, data] of events) res.write(`${event ? `event: ${event}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
  res.end();
}
function openAIStream(res: ServerResponse, model: string, reply: Reply) {
  const chunk = (delta: unknown, finish: string | null) => ({ id: 'c1', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason: finish }] });
  const events: [undefined, unknown][] = 'call' in reply
    ? [[undefined, chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${randomUUID()}`, type: 'function', function: { name: reply.call.name, arguments: '' } }] }, null)],
      [undefined, chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(reply.call.args) } }] }, null)], [undefined, chunk({}, 'tool_calls')]]
    : [[undefined, chunk({ role: 'assistant', content: reply.text }, null)], [undefined, chunk({}, 'stop')]];
  sse(res, [...events, [undefined, { id: 'c1', object: 'chat.completion.chunk', created: 1, model, choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }], [undefined, '[DONE]']]);
}
function anthropicStream(res: ServerResponse, model: string, reply: Reply) {
  const block = 'call' in reply ? { type: 'tool_use', id: `toolu_${randomUUID()}`, name: reply.call.name, input: {} } : { type: 'text', text: '' };
  const delta = 'call' in reply ? { type: 'input_json_delta', partial_json: JSON.stringify(reply.call.args) } : { type: 'text_delta', text: reply.text };
  sse(res, [['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: block }], ['content_block_delta', { type: 'content_block_delta', index: 0, delta }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }], ['message_delta', { type: 'message_delta', delta: { stop_reason: 'call' in reply ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } }],
    ['message_stop', { type: 'message_stop' }]]);
}

async function wire(reply: (turn: Turn) => WireReply) {
  const turns: Turn[] = []; const auth: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>; const path = new URL(req.url ?? '/', 'http://x').pathname; auth.push(String(req.headers.authorization ?? req.headers['x-api-key'] ?? ''));
      const openAI = path.endsWith('/chat/completions');
      if (!openAI && !path.endsWith('/messages')) { res.writeHead(404).end(); return; }
      const turn = openAI ? parseOpenAI(body) : parseAnthropic(body); turns.push(turn);
      const response = reply(turn);
      if ('unauthorized' in response) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'Fixture authentication expired' } }));
      } else if (openAI) openAIStream(res, turn.model, response);
      else anthropicStream(res, turn.model, response);
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const address = server.address(); assert.ok(address && typeof address === 'object');
  return { turns, auth, base: `http://127.0.0.1:${address.port}`, close: async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); } };
}
function cloud(registry: ProviderRegistry, base: string, provider = 'cloud-anthropic') {
  // Established cloud adapter (Anthropic Messages) pointed at loopback; the key is a fixture value.
  registry.runtime.registerProvider(provider, { baseUrl: base, api: 'anthropic-messages', apiKey: 'fixture-anthropic-key',
    models: [{ id: 'cloud-model', name: 'Cloud fixture', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
}

const collaborationObjective = 'Deliver a verified receipt for 6 × 7.';
const receiptName = 'receipt.json';
const reviewBody = 'Check the attached receipt against the task contract.';
const kickoff = 'Produce the receipt, get the independent check, and close the task.';
type Scenario = 'solo' | 'team' | 'retry' | 'recovery';
type Incoming = Pick<Message, 'id' | 'sender' | 'body' | 'taskId' | 'artifacts' | 'correlationId'>;

function collaborationScript(scenario: Scenario, reviewerId?: string) {
  let failOnce = scenario === 'retry';
  return (turn: Turn): WireReply => {
    if (turn.user.includes('Compatibility test.')) return script(turn);
    const { incoming } = JSON.parse(turn.user) as { incoming: Incoming };
    const { taskId } = incoming;
    const result = (index: number) => JSON.parse(turn.results[index]!.text);
    const call = (name: string, args: unknown): Reply => ({ call: { name, args } });
    const wait = (mode: 'human' | 'peers') => call('roundtable_wait', { mode });
    const done = (reply: string): Reply => ({ text: reply });
    const step = turn.results.length;
    if (turn.protocol === 'anthropic') {
      if (failOnce) { failOnce = false; return { unauthorized: true }; }
      const artifactId = incoming.artifacts[0];
      if (step === 0) return call('roundtable_artifact_read', { artifactId });
      if (step === 1) return call('roundtable_task_requirements', { taskId });
      if (step === 2) return call('roundtable_validation_run', { contractId: result(1).data[0].contract.id, artifactId: result(0).data.id });
      if (step === 3) return call('roundtable_send', {
        type: 'task_response', recipients: [incoming.sender], expectsReply: true, taskId,
        correlationId: incoming.id, artifacts: [artifactId], body: result(2).data.passed ? 'Receipt passed.' : 'Receipt failed. Correct the total and resubmit.',
      });
      return done('Review sent.');
    }
    if (incoming.body === 'Receipt passed.') {
      if (step === 0) return call('roundtable_task_update', { taskId, state: 'done', findings: 'Independent contract passed.' });
      if (step === 1 && result(0).ok) return wait('human');
      return done('Complete.');
    }
    if (incoming.body === kickoff && step === 0) return call('roundtable_task_claim', { taskId });
    const initial = incoming.body === kickoff;
    if (initial && step === 1) return call('workspace_write', { path: 'calculation.txt', content: '6 × 7' });
    const action = step - (initial ? 2 : 0);
    const content = JSON.stringify({ total: scenario === 'recovery' && initial ? 41 : 42 });
    if (action === 0) return call('data_json_validate', { content });
    if (action === 1) return call('roundtable_artifact_publish', { name: receiptName, content, provenance: 'Scripted arithmetic receipt' });
    if (action === 2 && reviewerId) return call('roundtable_send', {
      type: 'task_request', recipients: [reviewerId], taskId, artifacts: [result(step - 1).data.id], body: reviewBody,
    });
    if (action === 2 || action === 3) return wait(reviewerId ? 'peers' : 'human');
    return done('Awaiting review.');
  };
}

test('matched solo and local/cloud workflows deliver the same receipt, including recovered team runs', async t => {
  // Each run uses real Pi adapters and its own durable session. Only model outputs are scripted.
  let handler: (turn: Turn) => WireReply = script;
  const modelWire = await wire(turn => handler(turn));
  let registry: ProviderRegistry;
  const factory = (actor: Parameters<typeof PiAdapter.create>[1], engine: Engine) => PiAdapter.create(registry, actor, engine);
  const f = fixture(factory);
  const permissions = ['collaborate', 'artifact', 'workspace.write'];
  const engines = new Set<Engine>();
  try {
    registry = await ProviderRegistry.create(f.home);
    registry.addEndpoint({ provider: 'mock-local', baseUrl: `${modelWire.base}/v1`, model: 'local-model', contextWindow: 100000, maxTokens: 1000 });
    cloud(registry, modelWire.base, 'mock-cloud');
    const run = async (scenario: Scenario) => {
      const session = Engine.create(f.repo, join(f.home, 'comparison'), collaborationObjective, { permissions });
      let engine = new Engine(f.repo, session.id, factory); engines.add(engine);
      const task: Task = { id: randomUUID(), sessionId: session.id, title: 'Deliver receipt', state: 'open', findings: '', dependencies: [] };
      f.repo.put('task', task);
      const contract = requireValidation(engine, {
        taskId: task.id, artifactName: receiptName, description: 'Receipt total equals 42',
        validator: { kind: 'json', required: ['total'], equals: { total: 42 } },
      });
      const local = await engine.addAgent({ name: 'Local', provider: 'mock-local', model: 'local-model', permissions });
      const reviewer = scenario === 'solo' ? undefined : await engine.addAgent({
        name: 'Cloud', provider: 'mock-cloud', model: 'cloud-model', permissions: ['collaborate', 'artifact'],
      });
      handler = collaborationScript(scenario, reviewer?.id);
      const human = (body: string) => engine.send({ sessionId: session.id, sender: 'human', recipients: [local.id], type: 'human', taskId: task.id, body });
      const artifacts = () => f.repo.list<Artifact>('artifact', session.id);
      human(kickoff);
      await engine.idle();
      if (scenario === 'solo') {
        // The baseline's oracle stays independent; the solo agent cannot verify its own receipt.
        assert.equal((await validateContract(engine, contract.id, artifacts()[0]!.id, 'human')).passed, true);
        human('Receipt passed.');
        await engine.idle();
      }
      if (scenario === 'retry') {
        const [failure] = f.repo.deliveries(session.id, ['failed']);
        assert.equal(failure?.agentId, reviewer!.id);
        assert.equal(failure?.attempts, 1);
        assert.match(failure?.error ?? '', /401|authentication/i);
        assert.equal(completionReport(engine).outstandingTasks[0]?.id, task.id);
        await engine.close(); engines.delete(engine);
        engine = new Engine(f.repo, session.id, factory); engines.add(engine);
        await engine.connect(); await engine.idle();
        assert.deepEqual(f.repo.deliveries(session.id, ['failed']), [failure], 'Reopen must preserve failure without replay');
        engine.retryFailed(); await engine.idle();
        const retried = f.repo.deliveries(session.id, ['acknowledged']).find(d => d.messageId === failure?.messageId);
        assert.equal(retried?.attempts, 2);
      }
      if (scenario === 'recovery') {
        const requests = f.repo.messages(session.id).filter(m => m.type === 'task_request');
        assert.deepEqual(requests.map(m => m.body), [reviewBody, reviewBody]);
        assert.deepEqual(requests.map(m => m.artifacts[0]), artifacts().map(a => a.id));
      }
      const report = completionReport(engine);
      assert.deepEqual(report.deliveries, []);
      assert.equal(report.state, 'idle', JSON.stringify(report.failures));
      assert.equal(report.completedTasks[0]?.id, task.id);
      assert.equal(report.outstandingTasks.length, 0);
      const artifact = artifacts().at(-1)!;
      assert.equal(artifact.author, local.id);
      assert.deepEqual(JSON.parse(artifact.content), { total: 42 });
      assert.equal(readFileSync(join(session.workspace, 'calculation.txt'), 'utf8'), '6 × 7');
      const events = f.repo.events(session.id);
      const checks = events.filter(e => e.type === 'required_validation_result').map(e => e.data as { reviewer: string; artifactId: string; hash: string; passed: boolean });
      assert.deepEqual(checks.map(c => c.passed), scenario === 'recovery' ? [false, true] : [true]);
      assert.equal(checks.at(-1)?.reviewer, reviewer?.id ?? 'human');
      assert.equal(checks.at(-1)?.artifactId, artifact.id);
      assert.equal(checks.at(-1)?.hash, artifact.hash);
      if (reviewer) {
        assert.ok(events.some(e => e.type === 'tool_result' && (e.data as { agentId: string; name: string }).agentId === reviewer.id && (e.data as { name: string }).name === 'roundtable_artifact_read'));
        const request = f.repo.messages(session.id).find(m => m.type === 'task_request');
        assert.equal(request?.sender, local.id);
        assert.deepEqual(request?.recipients, [reviewer.id]);
        assert.equal(request?.taskId, task.id);
        assert.equal(request?.expectsReply, true);
        const turns = modelWire.turns.filter(t => t.protocol === 'anthropic' && t.user.includes(task.id));
        assert.ok(turns.length > 0);
        assert.ok(turns.every(t => t.tools.includes('roundtable_artifact_read') && !t.tools.includes('workspace_write') && !t.tools.includes('host_execute')));
        const reviewTurns = turns.filter(t => t.user.includes(artifact.id));
        assert.ok(reviewTurns.length > 0);
        assert.ok(reviewTurns.every(t => !t.user.includes(artifact.content)), 'Peer messages must carry the reference only');
        assert.ok(readdirSync(join(f.home, 'sessions', session.id, reviewer.id)).some(name => name.endsWith('.jsonl')));
      }
      assert.ok(readdirSync(join(f.home, 'sessions', session.id, local.id)).some(name => name.endsWith('.jsonl')));
      return { session, artifact, engine, reviewer };
    };
    const solo = await run('solo');
    const team = await run('team');
    const recovery = await run('recovery');
    const retry = await run('retry');
    assert.equal(solo.artifact.hash, team.artifact.hash);
    assert.equal(solo.artifact.hash, recovery.artifact.hash);
    assert.equal(solo.artifact.hash, retry.artifact.hash);
    const evaluate = (teamId: string) => compareSessions(f.repo, { task: collaborationObjective, solo: solo.session.id, team: teamId });
    const clean = evaluate(team.session.id);
    const recovered = evaluate(recovery.session.id);
    const retried = evaluate(retry.session.id);
    assert.equal(clean.solo.firstPass, true);
    assert.equal(clean.team.firstPass, true);
    assert.equal(recovered.team.complete, true);
    assert.equal(recovered.team.firstPass, false);
    assert.equal(retried.team.complete, true);
    assert.equal(retried.team.firstPass, false, 'Recovered delivery still failed on the first pass');
    assert.equal(retried.team.deliveryFailures, 1);
    assert.equal(retried.team.toolFailures, 0);
    assert.ok(clean.team.workRequests > clean.solo.workRequests);
    const summary = ({ firstPass, usage, independentMessages, workRequests, admissionRequests, deliveryFailures }: typeof clean.solo) =>
      ({ firstPass, workRequests, admissionRequests, toolCalls: usage.toolCalls, tokens: usage.tokens, independentMessages, deliveryFailures });
    t.diagnostic(JSON.stringify({ solo: summary(clean.solo), team: summary(clean.team), artifactRecovery: summary(recovered.team), deliveryRetry: summary(retried.team) }));
    const duplicate = f.repo.messages(team.session.id).find(m => m.type === 'task_response')!;
    assert.throws(() => team.engine.send({ ...duplicate, id: randomUUID(), correlationId: randomUUID(), expectsReply: false }), /Repeated identical message suppressed/);
    // Check execution-layer policy independently after capturing uncontaminated comparison metrics.
    const denied = await team.engine.tools.execute({ ...team.reviewer!, permissions }, 'workspace_write', { path: 'forbidden.txt', content: 'denied' }, randomUUID());
    assert.deepEqual(denied, { ok: false, data: 'Permission denied: workspace.write. Use roundtable_tool_request.' });
    assert.equal(existsSync(join(team.session.workspace, 'forbidden.txt')), false);
  } finally {
    await Promise.all([...engines].map(e => e.close())); await f.close(); await modelWire.close();
  }
});

test('real Pi OpenAI-compatible and Anthropic adapters discover, call and recover from web tools over loopback wire protocols', async () => {
  const { turns, auth, base, close } = await wire(script);
  let registry: ProviderRegistry; const f = fixture((actor, engine) => PiAdapter.create(registry, actor, engine));
  try {
    saveResearch(f.home, { web: WebConfig.parse({ enabled: true, allowPublicRead: true, provider: { id: 'selected', adapter: 'fixture' } }) });
    const search = new MockSearchProvider(rows); f.engine.web.providers.register('fixture', () => search);
    registry = await ProviderRegistry.create(f.home);
    // Production local path: an OpenAI-compatible endpoint configured like `/endpoint add`.
    registry.addEndpoint({ provider: 'local-llm', baseUrl: `${base}/v1`, model: 'local-model', contextWindow: 100000, maxTokens: 1000 });
    cloud(registry, base);
    await f.engine.addAgent({ name: 'Local', provider: 'local-llm', model: 'local-model', permissions: ['collaborate', 'network.research'] });
    await f.engine.addAgent({ name: 'Cloud', provider: 'cloud-anthropic', model: 'cloud-model', permissions: ['collaborate', 'network.research'] });
    await f.engine.addAgent({ name: 'Offline', provider: 'local-llm', model: 'local-model', permissions: ['collaborate'] });
    f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: ['*'], type: 'human', body: 'Search for evidence and report the source identifiers.' }); await f.engine.idle();

    const work = turns.filter(t => !t.user.includes('Compatibility test.'));
    const web = (t: Turn) => t.tools.filter(n => n.startsWith('web__'));
    const full = ['web__cache', 'web__read', 'web__research', 'web__search', 'web__verify'];
    const online = work.filter(t => web(t).length);
    assert.deepEqual([...new Set(online.map(t => t.protocol))].sort(), ['anthropic', 'openai']);
    for (const t of online) assert.deepEqual(web(t), full);
    // Optional per-agent access: the agent without network permission is offered no web tools at all.
    const offline = work.filter(t => t.protocol === 'openai' && !web(t).length);
    assert.ok(offline.length >= 1);
    for (const t of work) assert.ok(!t.tools.includes('web__delete'));
    // Each protocol received the same per-agent results: unsupported call, schema rejection, then evidence.
    for (const protocol of ['openai', 'anthropic'] as const) {
      const final = online.filter(t => t.protocol === protocol).at(-1)!;
      assert.equal(final.results.length, 4, `${protocol} completed four tool calls`);
      assert.match(final.results[0]!.text, /not found|unknown|unavailable|not allowed/i);
      assert.match(final.results[1]!.text, /validation failed.*not coerced/is);
      assert.match(final.results[2]!.text, /validation failed/i);
      const ok = JSON.parse(final.results[3]!.text) as { ok: boolean; data: { sources: { id: string; url: string }[] } };
      assert.equal(ok.ok, true); assert.equal(ok.data.sources[0]?.url, rows[0]!.url); assert.ok(ok.data.sources[0]?.id);
    }
    // Arguments survived both adapters' translation exactly, including quotes and options.
    assert.deepEqual(search.calls.map(c => [c.query, c.count, c.language]).sort(), [['evidence "for cloud-model"', 3, 'en'], ['evidence "for local-model"', 3, 'en']]);
    assert.ok(auth.some(a => a.includes('fixture-anthropic-key')));
    for (const t of turns) for (const r of t.results) assert.ok(!r.text.includes('fixture-anthropic-key'));
    assert.equal(f.repo.deliveries(f.session.id, ['failed']).length, 0);
  } finally { await f.close(); await close(); }
});

// Researcher (OpenAI-compatible) searches, then shares only a handle through roundtable_send. Runtime delivery wakes the
// recipients; the Anthropic-backed reviewer retrieves bounded evidence with its own permission, the restricted peer cannot.
function handoff(turn: Turn): Reply {
  if (turn.user.includes('Compatibility test.')) return script(turn);
  const handle = turn.user.match(/HANDLE=([0-9a-f-]{36})/)?.[1];
  if (handle) {
    if (turn.results.length === 0) return { call: { name: 'web__cache', args: { action: 'get', length: 200 } } };
    if (turn.results.length === 1) return { call: { name: 'web__cache', args: { action: 'get', sourceId: handle, length: 200 } } };
    return { text: `reviewed ${handle}` };
  }
  const share = turn.user.match(/SHARE=([0-9a-f-]{36}),([0-9a-f-]{36})/);
  if (!share) return { text: 'nothing to do' };
  if (turn.results.length === 0) return { call: { name: 'web__search', args: { query: 'handoff evidence' } } };
  if (turn.results.length === 1) {
    const id = (JSON.parse(turn.results[0]!.text) as { data: { sources: { id: string }[] } }).data.sources[0]!.id;
    return { call: { name: 'roundtable_send', args: { recipients: [share[1], share[2]], body: `Please review HANDLE=${id}`, expectsReply: true } } };
  }
  return { text: 'shared' };
}

test('source handles pass through real runtime message delivery; peers retrieve with their own permissions only', async () => {
  const { turns, base, close } = await wire(handoff);
  let registry: ProviderRegistry; const f = fixture((actor, engine) => PiAdapter.create(registry, actor, engine)); const g = fixture();
  try {
    saveResearch(f.home, { web: WebConfig.parse({ enabled: true, allowPublicRead: true, provider: { id: 'selected', adapter: 'fixture' } }) });
    const search = new MockSearchProvider(rows); f.engine.web.providers.register('fixture', () => search);
    registry = await ProviderRegistry.create(f.home);
    registry.addEndpoint({ provider: 'local-llm', baseUrl: `${base}/v1`, model: 'local-model', models: [{ id: 'restricted-model' }], contextWindow: 100000, maxTokens: 1000 });
    cloud(registry, base);
    const researcher = await f.engine.addAgent({ name: 'Researcher', provider: 'local-llm', model: 'local-model', permissions: ['collaborate', 'network.research'] });
    const reviewer = await f.engine.addAgent({ name: 'Reviewer', provider: 'cloud-anthropic', model: 'cloud-model', permissions: ['collaborate', 'network.research'] });
    const restricted = await f.engine.addAgent({ name: 'Restricted', provider: 'local-llm', model: 'restricted-model', permissions: ['collaborate'] });
    f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [researcher.id], type: 'human', body: `Research, then hand off. SHARE=${reviewer.id},${restricted.id}` }); await f.engine.idle();

    const work = turns.filter(t => !t.user.includes('Compatibility test.'));
    const sent = work.find(t => t.model === 'local-model' && t.results.length === 2)!;
    const receipt = JSON.parse(sent.results[1]!.text) as { ok: boolean; data: { id: string; recipients: string[] } };
    assert.equal(receipt.ok, true);
    const message = f.repo.message(receipt.data.id)!;
    assert.equal(message.sender, researcher.id); const handle = message.body.match(/HANDLE=([0-9a-f-]{36})/)![1]!;
    // Only the handle crossed agents; the document text did not.
    assert.ok(!message.body.includes(rows[0]!.snippet));
    const source = (JSON.parse(sent.results[0]!.text) as { data: { sources: { id: string; hash: string }[] } }).data.sources[0]!;
    assert.equal(source.id, handle);
    // The reviewer's own context received the delivered message and its own cache call returned the same snapshot.
    const reviewed = work.filter(t => t.protocol === 'anthropic' && t.user.includes(`HANDLE=${handle}`) && t.results.length).at(-1)!;
    // Missing get.sourceId must be rejected at Pi's schema boundary, before a cache operation.
    assert.match(reviewed.results[0]!.text, /Validation failed/);
    const evidence = JSON.parse(reviewed.results[1]!.text) as { ok: boolean; data: { source: { hash: string; text: string } } };
    assert.equal(evidence.ok, true); assert.equal(evidence.data.source.hash, source.hash); assert.ok(evidence.data.source.text.length <= 200);
    // The restricted recipient got the same message but has no web tool, so the handle grants nothing.
    const blocked = work.filter(t => t.model === 'restricted-model' && t.user.includes(`HANDLE=${handle}`) && t.results.length).at(-1)!;
    assert.ok(!blocked.tools.some(n => n.startsWith('web__'))); assert.match(blocked.results[0]!.text, /not found/i);
    const denied = await f.engine.tools.execute(restricted, 'web.cache', { action: 'get', sourceId: handle }, randomUUID()).catch((e: unknown) => ({ ok: false, error: String(e) })) as { ok: boolean };
    assert.equal(denied.ok, false);
    // Another session cannot redeem the handle even with network permission.
    saveResearch(g.home, { web: WebConfig.parse({ enabled: true, allowPublicRead: true, provider: { id: 'selected', adapter: 'fixture' } }) }); g.engine.web.providers.register('fixture', () => new MockSearchProvider(rows));
    const outsider = await g.engine.addAgent({ name: 'Other session', provider: 'test', model: 'd', permissions: ['collaborate', 'network.research'] }, false);
    const foreign = await g.engine.tools.execute(outsider, 'web.cache', { action: 'get', sourceId: handle }, randomUUID()).catch((e: unknown) => ({ ok: false, error: String(e) })) as { ok: boolean };
    assert.equal(foreign.ok, false);
    assert.equal(search.calls.length, 1);
    assert.equal(f.repo.deliveries(f.session.id, ['failed']).length, 0);
  } finally { await f.close(); await g.close(); await close(); }
});
