import { id, redact } from './domain.js';
import type { Repository } from './storage.js';

export type Job = { id: string; sessionId: string; agentId: string; command: string; cwd: string; timeoutMs: number; state: 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted'; startedAt: string; endedAt?: string; output: string; result?: unknown };
export type JobExecutor = (command: string, cwd: string, signal: AbortSignal, timeoutMs?: number, onOutput?: (output: string) => void) => Promise<unknown>;
export class BackgroundJobs {
  private active = new Map<string, { abort: AbortController; done: Promise<void> }>();
  constructor(private repo: Repository, private sessionId: string, private execute: JobExecutor, recover = true, private notify?: (job: Job) => void) {
    if (recover) for (const job of this.list().filter(j => j.state === 'running')) { job.state = 'interrupted'; job.endedAt = new Date().toISOString(); repo.put('job', job); }
  }
  list(): Job[] { return this.repo.list<Job>('job', this.sessionId); }
  read(jobId: string): Job { const job = this.repo.get<Job>('job', jobId); if (!job || job.sessionId !== this.sessionId) throw new Error('Unknown session job'); return job; }
  start(agentId: string, command: string, cwd: string, timeoutMs: number): Job {
    if (this.active.size >= 4) throw new Error('Four background jobs are already running. Stop or wait for one.');
    const job: Job = { id: id(), sessionId: this.sessionId, agentId, command, cwd, timeoutMs, state: 'running', startedAt: new Date().toISOString(), output: '' };
    this.repo.put('job', job); const abort = new AbortController();
    const done = this.execute(command, cwd, abort.signal, timeoutMs, output => { job.output = redact(output.slice(-64000)); this.repo.put('job', job); })
      .then(result => { job.result = result; job.state = (result as { code?: number }).code === 0 ? 'done' : 'failed'; })
      .catch(error => { job.result = redact(String(error)); job.state = 'failed'; })
      .finally(() => { if (abort.signal.aborted) job.state = 'cancelled'; job.endedAt = new Date().toISOString(); this.repo.put('job', job); this.repo.event(this.sessionId, 'job_finished', { id: job.id, state: job.state }); this.active.delete(job.id); this.notify?.(job); });
    this.active.set(job.id, { abort, done }); this.repo.event(this.sessionId, 'job_started', { id: job.id, agentId, timeoutMs }); return job;
  }
  async stop(jobId: string): Promise<void> { this.read(jobId); const work = this.active.get(jobId); work?.abort.abort(); await work?.done; }
  async close(): Promise<void> { for (const work of this.active.values()) work.abort.abort(); await Promise.all([...this.active.values()].map(work => work.done)); }
}
