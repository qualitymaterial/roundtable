import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, agent, tool } from './helpers.js';
import { WebIntelligence } from '../src/web-intelligence.js';
import { WebConfig, SearchInput, type WebSource } from '../src/web-types.js';
import { canonicalSearch, freshnessDecision, type WebContext } from '../src/web-orchestration.js';
import type { SearchProvider, ProviderResult } from '../src/web-providers.js';
import type { WebTransport } from '../src/web-http.js';
import { webDiagnosticsMenu, webDiagnosticsRows, diagnosticsMenu } from '../src/connection-ui.js';
import { ProviderRegistry } from '../src/providers.js';
import { saveResearch } from '../src/research.js';

const instant = Date.UTC(2026, 9, 20, 16);
function ctx(extra: Partial<WebContext> = {}): WebContext { return { signal: new AbortController().signal, authorize: () => {}, agentId: 'local-agent', scopeId: 'human-request', timeZone: 'America/New_York', ...extra }; }
type Source = WebSource & { totalChars: number; nextStart: number | null; contentOmitted: boolean; locator: { start: number; end: number } };
type Evidence = { sources: Source[]; cached: boolean; coalesced?: boolean; freshness: { category: string; maximumAgeSeconds: number }; feedback: { suppressed?: boolean; novelSources: number; potentialConflicts?: { values: string[]; sourceIds: string[] }[] } };
function setup(extra: Record<string, unknown> = {}) {
  const f = fixture(); let now = instant; let searches = 0; let reads = 0;
  const config = WebConfig.parse({ enabled: true, allowPublicRead: true, provider: { id: 'fixture', adapter: 'fixture', estimatedCostPerSearch: 0.002 }, requestsPerMinute: 120, ...extra });
  let search: SearchProvider['search'] = async request => [{ url: 'https://primary.example.org/' + encodeURIComponent(request.query), title: request.query, snippet: 'A distinct source for ' + request.query }];
  let read: WebTransport = async url => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: 'Source: ' + url.pathname });
  const web = new WebIntelligence(f.repo, f.session.id, { configuration: () => config, now: () => now, transport: async (...args) => { reads++; return read(...args); } });
  web.providers.register('fixture', () => ({ id: 'fixture', version: '1', capabilities: { freshness: true, language: true, region: true, dateRange: true }, search: async (...args) => { searches++; return search(...args); } }));
  return { ...f, web, config, now: () => now, advance(ms: number) { now += ms; }, counts: () => ({ searches, reads }), onSearch(callback: SearchProvider['search']) { search = callback; }, onRead(callback: WebTransport) { read = callback; } };
}

test("today's NBA schedule uses current evidence once and suppresses equivalent local-agent searches/reads", async () => {
  const f = setup(); const context = ctx({ request: "What is today's NBA schedule?" }); let generation = 0;
  f.onSearch(async request => { assert.match(request.query, /2026-10-20/); return [{ url: 'https://nba.example.org/schedule', title: 'NBA schedule', snippet: generation ? 'October 20 games, official schedule' : 'Older schedule snapshot' }]; });
  f.onRead(async () => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: 'Date: 2026-10-20\nGame: BOS vs NYK\nTipoff: 19:00 ET' }));
  try {
    const old = await f.web.execute('search', { query: "today's NBA schedule" }, context) as Evidence; f.advance(120000); generation++;
    const live = await f.web.execute('search', { query: 'NBA games today' }, context) as Evidence;
    assert.equal(live.cached, false); assert.equal(live.freshness.category, 'current'); assert.equal(live.freshness.maximumAgeSeconds, 60); assert.notEqual(live.sources[0]?.id, old.sources[0]?.id);
    for (const query of ["What is today's NBA schedule?", 'NBA fixtures for today', "today's NBA games"]) {
      const duplicate = await f.web.execute('search', { query }, context) as Evidence; assert.equal(duplicate.cached, true); assert.equal(duplicate.feedback.suppressed, true); assert.equal(duplicate.sources[0]?.text, ''); assert.equal(duplicate.sources[0]?.id, live.sources[0]?.id);
    }
    const page = await f.web.execute('read', { url: live.sources[0]!.url }, context) as Evidence;
    const answerFromLiveEvidence = page.sources[0]!.text; assert.match(answerFromLiveEvidence, /2026-10-20/); assert.match(answerFromLiveEvidence, /BOS vs NYK/); assert.match(answerFromLiveEvidence, /19:00 ET/);
    const duplicateRead = await f.web.execute('read', { url: live.sources[0]!.url + '#games' }, context) as Evidence; assert.equal(duplicateRead.sources[0]?.contentOmitted, true); assert.equal(duplicateRead.sources[0]?.id, page.sources[0]?.id);
    assert.deepEqual(f.counts(), { searches: 2, reads: 1 }); const metrics = f.web.diagnostics(); assert.equal(metrics.cacheHits, 4); assert.equal(metrics.successfulSearches, 2); assert.equal(metrics.approximateCost.knownEstimate, 0.004);
    const events = f.repo.events(f.session.id).filter(e => e.type === 'web_orchestration'); assert.ok(events.length >= 7);
  } finally { await f.close(); }
});

test('unknown freshness, explicit live requests, date rollover and failed providers never produce current cached answers', async () => {
  const f = setup({ orchestration: { simpleSearches: 10 } }); const context = ctx({ request: 'Find external facts' });
  try {
    const first = await f.web.execute('search', { query: 'ambiguous external topic' }, context) as Evidence; assert.equal(first.freshness.category, 'unknown'); assert.equal(first.freshness.maximumAgeSeconds, 60);
    await f.web.execute('search', { query: 'ambiguous external topic', fresh: true }, context); assert.equal(f.counts().searches, 2);
    f.advance(61000); f.onSearch(async () => { throw new Error('unavailable fixture'); });
    await assert.rejects(f.web.execute('search', { query: 'ambiguous external topic' }, context), { code: 'provider_error' });
    await assert.rejects(f.web.execute('cache', { action: 'get', sourceId: first.sources[0]!.id }, context), { code: 'freshness_unmet' });
    const midnight = freshnessDecision('NBA schedule today', f.config, Date.UTC(2026, 9, 21, 3, 59), 'America/New_York'); const next = freshnessDecision('NBA schedule today', f.config, Date.UTC(2026, 9, 21, 4, 1), 'America/New_York'); assert.notEqual(midnight.date, next.date);
  } finally { await f.close(); }
});

test('user-requested fresh retrieval bypasses an earlier scope cache once, then reuses fresh live observations', async () => {
  const f = setup(); try {
    await f.web.execute('search', { query: 'NBA games today' }, ctx({ scopeId: 'earlier' }));
    const context = ctx({ scopeId: 'explicit-human-request', request: 'Fetch live NBA schedule information' });
    const fresh = await f.web.execute('search', { query: 'NBA games today' }, context) as Evidence; assert.equal(fresh.cached, false);
    const repeated = await f.web.execute('search', { query: 'NBA games today' }, context) as Evidence; assert.equal(repeated.cached, true); assert.equal(f.counts().searches, 2);
  } finally { await f.close(); }
});

test('deduplication preserves date range, region, filters, intent, timezone and quoted meaning', async () => {
  const f = setup({ orchestration: { simpleSearches: 12 } });
  f.onSearch(async request => { if (request.region) assert.equal(request.region, request.region.toUpperCase()); return [{ url: 'https://primary.example.org/source', title: 'Validated filters', snippet: 'A source' }]; });
  try {
    const base = { query: 'technical performance comparison' };
    for (const options of [{}, { region: 'US' }, { region: 'GB' }, { dateRange: { from: '2026-01-01', to: '2026-02-01' } }, { dateRange: { from: '2026-02-01', to: '2026-03-01' } }, { intent: 'comparison' }, { domains: ['primary.example.org'] }, { query: 'technical "two  spaces"' }, { query: 'technical "two spaces"' }]) await f.web.execute('search', { ...base, ...options }, ctx());
    await f.web.execute('search', { ...base, region: 'us' }, ctx()); assert.equal(f.counts().searches, 9);
    const decision = freshnessDecision('NBA schedule today', f.config, instant, 'UTC'); const one = canonicalSearch(SearchInput.parse({ query: "today's NBA schedule", timeZone: 'UTC' }), decision); const two = canonicalSearch(SearchInput.parse({ query: 'NBA games today', timeZone: 'UTC' }), decision); assert.deepEqual(one, two);
    assert.notEqual(canonicalSearch(SearchInput.parse({ query: 'NBA games tonight' }), decision).identity, one.identity);
    assert.throws(() => SearchInput.parse({ query: 'q', dateRange: { from: '2026-02-01', to: '2026-01-01' } }));
  } finally { await f.close(); }
});

test('deep technical research extends productive budgets while simple scopes need an explicit reviewed extension', async () => {
  const f = setup({ orchestration: { simpleSearches: 2, deepSearches: 3, extensionSearches: 4 } });
  try {
    const deep = ctx({ scopeId: 'technical-project', profile: 'deep', request: 'Extensive technical research comparing database architectures' });
    for (let n = 0; n < 7; n++) { const result = await f.web.execute('search', { query: 'database architecture evidence ' + n, intent: 'technical' }, deep) as Evidence; assert.ok(result.feedback.novelSources > 0); }
    const scope = f.web.diagnostics().scopes.find(s => s.scopeId === 'technical-project')!; assert.equal(scope.extensions, 1); assert.equal(scope.searchLimit, 7); assert.equal(scope.searches, 7);
    await assert.rejects(f.web.execute('search', { query: 'additional technical evidence' }, deep), { code: 'budget_exhausted' });
    f.web.approveBudgetExtension('technical-project', 2, 1, 'Need an independent primary source to resolve one comparison');
    await f.web.execute('search', { query: 'independent technical architecture source' }, deep);
    const simple = ctx({ scopeId: 'simple-question' }); for (const query of ['simple one', 'simple two']) await f.web.execute('search', { query }, simple);
    await assert.rejects(f.web.execute('search', { query: 'simple three' }, simple), { code: 'budget_exhausted' });
    f.web.approveBudgetExtension('simple-question', 1, 0, 'Initial sources did not address the specific question'); await f.web.execute('search', { query: 'simple three' }, simple);
    assert.throws(() => f.web.approveBudgetExtension('other-session-scope', 1, 0, 'No grant'), { code: 'source_unavailable' });
  } finally { await f.close(); }
});

test('unproductive deep queries do not earn automatic extensions, but new evidence remains allowed within budget', async () => {
  const f = setup({ orchestration: { deepSearches: 3 } }); const constant: ProviderResult[] = [{ url: 'https://primary.example.org/same', title: 'Same source', snippet: 'Unchanged evidence' }]; f.onSearch(async () => constant);
  try {
    const deep = ctx({ profile: 'deep', scopeId: 'deep-unchanged', request: 'Deep research' });
    for (const query of ['technical first', 'technical second', 'technical third']) await f.web.execute('search', { query }, deep);
    await assert.rejects(f.web.execute('search', { query: 'technical fourth' }, deep), { code: 'budget_exhausted' }); assert.equal(f.web.diagnostics().scopes[0]?.extensions, 0);
  } finally { await f.close(); }
});

test('failed retries are suppressed with actionable feedback and recover after a bounded cooldown', async () => {
  const f = setup({ orchestration: { simpleSearches: 10, retryCooldownMs: 1000 } }); const context = ctx(); f.onSearch(async () => { throw new Error('offline'); });
  try {
    for (let n = 0; n < 2; n++) await assert.rejects(f.web.execute('search', { query: 'same retry' }, context), { code: 'provider_error' });
    await assert.rejects(f.web.execute('search', { query: 'same retry' }, context), (error: unknown) => { const e = error as { code: string; feedback: { suggestions: string[] } }; assert.equal(e.code, 'retry_suppressed'); assert.ok(e.feedback.suggestions.length); return true; });
    assert.equal(f.counts().searches, 2); f.advance(1001); f.onSearch(async () => [{ url: 'https://primary.example.org/recovered', title: 'Recovered', snippet: 'New evidence' }]);
    await f.web.execute('search', { query: 'same retry' }, context); assert.equal(f.counts().searches, 3); assert.equal(f.web.diagnostics().suppressedCalls, 1);
  } finally { await f.close(); }
});

test('unregistered providers are retry-limited without fake cached fallback', async () => {
  const f = setup(); f.config.provider!.adapter = 'unavailable';
  try { for (let n = 0; n < 2; n++) await assert.rejects(f.web.execute('search', { query: 'missing service' }, ctx()), { code: 'provider_unavailable' }); await assert.rejects(f.web.execute('search', { query: 'missing service' }, ctx()), { code: 'retry_suppressed' }); assert.equal(f.repo.list('web_source', f.session.id).length, 0); assert.equal(f.counts().searches, 0); }
  finally { await f.close(); }
});

test('repeated page refreshes with no new evidence are suppressed, while changed pages reset novelty', async () => {
  const f = setup({ orchestration: { simpleReads: 10 } }); f.onRead(async () => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: 'Value: unchanged' }));
  try {
    for (let n = 0; n < 3; n++) await f.web.execute('read', { url: 'https://primary.example.org/current', maxAgeSeconds: 0 }, ctx());
    await assert.rejects(f.web.execute('read', { url: 'https://primary.example.org/current', maxAgeSeconds: 0 }, ctx()), { code: 'loop_prevented' }); assert.equal(f.counts().reads, 3);
    f.advance(61000); f.onRead(async () => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: 'Value: changed' }));
    const changed = await f.web.execute('read', { url: 'https://primary.example.org/current', fresh: true }, ctx()) as Evidence; assert.equal(changed.feedback.novelSources, 1); assert.match(changed.sources[0]!.text, /changed/);
  } finally { await f.close(); }
});

test('conflicting sources stay distinct and trigger comparison feedback rather than an invented consensus', async () => {
  const f = setup(); f.onRead(async url => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: 'Tipoff: ' + (url.hostname.startsWith('one') ? '19:00 ET' : '20:00 ET') }));
  try {
    const context = ctx({ request: "Today's NBA schedule" }); const one = await f.web.execute('read', { url: 'https://one.example.org/game' }, context) as Evidence;
    const two = await f.web.execute('read', { url: 'https://two.example.org/game' }, context) as Evidence;
    assert.deepEqual(two.feedback.potentialConflicts?.[0]?.values, ['19:00 ET', '20:00 ET']); assert.deepEqual(two.feedback.potentialConflicts?.[0]?.sourceIds, [one.sources[0]!.id, two.sources[0]!.id]);
    const verification = await f.web.execute('verify', { claim: { kind: 'text', text: 'Tipoff is 19:00 ET' }, sourceIds: [one.sources[0]!.id, two.sources[0]!.id] }, context) as { independentlyVerified: boolean }; assert.equal(verification.independentlyVerified, false);
    f.web.approveBudgetExtension(context.scopeId!, 1, 1, 'Conflicting tipoff times require a current primary source'); assert.equal(f.web.diagnostics().scopes[0]?.extensions, 1);
  } finally { await f.close(); }
});

test('long content stays in storage, source sections retain offsets and repeated excerpts are omitted per agent', async () => {
  const f = setup(); const text = 'Introduction\n' + 'background '.repeat(1000) + '\nRelevant target detail: retained section beyond the old limit\n' + 'appendix '.repeat(1000); f.onRead(async () => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: text }));
  try {
    const first = await f.web.execute('read', { url: 'https://primary.example.org/large', focus: 'Relevant target detail retained section' }, ctx()) as Evidence; const source = first.sources[0]!;
    assert.ok(source.text.length <= 900); assert.ok(source.totalChars > 12000); assert.match(source.text, /Relevant target/);
    const stored = f.repo.get<WebSource>('web_source', source.id)!; assert.equal(stored.text.slice(source.locator.start, source.locator.end), source.text);
    const next = await f.web.execute('cache', { action: 'get', sourceId: source.id, start: 13000, length: 1500 }, ctx()) as { source: Source }; assert.equal(next.source.text, stored.text.slice(13000, 14500));
    const again = await f.web.execute('cache', { action: 'get', sourceId: source.id, start: 13000, length: 1500 }, ctx()) as { source: Source }; assert.equal(again.source.text, '');
    const recover = await f.web.execute('cache', { action: 'get', sourceId: source.id, start: 13000, length: 1500, includePreviouslySeen: true }, ctx()) as { source: Source }; assert.equal(recover.source.text, next.source.text);
    const cloud = await f.web.execute('read', { url: source.url, focus: 'Relevant target detail retained section' }, ctx({ agentId: 'cloud-agent' })) as Evidence; assert.equal(cloud.cached, true); assert.ok(cloud.sources[0]!.text.length); assert.equal(f.counts().reads, 1);
  } finally { await f.close(); }
});

test('concurrent equivalent calls share one backend and cancellation of one waiter does not cancel another', async () => {
  const f = setup(); let finish: (value: unknown) => void = () => {}; f.onSearch(() => new Promise(resolve => { finish = resolve; }));
  try {
    const first = new AbortController(); const a = f.web.execute('search', { query: 'NBA games today' }, ctx({ signal: first.signal }));
    const b = f.web.execute('search', { query: "today's NBA schedule" }, ctx({ agentId: 'cloud-agent' })); await Promise.resolve(); first.abort();
    await assert.rejects(a, { code: 'cancelled' }); finish([{ url: 'https://nba.example.org/schedule', title: 'Live', snippet: 'Fresh snapshot' }]);
    const second = await b as Evidence; assert.equal(second.coalesced, true); assert.equal(f.counts().searches, 1);
  } finally { await f.close(); }
});

test('scopes and per-agent ceilings cannot be reset by model query options or peer handoffs', async () => {
  const f = setup({ orchestration: { simpleSearches: 1, agentSearches: 2 } });
  try {
    await f.web.execute('search', { query: 'one' }, ctx()); await assert.rejects(f.web.execute('search', { query: 'two' }, ctx({ agentId: 'peer-agent' })), { code: 'budget_exhausted' });
    await f.web.execute('search', { query: 'two' }, ctx({ scopeId: 'new-human-request' })); await assert.rejects(f.web.execute('search', { query: 'three' }, ctx({ scopeId: 'third-human-request' })), { code: 'budget_exhausted' });
    assert.throws(() => SearchInput.parse({ query: 'escalate', profile: 'deep', scopeId: 'forged', extraBudget: 100 }));
  } finally { await f.close(); }
});

test('existing diagnostics exposes web metrics and extensions require a concrete human confirmation', async () => {
  const f = setup(); try {
    await f.web.execute('search', { query: 'technical source' }, ctx()); await f.web.execute('search', { query: 'technical source' }, ctx());
    const rows = webDiagnosticsRows(f.web).join('\n'); assert.match(rows, /Successful searches: 1/); assert.match(rows, /cache hits: 1/); assert.match(rows, /0\.0020/);
    const prompts: string[] = []; const output: unknown[] = []; const replies = ['y', '1', '2', '1', 'Resolve a conflict', 'n'];
    await webDiagnosticsMenu(f.web, { ask: async label => { prompts.push(label); return replies.shift() ?? 'n'; }, print: value => { output.push(value); } });
    assert.equal(f.web.diagnostics().scopes[0]?.extensions, 0); assert.ok(prompts.includes('Approve this exact extension? [y/N]')); assert.match(JSON.stringify(output), /add 2 searches and 1 reads/);
    const registry = await ProviderRegistry.create(f.home); await diagnosticsMenu(registry, { ask: async () => 'n', print: value => { output.push(value); } }, f.web); assert.match(JSON.stringify(output), /Duplicate\/reused calls/);
  } finally { await f.close(); }
});

test('registry binds budgets to the targeted human request and keeps agent-controlled fields out of context', async () => {
  const f = fixture(); try {
    saveResearch(f.home, { web: WebConfig.parse({ enabled: true, provider: { id: 'fixture', adapter: 'fixture' } }) });
    const a = await agent(f.engine); const b = await agent(f.engine); await f.engine.pause();
    f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body: 'Extensive technical research comparing runtimes' });
    f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [b.id], type: 'human', body: "Today's NBA schedule" });
    assert.equal(f.engine.webContext(a.id).profile, 'deep'); assert.equal(f.engine.webContext(b.id).profile, 'simple'); assert.notEqual(f.engine.webContext(a.id).scopeId, f.engine.webContext(b.id).scopeId);
    assert.equal((await tool(f.engine, a, 'web.search', { query: 'q', scopeId: 'forged' })).ok, false);
  } finally { await f.close(); }
});

test('diagnostics counts permission and schema failures without recording backend attempts', async () => {
  const f = fixture(); try {
    saveResearch(f.home, { web: WebConfig.parse({ enabled: true, provider: { id: 'fixture', adapter: 'fixture' } }) }); const a = await agent(f.engine);
    await tool(f.engine, a, 'web.search', { query: 'denied' }); a.permissions.push('network.research'); f.repo.put('agent', a);
    await tool(f.engine, a, 'web.search', { query: 'invalid', count: 99 });
    const report = f.engine.web.diagnostics(); assert.equal(report.failedToolCalls, 2); assert.equal(report.providerLatency.requests, 0); assert.equal(report.successfulSearches, 0);
  } finally { await f.close(); }
});
