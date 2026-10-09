import { z } from 'zod';
import { choose, type MenuIO } from './input.js';
import { searchChoose } from './navigation.js';
import { EndpointConfig, EndpointModel, type ProviderRegistry } from './providers.js';
import { Connections } from './connections.js';
import { redact } from './domain.js';

/** Explicit human endpoint inspection; no redirects, inference, or inherited credential discovery. */
export async function discoverModels(baseUrl: string, apiKeyEnv?: string): Promise<string[]> {
  const endpoint = EndpointConfig.parse({ provider: 'discovery', baseUrl, model: 'discovery', apiKeyEnv });
  const key = endpoint.apiKeyEnv ? process.env[endpoint.apiKeyEnv] : undefined;
  if (endpoint.apiKeyEnv && !key) throw new Error(`Set ${endpoint.apiKeyEnv} in the launching terminal first.`);
  const response = await fetch(baseUrl.replace(/\/$/, '') + '/models', { redirect: 'error', signal: AbortSignal.timeout(10000), headers: key ? { Authorization: `Bearer ${key}` } : {} });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Model discovery returned HTTP ${response.status}; check the base URL and authentication.`); }
  if (!response.body) throw new Error('Model discovery returned no body');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 65536) throw new Error('Model discovery response exceeds 64 KiB'); chunks.push(part.value); } }
  finally { await reader.cancel(); }
  const parsed = z.object({ data: z.array(z.object({ id: z.string().min(1).max(500) })).max(500) }).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  return [...new Set(parsed.data.map(m => m.id))];
}
export async function endpointWizard(registry: ProviderRegistry, io: MenuIO): Promise<void> {
  const template = await choose(io, 'OpenAI-compatible endpoint', ['LM Studio', 'Ollama', 'custom'], s => s);
  const defaults = template === 'LM Studio' ? 'http://127.0.0.1:1234/v1' : template === 'Ollama' ? 'http://127.0.0.1:11434/v1' : '';
  const baseUrl = (await io.ask(`Base URL${defaults ? ` [${defaults}]` : ' (including /v1 if required)'}`)).trim() || defaults;
  const apiKeyEnv = (await io.ask('API key environment variable NAME (blank for unauthenticated loopback only)')).trim() || undefined;
  EndpointConfig.parse({ provider: 'validation', baseUrl, apiKeyEnv, model: 'validation' });
  let model: string;
  if ((await io.ask('Fetch model IDs from this server now? [y/N]')).toLowerCase() === 'y') model = await searchChoose(io, 'Server models', await discoverModels(baseUrl, apiKeyEnv), s => s);
  else model = (await io.ask('Exact model ID from your server')).trim();
  const provider = (await io.ask('Unique provider alias (e.g. studio-local)')).trim();
  const contextWindow = Number((await io.ask('Context window supported by your server [32000]')).trim() || '32000');
  const maxTokens = Number((await io.ask('Maximum output tokens [4096]')).trim() || '4096');
  const config = EndpointConfig.parse({ provider, baseUrl, apiKeyEnv, model, contextWindow, maxTokens });
  endpointSummary(io, config); io.print('Custom pricing is unknown; zero catalog prices do not prove inference is free. Tool support is checked on admission.');
  if ((await io.ask('Save and register this endpoint? [y/N]')).toLowerCase() !== 'y') return;
  registry.addEndpoint(config); io.print('Endpoint saved and available in /model. Use /diagnostics to test its tool protocol.');
}
function endpointSummary(io: MenuIO, config: z.output<typeof EndpointConfig>): void {
  const rows = [`Server: ${config.baseUrl}`, `Authentication: ${config.apiKeyEnv ? `environment variable ${config.apiKeyEnv}` : 'unauthenticated loopback'}`, ...[{ id: config.model, contextWindow: config.contextWindow, maxTokens: config.maxTokens, images: config.images }, ...config.models].map(m => `${m.id} · context ${m.contextWindow} · output ${m.maxTokens}${m.images ? ' · images enabled' : ''}`)];
  if (io.menu) io.menu(config.provider, rows); else io.print(rows.join('\n'));
}
export async function endpointMenu(registry: ProviderRegistry, io: MenuIO, beforeChange: (provider: string) => Promise<void> = async () => {}): Promise<void> {
  const entries = registry.endpoints(); if (!entries.length) return endpointWizard(registry, io);
  const selected = await choose(io, 'Endpoints', ['Add a server', ...entries.map(e => e.provider), 'Back'], s => s);
  if (selected === 'Back') return; if (selected === 'Add a server') return endpointWizard(registry, io);
  const original = entries.find(e => e.provider === selected)!; let next = structuredClone(original); endpointSummary(io, original);
  const action = await choose(io, 'Endpoint action', ['Edit server/authentication', 'Add model', 'Edit model', 'Remove model', 'Remove endpoint', 'Back'], s => s);
  if (action === 'Back') return;
  if (action === 'Edit server/authentication') {
    const baseUrl = (await io.ask(`Base URL [${original.baseUrl}]`)).trim() || original.baseUrl;
    const key = (await io.ask(`API key environment variable [${original.apiKeyEnv ?? 'none'}]; - clears it`)).trim();
    next = EndpointConfig.parse({ ...original, baseUrl, apiKeyEnv: key === '-' ? undefined : key || original.apiKeyEnv });
  } else if (action !== 'Remove endpoint') {
    const models = [{ id: original.model, contextWindow: original.contextWindow, maxTokens: original.maxTokens, images: original.images }, ...original.models];
    const current = action === 'Add model' ? undefined : await choose(io, 'Model', models, m => m.id);
    if (action === 'Remove model') { if (models.length === 1) throw new Error('Use Remove endpoint to remove its last model'); models.splice(models.indexOf(current!), 1); }
    else {
      const id = (await io.ask(`Exact model ID${current ? ` [${current.id}]` : ''}`)).trim() || current?.id;
      const contextWindow = Number((await io.ask(`Context window [${current?.contextWindow ?? 32000}]`)).trim() || current?.contextWindow || 32000);
      const maxTokens = Number((await io.ask(`Maximum output [${current?.maxTokens ?? 4096}]`)).trim() || current?.maxTokens || 4096);
      const imageAnswer = (await io.ask(`Enable images only if the server supports them? [${current?.images ? 'Y/n' : 'y/N'}]`)).toLowerCase();
      const model = EndpointModel.parse({ id, contextWindow, maxTokens, images: imageAnswer ? imageAnswer === 'y' : current?.images ?? false });
      if (current) models.splice(models.indexOf(current), 1, model); else models.push(model);
    }
    const first = models[0]!; next = EndpointConfig.parse({ ...original, model: first.id, contextWindow: first.contextWindow, maxTokens: first.maxTokens, images: first.images, models: models.slice(1) });
  }
  if (action !== 'Remove endpoint') endpointSummary(io, next);
  io.print('Changing a server can send existing participant context to a new destination. Affected participants in this session will pause and require reconnection. Other running harnesses keep their loaded configuration until reopened.');
  if ((await io.ask(action === 'Remove endpoint' ? 'Remove this endpoint? [y/N]' : 'Apply these endpoint changes? [y/N]')).toLowerCase() !== 'y') return;
  await beforeChange(selected);
  if (action === 'Remove endpoint') registry.removeEndpoint(selected); else registry.replaceEndpoint(selected, next);
  io.print('Endpoint configuration saved. Use /model to select an available model, then /resume-agent to reconnect paused participants.');
}
export function connectionReport(registry: ProviderRegistry) {
  return {
    inference: 'Not tested. Configured credentials do not prove account access or quota.',
    providers: registry.providers().filter(p => p.configured || ['openai-codex', 'anthropic'].includes(p.id)).map(p => ({ provider: p.id, authentication: p.configured ? 'configured; not verified' : `missing; use /login ${p.id}`, models: registry.models(p.id).length })),
    endpoints: registry.endpoints().map(e => ({ provider: e.provider, model: e.model, server: new URL(e.baseUrl).origin, authentication: e.apiKeyEnv ? process.env[e.apiKeyEnv] ? 'environment variable set' : `missing ${e.apiKeyEnv}` : 'loopback without authentication', protocol: 'unverified until tested' })),
    mcp: new Connections(registry.home).list().map(c => ({ id: c.id, transport: c.type, enabled: c.enabled, allowedTools: c.tools.length, authentication: c.type === 'http' && c.tokenEnv ? process.env[c.tokenEnv] ? 'environment variable set' : `missing ${c.tokenEnv}` : 'not checked', status: 'not connected; use /mcp manage to test' })),
  };
}
export async function diagnosticsMenu(registry: ProviderRegistry, io: MenuIO): Promise<void> {
  const report = connectionReport(registry); const rows = [report.inference, '', ...report.providers.map(p => `${p.provider} · ${p.authentication} · ${p.models} models`), '', ...report.endpoints.map(e => `${e.provider} · ${e.server} · ${e.authentication} · ${e.protocol}`), '', ...report.mcp.map(c => `${c.id} · ${c.transport} · ${c.enabled ? 'enabled' : 'disabled'} · ${c.allowedTools} allowed tools · ${c.authentication}`)];
  if (io.menu) io.menu('Connections', rows); else io.print(rows.join('\n'));
  if ((await io.ask('Run a model tool-compatibility test? Up to two metered requests, outside session budgets [y/N]')).toLowerCase() !== 'y') return;
  const model = await searchChoose(io, 'Configured models', registry.models().filter(m => registry.providers().some(p => p.id === m.provider && p.configured)), m => `${m.provider}/${m.id}`);
  if ((await io.ask(`Test ${model.provider}/${model.id}? [y/N]`)).toLowerCase() !== 'y') return;
  let requests = 0; let tokens = 0;
  try { await registry.validate(model.provider, model.id, () => { requests++; }, response => { tokens += response.usage.totalTokens; }); io.print('Passed: model returned a real tool call and read its result. This does not guarantee future quota.'); }
  catch (error) { io.print(`Compatibility test failed: ${redact(String(error))}. Check account access, exact model ID and tool support.`); }
  finally { io.print(`Diagnostics: ${requests} requests attempted; ${tokens} provider-reported tokens. Outside collaboration session budgets.`); }
}
