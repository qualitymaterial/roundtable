import { StructuredVerificationInput } from './verification.js';
import { Type } from 'typebox';
import { z } from 'zod';
import type { ToolRegistry } from './tools.js';
import { stageStatus } from './policy.js';
import { SearchInput, ReadInput, ResearchInput, VerifyInput, CacheInput, WebError } from './web-types.js';
import { searxngProvider } from './web-providers.js';

export function assertWebAccess(registry: ToolRegistry, agentId: string): void {
  const engine = registry.engine; const agent = engine.agents().find(a => a.id === agentId);
  if (!agent || !engine.authorized(agent, 'network.research') || engine.session().state !== 'active') throw new WebError('permission_denied', 'Active session and network.research authorization required');
  if (engine.toolBlockReason(agentId) || stageStatus(engine)?.current?.blind || stageStatus(engine)?.ready.includes(agentId)) throw new WebError('permission_denied', 'Current runtime stage or wait state blocks web access');
  engine.web.check();
}
export function installWebTools(registry: ToolRegistry): void {
  registry.register('roundtable_verification_requirements', 'List up to 20 protected evidence contracts; supply contractId for its full criteria. Cannot change criteria. Passing records never validates unrelated prose.', Type.Object({ taskId: Type.Optional(Type.String()), contractId: Type.Optional(Type.String()) }, { additionalProperties: false }), 'collaborate', ({ taskId, contractId }) => registry.engine.web.verification.contracts(taskId).filter(c => !contractId || c.id === contractId).slice(0, contractId ? 1 : 20).map(c => ({ ...(contractId ? { criteria: c } : { contractId: c.id, taskId: c.taskId, description: c.description.slice(0, 200) }), status: registry.engine.web.verification.status(c.id) })));
  registry.engine.web.providers.register('searxng', searxngProvider);
  const definitions = [
    ['search', SearchInput, 'Search with runtime freshness detection, semantic-safe reuse, task/agent budgets and loop feedback. fresh:true requests live retrieval. Returns concise untrusted excerpts and source handles; never model knowledge.'],
    ['read', ReadInput, 'Read a public URL with DNS-pinned HTTP, freshness-aware reuse and no scripts/credentials. Returns a relevant excerpt and source handle; use web.cache sections for additional text.'],
    ['research', ResearchInput, 'Run at most 3 searches and 5 page reads within session budgets. Return deduplicated evidence and explicit errors, never a synthesized conclusion.'],
    ['verify', z.union([VerifyInput, StructuredVerificationInput]), 'Compare claimed structured records against current retained page records using human-protected contractId criteria and citations. Reports confirmed/contradicted/insufficient_evidence/verification_error. Never validates additional prose or publisher truth. Legacy quotes check occurrence only.'],
    ['cache', CacheInput, 'List source metadata or read a bounded section using sourceId/start/length. Repeated content is omitted unless includePreviouslySeen:true. Integrity, session and freshness checks apply; no cache writes.'],
  ] as const;
  for (const [operation, schema, description] of definitions) registry.register('web.' + operation, description, Type.Unsafe(z.toJSONSchema(schema, { io: 'input' })), 'network.research', (input, { agent, signal }) => registry.engine.web.execute(operation, input, { signal, authorize: () => assertWebAccess(registry, agent.id), ...registry.engine.webContext(agent.id) }));
}
