// Operator-configured staged acceptance, using three real hosted models.
// No model stream override, canned replies or host-authored artifact content.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Engine } from '../dist/engine.js';
import { Repository } from '../dist/storage.js';
import { ProviderRegistry } from '../dist/providers.js';
import { PiAdapter } from '../dist/pi-adapter.js';
import { verifyCollaboration } from '../dist/acceptance.js';
import { demoObjective, validateMemoryArtifact } from '../dist/demo.js';
import { redact } from '../dist/domain.js';

const home = resolve(process.env.ROUNDTABLE_HOME ?? '.roundtable');
mkdirSync(home, { recursive: true });
const authPath = join(home, 'auth.json');
const auth = existsSync(authPath) ? JSON.parse(readFileSync(authPath, 'utf8')) : {};
for (const [provider, credential] of Object.entries(auth)) if (credential.type === 'api_key') process.env[`ROUNDTABLE_RUN_SECRET_${provider.toUpperCase().replace(/\W/g, '_')}`] = credential.key;
const configs = JSON.parse(readFileSync(resolve(process.argv[2] ?? 'examples/live-api-agents.json'), 'utf8'));
const registry = await ProviderRegistry.create(home);
if (!registry.preflight(configs).ready) throw new Error('Live preflight failed');
const repo = new Repository(join(home, 'roundtable.db'));
const session = Engine.create(repo, join(home, 'workspaces'), demoObjective, { policy: 'structured', constraints: 'Human stages an initial peer comparison, then an independent synthesis; agents remain universally tool-capable.', limits: { requests: 40, toolCalls: 80, exchanges: 20, tokens: 400000, dollars: 0.5, timeoutMs: 300000, turnTimeoutMs: 90000 } });
const engine = new Engine(repo, session.id, PiAdapter.factory(registry));
const print = value => console.log(redact(typeof value === 'string' ? value : JSON.stringify(value)));
engine.on('activity', activity => {
  if (activity.type === 'stream') return;
  if (activity.type === 'message') print({ type: 'message', sender: activity.message.sender, recipients: activity.message.recipients, body: activity.message.body });
  else if (activity.type === 'tool_result') print({ type: 'tool_result', agentId: activity.agentId, name: activity.name, ok: activity.result.ok });
  else if (activity.type === 'error' || activity.type === 'system') print(activity);
});
const contract = 'Perform the requested step efficiently, at most six tool calls per incoming message. Use only collaboration, memory, artifact and JSON tools; web research, filesystem writes and execution are not configured. Never claim a prototype was run. Respond once to substantive peer questions with findings, append them to the referenced shared task, and send one task_response to the sender with that taskId; then stop. A receipt or acknowledgement alone needs no reply. If you receive an artifact, read it with roundtable_artifact_read. If you own its task, review peer findings and artifact, append your review and mark the task done, then stop. All collaborators may append task findings without claiming; only the owner changes state. Design artifacts must use EXACT JSON fields: title (string), selected (string naming a compared alternative), alternatives (at least three objects each with name, advantage, limitation strings), invariants (at least four strings), exampleEvents (at least two objects with sequence 1,2,..., agent string, text string). Use artifacts:[artifactId] and taskId as structured roundtable_send fields when sharing it, not just IDs in body text. Choose your own design conclusions; distinguish assumptions from execution evidence.';
try {
  print({ sessionId: session.id, mode: 'live hosted, human-staged collaboration', limits: session.limits });
  const participants = [];
  for (const config of configs) participants.push(await engine.addAgent({ ...config, instructions: contract }));
  const initiating = participants[1]; const peer = participants[0]; const synthesizing = participants[2];
  engine.send({ sessionId: session.id, sender: 'human', recipients: [initiating.id], type: 'human', body: `Begin our memory-design investigation: create and claim one shared task; append a brief initial tradeoff finding; send a concrete comparison question to ${peer.name} (${peer.id}) with taskId. Ask them to append independent findings and send you one response. Then stop this turn. Do not publish an artifact yet. This is a temporary session responsibility, not a permanent agent role.` });
  await engine.idle(180000);
  if (engine.session().state !== 'active') throw new Error('Initial comparison paused at a budget');
  const task = repo.list('task', session.id)[0]; if (!task) throw new Error('Agents did not create a task');
  engine.send({ sessionId: session.id, sender: 'human', recipients: [synthesizing.id], type: 'human', taskId: task.id, body: `Independently synthesize a compact verifiable memory-design artifact for shared task ${task.id}. Read its existing findings using roundtable_tasks_list, append your own tradeoff findings, publish JSON in the exact required shape, then send the artifact reference with artifacts:[artifactId] and taskId to task owner ${initiating.name} (${initiating.id}). Ask the owner to read, review and complete the task. Use about 1500 characters for the artifact. No execution or external research is available. Stop after sending; no acknowledgement loop.` });
  await engine.idle(180000);
  let report = verifyCollaboration(repo, session.id, home);
  const checkArtifacts = () => repo.list('artifact', session.id).map(artifact => { try { return { artifactId: artifact.id, ...validateMemoryArtifact(artifact) }; } catch (error) { return { artifactId: artifact.id, error: redact(String(error)).slice(0, 3000) }; } });
  let artifactChecks = checkArtifacts();
  const rejected = artifactChecks.find(check => check.error);
  if (!report.passed && !report.validatedArtifacts.length && rejected && engine.session().state === 'active' && engine.session().usage.requests + 8 <= engine.session().limits.requests) {
    engine.send({ sessionId: session.id, sender: 'human', recipients: [synthesizing.id], type: 'human', taskId: task.id, body: `Independent host validation rejected artifact ${rejected.artifactId}: ${rejected.error}. Read it, correct the reported JSON schema/cross-field error, and publish a new immutable version preserving your design conclusions. selected must exactly match a name in alternatives; add your chosen hybrid as another compared alternative if necessary. Send the corrected artifact to ${peer.name} (${peer.id}) with artifacts:[newArtifactId] and taskId:${task.id}. Ask the peer to read it and stop. If the task is already done, do not update its state or findings. One bounded repair only; no unrelated tools or acknowledgement loop.` });
    await engine.idle(180000); report = verifyCollaboration(repo, session.id, home); artifactChecks = checkArtifacts();
  }
  const evidence = { checkedAt: new Date().toISOString(), mode: 'live hosted with human-staged policy', ...report, usage: engine.session().usage, artifactChecks };
  writeFileSync(join(home, 'live-last-acceptance.json'), JSON.stringify(evidence, null, 2)); print(evidence);
  if (!report.passed) { process.exitCode = 1; }
  else { repo.event(session.id, 'independent_artifact_validation', report.validatedArtifacts); repo.event(session.id, 'collaboration_acceptance', report); }
} catch (error) { print({ sessionId: session.id, error: redact(String(error)), usage: engine.session().usage }); process.exitCode = 1; }
finally { await engine.close(); repo.close(); }
