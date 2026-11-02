// Explicit opt-in real inference and public HTTP. Never copies account credentials.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Engine } from '../dist/engine.js';
import { Repository } from '../dist/storage.js';
import { ProviderRegistry } from '../dist/providers.js';
import { PiAdapter } from '../dist/pi-adapter.js';
import { protectSecret, redact } from '../dist/domain.js';
import { saveResearch } from '../dist/research.js';
import { sourceHash, WebConfig } from '../dist/web-types.js';

const args = process.argv.slice(2);
if (args.length < 3 || args.length > 5 || args[0] !== '--run-live') {
  console.error('Usage: node scripts/live-web-handoff-acceptance.mjs --run-live <Roundtable-auth-home> <NEW-evidence-folder> [reader-index=0] [reviewer-index=1]\nMakes metered admission/task calls. Uses two saved models, a public page, and an isolated runtime. No search provider required.');
  process.exit(2);
}
const authHome = resolve(args[1]);
const output = resolve(args[2]);
const indices = [Number(args[3] ?? 0), Number(args[4] ?? 1)];
assert.ok(indices.every(n => Number.isSafeInteger(n) && n >= 0) && indices[0] !== indices[1], 'Choose two distinct saved lineup indices');
mkdirSync(output, { recursive: false }); // Preserve every failed attempt; never overwrite evidence.
const runtimeHome = join(output, 'runtime');
mkdirSync(runtimeHome);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const protectedFiles = ['agents.json', 'live-agents.json', 'endpoints.json', 'research.json', 'preferences.json', 'settings.json'];
const configurationHashes = () => Object.fromEntries(protectedFiles.map(name => [name, existsSync(join(authHome, name)) ? sha(readFileSync(join(authHome, name))) : null]));
const originalConfiguration = configurationHashes();
const protect = value => {
  if (typeof value === 'string') protectSecret(value);
  else if (value && typeof value === 'object') Object.values(value).forEach(protect);
};
const report = {
  startedAt: new Date().toISOString(), passed: false, mode: 'real configured inference plus real public HTTP; no model/HTTP mocks',
  url: 'https://example.com/', nonce: randomUUID(), checks: {},
  limits: { requests: 20, toolCalls: 24, tokens: 160000, dollars: 0.5, exchanges: 8, timeoutMs: 180000, turnTimeoutMs: 90000, concurrency: 2 },
  scope: 'Small public-page quotation and source-handle handoff, not factual truth, live search, local inference, or browser automation',
  costScope: 'SDK price estimate; threshold prevents subsequent requests after recorded usage, not a billing guarantee',
  freshnessPolicy: 'This stable documentation-page trial permits up to five minutes for current/unknown source observations',
};
const save = () => writeFileSync(join(output, 'report.json'), redact(JSON.stringify(report, null, 2)) + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const human = (engine, recipients, body) => engine.send({ sessionId: engine.sessionId, sender: 'human', recipients, type: 'human', body });
let engine;
let repo;
let watchdog;
let phase = 'setup';
try {
  protect(JSON.parse(readFileSync(join(authHome, 'auth.json'), 'utf8')));
  const lineup = JSON.parse(readFileSync(join(authHome, 'agents.json'), 'utf8'));
  const selected = indices.map(index => {
    const config = lineup[index];
    assert.ok(config && typeof config.provider === 'string' && typeof config.model === 'string', 'Saved lineup index is unavailable');
    return { name: config.name, provider: config.provider, model: config.model };
  });
  report.models = selected;
  const registry = await ProviderRegistry.create(authHome);
  for (const config of selected) {
    registry.model(config.provider, config.model);
    assert.ok(registry.providers().some(p => p.id === config.provider && p.configured), `No Roundtable-owned auth configured for ${config.provider}`);
  }
  const scoped = { home: runtimeHome, runtime: registry.runtime, model: registry.model.bind(registry), validate: registry.validate.bind(registry) };
  saveResearch(runtimeHome, { web: WebConfig.parse({ enabled: true, allowPublicRead: true, maxReads: 3, maxSearches: 1, maxAttempts: 12, orchestration: { currentSeconds: 300, unknownSeconds: 300 } }) });
  repo = new Repository(join(runtimeHome, 'roundtable.db'));
  const session = Engine.create(repo, join(runtimeHome, 'workspaces'), 'Read one public page and independently check its quoted evidence through a peer handoff.', {
    permissions: ['collaborate', 'artifact', 'network.research'], limits: report.limits,
    constraints: 'Only https://example.com/. No search, host access, shell, MCP, private data, unsolicited tasks or peer chatter. Stop on missing evidence.',
  });
  engine = new Engine(repo, session.id, PiAdapter.factory(scoped));
  report.sessionId = session.id;
  const taskResults = () => repo.events(session.id).filter(e => e.type === 'tool_result').map(e => ({ ...e.data, eventId: e.id }));
  const snapshot = () => ({ usage: engine.session().usage, messages: repo.messages(session.id).length,
    events: repo.events(session.id).length, pending: repo.deliveries(session.id, ['pending', 'inflight']).length });
  const quiet = async () => { const before = snapshot(); await sleep(2000); assert.deepEqual(snapshot(), before, 'Completion generated additional work'); return before; };
  watchdog = setTimeout(() => { report.watchdogExpired = true; void engine.pause('Acceptance wall-clock deadline'); }, 250000);
  watchdog.unref();
  engine.on('activity', event => {
    if (event.type === 'tool' || event.type === 'error') console.log(redact(JSON.stringify({ phase, type: event.type, name: event.name, error: event.error })));
  });
  phase = 'reviewer-admission'; save(); console.log(JSON.stringify({ phase, ...selected[1] }));
  const reviewer = await engine.addAgent({ ...selected[1], permissions: ['collaborate', 'artifact', 'network.research'], maxOutputTokens: 2048,
    instructions: `This is a bounded public-page acceptance. Your only task begins when a peer sends EVIDENCE_HANDOFF nonce=${report.nonce} sourceId=<UUID>. Call web.cache get for that sourceId (length 1200). From the returned page, choose a verbatim sentence describing its purpose, at least 20 characters. Call web.verify with claim {kind:"quote",text:<exact sentence>} and sourceIds:[sourceId]. If the quote is supporting, publish exactly one artifact named reviewed-page.json. Its JSON keys must be nonce,sourceId,hash,url,title,quote; copy metadata from your own cache result and use the nonce from the message. Do not fetch URLs, search, message peers, create tasks or use memory. After publication call roundtable_wait with mode:"human", then end. If evidence fails, report the error and wait; never invent a result.` });
  phase = 'reader-admission'; save(); console.log(JSON.stringify({ phase, ...selected[0] }));
  const reader = await engine.addAgent({ ...selected[0], permissions: ['collaborate', 'network.research'], maxOutputTokens: 2048,
    instructions: 'Follow the human bounded public-page request. Read the specified URL with web.read. Share only the source handle in the exact requested message, then roundtable_wait mode:"human". Never invent a handle or send page content, extra questions, acknowledgments or tasks.' });
  report.checks.admission = { passed: reader.compatible && reviewer.compatible, readerId: reader.id, reviewerId: reviewer.id };
  // Exercise revocation before the task, when no durable wait masks the permission check.
  const restricted = { ...reader, permissions: ['collaborate'] };
  repo.put('agent', restricted);
  assert.ok(!engine.tools.activeNames(restricted).some(name => name.startsWith('web__') || name.startsWith('web.')));
  const denied = await engine.tools.execute(restricted, 'web.cache', { action: 'get', sourceId: randomUUID() }, randomUUID());
  assert.equal(denied.ok, false); assert.equal(denied.data.code, 'permission_denied');
  report.checks.revokedPermission = { passed: true, scope: 'Revoked reader is denied before any source lookup', result: denied };
  repo.put('agent', reader);
  phase = 'live-page-and-handoff'; save(); console.log(JSON.stringify({ phase }));
  human(engine, [reader.id], `Read ${report.url} using web.read with fresh:true. Take the source ID from the successful tool result. Call roundtable_send with recipients:["${reviewer.id}"], expectsReply:true, and body exactly "EVIDENCE_HANDOFF nonce=${report.nonce} sourceId=<the returned source UUID>". Send only this handle, not page content or metadata. Then call roundtable_wait mode:"human" and end. If web.read fails, stop and state that failure; do not use model memory as evidence.`);
  await engine.idle(190000);
  const results = taskResults();
  const read = results.find(r => r.agentId === reader.id && r.name === 'web.read' && r.result.ok);
  assert.ok(read, 'Reader did not complete a real web.read');
  const pageHandle = read.result.data.sources[0];
  const source = repo.get('web_source', pageHandle.id);
  assert.ok(source && source.kind === 'page' && source.untrusted === true);
  assert.equal(source.hash, sourceHash(source), 'Retained source integrity failed');
  assert.equal(new URL(source.canonicalUrl).origin, new URL(report.url).origin);
  assert.ok(Number.isFinite(Date.parse(source.retrievedAt)) && Date.parse(source.retrievedAt) >= Date.parse(report.startedAt));
  assert.match(source.title, /^Example Domain$/);
  const expectedBody = `EVIDENCE_HANDOFF nonce=${report.nonce} sourceId=${source.id}`;
  const handoff = repo.messages(session.id).find(m => m.sender === reader.id && m.body === expectedBody && m.recipients.includes(reviewer.id));
  assert.ok(handoff, 'Reader did not perform the exact handle-only peer handoff');
  const cached = results.find(r => r.agentId === reviewer.id && r.name === 'web.cache' && r.result.ok && r.result.data.source?.hash === source.hash);
  assert.ok(cached, 'Reviewer did not retrieve the same evidence in its own context');
  const artifacts = repo.list('artifact', session.id);
  assert.equal(artifacts.length, 1, 'Reviewer must publish exactly one result');
  const artifact = artifacts[0];
  assert.equal(artifact.author, reviewer.id); assert.equal(artifact.name, 'reviewed-page.json');
  assert.equal(artifact.hash, sha(artifact.content));
  const answer = JSON.parse(artifact.content);
  assert.deepEqual(Object.keys(answer).sort(), ['nonce', 'sourceId', 'hash', 'url', 'title', 'quote'].sort());
  assert.equal(answer.nonce, report.nonce); assert.equal(answer.sourceId, source.id); assert.equal(answer.hash, source.hash);
  assert.equal(answer.url, source.canonicalUrl); assert.equal(answer.title, source.title);
  assert.equal(typeof answer.quote, 'string'); assert.ok(answer.quote.length >= 20 && source.text.includes(answer.quote));
  assert.match(answer.quote, /documentation|examples/i, 'Quotation does not describe the page purpose');
  const verified = results.find(r => r.agentId === reviewer.id && r.name === 'web.verify' && r.result.ok && r.result.data.claim?.text === answer.quote && r.result.data.evidence?.some(e => e.sourceId === source.id && e.hash === source.hash && e.status === 'supporting'));
  assert.ok(verified, 'Reviewer did not obtain a supporting literal quotation check');
  assert.ok(results.indexOf(read) < results.indexOf(cached) && results.indexOf(cached) < results.indexOf(verified));
  assert.equal(repo.deliveries(session.id, ['failed']).length, 0);
  assert.equal(engine.session().state, 'active', 'Acceptance ended through a budget or runtime pause');
  assert.ok(engine.waiting(reader.id) && engine.waiting(reviewer.id), 'Both agents must finish in durable human wait');
  report.checks.evidenceHandoff = { passed: true, sourceId: source.id, hash: source.hash, retrievedAt: source.retrievedAt, messageId: handoff.id, artifactId: artifact.id, answer };
  writeFileSync(join(output, 'reviewed-page.json'), artifact.content);
  writeFileSync(join(output, 'source.json'), JSON.stringify(source, null, 2));

  phase = 'session-isolation'; save();
  const foreignSession = Engine.create(repo, join(runtimeHome, 'workspaces'), 'Foreign source-handle control', { permissions: ['collaborate', 'network.research'] });
  const foreign = new Engine(repo, foreignSession.id, PiAdapter.factory(scoped));
  try {
    const foreignResult = await foreign.web.execute('cache', { action: 'get', sourceId: source.id }, { agentId: 'control', signal: new AbortController().signal, authorize: () => {} });
    assert.fail(`Another session redeemed a foreign handle: ${JSON.stringify(foreignResult).slice(0, 100)}`);
  } catch (error) {
    assert.equal(error?.code, 'source_unavailable', 'Foreign source was rejected for a reason other than source/session isolation');
    report.checks.sessionIsolation = { passed: true, error: redact(String(error)), scope: 'Direct service-layer source isolation control' };
  } finally { await foreign.close(); }

  phase = 'quiet-and-persistence'; save();
  report.checks.quietCompletion = { passed: true, snapshot: await quiet(), observationMs: 2000 };
  await engine.pause('Acceptance persistence check'); await engine.idle(); await engine.close();
  engine = new Engine(repo, session.id, PiAdapter.factory(scoped)); // Paused inspection makes no new model calls.
  assert.equal(engine.session().state, 'paused'); assert.ok(engine.waiting(reviewer.id));
  assert.equal(repo.get('artifact', artifact.id).hash, artifact.hash);
  const paused = snapshot(); human(engine, ['*'], 'thanks'); await engine.idle();
  assert.deepEqual(engine.session().usage, paused.usage); assert.equal(engine.session().state, 'paused');
  report.checks.pausedRecovery = { passed: true, artifactHash: artifact.hash, noNewInference: true };
  assert.deepEqual(configurationHashes(), originalConfiguration, 'Existing lineup/settings were changed');
  report.checks.configurationPreserved = { passed: true, files: protectedFiles };
  assert.equal(report.watchdogExpired, undefined);
  report.passed = true;
} catch (error) {
  report.failedPhase = phase; report.error = redact(String(error));
  console.error(JSON.stringify({ passed: false, phase, error: report.error }));
} finally {
  clearTimeout(watchdog);
  if (engine) {
    if (!report.passed) await engine.pause('Acceptance failed; preserve original evidence').catch(() => {});
    await engine.close(); report.usage = engine.session().usage;
    writeFileSync(join(output, 'session.json'), redact(JSON.stringify(engine.export(), null, 2)));
  }
  repo?.close(); report.finishedAt = new Date().toISOString(); save();
}
console.log(JSON.stringify({ passed: report.passed, report: join(output, 'report.json'), usage: report.usage }));
process.exitCode = report.passed ? 0 : 1;
