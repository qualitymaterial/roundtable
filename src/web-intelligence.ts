import { dirname } from 'node:path';
import { EvidenceVerifier, StructuredVerificationInput } from './verification.js';
import { randomUUID } from 'node:crypto';
import type { Repository } from './storage.js';
import { redact, protectSecret } from './domain.js';
import { SearchProviders, ProviderResults } from './web-providers.js';
import { publicWebTransport, webUrl, type WebTransport } from './web-http.js';
import { extractPage, snippetText } from './web-extract.js';
import { WebOrchestration, canonicalSearch, freshnessDecision, type FreshnessDecision, type WebContext } from './web-orchestration.js';
import { WebError, webConfig, digest, normalizeQuery, sourceHash, SourceSchema, SearchInput, ReadInput, ResearchInput, VerifyInput, CacheInput, parseInput, type WebConfiguration, type WebSource } from './web-types.js';

type Context = WebContext;
type Usage = { id: string; sessionId: string; searches: number; reads: number; attempts: number; recent: number[]; repeated: Record<string, number>; active: { id: string; expires: number }[] };
type CacheRecord = { id: string; sessionId: string; key: string; sourceIds: string[]; hash: string; retrievedAt: string };
type Evidence = { schemaVersion: 1; sources: WebSource[]; cached: boolean; retrievedAt: string; warnings: string[]; untrusted: true; feedback?: Record<string, unknown>; freshness?: FreshnessDecision; coalesced?: boolean };
export type WebOptions = { transport?: WebTransport; configuration?: () => WebConfiguration; now?: () => number };

/** Shared runtime service: no model credentials, identities, prompts or provider-specific agent logic. */
export class WebIntelligence {
  readonly verification: EvidenceVerifier;
  readonly providers = new SearchProviders();
  private readonly transport: WebTransport;
  private readonly configuration: () => WebConfiguration;
  private readonly now: () => number;
  readonly orchestration: WebOrchestration;
  private pending = new Map<string, { controller: AbortController; waiters: number; promise: Promise<Evidence> }>();
  constructor(readonly repo: Repository, readonly sessionId: string, options: WebOptions = {}) {
    this.transport = options.transport ?? publicWebTransport;
    this.configuration = options.configuration ?? (() => webConfig(dirname(repo.path)));
    this.now = options.now ?? Date.now;
    this.orchestration = new WebOrchestration(repo, sessionId, () => this.config(), this.now);
    this.verification = new EvidenceVerifier(repo, sessionId, (id, maxAge) => { this.check(); return this.source(id, this.identity(), maxAge); }, this.now);
  }
  config(): WebConfiguration { return this.configuration(); }
  private safeText(value: string): string {
    const name = this.config().provider?.tokenEnv; const secret = name ? process.env[name] : undefined;
    return redact(secret ? value.split(secret).join('[REDACTED]') : value);
  }
  identity(): string {
    const config = this.config(); const secret = config.provider?.tokenEnv ? process.env[config.provider.tokenEnv] : undefined;
    if (secret) protectSecret(secret);
    return digest({ config, credentialRevision: secret ? digest(secret) : null, extraction: 'parse5-v1' });
  }
  check(): void { if (!this.config().enabled) throw new WebError('unconfigured', 'Web Intelligence is disabled in research.json'); }
  /** Durable receipts never cause network replay; stale evidence requires a new call ID. */
  validateReplay(input: unknown, result: unknown, context?: Context): void {
    if (result && typeof result === 'object' && 'data' in result) this.verification.validateReceipt(result.data);
    const policy = this.identity(); const maxAge = typeof input === 'object' && input !== null && 'maxAgeSeconds' in input && typeof input.maxAgeSeconds === 'number' ? input.maxAgeSeconds : undefined;
    if (maxAge === 0 || typeof input === 'object' && input !== null && 'fresh' in input && input.fresh === true) throw new WebError('freshness_unmet', 'A fresh request requires a new tool call ID');
    const decision = this.freshness(input && typeof input === 'object' && 'query' in input ? String(input.query) : '', context ?? { signal: new AbortController().signal, authorize: () => {} }, false, maxAge);
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if ('retrievedAt' in value && typeof value.retrievedAt === 'string' && this.now() - Date.parse(value.retrievedAt) >= decision.maximumAgeSeconds * 1000) throw new WebError('freshness_unmet', 'Historical tool receipt is stale; issue a new tool call ID');
      if ('hash' in value) {
        const id = 'sourceId' in value ? value.sourceId : 'id' in value ? value.id : undefined;
        if (typeof id === 'string') this.source(id, policy, maxAge);
      }
      for (const child of Object.values(value)) if (typeof child === 'object') { if (Array.isArray(child)) child.forEach(visit); else visit(child); }
    };
    visit(result);
  }
  private guard(context: Context, policy: string): void { context.signal.throwIfAborted(); context.authorize(); this.check(); if (this.identity() !== policy) throw new WebError('policy_changed', 'Web configuration changed; issue a new request'); }
  private usage(): Usage { return this.repo.get<Usage>('web_budget', this.sessionId) ?? { id: this.sessionId, sessionId: this.sessionId, searches: 0, reads: 0, attempts: 0, recent: [], repeated: {}, active: [] }; }
  private attempt(key: string, config: WebConfiguration): void {
    this.repo.transaction(() => {
      const usage = this.usage(); if (usage.attempts >= config.maxAttempts) throw new WebError('budget_exhausted', 'Session web attempt budget exhausted');
      usage.attempts++; usage.repeated[key] = (usage.repeated[key] ?? 0) + 1; this.repo.put('web_budget', usage);
    });
  }
  private reserve(mode: 'search' | 'read', config: WebConfiguration, context: Context): () => void {
    const reservation = randomUUID(); const now = this.now();
    this.repo.transaction(() => {
      const usage = this.usage(); const key = mode === 'search' ? 'searches' : 'reads';
      if (usage[key] >= (mode === 'search' ? config.maxSearches : config.maxReads)) throw new WebError('budget_exhausted', `Session web ${mode} budget exhausted`);
      usage.recent = usage.recent.filter(t => t > now - 60000); usage.active = usage.active.filter(r => r.expires > now);
      if (usage.recent.length >= config.requestsPerMinute) throw new WebError('rate_limited', 'Session web rate limit reached; no automatic retry');
      if (usage.active.length >= 2) throw new WebError('rate_limited', 'Two web requests are already in progress');
      this.orchestration.reserve(mode, context);
      usage[key]++; usage.recent.push(now); usage.active.push({ id: reservation, expires: now + config.timeoutMs }); this.repo.put('web_budget', usage);
    });
    return () => this.repo.transaction(() => { const usage = this.usage(); usage.active = usage.active.filter(r => r.id !== reservation); this.repo.put('web_budget', usage); });
  }
  private async deadline<T>(context: Context, config: WebConfiguration, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController(); const signal = AbortSignal.any([context.signal, controller.signal]);
    const timer = setTimeout(() => controller.abort(new WebError('timeout', 'Web operation deadline exceeded')), config.timeoutMs);
    let listener: () => void = () => {};
    try { return await Promise.race([action(signal), new Promise<never>((_, reject) => { listener = () => reject(signal.reason); if (signal.aborted) listener(); else signal.addEventListener('abort', listener, { once: true }); })]); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', listener); controller.abort(); }
  }
  private source(sourceId: string, policy: string, maxAge?: number): WebSource {
    const parsed = SourceSchema.safeParse(this.repo.get('web_source', sourceId));
    if (!parsed.success || parsed.data.sessionId !== this.sessionId) throw new WebError('source_unavailable', 'Source is unavailable in this session');
    const source = parsed.data;
    if (source.policy !== policy || source.hash !== sourceHash(source)) throw new WebError('source_unavailable', 'Source integrity or current policy validation failed');
    const c = this.config().orchestration; const age = c[source.freshnessClass === 'current' ? 'currentSeconds' : source.freshnessClass === 'stable' ? 'stableSeconds' : 'unknownSeconds'];
    if (this.now() < Date.parse(source.retrievedAt) || this.now() >= Date.parse(source.expiresAt) || this.now() - Date.parse(source.retrievedAt) >= Math.min(maxAge ?? Infinity, age) * 1000) throw new WebError('freshness_unmet', 'Source does not meet current freshness requirements');
    webUrl(source.url); webUrl(source.canonicalUrl); return source;
  }
  private cached(key: string, policy: string, maxAge?: number): Evidence | undefined {
    if (maxAge === 0) return undefined;
    const record = this.repo.get<CacheRecord>('web_cache', digest([this.sessionId, key])); if (!record) return undefined;
    if (record.sessionId !== this.sessionId || record.key !== key || record.hash !== digest({ key, sourceIds: record.sourceIds, retrievedAt: record.retrievedAt })) return undefined;
    if (this.now() - Date.parse(record.retrievedAt) >= this.config().cacheSeconds * 1000 || maxAge !== undefined && this.now() - Date.parse(record.retrievedAt) > maxAge * 1000) return undefined;
    try { return { schemaVersion: 1, sources: record.sourceIds.map(id => this.source(id, policy, maxAge)), cached: true, retrievedAt: record.retrievedAt, warnings: [], untrusted: true }; } catch { return undefined; }
  }
  private persist(key: string, sources: WebSource[], at: string): Evidence {
    this.repo.transaction(() => {
      const count = this.repo.db.prepare("SELECT count(*) AS n FROM entities WHERE kind='web_source' AND session_id=?").get(this.sessionId)!;
      if (Number(count.n) + sources.length > 200) throw new WebError('budget_exhausted', 'Session evidence capacity reached; start a new session');
      for (const source of sources) { SourceSchema.parse(source); this.repo.put('web_source', source); }
      const sourceIds = sources.map(s => s.id); const record: CacheRecord = { id: digest([this.sessionId, key]), sessionId: this.sessionId, key, sourceIds, retrievedAt: at, hash: digest({ key, sourceIds, retrievedAt: at }) };
      this.repo.put('web_cache', record);
    });
    return { schemaVersion: 1, sources, cached: false, retrievedAt: at, warnings: [], untrusted: true };
  }
  private makeSource(data: Omit<WebSource, 'id' | 'sessionId' | 'policy' | 'hash' | 'expiresAt' | 'untrusted'>, policy: string, config: WebConfiguration): WebSource {
    const canonicalUrl = this.safeText(data.canonicalUrl) === data.canonicalUrl ? data.canonicalUrl : data.url;
    const c = config.orchestration; const ttl = Math.min(config.cacheSeconds, c[data.freshnessClass === 'current' ? 'currentSeconds' : data.freshnessClass === 'stable' ? 'stableSeconds' : 'unknownSeconds']);
    const source = { ...data, canonicalUrl, title: this.safeText(data.title), text: this.safeText(data.text), mediaType: this.safeText(data.mediaType), provider: this.safeText(data.provider), id: randomUUID(), sessionId: this.sessionId, policy, expiresAt: new Date(this.now() + ttl * 1000).toISOString(), untrusted: true as const };
    return SourceSchema.parse({ ...source, hash: sourceHash(source) });
  }
  private freshness(text: string, context: Context, explicit = false, maxAge?: number, timeZone?: string): FreshnessDecision {
    const userFresh = /\b(fresh|live|up.to.date)\b/i.test(context.request ?? '');
    const decision = freshnessDecision(text + ' ' + (context.request ?? ''), this.config(), this.now(), timeZone ?? context.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, explicit || userFresh, maxAge);
    decision.forceLive = explicit || maxAge === 0; return decision;
  }
  diagnostics() { return this.orchestration.diagnostics(); }
  approveBudgetExtension(scopeId: string, searches: number, reads: number, reason: string): void { this.orchestration.approveExtension(scopeId, searches, reads, this.safeText(reason)); }
  private async shared(key: string, context: Context, load: (worker: Context) => Promise<Evidence>): Promise<{ result: Evidence; coalesced: boolean }> {
    let entry = this.pending.get(key); const coalesced = !!entry;
    if (!entry) {
      const controller = new AbortController(); const promise = Promise.resolve().then(() => load({ ...context, signal: controller.signal })).finally(() => { this.pending.delete(key); });
      entry = { controller, promise, waiters: 0 }; this.pending.set(key, entry);
    }
    entry.waiters++; let aborted: () => void = () => {};
    try { const result = await Promise.race([entry.promise, new Promise<never>((_, reject) => { aborted = () => reject(context.signal.reason); if (context.signal.aborted) aborted(); else context.signal.addEventListener('abort', aborted, { once: true }); })]); return { result, coalesced }; }
    finally { context.signal.removeEventListener('abort', aborted); entry.waiters--; if (!entry.waiters) entry.controller.abort(); }
  }
  private async retrieve(mode: 'search' | 'read', key: string, context: Context, policy: string, decision: FreshnessDecision, explicit: boolean, load: (worker: Context) => Promise<Evidence>): Promise<Evidence> {
    const config = this.config(); this.attempt(key, config); this.guard(context, policy);
    const previous = this.orchestration.scope(context).attempts[key];
    const userFresh = /\b(fresh|live|up.to.date)\b/i.test(context.request ?? '');
    const force = explicit || decision.forceLive || userFresh && !previous?.succeeded;
    this.orchestration.metric('freshness_decision', context, { key, category: decision.category, confidence: decision.confidence, maximumAgeSeconds: decision.maximumAgeSeconds, forceLive: force, date: decision.date, timeZone: decision.timeZone });
    const cached = this.cached(key, policy, decision.maximumAgeSeconds);
    if (cached && !force) {
      this.orchestration.metric('reuse', context, { key, cache: true, sourceIds: cached.sources.map(s => s.id) });
      return { ...cached, freshness: decision, feedback: { ...this.orchestration.complete(key, context, cached.sources, false), suppressed: true, reason: 'Equivalent retrieval reused fresh live-source snapshots; no provider request made' } };
    }
    this.orchestration.before(key, context);
    const loopSnapshot = force ? this.cached(key, policy) : cached;
    if (force && loopSnapshot && (previous?.noNew ?? 0) >= 2) {
      this.orchestration.metric('suppressed', context, { reason: 'no_new_evidence', key });
      throw new WebError('loop_prevented', 'Repeated refreshes returned identical evidence while snapshots are still fresh', { sourceIds: loopSnapshot.sources.map(s => s.id), retryAfter: loopSnapshot.sources.map(s => s.expiresAt).sort()[0] ?? null, suggestions: ['Read retained source sections', 'Wait until the freshness window expires', 'Change the query only to address a specific evidence gap'] });
    }
    try {
      const { result, coalesced } = await this.shared(key, context, async worker => {
        const release = this.reserve(mode, config, worker); const started = this.now();
        const estimatedCost = mode === 'search' ? config.provider?.estimatedCostPerSearch ?? null : null;
        try { const value = await load(worker); this.orchestration.metric('backend', worker, { operation: mode, outcome: 'ok', latencyMs: this.now() - started, estimatedCost }); return value; }
        catch (error) { this.orchestration.metric('backend', worker, { operation: mode, outcome: 'error', latencyMs: this.now() - started, estimatedCost }); throw error; }
        finally { release(); }
      });
      this.guard(context, policy);
      if (coalesced) this.orchestration.metric('reuse', context, { key, cache: false, coalesced: true, sourceIds: result.sources.map(s => s.id) });
      return { ...result, coalesced, freshness: decision, feedback: this.orchestration.complete(key, context, result.sources, !coalesced) };
    } catch (error) { if (!(error instanceof WebError && ['budget_exhausted', 'rate_limited', 'permission_denied', 'policy_changed'].includes(error.code))) this.orchestration.complete(key, context); throw error; }
  }
  private async search(value: unknown, context: Context, policy: string): Promise<Evidence> {
    const input = parseInput(SearchInput, value); input.query = normalizeQuery(input.query); input.domains = [...new Set(input.domains.map(d => d.toLowerCase()))].sort();
    if (this.safeText(input.query) !== input.query) throw new WebError('sensitive_input', 'Query contains a detected credential');
    const config = this.config(); const preflightKey = digest({ policy, query: input.query, domains: input.domains, region: input.region, dateRange: input.dateRange, intent: input.intent });
    let provider;
    try { if (!config.provider) throw new WebError('provider_unavailable', 'No search provider configured'); provider = this.providers.create(config.provider, this.transport); }
    catch (error) { this.attempt(preflightKey, config); this.orchestration.before(preflightKey, context); this.orchestration.complete(preflightKey, context); throw error; }
    if (input.freshness !== 'any' && !provider.capabilities.freshness || input.language && !provider.capabilities.language || input.region && !provider.capabilities.region || input.dateRange && !provider.capabilities.dateRange) throw new WebError('unsupported_option', 'Search provider does not support the requested option');
    const decision = this.freshness(input.query, context, input.fresh, input.maxAgeSeconds, input.timeZone); const semantic = canonicalSearch(input, decision);
    input.query = semantic.query; input.region = semantic.region;
    const { query: outgoingQuery, ...identity } = semantic; void outgoingQuery;
    const key = digest({ policy, mode: 'search', provider: [provider.id, provider.version], ...identity });
    return this.retrieve('search', key, context, policy, decision, input.fresh, async worker => {
      const raw = await this.deadline(worker, config, signal => provider.search(input, signal)); this.guard(worker, policy);
      const parsed = ProviderResults.safeParse(raw); if (!parsed.success) throw new WebError('invalid_response', 'Search provider returned invalid normalized results');
      const seen = new Set<string>(); const at = new Date(this.now()).toISOString(); const sources: WebSource[] = [];
      for (const result of parsed.data) {
        let url: URL; try { url = webUrl(result.url); } catch { continue; }
        if (this.safeText(url.href) !== url.href || seen.has(url.href) || input.domains.length && !input.domains.some(d => url.hostname === d || url.hostname.endsWith('.' + d))) continue;
        seen.add(url.href);
        sources.push(this.makeSource({ kind: 'snippet', url: url.href, canonicalUrl: url.href, title: snippetText(result.title).slice(0, 1000), text: snippetText(result.snippet), retrievedAt: at, provider: provider.id, mediaType: 'text/plain', freshnessClass: decision.category, truncated: result.snippet.length > 1500, warnings: ['Search snippet only; page has not been read', ...(input.freshness !== 'any' ? ['Publication time filter is provider-dependent; source dates are unverified'] : [])] }, policy, config));
        if (sources.length >= input.count) break;
      }
      return this.persist(key, sources, at);
    });
  }
  private async read(value: unknown, context: Context, policy: string): Promise<Evidence> {
    const input = parseInput(ReadInput, value); const config = this.config();
    if (!config.allowPublicRead) throw new WebError('permission_denied', 'Human must enable public reads in research.json');
    const url = webUrl(input.url); if (this.safeText(url.href) !== url.href) throw new WebError('sensitive_input', 'URL contains a detected credential');
    const decision = this.freshness(input.focus ?? url.pathname, context, input.fresh, input.maxAgeSeconds); const key = digest({ policy, mode: 'read', url: url.href, category: decision.category, date: decision.category === 'stable' ? undefined : decision.date, timeZone: decision.timeZone });
    return this.retrieve('read', key, context, policy, decision, input.fresh, async worker => {
      const response = await this.deadline(worker, config, signal => this.transport(url, signal)); this.guard(worker, policy);
      const page = extractPage(response.body, response.headers['content-type'] ?? '', url); const at = new Date(this.now()).toISOString();
      return this.persist(key, [this.makeSource({ ...page, kind: 'page', url: url.href, retrievedAt: at, provider: 'direct-http', freshnessClass: decision.category }, policy, config)], at);
    });
  }
  private async research(value: unknown, context: Context, policy: string) {
    const input = parseInput(ResearchInput, value); const sources = new Map<string, WebSource>(); const errors: { operation: string; code: string; feedback?: Record<string, unknown> }[] = [];
    const queries = new Map(input.queries.map(q => [digest({ ...q, query: normalizeQuery(q.query), domains: [...new Set(q.domains.map(d => d.toLowerCase()))].sort() }), q]));
    for (const query of queries.values()) {
      try { for (const source of (await this.search(query, context, policy)).sources) if (!sources.has(source.url)) sources.set(source.url, source); }
      catch (error) { this.guard(context, policy); errors.push({ operation: 'search', code: error instanceof WebError ? error.code : 'provider_error', ...(error instanceof WebError ? { feedback: error.feedback } : {}) }); }
    }
    const urls = [...new Set([...input.urls, ...sources.keys()].map(raw => { try { return webUrl(raw).href; } catch { return raw; } }))].slice(0, input.maxReads);
    for (const url of urls) {
      try { for (const source of (await this.read({ url }, context, policy)).sources) sources.set(source.url, source); }
      catch (error) { this.guard(context, policy); errors.push({ operation: 'read', code: error instanceof WebError ? error.code : 'provider_error', ...(error instanceof WebError ? { feedback: error.feedback } : {}) }); }
    }
    // Aggregate text capped separately from per-page limits. No synthesized conclusion.
    const evidence = [...sources.values()].slice(0, 20).map(source => { const part = this.orchestration.excerpt(source, context, input.queries.map(q => q.query).join(' ')); return { sourceId: source.id, url: source.url, title: source.title, text: part.text, kind: source.kind, hash: source.hash, retrievedAt: source.retrievedAt, expiresAt: source.expiresAt, truncated: source.truncated, locator: part.locator, totalChars: part.totalChars, nextStart: part.nextStart, contentOmitted: part.contentOmitted, freshnessClass: source.freshnessClass }; });
    const scope = this.orchestration.scope(context);
    return { schemaVersion: 1, retrievedAt: new Date(this.now()).toISOString(), outcome: errors.length ? 'partial' : 'ok', evidence, errors, potentialConflicts: scope.conflicts, untrusted: true, conclusion: null };
  }
  private verify(value: unknown, policy: string) {
    const input = parseInput(VerifyInput, value);
    if (this.safeText(input.claim.text) !== input.claim.text || input.claim.counterText && this.safeText(input.claim.counterText) !== input.claim.counterText) throw new WebError('sensitive_input', 'Claim contains a detected credential');
    if (input.claim.counterText === input.claim.text) throw new WebError('invalid_input', 'Counter-text must differ from claim text');
    const evidence = [...new Set(input.sourceIds)].map(sourceId => {
      try {
        const source = this.source(sourceId, policy); const start = source.text.indexOf(input.claim.text); const counter = input.claim.counterText ? source.text.indexOf(input.claim.counterText) : -1;
        // Text claims deliberately remain insufficient: presence is not independent truth verification.
        const status = input.claim.kind === 'quote' && source.kind === 'page' && start >= 0 && counter < 0 ? 'supporting' : input.claim.kind === 'quote' && source.kind === 'page' && counter >= 0 && start < 0 ? 'contradicting' : 'insufficient';
        const offset = status === 'supporting' ? start : status === 'contradicting' ? counter : -1; const length = status === 'contradicting' ? input.claim.counterText!.length : input.claim.text.length;
        return { sourceId, status, literalMatch: start >= 0, counterMatch: counter >= 0, locator: offset >= 0 ? { start: offset, end: offset + length } : null, hash: source.hash };
      } catch { return { sourceId, status: 'insufficient', reason: 'Source unavailable, stale or failed integrity checks' }; }
    });
    return { method: 'literal_snapshot_check', scope: 'Quotation occurrence only; counterText is caller-specified contrary text. No factual or semantic verification.', claim: input.claim, evidence, independentlyVerified: false, usedLLM: false };
  }
  private cache(value: unknown, policy: string, context: Context) {
    const input = parseInput(CacheInput, value);
    if (input.action === 'get') {
      if (!input.sourceId) throw new WebError('invalid_input', 'get requires sourceId'); const source = this.source(input.sourceId, policy, input.maxAgeSeconds);
      const section = this.orchestration.excerpt(source, context, '', input.start, input.length, input.includePreviouslySeen);
      this.orchestration.metric(section.contentOmitted ? 'reuse' : 'cache_access', context, { cache: true, sourceId: source.id, section: section.locator }); return { source: section };
    }
    return { sources: this.repo.list<WebSource>('web_source', this.sessionId).flatMap(s => { try { const valid = this.source(s.id, policy, input.maxAgeSeconds); return [{ sourceId: valid.id, url: valid.url, title: valid.title, kind: valid.kind, hash: valid.hash, retrievedAt: valid.retrievedAt, expiresAt: valid.expiresAt, characters: valid.text.length }]; } catch { return []; } }).slice(-50) };
  }
  async execute(operation: 'search' | 'read' | 'research' | 'verify' | 'cache', input: unknown, context: Context): Promise<unknown> {
    const started = this.now();
    try {
      const policy = this.identity();
      this.guard(context, policy);
      if (operation === 'verify' && this.safeText(JSON.stringify(input)) !== JSON.stringify(input)) throw new WebError('sensitive_input', 'Verification input contains a detected credential');
      let result: unknown;
      if (operation === 'search') result = await this.search(input, context, policy);
      else if (operation === 'read') result = await this.read(input, context, policy);
      else if (operation === 'research') result = await this.deadline(context, this.config(), signal => this.research(input, { ...context, signal }, policy));
      else if (operation === 'verify') result = input && typeof input === 'object' && 'contractId' in input ? this.verification.verify(parseInput(StructuredVerificationInput, input), context.agentId ?? 'runtime') : this.verify(input, policy);
      else result = this.cache(input, policy, context);
      if ((operation === 'search' || operation === 'read') && result && typeof result === 'object' && 'sources' in result) {
        const evidence = result as Evidence; const args = input as { query?: string; focus?: string };
        result = { ...evidence, sources: evidence.sources.map(s => this.orchestration.excerpt(s, context, args.focus ?? args.query ?? context.request ?? '')), observation: 'live_source_snapshot; retrieval time is not publication time', observedAt: evidence.retrievedAt, cacheAgeSeconds: Math.max(0, (this.now() - Date.parse(evidence.retrievedAt)) / 1000) };
      }
      this.guard(context, policy);
      const encoded = redact(JSON.stringify(result)); if (Buffer.byteLength(encoded) > 100000) throw new WebError('response_too_large', 'Web tool result exceeds context limit');
      this.repo.event(this.sessionId, 'web_operation', { operation, outcome: 'ok', durationMs: this.now() - started });
      return JSON.parse(encoded) as unknown;
    } catch (error) {
      const safe = error instanceof WebError ? error : context.signal.aborted ? new WebError('cancelled', 'Web operation cancelled') : new WebError('provider_error', 'Web operation failed; no automatic retry');
      this.repo.event(this.sessionId, 'web_operation', { operation, outcome: safe.code, durationMs: this.now() - started }); throw safe;
    }
  }
}
