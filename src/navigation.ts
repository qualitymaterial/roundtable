import type { MenuIO } from './input.js';
import type { Repository } from './storage.js';
import type { SessionRecord } from './domain.js';

/** Bounded, searchable menus work in ordinary terminals and scripted input alike. */
export async function searchChoose<T>(io: MenuIO, label: string, entries: readonly T[], display: (entry: T) => string, initialQuery = ''): Promise<T> {
  if (!entries.length) throw new Error(`No ${label.toLowerCase()} available.`);
  let query = initialQuery; let page = 0; const size = 12;
  while (true) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = entries.filter(e => terms.every(t => display(e).toLowerCase().includes(t)));
    const pages = Math.max(1, Math.ceil(matches.length / size)); page = Math.min(page, pages - 1);
    const visible = matches.slice(page * size, (page + 1) * size);
    const title = `${label} / ${matches.length} matches / page ${page + 1} of ${pages}`;
    const rows = [...(query ? [`Search: ${query}`, ''] : []), ...visible.map((e, i) => `${i + 1}. ${display(e)}`)];
    if (!visible.length) rows.push('No matches. Try another search or type all.');
    if (io.menu) io.menu(title, rows, 'Choose a number or search. next / prev / all / cancel'); else io.print(`${title}\n${rows.join('\n')}`);
    const answer = (await io.ask('Number, search words, next, prev, all, or cancel')).trim();
    if (answer.toLowerCase() === 'cancel') throw new Error('Cancelled');
    if (answer === 'next') { page = (page + 1) % pages; continue; }
    if (answer === 'prev') { page = (page + pages - 1) % pages; continue; }
    if (answer === 'all') { query = ''; page = 0; continue; }
    if (/^\d+$/.test(answer)) { const value = visible[Number(answer) - 1]; if (value !== undefined) return value; io.print('Choose a displayed number.'); continue; }
    query = answer; page = 0;
  }
}

export type CommandEntry = { command: string; description: string; arguments?: string };
export function commandEntries(help: string): CommandEntry[] {
  const menuCommands = new Set(['/model', '/login', '/logout', '/skills', '/mcp', '/favorites', '/endpoints', '/diagnostics', '/sessions', '/commands']);
  const entries = new Map<string, CommandEntry>();
  for (const line of help.split('\n').filter(l => l.startsWith('/'))) for (const part of line.split(' | ')) {
    const match = /^(\/[a-z-]+)(.*)$/.exec(part); if (!match || entries.has(match[1]!)) continue;
    const command = match[1]!; if (command === '/skill') continue;
    const description = match[2]!.trim();
    entries.set(command, { command, description, arguments: description.includes('<') && !menuCommands.has(command) ? description : undefined });
  }
  return [...entries.values()];
}
export async function commandPicker(io: MenuIO, entries: CommandEntry[], query = ''): Promise<string> {
  const entry = await searchChoose(io, 'Commands', entries, e => `${e.command} ${e.description}`, query);
  if (!entry.arguments) return entry.command;
  const args = (await io.ask(`${entry.command} ${entry.arguments}`)).trim();
  if (!args) throw new Error('Arguments required; command was not executed.');
  return `${entry.command} ${args}`;
}

export function recentSessions(repo: Repository): (SessionRecord & { lastActivity: string })[] {
  const rows = repo.db.prepare("SELECT session_id, MAX(timestamp) AS latest FROM events GROUP BY session_id").all();
  const activity = new Map(rows.map(r => [String(r.session_id), String(r.latest)]));
  return repo.list<SessionRecord>('session').filter(s => !s.archived).map(s => ({ ...s, lastActivity: activity.get(s.id) ?? s.createdAt }))
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity) || b.id.localeCompare(a.id));
}
export async function sessionPicker(repo: Repository, io: MenuIO, current?: string): Promise<string> {
  const session = await searchChoose(io, 'Sessions', recentSessions(repo), s => `${(s.name ?? s.objective).replace(/\s+/g, ' ').slice(0, 100)} — ${s.completion ? 'finished' : s.state} — ${s.lastActivity} — ${s.id}${s.id === current ? ' (current)' : ''}`);
  return session.id;
}
