import { createHash } from 'node:crypto';
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type ToolCall, type JsonObject } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { id, type AgentRecord, type Artifact, type Message, type Task } from './domain.js';
import { Engine } from './engine.js';
import { Repository } from './storage.js';
import { PiAdapter, type ModelStream } from './pi-adapter.js';
import { ProviderRegistry } from './providers.js';

export const demoObjective = 'Investigate competing designs for a persistent multi-agent memory system, exchange findings, and produce a tested prototype or verifiable technical artifact.';
export const memoryDesign = {
  title: 'Persistent multi-agent memory design', selected: 'sqlite-events',
  alternatives: [
    { name: 'jsonl', advantage: 'Portable append-only log', limitation: 'Concurrent writes and indexed retrieval require additional machinery' },
    { name: 'sqlite-events', advantage: 'Atomic commits, ordered events, indexes and local recovery', limitation: 'Single writer; schema migrations must be managed' },
    { name: 'vector-store', advantage: 'Semantic retrieval', limitation: 'Embedding costs and nondeterministic retrieval; retain authoritative source records' },
  ],
  invariants: ['independent agent contexts', 'session scoped notes', 'ordered immutable events', 'recover committed state'],
  exampleEvents: [{ sequence: 1, agent: 'alpha', text: 'Prefer authoritative events' }, { sequence: 2, agent: 'beta', text: 'Use bounded retrieval' }],
};
export function validateMemoryArtifact(artifact: Artifact): { valid: true; sha256: string; alternatives: number } {
  if (createHash('sha256').update(artifact.content).digest('hex') !== artifact.hash) throw new Error('Artifact checksum mismatch');
  const schema = z.object({ title: z.string().min(1), selected: z.string().min(1), alternatives: z.array(z.object({ name: z.string(), advantage: z.string().min(5), limitation: z.string().min(5) })).min(3), invariants: z.array(z.string()).min(4), exampleEvents: z.array(z.object({ sequence: z.number().int(), agent: z.string(), text: z.string() })).min(2) });
  const value = schema.parse(JSON.parse(artifact.content));
  if (!value.alternatives.some(a => a.name === value.selected)) throw new Error('Selected design must name a compared alternative');
  if (value.exampleEvents.some((e, i) => e.sequence !== i + 1)) throw new Error('Example event order is invalid');
  return { valid: true, sha256: artifact.hash, alternatives: value.alternatives.length };
}

// Deterministic provider fixture. Each Pi session receives only its own context.
// Scripts generate model tool calls, never invoke handlers or fabricate peer dialogue.
export const mockStream: ModelStream = (model, context, options) => {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    const response: AssistantMessage = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() };
    if (options?.signal?.aborted) { response.stopReason = 'aborted'; stream.push({ type: 'error', reason: 'aborted', error: response }); return; }
    try {
      response.content = scriptedReply(model.id, context);
      response.stopReason = response.content.some(c => c.type === 'toolCall') ? 'toolUse' : 'stop';
      stream.push({ type: 'start', partial: response }); stream.push({ type: 'done', reason: response.stopReason, message: response });
    } catch (error) { response.errorMessage = String(error); response.stopReason = 'error'; stream.push({ type: 'error', reason: 'error', error: response }); }
  });
  return stream;
};
function scriptedReply(modelId: string, context: Context): AssistantMessage['content'] {
  const lastUser = context.messages.findLastIndex(m => m.role === 'user');
  const user = context.messages[lastUser];
  const body = user && user.role === 'user' ? (typeof user.content === 'string' ? user.content : user.content.filter(c => c.type === 'text').map(c => c.text).join('')) : '';
  const payload = JSON.parse(body) as { incoming: Message };
  const results = context.messages.slice(lastUser + 1).filter(m => m.role === 'toolResult').map(m => {
    const raw = m.content.filter(c => c.type === 'text').map(c => c.text).join(''); const parsed = JSON.parse(raw) as { ok: boolean; data: unknown };
    if (!parsed.ok) throw new Error(`Mock received real tool error: ${String(parsed.data)}`); return parsed.data;
  });
  const call = (name: string, args: JsonObject): ToolCall[] => [{ type: 'toolCall', id: id(), name, arguments: args }];
  const done = (text: string): AssistantMessage['content'] => [{ type: 'text', text }];
  if (modelId === 'alpha') {
    if (payload.incoming.body.startsWith('C_ARTIFACT:')) {
      const artifactId = payload.incoming.body.split(':')[1]!;
      const taskId = payload.incoming.taskId!;
      switch (results.length) {
        case 0: return call('roundtable_artifact_read', { artifactId });
        case 1: return call('data_json_validate', { content: (results[0] as Artifact).content });
        case 2: return call('roundtable_task_update', { taskId, findings: 'Validated the JSON design artifact against peer findings; ready for independent human validation.', state: 'done' });
        default: return done('The shared task is complete. SQLite events preserve authoritative state; semantic retrieval can remain a secondary index. The artifact is ready for separate validation.');
      }
    }
    if (payload.incoming.body.startsWith('B_FINDINGS:')) {
      return results.length === 0 ? call('roundtable_memory_write', { text: payload.incoming.body, kind: 'decision' }) : done('Received Beta’s comparison and recorded the evidence. Awaiting the independent artifact contribution.');
    }
    switch (results.length) {
      case 0: return call('roundtable_agents_list', {});
      case 1: return call('roundtable_task_create', { title: 'Compare persistent memory designs and produce a verifiable artifact' });
      case 2: return call('roundtable_task_claim', { taskId: (results[1] as Task).id });
      case 3: return call('roundtable_memory_write', { text: 'Authoritative append-only events plus session-scoped notes allow deterministic recovery.', kind: 'note' });
      case 4: return call('roundtable_send', { expectsReply: true, recipients: [(results[0] as AgentRecord[]).find(a => a.model === 'beta')!.id], body: 'Please compare JSONL, SQLite and vector memory; exchange evidence.', type: 'task_request', taskId: (results[1] as Task).id });
      default: return done('I created and claimed our shared task, recorded the event-store approach, and asked Beta for a comparison.');
    }
  }
  if (modelId === 'beta') {
    switch (results.length) {
      case 0: return call('roundtable_memory_write', { text: 'JSONL is portable but coordination is manual. SQLite supports atomic indexed writes. Vector retrieval is useful as a secondary index.', kind: 'note' });
      case 1: return call('roundtable_task_update', { taskId: payload.incoming.taskId!, findings: 'Compared JSONL, SQLite and vector retrieval. Prefer SQLite for authoritative local state.' });
      case 2: return call('roundtable_send', { expectsReply: true, recipients: [payload.incoming.sender], body: 'B_FINDINGS: SQLite transactions and bounded note retrieval offer reproducible local recovery; use vectors only as a secondary index.', type: 'task_response', taskId: payload.incoming.taskId! });
      default: return done('Compared three designs using the persistent notes tool and shared the findings with Alpha.');
    }
  }
  switch (results.length) {
    case 0: return call('roundtable_memory_search', { query: 'SQLite' });
    case 1: return call('roundtable_task_update', { taskId: payload.incoming.taskId!, findings: 'Independent contribution: include ordered event examples, explicit invariants, and limitations for every design.' });
    case 2: return call('roundtable_artifact_publish', { name: 'persistent-memory-design.json', content: JSON.stringify(memoryDesign, null, 2), provenance: 'Deterministic Gamma model fixture; synthesizes the independently persisted Beta findings and memory requirements. This is a test artifact, not live model research.' });
    case 3: return call('roundtable_send', { expectsReply: true, recipients: [payload.incoming.correlationId!], body: `C_ARTIFACT:${(results[2] as Artifact).id}`, type: 'artifact', artifacts: [(results[2] as Artifact).id], taskId: payload.incoming.taskId! });
    default: return done('Published a verifiable design artifact with competing designs, limitations and ordered event examples.');
  }
}
export async function registerMock(registry: ProviderRegistry): Promise<void> {
  registry.runtime.registerProvider('roundtable-mock', { baseUrl: 'http://127.0.0.1:1', api: 'openai-completions', models: ['alpha', 'beta', 'gamma'].map(model => ({ id: model, name: `Deterministic ${model}`, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4096 })) });
  await registry.runtime.setRuntimeApiKey('roundtable-mock', 'deterministic-fixture-not-a-credential');
}
export async function runDemo(repo: Repository, home: string, transcript?: (activity: unknown) => void): Promise<{ sessionId: string; validation: ReturnType<typeof validateMemoryArtifact> }> {
  const registry = await ProviderRegistry.create(home); await registerMock(registry);
  const session = Engine.create(repo, `${home}/workspaces`, demoObjective);
  const engine = new Engine(repo, session.id, PiAdapter.factory(registry, mockStream));
  if (transcript) engine.on('activity', transcript);
  try {
    const alpha = await engine.addAgent({ name: 'Alpha', provider: 'roundtable-mock', model: 'alpha' });
    await engine.addAgent({ name: 'Beta', provider: 'roundtable-mock', model: 'beta' });
    const gamma = await engine.addAgent({ name: 'Gamma', provider: 'roundtable-mock', model: 'gamma' });
    engine.send({ sender: 'human', sessionId: session.id, recipients: [alpha.id], type: 'human', body: demoObjective });
    await engine.idle();
    const task = repo.list<Task>('task', session.id)[0]; if (!task) throw new Error('Demo did not create a task');
    engine.send({ sender: 'human', sessionId: session.id, recipients: [gamma.id], type: 'human', body: 'Contribute an independent artifact using the shared findings.', taskId: task.id, correlationId: alpha.id });
    await engine.idle();
    const artifact = repo.list<Artifact>('artifact', session.id)[0]; if (!artifact) throw new Error('Demo did not publish an artifact');
    const validation = validateMemoryArtifact(artifact);
    if (repo.list<Task>('task', session.id)[0]?.state !== 'done') throw new Error('Shared task did not complete');
    if (repo.deliveries(session.id, ['failed', 'pending', 'inflight']).length) throw new Error('Demo has undelivered messages');
    repo.event(session.id, 'independent_artifact_validation', validation);
    return { sessionId: session.id, validation };
  } finally { await engine.close(); }
}
