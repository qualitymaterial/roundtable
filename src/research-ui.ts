import { researchConfig, saveResearch, ResearchConfig, ResearchService } from './research.js';
import { askValidated, choose, fieldError, showMenu, type MenuIO } from './input.js';
import type { Engine } from './engine.js';

export async function researchMenu(home: string, engine: Engine, io: MenuIO, action = '') {
  action ||= await choose(io, 'Research', ['settings', 'search', 'fetch', 'sources', 'clear-cache'], s => s);
  if (action === 'settings') {
    const current = researchConfig(home); const adapter = await choose(io, 'Search adapter', ['searxng', 'json'] as const, s => s);
    const searchUrl = (await askValidated(io, 'Search endpoint URL (blank disables search)', value => { try { ResearchConfig.parse({ searchUrl: value || undefined }); return undefined; } catch (error) { return fieldError(error); } })).trim() || undefined;
    const tokenEnv = (await io.ask('Optional search-token environment variable NAME')).trim() || undefined;
    const fetchOrigins = (await askValidated(io, 'Origins agents may fetch, comma-separated; blank denies all', value => { try { ResearchConfig.parse({ fetchOrigins: value.split(',').map(s => s.trim()).filter(Boolean) }); return undefined; } catch (error) { return fieldError(error); } })).split(',').map(s => s.trim()).filter(Boolean);
    const next = ResearchConfig.parse({ ...current, adapter, searchUrl, tokenEnv, fetchOrigins });
    showMenu(io, 'Research access', [searchUrl ?? 'Search disabled', ...fetchOrigins, 'Fetched pages receive no cookies or credentials. Redirects and JavaScript are disabled.']);
    if ((await io.ask('Save this network policy? [y/N]')).toLowerCase() === 'y') { saveResearch(home, next); io.print('Research settings saved. Participants still require network.research permission.'); }
    return;
  }
  if (action === 'clear-cache') { engine.repo.db.prepare("DELETE FROM entities WHERE kind='research' AND session_id=?").run(engine.sessionId); io.print('Session research cache cleared.'); return; }
  if (action === 'sources') { showMenu(io, 'Saved source snapshots', engine.repo.list<{ id: string; retrievedAt: string; sources: { title: string; url: string }[] }>('research', engine.sessionId).flatMap(r => [r.id + ' / ' + r.retrievedAt, ...r.sources.map(s => s.title + '\n' + s.url)])); return; }
  if (action !== 'search' && action !== 'fetch') throw new Error('Use settings, search, fetch, sources or clear-cache');
  const result = await new ResearchService(engine.repo, engine.sessionId).run(action, await io.ask(action === 'search' ? 'Search query' : 'Page URL'), new AbortController().signal);
  showMenu(io, 'Research ' + (result.cached ? '(cached)' : '(retrieved)'), [result.retrievedAt + ' / ' + result.hash, ...result.sources.flatMap(s => [s.title, s.url, s.text])]);
}
