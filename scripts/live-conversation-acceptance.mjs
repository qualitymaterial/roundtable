// Opt-in hosted acceptance. Uses Roundtable's own configured auth; never copies credentials.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Engine } from '../dist/engine.js';
import { Repository } from '../dist/storage.js';
import { ProviderRegistry } from '../dist/providers.js';
import { PiAdapter } from '../dist/pi-adapter.js';
import { protectSecret, redact } from '../dist/domain.js';

const args = process.argv.slice(2);
if (args.length !== 3 || !['--run-live', '--team-greeting-only'].includes(args[0])) {
  console.error('Usage: node scripts/live-conversation-acceptance.mjs <--run-live|--team-greeting-only> <Roundtable auth home> <new evidence folder>\nMakes metered admission/task calls. Leaves existing sessions and permissions untouched.');
  process.exit(2);
}
const authHome = resolve(args[1]);
const output = resolve(args[2]);
mkdirSync(output, { recursive: false }); // Refuse accidental reuse/overwriting of evidence.
const runtimeHome = join(output, 'runtime');
mkdirSync(runtimeHome);
const configs = JSON.parse(readFileSync(join(authHome, 'agents.json'), 'utf8'));
assert.ok(Array.isArray(configs) && configs.length > 0, 'A nonempty saved lineup is required');
const protect = value => {
  if (typeof value === 'string') protectSecret(value);
  else if (value && typeof value === 'object') Object.values(value).forEach(protect);
};
protect(JSON.parse(readFileSync(join(authHome, 'auth.json'), 'utf8')));
const registry = await ProviderRegistry.create(authHome);
// Share the supported Roundtable account runtime, but persist every Pi context in the test home.
const scoped = { home: runtimeHome, runtime: registry.runtime,
  model: registry.model.bind(registry), validate: registry.validate.bind(registry) };
const repo = new Repository(join(runtimeHome, 'roundtable.db'));
const report = { startedAt: new Date().toISOString(), mode: 'real configured providers; no mock stream',
  acceptance: args[0] === '--team-greeting-only' ? ['zero greeting effects with all configured providers connected'] :
    ['zero greeting effects after admission', 'agent-produced artifact independently checked',
      'durable wait and explicit human wake', 'active cancellation with no continuing work'],
  estimatedSpendLimitPerSession: 0.5, cases: [] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const save = () => writeFileSync(join(output, 'report.json'), redact(JSON.stringify(report, null, 2)));
const human = (engine, recipients, body) => engine.send({ sessionId: engine.sessionId, sender: 'human', recipients, type: 'human', body });
const snapshot = engine => ({ usage: engine.session().usage, tasks: repo.list('task', engine.sessionId).length,
  artifacts: repo.list('artifact', engine.sessionId).length, events: repo.events(engine.sessionId).length });
const quiet = async (engine, ms = 1500) => {
  const before = snapshot(engine); await sleep(ms); assert.deepEqual(snapshot(engine), before); return before;
};
const until = async (predicate, ms = 30000) => {
  const start = Date.now(); while (!predicate()) { if (Date.now() - start > ms) throw new Error('Acceptance condition timed out'); await sleep(20); }
};
let engine;
try {
  if (args[0] === '--team-greeting-only') {
    const result = { name: 'team', checks: {}, members: [] }; report.cases.push(result);
    const session = Engine.create(repo, join(runtimeHome, 'workspaces'), 'Await a concrete human request.', {
      permissions: ['collaborate', 'artifact'], limits: { requests: 12, toolCalls: 12, dollars: 0.5, tokens: 50000 } });
    engine = new Engine(repo, session.id, PiAdapter.factory(scoped)); result.sessionId = session.id;
    try {
      for (const config of configs) {
        console.log(JSON.stringify({ stage: 'team-admission', name: config.name }));
        const actor = await engine.addAgent({ name: config.name, provider: config.provider, model: config.model, permissions: ['collaborate', 'artifact'], maxOutputTokens: 2048 });
        result.members.push({ id: actor.id, name: actor.name, provider: actor.provider, model: actor.model, compatible: actor.compatible });
      }
      const before = snapshot(engine); const count = repo.messages(session.id).length;
      const greeting = human(engine, ['*'], 'hello'); await engine.idle();
      assert.deepEqual(engine.session().usage, before.usage);
      assert.equal(repo.messages(session.id).length, count + 2);
      assert.equal(repo.messages(session.id).at(-1).body, 'Hello! What would you like to work on?');
      assert.equal(repo.deliveries(session.id, ['acknowledged']).filter(d => d.messageId === greeting.id).length, configs.length);
      assert.equal(repo.list('task', session.id).length, 0); assert.equal(repo.list('artifact', session.id).length, 0);
      await quiet(engine, 3000); result.checks.greeting = { passed: true, modelRequests: 0, tools: 0, tasks: 0, artifacts: 0, replies: 1 };
      await engine.pause(); human(engine, ['*'], 'thanks'); await engine.idle();
      assert.deepEqual(engine.session().usage, before.usage); assert.equal(engine.session().state, 'paused');
      result.checks.pausedCourtesy = { passed: true }; result.passed = true;
    } catch (error) { result.passed = false; result.error = redact(String(error)); }
    finally {
      result.usage = engine.session().usage; await engine.close();
      writeFileSync(join(output, 'team-session.json'), redact(JSON.stringify(engine.export(), null, 2)));
      engine = undefined; save();
    }
  } else for (const config of configs) {
    const fileLabel = `${report.cases.length + 1}-${config.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const result = { name: config.name, provider: config.provider, model: config.model, checks: {} };
    report.cases.push(result); save();
    const session = Engine.create(repo, join(runtimeHome, 'workspaces'), 'Perform only the specific acceptance task requested by the human.', {
      permissions: ['collaborate', 'artifact'], constraints: 'No host, shell, network research, memory, or external integrations. No unsolicited peer work.',
      limits: { requests: 24, toolCalls: 24, exchanges: 8, tokens: 120000, dollars: 0.5, timeoutMs: 240000, turnTimeoutMs: 90000, concurrency: 1 } });
    result.sessionId = session.id;
    engine = new Engine(repo, session.id, PiAdapter.factory(scoped));
    const events = [];
    engine.on('activity', event => { if (event.type !== 'stream') events.push(event); });
    const started = Date.now();
    try {
      console.log(JSON.stringify({ stage: 'admission', name: config.name, provider: config.provider, model: config.model }));
      const actor = await engine.addAgent({ name: config.name, provider: config.provider, model: config.model,
        permissions: ['collaborate', 'artifact'], maxOutputTokens: 2048,
        instructions: 'Work only on the current human acceptance request. Check tool results. Follow the requested tool sequence, then stop. Never invent extra tasks or messages.' });
      result.checks.admission = { passed: actor.compatible, usage: engine.session().usage };
      const before = snapshot(engine); const count = repo.messages(session.id).length;
      human(engine, [actor.id], 'hello'); await engine.idle();
      assert.deepEqual(engine.session().usage, before.usage);
      assert.equal(repo.list('task', session.id).length, 0); assert.equal(repo.list('artifact', session.id).length, 0);
      assert.equal(repo.messages(session.id).length, count + 2);
      assert.equal(repo.messages(session.id).at(-1).body, 'Hello! What would you like to work on?');
      await quiet(engine); result.checks.greeting = { passed: true, modelRequests: 0, tools: 0, tasks: 0, artifacts: 0 };
      save(); console.log(JSON.stringify({ stage: 'task', name: config.name }));
      const nonce = randomUUID();
      human(engine, [actor.id], `Create and claim one shared task titled "Acceptance arithmetic" using roundtable_task_create then roundtable_task_claim. Compute the squares of 2, 5, 9. Publish an immutable text artifact named arithmetic.json using roundtable_artifact_publish. Its JSON must have exactly {"nonce":"${nonce}","inputs":[2,5,9],"squares":[4,25,81],"sum":110}; calculate the values yourself. Mark your claimed task done using roundtable_task_update and include the artifact ID in findings. Call roundtable_wait, then finish with one short summary. Do not contact peers or do any other work.`);
      await engine.idle(120000);
      const task = repo.list('task', session.id); const artifacts = repo.list('artifact', session.id);
      assert.equal(task.length, 1); assert.equal(task[0].state, 'done'); assert.equal(task[0].owner, actor.id);
      assert.equal(artifacts.length, 1); const artifact = artifacts[0]; assert.equal(artifact.author, actor.id);
      assert.equal(artifact.hash, createHash('sha256').update(artifact.content).digest('hex'));
      assert.deepEqual(JSON.parse(artifact.content), { nonce, inputs: [2, 5, 9], squares: [4, 25, 81], sum: 110 });
      assert.ok(task[0].findings.includes(artifact.id));
      assert.equal(engine.waiting(actor.id), true);
      assert.equal(repo.deliveries(session.id, ['failed']).length, 0);
      result.checks.task = { passed: true, taskId: task[0].id, artifactId: artifact.id, hash: artifact.hash };
      writeFileSync(join(output, `${fileLabel}-arithmetic.json`), artifact.content);
      const waitBefore = snapshot(engine); human(engine, [actor.id], 'thanks'); await engine.idle();
      assert.deepEqual(engine.session().usage, waitBefore.usage); assert.equal(engine.waiting(actor.id), true);
      await quiet(engine);
      // Close and restore paused first: persistence can be checked without new admission calls.
      await engine.pause('Acceptance restart'); await engine.idle(); await engine.close();
      engine = new Engine(repo, session.id, PiAdapter.factory(scoped));
      engine.on('activity', event => { if (event.type !== 'stream') events.push(event); });
      assert.equal(engine.waiting(actor.id), true);
      engine.resume(); await engine.connect(); await engine.idle(); assert.equal(engine.waiting(actor.id), true);
      await quiet(engine);
      result.checks.wait = { passed: true, survivedRestart: true, courtesyDidNotWake: true };
      human(engine, [actor.id], 'Human wake acceptance: reply with exactly WAKE_OK, make no other tool calls, then call roundtable_wait and end.');
      await engine.idle(120000); assert.equal(engine.waiting(actor.id), true);
      assert.ok(repo.messages(session.id).some(m => m.sender === actor.id && m.body.includes('WAKE_OK')));
      await quiet(engine); result.checks.humanWake = { passed: true };
      save(); console.log(JSON.stringify({ stage: 'cancellation', name: config.name }));
      const initial = engine.session().usage.requests;
      human(engine, [actor.id], 'Cancellation test: write a very long explanation of the integers 1 through 1000, without using tools or creating tasks or artifacts.');
      await until(() => engine.session().usage.requests > initial);
      assert.ok(engine.status().running > 0, 'Cancel must interrupt actual running work');
      const cancelStart = Date.now(); await engine.pause('Human cancellation acceptance'); await engine.idle();
      assert.equal(engine.status().running, 0); assert.equal(engine.session().state, 'paused');
      const cancelled = await quiet(engine, 2000); human(engine, [actor.id], 'hello'); await engine.idle();
      assert.deepEqual(engine.session().usage, cancelled.usage); assert.equal(engine.session().state, 'paused');
      assert.equal(repo.list('task', session.id).length, 1); assert.equal(repo.list('artifact', session.id).length, 1);
      result.checks.cancellation = { passed: true, latencyMs: Date.now() - cancelStart - 2000, running: 0, courtesyDidNotResume: true };
      result.passed = true;
    } catch (error) { result.passed = false; result.error = redact(String(error)); console.log(JSON.stringify({ stage: 'failed', name: config.name, error: result.error })); }
    finally {
      result.durationMs = Date.now() - started; result.usage = engine.session().usage;
      result.state = engine.session().state;
      await engine.close();
      writeFileSync(join(output, `${fileLabel}-session.json`), redact(JSON.stringify(engine.export(), null, 2)));
      writeFileSync(join(output, `${fileLabel}-activity.json`), redact(JSON.stringify(events, null, 2)));
      engine = undefined; save();
    }
  }
} finally {
  await engine?.close(); repo.close(); report.finishedAt = new Date().toISOString();
  report.passed = report.cases.length === (args[0] === '--team-greeting-only' ? 1 : configs.length) && report.cases.every(c => c.passed);
  save();
}
console.log(JSON.stringify({ passed: report.passed, report: join(output, 'report.json') }));
process.exitCode = report.passed ? 0 : 1;
