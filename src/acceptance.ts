import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { AgentRecord, Artifact, SessionRecord, Task } from './domain.js';
import { validateMemoryArtifact } from './demo.js';
import type { Repository } from './storage.js';

const ToolResult = z.object({ agentId: z.string(), name: z.string(), callId: z.string(), result: z.object({ ok: z.boolean(), data: z.unknown() }) });
const resourceId = (data: unknown): string | undefined => {
  const parsed = z.object({ id: z.string() }).safeParse(data);
  return parsed.success ? parsed.data.id : undefined;
};

// This checks committed evidence, never interprets model prose as successful work.
// It establishes protocol behavior, not the quality or origin of model inference.
export function verifyCollaboration(repo: Repository, sessionId: string, home: string) {
  const session = repo.get<SessionRecord>('session', sessionId);
  if (!session) throw new Error('Session not found');
  const agents = repo.list<AgentRecord>('agent', sessionId);
  const members = new Set(agents.map(a => a.id));
  const messages = repo.messages(sessionId, undefined, Number.MAX_SAFE_INTEGER);
  const deliveries = repo.deliveries(sessionId, ['pending', 'inflight', 'failed', 'acknowledged']);
  const acknowledged = (messageId: string, recipient: string) => deliveries.some(d => d.messageId === messageId && d.agentId === recipient && d.state === 'acknowledged');
  const peerMessages = messages.filter(m => members.has(m.sender) && m.recipients.some(r => members.has(r) && acknowledged(m.id, r)));
  const results = repo.events(sessionId).filter(e => e.type === 'tool_result').flatMap(e => {
    const parsed = ToolResult.safeParse(e.data);
    return parsed.success && parsed.data.result.ok && members.has(parsed.data.agentId) ? [parsed.data] : [];
  });
  const toolUsers = new Set(results.map(r => r.agentId));
  const reciprocal = peerMessages.some(request => peerMessages.some(reply =>
    reply.sequence > request.sequence && request.recipients.includes(reply.sender) && reply.recipients.includes(request.sender)
    && reply.threadId === request.threadId && acknowledged(reply.id, request.sender)));
  const tasks = repo.list<Task>('task', sessionId);
  const collaborativeTasks = tasks.filter(task => task.state === 'done' &&
    new Set(results.filter(r => r.name === 'roundtable_task_update' && resourceId(r.result.data) === task.id).map(r => r.agentId)).size >= 2);
  const artifacts = repo.list<Artifact>('artifact', sessionId);
  const validArtifacts = artifacts.flatMap(artifact => {
    try { return [{ artifactId: artifact.id, ...validateMemoryArtifact(artifact) }]; }
    catch { return []; }
  });
  const exchangedArtifact = validArtifacts.some(valid => {
    const artifact = artifacts.find(a => a.id === valid.artifactId)!;
    return peerMessages.some(m => m.sender === artifact.author && m.artifacts.includes(artifact.id) && collaborativeTasks.some(t => t.id === m.taskId)) &&
      results.some(r => r.agentId !== artifact.author && r.name === 'roundtable_artifact_read' && resourceId(r.result.data) === artifact.id);
  });
  const contexts = agents.map(agent => {
    try {
      const directory = join(home, 'sessions', sessionId, agent.id);
      const files = readdirSync(directory).filter(name => name.endsWith('.jsonl'));
      const latest = files.sort().at(-1);
      if (!latest) return { agentId: agent.id, persisted: false };
      const content = readFileSync(join(directory, latest), 'utf8');
      const entries = content.trim().split('\n').map(line => JSON.parse(line) as unknown);
      const header = z.object({ type: z.literal('session'), id: z.string().min(1) }).safeParse(entries[0]);
      const roles = entries.flatMap(entry => {
        const parsed = z.object({ type: z.literal('message'), message: z.object({ role: z.string() }) }).safeParse(entry);
        return parsed.success ? [parsed.data.message.role] : [];
      });
      return { agentId: agent.id, contextId: header.success ? header.data.id : undefined,
        persisted: header.success && roles.includes('user') && roles.includes('assistant'),
        sha256: createHash('sha256').update(content).digest('hex') };
    } catch { return { agentId: agent.id, persisted: false }; }
  });
  const checks = [
    { name: 'three_admitted_agents', passed: agents.length === 3 && agents.every(a => a.compatible && a.state !== 'removed') },
    { name: 'independent_persisted_contexts', passed: contexts.length === 3 && contexts.every(c => c.persisted) && new Set(contexts.map(c => c.contextId)).size === 3 },
    { name: 'human_started_collaboration', passed: messages.some(m => m.sender === 'human' && m.recipients.length > 0) },
    { name: 'reciprocal_acknowledged_peer_messages', passed: reciprocal },
    { name: 'every_agent_contributed', passed: agents.every(a => toolUsers.has(a.id) || peerMessages.some(m => m.sender === a.id)) },
    { name: 'multiple_successful_tool_users', passed: toolUsers.size >= 2 },
    { name: 'jointly_updated_completed_task', passed: collaborativeTasks.length > 0 },
    { name: 'separately_validated_artifact', passed: validArtifacts.length > 0 },
    { name: 'artifact_exchanged_and_read_by_peer', passed: exchangedArtifact },
    { name: 'no_unfinished_deliveries', passed: deliveries.every(d => d.state === 'acknowledged') },
  ];
  const snapshotHash = createHash('sha256').update(JSON.stringify({ agents, messages, tasks, artifacts, deliveries, contexts })).digest('hex');
  const previous = repo.events(sessionId).findLast(e => e.type === 'collaboration_acceptance');
  const previousHash = z.object({ snapshotHash: z.string() }).safeParse(previous?.data);
  return {
    sessionId, passed: checks.every(c => c.passed), checks, snapshotHash,
    matchesLastAcceptance: previousHash.success ? previousHash.data.snapshotHash === snapshotHash : null,
    agents: agents.map(a => ({ id: a.id, name: a.name, provider: a.provider, model: a.model })),
    distinctProviders: new Set(agents.map(a => a.provider)).size,
    successfulToolUsers: toolUsers.size, acknowledgedPeerMessages: peerMessages.length,
    collaborativeTaskIds: collaborativeTasks.map(t => t.id), validatedArtifacts: validArtifacts,
    inference: 'Offline evidence verifies collaboration behavior; it does not establish hosted inference or research quality.',
  };
}
