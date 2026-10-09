import type { Engine } from './engine.js';

export function usageReport(engine: Engine) {
  const events = engine.repo.events(engine.sessionId);
  return engine.agents().map(agent => {
    const records = events.filter(e => e.type === 'usage' && (e.data as { agentId?: string }).agentId === agent.id).map(e => e.data as { tokens: number; dollars: number; source: string; details?: Record<string, number> });
    const sum = (key: string) => records.reduce((total, record) => total + (record.details?.[key] ?? 0), 0);
    return { agent: agent.name, id: agent.id, provider: agent.provider, model: agent.model,
      requests: events.filter(e => e.type === 'provider_request' && (e.data as { agentId?: string }).agentId === agent.id).length,
      tokens: records.reduce((n, r) => n + r.tokens, 0), estimatedDollars: records.reduce((n, r) => n + r.dollars, 0),
      inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), cacheReadTokens: sum('cacheReadTokens'), cacheWriteTokens: sum('cacheWriteTokens'),
      sources: [...new Set(records.map(r => r.source))], note: 'SDK cost estimates are not invoices. Missing historical components are not included; zero-priced models may have unknown real cost.' };
  });
}
