import { stageStatus } from './policy.js';
import type { Engine } from './engine.js';
import type { Task, Artifact, Approval } from './domain.js';

export function completionReport(engine: Engine) {
  const { repo, sessionId } = engine;
  const session = engine.session(); const running = (engine.status() as { running: number }).running;
  const tasks = repo.list<Task>('task', sessionId);
  const deliveries = repo.deliveries(sessionId, ['pending', 'inflight', 'failed']);
  const approvals = repo.list<Approval>('approval', sessionId).filter(a => a.state === 'pending');
  const artifacts = repo.list<Artifact>('artifact', sessionId).map(({ id, name, hash, author }) => ({ id, name, hash, author }));
  const events = repo.events(sessionId);
  const checks = events.filter(e => ['independent_artifact_validation', 'collaboration_acceptance'].includes(String(e.type))).map(e => ({ type: e.type, timestamp: e.timestamp, data: e.data }));
  const waived = new Set(events.filter(e => e.type === 'human_failure_resolution').map(e => (e.data as { failureId: string }).failureId));
  const failures = [
    ...repo.list<{ id: string; state: string; name: string }>('operation', sessionId).filter(o => o.state === 'prepared' && !engine.tools.isExecuting(o.id)).map(o => ({ id: `operation:${o.id}`, kind: 'unknown outcome', detail: `${o.name}: execution was interrupted before its receipt was committed. Inspect effects before allowing new work.` })),
    ...engine.jobs.list().filter(j => ['failed', 'cancelled', 'interrupted'].includes(j.state)).map(j => ({ id: `job:${j.id}`, kind: 'job', detail: `${j.state}: ${j.command}` })),
    ...events.filter(e => e.type === 'tool_result' && (e.data as { result?: { ok?: boolean } }).result?.ok === false).map(e => ({ id: `tool:${e.id}`, kind: 'tool', detail: JSON.stringify(e.data) })),
  ].filter(f => !waived.has(f.id));
  const outstanding = tasks.filter(t => t.state !== 'done' && t.state !== 'cancelled');
  const jobs = engine.jobs.list().map(job => ({ ...job, output: undefined, result: undefined }));
  const stage = stageStatus(engine);
  const state = running || jobs.some(j => j.state === 'running') ? 'working' : failures.length ? 'needs review' : session.state === 'paused' ? 'paused' : approvals.length ? 'waiting for approval' : deliveries.some(d => d.state === 'failed') ? 'needs retry' : deliveries.length ? 'waiting for participants' : outstanding.length ? 'idle with open tasks' : stage?.current ? 'waiting for stage approval' : 'idle';
  return { state, stage, acceptance: session.completion ? 'human accepted' : 'not accepted', failures, objective: session.objective, reason: session.reason, completedTasks: tasks.filter(t => t.state === 'done'), outstandingTasks: outstanding, artifacts, approvals, deliveries, jobs, checks, completion: session.completion ?? null, note: 'Idle is not proof of success. Checks apply only to the artifacts and versions they validated.' };
}

export function resolveFailure(engine: Engine, failureId: string, reason: string): void {
  if (!reason.trim() || reason.length > 2000) throw new Error('Provide a resolution or waiver reason (1–2000 characters).');
  if (!completionReport(engine).failures.some(f => f.id === failureId)) throw new Error('Unknown unresolved failure');
  engine.repo.event(engine.sessionId, 'human_failure_resolution', { failureId, reason, by: 'human' });
}

export function executionExitCode(report: ReturnType<typeof completionReport>): number { return report.state === 'idle' ? 0 : 2; }
