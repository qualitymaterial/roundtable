import type { Engine } from './engine.js';
import type { Task, Artifact } from './domain.js';
import { completionReport } from './completion.js';
import { usageReport } from './usage.js';

const name = (engine: Engine, id?: string) => engine.agents().find(a => a.id === id)?.name ?? id ?? 'unassigned';
export function tasksView(engine: Engine): string[] {
  return engine.repo.list<Task>('task', engine.sessionId).flatMap(t => [
    `${t.state.toUpperCase()}  ${t.title}`, `Owner: ${name(engine, t.owner)}  |  ${t.id}`,
    ...(t.dependencies.length ? [`Depends on: ${t.dependencies.map(id => engine.repo.get<Task>('task', id)?.title ?? id).join(', ')}`] : []),
    ...(t.findings ? [t.findings.trim()] : []), '',
  ]);
}
export function artifactsView(engine: Engine): string[] {
  return engine.repo.list<Artifact>('artifact', engine.sessionId).flatMap(a => [`${a.name}  /  ${name(engine, a.author)}`, `${a.createdAt}  |  ${a.id}`, `SHA-256: ${a.hash}`, `Source: ${a.provenance}`, '']);
}
export function summaryView(engine: Engine): string[] {
  const r = completionReport(engine);
  return [r.objective, `${r.state.toUpperCase()}  /  ${r.acceptance}`, `${r.completedTasks.length} tasks done · ${r.outstandingTasks.length} open · ${r.artifacts.length} artifacts`,
    `${r.approvals.length} approvals · ${r.deliveries.length} deliveries · ${r.failures.length} unresolved failures`,
    ...r.failures.flatMap(f => [`${f.id}`, f.detail.slice(0, 700)]),
    ...r.outstandingTasks.map(t => `${t.title} — ${name(engine, t.owner)}`),
    ...r.artifacts.map(a => `${a.name} — ${a.hash.slice(0, 12)}`),
    ...(r.stage?.current ? [`Stage: ${r.stage.current.name} · ${r.stage.waiting.length} participants not ready · /next-stage to approve`] : []),
    ...(r.failures.length ? ['/resolve-failure <id> <reason> records a repair or an explicit waiver.'] : []), r.note];
}
export function usageView(engine: Engine): string[] {
  return usageReport(engine).flatMap(a => [`${a.agent}  /  ${a.provider}/${a.model}`, `${a.requests} requests · ${a.tokens.toLocaleString()} tokens · $${a.estimatedDollars.toFixed(4)} estimated`,
    `Input ${a.inputTokens} · Output ${a.outputTokens} · Cache read ${a.cacheReadTokens} · Cache write ${a.cacheWriteTokens}`, `Accounting: ${a.sources.join('; ') || 'no provider usage reported'}`, '']);
}
export function transcriptView(engine: Engine, query = ''): string[] {
  return engine.repo.messages(engine.sessionId, undefined, 500).filter(m => `${name(engine, m.sender)} ${m.threadId} ${m.body}`.toLowerCase().includes(query.toLowerCase())).slice(-50)
    .flatMap(m => [`${m.timestamp}  ${name(engine, m.sender)} → ${m.recipients.map(id => name(engine, id)).join(', ') || 'human transcript'}  [${m.threadId}]`, m.body, '']);
}
export function activityView(engine: Engine, query = ''): string[] {
  return engine.repo.events(engine.sessionId).filter(e => `${e.type} ${JSON.stringify(e.data)}`.toLowerCase().includes(query.toLowerCase())).slice(-40).flatMap(e => {
    const d = e.data as Record<string, unknown>;
    return [`${e.timestamp}  ${e.type}  ${name(engine, typeof d.agentId === 'string' ? d.agentId : undefined)}`,
      ...Object.entries(d).filter(([key]) => key !== 'agentId').map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value).slice(0, 1000) : String(value)}`), ''];
  });
}
