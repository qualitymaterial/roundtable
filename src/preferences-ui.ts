import { resolve } from 'node:path';
import { choose, type MenuIO } from './input.js';
import { Connections, type Connection } from './connections.js';
import { Skills } from './skills.js';
import { Limits } from './domain.js';
import type { z } from 'zod';

export async function editLimit(io: MenuIO, current: z.output<typeof Limits>): Promise<Record<string, number | null>> {
  const keys = ['tokens', 'dollars', 'requests', 'toolCalls', 'exchanges', 'concurrency', 'timeoutMs', 'turnTimeoutMs'] as const;
  const key = await choose(io, 'Limit to change', keys, k => `${k}: ${current[k] ?? 'off'}${k.endsWith('Ms') ? ' milliseconds' : ''}`);
  const value = (await io.ask(`New ${key} total${key === 'tokens' ? ' (off disables the cumulative cap)' : ''}`)).trim();
  const patch = { [key]: key === 'tokens' && value === 'off' ? null : Number(value) }; Limits.parse({ ...current, ...patch }); return patch;
}
export async function skillsMenu(home: string, io: MenuIO, subcommand = ''): Promise<void> {
  const skills = new Skills(home);
  const action = subcommand || await choose(io, 'Skills', ['list', 'add', 'toggle', 'remove'], a => a);
  if (action === 'list') { io.print(skills.list().map(s => ({ name: s.name, description: s.description, enabled: s.enabled, manualOnly: s.manualOnly, source: s.source, hash: s.hash }))); return; }
  if (action === 'add') {
    const path = (await io.ask('Path to SKILL.md')).replace(/^"(.*)"$/, '$1'); const candidate = skills.candidate(path);
    io.print(candidate);
    if ((await io.ask('Save this reviewed instruction snapshot? It grants no execution rights [y/N]')).toLowerCase() === 'y') { skills.save(candidate); io.print(`Installed. Use /skill:${candidate.name} <request>. Supporting files are not copied or executed.`); }
    return;
  }
  if (!['toggle', 'remove'].includes(action)) throw new Error('Use /skills [list|add|toggle|remove]');
  const entry = await choose(io, 'Skill', skills.list(), s => `${s.name}: ${s.enabled ? 'enabled' : 'disabled'}`);
  if (action === 'toggle') skills.save({ ...entry, enabled: !entry.enabled }); else skills.remove(entry.name);
  io.print('Skill configuration saved.');
}
export async function mcpMenu(home: string, io: MenuIO, subcommand = ''): Promise<void> {
  const store = new Connections(home);
  const action = subcommand || await choose(io, 'MCP connections', ['list', 'add', 'manage'], a => a);
  if (action === 'list') { io.print(store.list()); return; }
  if (action === 'add') {
    const id = await io.ask('Connection name (lowercase, hyphens)');
    if (store.list().some(c => c.id === id)) throw new Error('Connection already exists; manage it instead.');
    const type = await choose(io, 'Connection type', ['http', 'stdio'] as const, t => t === 'http' ? 'HTTP service' : 'Local program (stdio; runs with your OS privileges)');
    let candidate: unknown;
    if (type === 'http') candidate = { id, type, url: await io.ask('MCP HTTP URL'), tokenEnv: (await io.ask('Bearer-token environment variable name (blank for none)')).trim() || undefined };
    else {
      const command = (await io.ask('Program executable (Windows: use an .exe, or node.exe with a script argument)')).replace(/^"(.*)"$/, '$1'); const args = [];
      while (true) { const arg = await io.ask(`Argument ${args.length + 1}, without wrapping quotes (blank ends)`); if (!arg) break; args.push(arg); if (args.length >= 40) break; }
      candidate = { id, type, command, args, cwd: resolve((await io.ask('Working folder (blank uses current folder)')).replace(/^"(.*)"$/, '$1') || process.cwd()), envVars: (await io.ask('Environment variable names to pass, comma-separated (blank for none)')).split(',').map(v => v.trim()).filter(Boolean) };
    }
    const parsed = (await import('./connections.js')).Connection.parse(candidate); io.print(parsed);
    if ((await io.ask('Save disabled connection? [y/N]')).toLowerCase() === 'y') { store.save(parsed); io.print('Saved disabled. Use /mcp manage to test, select allowed tools and enable it.'); }
    return;
  }
  if (action !== 'manage') throw new Error('Use /mcp [list|add|manage]');
  const entry = await choose(io, 'Connection', store.list(), c => `${c.id} (${c.type}, ${c.enabled ? 'enabled' : 'disabled'})`);
  if (entry.id === 'legacy') { io.print('This connection is configured through ROUNDTABLE_MCP_* environment variables. Add a named connection to manage it here.'); return; }
  const operation = await choose(io, 'Action', ['test-and-select-tools', 'enable', 'disable', 'remove', 'select-resources'] as const, v => v);
  if (operation === 'remove') { store.remove(entry.id); io.print('Connection removed.'); return; }
  if (operation === 'disable') { store.save({ ...entry, enabled: false }); io.print('Connection disabled for future calls; an in-flight invocation may finish.'); return; }
  io.print(entry);
  const trust = entry.type === 'stdio' ? 'This starts the configured local program with your OS privileges. Trust this executable and its arguments?' : 'This contacts the configured external service with its selected credential. Continue?';
  if ((await io.ask(`${trust} [y/N]`)).toLowerCase() !== 'y') return;
  if (operation === 'enable') { store.save({ ...entry, enabled: true }); io.print('Enabled. Participants still need mcp.remote permission; /grant <name> mcp.remote.'); return; }
  if (operation === 'select-resources') {
    const page = await store.withClient(entry, AbortSignal.timeout(15000), client => client.listResourcesPage());
    io.menu?.('MCP resources (first page)', page.resources.map(r => `${r.name}: ${r.uri}`));
    const resources = (await io.ask('Exact resource URIs to allow, comma-separated (blank allows none)')).split(',').map(v => v.trim()).filter(Boolean);
    store.save({ ...entry, resources: [...new Set(resources)] }); io.print('Exact resource allowlist saved.'); return;
  }
  const available = await store.withClient(entry, AbortSignal.timeout(15000), client => client.listTools());
  io.print(available.map(t => ({ name: t.name, description: t.description })));
  const allowed = (await io.ask('Exact tool names to allow, comma-separated (blank allows none)')).split(',').map(v => v.trim()).filter(Boolean);
  if (allowed.some(name => !available.some(t => t.name === name))) throw new Error('Unknown tool name; allowlist was not changed');
  store.save({ ...entry, tools: [...new Set(allowed)] } as Connection); io.print('Allowlist saved. Enable the connection when ready.');
}
