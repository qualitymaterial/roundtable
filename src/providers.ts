import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Type } from 'typebox';
import { z } from 'zod';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { Api, AuthInteraction, Model, AssistantMessage, Context } from '@earendil-works/pi-ai';
import { id, redact } from './domain.js';

export interface ProviderAdapter { models(provider?: string): { provider: string; id: string; name: string }[]; validate(provider: string, model: string): Promise<AssistantMessage[]> }
export const LiveAgents = z.array(z.object({ name: z.string().min(1).max(80), provider: z.string().min(1), model: z.string().min(1), instructions: z.string().max(10000).optional() }).strict()).length(3);
const EndpointConfig = z.object({ provider: z.string().regex(/^[a-z][a-z0-9-]+$/), baseUrl: z.url(), model: z.string().min(1), apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/), contextWindow: z.number().int().positive().default(32000), maxTokens: z.number().int().positive().default(4096) });
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
      for (const config of configs) {
        const url = new URL(config.baseUrl);
        if (url.username || url.password) throw new Error('Endpoint URLs must not contain credentials');
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Endpoint must use HTTP(S)');
        // Pi 1.1.0 treats bare names as literals; only $NAME resolves an environment value.
        runtime.registerProvider(config.provider, { baseUrl: config.baseUrl, api: 'openai-completions', apiKey: `$${config.apiKeyEnv}`, models: [{ id: config.model, name: config.model, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: config.contextWindow, maxTokens: config.maxTokens }] });
      }
    }
    return registry;
  }
  models(provider?: string): { provider: string; id: string; name: string }[] { return this.runtime.getModels(provider).map(m => ({ provider: m.provider, id: m.id, name: m.name })); }
  providers(): { id: string; configured: boolean; auth: string[] }[] {
    return this.runtime.getProviders().map(p => ({ id: p.id, configured: this.runtime.hasConfiguredAuth(p.id), auth: Object.keys(p.auth ?? {}) }));
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
