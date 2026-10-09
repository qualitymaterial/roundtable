import { taskValidation } from './recovery.js';
import { z } from 'zod';
import type { Engine } from './engine.js';
import type { Task, Artifact } from './domain.js';

export const Stage = z.object({
  name: z.string().min(1).max(100), objective: z.string().min(1).max(4000),
  requires: z.array(z.string().min(1).max(100)).max(20).optional(), taskTitles: z.array(z.string().min(1).max(300)).max(30).optional(), requireValidation: z.boolean().optional(),
  blind: z.boolean().default(false), requireArtifact: z.boolean().default(false),
}).strict();
export function validateStages(input: z.input<typeof Stage>[]) {
  const stages = z.array(Stage).min(1).max(20).parse(input); const names = new Set(stages.map(s => s.name));
  if (names.size !== stages.length) throw new Error('Stage names must be unique');
  const dependencies = (index: number): string[] => stages[index]!.requires ?? (index ? [stages[index - 1]!.name] : []);
  const visited = new Set<number>();
  const visit = (index: number, path: Set<string>) => { if (visited.has(index)) return; const stage = stages[index]!; if (path.has(stage.name)) throw new Error('Stage prerequisite cycle'); for (const name of dependencies(index)) { const next = stages.findIndex(s => s.name === name); if (next < 0) throw new Error('Unknown stage prerequisite: ' + name); visit(next, new Set([...path, stage.name])); } visited.add(index); };
  stages.forEach((_, i) => visit(i, new Set()));
  if (dependencies(0).length) throw new Error('The first stage must have no prerequisites'); return stages;
}
function acceptance(engine: Engine): string[] {
  const current = engine.session().workflow?.stages[engine.session().workflow!.index]; if (!current) return [];
  const tasks = engine.repo.list<Task>('task', engine.sessionId); const errors: string[] = [];
  for (const title of current.taskTitles ?? []) { const matching = tasks.filter(t => t.title === title); if (!matching.length || matching.some(t => t.state !== 'done')) errors.push('Complete required task: ' + title); }
  if (current.requireValidation) {
    const checks = tasks.flatMap(t => taskValidation(engine, t.id));
    if (!checks.length || checks.some(c => !c.passed)) errors.push('All active required artifact checks must pass; at least one is required');
  }
  return errors;
}
export type WorkflowState = { stages: z.output<typeof Stage>[]; index: number; ready: string[]; startedAt: string; artifactIds: string[]; history: { name: string; approvedAt: string; participants: string[] }[] };
export function stageStatus(engine: Engine) {
  const state = engine.session().workflow;
  return state ? { ...state, current: state.stages[state.index], blockers: acceptance(engine), waiting: engine.agents().filter(a => a.state !== 'removed' && !state.ready.includes(a.id)).map(a => a.id) } : undefined;
}
export function stageReady(engine: Engine, agentId: string): unknown {
  const session = engine.session(); const state = session.workflow;
  if (!state || !state.stages[state.index]) throw new Error('No active workflow stage');
  if (engine.repo.list<Task>('task', engine.sessionId).some(t => t.owner === agentId && t.state === 'claimed')) throw new Error('Finish or release your claimed tasks before declaring ready');
  if (state.stages[state.index]!.requireArtifact && !engine.repo.list<Artifact>('artifact', engine.sessionId).some(a => a.author === agentId && !state.artifactIds.includes(a.id))) throw new Error('Publish a new artifact for this stage before declaring ready');
  const blockers = acceptance(engine); if (blockers.length) throw new Error(blockers.join('; '));
  state.ready = [...new Set([...state.ready, agentId])]; engine.repo.put('session', session);
  engine.repo.event(engine.sessionId, 'stage_ready', { index: state.index, agentId });
  return { ready: true, instruction: 'Stop. The human must approve the stage before work continues.' };
}
export function advanceStage(engine: Engine, nextName?: string): void {
  const session = engine.session(); const state = session.workflow; const status = stageStatus(engine);
  if (!state || !status?.current) throw new Error('No active workflow stage');
  if (!engine.agents().some(a => a.state !== 'removed')) throw new Error('Connect participants before approving a stage');
  if (status.waiting.length || (engine.status() as { running: number }).running) throw new Error('Wait for all participants to declare stage readiness and finish their turns');
  const blockers = acceptance(engine); if (blockers.length) throw new Error(blockers.join('; '));
  const completed = new Set([...state.history.map(h => h.name), status.current.name]);
  const eligible = state.stages.map((s, i) => ({ s, i })).filter(({ s, i }) => !completed.has(s.name) && (s.requires ?? (i ? [state.stages[i - 1]!.name] : [])).every(n => completed.has(n)));
  const next = nextName ? eligible.find(({ s }) => s.name === nextName) : eligible[0];
  if (nextName && !next) throw new Error('Next stage is unknown, completed or has unmet prerequisites');
  if (!next && completed.size !== state.stages.length) throw new Error('No eligible next stage; inspect prerequisites');
  state.history.push({ name: status.current.name, approvedAt: new Date().toISOString(), participants: [...state.ready] });
  const previous = state.index; state.index = next?.i ?? state.stages.length; state.ready = []; state.startedAt = new Date().toISOString();
  state.artifactIds = engine.repo.list<Artifact>('artifact', engine.sessionId).map(a => a.id);
  engine.repo.put('session', session); engine.repo.event(engine.sessionId, 'human_stage_approved', { index: previous, name: status.current.name });
  if (state.stages[state.index]) for (const agent of engine.agents().filter(a => a.state !== 'removed')) engine.notify(agent.id, `stage:${state.index}`, `Stage approved. Begin ${state.stages[state.index]!.name}: ${state.stages[state.index]!.objective}`);
}
export const blindAllowedTools = new Set(['roundtable_wait', 'roundtable_agents_list', 'roundtable_artifact_publish', 'roundtable_stage_ready', 'roundtable_stage_status', 'roundtable_tools_list', 'roundtable_tool_request', 'data_json_validate', 'roundtable_memory_write']);
