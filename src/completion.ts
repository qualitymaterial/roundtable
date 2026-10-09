import type { Engine } from './engine.js';
import type { Task, Artifact, Approval } from './domain.js';

export function completionReport(engine: Engine) {
  const { repo, sessionId } = engine;
  const session = engine.session(); const running = (engine.status() as { running: number }).running;
  const tasks = repo.list<Task>('task', sessionId);
  const deliveries = repo.deliveries(sessionId, ['pending', 'inflight', 'failed']);
  const approvals = repo.list<Approval>('approval', sessionId).filter(a => a.state === 'pending');
  const artifacts = repo.list<Artifact>('artifact', sessionId).map(({ id, name, hash, author }) => ({ id, name, hash, author }));
  const checks = repo.events(sessionId).filter(e => ['independent_artifact_validation', 'collaboration_acceptance'].includes(String(e.type))).map(e => ({ type: e.type, timestamp: e.timestamp, data: e.data }));
  const outstanding = tasks.filter(t => t.state !== 'done' && t.state !== 'cancelled');
  const jobs = engine.jobs.list().map(job => ({ ...job, output: undefined, result: undefined }));
  const state = running || jobs.some(j => j.state === 'running') ? 'working' : session.state === 'paused' ? 'paused' : approvals.length ? 'waiting for approval' : deliveries.some(d => d.state === 'failed') ? 'needs retry' : deliveries.length ? 'waiting for participants' : outstanding.length ? 'idle with open tasks' : 'idle';
  return { state, objective: session.objective, reason: session.reason, completedTasks: tasks.filter(t => t.state === 'done'), outstandingTasks: outstanding, artifacts, approvals, deliveries, jobs, checks, completion: session.completion ?? null, note: 'Idle is not proof of success. Checks apply only to the artifacts and versions they validated.' };
}
