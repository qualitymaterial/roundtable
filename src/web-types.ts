import { z } from 'zod';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export class WebError extends Error {
  constructor(readonly code: string, message: string, readonly feedback?: Record<string, unknown>) { super(message); this.name = 'WebError'; }
}
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function normalizeQuery(query: string): string {
  let result = ''; let quote = ''; let escaped = false; let space = false;
  for (const character of query.trim()) {
    if (quote) {
      result += character;
      if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === quote) quote = '';
    } else if (/\s/u.test(character)) space = true;
    else {
      if (space && result) result += ' '; space = false; result += character;
      if (character === '"' || character === "'") quote = character;
    }
  }
  return result;
}
export const WebConfig = z.object({
  enabled: z.boolean().default(false), allowPublicRead: z.boolean().default(false),
  provider: z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), adapter: z.string().min(1).max(64), endpoint: z.url().optional(), tokenEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(), allowPrivateEndpoint: z.boolean().default(false), estimatedCostPerSearch: z.number().nonnegative().max(100).optional() }).strict().optional(),
  timeoutMs: z.number().int().min(10).max(30000).default(15000), cacheSeconds: z.number().int().min(0).max(86400).default(900),
  maxSearches: z.number().int().min(1).max(200).default(20), maxReads: z.number().int().min(1).max(400).default(40),
  maxAttempts: z.number().int().min(1).max(1000).default(100), requestsPerMinute: z.number().int().min(1).max(120).default(10),
  orchestration: z.object({
    currentSeconds: z.number().int().min(0).max(300).default(60), unknownSeconds: z.number().int().min(0).max(300).default(60), stableSeconds: z.number().int().min(0).max(86400).default(3600),
    simpleSearches: z.number().int().min(1).max(100).default(3), simpleReads: z.number().int().min(1).max(200).default(4),
    deepSearches: z.number().int().min(1).max(100).default(8), deepReads: z.number().int().min(1).max(200).default(12),
    agentSearches: z.number().int().min(1).max(200).default(20), agentReads: z.number().int().min(1).max(400).default(40),
    autoExtendDeep: z.boolean().default(true), extensionSearches: z.number().int().min(1).max(20).default(4), extensionReads: z.number().int().min(1).max(40).default(4),
    retryCooldownMs: z.number().int().min(1).max(300000).default(30000), excerptChars: z.number().int().min(100).max(3000).default(900),
  }).strict().default(() => ({ currentSeconds: 60, unknownSeconds: 60, stableSeconds: 3600, simpleSearches: 3, simpleReads: 4, deepSearches: 8, deepReads: 12, agentSearches: 20, agentReads: 40, autoExtendDeep: true, extensionSearches: 4, extensionReads: 4, retryCooldownMs: 30000, excerptChars: 900 })),
}).strict();
export type WebConfiguration = z.output<typeof WebConfig>;
export type ProviderConfiguration = NonNullable<WebConfiguration['provider']>;
export function webConfig(home: string): WebConfiguration {
  try {
    const file = join(home, 'research.json');
    const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as { web?: unknown } : {};
    return WebConfig.parse(saved.web ?? {});
  } catch { throw new WebError('invalid_configuration', 'Invalid web settings in research.json'); }
}
export const domain = z.string().min(1).max(253).regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/);
export const Freshness = z.enum(['any', 'day', 'month', 'year']);
const DateRange = z.object({ from: z.iso.date(), to: z.iso.date() }).strict().refine(r => r.from <= r.to, 'Date range must be ordered');
const TimeZone = z.string().max(100).refine(zone => { try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; } });
export const SearchInput = z.object({ query: z.string().trim().min(1).max(1000), count: z.number().int().min(1).max(10).default(5), freshness: Freshness.default('any'), language: z.string().regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z]{2,4})?$/).optional(), domains: z.array(domain).max(10).default([]), maxAgeSeconds: z.number().int().min(0).max(86400).optional(), fresh: z.boolean().default(false), region: z.string().regex(/^[A-Za-z]{2}$/).optional(), dateRange: DateRange.optional(), intent: z.enum(['factual', 'comparison', 'historical', 'technical']).default('factual'), timeZone: TimeZone.optional() }).strict();
export type SearchRequest = z.output<typeof SearchInput>;
export const ReadInput = z.object({ url: z.string().min(1).max(2000), maxAgeSeconds: z.number().int().min(0).max(86400).optional(), fresh: z.boolean().default(false), focus: z.string().max(1000).optional() }).strict();
export const ResearchInput = z.object({ queries: z.array(SearchInput).min(1).max(3), urls: z.array(z.string().min(1).max(2000)).max(5).default([]), maxReads: z.number().int().min(0).max(5).default(2) }).strict();
export const VerifyInput = z.object({ claim: z.object({ kind: z.enum(['text', 'quote']), text: z.string().trim().min(1).max(2000), counterText: z.string().trim().min(1).max(2000).optional() }).strict(), sourceIds: z.array(z.string().uuid()).min(1).max(10) }).strict();
export const CacheInput = z.object({ action: z.enum(['list', 'get']), sourceId: z.string().uuid().optional(), maxAgeSeconds: z.number().int().min(0).max(86400).optional(), start: z.number().int().min(0).max(64000).default(0), length: z.number().int().min(1).max(4000).default(1200), includePreviouslySeen: z.boolean().default(false) }).strict();
export const SourceSchema = z.object({
  id: z.string().uuid(), sessionId: z.string(), policy: z.string().length(64), kind: z.enum(['snippet', 'page']),
  url: z.url(), canonicalUrl: z.url(), title: z.string().max(1000), text: z.string().max(64000),
  retrievedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), provider: z.string().max(100),
  hash: z.string().length(64), mediaType: z.string().max(200), truncated: z.boolean(), untrusted: z.literal(true),
  warnings: z.array(z.string().max(200)).max(10),
  freshnessClass: z.enum(['current', 'stable', 'unknown']).optional(),
}).strict();
export type WebSource = z.output<typeof SourceSchema>;
export const sourceHash = (s: Omit<WebSource, 'hash'> | WebSource) => digest({ id: s.id, sessionId: s.sessionId, policy: s.policy, kind: s.kind, url: s.url, canonicalUrl: s.canonicalUrl, title: s.title, text: s.text, retrievedAt: s.retrievedAt, expiresAt: s.expiresAt, provider: s.provider, mediaType: s.mediaType, truncated: s.truncated, untrusted: s.untrusted, warnings: s.warnings, ...(s.freshnessClass ? { freshnessClass: s.freshnessClass } : {}) });
export function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value); if (!parsed.success) throw new WebError('invalid_input', 'Input does not match the web tool schema'); return parsed.data;
}
