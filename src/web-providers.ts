import { z } from 'zod';
import { protectSecret } from './domain.js';
import { webUrl, type WebTransport } from './web-http.js';
import { WebError, type SearchRequest, type ProviderConfiguration } from './web-types.js';

export const ProviderResults = z.array(z.object({ url: z.string().max(2000), title: z.string().max(4000), snippet: z.string().max(20000) }).strict()).max(1000);
export type ProviderResult = z.output<typeof ProviderResults>[number];
export interface SearchProvider {
  readonly id: string;
  readonly version: string;
  readonly capabilities: { freshness: boolean; language: boolean; region?: boolean; dateRange?: boolean };
  search(request: SearchRequest, signal: AbortSignal): Promise<unknown>;
}
export type SearchProviderFactory = (config: ProviderConfiguration, transport: WebTransport) => SearchProvider;
export class SearchProviders {
  private factories = new Map<string, SearchProviderFactory>();
  register(adapter: string, factory: SearchProviderFactory): void { if (this.factories.has(adapter)) throw new Error('Duplicate search adapter'); this.factories.set(adapter, factory); }
  create(config: ProviderConfiguration, transport: WebTransport): SearchProvider {
    const factory = this.factories.get(config.adapter); if (!factory) throw new WebError('provider_unavailable', 'Configured search adapter is unavailable'); return factory(config, transport);
  }
}
export function searxngProvider(config: ProviderConfiguration, transport: WebTransport): SearchProvider {
  return { id: config.id, version: '1', capabilities: { freshness: true, language: true }, async search(request, signal) {
    if (!config.endpoint) throw new WebError('unconfigured', 'Search provider endpoint is required');
    const url = webUrl(config.endpoint, !config.allowPrivateEndpoint);
    url.searchParams.set('q', request.query); url.searchParams.set('format', 'json');
    if (request.freshness !== 'any') url.searchParams.set('time_range', request.freshness);
    if (request.language) url.searchParams.set('language', request.language);
    const token = config.tokenEnv ? process.env[config.tokenEnv] : undefined;
    if (config.tokenEnv && !token) throw new WebError('provider_unavailable', 'Configured search credential is unavailable');
    if (token) { protectSecret(token); if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new WebError('invalid_configuration', 'Search credentials require HTTPS or explicit loopback'); }
    const response = await transport(url, signal, token ? { Authorization: `Bearer ${token}` } : {}, !config.allowPrivateEndpoint);
    let data: unknown; try { data = JSON.parse(response.body); } catch { throw new WebError('invalid_response', 'Search provider returned invalid JSON'); }
    const parsed = z.object({ results: z.array(z.object({ url: z.string().max(2000), title: z.string().max(4000), content: z.string().max(20000).default('') })).max(1000) }).safeParse(data);
    if (!parsed.success) throw new WebError('invalid_response', 'Search provider returned an invalid result structure');
    return parsed.data.results.map(r => ({ url: r.url, title: r.title, snippet: r.content }));
  } };
}
/** Explicit test/embed fixture. Never selected implicitly from configuration. */
export class MockSearchProvider implements SearchProvider {
  readonly version = '1'; readonly capabilities = { freshness: true, language: true }; calls: SearchRequest[] = [];
  readonly results: ProviderResult[];
  constructor(results: ProviderResult[], readonly id = 'fixture') { this.results = structuredClone(results); }
  async search(request: SearchRequest, signal: AbortSignal): Promise<unknown> { signal.throwIfAborted(); this.calls.push(structuredClone(request)); return structuredClone(this.results); }
}
