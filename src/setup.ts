import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { AgentInput, id } from './domain.js';
import { normalizeHostPolicy } from './host-tools.js';
import type { ProviderRegistry } from './providers.js';

export interface SetupIO { askValidated?(label: string, validate: (value: string) => string | undefined): Promise<string>; select?(label: string, choices: string[]): Promise<number>; ask(label: string): Promise<string>; print(text: string): void; login(provider: string, method: 'oauth' | 'api_key'): Promise<void> }
export function saveJson(path: string, value: unknown): void {
  const temporary = `${path}.${id()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(temporary, path);
}
const commonProviders = ['anthropic', 'openai', 'openai-codex', 'google', 'openrouter'];
/** Configured providers first, then common hosted ones, then the rest alphabetically. */
export function orderProviders<T extends { id: string; configured?: boolean }>(providers: T[]): T[] {
  const rank = (p: T) => p.configured ? 0 : commonProviders.includes(p.id) ? 1 + commonProviders.indexOf(p.id) / 10 : 2;
  return [...providers].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}
export async function setup(registry: ProviderRegistry, project: string, io: SetupIO): Promise<void> {
  const agentsPath = join(registry.home, 'agents.json');
  const saved = existsSync(agentsPath) ? AgentInput.array().parse(JSON.parse(readFileSync(agentsPath, 'utf8'))) : [];
  io.print('Roundtable setup. Provider credentials stay in Roundtable. No inference is performed until you start a session. Type cancel to leave any prompt.');
  const ask = async (label: string) => { const value = (await io.ask(label)).trim(); if (value.toLowerCase() === 'cancel') throw new Error('Setup cancelled; agent and access configuration not changed.'); return value; };
  const choose = async <T>(label: string, entries: T[], display: (entry: T) => string): Promise<T> => {
    if (!entries.length) throw new Error('No choices available');
    if (io.select) return entries[await io.select(label.replace(/ number$/, ''), entries.map(display))]!;
    io.print(entries.map((entry, i) => `${i + 1}. ${display(entry)}`).join('\n'));
    while (true) { const n = Number(await ask(label)); if (Number.isInteger(n) && n >= 1 && n <= entries.length) return entries[n - 1]!; io.print(`Enter a number between 1 and ${entries.length}.`); }
  };
  // Escape in a menu rejects with `back`; step back one prompt instead of leaving setup. Typing "cancel" still exits.
  const goBack = (error: unknown) => error instanceof Error && (error as { back?: boolean }).back === true;
  type Draft = { provider?: ReturnType<ProviderRegistry['providers']>[number]; model?: ReturnType<ProviderRegistry['models']>[number]; name?: string; instructions?: string };
  let draft: Draft = {}; const done: { draft: Draft; agent: ReturnType<typeof AgentInput.parse> }[] = [];
  let access: 'none' | 'read' | 'edit' = 'none'; let shell = false; let policy: Awaited<ReturnType<typeof normalizeHostPolicy>>; let step = 0;
  while (step < 8) {
    try {
      if (step === 0) {
        const providers = orderProviders(registry.providers().filter(p => p.auth.length || p.configured));
        const provider = await choose('Provider number', providers, p => `${p.id}${p.configured ? ' (configured)' : ''}`);
        if (!provider.configured) {
          try {
            const methods = provider.auth.filter((method): method is 'oauth' | 'api_key' => method === 'oauth' || method === 'api_key');
            const method = methods.length === 1 ? methods[0]! : await choose('Authentication method', methods, m => m);
            await io.login(provider.id, method);
          } catch (error) { if (goBack(error)) { io.print('Login cancelled; choose a provider.'); continue; } throw error; }
        }
        draft.provider = provider; step = 1;
      } else if (step === 1) {
        const provider = draft.provider!; draft.model = undefined; let models = registry.models(provider.id); let searched = false;
        while (!draft.model) {
          while (models.length > 20 || !models.length) {
            searched = true;
            const query = await ask(`${registry.models(provider.id).length} models. Search by name or ID`);
            models = registry.models(provider.id).filter(m => `${m.name} ${m.id}`.toLowerCase().includes(query.toLowerCase()));
            if (!models.length) io.print('No matching models; try another search.');
          }
          try { draft.model = await choose('Model number', models, m => `${m.name} (${m.id})`); }
          catch (error) { if (!(goBack(error) && searched)) throw error; models = registry.models(provider.id); }
        }
        step = 2;
      } else if (step === 2) {
        const name = await ask('Participant name');
        if ([...saved, ...done.map(d => d.agent)].some(a => a.name === name)) throw new Error('That participant name already exists; choose a different name.');
        draft.name = name; step = 3;
      } else if (step === 3) { draft.instructions = await ask('Optional instructions (Enter for none)'); step = 4; }
      else if (step === 4) {
        const more = (await ask('Add another participant? [y/N]')).toLowerCase() === 'y';
        done.push({ draft, agent: AgentInput.parse({ name: draft.name, instructions: draft.instructions, provider: draft.provider!.id, model: draft.model!.id }) });
        if (more) { draft = {}; step = 0; } else step = 5;
      } else if (step === 5) {
        access = await choose(`Access for ${project}`, ['none', 'read', 'edit'] as const, a => ({ none: 'No host file access', read: 'Read this project folder', edit: 'Read and edit this project folder' })[a]); step = 6;
      } else if (step === 6) {
        shell = (await ask('Allow requests for host commands? Each exact command needs approval and runs without an OS sandbox. [y/N]')).toLowerCase() === 'y'; step = 7;
      } else {
        policy = await normalizeHostPolicy({ readRoots: access === 'none' ? [] : [project], writeRoots: access === 'edit' ? [project] : [], shell });
        io.print(`Save ${saved.length + done.length} participants; project access ${access}; host command requests ${shell ? 'enabled' : 'disabled'}. Existing saved access policy will be replaced. Paid compatibility checks happen on session start.`);
        if ((await ask('Save configuration? [y/N]')).toLowerCase() !== 'y') { io.print('Configuration not saved. Any completed provider login remains available.'); return; }
        step = 8;
      }
    } catch (error) {
      if (!goBack(error)) throw error;
      if (step === 0 || step === 5) { const last = done.pop(); if (!last) throw error; draft = last.draft; step = 4; }
      else step--;
    }
  }
  const additions = done.map(d => d.agent);
  saveJson(agentsPath, [...saved, ...additions]); saveJson(join(registry.home, 'host-access.json'), policy!);
  saveJson(join(registry.home, 'preferences.json'), { projectAccess: false });
  io.print('Setup saved. Run roundtable in your project folder to begin. /budget shows limits; /host shows effective access.');
}
