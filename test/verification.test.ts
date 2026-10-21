import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fixture, agent, tool, noop } from './helpers.js';
import { WebIntelligence } from '../src/web-intelligence.js';
import { WebConfig, type WebSource } from '../src/web-types.js';
import { MockSearchProvider } from '../src/web-providers.js';
import { type EvidenceRecord, type VerificationResult } from '../src/verification.js';
import { completionReport, resolveFailure } from '../src/completion.js';
import { finishCodeWork } from '../src/code-work.js';
import { Engine } from '../src/engine.js';
import type { Task } from '../src/domain.js';
import type { WebTransport } from '../src/web-http.js';

const data = JSON.parse(readFileSync(new URL('./fixtures/verification.json', import.meta.url), 'utf8')) as { records: Record<string, string | number>[]; equivalent: Record<string, string | number>[]; maliciousInstruction: string };
const fields = { id: { type: 'identifier' }, team: { type: 'name', aliases: { 'New York Knicks': ['NY Knicks'], 'LA Clippers': ['Los Angeles Clippers'] } }, date: { type: 'date' }, time: { type: 'time' }, tickets: { type: 'count' }, price: { type: 'number' } };
const criteria = { description: 'Compare the exact schedule records and unique totals', allowedHosts: ['example.com', 'other.example.com'], recordsKey: 'records', fields, identity: ['id'], aggregates: [{ name: 'games', operation: 'count' }, { name: 'tickets', operation: 'sum', field: 'tickets' }] };
const context = () => ({ authorize: () => {}, signal: new AbortController().signal, agentId: 'fixture' });
function setup() {
  const f = fixture(); let time = Date.now(); const pages = new Map<string, unknown>(); let calls = 0;
  const configuration = WebConfig.parse({ enabled: true, allowPublicRead: true, requestsPerMinute: 120, orchestration: { simpleReads: 20 } });
  const transport: WebTransport = async url => { calls++; return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(pages.get(url.href) ?? { records: data.records }) }; };
  const web = new WebIntelligence(f.repo, f.session.id, { configuration: () => configuration, transport, now: () => time });
  Object.defineProperty(f.engine, 'web', { value: web });
  const read = async (url = 'https://example.com/schedule') => (await web.execute('read', { url }, context()) as { sources: WebSource[] }).sources[0]!;
  const input = (contractId: string, sources: string[], rows = data.equivalent, totals: Record<string, number> = { games: 2, tickets: 30 }) => ({ contractId, claim: { text: 'The recorded schedule and totals', records: rows, totals }, citations: sources.map(sourceId => ({ sourceId })) });
  const verify = async (contractId: string, sources: string[], rows = data.equivalent, totals: Record<string, number> = { games: 2, tickets: 30 }) => await web.execute('verify', input(contractId, sources, rows, totals), context()) as VerificationResult;
  return { ...f, web, pages, configuration, read, input, verify, advance: (ms: number) => { time += ms; }, calls: () => calls };
}

test('deterministic names, dates, offset times, IDs, counts and numbers retain claim/evidence provenance', async () => {
  const f = setup(); try {
    const c = f.web.verification.require(criteria); const source = await f.read(); const result = await f.verify(c.id, [source.id]);
    assert.equal(result.state, 'confirmed'); assert.equal(result.method, 'deterministic_records_v1'); assert.equal(result.usedLLM, false); assert.equal(result.independentlyVerified, false);
    const evidence = f.repo.get<EvidenceRecord>('verification_evidence', result.evidenceIds[0]!)!;
    assert.equal(evidence.claimId, result.id); assert.equal(evidence.sourceId, source.id); assert.equal(evidence.url, source.url); assert.equal(evidence.retrievedAt, source.retrievedAt); assert.equal(evidence.sourceHash, source.hash); assert.equal(evidence.contentHash.length, 64); assert.match(evidence.passages[0]!.text, /game-01/); assert.equal(evidence.untrusted, true);
    assert.equal(f.web.verification.status(c.id).passed, true);
    const denied = await tool(f.engine, await agent(f.engine), 'roundtable_verification_requirements', { taskId: 'unknown' }); assert.deepEqual(denied.data, []);
  } finally { await f.close(); }
});

test('numerical total discrepancies cite exact evidence; identical duplicates cannot inflate counts', async () => {
  const f = setup(); try {
    f.pages.set('https://example.com/schedule', { records: [...data.records, data.records[0]] });
    const c = f.web.verification.require(criteria); const source = await f.read(); const result = await f.verify(c.id, [source.id], data.equivalent, { games: 3, tickets: 40 });
    assert.equal(result.state, 'contradicted'); assert.ok(result.issues.some(i => i.code === 'duplicate_records'));
    assert.ok(result.issues.some(i => i.code === 'aggregate_mismatch' && i.field === 'tickets' && i.actual === 30 && i.expected === 40 && i.sourceId === source.id && result.evidenceIds.includes(i.evidenceId!)));
    assert.equal((await f.verify(c.id, [source.id])).state, 'confirmed');
  } finally { await f.close(); }
});

test('different entities, case-sensitive identifiers and different dates/times never merge', async () => {
  const f = setup(); try {
    const source = await f.read();
    for (const change of [{ team: 'Los Angeles Lakers' }, { id: 'GAME-02' }, { date: '2026-10-21' }, { time: '2026-10-21T01:00:00Z' }, { price: 150 }]) {
      const c = f.web.verification.require(criteria); const rows = structuredClone(data.equivalent); Object.assign(rows[0]!, change);
      assert.equal((await f.verify(c.id, [source.id], rows)).state, 'contradicted');
    }
  } finally { await f.close(); }
});

test('contradictory source records block confirmation even when another source agrees', async () => {
  const f = setup(); try {
    const rows = structuredClone(data.records); rows[0]!.tickets = 9; f.pages.set('https://other.example.com/schedule', { records: rows });
    const c = f.web.verification.require(criteria); const a = await f.read(); const b = await f.read('https://other.example.com/schedule'); const result = await f.verify(c.id, [a.id, b.id]);
    assert.equal(result.state, 'insufficient_evidence'); assert.ok(result.issues.some(i => i.code === 'conflicting_sources')); assert.equal(f.web.verification.status(c.id).passed, false);
  } finally { await f.close(); }
});

test('prose, keywords, malformed records and contradictory duplicate identities provide insufficient evidence', async () => {
  const f = setup(); try {
    for (const [i, page] of [{ records: 'NY Knicks tickets 30 verified' }, { records: [{ ...data.records[0], date: '20/10/2026' }] }, { records: [data.records[0], { ...data.records[0], tickets: 999 }] }].entries()) {
      const url = `https://example.com/unsupported${i}`; f.pages.set(url, page); const source = await f.read(url); const c = f.web.verification.require(criteria);
      const result = await f.verify(c.id, [source.id]); assert.equal(result.state, 'insufficient_evidence'); assert.ok(result.issues.some(i => i.code === 'unsupported_source_records'));
    }
  } finally { await f.close(); }
});

test('unknown, stale, tampered, cross-session and fabricated citations fail closed', async () => {
  const f = setup(); const other = setup(); try {
    const contract = () => f.web.verification.require(criteria).id;
    const source = await f.read(); const foreign = await other.read();
    assert.equal((await f.verify(contract(), [randomUUID()])).state, 'insufficient_evidence');
    assert.equal((await f.verify(contract(), [foreign.id])).state, 'insufficient_evidence');
    const original = f.repo.get<WebSource>('web_source', source.id)!;
    const changed = { ...original, text: 'tampered' }; f.repo.put('web_source', changed);
    assert.equal((await f.verify(contract(), [source.id])).state, 'insufficient_evidence'); f.repo.put('web_source', original);
    const value = f.input(contract(), [source.id]); Object.assign(value.citations[0]!, { start: 0, end: 10, quote: 'invented!' });
    const result = await f.web.execute('verify', value, context()) as VerificationResult; assert.ok(result.issues.some(i => i.code === 'citation_mismatch'));
    const staleCriteria = f.web.verification.require(criteria); f.advance(61000);
    assert.equal((await f.verify(staleCriteria.id, [source.id])).state, 'insufficient_evidence');
  } finally { await f.close(); await other.close(); }
});

test('source count requires distinct allowed origins; snippets and unapproved URLs do not count', async () => {
  const f = setup(); try {
    const c = f.web.verification.require({ ...criteria, minimumSources: 2 }); const a = await f.read(); const b = await f.read('https://example.com/another');
    assert.equal((await f.verify(c.id, [a.id, a.id, b.id])).state, 'insufficient_evidence');
    const other = await f.read('https://other.example.com/schedule'); assert.equal((await f.verify(c.id, [a.id, other.id])).state, 'confirmed');
    const restricted = f.web.verification.require({ ...criteria, sourceUrls: ['https://example.com/official'] }); assert.equal((await f.verify(restricted.id, [a.id])).state, 'insufficient_evidence');
    const unapproved = await f.read('https://outside.example.org/page'); const c2 = f.web.verification.require(criteria); assert.equal((await f.verify(c2.id, [unapproved.id])).state, 'insufficient_evidence');
  } finally { await f.close(); }
});

test('malicious source instructions remain data and cannot change criteria, permissions or perform network calls', async () => {
  const f = setup(); try {
    f.pages.set('https://example.com/schedule', { records: data.records, instructions: data.maliciousInstruction });
    const a = await agent(f.engine); a.permissions.push('network.research'); f.repo.put('agent', a);
    const c = f.web.verification.require(criteria); const source = await f.read(); const before = f.calls(); const permissions = structuredClone(f.engine.session().permissions);
    const result = await tool<VerificationResult>(f.engine, a, 'web.verify', f.input(c.id, [source.id])); assert.equal(result.ok, true); assert.equal(result.data.state, 'confirmed');
    assert.equal(f.calls(), before); assert.deepEqual(f.engine.session().permissions, permissions); assert.equal(f.web.verification.contracts()[0]!.criteriaHash, c.criteriaHash);
    const overwrite = { ...f.input(c.id, [source.id]), criteria: { allowedHosts: ['localhost'] } }; assert.equal((await tool(f.engine, a, 'web.verify', overwrite)).ok, false);
    assert.equal(f.engine.tools.names().some(n => n.includes('criteria_update')), false);
    assert.equal((await tool(f.engine, a, 'web.read', { url: 'http://127.0.0.1/credentials' })).ok, false); assert.equal(f.calls(), before);
  } finally { await f.close(); }
});

test('human criteria and verdict/evidence integrity are protected; generated assessment is rejected', async () => {
  const f = setup(); try {
    const c = f.web.verification.require(criteria); const source = await f.read(); const result = await f.verify(c.id, [source.id]);
    const c2 = { ...c, minimumSources: 0 }; f.repo.put('verification_contract', c2); assert.equal(f.web.verification.status(c.id).passed, false); f.repo.put('verification_contract', c);
    const evidence = f.repo.get<EvidenceRecord>('verification_evidence', result.evidenceIds[0]!)!; evidence.passages[0]!.text = 'self-authored proof'; f.repo.put('verification_evidence', evidence); assert.equal(f.web.verification.status(c.id).passed, false);
    await assert.rejects(f.web.execute('verify', { ...f.input(c.id, [source.id]), modelVerdict: 'confirmed' }, context()), { code: 'invalid_input' });
    assert.throws(() => f.web.verification.require({ ...criteria, fields: { ...fields, team: { type: 'name', aliases: { Knicks: ['NY'], Nets: ['NY'] } } } }), /Ambiguous/);
  } finally { await f.close(); }
});

test('recovery detects unchanged evidence despite new claim text and stops at protected attempt budget', async () => {
  const f = setup(); try {
    const c = f.web.verification.require(criteria); const source = await f.read();
    const first = await f.verify(c.id, [source.id], data.equivalent, { games: 99, tickets: 30 }); assert.equal(first.feedback.retryAllowed, true);
    const input = f.input(c.id, [source.id], data.equivalent, { games: 99, tickets: 30 }); input.claim.text = 'A persuasive rewritten explanation';
    const second = await f.web.execute('verify', input, context()) as VerificationResult; assert.equal(second.feedback.retryAllowed, false);
    await assert.rejects(f.verify(c.id, [source.id]), { code: 'verification_stopped' });
    const limited = f.web.verification.require({ ...criteria, maxAttempts: 1 }); await f.verify(limited.id, [source.id], data.equivalent, { games: 9, tickets: 9 }); await assert.rejects(f.verify(limited.id, [source.id]), { code: 'verification_stopped' });
  } finally { await f.close(); }
});

test('invalid numbers, ambiguous dates and missing claim fields yield verification_error', async () => {
  const f = setup(); try {
    const source = await f.read();
    for (const change of [{ tickets: 'twenty' }, { tickets: -1 }, { price: '12,50' }, { date: '2026-02-30' }, { time: '7:30 pm EST' }]) {
      const c = f.web.verification.require(criteria); const rows = structuredClone(data.equivalent); Object.assign(rows[0]!, change); assert.equal((await f.verify(c.id, [source.id], rows)).state, 'verification_error');
    }
  } finally { await f.close(); }
});

test('task done and completion diagnostics require current evidence and cannot waive missing evidence', async () => {
  const f = setup(); try {
    const a = await agent(f.engine); a.permissions.push('network.research'); f.repo.put('agent', a);
    const task = (await tool<Task>(f.engine, a, 'roundtable_task_create', { title: 'Verify schedule' })).data; await tool(f.engine, a, 'roundtable_task_claim', { taskId: task.id });
    assert.equal((await tool(f.engine, a, 'roundtable_task_update', { taskId: task.id, findings: 'I am sure', state: 'done' })).ok, false);
    const c = f.web.verification.require({ ...criteria, taskId: task.id }); const source = await f.read(); await tool(f.engine, a, 'web.verify', f.input(c.id, [source.id]));
    assert.equal((await tool(f.engine, a, 'roundtable_task_update', { taskId: task.id, findings: 'Checked records', state: 'done' })).ok, true);
    assert.equal(completionReport(f.engine).completedTasks.length, 1); f.advance(61000);
    const report = completionReport(f.engine); assert.equal(report.completedTasks.length, 0); assert.ok(report.failures.some(f => f.kind === 'required evidence'));
    assert.throws(() => resolveFailure(f.engine, 'evidence:' + task.id, 'trust me'), /cannot be waived/);
    assert.throws(() => finishCodeWork(f.engine, task.id, a.id, 'bypass'), /work item|code|Code/);
  } finally { await f.close(); }
});

test('registry permission denial, receipt freshness, protected expected records and same-model independence', async () => {
  const f = setup(); try {
    const a = await agent(f.engine); const c = f.web.verification.require({ ...criteria, expectedRecords: data.records }); const source = await f.read(); const input = f.input(c.id, [source.id]);
    assert.equal((await tool(f.engine, a, 'web.verify', input)).ok, false); a.permissions.push('network.research'); f.repo.put('agent', a);
    const callId = randomUUID(); const result = await f.engine.tools.execute(a, 'web.verify', input, callId) as { ok: boolean; data: VerificationResult }; assert.equal(result.ok, true); assert.equal(result.data.author, a.id); assert.equal(result.data.independentlyVerified, false);
    f.advance(61000); assert.equal((await f.engine.tools.execute(a, 'web.verify', input, callId) as { ok: boolean }).ok, false);
    const rows = structuredClone(data.records); rows[0]!.tickets = 999; f.pages.set('https://example.com/new', { records: rows }); const s2 = await f.read('https://example.com/new'); const rejected = await f.verify(c.id, [s2.id], rows, { games: 2, tickets: 1019 }); assert.equal(rejected.state, 'contradicted'); assert.ok(rejected.issues.some(i => i.code.startsWith('acceptance_')));
  } finally { await f.close(); }
});

test('persisted criteria and source relationships survive same-session runtime restart', async () => {
  const f = setup(); let restored: Engine | undefined; try {
    const c = f.web.verification.require(criteria); const source = await f.read(); const v = await f.verify(c.id, [source.id]);
    await f.engine.close(); restored = new Engine(f.repo, f.session.id, async () => noop); Object.defineProperty(restored, 'web', { value: new WebIntelligence(f.repo, f.session.id, { configuration: () => f.configuration }) });
    assert.equal(restored.web.verification.status(c.id).verificationId, v.id); assert.equal(restored.web.verification.status(c.id).passed, true);
  } finally { await restored?.close(); await f.close(); }
});

test('decimal sums avoid binary rounding errors; claim schema and partial citations remain conservative', async () => {
  const f = setup(); try {
    const rows = structuredClone(data.records); rows[0]!.price = 0.1; rows[1]!.price = 0.2; f.pages.set('https://example.com/schedule', { records: rows }); const source = await f.read();
    const c = f.web.verification.require({ ...criteria, aggregates: [{ name: 'price', operation: 'sum', field: 'price' }] });
    const value = f.input(c.id, [source.id], rows); value.claim.totals = { price: 0.3 };
    assert.equal((await f.web.execute('verify', value, context()) as VerificationResult).state, 'confirmed');
    const partial = f.input(f.web.verification.require(criteria).id, [source.id]); Object.assign(partial.citations[0]!, { start: 0, end: 1, quote: '{' });
    const result = await f.web.execute('verify', partial, context()) as VerificationResult; assert.equal(result.state, 'insufficient_evidence'); assert.ok(result.issues.some(i => i.code === 'partial_citation'));
    const missing = structuredClone(data.records); delete missing[0]!.time; assert.equal((await f.verify(f.web.verification.require(criteria).id, [source.id], missing)).state, 'verification_error');
  } finally { await f.close(); }
});

test('search snippets and matching keywords never satisfy structured factual verification', async () => {
  const f = setup(); try {
    f.configuration.provider = { id: 'test', adapter: 'fixture', allowPrivateEndpoint: false }; const mock = new MockSearchProvider([{ title: 'Schedule', url: 'https://example.com/page', snippet: JSON.stringify({ records: data.records }) }]); f.web.providers.register('fixture', () => mock);
    const source = (await f.web.execute('search', { query: 'NBA today' }, context()) as { sources: WebSource[] }).sources[0]!;
    const result = await f.verify(f.web.verification.require(criteria).id, [source.id]); assert.equal(result.state, 'insufficient_evidence'); assert.ok(result.issues.some(i => i.code === 'ineligible_source'));
  } finally { await f.close(); }
});

test('changing wrong totals without improving evidence stops recovery after bounded corrections', async () => {
  const f = setup(); try {
    const source = await f.read(); const c = f.web.verification.require(criteria);
    for (const games of [9, 8, 7]) { const v = await f.verify(c.id, [source.id], data.equivalent, { games, tickets: 30 }); assert.equal(v.feedback.retryAllowed, games !== 7); }
    await assert.rejects(f.verify(c.id, [source.id]), { code: 'verification_stopped' });
    f.web.verification.drop(c.id, 'Human review of stalled recovery'); const replacement = f.web.verification.require(criteria); assert.equal((await f.verify(replacement.id, [source.id])).state, 'confirmed');
    assert.equal(f.repo.list('claim_verdict', f.session.id).length, 4); assert.ok(f.repo.events(f.session.id).some(e => e.type === 'human_evidence_criteria_removed'));
  } finally { await f.close(); }
});

test('superseded verdicts cannot replay success and paused or revoked runtime blocks verification', async () => {
  const f = setup(); try {
    const a = await agent(f.engine); a.permissions.push('network.research'); f.repo.put('agent', a); const c = f.web.verification.require(criteria); const source = await f.read(); const input = f.input(c.id, [source.id]); const callId = randomUUID();
    assert.equal((await f.engine.tools.execute(a, 'web.verify', input, callId) as { ok: boolean }).ok, true);
    const bad = f.input(c.id, [source.id], data.equivalent, { games: 3, tickets: 30 }); assert.equal((await tool<VerificationResult>(f.engine, a, 'web.verify', bad)).data.state, 'contradicted');
    assert.equal((await f.engine.tools.execute(a, 'web.verify', input, callId) as { ok: boolean }).ok, false);
    const attempts = f.repo.list('claim_verdict', f.session.id).length; await f.engine.pause('test pause'); assert.equal((await tool(f.engine, a, 'web.verify', input)).ok, false); assert.equal(f.repo.list('claim_verdict', f.session.id).length, attempts);
  } finally { await f.close(); }
});

test('large discrepancy reports are bounded while complete evidence remains stored', async () => {
  const f = setup(); try {
    const rows = Array.from({ length: 40 }, (_, i) => ({ ...data.records[0]!, id: 'id-' + i, team: 'x'.repeat(1000) })); const claims = rows.map(r => ({ ...r, team: 'y'.repeat(1000) })); f.pages.set('https://example.com/schedule', { records: rows });
    const source = await f.read(); const c = f.web.verification.require(criteria); const v = await f.verify(c.id, [source.id], claims, { games: 40, tickets: 400 });
    assert.equal(v.state, 'contradicted'); assert.ok(Buffer.byteLength(JSON.stringify(v)) < 50000); assert.ok(v.issues.some(i => i.code === 'additional_discrepancies'));
    assert.ok(f.repo.get<EvidenceRecord>('verification_evidence', v.evidenceIds[0]!)!.passages[0]!.text.length > 40000);
  } finally { await f.close(); }
});

test('stale dependency evidence blocks new work even if its historical task state is done', async () => {
  const f = setup(); try {
    const a = await agent(f.engine); const first = (await tool<Task>(f.engine, a, 'roundtable_task_create', { title: 'Verified prerequisite' })).data; await tool(f.engine, a, 'roundtable_task_claim', { taskId: first.id });
    const c = f.web.verification.require({ ...criteria, taskId: first.id }); const source = await f.read(); await f.verify(c.id, [source.id]); assert.equal((await tool(f.engine, a, 'roundtable_task_update', { taskId: first.id, findings: 'checked', state: 'done' })).ok, true);
    const second = (await tool<Task>(f.engine, a, 'roundtable_task_create', { title: 'Dependent', dependencies: [first.id] })).data; f.advance(61000);
    assert.equal((await tool(f.engine, a, 'roundtable_task_claim', { taskId: second.id })).ok, false);
  } finally { await f.close(); }
});

test('empty retrieved record sets can confirm explicit zero counts without inventing games', async () => {
  const f = setup(); try {
    f.pages.set('https://example.com/schedule', { records: [] }); const source = await f.read(); const c = f.web.verification.require(criteria);
    const v = await f.verify(c.id, [source.id], [], { games: 0, tickets: 0 }); assert.equal(v.state, 'confirmed');
    assert.equal((await f.verify(c.id, [source.id], [], { games: 1, tickets: 0 })).state, 'contradicted');
  } finally { await f.close(); }
});

test('protected date requirements prevent consistent records from answering the wrong day', async () => {
  const f = setup(); try {
    const source = await f.read(); const c = f.web.verification.require({ ...criteria, requiredValues: { date: '2026-10-21' } });
    const v = await f.verify(c.id, [source.id]); assert.equal(v.state, 'contradicted'); assert.ok(v.issues.some(i => i.code === 'acceptance_required_value' && i.field === 'date'));
    const a = await agent(f.engine); a.permissions.push('network.research'); f.repo.put('agent', a); a.permissions = a.permissions.filter(p => p !== 'network.research'); f.repo.put('agent', a);
    assert.equal((await tool(f.engine, a, 'web.verify', f.input(c.id, [source.id]))).ok, false);
  } finally { await f.close(); }
});

test('decimal precision loss never turns different numeric source values into confirmation', async () => {
  const f = setup(); try {
    const rows = structuredClone(data.records); rows[0]!.price = '0.10000000000000001'; f.pages.set('https://example.com/schedule', { records: rows }); const source = await f.read();
    const claim = structuredClone(data.records); claim[0]!.price = 0.1;
    assert.equal((await f.verify(f.web.verification.require(criteria).id, [source.id], claim)).state, 'insufficient_evidence');
    const raw = JSON.stringify({ records: rows }).replace('"0.10000000000000001"', '0.10000000000000001');
    const web = new WebIntelligence(f.repo, f.session.id, { configuration: () => f.configuration, transport: async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: raw }) });
    const parsedSource = (await web.execute('read', { url: 'https://example.com/precision' }, context()) as { sources: WebSource[] }).sources[0]!;
    const c = web.verification.require(criteria); const v = await web.execute('verify', f.input(c.id, [parsedSource.id], claim), context()) as VerificationResult; assert.equal(v.state, 'insufficient_evidence');
  } finally { await f.close(); }
});

test('credential-bearing verification input is blocked before storing a claim', async () => {
  const f = setup(); const previous = process.env.ROUNDTABLE_VERIFY_TEST_SECRET; process.env.ROUNDTABLE_VERIFY_TEST_SECRET = 'opaque-verification-test-value';
  try {
    const source = await f.read(); const c = f.web.verification.require(criteria); const input = f.input(c.id, [source.id]); input.claim.text = process.env.ROUNDTABLE_VERIFY_TEST_SECRET;
    await assert.rejects(f.web.execute('verify', input, context()), { code: 'sensitive_input' }); assert.equal(f.repo.list('verified_claim', f.session.id).length, 0);
    assert.throws(() => f.web.verification.verify(input, 'host'), { code: 'sensitive_input' });
    assert.throws(() => f.web.verification.require({ ...criteria, description: process.env.ROUNDTABLE_VERIFY_TEST_SECRET }), { code: 'sensitive_input' });
    assert.ok(!JSON.stringify(f.repo.events(f.session.id)).includes(process.env.ROUNDTABLE_VERIFY_TEST_SECRET));
  } finally { if (previous === undefined) delete process.env.ROUNDTABLE_VERIFY_TEST_SECRET; else process.env.ROUNDTABLE_VERIFY_TEST_SECRET = previous; await f.close(); }
});

test('missing citations, omitted records and fabricated extra records never confirm a complete set', async () => {
  const f = setup(); try {
    const c = f.web.verification.require(criteria); const a = await f.read();
    await assert.rejects(f.verify(c.id, []), { code: 'invalid_input' });
    const omitted = await f.verify(c.id, [a.id], data.equivalent.slice(0, 1), { games: 1, tickets: Number(data.equivalent[0]!.tickets) });
    assert.notEqual(omitted.state, 'confirmed');
    const extra: Record<string, string | number> = { ...data.equivalent[0]!, id: 'fabricated-game' };
    const fabricated = await f.verify(c.id, [a.id], [...data.equivalent, extra], { games: 3, tickets: 30 + Number(extra.tickets) });
    assert.notEqual(fabricated.state, 'confirmed');
    for (const r of [omitted, fabricated]) { assert.equal(r.state, 'contradicted'); assert.ok(r.issues.length > 0 && r.feedback.action.length > 0); assert.equal(r.usedLLM, false); }
    assert.equal((await f.verify(c.id, [a.id])).state, 'confirmed');
  } finally { await f.close(); }
});
