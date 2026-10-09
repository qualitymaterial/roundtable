import { unifiedDiff } from './diff.js';
import { readFile, realpath, lstat, mkdir } from 'node:fs/promises';
import { readFileSync, mkdirSync, realpathSync } from 'node:fs';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import type { Engine } from './engine.js';
import { id, timestamp, redact } from './domain.js';
import { guardedWrite, hostPath, undoCheckpoint, sensitiveHostPath, type Checkpoint } from './host-tools.js';
import { workspacePath } from './tools.js';
import { acquireSession } from './session-lock.js';
import type { SandboxResult } from './sandbox.js';

const digest = (content: string) => createHash('sha256').update(content).digest('hex');
type Change = { path: string; beforeHash: string; content: string };
export type ChangeGroup = { id: string; sessionId: string; title: string; root: string; state: 'proposed' | 'applying' | 'applied' | 'accepted' | 'undoing' | 'undone' | 'needs-review'; changes: Change[]; checkpoints: string[]; createdAt: string };
const Changes = z.array(z.object({ path: z.string().min(1).max(2000), beforeHash: z.union([z.literal('new'), z.string().regex(/^[a-f0-9]{64}$/)]), content: z.string().max(256000).refine(s => !s.includes('\0') && Buffer.byteLength(s) <= 256000) }).strict()).min(1).max(100);
export function proposeChanges(engine: Engine, title: string, root: string, input: unknown): ChangeGroup {
  const changes = Changes.parse(input); if (!title.trim() || title.length > 300) throw new Error('Use a title up to 300 characters'); root = realpathSync.native(root);
  const seen = new Set<string>();
  for (const change of changes) {
    if (isAbsolute(change.path) || change.path.split(/[\\/]/).some(p => !p || p === '.' || p === '..') || /:|\0/.test(change.path) || sensitiveHostPath(change.path)) throw new Error('Use nonsensitive relative project file paths');
    const key = resolve(root, change.path).toLowerCase(); if (seen.has(key)) throw new Error('One final change per file is required'); seen.add(key);
  }
  const group: ChangeGroup = { id: id(), sessionId: engine.sessionId, title: redact(title), root, changes, state: 'proposed', checkpoints: [], createdAt: timestamp() };
  engine.repo.put('changegroup', group); engine.repo.event(engine.sessionId, 'change_group_proposed', { id: group.id, title, paths: changes.map(c => c.path) }); return group;
}
export function sandboxChanges(engine: Engine, runId: string): ChangeGroup {
  z.uuid().parse(runId);
  if (!engine.repo.events(engine.sessionId).some(e => e.type === 'sandbox_finished' && (e.data as { runId: string }).runId === runId)) throw new Error('Unknown completed sandbox run in this session');
  const run = JSON.parse(readFileSync(join(dirname(engine.repo.path), 'sandbox-runs', runId, 'result.json'), 'utf8')) as SandboxResult;
  return proposeChanges(engine, `Sandbox ${runId.slice(0, 8)}`, run.root, run.files.map(f => ({ ...f, beforeHash: run.baseHashes[f.path] ?? 'new' })));
}
function get(engine: Engine, key: string): ChangeGroup { const group = engine.repo.get<ChangeGroup>('changegroup', key); if (!group || group.sessionId !== engine.sessionId) throw new Error('Unknown change group'); return group; }
export async function groupCheckpoints(engine: Engine, keys: string[], title: string): Promise<ChangeGroup> {
  if (!keys.length || keys.length > 100 || new Set(keys).size !== keys.length) throw new Error('Choose 1–100 unique checkpoint IDs');
  const checkpoints = keys.map(key => engine.repo.get<Checkpoint>('checkpoint', key));
  if (checkpoints.some(c => !c || c.sessionId !== engine.sessionId || c.state !== 'applied')) throw new Error('Choose applied session checkpoints');
  const root = realpathSync.native(checkpoints.every(c => c!.scope === 'workspace') ? engine.session().workspace : engine.session().projectRoot ?? engine.session().workspace);
  const changes: Change[] = [];
  for (const c of checkpoints as Checkpoint[]) {
    const path = resolve(c.path); if (!path.startsWith(root + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Group checkpoints must belong to the project or shared workspace');
    const content = await readFile(await groupPath(engine, root, path.slice(root.length + 1)), 'utf8'); if (digest(content) !== c.afterHash) throw new Error('Checkpoint is no longer the current file version; select the latest checkpoint per file');
    changes.push({ path: path.slice(root.length + 1), beforeHash: c.before === null ? 'new' : digest(c.before), content });
  }
  const group = proposeChanges(engine, title, root, changes); group.state = 'applied'; group.checkpoints = keys; engine.repo.put('changegroup', group); return group;
}
async function groupPath(engine: Engine, root: string, path: string, write = false): Promise<string> {
  path = path.replaceAll('\\', '/');
  if (root === realpathSync.native(engine.session().workspace)) return workspacePath(root, path);
  try { return await hostPath(engine.session(), join(root, path), write); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    let current = await hostPath(engine.session(), root, write);
    for (const part of path.split('/')) {
      current = join(current, part);
      try { const info = await lstat(current); if (info.isSymbolicLink()) throw new Error('Linked paths are not change-group destinations'); await hostPath(engine.session(), current, write); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
    return current;
  }
}
async function current(path: string) { try { return digest(await readFile(path, 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'new'; throw e; } }
export async function reviewChanges(engine: Engine, key: string): Promise<string[]> {
  const group = get(engine, key); const lines = [group.title, `${group.id} / ${group.state}`, group.root];
  for (const c of group.changes) {
    const path = await groupPath(engine, group.root, c.path, c.beforeHash === 'new');
    const checkpoint = group.checkpoints.map(id => engine.repo.get<Checkpoint>('checkpoint', id)).find(record => record?.path === path);
    const before = checkpoint ? checkpoint.before ?? '' : await current(path) === 'new' ? '' : await readFile(path, 'utf8');
    lines.push(`Expected before: ${c.beforeHash}; current: ${await current(path)}`, ...unifiedDiff(c.path, before, c.content).map(redact));
  }
  return lines;
}
export async function applyChanges(engine: Engine, key: string): Promise<ChangeGroup> {
  if (engine.session().state !== 'paused' || (engine.status() as { running: number }).running) throw new Error('Pause and wait for work before applying changes');
  const group = get(engine, key); if (group.state !== 'proposed') throw new Error('Group is not a fresh proposal; inspect partial work before repair');
  const release = acquireSession(engine.repo.db, `group:${group.root}`);
  try {
    for (const c of group.changes) { const path = await groupPath(engine, group.root, c.path, true); if (await current(path) !== c.beforeHash) throw new Error(`File changed: ${c.path}`); }
    group.state = 'applying'; engine.repo.put('changegroup', group);
    for (const c of group.changes) {
      await mkdir(dirname(await groupPath(engine, group.root, c.path, true)), { recursive: true });
      const result = await guardedWrite(engine, () => groupPath(engine, group.root, c.path, true), c.content, c.beforeHash, new AbortController().signal, group.root === realpathSync.native(engine.session().workspace) ? 'workspace' : 'host', 'human');
      group.checkpoints.push(result.checkpointId); engine.repo.put('changegroup', group);
    }
    group.state = 'applied'; engine.repo.put('changegroup', group); engine.repo.event(engine.sessionId, 'human_change_group_applied', { id: key }); return group;
  } catch (e) { if (group.state === 'applying') { group.state = 'needs-review'; engine.repo.put('changegroup', group); } throw e; } finally { release(); }
}
export async function settleChanges(engine: Engine, key: string, action: 'accept' | 'undo'): Promise<ChangeGroup> {
  if (engine.session().state !== 'paused' || (engine.status() as { running: number }).running) throw new Error('Pause and wait before settling changes');
  const group = get(engine, key); if (!['applied', 'accepted', 'needs-review'].includes(group.state)) throw new Error('No applied changes to settle');
  const records = group.checkpoints.map(key => engine.repo.get<Checkpoint>('checkpoint', key)!);
  if (records.some(c => !c)) throw new Error('Missing group checkpoint; inspect recovery evidence');
  const checkpoints = records.filter(c => c.state !== 'undone');
  if (action === 'accept' && checkpoints.length !== group.changes.length) throw new Error('Partial group cannot be accepted; undo or repair it first');
  for (const c of checkpoints) { if (!c || c.state !== 'applied' || await current(await groupPath(engine, group.root, c.path.slice(group.root.length + 1), true)) !== c.afterHash) throw new Error('A group file changed; refusing to overwrite intervening work'); }
  if (action === 'undo') {
    group.state = 'undoing'; engine.repo.put('changegroup', group);
    try { for (const c of [...checkpoints].reverse()) await undoCheckpoint(engine, c.id); group.state = 'undone'; }
    catch (error) { group.state = 'needs-review'; engine.repo.put('changegroup', group); throw error; }
  } else group.state = 'accepted';
  engine.repo.put('changegroup', group); engine.repo.event(engine.sessionId, `human_change_group_${action}`, { id: key }); return group;
}

export type Worktree = { id: string; sessionId: string; root: string; path: string; branch: string; reviewedHead?: string; reviewedBase?: string; suspended?: boolean };
function git(engine: Engine, root: string, args: string[]): string {
  const hooks = join(dirname(engine.repo.path), 'empty-hooks'); mkdirSync(hooks, { recursive: true });
  return execFileSync('git', ['-c', `core.hooksPath=${hooks}`, '-c', 'core.fsmonitor=false', '-c', 'protocol.file.allow=never', ...args], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
}
export async function createWorktree(engine: Engine, branch: string): Promise<Worktree> {
  if (engine.session().state !== 'paused') throw new Error('Pause before creating a worktree');
  const root = await realpath(engine.session().projectRoot ?? engine.session().workspace);
  await hostPath(engine.session(), root, true);
  if (await realpath(git(engine, root, ['rev-parse', '--show-toplevel'])) !== root) throw new Error('Launch from the Git repository root');
  git(engine, root, ['check-ref-format', '--branch', branch]); if (branch.startsWith('-')) throw new Error('Invalid branch');
  const record: Worktree = { id: id(), sessionId: engine.sessionId, root, path: '', branch };
  const parent = join(dirname(engine.repo.path), 'worktrees'); mkdirSync(parent, { recursive: true }); record.path = join(parent, record.id);
  git(engine, root, ['worktree', 'add', '-b', branch, record.path, 'HEAD']); engine.repo.put('worktree', record); engine.repo.event(engine.sessionId, 'human_worktree_created', record); return record;
}
export async function reviewWorktree(engine: Engine, key: string): Promise<string> {
  const record = engine.repo.get<Worktree>('worktree', key); if (!record || record.sessionId !== engine.sessionId || record.suspended) throw new Error('Unknown or restored worktree; recreate it after project recovery');
  await hostPath(engine.session(), record.root);
  record.reviewedHead = git(engine, record.path, ['rev-parse', 'HEAD']); record.reviewedBase = git(engine, record.root, ['rev-parse', 'HEAD']);
  const diff = git(engine, record.root, ['diff', '--no-ext-diff', '--no-textconv', `${record.reviewedBase}...${record.reviewedHead}`, '--']); engine.repo.put('worktree', record); return redact(diff || 'No committed difference. Commit reviewed work in the worktree first.');
}
export async function mergeWorktree(engine: Engine, key: string): Promise<string> {
  const record = engine.repo.get<Worktree>('worktree', key); if (!record?.reviewedHead || !record.reviewedBase || record.sessionId !== engine.sessionId || record.suspended) throw new Error('Review the worktree first');
  if (engine.session().state !== 'paused') throw new Error('Pause before merging'); await hostPath(engine.session(), record.root, true);
  if (git(engine, record.root, ['status', '--porcelain']) || git(engine, record.path, ['status', '--porcelain'])) throw new Error('Both worktrees must be clean before merge');
  if (git(engine, record.path, ['rev-parse', 'HEAD']) !== record.reviewedHead || git(engine, record.root, ['rev-parse', 'HEAD']) !== record.reviewedBase) throw new Error('Commit changed since review; review again');
  try { return git(engine, record.root, ['merge', '--no-commit', '--no-ff', record.reviewedHead]) + '\nInspect git status, then commit or git merge --abort. No automatic commit or push.'; }
  finally { engine.repo.event(engine.sessionId, 'human_worktree_merge_attempt', { id: key, head: record.reviewedHead, base: record.reviewedBase }); }
}
