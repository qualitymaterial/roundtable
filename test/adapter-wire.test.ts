import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fixture, tool } from './helpers.js';
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
const rows = [{ url: 'https://example.com/page', title: 'A title', snippet: 'A source excerpt' }];

function script(turn: Turn): Reply {
  if (turn.user.includes('Compatibility test.')) {
    if (turn.results.length) return { text: turn.results[0]!.text };
    return { call: { name: 'roundtable_probe', args: { nonce: turn.user.match(/nonce ([a-f0-9-]{36})/)?.[1] ?? '' } } };
  }
  const tag = turn.model;
  // Unsupported tool, malformed arguments, then a valid call; a final reply only after real results.
  if (turn.results.length === 0) return { call: { name: 'web__delete', args: { url: 'https://example.com' } } };
  if (turn.results.length === 1) return { call: { name: 'web__search', args: { q: 'missing required query' } } };
  if (turn.results.length === 2) return { call: { name: 'web__search', args: { query: `evidence "for ${tag}"`, count: 3, language: 'en' } } };
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
    ? [[undefined, chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: 'function', function: { name: reply.call.name, arguments: '' } }] }, null)],
      [undefined, chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(reply.call.args) } }] }, null)], [undefined, chunk({}, 'tool_calls')]]
    : [[undefined, chunk({ role: 'assistant', content: reply.text }, null)], [undefined, chunk({}, 'stop')]];
  sse(res, [...events, [undefined, { id: 'c1', object: 'chat.completion.chunk', created: 1, model, choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }], [undefined, '[DONE]']]);
}
function anthropicStream(res: ServerResponse, model: string, reply: Reply) {
  const block = 'call' in reply ? { type: 'tool_use', id: `toolu_${Date.now()}`, name: reply.call.name, input: {} } : { type: 'text', text: '' };
  const delta = 'call' in reply ? { type: 'input_json_delta', partial_json: JSON.stringify(reply.call.args) } : { type: 'text_delta', text: reply.text };
  sse(res, [['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: block }], ['content_block_delta', { type: 'content_block_delta', index: 0, delta }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }], ['message_delta', { type: 'message_delta', delta: { stop_reason: 'call' in reply ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } }],
    ['message_stop', { type: 'message_stop' }]]);
}

test('real Pi OpenAI-compatible and Anthropic adapters discover, call and recover from web tools over loopback wire protocols', async () => {
  const turns: Turn[] = []; const auth: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>; const path = new URL(req.url ?? '/', 'http://x').pathname; auth.push(String(req.headers.authorization ?? req.headers['x-api-key'] ?? ''));
      if (path.endsWith('/chat/completions')) { const turn = parseOpenAI(body); turns.push(turn); return openAIStream(res, turn.model, script(turn)); }
      if (path.endsWith('/messages')) { const turn = parseAnthropic(body); turns.push(turn); return anthropicStream(res, turn.model, script(turn)); }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  let registry: ProviderRegistry; const f = fixture((actor, engine) => PiAdapter.create(registry, actor, engine));
  try {
    saveResearch(f.home, { web: WebConfig.parse({ enabled: true, allowPublicRead: true, provider: { id: 'selected', adapter: 'fixture' } }) });
    const search = new MockSearchProvider(rows); f.engine.web.providers.register('fixture', () => search);
    registry = await ProviderRegistry.create(f.home);
    // Production local path: an OpenAI-compatible endpoint configured like `/endpoint add`.
    registry.addEndpoint({ provider: 'local-llm', baseUrl: `${base}/v1`, model: 'local-model', contextWindow: 100000, maxTokens: 1000 });
    // Established cloud adapter (Anthropic Messages) pointed at loopback; the key is a fixture value.
    registry.runtime.registerProvider('cloud-anthropic', { baseUrl: base, api: 'anthropic-messages', apiKey: 'fixture-anthropic-key',
      models: [{ id: 'cloud-model', name: 'Cloud fixture', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
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
      assert.equal(final.results.length, 3, `${protocol} completed three tool calls`);
      assert.match(final.results[0]!.text, /not found|unknown|unavailable|not allowed/i);
      assert.match(final.results[1]!.text, /validation failed/i);
      const ok = JSON.parse(final.results[2]!.text) as { ok: boolean; data: { sources: { id: string; url: string }[] } };
      assert.equal(ok.ok, true); assert.equal(ok.data.sources[0]?.url, rows[0]!.url); assert.ok(ok.data.sources[0]?.id);
    }
    // Arguments survived both adapters' translation exactly, including quotes and options.
    assert.deepEqual(search.calls.map(c => [c.query, c.count, c.language]).sort(), [['evidence "for cloud-model"', 3, 'en'], ['evidence "for local-model"', 3, 'en']]);
    assert.ok(auth.some(a => a.includes('fixture-anthropic-key')));
    for (const t of turns) for (const r of t.results) assert.ok(!r.text.includes('fixture-anthropic-key'));
    assert.equal(f.repo.deliveries(f.session.id, ['failed']).length, 0);
  } finally { await f.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});

test('source handles cross agents through messages without copying documents, and never cross sessions or permissions', async () => {
  const f = fixture(); const g = fixture();
  try {
    for (const x of [f, g]) { saveResearch(x.home, { web: WebConfig.parse({ enabled: true, allowPublicRead: true, provider: { id: 'selected', adapter: 'fixture' } }) }); x.engine.web.providers.register('fixture', () => new MockSearchProvider(rows)); }
    const researcher = await f.engine.addAgent({ name: 'Researcher', provider: 'test', model: 'a', permissions: ['collaborate', 'network.research'] }, false);
    const reviewer = await f.engine.addAgent({ name: 'Reviewer', provider: 'test', model: 'b', permissions: ['collaborate', 'network.research'] }, false);
    const restricted = await f.engine.addAgent({ name: 'Restricted', provider: 'test', model: 'c', permissions: ['collaborate'] }, false);
    const found = await tool<{ sources: { id: string; hash: string }[] }>(f.engine, researcher, 'web.search', { query: 'handoff evidence' });
    assert.equal(found.ok, true); const handle = found.data.sources[0]!;
    // The peer receives only the handle and retrieves bounded content itself under its own permission.
    const shared = await tool<{ source: { hash: string } }>(f.engine, reviewer, 'web.cache', { action: 'get', sourceId: handle.id });
    assert.equal(shared.ok, true); assert.equal(shared.data.source.hash, handle.hash);
    const denied = await f.engine.tools.execute(restricted, 'web.cache', { action: 'get', sourceId: handle.id }, randomUUID()).catch((e: unknown) => ({ ok: false, error: String(e) })) as { ok: boolean };
    assert.equal(denied.ok, false);
    const outsider = await g.engine.addAgent({ name: 'Other session', provider: 'test', model: 'd', permissions: ['collaborate', 'network.research'] }, false);
    const foreign = await g.engine.tools.execute(outsider, 'web.cache', { action: 'get', sourceId: handle.id }, randomUUID()).catch((e: unknown) => ({ ok: false, error: String(e) })) as { ok: boolean };
    assert.equal(foreign.ok, false);
  } finally { await f.close(); await g.close(); }
});
