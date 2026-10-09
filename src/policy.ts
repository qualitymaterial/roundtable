import { z } from 'zod';
import type { Engine } from './engine.js';
import type { Task, Artifact } from './domain.js';

export const Stage = z.object({
  name: z.string().min(1).max(100), objective: z.string().min(1).max(4000),
  blind: z.boolean().default(false), requireArtifact: z.boolean().default(false),
}).strict();
export type WorkflowState = { stages: z.output<typeof Stage>[]; index: number; ready: string[]; startedAt: string; artifactIds: string[]; history: { name: string; approvedAt: string; participants: string[] }[] };
export function stageStatus(engine: Engine) {
  const state = engine.session().workflow;
  return state ? { ...state, current: state.stages[state.index], waiting: engine.agents().filter(a => a.state !== 'removed' && !state.ready.includes(a.id)).map(a => a.id) } : undefined;
}
export function stageReady(engine: Engine, agentId: string): unknown {
  const session = engine.session(); const state = session.workflow;
  if (!state || !state.stages[state.index]) throw new Error('No active workflow stage');
  if (engine.repo.list<Task>('task', engine.sessionId).some(t => t.owner === agentId && t.state === 'claimed')) throw new Error('Finish or release your claimed tasks before declaring ready');
  if (state.stages[state.index]!.requireArtifact && !engine.repo.list<Artifact>('artifact', engine.sessionId).some(a => a.author === agentId && !state.artifactIds.includes(a.id))) throw new Error('Publish a new artifact for this stage before declaring ready');
  state.ready = [...new Set([...state.ready, agentId])]; engine.repo.put('session', session);
  engine.repo.event(engine.sessionId, 'stage_ready', { index: state.index, agentId });
  return { ready: true, instruction: 'Stop. The human must approve the stage before work continues.' };
}
export function advanceStage(engine: Engine): void {
  const session = engine.session(); const state = session.workflow; const status = stageStatus(engine);
  if (!state || !status?.current) throw new Error('No active workflow stage');
  if (!engine.agents().some(a => a.state !== 'removed')) throw new Error('Connect participants before approving a stage');
  if (status.waiting.length || (engine.status() as { running: number }).running) throw new Error('Wait for all participants to declare stage readiness and finish their turns');
  state.history.push({ name: status.current.name, approvedAt: new Date().toISOString(), participants: [...state.ready] });
  state.index++; state.ready = []; state.startedAt = new Date().toISOString();
  state.artifactIds = engine.repo.list<Artifact>('artifact', engine.sessionId).map(a => a.id);
  engine.repo.put('session', session); engine.repo.event(engine.sessionId, 'human_stage_approved', { index: state.index - 1, name: status.current.name });
  if (state.stages[state.index]) for (const agent of engine.agents().filter(a => a.state !== 'removed')) engine.notify(agent.id, `stage:${state.index}`, `Stage approved. Begin ${state.stages[state.index]!.name}: ${state.stages[state.index]!.objective}`);
}
export const blindAllowedTools = new Set(['roundtable_agents_list', 'roundtable_artifact_publish', 'roundtable_stage_ready', 'roundtable_stage_status', 'roundtable_tools_list', 'roundtable_tool_request', 'data_json_validate', 'roundtable_memory_write']);
