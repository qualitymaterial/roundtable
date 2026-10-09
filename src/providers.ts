import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Type } from 'typebox';
import { z } from 'zod';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { Api, AuthInteraction, Model, AssistantMessage, Context } from '@earendil-works/pi-ai';
import { id, redact } from './domain.js';
import { saveJson } from './setup.js';

export interface ProviderAdapter { models(provider?: string): { provider: string; id: string; name: string }[]; validate(provider: string, model: string): Promise<AssistantMessage[]> }
export const LiveAgents = z.array(z.object({ name: z.string().min(1).max(80), provider: z.string().min(1), model: z.string().min(1), instructions: z.string().max(10000).optional() }).strict()).length(3);
export const EndpointModel = z.object({ id: z.string().min(1).max(500), contextWindow: z.number().int().positive().default(32000), maxTokens: z.number().int().positive().default(4096), images: z.boolean().default(false) }).strict().refine(m => m.maxTokens <= m.contextWindow, 'Maximum output must fit in the context window');
export const EndpointConfig = z.object({ provider: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/), baseUrl: z.url().refine(raw => { const u = new URL(raw); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash; }, 'Use an HTTP(S) base URL without credentials, query or fragment'), model: z.string().min(1).max(500), images: z.boolean().default(false), models: z.array(EndpointModel).max(99).default([]), apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(), contextWindow: z.number().int().positive().default(32000), maxTokens: z.number().int().positive().default(4096) }).strict().refine(c => c.maxTokens <= c.contextWindow, 'Maximum output must fit in the context window').refine(c => new Set([c.model, ...c.models.map(m => m.id)]).size === c.models.length + 1, 'Model IDs must be unique within an endpoint').refine(c => Boolean(c.apiKeyEnv) || ['localhost', '127.0.0.1', '[::1]'].includes(new URL(c.baseUrl).hostname), 'Remote endpoints require an API key environment variable');
export class ProviderRegistry implements ProviderAdapter {
  private constructor(readonly runtime: ModelRuntime, readonly home: string) {}
  static async create(home: string): Promise<ProviderRegistry> {
    mkdirSync(home, { recursive: true });
    // Do not load ~/.pi, project extensions or shell-backed models.json key resolvers.
    const runtime = await ModelRuntime.create({ authPath: join(home, 'auth.json'), modelsPath: null, modelsStorePath: join(home, 'catalog.json'), allowModelNetwork: false });
    const registry = new ProviderRegistry(runtime, home);
    const configPath = join(home, 'endpoints.json');
    if (existsSync(configPath)) {
      const configs = z.array(EndpointConfig).max(32).parse(JSON.parse(readFileSync(configPath, 'utf8')));
      if (new Set(configs.map(c => c.provider)).size !== configs.length) throw new Error('Use a unique provider alias for each endpoint/model configuration');
      for (const config of configs) { if (registry.providers().some(p => p.id === config.provider)) throw new Error(`Endpoint alias conflicts with a registered provider: ${config.provider}`); registry.registerEndpoint(config); }
    }
    return registry;
  }
  models(provider?: string): { provider: string; id: string; name: string }[] { return this.runtime.getModels(provider).map(m => ({ provider: m.provider, id: m.id, name: m.name })); }
  endpoints(): z.output<typeof EndpointConfig>[] {
    const path = join(this.home, 'endpoints.json');
    return existsSync(path) ? z.array(EndpointConfig).max(32).parse(JSON.parse(readFileSync(path, 'utf8'))) : [];
  }
  private registerEndpoint(c: z.output<typeof EndpointConfig>): void {
    // Pi resolves $NAME as an environment reference. The loopback-only placeholder is not a credential.
    this.runtime.registerProvider(c.provider, { baseUrl: c.baseUrl, api: 'openai-completions', apiKey: c.apiKeyEnv ? `$${c.apiKeyEnv}` : 'roundtable-local-no-auth', models: [{ id: c.model, contextWindow: c.contextWindow, maxTokens: c.maxTokens, images: c.images }, ...c.models].map(m => ({ id: m.id, name: m.id, reasoning: false, input: m.images ? ['text', 'image'] : ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: m.contextWindow, maxTokens: m.maxTokens })) });
  }
  addEndpoint(input: unknown): void {
    const c = EndpointConfig.parse(input); const entries = this.endpoints();
    if (this.providers().some(p => p.id === c.provider) || entries.some(e => e.provider === c.provider)) throw new Error('Provider alias already exists; choose a new alias.');
    const next = z.array(EndpointConfig).max(32).parse([...entries, c]);
    saveJson(join(this.home, 'endpoints.json'), next); this.registerEndpoint(c);
  }
  replaceEndpoint(provider: string, input: unknown): void {
    const replacement = EndpointConfig.parse(input); const entries = this.endpoints(); const old = entries.find(e => e.provider === provider);
    if (!old || replacement.provider !== provider) throw new Error('Only an existing custom endpoint can be edited; its alias cannot change');
    this.runtime.unregisterProvider(provider);
    try { this.registerEndpoint(replacement); saveJson(join(this.home, 'endpoints.json'), entries.map(e => e.provider === provider ? replacement : e)); }
    catch (error) { this.runtime.unregisterProvider(provider); this.registerEndpoint(old); throw error; }
  }
  removeEndpoint(provider: string): void {
    const entries = this.endpoints(); if (!entries.some(e => e.provider === provider)) throw new Error('Only custom endpoints can be removed');
    saveJson(join(this.home, 'endpoints.json'), entries.filter(e => e.provider !== provider)); this.runtime.unregisterProvider(provider);
  }
  providers(): { id: string; configured: boolean; auth: string[] }[] {
    return this.runtime.getProviders().map(p => ({ id: p.id, configured: this.runtime.hasConfiguredAuth(p.id), auth: Object.keys(p.auth ?? {}).map(name => name === 'apiKey' ? 'api_key' : name) }));
  }
  preflight(input: unknown) {
    const agents = LiveAgents.parse(input);
    const providers = this.providers();
    const checks = agents.map(agent => {
      const knownModel = this.models(agent.provider).some(model => model.id === agent.model);
      const configuredAuth = providers.some(provider => provider.id === agent.provider && provider.configured);
      return { ...agent, ready: knownModel && configuredAuth, knownModel, configuredAuth };
    });
    return { ready: checks.every(check => check.ready), agents: checks, inference: 'Not called; authentication validity and tool compatibility are checked on admission.' };
  }
  model(provider: string, model: string): Model<Api> { const selected = this.runtime.getModel(provider, model); if (!selected) throw new Error(`Unknown model ${provider}/${model}; use /models ${provider}`); return selected; }
  async login(provider: string, type: 'oauth' | 'api_key', interaction: AuthInteraction): Promise<void> { await this.runtime.login(provider, type, interaction); }
  async validate(provider: string, modelId: string, beforeRequest?: () => void, onResponse?: (response: AssistantMessage) => void): Promise<AssistantMessage[]> {
    const model = this.model(provider, modelId); const nonce = id();
    const context: Context = { messages: [{ role: 'user', content: `Compatibility test. Call roundtable_probe with nonce ${nonce}. After its result, reply with the returned receipt.`, timestamp: Date.now() }], tools: [{ name: 'roundtable_probe', description: 'Echo a nonce and return a receipt.', parameters: Type.Object({ nonce: Type.String() }) }] };
    const signal = AbortSignal.timeout(30000);
    beforeRequest?.(); const first = await this.runtime.completeSimple(model, context, { signal, maxTokens: 256 });
    onResponse?.(first);
    const call = first.content.find(c => c.type === 'toolCall' && c.name === 'roundtable_probe');
    if (first.stopReason !== 'toolUse' || !call || call.type !== 'toolCall' || call.arguments.nonce !== nonce) throw new Error(`Tool compatibility failed for ${provider}/${modelId}: ${redact(first.errorMessage ?? 'valid tool call was not returned')}`);
    const receipt = `receipt-${id()}`;
    context.messages.push(first, { role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [{ type: 'text', text: receipt }], isError: false, timestamp: Date.now() });
    beforeRequest?.(); const second = await this.runtime.completeSimple(model, context, { signal, maxTokens: 256 });
    onResponse?.(second);
    if (second.stopReason !== 'stop' || !second.content.some(c => c.type === 'text' && c.text.includes(receipt))) throw new Error(`Tool-result compatibility failed for ${provider}/${modelId}`);
    return [first, second];
  }
}
