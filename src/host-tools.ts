import { Type } from 'typebox';
import { z } from 'zod';
import { open, opendir, realpath, stat, mkdir, rename, unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve, dirname, basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { id, redact, type Approval, type SessionRecord } from './domain.js';
import type { ToolRegistry } from './tools.js';
import type { Engine } from './engine.js';
import { acquireSession } from './session-lock.js';

export const HostAccess = z.object({ readRoots: z.array(z.string().min(1)).max(32).default([]), writeRoots: z.array(z.string().min(1)).max(32).default([]), shell: z.boolean().default(false) }).strict();
export type HostPolicy = z.output<typeof HostAccess>;
export const hostCapabilities = (policy: HostPolicy): string[] => [...(policy.readRoots.length || policy.writeRoots.length ? ['host.read'] : []), ...(policy.writeRoots.length ? ['host.write'] : []), ...(policy.shell ? ['host.execute'] : [])];
// A useful guard against accidental credential reads, not a general secret detector.
export function sensitiveHostPath(path: string): boolean {
  return path.split(/[\\/]/).some(part => /^(?:\.ssh|\.aws|\.azure|\.gnupg|\.kube|\.codex|\.pi|\.claude|\.hermes|\.opencode|\.roundtable|\.git|\.env(?:\..*)?|\.npmrc|\.netrc|auth\.(?:json|ya?ml|toml|ini)|credentials?(?:\.(?:json|ya?ml|toml|ini))?|secrets?(?:\.(?:json|ya?ml|toml|ini))?|.*\.(?:pem|key|pfx|p12)|id_(?:rsa|ed25519)|Login Data|Local State|Cookies|(?:CON|NUL|AUX|PRN|COM[1-9]|LPT[1-9])(?:\..*)?)$/i.test(part));
}
const inside = (root: string, target: string) => { const rel = relative(root, target); return !rel || (!rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && rel !== '..' && !isAbsolute(rel)); };
export async function normalizeHostPolicy(input: unknown): Promise<HostPolicy> {
  const policy = HostAccess.parse(input);
  for (const key of ['readRoots', 'writeRoots'] as const) {
    policy[key] = [...new Set(await Promise.all(policy[key].map(async root => {
      if (!isAbsolute(root) || /^[/\\]{2}/.test(root)) throw new Error('Use an absolute local directory; UNC shares are not enabled');
      const canonical = await realpath(root);
      if (!(await stat(canonical)).isDirectory() || sensitiveHostPath(canonical)) throw new Error('Invalid or sensitive host root');
      return canonical;
    })))];
  }
  return policy;
}
export async function hostPath(session: SessionRecord, path: string, write = false): Promise<string> {
  if (!isAbsolute(path) || path.includes('\0') || /^[/\\]{2}/.test(path) || (process.platform === 'win32' && path.slice(2).includes(':'))) throw new Error('Use an absolute local path without alternate data streams');
  const target = resolve(path); if (sensitiveHostPath(target)) throw new Error('Sensitive credential or runtime path is excluded');
  const policy = HostAccess.parse(session.hostAccess ?? {});
  const roots = write ? policy.writeRoots : [...policy.readRoots, ...policy.writeRoots];
  let canonical: string;
  try { canonical = await realpath(target); }
  catch (error) {
    if (!write || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    canonical = join(await realpath(dirname(target)), basename(target));
  }
  if (sensitiveHostPath(canonical) || !roots.some(root => inside(root, canonical))) throw new Error('Resolved path is outside authorized roots, escapes them, or is sensitive; ask the human to use /host-read or /host-write');
  return canonical;
}
async function textFile(path: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted(); const handle = await open(path, 'r');
  try {
    const info = await handle.stat(); if (!info.isFile() || info.size > 256000) throw new Error('Only regular UTF-8 text files up to 256 KB are supported');
    const buffer = Buffer.alloc(256001); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 256000 || buffer.subarray(0, bytesRead).includes(0)) throw new Error('File is too large or binary');
    signal.throwIfAborted(); return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead));
  } finally { await handle.close(); }
}
const digest = (content: string) => createHash('sha256').update(content).digest('hex');
export type Checkpoint = { id: string; sessionId: string; path: string; before: string | null; afterHash: string; createdAt: string; state: 'prepared' | 'applied' | 'undone' };
export function listCheckpoints(engine: Engine) {
  return engine.repo.list<Checkpoint>('checkpoint', engine.sessionId).map(({ before, ...entry }) => ({ ...entry, createdFile: before === null }));
}
export async function previewCheckpoint(engine: Engine, checkpointId: string): Promise<string> {
  const entry = engine.repo.get<Checkpoint>('checkpoint', checkpointId);
  if (!entry || entry.sessionId !== engine.sessionId || entry.state !== 'applied') throw new Error('Unknown applied checkpoint');
  const path = await hostPath(engine.session(), entry.path);
  const current = await textFile(path, new AbortController().signal);
  if (digest(current) !== entry.afterHash) throw new Error('File changed since this checkpoint; inspect the current file before restoring.');
  const before = (entry.before ?? '').split('\n'); const after = current.split('\n');
  let start = 0; while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length; let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
  const removed = before.slice(start, endBefore); const added = after.slice(start, endAfter);
  const lines = [`--- ${entry.before === null ? '(new file)' : path}`, `+++ ${path}`, `Changed span from line ${start + 1}: ${removed.length} old / ${added.length} new lines`, ...removed.slice(0, 100).map(line => '-' + line), ...added.slice(0, 100).map(line => '+' + line)];
  if (removed.length > 100 || added.length > 100) lines.push('[Preview truncated to 100 lines per side]');
  return redact(lines.join('\n').slice(0, 30000));
}
export async function undoCheckpoint(engine: Engine, checkpointId: string): Promise<void> {
  const entry = engine.repo.get<Checkpoint>('checkpoint', checkpointId);
  if (!entry || entry.sessionId !== engine.sessionId || entry.state !== 'applied') throw new Error('Unknown applied checkpoint');
  const path = await hostPath(engine.session(), entry.path, true);
  const release = acquireSession(engine.repo.db, `file:${path}`);
  try {
    const signal = new AbortController().signal;
    if (digest(await textFile(path, signal)) !== entry.afterHash) throw new Error('File changed since this checkpoint; refusing to overwrite subsequent work.');
    if (entry.before === null) await unlink(path);
    else {
      const temp = join(dirname(path), `.roundtable-undo-${id()}`);
      try {
        const handle = await open(temp, 'wx', (await stat(path)).mode); try { await handle.writeFile(entry.before, 'utf8'); } finally { await handle.close(); }
        await hostPath(engine.session(), path, true);
        if (digest(await textFile(path, signal)) !== entry.afterHash) throw new Error('File changed while preparing restore');
        await rename(temp, path);
      } finally { await unlink(temp).catch(() => {}); }
    }
    entry.state = 'undone'; engine.repo.put('checkpoint', entry); engine.repo.event(engine.sessionId, 'checkpoint_undone', { id: entry.id, path });
  } finally { release(); }
}
export function installHostTools(registry: ToolRegistry): void {
  const engine = registry.engine;
  const pathSchema = Type.String({ minLength: 1, maxLength: 2000 });
  registry.register('host_roots', 'Discover authorized local filesystem roots and host command policy. Host operations run as the human OS user.', Type.Object({}), 'collaborate', () => HostAccess.parse(engine.session().hostAccess ?? {}));
  registry.register('host_list', 'List a local directory under an authorized host root. Excludes credential/runtime paths; bounded to 300 entries.', Type.Object({ path: pathSchema }), 'host.read', async ({ path }, { signal }) => {
    const folder = await hostPath(engine.session(), path); const entries = []; let truncated = false;
    const dir = await opendir(folder);
    for await (const entry of dir) {
      signal.throwIfAborted();
      if (sensitiveHostPath(entry.name)) continue;
      if (entries.length >= 300) { truncated = true; break; }
      entries.push({ name: entry.name, kind: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'link' : 'file' });
    }
    return { path: folder, entries: entries.sort((a, b) => a.name.localeCompare(b.name)), truncated };
  });
  registry.register('host_read', 'Read bounded UTF-8 text from an authorized host path. Use offset/limit for concise context; returns a SHA-256 for safe editing.', Type.Object({ path: pathSchema, offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 32000 })) }), 'host.read', async ({ path, offset = 0, limit = 12000 }, { signal }) => {
    const canonical = await hostPath(engine.session(), path); const content = await textFile(canonical, signal);
    return { path: canonical, content: content.slice(offset, offset + limit), length: content.length, sha256: digest(content), truncated: offset + limit < content.length };
  });
  registry.register('host_search', 'Recursively search file names or literal UTF-8 text under an authorized directory. No regex/code execution; skips links, credentials, caches and dependencies. Bounded traversal and results.', Type.Object({ path: pathSchema, query: Type.String({ minLength: 1, maxLength: 300 }), content: Type.Optional(Type.Boolean()) }), 'host.read', async ({ path, query, content = false }, { signal }) => {
    const root = await hostPath(engine.session(), path); const pending = [{ path: root, depth: 0 }]; const matches: { path: string; preview?: string }[] = [];
    let visited = 0; let skipped = 0; const deadline = Date.now() + 10000;
    while (pending.length && visited < 2000 && matches.length < 50 && Date.now() < deadline) {
      signal.throwIfAborted(); const current = pending.shift()!;
      try {
        const dir = await opendir(await hostPath(engine.session(), current.path));
        for await (const entry of dir) {
          signal.throwIfAborted(); if (++visited > 2000 || matches.length >= 50 || Date.now() >= deadline) break;
          const candidate = join(current.path, entry.name);
          if (sensitiveHostPath(candidate) || entry.isSymbolicLink() || /^(node_modules|dist|\.cache|AppData|Windows|\$.*)$/i.test(entry.name)) { skipped++; continue; }
          if (entry.name.toLowerCase().includes(query.toLowerCase())) matches.push({ path: candidate });
          if (entry.isDirectory() && current.depth < 10) pending.push({ path: candidate, depth: current.depth + 1 });
          else if (content && entry.isFile() && matches.length < 50) {
            try {
              const text = await textFile(await hostPath(engine.session(), candidate), signal); const at = text.toLowerCase().indexOf(query.toLowerCase());
              if (at !== -1) matches.push({ path: candidate, preview: text.slice(Math.max(0, at - 80), at + 220) });
            } catch { skipped++; }
          }
        }
      } catch (error) { signal.throwIfAborted(); if (current.path === root) throw error; skipped++; }
    }
    return { matches, visited, skipped, bounded: true, truncated: pending.length > 0 || visited >= 2000 || matches.length >= 50 || Date.now() >= deadline };
  });
  registry.register('host_write', 'Create or replace a UTF-8 file under authorized write roots. Existing files REQUIRE the SHA-256 from host_read; new files require expectedHash="new". No delete tool.', Type.Object({ path: pathSchema, content: Type.String({ maxLength: 256000 }), expectedHash: Type.String({ minLength: 3, maxLength: 64 }) }), 'host.write', async ({ path, content, expectedHash }, { signal }) => {
    const canonical = await hostPath(engine.session(), path, true); signal.throwIfAborted();
    if (Buffer.byteLength(content) > 256000) throw new Error('File exceeds 256 KB');
    const release = acquireSession(engine.repo.db, `file:${canonical}`);
    try {
    const before = expectedHash === 'new' ? null : await textFile(canonical, signal);
    if (before !== null && digest(before) !== expectedHash) throw new Error('File changed; read it again before editing');
    const checkpoint: Checkpoint = { id: id(), sessionId: engine.sessionId, path: canonical, before, afterHash: digest(content), createdAt: new Date().toISOString(), state: 'prepared' };
    engine.repo.put('checkpoint', checkpoint);
    if (expectedHash === 'new') {
      const handle = await open(canonical, 'wx', 0o600); try { await handle.writeFile(content, { encoding: 'utf8', signal }); } finally { await handle.close(); }
    } else {
      if (digest(await textFile(canonical, signal)) !== expectedHash) throw new Error('File changed; read it again before editing');
      const mode = (await stat(canonical)).mode;
      const temp = join(dirname(canonical), `.roundtable-edit-${id()}`);
      try {
        const handle = await open(temp, 'wx', mode); try { await handle.writeFile(content, { encoding: 'utf8', signal }); } finally { await handle.close(); }
        await hostPath(engine.session(), path, true); signal.throwIfAborted();
        if (digest(await textFile(canonical, signal)) !== expectedHash) throw new Error('File changed while preparing edit');
        await rename(temp, canonical);
      } finally { await unlink(temp).catch(() => {}); }
    }
    checkpoint.state = 'applied'; engine.repo.put('checkpoint', checkpoint);
    engine.repo.event(engine.sessionId, 'checkpoint_created', { id: checkpoint.id, path: canonical, afterHash: checkpoint.afterHash });
    return { path: canonical, sha256: digest(content), bytes: Buffer.byteLength(content), checkpointId: checkpoint.id };
    } finally { release(); }
  });
  registry.register('host_mkdir', 'Create a single directory under an authorized write root. Parent must already exist.', Type.Object({ path: pathSchema }), 'host.write', async ({ path }, { signal }) => {
    const canonical = await hostPath(engine.session(), path, true); signal.throwIfAborted(); await mkdir(canonical); return { path: canonical };
  });
  registry.register('host_execute', 'Request then execute an exact host shell command after single-use human approval. UNSANDBOXED: OS user privileges, filesystem/network access. Use for builds, tests and Git. Retry the exact command after approval.', Type.Object({ command: Type.String({ minLength: 1, maxLength: 12000 }), cwd: pathSchema }), 'host.execute', async ({ command, cwd }, { agent, signal }) => {
    if (!engine.session().hostAccess?.shell) throw new Error('Host shell is disabled; human must use /host-shell on');
    const canonical = await hostPath(engine.session(), cwd); if (!(await stat(canonical)).isDirectory()) throw new Error('Command cwd must be a directory');
    const fingerprint = digest(JSON.stringify({ command, cwd: canonical, agentId: agent.id }));
    const prior = engine.repo.list<Approval>('approval', engine.sessionId).find(a => a.agentId === agent.id && a.command?.fingerprint === fingerprint && ['pending', 'approved'].includes(a.state));
    if (!prior || prior.state === 'pending') {
      const approval: Approval = prior ?? { id: id(), sessionId: engine.sessionId, agentId: agent.id, capability: 'host.execute', reason: 'Run exact command with host OS user privileges (not sandboxed)', state: 'pending', command: { text: command, cwd: canonical, fingerprint } };
      if (!prior) { engine.repo.put('approval', approval); engine.repo.event(engine.sessionId, 'host_command_requested', approval); engine.emit('activity', { type: 'approval', text: `${agent.name} requests host command in ${canonical}:\n${redact(command)}\n/approve ${approval.id} or /reject ${approval.id}` }); }
      return { approvalRequired: true, approvalId: approval.id, command, cwd: canonical, instruction: 'Stop and wait for the human; retry the exact invocation after approval. Do not poll.' };
    }
    prior.state = 'consumed'; engine.repo.put('approval', prior); engine.repo.event(engine.sessionId, 'host_command_consumed', { approvalId: prior.id });
    return executeHost(command, canonical, signal);
  });
  registry.register('host_job_start', 'Request an approved background host command. Returns a durable job ID. Unsandboxed OS privileges; max four jobs, bounded logs. Jobs stop when this harness exits.', Type.Object({ command: Type.String({ minLength: 1, maxLength: 12000 }), cwd: pathSchema, timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 3600000 })) }), 'host.execute', async ({ command, cwd, timeoutMs = 600000 }, { agent }) => {
    if (!engine.session().hostAccess?.shell) throw new Error('Host shell is disabled');
    const canonical = await hostPath(engine.session(), cwd); if (!(await stat(canonical)).isDirectory()) throw new Error('Command cwd must be a directory');
    const fingerprint = digest(JSON.stringify({ command, cwd: canonical, agentId: agent.id, background: true, timeoutMs }));
    const prior = engine.repo.list<Approval>('approval', engine.sessionId).find(a => a.agentId === agent.id && a.command?.fingerprint === fingerprint && ['pending', 'approved'].includes(a.state));
    if (!prior || prior.state === 'pending') {
      const approval: Approval = prior ?? { id: id(), sessionId: engine.sessionId, agentId: agent.id, capability: 'host.execute', reason: `Background host command, ${timeoutMs / 1000}s timeout (not sandboxed)`, state: 'pending', command: { text: command, cwd: canonical, fingerprint, background: true, timeoutMs } };
      if (!prior) { engine.repo.put('approval', approval); engine.repo.event(engine.sessionId, 'host_command_requested', approval); engine.emit('activity', { type: 'approval', text: `${approval.reason}: ${redact(command)}; /approve ${approval.id}` }); }
      return { approvalRequired: true, approvalId: approval.id, instruction: 'Wait for the human, then retry this exact invocation once.' };
    }
    prior.state = 'consumed'; engine.repo.put('approval', prior); return engine.jobs.start(agent.id, command, canonical, timeoutMs);
  });
  registry.register('host_job_read', 'Read a session background job and its bounded log.', Type.Object({ jobId: Type.String() }), 'host.execute', ({ jobId }) => engine.jobs.read(jobId));
  registry.register('host_job_stop', 'Cancel a session background job.', Type.Object({ jobId: Type.String() }), 'host.execute', async ({ jobId }) => { await engine.jobs.stop(jobId); return engine.jobs.read(jobId); });
}
export async function executeHost(command: string, cwd: string, signal: AbortSignal, timeoutMs = 60000, onOutput?: (output: string) => void): Promise<unknown> {
  signal.throwIfAborted();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|LANG|LC_ALL)$/i.test(key)));
  return new Promise((resolveResult, reject) => {
    const shell = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : '/bin/sh';
    const args = process.platform === 'win32' ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command];
    // Own cancellation rather than spawn's AbortError: await close before releasing
    // the job/DB, and terminate the tree before its leader disappears on Windows.
    const child = spawn(shell, args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let stopped: string | undefined;
    const stop = (reason: string) => {
      stopped ??= reason;
      if (process.platform === 'win32' && child.pid) { const kill = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); kill.on('error', () => child.kill()); kill.on('exit', code => { if (code !== 0) child.kill(); }); }
      else { try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    };
    const abort = () => stop('cancelled'); signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop(`${timeoutMs / 1000} second timeout`), timeoutMs);
    const capture = (data: Buffer) => { output += data.toString(); if (Buffer.byteLength(output) > 64000) { output = output.slice(0, 32000); stop('output limit'); } onOutput?.(redact(output)); };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    child.once('error', error => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(error); });
    child.once('close', (code, exitSignal) => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolveResult({ code, signal: exitSignal, stopped, output: redact(output) }); });
  });
}
