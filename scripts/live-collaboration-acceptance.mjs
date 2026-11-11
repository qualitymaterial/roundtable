// Opt-in bounded inference using synthetic data and an isolated Roundtable runtime.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { completionReport } from '../dist/completion.js';
import { protectSecret, redact } from '../dist/domain.js';
import { Engine } from '../dist/engine.js';
import { compareSessions } from '../dist/evaluation.js';
import { PiAdapter } from '../dist/pi-adapter.js';
import { ProviderRegistry } from '../dist/providers.js';
import { requireValidation, validateContract } from '../dist/recovery.js';
import { Repository } from '../dist/storage.js';

const [flag, authDir, evidenceDir, localUrl, localModel, cloudProvider, cloudModel, ...extra] = process.argv.slice(2);
if (flag !== '--run-live' || !cloudModel || extra.length) {
  console.error('Usage: node scripts/live-collaboration-acceptance.mjs --run-live <Roundtable-auth-home> <NEW-evidence-folder> <loopback-OpenAI-base-url> <local-model> <cloud-provider> <cloud-model>');
  process.exit(2);
}
const localAddress = new URL(localUrl);
assert.ok(['127.0.0.1', '[::1]'].includes(localAddress.hostname), 'Use a literal loopback OpenAI-compatible endpoint');
const authHome = resolve(authDir);
assert.ok(existsSync(authHome), 'Use an existing Roundtable auth home');
const output = resolve(evidenceDir);
mkdirSync(output); // Never overwrite a previous attempt.
const runtime = join(output, 'runtime');
mkdirSync(runtime);
const localProvider = 'acceptance-local';
const objective = 'Deliver a verified receipt for 6 × 7.';
const artifactName = 'receipt.json';
const sessionPermissions = ['collaborate', 'artifact', 'workspace.write'];
const reviewerPermissions = ['collaborate', 'artifact'];
const limits = { requests: 24, toolCalls: 24, exchanges: 8, tokens: 150000, dollars: 0.15, timeoutMs: 330000, turnTimeoutMs: 150000, concurrency: 2 };
const report = { startedAt: new Date().toISOString(), localModel, cloudProvider, cloudModel, limits, passed: false, runs: {} };
const save = () => writeFileSync(join(output, 'report.json'), redact(JSON.stringify(report, null, 2)) + '\n');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function protectCredentials(value) {
  if (typeof value === 'string') protectSecret(value);
  else if (value && typeof value === 'object') Object.values(value).forEach(protectCredentials);
}

const repo = new Repository(join(runtime, 'roundtable.db'));
try {
  const local = await ProviderRegistry.create(runtime);
  local.addEndpoint({ provider: localProvider, baseUrl: localUrl, model: localModel, contextWindow: 16384, maxTokens: 2048 });
  let cloudRuntime;
  const factory = (actor, engine) => PiAdapter.create(actor.provider === localProvider ? local : cloudRuntime, actor, engine);
  for (const mode of ['solo', 'team']) {
    const result = report.runs[mode] = { passed: false, phase: 'admission' };
    const session = Engine.create(repo, join(runtime, 'workspaces'), objective, { permissions: sessionPermissions, limits });
    result.sessionId = session.id;
    const engine = new Engine(repo, session.id, factory);
    const events = () => repo.events(session.id);
    const tools = () => events().filter(e => e.type === 'tool_result').map(e => e.data);
    const artifacts = () => repo.list('artifact', session.id);
    try {
      save();
      let cloudCatalog;
      if (mode === 'team') {
        assert.notEqual(cloudProvider, localProvider, 'Choose a different provider for the hosted reviewer');
        const authFile = join(authHome, 'auth.json');
        if (existsSync(authFile)) protectCredentials(JSON.parse(readFileSync(authFile, 'utf8')));
        const cloud = await ProviderRegistry.create(authHome);
        cloudCatalog = cloud.model(cloudProvider, cloudModel);
        const address = new URL(cloudCatalog.baseUrl);
        assert.ok(address.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(address.hostname), 'Select a hosted HTTPS model for the reviewer');
        assert.ok(cloud.providers().some(p => p.id === cloudProvider && p.configured), 'Selected hosted provider has no configured authentication');
        cloudRuntime = { home: runtime, runtime: cloud.runtime, model: cloud.model.bind(cloud), validate: cloud.validate.bind(cloud) };
      }
      const task = { id: randomUUID(), sessionId: session.id, title: 'Deliver receipt', state: 'open', findings: '', dependencies: [] };
      repo.put('task', task);
      const contract = requireValidation(engine, { taskId: task.id, artifactName, description: 'Receipt total equals 42', validator: { kind: 'json', required: ['total'], equals: { total: 42 } } });
      const writer = await engine.addAgent({ name: 'Writer', provider: localProvider, model: localModel, permissions: sessionPermissions, maxOutputTokens: 2048,
        instructions: 'Follow only the synthetic receipt workflow. On a passing review message, call roundtable_task_update with the incoming taskId, state done and short findings, then stop. On a failed review, correct and resubmit. Never use shell, network, memory, other workspace files or unrelated tools.' });
      const reviewer = mode === 'team' ? await engine.addAgent({ name: 'Reviewer', provider: cloudProvider, model: cloudModel, permissions: reviewerPermissions,
        maxOutputTokens: Math.min(2048, cloudCatalog.maxTokens),
        instructions: 'On a peer task_request, call roundtable_artifact_read using incoming.artifacts[0]. Use roundtable_task_requirements with incoming.taskId, then roundtable_validation_run with that contract ID and the artifact ID. Send one task_response with expectsReply:true, taskId, correlationId set to incoming.id, artifacts containing the artifact ID, and recipients containing incoming.sender. Body is "Receipt passed." if data.passed is true, otherwise explain the failed check. Then stop. Do not edit files, claim tasks, produce artifacts or contact anyone else.' }) : undefined;
      if (reviewer) {
        assert.ok(!engine.tools.activeNames(reviewer).includes('workspace_write'));
        assert.equal(engine.authorized(reviewer, 'workspace.write'), false);
      }
      const human = body => engine.send({ sessionId: session.id, sender: 'human', recipients: [writer.id], type: 'human', taskId: task.id, body });
      result.phase = 'receipt-workflow'; save();
      human(`Claim incoming.taskId using roundtable_task_claim. Use workspace_write to create calculation.txt with exactly "6 × 7" and no newline. Calculate 6 × 7 and call roundtable_artifact_publish to publish receipt.json as compact JSON with one key total and the numeric answer. Check each tool result. ${reviewer ? `Use roundtable_send type task_request, taskId from incoming, recipients ["${reviewer.id}"], artifacts [the published artifact ID] and body "Check the attached receipt against the task contract." Send the reference only. Use roundtable_wait mode peers and stop.` : 'Use roundtable_wait mode human and stop so the human can check the receipt.'}`);
      await engine.idle(limits.timeoutMs + 10000);
      if (!reviewer) {
        const artifact = artifacts().at(-1);
        assert.ok(artifact, 'Solo writer did not publish a receipt');
        assert.ok((await validateContract(engine, contract.id, artifact.id, 'human')).passed, 'Solo receipt did not satisfy the contract');
        human('Receipt passed.');
        await engine.idle(limits.turnTimeoutMs + 10000);
      }
      result.phase = 'assertions';
      const completion = completionReport(engine);
      assert.equal(completion.state, 'idle', JSON.stringify({ state: completion.state, deliveries: completion.deliveries, failures: completion.failures }));
      assert.equal(completion.completedTasks[0]?.id, task.id, 'Task must close with current evidence');
      const artifact = artifacts().at(-1);
      assert.equal(artifact.author, writer.id);
      assert.equal(artifact.hash, sha(artifact.content));
      assert.deepEqual(JSON.parse(artifact.content), { total: 42 });
      assert.equal(readFileSync(join(session.workspace, 'calculation.txt'), 'utf8'), '6 × 7');
      assert.ok(tools().some(t => t.name === 'workspace_write' && t.agentId === writer.id && t.result.ok));
      const receipt = events().findLast(e => e.type === 'required_validation_result')?.data;
      assert.ok(receipt, 'The independent verification receipt is missing');
      assert.deepEqual([receipt.reviewer, receipt.artifactId, receipt.hash, receipt.passed], [reviewer?.id ?? 'human', artifact.id, artifact.hash, true]);
      if (reviewer) {
        const handoff = repo.messages(session.id).find(m => m.sender === writer.id && m.type === 'task_request' && m.artifacts.includes(artifact.id));
        assert.deepEqual(handoff?.recipients, [reviewer.id]);
        assert.equal(handoff?.body, 'Check the attached receipt against the task contract.');
        assert.equal(handoff?.taskId, task.id);
        assert.ok(repo.deliveries(session.id, ['acknowledged']).some(d => d.messageId === handoff.id && d.agentId === reviewer.id));
        assert.ok(tools().some(t => t.name === 'roundtable_artifact_read' && t.agentId === reviewer.id && t.result.ok && t.result.data.hash === artifact.hash));
        const response = repo.messages(session.id).find(m => m.sender === reviewer.id && m.type === 'task_response' && m.correlationId === handoff.id);
        assert.deepEqual(response?.recipients, [writer.id]);
        assert.deepEqual([response.taskId, response.artifacts, response.expectsReply], [task.id, [artifact.id], true]);
        assert.ok(repo.deliveries(session.id, ['acknowledged']).some(d => d.messageId === response.id && d.agentId === writer.id));
      }
      result.artifactHash = artifact.hash;
      result.passed = true;
      result.phase = 'complete';
    } catch (error) {
      result.error = redact(String(error));
    } finally {
      await engine.close();
      result.usage = engine.session().usage;
      result.events = events().filter(e => ['delivery_error', 'agent_failed', 'provider_retry', 'required_validation_result'].includes(e.type));
      result.tools = tools().map(({ agentId, name, result: receipt }) => ({ agentId, name, ok: receipt.ok, ...(receipt.ok ? {} : { error: receipt.data }) }));
      save();
    }
  }
  const { solo, team } = report.runs;
  if (repo.list('agent', solo.sessionId).length === 1 && repo.list('agent', team.sessionId).length === 2) {
    report.comparison = compareSessions(repo, { task: objective, solo: solo.sessionId, team: team.sessionId,
      humanNotes: 'One bounded synthetic task. The solo baseline uses the same deterministic check with the human as independent reviewer. The team delegates that check to a hosted agent.' });
  }
  report.passed = solo.passed && team.passed;
  if (report.passed) report.sameArtifactBytes = solo.artifactHash === team.artifactHash;
} catch (error) {
  report.error = redact(String(error));
} finally {
  report.finishedAt = new Date().toISOString();
  save();
  repo.close();
}
console.log(redact(JSON.stringify({ passed: report.passed, runs: Object.fromEntries(Object.entries(report.runs).map(([mode, { passed, phase, error, usage }]) => [mode, { passed, phase, error, usage }])), error: report.error }, null, 2)));
process.exitCode = report.passed ? 0 : 1;
