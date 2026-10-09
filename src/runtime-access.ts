import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

function live(path: string): boolean {
  const owner = JSON.parse(readFileSync(path, 'utf8')) as { pid: number; host: string };
  if (owner.host !== hostname() || !Number.isInteger(owner.pid) || owner.pid <= 0) return true;
  try { process.kill(owner.pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
function assertAvailable(home: string) {
  const lock = join(home, '.maintenance.json');
  if (existsSync(lock)) { if (live(lock)) throw new Error('Runtime backup/restore maintenance is active'); unlinkSync(lock); }
}
export function runtimeAccess(home: string): () => void {
  mkdirSync(home, { recursive: true }); assertAvailable(home);
  const folder = join(home, '.processes'); mkdirSync(folder, { recursive: true });
  const path = join(folder, `${randomUUID()}.json`); writeFileSync(path, JSON.stringify({ pid: process.pid, host: hostname() }), { flag: 'wx', mode: 0o600 });
  try { assertAvailable(home); } catch (e) { unlinkSync(path); throw e; }
  return () => { if (existsSync(path)) unlinkSync(path); };
}
export function runtimeMaintenance(home: string): () => void {
  assertAvailable(home); const path = join(home, '.maintenance.json');
  writeFileSync(path, JSON.stringify({ pid: process.pid, host: hostname() }), { flag: 'wx', mode: 0o600 });
  try {
    const folder = join(home, '.processes');
    for (const name of existsSync(folder) ? readdirSync(folder) : []) {
      const lease = join(folder, name); if (live(lease)) throw new Error('Close every harness using this runtime before backup'); unlinkSync(lease);
    }
  } catch (e) { unlinkSync(path); throw e; }
  return () => unlinkSync(path);
}
