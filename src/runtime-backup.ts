import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, existsSync, readFileSync, writeFileSync, readdirSync, lstatSync, realpathSync, renameSync, rmSync, linkSync } from 'node:fs';
import { dirname, basename, join, resolve, relative, isAbsolute } from 'node:path';
import { createHash, randomBytes, scryptSync, createCipheriv, createDecipheriv, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { hostname } from 'node:os';
import { z } from 'zod';
import { runtimeMaintenance } from './runtime-access.js';

const maxBytes = 256 * 1024 * 1024;
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const Payload = z.object({ version: z.literal(1), sourceHome: z.string(), sourceAliases: z.array(z.string()).max(8).optional(), createdAt: z.string(), files: z.array(z.object({ path: z.string().max(2000), data: z.string().max(maxBytes * 2), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(20000) }).strict();
function secret(password: string) { if (password.length < 12 || password.length > 1000) throw new Error('Use a backup passphrase of 12–1000 characters. It is never saved.'); }
function safePath(key: string) { if (!key || key.split('/').some(p => !p || p === '..' || p === '.' || /[\\:\x00-\x1f]|[. ]$/.test(p) || /^(CON|PRN|NUL|AUX|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p)) || key.startsWith('/')) throw new Error('Unsafe backup path'); }
function removeStage(stage: string, parent: string) { if (dirname(resolve(stage)) !== resolve(parent)) throw new Error('Refusing to remove stage outside its parent'); rmSync(stage, { recursive: true, force: true }); }
export function cleanupRuntimeStage(path: string): void {
  path = resolve(path); if (!/^\.roundtable-(restore|backup)-/.test(basename(path)) || lstatSync(path).isSymbolicLink()) throw new Error('Choose a Roundtable staging directory');
  const marker = z.object({ format: z.literal('roundtable-stage'), host: z.string(), pid: z.number().int().positive() }).parse(JSON.parse(readFileSync(join(path, '.roundtable-stage.json'), 'utf8')));
  if (marker.host !== hostname()) throw new Error('Stage belongs to another host');
  let alive = true; try { process.kill(marker.pid, 0); } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
  if (alive) throw new Error('Stage is still owned by a running process'); removeStage(path, dirname(path));
}
export function backupRuntime(home: string, destination: string, password: string): { path: string; files: number; bytes: number } {
  secret(password); const sourceAliases = [...new Set([resolve(home), realpathSync(home), realpathSync.native(home)])]; home = realpathSync.native(home); destination = join(realpathSync.native(dirname(resolve(destination))), basename(destination));
  const rel = relative(home, destination); if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error('Save runtime backups outside the runtime directory');
  if (existsSync(destination)) throw new Error('Backup destination already exists');
  const release = runtimeMaintenance(home); let stage: string;
  try { stage = mkdtempSync(join(dirname(destination), '.roundtable-backup-')); } catch (error) { release(); throw error; }
  writeFileSync(join(stage, '.roundtable-stage.json'), JSON.stringify({ format: 'roundtable-stage', host: hostname(), pid: process.pid }), { mode: 0o600 });
  try {
    const source = join(home, 'roundtable.db');
    if (!existsSync(source)) throw new Error('No roundtable.db in this runtime');
    const db = new DatabaseSync(source);
    try {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='session_owners'").get()) for (const owner of db.prepare('SELECT pid,host FROM session_owners').all()) {
        let alive = owner.host !== hostname(); try { process.kill(Number(owner.pid), 0); alive = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') alive = true; }
        if (alive) throw new Error('An older harness still owns a session. Close it before backup');
      }
      db.prepare('VACUUM INTO ?').run(join(stage, 'roundtable.db'));
    } finally { db.close(); }
    const files: z.output<typeof Payload>['files'] = []; let bytes = 0;
    const add = (path: string, key: string) => { safePath(key); const info = lstatSync(path); if (!info.isFile() || (bytes += info.size) > maxBytes || files.length >= 20000) throw new Error('Backup requires regular files within 256 MiB and 20000 files'); const data = readFileSync(path); files.push({ path: key, data: data.toString('base64'), hash: hash(data) }); };
    add(join(stage, 'roundtable.db'), 'roundtable.db');
    const walk = (folder: string, prefix = '', depth = 0) => {
      if (depth > 30) throw new Error('Runtime nesting limit');
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (!prefix && (['.processes', '.maintenance.json'].includes(entry.name) || /^roundtable\.db(?:-|$)/.test(entry.name))) continue;
        if (prefix === 'sandbox-runs/' && entry.name.startsWith('input-')) continue;
        const key = prefix + entry.name; const path = join(folder, entry.name); const info = lstatSync(path);
        if (info.isSymbolicLink()) throw new Error('Runtime contains a link; snapshot it separately before backup');
        if (info.isDirectory()) walk(path, key + '/', depth + 1); else add(path, key);
      }
    }; walk(home);
    const salt = randomBytes(16), iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', scryptSync(password, salt, 32), iv);
    const payload = gzipSync(Buffer.from(JSON.stringify({ version: 1, sourceHome: home, sourceAliases, createdAt: new Date().toISOString(), files })));
    const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
    const envelope = JSON.stringify({ format: 'roundtable-runtime', version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), encrypted: encrypted.toString('base64') });
    const archive = join(stage, 'archive'); writeFileSync(archive, envelope, { flag: 'wx', mode: 0o600 }); linkSync(archive, destination); return { path: destination, files: files.length, bytes };
  } finally { removeStage(stage, dirname(destination)); release(); }
}
export function restoreRuntime(file: string, target: string, password: string, progress?: (count: number) => void): { home: string; files: number } {
  secret(password); target = resolve(target); if (existsSync(target)) throw new Error('Restore requires a new destination directory');
  if (lstatSync(file).size > maxBytes * 2) throw new Error('Encrypted backup exceeds limit');
  const envelope = z.object({ format: z.literal('roundtable-runtime'), version: z.literal(1), salt: z.string(), iv: z.string(), tag: z.string(), encrypted: z.string() }).strict().parse(JSON.parse(readFileSync(file, 'utf8')));
  const salt = Buffer.from(envelope.salt, 'base64'), iv = Buffer.from(envelope.iv, 'base64'), tag = Buffer.from(envelope.tag, 'base64');
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encryption metadata');
  const decipher = createDecipheriv('aes-256-gcm', scryptSync(password, salt, 32), iv); decipher.setAuthTag(tag);
  const data = Buffer.concat([decipher.update(Buffer.from(envelope.encrypted, 'base64')), decipher.final()]);
  const payload = Payload.parse(JSON.parse(gunzipSync(data, { maxOutputLength: maxBytes * 2 }).toString('utf8')));
  const paths = new Set<string>(); let bytes = 0;
  for (const entry of payload.files) { safePath(entry.path); if (['.processes', '.maintenance.json', '.roundtable-stage.json'].includes(entry.path.split('/')[0]!)) throw new Error('Reserved backup path'); const key = entry.path.toLowerCase(); if (paths.has(key)) throw new Error('Duplicate backup path'); paths.add(key); const content = Buffer.from(entry.data, 'base64'); if ((bytes += content.length) > maxBytes || hash(content) !== entry.hash) throw new Error('Backup integrity/size mismatch'); }
  if (!paths.has('roundtable.db')) throw new Error('Backup database missing');
  const rebase = (value: unknown): string | undefined => {
    if (typeof value !== 'string' || !isAbsolute(value)) return undefined;
    for (const alias of [payload.sourceHome, ...(payload.sourceAliases ?? [])]) { const path = relative(alias, value); if (path !== '..' && !path.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) && !isAbsolute(path)) return join(target, path); }
    return undefined;
  };
  const parent = realpathSync.native(dirname(target)); const stage = mkdtempSync(join(parent, '.roundtable-restore-'));
  writeFileSync(join(stage, '.roundtable-stage.json'), JSON.stringify({ format: 'roundtable-stage', host: hostname(), pid: process.pid }), { mode: 0o600 });
  try {
    let count = 0;
    for (const entry of payload.files) { const destination = join(stage, entry.path); mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, Buffer.from(entry.data, 'base64'), { flag: 'wx', mode: 0o600 }); progress?.(++count); }
    const db = new DatabaseSync(join(stage, 'roundtable.db'));
    try {
      if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('Restored database integrity failed');
      db.exec('BEGIN IMMEDIATE');
      for (const row of db.prepare('SELECT kind,id,data FROM entities').all()) {
        const value = JSON.parse(String(row.data)) as Record<string, unknown>;
        if (row.kind === 'session') { const workspace = rebase(value.workspace); if (!workspace) throw new Error('Workspace outside runtime needs separate recovery'); value.workspace = workspace; value.projectRoot = rebase(value.projectRoot) ?? value.projectRoot; value.state = 'paused'; value.reason = 'Restored runtime: review access and pending effects before resuming'; value.hostAccess = { readRoots: [], writeRoots: [], shell: false }; delete value.completion; }
        if (row.kind === 'checkpoint' && value.scope === 'workspace') { const path = rebase(value.path); if (!path) throw new Error('Workspace checkpoint outside runtime'); value.path = path; }
        if (row.kind === 'worktree') { value.suspended = true; delete value.reviewedHead; delete value.reviewedBase; }
        if (row.kind === 'sandbox') value.revoked = true;
        if (row.kind === 'approval' && ['approved', 'pending'].includes(String(value.state))) value.state = 'rejected';
        if (row.kind === 'job' && value.state === 'running') value.state = 'interrupted';
        if (row.kind === 'changegroup') { value.state = 'needs-review'; value.root = rebase(value.root) ?? value.root; }
        db.prepare('UPDATE entities SET data=? WHERE kind=? AND id=?').run(JSON.stringify(value), row.kind!, row.id!);
      }
      db.exec("UPDATE deliveries SET state='failed',error='Runtime restore: inspect prior effects before explicit retry' WHERE state IN ('pending','inflight'); DROP TABLE IF EXISTS session_owners; COMMIT; PRAGMA wal_checkpoint(TRUNCATE);");
    } finally { db.close(); }
    for (const entry of payload.files.filter(f => f.path.startsWith('sessions/') && f.path.endsWith('.jsonl'))) {
      const path = join(stage, entry.path); const text = readFileSync(path, 'utf8'); const end = text.indexOf('\n'); if (end < 0) continue;
      const header = JSON.parse(text.slice(0, end)) as { type?: string; cwd?: string; parentSession?: string };
      if (header.type !== 'session' || !header.cwd) continue; header.cwd = rebase(header.cwd) ?? header.cwd; delete header.parentSession; writeFileSync(path, JSON.stringify(header) + text.slice(end), { mode: 0o600 });
    }
    for (const entry of payload.files.filter(f => /^sandbox-runs\/[^/]+\/result\.json$/.test(f.path))) {
      const path = join(stage, entry.path); const result = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      for (const key of ['root', 'directory']) if (typeof result[key] === 'string') result[key] = rebase(result[key]) ?? result[key];
      writeFileSync(path, JSON.stringify(result), { mode: 0o600 });
    }
    // Disable remembered host grants for new sessions too. Provider credentials remain in this encrypted private restore.
    writeFileSync(join(stage, 'host-access.json'), JSON.stringify({ readRoots: [], writeRoots: [], shell: false }), { mode: 0o600 });
    writeFileSync(join(stage, 'preferences.json'), JSON.stringify({ projectAccess: false }), { mode: 0o600 });
    writeFileSync(join(stage, 'RESTORE.json'), JSON.stringify({ id: randomUUID(), sourceHome: payload.sourceHome, restoredAt: new Date().toISOString(), note: 'All sessions paused; grants revoked; inspect failures before retrying.' }), { mode: 0o600 });
    rmSync(join(stage, '.roundtable-stage.json')); renameSync(stage, target); return { home: target, files: payload.files.length };
  } catch (error) { removeStage(stage, parent); throw error; }
}
