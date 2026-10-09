import { loginMcp, logoutMcp } from './mcp-auth.js';
import { resolve } from 'node:path';
import { choose, askValidated, fieldError, showMenu, type MenuIO } from './input.js';
import { Connections, type Connection } from './connections.js';
import { Skills } from './skills.js';
import { Limits } from './domain.js';
import type { z } from 'zod';

export async function editLimit(io: MenuIO, current: z.output<typeof Limits>): Promise<Record<string, number | null>> {
  const keys = ['tokens', 'dollars', 'requests', 'toolCalls', 'exchanges', 'concurrency', 'timeoutMs', 'turnTimeoutMs'] as const;
  const key = await choose(io, 'Limit to change', keys, k => `${k}: ${current[k] ?? 'off'}${k.endsWith('Ms') ? ' milliseconds' : ''}`);
  const value = (await askValidated(io, `New ${key} total${key === 'tokens' ? ' (off disables the cumulative cap)' : ''}`, value => { try { Limits.parse({ ...current, [key]: key === 'tokens' && value.trim() === 'off' ? null : Number(value) }); return undefined; } catch (error) { return fieldError(error); } })).trim();
  const patch = { [key]: key === 'tokens' && value === 'off' ? null : Number(value) }; Limits.parse({ ...current, ...patch }); return patch;
}
export async function skillsMenu(home: string, io: MenuIO, subcommand = ''): Promise<void> {
  const skills = new Skills(home);
  const action = subcommand || await choose(io, 'Skills', ['list', 'add', 'package', 'inspect', 'toggle', 'remove'], a => a);
  if (action === 'list') { showMenu(io, 'Reviewed skills', skills.list().map(s => `${s.name} / ${s.enabled ? 'enabled' : 'disabled'} / ${s.files?.length ?? 0} supporting files\n${s.description}`)); return; }
  if (action === 'add' || action === 'package') {
    const path = (await io.ask('Path to SKILL.md')).replace(/^"(.*)"$/, '$1'); const candidate = action === 'package' ? skills.packageCandidate(path) : skills.candidate(path);
    showMenu(io, 'Review skill snapshot', [candidate.name, candidate.description, candidate.content, ...(candidate.files?.map(f => `${f.path} / SHA-256 ${f.hash}`) ?? []), 'Hash: ' + candidate.hash]);
    if ((await io.ask('Save this reviewed instruction snapshot? It grants no execution rights [y/N]')).toLowerCase() === 'y') { skills.save(candidate); io.print(`Installed. Use /skill:${candidate.name} <request>. ${candidate.files ? 'Package files captured; /skill-stage prepares a reviewed sandbox copy.' : 'Supporting files are not copied.'} No scripts execute automatically.`); }
    return;
  }
  if (!['inspect', 'toggle', 'remove'].includes(action)) throw new Error('Use /skills [list|add|package|inspect|toggle|remove]');
  const entry = await choose(io, 'Skill', skills.list(), s => `${s.name}: ${s.enabled ? 'enabled' : 'disabled'}`);
  if (action === 'inspect') { showMenu(io, entry.name, [entry.content, ...(entry.files?.map(f => f.path + ' / ' + f.hash) ?? [])]); if (entry.files?.length) { const selected = await choose(io, 'Read package file', ['Back', ...entry.files.map(f => f.path)], s => s); if (selected !== 'Back') { const file = skills.file(entry.name, selected, true); showMenu(io, file.path + ' / ' + file.hash, [file.encoding === 'utf8' ? file.content : 'Binary file; stage the package for inspection with an appropriate application.']); } } return; }
  if (action === 'toggle') skills.save({ ...entry, enabled: !entry.enabled }); else skills.remove(entry.name);
  io.print('Skill configuration saved.');
}
export async function mcpMenu(home: string, io: MenuIO, subcommand = ''): Promise<void> {
  const store = new Connections(home);
  const action = subcommand || await choose(io, 'MCP connections', ['list', 'add', 'manage'], a => a);
  if (action === 'list') { showMenu(io, 'MCP connections', store.list().map(c => `${c.id} / ${c.type} / ${c.enabled ? 'enabled' : 'disabled'} / ${c.tools.length} allowed tools`)); return; }
  if (action === 'add') {
    const id = await askValidated(io, 'Connection name (lowercase, hyphens)', value => /^[a-z][a-z0-9-]{0,63}$/.test(value) ? undefined : 'Use a lowercase name with letters, digits or hyphens');
    if (store.list().some(c => c.id === id)) throw new Error('Connection already exists; manage it instead.');
    const type = await choose(io, 'Connection type', ['http', 'stdio'] as const, t => t === 'http' ? 'HTTP service' : 'Local program (stdio; runs with your OS privileges)');
    let candidate: unknown;
    if (type === 'http') candidate = { id, type, url: await io.ask('MCP HTTP URL'), tokenEnv: (await io.ask('Bearer-token environment variable name (blank for none)')).trim() || undefined };
    else {
      const command = (await io.ask('Program executable (Windows: use an .exe, or node.exe with a script argument)')).replace(/^"(.*)"$/, '$1'); const args = [];
      while (true) { const arg = await io.ask(`Argument ${args.length + 1}, without wrapping quotes (blank ends)`); if (!arg) break; args.push(arg); if (args.length >= 40) break; }
      candidate = { id, type, command, args, cwd: resolve((await io.ask('Working folder (blank uses current folder)')).replace(/^"(.*)"$/, '$1') || process.cwd()), envVars: (await io.ask('Environment variable names to pass, comma-separated (blank for none)')).split(',').map(v => v.trim()).filter(Boolean) };
    }
    const parsed = (await import('./connections.js')).Connection.parse(candidate); showMenu(io, 'New connection', [parsed.id, parsed.type === 'http' ? parsed.url : parsed.command + ' ' + parsed.args.join(' '), 'Starts disabled; no tools authorized.']);
    if ((await io.ask('Save disabled connection? [y/N]')).toLowerCase() === 'y') { store.save(parsed); io.print('Saved disabled. Use /mcp manage to test, select allowed tools and enable it.'); }
    return;
  }
  if (action !== 'manage') throw new Error('Use /mcp [list|add|manage]');
  const entry = await choose(io, 'Connection', store.list(), c => `${c.id} (${c.type}, ${c.enabled ? 'enabled' : 'disabled'})`);
  if (entry.id === 'legacy') { io.print('This connection is configured through ROUNDTABLE_MCP_* environment variables. Add a named connection to manage it here.'); return; }
  const operation = await choose(io, 'Action', ['test-and-select-tools', 'enable', 'disable', 'remove', 'select-resources', 'resource-templates', 'oauth-login', 'oauth-logout'] as const, v => v);
  if (operation === 'remove') { store.remove(entry.id); io.print('Connection removed.'); return; }
  if (operation === 'disable') { store.save({ ...entry, enabled: false }); io.print('Connection disabled for future calls; an in-flight invocation may finish.'); return; }
  showMenu(io, 'Connection', [entry.id, entry.type === 'http' ? entry.url : entry.command + ' ' + entry.args.join(' '), 'Allowed tools: ' + entry.tools.join(', ')]);
  const trust = entry.type === 'stdio' ? 'This starts the configured local program with your OS privileges. Trust this executable and its arguments?' : 'This contacts the configured external service with its selected credential. Continue?';
  if ((await io.ask(`${trust} [y/N]`)).toLowerCase() !== 'y') return;
  if (operation === 'enable') { store.save({ ...entry, enabled: true }); io.print('Enabled. Participants still need mcp.remote permission; /grant <name> mcp.remote.'); return; }
  if (operation === 'oauth-login' || operation === 'oauth-logout') {
    if (entry.type !== 'http') throw new Error('OAuth is for HTTP connections');
    if (operation === 'oauth-logout') { logoutMcp(home, entry); store.save({ ...entry, oauth: false, enabled: false }); io.print('OAuth cleared and connection disabled.'); }
    else { const clientId = (await io.ask('Pre-registered OAuth client ID (blank uses server registration)')).trim() || undefined; await loginMcp(home, { ...entry, clientId }, io); store.save({ ...entry, oauth: true, clientId, tokenEnv: undefined }); }
    return;
  }
  if (operation === 'resource-templates') { const page = await store.withClient(entry, AbortSignal.timeout(15000), client => client.listResourceTemplatesPage()); showMenu(io, 'Resource templates', page.resourceTemplates.map(t => t.name + ': ' + t.uriTemplate)); io.print('Substitute parameters, then use select-resources to approve each exact URI.'); return; }
  if (operation === 'select-resources') {
    const page = await store.withClient(entry, AbortSignal.timeout(15000), client => client.listResourcesPage());
    showMenu(io, 'MCP resources (first page)', page.resources.map(r => `${r.name}: ${r.uri}`));
    const resources = (await io.ask('Exact resource URIs to allow, comma-separated (blank allows none)')).split(',').map(v => v.trim()).filter(Boolean);
    store.save({ ...entry, resources: [...new Set(resources)] }); io.print('Exact resource allowlist saved.'); return;
  }
  const available = await store.withClient(entry, AbortSignal.timeout(15000), client => client.listTools());
  showMenu(io, 'Available tools', available.map(t => t.name + ': ' + (t.description ?? '')));
  const allowed = (await io.ask('Exact tool names to allow, comma-separated (blank allows none)')).split(',').map(v => v.trim()).filter(Boolean);
  if (allowed.some(name => !available.some(t => t.name === name))) throw new Error('Unknown tool name; allowlist was not changed');
  store.save({ ...entry, tools: [...new Set(allowed)] } as Connection); io.print('Allowlist saved. Enable the connection when ready.');
}
