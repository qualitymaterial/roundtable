import type { Repository } from './storage.js';
import { redact } from './domain.js';
import { digest, normalizeQuery, WebError, type SearchRequest, type WebConfiguration, type WebSource } from './web-types.js';

export type WebContext = { signal: AbortSignal; authorize: () => void; agentId?: string; scopeId?: string; request?: string; profile?: 'simple' | 'deep'; timeZone?: string };
export type FreshnessDecision = { category: 'current' | 'stable' | 'unknown'; confidence: 'heuristic' | 'conservative' | 'explicit'; maximumAgeSeconds: number; forceLive: boolean; reason: string; date: string; timeZone: string };
export function localDate(now: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
}
export function freshnessDecision(text: string, config: WebConfiguration, now: number, timeZone: string, explicit = false, maxAge?: number): FreshnessDecision {
  const current = /\b(today|tonight|tomorrow|now|current|latest|recent|news|schedules?|prices?|costs?|releases?|advisor(?:y|ies)|alerts?|versions?|availability|weather|scores?|elections?|exchange rates?|stock|security updates?)\b/i.test(text);
  const stable = !current && /\b(theorem|mathematical|definition|historical|history|algorithm|architecture|technical|fundamentals?|principles?)\b/i.test(text);
  const category = current || explicit ? 'current' : stable ? 'stable' : 'unknown';
  const maximumAgeSeconds = Math.min(config.cacheSeconds, maxAge ?? Infinity, config.orchestration[category === 'current' ? 'currentSeconds' : category === 'stable' ? 'stableSeconds' : 'unknownSeconds']);
  return { category, confidence: explicit ? 'explicit' : category === 'unknown' ? 'conservative' : 'heuristic', maximumAgeSeconds, forceLive: explicit || maxAge === 0, reason: explicit ? 'Explicit live retrieval requested' : category === 'current' ? 'Changing external fact requires recently retrieved evidence' : category === 'unknown' ? 'Freshness uncertain; use conservative live-source age' : 'Stable-topic heuristic; source observations still expire', date: localDate(now, timeZone), timeZone };
}
/** Only anchored, well-understood paraphrases are merged. Operators/quotes are never bagged or sorted. */
export function canonicalSearch(input: SearchRequest, decision: FreshnessDecision) {
  let query = normalizeQuery(input.query); let identity = query;
  if (!/["':()|+-]/.test(query.replace(/today['’]s/gi, 'today'))) {
    const plain = query.replace(/^(?:please\s+)?(?:what (?:is|are)|show me|find|give me)\s+(?:the\s+)?/i, '').replace(/^the\s+/i, '').replace(/\?$/, '').trim();
    const prefix = /^(today(?:['’]s)?|tonight)\s+([\p{L}\p{N} ]+?)\s+(?:schedule|games|fixtures)$/iu.exec(plain);
    const suffix = /^([\p{L}\p{N} ]+?)\s+(?:schedule|games|fixtures)(?:\s+for)?\s+(today|tonight)$/iu.exec(plain);
    if (prefix || suffix) {
      const topic = (prefix?.[2] ?? suffix?.[1])!.trim(); const when = prefix?.[1] ?? suffix?.[2];
      // Tonight is narrower than today; never merge the two intents.
      identity = `schedule:${topic.toLowerCase()}:${when === 'tonight' ? 'tonight' : 'today'}:${decision.date}`;
      query = `${topic} schedule ${decision.date}${when === 'tonight' ? ' tonight' : ''}`;
    }
  }
  return { query, identity, date: decision.category === 'stable' ? undefined : decision.date, timeZone: decision.timeZone, count: input.count, freshness: input.freshness, language: input.language, domains: [...new Set(input.domains.map(d => d.toLowerCase()))].sort(), region: input.region?.toUpperCase(), dateRange: input.dateRange, intent: input.intent };
}

type Attempt = { failures: number; retryAt: number; noNew: number; sourceIds: string[]; succeeded?: boolean };
export type WebScope = { id: string; sessionId: string; scopeId: string; profile: 'simple' | 'deep'; searches: number; reads: number; searchLimit: number; readLimit: number; extensions: number; productive: number; noNewStreak: number; attempts: Record<string, Attempt>; seen: string[]; conflicts: { field: string; values: string[]; sourceIds: string[] }[]; facts: Record<string, { value: string; sourceId: string }[]> };
type ActorUsage = { id: string; sessionId: string; searches: number; reads: number };
export class WebOrchestration {
  constructor(readonly repo: Repository, readonly sessionId: string, readonly config: () => WebConfiguration, readonly now: () => number) {}
  actor(context: WebContext): string { return context.agentId ?? 'runtime'; }
  scope(context: WebContext): WebScope {
    const scopeId = context.scopeId ?? this.sessionId; const id = digest([this.sessionId, scopeId]); const saved = this.repo.get<WebScope>('web_scope', id); if (saved) return saved;
    const c = this.config().orchestration; const profile = context.profile ?? 'simple';
    return { id, sessionId: this.sessionId, scopeId, profile, searches: 0, reads: 0, searchLimit: profile === 'deep' ? c.deepSearches : c.simpleSearches, readLimit: profile === 'deep' ? c.deepReads : c.simpleReads, extensions: 0, productive: 0, noNewStreak: 0, attempts: {}, seen: [], conflicts: [], facts: {} };
  }
  metric(kind: string, context: WebContext, data: Record<string, unknown> = {}): void { this.repo.event(this.sessionId, 'web_orchestration', { kind, agentId: this.actor(context), scopeId: context.scopeId ?? this.sessionId, ...data }); }
  before(key: string, context: WebContext): void {
    const scope = this.scope(context); const attempt = scope.attempts[key];
    if (attempt && attempt.failures >= 2 && attempt.retryAt > this.now()) {
      this.metric('suppressed', context, { reason: 'failed_retry', key });
      throw new WebError('retry_suppressed', 'Repeated failed retrieval suppressed until cooldown expires', { reason: 'No evidence was produced by repeated failures', retryAt: new Date(attempt.retryAt).toISOString(), suggestions: ['Wait for the provider to recover', 'Use already retained sources', 'Try a different query only if it addresses an evidence gap'] });
    }
  }
  reserve(mode: 'search' | 'read', context: WebContext): void {
    // Caller holds the repository transaction together with session reservation.
    const scope = this.scope(context); const config = this.config(); const actorId = digest([this.sessionId, this.actor(context)]);
    const actor = this.repo.get<ActorUsage>('web_actor', actorId) ?? { id: actorId, sessionId: this.sessionId, searches: 0, reads: 0 };
    const count = mode === 'search' ? 'searches' : 'reads'; const limit = mode === 'search' ? 'searchLimit' : 'readLimit';
    if (scope[count] >= scope[limit] && scope.profile === 'deep' && config.orchestration.autoExtendDeep && scope.extensions === 0 && scope.productive >= 2 && scope.noNewStreak < 2) {
      scope.searchLimit += config.orchestration.extensionSearches; scope.readLimit += config.orchestration.extensionReads; scope.extensions++;
      this.metric('budget_extension', context, { approvedBy: 'runtime-policy', reason: 'Deep research continues to produce distinct evidence', searches: scope.searchLimit, reads: scope.readLimit });
    }
    if (scope[count] >= scope[limit]) throw new WebError('budget_exhausted', 'Task web budget exhausted; retained evidence remains accessible', { scopeId: scope.scopeId, profile: scope.profile, used: scope[count], limit: scope[limit], potentialConflicts: scope.conflicts.length, suggestions: ['Review existing source handles', 'Request an explicit extension through /diagnostics web'] });
    if (actor[count] >= (mode === 'search' ? config.orchestration.agentSearches : config.orchestration.agentReads)) throw new WebError('budget_exhausted', 'Agent web request budget exhausted', { agentId: this.actor(context), suggestions: ['Review retained evidence or change the human-configured agent ceiling'] });
    scope[count]++; actor[count]++; this.repo.put('web_scope', scope); this.repo.put('web_actor', actor);
  }
  approveExtension(scopeId: string, searches: number, reads: number, reason: string): void {
    if (!Number.isInteger(searches) || !Number.isInteger(reads) || searches < 0 || searches > 20 || reads < 0 || reads > 40 || searches + reads === 0 || !reason.trim() || reason.length > 500) throw new WebError('invalid_input', 'Specify bounded additional searches/reads and an evidence-gap reason');
    this.repo.transaction(() => {
      const scope = this.repo.get<WebScope>('web_scope', digest([this.sessionId, scopeId])); if (!scope || scope.sessionId !== this.sessionId) throw new WebError('source_unavailable', 'Unknown current-session web scope');
      scope.searchLimit = Math.min(this.config().maxSearches, scope.searchLimit + searches); scope.readLimit = Math.min(this.config().maxReads, scope.readLimit + reads); scope.extensions++;
      this.repo.put('web_scope', scope); this.metric('budget_extension', { signal: new AbortController().signal, authorize: () => {}, scopeId }, { approvedBy: 'human-runtime', reason: redact(reason), searches: scope.searchLimit, reads: scope.readLimit });
    });
  }
  complete(key: string, context: WebContext, sources?: WebSource[], backend = true): Record<string, unknown> {
    const feedback = this.repo.transaction(() => {
      const scope = this.scope(context); const prior = scope.attempts[key] ?? { failures: 0, retryAt: 0, noNew: 0, sourceIds: [] };
      if (!sources) { prior.failures++; prior.retryAt = this.now() + this.config().orchestration.retryCooldownMs; scope.attempts[key] = prior; this.repo.put('web_scope', scope); return { reason: 'Retrieval failed; no new evidence retained' }; }
      const seen = new Set(scope.seen); let novel = 0;
      for (const source of sources) {
        const fingerprint = digest({ url: source.url, kind: source.kind, text: source.text }); if (!seen.has(fingerprint)) { novel++; seen.add(fingerprint); }
        if (source.kind === 'page') for (const match of source.text.matchAll(/^([\p{L}\p{N}][\p{L}\p{N} _-]{1,60}):\s*([^\n]{1,200})$/gmu)) {
          const field = match[1]!.trim().toLowerCase(); const value = match[2]!.trim(); const records = scope.facts[field] ?? [];
          if (!records.some(r => r.sourceId === source.id && r.value === value)) records.push({ value, sourceId: source.id }); scope.facts[field] = records.slice(-20);
        }
      }
      const retainedFacts: WebScope['facts'] = {};
      for (const [field, rows] of Object.entries(scope.facts).slice(-100)) {
        const latest = new Map<string, { value: string; sourceId: string }>();
        for (const row of rows) { const source = this.repo.get<WebSource>('web_source', row.sourceId); if (source && Date.parse(source.expiresAt) > this.now()) latest.set(source.url, row); }
        if (latest.size) retainedFacts[field] = [...latest.values()];
      }
      scope.facts = retainedFacts;
      scope.conflicts = Object.entries(scope.facts).flatMap(([field, rows]) => new Set(rows.map(r => r.value)).size > 1 ? [{ field, values: [...new Set(rows.map(r => r.value))], sourceIds: [...new Set(rows.map(r => r.sourceId))] }] : []).slice(0, 20);
      scope.seen = [...seen].slice(-400); scope.productive += novel > 0 && backend ? 1 : 0; if (backend) scope.noNewStreak = novel ? 0 : scope.noNewStreak + 1;
      scope.attempts[key] = { failures: 0, retryAt: 0, noNew: backend ? novel ? 0 : prior.noNew + 1 : prior.noNew, sourceIds: sources.map(s => s.id), succeeded: true }; this.repo.put('web_scope', scope);
      return { novelSources: novel, reason: novel ? 'New source content retained' : 'No new source content; avoid repeating the same retrieval', potentialConflicts: scope.conflicts, assessment: scope.conflicts.length ? 'potential_conflict' : sources.some(s => s.kind === 'page') ? 'evidence_available' : 'page_evidence_needed', suggestions: scope.conflicts.length ? ['Compare the conflicting source sections; no independent truth judgment was made'] : novel ? [] : ['Use retained source handles', 'Add a missing date, region, comparison or primary-source domain only when useful'], remaining: { searches: Math.max(0, scope.searchLimit - scope.searches), reads: Math.max(0, scope.readLimit - scope.reads) } };
    });
    return feedback;
  }
  excerpt(source: WebSource, context: WebContext, focus: string, start?: number, length?: number, repeat = false) {
    const size = length ?? this.config().orchestration.excerptChars;
    if (start === undefined) {
      const tokens = [...new Set((focus.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(t => !['the', 'and', 'what', 'for', 'with', 'please'].includes(t)))].slice(0, 30);
      let score = 0; start = 0;
      for (let offset = 0; offset < source.text.length; offset += Math.max(100, Math.floor(size / 2))) { const text = source.text.slice(offset, offset + size).toLowerCase(); const value = tokens.reduce((n, t) => n + Number(text.includes(t)), 0); if (value > score) { score = value; start = offset; } }
    }
    const end = Math.min(source.text.length, start + size); const id = digest([this.sessionId, this.actor(context), context.scopeId ?? this.sessionId, source.url, digest(source.text), start, end]);
    const delivered = this.repo.get('web_delivery', id); const omitted = !!delivered && !repeat;
    if (!omitted) this.repo.put('web_delivery', { id, sessionId: this.sessionId });
    return { ...source, text: omitted ? '' : source.text.slice(start, end), totalChars: source.text.length, locator: { start, end }, nextStart: end < source.text.length ? end : null, contentOmitted: omitted, excerpted: start > 0 || end < source.text.length, ...(omitted ? { feedback: 'Identical content already delivered; use source handle plus section offsets or includePreviouslySeen:true after context loss' } : {}) };
  }
  diagnostics() {
    const rows = this.repo.db.prepare("SELECT data FROM events WHERE session_id=? AND type IN ('web_orchestration','web_operation') ORDER BY sequence").all(this.sessionId).map(r => JSON.parse(String(r.data)) as Record<string, unknown>);
    const backend = rows.filter(r => r.kind === 'backend'); const latency = backend.reduce((n, r) => n + Number(r.latencyMs ?? 0), 0);
    return { successfulSearches: backend.filter(r => r.operation === 'search' && r.outcome === 'ok').length, successfulReads: backend.filter(r => r.operation === 'read' && r.outcome === 'ok').length, duplicateCalls: rows.filter(r => r.kind === 'reuse').length, cacheHits: rows.filter(r => (r.kind === 'reuse' || r.kind === 'cache_access') && r.cache === true).length, suppressedCalls: rows.filter(r => r.kind === 'suppressed').length, failedBackendRequests: backend.filter(r => r.outcome !== 'ok').length, failedToolCalls: rows.filter(r => r.kind === 'registry_error' || r.kind === undefined && r.outcome !== 'ok').length, providerLatency: { requests: backend.length, totalMs: latency, averageMs: backend.length ? latency / backend.length : 0 }, approximateCost: { knownEstimate: backend.reduce((n, r) => n + Number(r.estimatedCost ?? 0), 0), unknownCostRequests: backend.filter(r => r.estimatedCost === null).length, notInvoice: true }, scopes: this.repo.list<WebScope>('web_scope', this.sessionId).map(s => ({ scopeId: s.scopeId, profile: s.profile, searches: s.searches, reads: s.reads, searchLimit: s.searchLimit, readLimit: s.readLimit, extensions: s.extensions, productive: s.productive, potentialConflicts: s.conflicts.length })) };
  }
}
