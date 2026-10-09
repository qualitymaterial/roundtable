import type { SessionRecord } from './domain.js';

export const budgetMetrics = ['tokens', 'dollars', 'requests', 'toolCalls', 'exchanges'] as const;
export type BudgetMetric = typeof budgetMetrics[number];
const labels: Record<BudgetMetric, string> = { tokens: 'Token', dollars: 'Estimated spending', requests: 'Request', toolCalls: 'Tool call', exchanges: 'Exchange' };
export function budgetReason(session: SessionRecord, metric: BudgetMetric): string {
  const format = (value: number) => metric === 'dollars' ? `$${value.toFixed(4)}` : value.toLocaleString('en-US');
  const limit = session.limits[metric];
  return `${labels[metric]} budget reached: ${format(session.usage[metric])} / ${limit === null ? 'off' : format(limit)}`;
}
export function exhaustedBudgets(session: SessionRecord): string[] {
  return [
    ...budgetMetrics.filter(metric => { const limit = session.limits[metric]; return limit !== null && session.usage[metric] >= limit; }).map(metric => budgetReason(session, metric)),
    ...Object.entries(session.limits.providerRequests).filter(([provider, limit]) => (session.providerRequests[provider] ?? 0) >= limit)
      .map(([provider, limit]) => `Provider request budget reached: ${provider} (${session.providerRequests[provider]} / ${limit})`),
  ];
}
export const budgetHelp = 'Work is saved. Use /budget to inspect limits, /budget tokens <total|off> (or dollars/requests/tools/exchanges <total>) to change a ceiling, then /resume. Use /export to save the transcript or /exit to leave.';
