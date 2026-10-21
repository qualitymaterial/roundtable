import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Repository } from './storage.js';
import { id, timestamp, redact } from './domain.js';
import { digest, WebError, type WebSource } from './web-types.js';
import { webUrl } from './web-http.js';

const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);
const scalar = z.union([z.string().max(2000), z.number().finite()]);
const records = z.array(z.record(key, scalar).refine(v => Object.keys(v).length <= 20)).max(100).refine(v => Buffer.byteLength(JSON.stringify(v)) <= 64000, 'Records exceed 64 KiB');
const Field = z.object({ type: z.enum(['identifier', 'name', 'text', 'date', 'time', 'number', 'count']), aliases: z.record(z.string().min(1).max(200), z.array(z.string().min(1).max(200)).max(30)).default({}) }).strict();
export const EvidenceCriteria = z.object({
  taskId: z.string().optional(), description: z.string().min(1).max(2000),
  allowedHosts: z.array(z.string().regex(/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/)).min(1).max(10),
  sourceUrls: z.array(z.url().max(2000)).max(10).optional(),
  maxAgeSeconds: z.number().int().min(1).max(86400).default(60), minimumSources: z.number().int().min(1).max(10).default(1),
  recordsKey: key.optional(), fields: z.record(key, Field).refine(v => Object.keys(v).length > 0 && Object.keys(v).length <= 20),
  identity: z.array(key).min(1).max(5), expectedRecords: records.optional(), requiredValues: z.record(key, scalar).default({}),
  aggregates: z.array(z.object({ name: key, operation: z.enum(['count', 'sum']), field: key.optional() }).strict()).max(10).default([]),
  maxAttempts: z.number().int().min(1).max(20).default(5),
}).strict().refine(v => Buffer.byteLength(JSON.stringify(v)) <= 64000, 'Criteria exceed 64 KiB');
export const StructuredVerificationInput = z.object({
  contractId: z.uuid(), claim: z.object({ text: z.string().min(1).max(2000), records, totals: z.record(key, z.number().finite()).default({}) }).strict(),
  citations: z.array(z.object({ sourceId: z.uuid(), start: z.number().int().min(0).max(64000).optional(), end: z.number().int().min(1).max(64000).optional(), quote: z.string().min(1).max(4000).optional() }).strict()).min(1).max(10),
}).strict();
type Criteria = z.output<typeof EvidenceCriteria>;
export type VerificationContract = Criteria & { id: string; sessionId: string; createdAt: string; criteriaHash: string; active: boolean; createdBy: 'human' };
export type VerificationState = 'confirmed' | 'contradicted' | 'insufficient_evidence' | 'verification_error';
export type EvidenceRecord = { id: string; sessionId: string; contractId: string; claimId: string; sourceId: string; url: string; canonicalUrl: string; retrievedAt: string; expiresAt: string; sourceHash: string; contentHash: string; passages: { start: number; end: number; text: string }[]; untrusted: true; hash: string };
type Issue = { code: string; detail: string; sourceId?: string; record?: string; field?: string; expected?: unknown; actual?: unknown; evidenceId?: string };
export type VerificationResult = { id: string; sessionId: string; contractId: string; criteriaHash: string; claimHash: string; author: string; state: VerificationState; method: 'deterministic_records_v1'; usedLLM: false; independentlyVerified: false; scope: string; createdAt: string; evidenceIds: string[]; issues: Issue[]; feedback: { retryAllowed: boolean; attemptsRemaining: number; action: string }; progress: { supportingSources: number; discrepancies: number; unchangedCorrections: number }; fingerprint: string; hash: string };
type Claim = { id: string; sessionId: string; contractId: string; author: string; input: z.output<typeof StructuredVerificationInput>; createdAt: string; hash: string };
type Row = Record<string, string | number>;
const contentHash = (text: string) => createHash('sha256').update(text).digest('hex');
function decimalIdentity(value: string): string {
  const [mantissa, exponent] = value.toLowerCase().split('e'); const fraction = mantissa!.split('.')[1]?.length ?? 0; let scale = fraction - Number(exponent ?? 0); let integer = BigInt(mantissa!.replace('.', '').replace(/^\+/, ''));
  if (integer === 0n) return '0';
  while (integer % 10n === 0n) { integer /= 10n; scale--; }
  return integer + ':' + scale;
}
function decimalSum(values: number[]): number {
  const parts = values.map(value => { const [mantissa, exponent] = String(value).split('e'); const fraction = mantissa!.split('.')[1]?.length ?? 0; const scale = fraction - Number(exponent ?? 0); return { integer: BigInt(mantissa!.replace('.', '')) * 10n ** BigInt(Math.max(0, -scale)), scale: Math.max(0, scale) }; });
  const scale = Math.max(0, ...parts.map(p => p.scale)); const sum = parts.reduce((n, p) => n + p.integer * 10n ** BigInt(scale - p.scale), 0n);
  const negative = sum < 0; const digits = (negative ? -sum : sum).toString().padStart(scale + 1, '0');
  const exact = (negative ? '-' : '') + (scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits); const result = Number(exact);
  if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER || decimalIdentity(exact) !== decimalIdentity(String(result))) throw new Error('Aggregate exceeds supported exact decimal precision');
  return result;
}
const name = (s: string) => s.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
function normalize(value: string | number, field: z.output<typeof Field>): string | number {
  if (field.type === 'number' || field.type === 'count') {
    if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) throw new Error('Expected an unambiguous decimal number');
    const n = Number(value); if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER || field.type === 'count' && (!Number.isSafeInteger(n) || n < 0)) throw new Error('Invalid number or count'); if (decimalIdentity(String(value).trim()) !== decimalIdentity(String(n))) throw new Error('Decimal exceeds supported exact precision'); return n;
  }
  if (typeof value !== 'string') throw new Error('Expected a string');
  const s = value.normalize('NFC').trim();
  if (!s && ['identifier', 'name'].includes(field.type)) throw new Error('Identifiers and names cannot be empty');
  if (field.type === 'date') { if (!z.iso.date().safeParse(s).success) throw new Error('Dates require YYYY-MM-DD'); return s; }
  if (field.type === 'time') {
    // A timestamp must carry its own offset. Bare local times never imply a timezone.
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { if (!z.iso.datetime({ offset: true }).safeParse(s).success) throw new Error('Invalid offset timestamp'); return new Date(s).toISOString(); }
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(s)) throw new Error('Times require HH:mm[:ss] or an ISO offset timestamp'); return s.length === 5 ? s + ':00' : s;
  }
  if (field.type !== 'name') return s; // Identifiers remain case-sensitive; punctuation is never discarded.
  const folded = name(s);
  for (const [canonical, aliases] of Object.entries(field.aliases)) if ([canonical, ...aliases].some(a => name(a) === folded)) return name(canonical);
  return folded;
}
function normalizedRows(raw: unknown, criteria: Criteria): { rows: Map<string, Row>; duplicates: number } {
  const parsed = records.parse(raw); const rows = new Map<string, Row>(); let duplicates = 0;
  for (const row of parsed) {
    const normalized: Row = {};
    for (const [field, spec] of Object.entries(criteria.fields)) { const value = row[field]; if (value === undefined) throw new Error('Missing required field: ' + field); normalized[field] = normalize(value, spec); }
    const identity = JSON.stringify(criteria.identity.map(k => normalized[k]));
    const existing = rows.get(identity);
    if (existing) { if (digest(existing) !== digest(normalized)) throw new Error('Conflicting duplicate identity: ' + identity); duplicates++; }
    else rows.set(identity, normalized);
  }
  return { rows, duplicates };
}
function differences(expected: Map<string, Row>, actual: Map<string, Row>): Issue[] {
  const issues: Issue[] = [];
  for (const [identity, row] of expected) {
    const other = actual.get(identity);
    if (!other) { issues.push({ code: 'missing_record', record: identity, detail: 'Expected identity is absent', expected: row }); continue; }
    for (const [field, value] of Object.entries(row)) if (other[field] !== value) issues.push({ code: 'field_mismatch', record: identity, field, expected: value, actual: other[field], detail: 'Normalized field values differ' });
  }
  for (const [identity, row] of actual) if (!expected.has(identity)) issues.push({ code: 'unexpected_record', record: identity, actual: row, detail: 'Additional identity is present' });
  return issues;
}
function criteriaHash(c: Criteria): string { return digest(c); }
function withoutHash<T extends { hash: string }>(value: T): Omit<T, 'hash'> { const { hash: _hash, ...rest } = value; void _hash; return rest; }

/** Runtime-owned records; no LLM verdict, network request, arbitrary code or agent-writable criteria. */
export class EvidenceVerifier {
  constructor(readonly repo: Repository, readonly sessionId: string, private readonly source: (id: string, maxAge: number) => WebSource, private readonly now: () => number = Date.now) {}
  /** Human host API only. Deliberately not exposed through any model tool. */
  require(input: unknown): VerificationContract {
    const c = EvidenceCriteria.parse(input);
    if (redact(JSON.stringify(c)) !== JSON.stringify(c)) throw new WebError('sensitive_input', 'Criteria contain a detected credential');
    for (const k of c.identity) if (!Object.hasOwn(c.fields, k)) throw new Error('Identity fields must be declared');
    for (const [k, value] of Object.entries(c.requiredValues)) { if (!Object.hasOwn(c.fields, k)) throw new Error('Required values need declared fields'); normalize(value, c.fields[k]!); }
    if (new Set(c.identity).size !== c.identity.length || new Set(c.aggregates.map(a => a.name)).size !== c.aggregates.length) throw new Error('Duplicate identity or aggregate name');
    for (const a of c.aggregates) if (a.operation === 'sum' && (!a.field || !['number', 'count'].includes(c.fields[a.field]?.type ?? ''))) throw new Error('Sums require a numeric field');
    for (const spec of Object.values(c.fields)) {
      if (spec.type !== 'name' && Object.keys(spec.aliases).length) throw new Error('Aliases apply only to names');
      const seen = new Set<string>();
      for (const [canonical, aliases] of Object.entries(spec.aliases)) for (const alias of new Set([canonical, ...aliases].map(name))) { if (!alias || seen.has(alias)) throw new Error('Ambiguous or empty name aliases'); seen.add(alias); }
    }
    if (c.sourceUrls) for (const url of c.sourceUrls) if (!c.allowedHosts.includes(webUrl(url).hostname)) throw new Error('Source URL must use an allowed host');
    if (c.expectedRecords) normalizedRows(c.expectedRecords, c);
    if (c.taskId) { const task = this.repo.get<{ sessionId: string; state: string }>('task', c.taskId); if (task?.sessionId !== this.sessionId || ['done', 'cancelled'].includes(task.state)) throw new Error('Choose an unfinished session task'); }
    if (this.repo.list('verification_contract', this.sessionId).length >= 100) throw new Error('Session verification contract capacity reached');
    const contract: VerificationContract = { ...c, id: id(), sessionId: this.sessionId, createdAt: timestamp(), criteriaHash: criteriaHash(c), active: true, createdBy: 'human' };
    this.repo.put('verification_contract', contract); this.repo.event(this.sessionId, 'human_evidence_criteria', { contractId: contract.id, criteriaHash: contract.criteriaHash }); return contract;
  }
  private contract(contractId: string): VerificationContract {
    const c = this.repo.get<VerificationContract>('verification_contract', contractId);
    if (!c?.active || c.sessionId !== this.sessionId || c.createdBy !== 'human') throw new WebError('criteria_unavailable', 'Unknown active protected criteria');
    const parsed = EvidenceCriteria.parse(Object.fromEntries(Object.keys(EvidenceCriteria.shape).filter(k => Object.hasOwn(c, k)).map(k => [k, c[k as keyof VerificationContract]])));
    if (criteriaHash(parsed) !== c.criteriaHash || !this.repo.events(this.sessionId).some(e => e.type === 'human_evidence_criteria' && (e.data as { contractId: string; criteriaHash: string }).contractId === c.id && (e.data as { criteriaHash: string }).criteriaHash === c.criteriaHash)) throw new WebError('criteria_integrity', 'Protected criteria integrity check failed');
    return c;
  }
  contracts(taskId?: string) { return this.repo.list<VerificationContract>('verification_contract', this.sessionId).filter(c => c.active && (!taskId || c.taskId === taskId)); }
  /** Human-only removal retains every criterion, claim and evidence record. */
  drop(contractId: string, reason: string): void {
    if (!reason.trim() || reason.length > 2000) throw new Error('Provide a removal reason up to 2000 characters');
    const c = this.contract(contractId); c.active = false; this.repo.put('verification_contract', c); this.repo.event(this.sessionId, 'human_evidence_criteria_removed', { contractId, reason: redact(reason) });
  }
  verify(value: unknown, author: string): VerificationResult {
    return this.repo.transaction(() => this.verifyOnce(value, author));
  }
  private verifyOnce(value: unknown, author: string): VerificationResult {
    const input = StructuredVerificationInput.parse(value);
    if (redact(JSON.stringify(input)) !== JSON.stringify(input)) throw new WebError('sensitive_input', 'Verification input contains a detected credential');
    const c = this.contract(input.contractId);
    const count = (kind: string) => Number(this.repo.db.prepare('SELECT count(*) AS n FROM entities WHERE kind=? AND session_id=?').get(kind, this.sessionId)!.n);
    if (count('verified_claim') >= 200 || count('verification_evidence') + input.citations.length > 1000) throw new WebError('verification_capacity', 'Session verification storage budget exhausted; preserve evidence and begin a new session');
    const previous = this.repo.list<VerificationResult>('claim_verdict', this.sessionId).filter(v => v.contractId === c.id);
    const last = previous.at(-1);
    if (previous.length >= c.maxAttempts || last?.feedback.retryAllowed === false && last.state !== 'confirmed') throw new WebError('verification_stopped', 'Verification recovery stopped', { action: 'Resolve the evidence gap with the human; only the host can establish new criteria or a new attempt budget', attemptsRemaining: Math.max(0, c.maxAttempts - previous.length) });
    const claimId = id(); const createdAt = new Date(this.now()).toISOString();
    const claimBody = { id: claimId, sessionId: this.sessionId, contractId: c.id, author, input, createdAt };
    const retainedClaim: Claim = { ...claimBody, hash: digest(claimBody) }; this.repo.put('verified_claim', retainedClaim);
    const issues: Issue[] = []; const evidenceIds: string[] = []; const sourceFingerprints: string[] = [];
    let invalid = false; let unavailable = false; let supports = 0; let contradicts = 0; const origins = new Set<string>(); const seenSources = new Set<string>();
    let claimed: ReturnType<typeof normalizedRows> | undefined;
    try {
      claimed = normalizedRows(input.claim.records, c);
      if (input.claim.records.some(r => Object.keys(r).some(k => !Object.hasOwn(c.fields, k)) || Object.keys(r).length !== Object.keys(c.fields).length)) throw new Error('Claim records must contain exactly the protected fields');
      if (claimed.duplicates) issues.push({ code: 'duplicate_claim_records', detail: `${claimed.duplicates} identical claim duplicates excluded from comparison` });
      for (const [field, value] of Object.entries(c.requiredValues)) for (const [record, row] of claimed.rows) { const expected = normalize(value, c.fields[field]!); if (row[field] !== expected) issues.push({ code: 'acceptance_required_value', field, record, expected, actual: row[field], detail: 'Claim violates a protected required field value' }); }
      if (c.expectedRecords) issues.push(...differences(normalizedRows(c.expectedRecords, c).rows, claimed.rows).map(i => ({ ...i, code: 'acceptance_' + i.code })));
      if (Object.keys(input.claim.totals).length !== c.aggregates.length || c.aggregates.some(a => !Object.hasOwn(input.claim.totals, a.name))) throw new Error('Supply exactly the protected aggregate names');
    } catch (error) { invalid = true; issues.push({ code: 'invalid_claim_records', detail: redact(String(error)).slice(0, 400) }); }
    for (const citation of input.citations) {
      if (seenSources.has(citation.sourceId)) { issues.push({ code: 'duplicate_citation', sourceId: citation.sourceId, detail: 'Duplicate source does not add independent evidence' }); continue; } seenSources.add(citation.sourceId);
      let source: WebSource;
      try { source = this.source(citation.sourceId, c.maxAgeSeconds); }
      catch (error) { unavailable = true; const code = error instanceof WebError ? error.code : 'source_unavailable'; issues.push({ code, sourceId: citation.sourceId, detail: 'Retrieve a current source in this session; missing, stale or invalid evidence cannot confirm a claim' }); continue; }
      sourceFingerprints.push(digest([source.canonicalUrl, source.text]));
      const url = webUrl(source.url); const canonical = webUrl(source.canonicalUrl);
      if (source.kind !== 'page' || source.truncated || !c.allowedHosts.includes(url.hostname) || !c.allowedHosts.includes(canonical.hostname) || c.sourceUrls && !c.sourceUrls.some(u => webUrl(u).href === canonical.href)) { unavailable = true; issues.push({ code: 'ineligible_source', sourceId: source.id, detail: 'Use an untruncated page from the protected source scope; snippets are not factual evidence' }); continue; }
      const start = citation.start ?? 0; const end = citation.end ?? source.text.length;
      if (start >= end || end > source.text.length || citation.quote !== undefined && source.text.slice(start, end) !== citation.quote) { unavailable = true; issues.push({ code: 'citation_mismatch', sourceId: source.id, detail: 'Citation offsets and quotation must match the exact retained passage' }); continue; }
      if (start !== 0 || end !== source.text.length) { unavailable = true; issues.push({ code: 'partial_citation', sourceId: source.id, detail: 'Structured comparison requires the complete retained JSON document; partial quotations establish occurrence only' }); continue; }
      const evidenceBody = { id: id(), sessionId: this.sessionId, contractId: c.id, claimId, sourceId: source.id, url: source.url, canonicalUrl: source.canonicalUrl, retrievedAt: source.retrievedAt, expiresAt: source.expiresAt, sourceHash: source.hash, contentHash: contentHash(source.text), passages: [{ start: 0, end: source.text.length, text: source.text }], untrusted: true as const };
      const evidence: EvidenceRecord = { ...evidenceBody, hash: digest(evidenceBody) }; this.repo.put('verification_evidence', evidence); evidenceIds.push(evidence.id);
      try {
        const parsed: unknown = JSON.parse(source.text, (_key: string, value: unknown, context?: { source: string }) => {
          if (typeof value === 'number' && context?.source && (!Number.isFinite(value) || decimalIdentity(context.source) !== decimalIdentity(String(value)))) throw new Error('Source number loses decimal precision');
          return value;
        }); // No eval, prompts, model parsing or instruction following.
        const raw = c.recordsKey ? parsed && typeof parsed === 'object' && Object.hasOwn(parsed, c.recordsKey) ? (parsed as Record<string, unknown>)[c.recordsKey] : undefined : parsed;
        const observed = normalizedRows(raw, c);
        if (observed.duplicates) issues.push({ code: 'duplicate_records', sourceId: source.id, evidenceId: evidence.id, detail: `${observed.duplicates} identical duplicate records excluded from counts and totals` });
        const deltas = claimed ? differences(claimed.rows, observed.rows) : [];
        for (const a of c.aggregates) {
          const actual = a.operation === 'count' ? observed.rows.size : decimalSum([...observed.rows.values()].map(row => Number(row[a.field!])));
          if (!Number.isFinite(actual)) throw new Error('Aggregate is not finite');
          if (input.claim.totals[a.name] !== actual) deltas.push({ code: 'aggregate_mismatch', field: a.name, expected: input.claim.totals[a.name], actual, detail: 'Claim total differs from unique source records' });
        }
        issues.push(...deltas.map(i => ({ ...i, sourceId: source.id, evidenceId: evidence.id })));
        if (deltas.length) contradicts++; else if (claimed && !invalid) { supports++; origins.add(canonical.origin); }
      } catch { unavailable = true; issues.push({ code: 'unsupported_source_records', sourceId: source.id, evidenceId: evidence.id, detail: 'Source must contain valid JSON records matching the protected schema; prose and keyword matches are insufficient' }); }
    }
    const acceptanceMismatch = issues.some(i => i.code.startsWith('acceptance_'));
    const state: VerificationState = invalid ? 'verification_error' : supports && contradicts ? 'insufficient_evidence' : contradicts || acceptanceMismatch ? 'contradicted' : unavailable || origins.size < c.minimumSources ? 'insufficient_evidence' : 'confirmed';
    if (supports && contradicts) issues.push({ code: 'conflicting_sources', detail: 'Cited sources disagree; reconcile the discrepancy, without treating a majority as proof' });
    if (origins.size < c.minimumSources) issues.push({ code: 'insufficient_sources', detail: `Need ${c.minimumSources} distinct permitted origins with consistent records; have ${origins.size}` });
    // Content-based, independent of generated text, source/claim IDs and retrieval timestamps.
    const fingerprint = digest({ records: claimed ? [...claimed.rows].sort(([a], [b]) => a.localeCompare(b)) : input.claim.records, totals: input.claim.totals, sources: sourceFingerprints.sort(), issues: issues.map(({ code, record, field, expected, actual }) => ({ code, record, field, expected, actual })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) });
    const noProgress = last?.fingerprint === fingerprint && last.state !== 'confirmed';
    const discrepancies = issues.filter(i => !['duplicate_records', 'duplicate_claim_records', 'duplicate_citation'].includes(i.code)).length;
    const unchangedCorrections = last && last.state !== 'confirmed' && supports <= last.progress.supportingSources && discrepancies >= last.progress.discrepancies ? last.progress.unchangedCorrections + 1 : 0;
    const stop = noProgress || unchangedCorrections >= 2;
    const remaining = Math.max(0, c.maxAttempts - previous.length - 1);
    const compact = (value: unknown) => value === undefined || typeof value === 'number' ? value : (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 500);
    const boundedIssues = issues.slice(0, 30).map(i => ({ ...i, expected: compact(i.expected), actual: compact(i.actual) }));
    if (issues.length > 30) boundedIssues.push({ code: 'additional_discrepancies', detail: `${issues.length - 30} additional discrepancies; inspect stored source passages`, expected: undefined, actual: undefined });
    const body: Omit<VerificationResult, 'hash'> = { id: claimId, sessionId: this.sessionId, contractId: c.id, criteriaHash: c.criteriaHash, claimHash: digest(input.claim), author, state, method: 'deterministic_records_v1', usedLLM: false, independentlyVerified: false, scope: 'Record agreement with cited snapshots under human criteria; not independent publisher truth or prose validation', createdAt, evidenceIds, issues: boundedIssues, feedback: { retryAllowed: remaining > 0 && !stop, attemptsRemaining: remaining, action: state === 'confirmed' ? 'Use the structured records and source handles; confirmation does not validate additional prose' : stop ? 'Stop: repeated corrections are not improving records or evidence' : 'Inspect discrepancies; correct records or retrieve eligible fresh evidence before retrying' }, progress: { supportingSources: supports, discrepancies, unchangedCorrections }, fingerprint };
    const result = { ...body, hash: digest(body) }; this.repo.put('claim_verdict', result); this.repo.event(this.sessionId, 'evidence_verification', { verificationId: result.id, contractId: c.id, state, evidenceIds }); return result;
  }
  status(contractId: string): { contractId: string; passed: boolean; state: VerificationState; verificationId?: string; detail: string } {
    try {
      const c = this.contract(contractId); const v = this.repo.list<VerificationResult>('claim_verdict', this.sessionId).filter(v => v.contractId === c.id).at(-1);
      if (!v) return { contractId, passed: false, state: 'insufficient_evidence', detail: 'Submit structured records and citations for these criteria' };
      if (v.hash !== digest(withoutHash(v)) || v.criteriaHash !== c.criteriaHash || v.method !== 'deterministic_records_v1' || v.usedLLM !== false) throw new Error('Verdict integrity check failed');
      const claim = this.repo.get<Claim>('verified_claim', v.id);
      if (!claim || claim.sessionId !== this.sessionId || claim.hash !== digest(withoutHash(claim)) || digest(claim.input.claim) !== v.claimHash) throw new Error('Claim integrity check failed');
      for (const evidenceId of v.evidenceIds) {
        const e = this.repo.get<EvidenceRecord>('verification_evidence', evidenceId);
        if (!e || e.sessionId !== this.sessionId || e.claimId !== v.id || e.hash !== digest(withoutHash(e))) throw new Error('Evidence integrity check failed');
        const s = this.source(e.sourceId, c.maxAgeSeconds);
        if (s.hash !== e.sourceHash || contentHash(s.text) !== e.contentHash || e.passages.some(p => s.text.slice(p.start, p.end) !== p.text)) throw new Error('Source snapshot changed');
      }
      return { contractId, passed: v.state === 'confirmed', state: v.state, verificationId: v.id, detail: v.scope };
    } catch (error) { return { contractId, passed: false, state: 'verification_error', detail: error instanceof WebError ? error.message : 'Verification integrity check failed' }; }
  }
  validateReceipt(result: unknown): void {
    if (!result || typeof result !== 'object' || !('method' in result) || result.method !== 'deterministic_records_v1') return;
    const v = result as VerificationResult; const current = this.status(v.contractId);
    if (current.verificationId !== v.id || current.state !== v.state || v.state === 'confirmed' && !current.passed) throw new WebError('verification_expired', 'Verification receipt is stale or superseded; inspect current criteria status');
  }
}
