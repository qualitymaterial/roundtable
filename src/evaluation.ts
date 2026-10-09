import { z } from 'zod';
import type { Repository } from './storage.js';
import type { AgentRecord, SessionRecord, Task } from './domain.js';
import type { Contract } from './recovery.js';

export const Comparison = z.object({ task: z.string().min(1).max(1000), solo: z.string().uuid(), team: z.string().uuid(), humanNotes: z.string().max(12000).default(''), qualityScores: z.object({ solo: z.number().min(0).max(5), team: z.number().min(0).max(5), rubric: z.string().min(1).max(4000) }).optional() }).strict();
/** Compare recorded evidence, never infer useful collaboration from participant count. */
export function compareSessions(repo: Repository, input: unknown) {
  const spec = Comparison.parse(input); if (spec.solo === spec.team) throw new Error('Choose two independent sessions');
  const read = (key: string) => {
    const session = repo.get<SessionRecord>('session', key); if (!session) throw new Error('Unknown evaluation session');
    const agents = repo.list<AgentRecord>('agent', key); const events = repo.events(key);
    const validations = repo.list<{ contractId: string; artifactId: string; hash: string; passed: boolean }>('validation', key);
    const contracts = repo.list<Contract>('contract', key).filter(c => c.active);
    const artifacts = repo.list<{ id: string; name: string; hash: string }>('artifact', key);
    const checks = contracts.map(c => { const a = artifacts.filter(a => a.name === c.artifactName).at(-1); return { description: c.description, passed: !!a && validations.findLast(v => v.contractId === c.id && v.artifactId === a.id && v.hash === a.hash)?.passed === true }; });
    const repairs = events.filter(e => ['human_task_repair', 'human_failure_resolution', 'human_provider_recovered'].includes(String(e.type))).length;
    const tasks = repo.list<Task>('task', key); const toolFailures = events.filter(e => e.type === 'tool_result' && (e.data as { result?: { ok?: boolean } }).result?.ok === false).length;
    const pending = repo.deliveries(key, ['pending', 'inflight', 'failed']).length + repo.list<{ state: string }>('approval', key).filter(a => a.state === 'pending').length + repo.list<{ state: string }>('operation', key).filter(o => o.state === 'prepared').length + repo.list<{ state: string }>('job', key).filter(j => j.state !== 'done').length + repo.list<{ state: string }>('changegroup', key).filter(g => !['accepted', 'undone', 'proposed'].includes(g.state)).length;
    const complete = pending === 0 && tasks.length > 0 && tasks.every(t => t.state === 'done') && checks.length > 0 && checks.every(c => c.passed);
    const last = events.at(-1)?.timestamp; const elapsedMs = last ? Math.max(0, Date.parse(String(last)) - Date.parse(session.createdAt)) : 0;
    return { sessionId: key, objective: session.objective, agents: agents.map(a => ({ provider: a.provider, model: a.model })), limits: session.limits, usage: session.usage, elapsedMs, tasks: tasks.length, pending, complete, checks, firstPass: complete && repairs === 0 && toolFailures === 0 && !validations.some(v => !v.passed), repairs, toolFailures, independentMessages: repo.messages(key, undefined, 100000).filter(m => m.sender !== 'human' && m.sender !== 'system' && m.recipients.length).length };
  };
  const solo = read(spec.solo), team = read(spec.team);
  if (solo.agents.length !== 1 || team.agents.length < 2) throw new Error('Comparison requires one solo participant and at least two team participants');
  if (solo.objective !== team.objective) throw new Error('Matched sessions must use the same objective');
  const warnings = ['Recorded elapsed time includes human waits. Costs are the existing usage estimates, not subscription quota.', 'Deterministic checks establish only declared assertions; human quality scores need independent review.'];
  if (JSON.stringify(solo.limits) !== JSON.stringify(team.limits)) warnings.push('Resource limits differ; this is not a matched-budget comparison.');
  if (solo.agents.concat(team.agents).some(a => a.provider.includes('mock'))) warnings.push('Contains mock models: this verifies measurement plumbing, not model quality or collaboration benefit.');
  return { task: spec.task, solo, team, qualityScores: spec.qualityScores, humanNotes: spec.humanNotes, warnings, tokenDifference: team.usage.tokens - solo.usage.tokens, estimatedCostDifference: team.usage.dollars - solo.usage.dollars };
}
