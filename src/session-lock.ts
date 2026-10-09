import type { DatabaseSync } from 'node:sqlite';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

// Database transaction serializes ownership acquisition across processes; no stale-file race.
export function acquireSession(db: DatabaseSync, sessionId: string): () => void {
  db.exec('CREATE TABLE IF NOT EXISTS session_owners(session_id TEXT PRIMARY KEY, pid INTEGER NOT NULL, host TEXT NOT NULL, token TEXT NOT NULL)');
  const token = randomUUID(); const host = hostname();
  db.exec('BEGIN IMMEDIATE');
  try {
    const owner = db.prepare('SELECT pid,host FROM session_owners WHERE session_id=?').get(sessionId);
    if (owner) {
      let alive = true;
      if (owner.host === host) {
        try { process.kill(Number(owner.pid), 0); } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
      }
      if (alive) throw new Error(`Session is already open in process ${owner.pid}. Close that harness before resuming it here.`);
    }
    db.prepare('INSERT OR REPLACE INTO session_owners VALUES(?,?,?,?)').run(sessionId, process.pid, host, token);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return () => { db.prepare('DELETE FROM session_owners WHERE session_id=? AND token=?').run(sessionId, token); };
}
