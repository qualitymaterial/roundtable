import type { Engine } from './engine.js';
import { timestamp, redact } from './domain.js';
import { z } from 'zod';

export function providerFailure(error: unknown) {
  const message = redact(String(error));
  const category = /401|403|unauthori[sz]ed|invalid.api.key|expired.*token|refresh.*token/i.test(message) ? 'authentication' : /429|rate.limit|quota/i.test(message) ? 'capacity' : /timeout|timed out|ECONN|5\d\d|fetch failed/i.test(message) ? 'unavailable' : 'other';
  return { category, message, advice: category === 'authentication' ? 'Use /login for this provider, then /provider-recover for the participant.' : 'Inspect /summary. Configure or use an explicit /fallback; failed deliveries are not automatically replayed.' };
}
type Fallback = { id: string; sessionId: string; provider: string; model: string; configuredAt: string };
export function setFallback(engine: Engine, agentId: string, provider: string, model: string): Fallback {
  if (!engine.agents().some(a => a.id === agentId && a.state !== 'removed')) throw new Error('Unknown participant');
  const target = z.object({ provider: z.string().min(1).max(200), model: z.string().min(1).max(300) }).parse({ provider, model });
  const record = { id: agentId, sessionId: engine.sessionId, ...target, configuredAt: timestamp() };
  engine.repo.put('fallback', record); engine.repo.event(engine.sessionId, 'human_fallback_configured', record); return record;
}
export function getFallback(engine: Engine, agentId: string): Fallback | undefined { const result = engine.repo.get<Fallback>('fallback', agentId); return result?.sessionId === engine.sessionId ? result : undefined; }
export async function recoverProvider(engine: Engine, agentId: string, fallback = false): Promise<void> {
  const agent = engine.agents().find(a => a.id === agentId && a.state !== 'removed'); if (!agent) throw new Error('Unknown participant');
  const target = fallback ? getFallback(engine, agentId) : agent; if (!target) throw new Error('Configure a fallback first');
  // Connection probes consume requests. Failed replacement leaves the original adapter/model intact.
  await engine.changeModel(agentId, target.provider, target.model, fallback ? { effort: undefined, maxOutputTokens: undefined, contextWindowTokens: undefined } : { effort: agent.effort, maxOutputTokens: agent.maxOutputTokens, contextWindowTokens: agent.contextWindowTokens });
  if (agent.state === 'paused') await engine.setAgentState(agentId, 'active');
  engine.repo.event(engine.sessionId, 'human_provider_recovered', { agentId, provider: target.provider, model: target.model, replayed: false });
}
