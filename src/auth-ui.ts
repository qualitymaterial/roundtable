import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { ProviderRegistry } from './providers.js';
import { choose, type MenuIO } from './input.js';
import { searchChoose } from './navigation.js';
import { readSettings, saveSettings } from './settings.js';

export const providerLabel = (id: string) => ({ 'openai-codex': 'OpenAI Codex — subscription sign-in', openai: 'OpenAI API — separate API billing', anthropic: 'Anthropic', zai: 'Z.ai Coding Plan', openrouter: 'OpenRouter' })[id] ?? id;
export type ModelChoice = ReturnType<ProviderRegistry['models']>[number];
export const providerRow = (p: ReturnType<ProviderRegistry['providers']>[number]) => `${providerLabel(p.id)}${providerLabel(p.id) !== p.id ? ` (${p.id})` : ''} — ${p.configured ? 'credentials configured' : 'sign-in needed'}`;
export const modelRow = (m: ModelChoice) => `${m.name}${m.name !== m.id ? `\n   ${m.id}` : ''}`;
export async function providerBrowser(registry: ProviderRegistry, io: MenuIO, actions: { login(provider: string): Promise<void>; apply?(model: ModelChoice): Promise<void> }, providerId?: string, modelsFirst = false): Promise<void> {
  const provider = providerId ? registry.providers().find(p => p.id === providerId) : await searchChoose(io, 'Providers', registry.providers().filter(p => p.id !== 'roundtable-mock' && registry.models(p.id).length).sort((a, b) => Number(b.configured) - Number(a.configured) || a.id.localeCompare(b.id)), providerRow);
  if (!provider) throw new Error('Unknown provider. Use /providers to choose one.');
  const action = modelsFirst ? 'Browse models' : await choose(io, providerLabel(provider.id), ['Browse models', 'Sign in', 'Back'], s => s);
  if (action === 'Sign in') { await actions.login(provider.id); return; }
  if (action !== 'Browse models') return;
  const model = await searchChoose(io, `${providerLabel(provider.id)} models`, registry.models(provider.id), modelRow);
  const next = await choose(io, model.name, [...(actions.apply ? ['Use for a participant'] : []), 'Save favorite', 'Sign in', 'Back'], s => s);
  if (next === 'Sign in') await actions.login(provider.id);
  else if (next === 'Save favorite') {
    const saved = readSettings(registry.home);
    if (!saved.favorites.some(m => m.provider === model.provider && m.id === model.id)) saved.favorites.push({ provider: model.provider, id: model.id });
    saveSettings(registry.home, saved); io.print(`Saved ${model.name} to favorites. Choose it with /model.`);
  } else if (next === 'Use for a participant') {
    if (!registry.providers().some(p => p.id === provider.id && p.configured)) {
      if ((await io.ask(`${providerLabel(provider.id)} needs sign-in. Sign in now? [y/N]`)).toLowerCase() !== 'y') return;
      await actions.login(provider.id);
      if (!registry.providers().some(p => p.id === provider.id && p.configured)) throw new Error('Authentication is still missing. No participant was changed.');
    }
    await actions.apply!(model);
  }
}
export async function openBrowser(url: string): Promise<void> {
  const parsed = new URL(url); if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Browser login URL must be HTTPS');
  const command = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'rundll32.exe') : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  await new Promise<void>((resolve, reject) => { const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' }); child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); }); });
}
export async function loginFlow(registry: ProviderRegistry, io: MenuIO, providerId?: string, methodId?: string, launch = true, browser = openBrowser, signal?: AbortSignal): Promise<void> {
  const providers = registry.providers().filter(p => p.auth.some(a => a === 'oauth' || a === 'api_key')).sort((a, b) => {
    const rank = (id: string) => ['openai-codex', 'anthropic', 'openai'].indexOf(id) < 0 ? 99 : ['openai-codex', 'anthropic', 'openai'].indexOf(id); return rank(a.id) - rank(b.id) || a.id.localeCompare(b.id);
  });
  const provider = providerId ? providers.find(p => p.id === providerId) : await choose(io, 'Provider', providers, p => `${providerLabel(p.id)} (${p.id})${p.configured ? ' — configured' : ''}`);
  if (!provider) throw new Error('Unknown provider or no supported interactive login. Use /providers.');
  const methods = provider.auth.filter((a): a is 'oauth' | 'api_key' => a === 'oauth' || a === 'api_key');
  const method = methodId ?? (methods.length === 1 ? methods[0]! : await choose(io, 'Login method', methods, m => m === 'oauth' ? 'Browser/subscription sign-in (provider eligibility applies)' : 'API key (provider API billing)'));
  if (!methods.includes(method as 'oauth' | 'api_key')) throw new Error(`Unsupported login method for ${provider.id}; available: ${methods.join(', ')}`);
  const abort = new AbortController(); const onInterrupt = () => abort.abort(); process.once('SIGINT', onInterrupt);
  try {
    await registry.login(provider.id, method as 'oauth' | 'api_key', {
      signal: AbortSignal.any([abort.signal, ...(signal ? [signal] : [])]),
      prompt: async prompt => {
        if (prompt.type === 'select') return (await choose(io, prompt.message, prompt.options, option => option.label)).id;
        // Callback URLs/codes can contain credentials; hide them as well as API keys.
        return io.ask(prompt.message, prompt.type === 'secret' || prompt.type === 'manual_code', prompt.signal);
      },
      notify: event => {
        if (event.type === 'auth_url' || event.type === 'device_code') {
          const url = event.type === 'auth_url' ? event.url : event.verificationUri;
          io.print(`Sign in at: ${url}`);
          if (event.type === 'device_code') io.print(`Device code: ${event.userCode}`); else if (event.instructions) io.print(event.instructions);
          if (launch) void browser(url).catch(() => io.print('Could not open the browser. Open the printed link manually.'));
        } else io.print(event.message);
      },
    });
    io.print(`${providerLabel(provider.id)} login saved in Roundtable. Credentials were not copied from another application. Model admission checks access when you connect.`);
  } finally { process.removeListener('SIGINT', onInterrupt); }
}
export async function selectModel(registry: ProviderRegistry, io: MenuIO, useFavorites = true) {
  const favorites = readSettings(registry.home).favorites.filter(m => m.provider !== 'roundtable-mock');
  if (useFavorites && favorites.length) {
    const source = await choose(io, 'Model source', ['favorites', 'all providers'], s => s);
    if (source === 'favorites') {
      const model = await searchChoose(io, 'Favorites', favorites, m => `${m.provider}/${m.id}`);
      if (!registry.models(model.provider).some(m => m.id === model.id)) throw new Error('Favorite is no longer registered; remove it with /favorites or configure its endpoint.');
      if (!registry.providers().some(p => p.id === model.provider && p.configured)) throw new Error(`Connect ${model.provider} using /login ${model.provider} first.`);
      return registry.models(model.provider).find(m => m.id === model.id)!;
    }
  }
  const provider = await searchChoose(io, 'Providers', registry.providers().filter(p => p.id !== 'roundtable-mock' && registry.models(p.id).length).sort((a, b) => Number(b.configured) - Number(a.configured) || a.id.localeCompare(b.id)), providerRow);
  if (!provider.configured) throw new Error(`Connect ${provider.id} using /login ${provider.id}, then choose its model.`);
  return searchChoose(io, 'Models', registry.models(provider.id), modelRow);
}
export async function favoritesMenu(registry: ProviderRegistry, io: MenuIO): Promise<void> {
  const saved = readSettings(registry.home);
  const action = await choose(io, 'Favorites', ['list', 'add', 'remove', 'back'], s => s);
  if (action === 'list') { const rows = saved.favorites.map(m => `${m.provider} / ${m.id}`); if (io.menu) io.menu('Favorite models', rows.length ? rows : ['No favorites yet. Choose Add to save a model.']); else io.print(rows.join('\n') || 'No favorites yet.'); return; }
  if (action === 'add') {
    const selected = await selectModel(registry, io, false);
    if (!saved.favorites.some(m => m.provider === selected.provider && m.id === selected.id)) saved.favorites.push({ provider: selected.provider, id: selected.id });
  } else if (action === 'remove') {
    const selected = await searchChoose(io, 'Favorites', saved.favorites, m => `${m.provider}/${m.id}`);
    saved.favorites = saved.favorites.filter(m => m.provider !== selected.provider || m.id !== selected.id);
  } else return;
  saveSettings(registry.home, saved); io.print('Model favorites saved.');
}
