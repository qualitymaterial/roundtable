import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { AgentInput, id } from './domain.js';
import { normalizeHostPolicy } from './host-tools.js';
import type { ProviderRegistry } from './providers.js';

export interface SetupIO { ask(label: string): Promise<string>; print(text: string): void; login(provider: string, method: 'oauth' | 'api_key'): Promise<void> }
export function saveJson(path: string, value: unknown): void {
  const temporary = `${path}.${id()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(temporary, path);
}
export async function setup(registry: ProviderRegistry, project: string, io: SetupIO): Promise<void> {
  const agentsPath = join(registry.home, 'agents.json');
  const saved = existsSync(agentsPath) ? AgentInput.array().parse(JSON.parse(readFileSync(agentsPath, 'utf8'))) : [];
  io.print('Roundtable setup. Provider credentials stay in Roundtable. No inference is performed until you start a session. Type cancel to leave any prompt.');
  const ask = async (label: string) => { const value = (await io.ask(label)).trim(); if (value.toLowerCase() === 'cancel') throw new Error('Setup cancelled; agent and access configuration not changed.'); return value; };
  const choose = async <T>(label: string, entries: T[], display: (entry: T) => string): Promise<T> => {
    if (!entries.length) throw new Error('No choices available');
    io.print(entries.map((entry, i) => `${i + 1}. ${display(entry)}`).join('\n'));
    while (true) { const n = Number(await ask(label)); if (Number.isInteger(n) && n >= 1 && n <= entries.length) return entries[n - 1]!; io.print(`Enter a number between 1 and ${entries.length}.`); }
  };
  const additions = [];
  do {
    const providers = registry.providers().filter(p => p.auth.length || p.configured);
    const provider = await choose('Provider number', providers, p => `${p.id}${p.configured ? ' (configured)' : ''}`);
    if (!provider.configured) {
      const methods = provider.auth.filter((method): method is 'oauth' | 'api_key' => method === 'oauth' || method === 'api_key');
      const method = methods.length === 1 ? methods[0]! : await choose('Authentication method', methods, m => m);
      await io.login(provider.id, method);
    }
    let models = registry.models(provider.id);
    while (models.length > 20 || !models.length) {
      const query = await ask(`${registry.models(provider.id).length} models. Search by name or ID`);
      models = registry.models(provider.id).filter(m => `${m.name} ${m.id}`.toLowerCase().includes(query.toLowerCase()));
      if (!models.length) io.print('No matching models; try another search.');
    }
    const model = await choose('Model number', models, m => `${m.name} (${m.id})`);
    const name = await ask('Participant name');
    if ([...saved, ...additions].some(a => a.name === name)) throw new Error('That participant name already exists; choose a different name.');
    const instructions = await ask('Optional instructions (Enter for none)');
    additions.push(AgentInput.parse({ name, instructions, provider: provider.id, model: model.id }));
  } while ((await ask('Add another participant? [y/N]')).toLowerCase() === 'y');
  const access = await choose(`Access for ${project}`, ['none', 'read', 'edit'] as const, a => ({ none: 'No host file access', read: 'Read this project folder', edit: 'Read and edit this project folder' })[a]);
  const shell = (await ask('Allow requests for host commands? Each exact command needs approval and runs without an OS sandbox. [y/N]')).toLowerCase() === 'y';
  const policy = await normalizeHostPolicy({ readRoots: access === 'none' ? [] : [project], writeRoots: access === 'edit' ? [project] : [], shell });
  io.print(`Save ${saved.length + additions.length} participants; project access ${access}; host command requests ${shell ? 'enabled' : 'disabled'}. Existing saved access policy will be replaced. Paid compatibility checks happen on session start.`);
  if ((await ask('Save configuration? [y/N]')).toLowerCase() !== 'y') { io.print('Configuration not saved. Any completed provider login remains available.'); return; }
  saveJson(agentsPath, [...saved, ...additions]); saveJson(join(registry.home, 'host-access.json'), policy);
  saveJson(join(registry.home, 'preferences.json'), { projectAccess: false });
  io.print('Setup saved. Run roundtable in your project folder to begin. /budget shows limits; /host shows effective access.');
}
