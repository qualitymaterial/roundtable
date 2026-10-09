import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, lstatSync, readFileSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import { z } from 'zod';
import type { Engine } from './engine.js';
import type { ToolRegistry } from './tools.js';
import { id, redact, timestamp } from './domain.js';
import { sensitiveHostPath } from './host-tools.js';

export type SandboxGrant = { id: string; sessionId: string; agentId: string; root: string; expiresAt: string; revoked: boolean };
export function parseSandboxArgv(text: string): string[] {
  const args: string[] = []; let part = ''; let quote = ''; let started = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\\' && quote && text[i + 1] === quote) { part += text[++i]; started = true; }
    else if (quote) { if (c === quote) quote = ''; else part += c; }
    else if (c === '"' || c === "'") { quote = c; started = true; }
    else if (/\s/.test(c)) { if (started) { args.push(part); part = ''; started = false; } }
    else { part += c; started = true; }
  }
  if (quote) throw new Error('Unclosed command quote'); if (started) args.push(part);
  if (!args[0]) throw new Error('Enter an executable and optional arguments'); return args;
}
export const activeSandboxRuns = new Set<string>();
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const linux = (path: string) => process.platform === 'win32' ? execFileSync('wsl.exe', ['-d', 'Ubuntu', '--exec', '/usr/bin/wslpath', '-a', path], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim() : path;
const command = (args: string[]) => process.platform === 'win32' ? { exe: 'wsl.exe', args: ['-d', 'Ubuntu', '--exec', ...args] } : { exe: args[0]!, args: args.slice(1) };
export function sandboxDoctor(): string {
  const invocation = command(['/usr/bin/bwrap', '--unshare-all', '--die-with-parent', '--new-session', '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev', '--clearenv', '/bin/sh', '-c', 'test ! -e /home && test ! -e /mnt/c && test "$(wc -l < /proc/net/route)" -eq 1 && echo "Isolation probe passed"']);
  return execFileSync(invocation.exe, invocation.args, { encoding: 'utf8', timeout: 15000, windowsHide: true }).trim();
}
export function grantSandbox(engine: Engine, agentId: string, root: string, minutes = 30): SandboxGrant {
  if (!engine.agents().some(a => a.id === agentId && a.state !== 'removed')) throw new Error('Unknown participant');
  const canonical = realpathSync.native(root);
  if (!lstatSync(canonical).isDirectory() || sensitiveHostPath(canonical) || canonical === dirname(canonical)) throw new Error('Choose a nonsensitive project directory');
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) throw new Error('Grant must last 1–120 minutes');
  sandboxDoctor();
  const grant = { id: id(), sessionId: engine.sessionId, agentId, root: canonical, expiresAt: new Date(Date.now() + minutes * 60000).toISOString(), revoked: false };
  engine.repo.put('sandbox', grant); engine.repo.event(engine.sessionId, 'human_sandbox_grant', grant); return grant;
}
export function revokeSandbox(engine: Engine, grantId: string): void {
  const grant = engine.repo.get<SandboxGrant>('sandbox', grantId); if (!grant || grant.sessionId !== engine.sessionId) throw new Error('Unknown session grant');
  grant.revoked = true; engine.repo.put('sandbox', grant); engine.repo.event(engine.sessionId, 'human_sandbox_revoked', { grantId });
}
function snapshot(root: string, destination: string): Record<string, string> {
  const files: Record<string, string> = {}; let bytes = 0; let count = 0;
  const walk = (folder: string, rel = '', depth = 0) => {
    if (depth > 20) throw new Error('Project snapshot exceeds 20 directory levels');
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const key = rel ? `${rel}/${entry.name}` : entry.name;
      if (sensitiveHostPath(key) || /(^|\/)(node_modules|\.cache|artifacts)(\/|$)/.test(key)) continue;
      const path = join(folder, entry.name); const info = lstatSync(path);
      if (info.isSymbolicLink()) continue;
      const dest = join(destination, key);
      if (info.isDirectory()) { mkdirSync(dest, { recursive: true }); walk(path, key, depth + 1); }
      else if (info.isFile()) {
        if (++count > 5000 || (bytes += info.size) > 32 * 1024 * 1024) throw new Error('Project snapshot exceeds 5000 files or 32 MiB; choose a smaller root');
        const data = readFileSync(path); if (data.length !== info.size || realpathSync.native(path) !== resolve(path)) throw new Error('Project changed while snapshotting');
        writeFileSync(dest, data, { mode: 0o600 }); files[key] = hash(data);
      }
    }
  }; walk(root); return files;
}
const Result = z.object({ exitCode: z.number().int(), output: z.string().max(65536), files: z.array(z.object({ path: z.string().max(2000), content: z.string().max(256000) })).max(100), truncated: z.boolean() }).strict();
export type SandboxResult = z.output<typeof Result> & { runId: string; directory: string; baseHashes: Record<string, string>; root: string };
// Host-controlled supervisor lives inside the namespace. The command has no access to its parent or credentials.
const supervisor = `import os,sys,json,subprocess,hashlib,shutil,stat
shutil.copytree('/input','/work',dirs_exist_ok=True)
before={}
for root,dirs,files in os.walk('/work'):
 for name in files:
  p=os.path.join(root,name); before[p]=hashlib.sha256(open(p,'rb').read()).hexdigest()
with open('/tmp/output','wb') as log:
 p=subprocess.run(json.loads(sys.argv[1]),cwd='/work',stdout=log,stderr=log,env={'PATH':'/usr/bin:/bin','HOME':'/tmp','TMPDIR':'/tmp'},check=False)
changed=[]; total=0; truncated=False
for root,dirs,files in os.walk('/work',followlinks=False):
 dirs[:]=[d for d in dirs if not os.path.islink(os.path.join(root,d))]
 for name in files:
  path=os.path.join(root,name); info=os.lstat(path)
  if not stat.S_ISREG(info.st_mode) or info.st_size>256000: continue
  data=open(path,'rb').read(256001)
  if 0 in data or hashlib.sha256(data).hexdigest()==before.get(path): continue
  total+=len(data)
  if len(changed)>=100 or total>2000000: truncated=True; continue
  try: content=data.decode('utf-8')
  except UnicodeDecodeError: continue
  changed.append({'path':os.path.relpath(path,'/work'),'content':content})
with open('/tmp/output','rb') as log: output=log.read(64000).decode('utf-8',errors='replace')
print(json.dumps({'exitCode':p.returncode,'output':output,'files':changed,'truncated':truncated or os.stat('/tmp/output').st_size>64000}))
`;
export async function runSandbox(engine: Engine, agentId: string, grantId: string, argv: string[], signal = new AbortController().signal, injected?: { name: string; data: Buffer }): Promise<SandboxResult> {
  z.array(z.string().max(16000).refine(s => !s.includes('\0'))).min(1).max(64).parse(argv); if (!argv[0]) throw new Error('Executable required');
  const authorized = () => { const grant = engine.repo.get<SandboxGrant>('sandbox', grantId); if (!grant || grant.sessionId !== engine.sessionId || grant.agentId !== agentId || grant.revoked || Date.parse(grant.expiresAt) <= Date.now()) throw new Error('Sandbox grant absent, expired or revoked'); return grant; };
  const grant = authorized(); signal.throwIfAborted();
  const runs = join(dirname(engine.repo.path), 'sandbox-runs'); mkdirSync(runs, { recursive: true }); const staging = mkdtempSync(join(runs, 'input-')); const input = join(staging, 'input'); mkdirSync(input);
  let baseHashes: Record<string, string>;
  try { baseHashes = snapshot(grant.root, input); } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
  if (injected) { if (!/^[a-zA-Z0-9._-]{1,200}$/.test(injected.name) || injected.data.length > 2 * 1024 * 1024) throw new Error('Invalid validation input'); writeFileSync(join(input, injected.name), injected.data, { flag: 'wx', mode: 0o600 }); baseHashes[injected.name] = hash(injected.data); }
  const runId = id(); const pidFile = linux(join(staging, 'pid')); const guestInput = linux(input);
  const args = ['/usr/bin/timeout', '--kill-after=1', '30', '/usr/bin/bwrap', '--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev', '--ro-bind', guestInput, '/input', '--size', '67108864', '--tmpfs', '/work', '--size', '8388608', '--tmpfs', '/tmp', '--chdir', '/work', '--clearenv', '--setenv', 'PATH', '/usr/bin:/bin', '/usr/bin/prlimit', '--as=268435456', '--nproc=32', '--fsize=8388608', '--cpu=15', '--nofile=128', '--', '/usr/bin/python3', '-c', supervisor, JSON.stringify(argv)];
  const invocation = command(['/bin/sh', '-c', 'echo $$ > "$1"; shift; exec "$@"', 'roundtable', pidFile, ...args]);
  activeSandboxRuns.add(runId);
  engine.repo.event(engine.sessionId, 'sandbox_started', { runId, grantId, agentId, argv, limits: '30s wall / 15s CPU per process / 256 MiB address space per process / 32 user processes / 64 MiB work / 8 MiB tmp / network none' });
  try {
    const raw = await new Promise<string>((res, rej) => {
      const child = spawn(invocation.exe, invocation.args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH } : { PATH: '/usr/bin:/bin' } });
      let output = ''; let error = ''; let failure: Error | undefined;
      const stop = (reason: Error) => { if (failure) return; failure = reason; const kill = command(['/bin/sh', '-c', 'test -f "$1" && kill -TERM "$(cat "$1")"', 'roundtable', pidFile]); const cleanup = spawn(kill.exe, kill.args, { stdio: 'ignore', windowsHide: true }); cleanup.on('error', () => {}); };
      const abort = () => stop(new Error('Sandbox cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      const watch = setInterval(() => { try { authorized(); if (engine.session().state !== 'active') throw new Error('Session paused'); } catch (e) { stop(e as Error); } }, 100);
      const deadline = setTimeout(() => { stop(new Error('Sandbox watchdog timeout')); child.kill(); }, 35000);
      child.stdout.on('data', (b: Buffer) => { if (output.length + b.length > 3 * 1024 * 1024) stop(new Error('Sandbox output limit')); else output += b.toString(); });
      child.stderr.on('data', (b: Buffer) => { error = (error + b.toString()).slice(0, 4000); });
      const clear = () => { clearInterval(watch); clearTimeout(deadline); signal.removeEventListener('abort', abort); };
      child.on('error', e => { clear(); rej(e); }); child.on('close', code => { clear(); if (failure) rej(failure); else if (code !== 0) rej(new Error(`Sandbox failed (${code}): ${redact(error)}`)); else res(output); });
    });
    authorized(); signal.throwIfAborted(); const result = Result.parse(JSON.parse(raw)); const directory = join(runs, runId); mkdirSync(directory);
    const files = result.files.filter(f => !sensitiveHostPath(f.path) && !f.path.split(/[\\/]/).some(p => p === '..' || p === '.') && !/^[\\/]|:|\0/.test(f.path));
    const record: SandboxResult = { ...result, output: redact(result.output), files: files.map(f => ({ ...f, content: redact(f.content) })), runId, directory, baseHashes, root: grant.root };
    writeFileSync(join(directory, 'result.json'), JSON.stringify(record), { flag: 'wx', mode: 0o600 });
    engine.repo.event(engine.sessionId, 'sandbox_finished', { runId, exitCode: result.exitCode, files: files.map(f => f.path), truncated: result.truncated, at: timestamp() }); return record;
  } catch (error) { engine.repo.event(engine.sessionId, 'sandbox_failed', { runId, error: redact(String(error)) }); throw error; } finally { activeSandboxRuns.delete(runId); if (dirname(resolve(staging)) !== resolve(runs)) throw new Error('Invalid sandbox staging directory'); rmSync(staging, { recursive: true, force: true }); }
}
export function installSandboxTools(registry: ToolRegistry): void {
  registry.register('sandbox_grants', 'List current participant project sandbox grants. No network, credentials or live project write mounts.', Type.Object({}), 'collaborate', (_args, { agent }) => registry.engine.repo.list<SandboxGrant>('sandbox', agent.sessionId).filter(g => g.agentId === agent.id));
  registry.register('sandbox_execute', 'Run argv in an isolated copy of a human-granted project. Linux commands on Windows via WSL Ubuntu. Outputs are candidates for human review, never applied to the project.', Type.Object({ grantId: Type.String(), argv: Type.Array(Type.String(), { minItems: 1, maxItems: 64 }) }), 'collaborate', async (args, { agent, signal }) => { const result = await runSandbox(registry.engine, agent.id, args.grantId, args.argv, signal); return { runId: result.runId, exitCode: result.exitCode, output: result.output, changedFiles: result.files.map(f => f.path), truncated: result.truncated }; });
}
