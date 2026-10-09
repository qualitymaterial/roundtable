import { runtimeAccess } from './runtime-access.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { id, timestamp, redact, type Delivery, type Message } from './domain.js';

export type EntityKind = 'research' | 'worktree' | 'contract' | 'validation' | 'sandbox' | 'changegroup' | 'fallback' | 'steering' | 'session' | 'agent' | 'task' | 'artifact' | 'approval' | 'note' | 'checkpoint' | 'job' | 'knowledge' | 'operation' | 'notification' | 'draft' | 'attachment' | 'evidence';
export interface StorageAdapter {
  get<T>(kind: EntityKind, id: string): T | undefined;
  list<T>(kind: EntityKind, sessionId?: string): T[];
  put(kind: EntityKind, value: { id: string; sessionId?: string }): void;
}
export class Repository implements StorageAdapter {
  readonly db: DatabaseSync;
  private releaseRuntime: () => void;
  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.releaseRuntime = runtimeAccess(dirname(path));
    try { this.db = new DatabaseSync(path); } catch (error) { this.releaseRuntime(); throw error; }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entities(kind TEXT NOT NULL, id TEXT NOT NULL, session_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE INDEX IF NOT EXISTS entities_session ON entities(kind,session_id);
      CREATE TABLE IF NOT EXISTS messages(sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, session_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id,sequence);
      CREATE TABLE IF NOT EXISTS deliveries(message_id TEXT NOT NULL REFERENCES messages(id), agent_id TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, PRIMARY KEY(message_id,agent_id));
      CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, session_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, timestamp TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tool_results(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS delivery_order(message_id TEXT PRIMARY KEY REFERENCES messages(id), rank INTEGER NOT NULL);
      INSERT OR IGNORE INTO migrations VALUES(1,datetime('now'));
      INSERT OR IGNORE INTO migrations VALUES(2,datetime('now'));`);
    if (!this.db.prepare('SELECT 1 FROM migrations WHERE version=3').get()) this.transaction(() => {
      this.db.exec(`CREATE VIRTUAL TABLE memory_fts USING fts5(text, tokenize='unicode61');
        INSERT INTO memory_fts(rowid,text) SELECT rowid,json_extract(data,'$.text') FROM entities WHERE kind IN ('note','knowledge');
        CREATE TRIGGER memory_insert AFTER INSERT ON entities WHEN new.kind IN ('note','knowledge') BEGIN INSERT INTO memory_fts(rowid,text) VALUES(new.rowid,json_extract(new.data,'$.text')); END;
        CREATE TRIGGER memory_delete AFTER DELETE ON entities WHEN old.kind IN ('note','knowledge') BEGIN DELETE FROM memory_fts WHERE rowid=old.rowid; END;
        CREATE TRIGGER memory_update AFTER UPDATE ON entities WHEN new.kind IN ('note','knowledge') BEGIN DELETE FROM memory_fts WHERE rowid=old.rowid; INSERT INTO memory_fts(rowid,text) VALUES(new.rowid,json_extract(new.data,'$.text')); END;
        INSERT INTO migrations VALUES(3,datetime('now'));`);
    });
  }
  search(kind: 'note' | 'knowledge', scope: string, query: string, limit = 30, now = Date.now()): Record<string, unknown>[] {
    const terms = query.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 20) ?? [];
    if (!terms.length) return [];
    const match = terms.map(t => '"' + t + '"*').join(' AND ');
    return this.db.prepare(`SELECT e.data FROM memory_fts f JOIN entities e ON e.rowid=f.rowid WHERE memory_fts MATCH ? AND e.kind=? AND CASE WHEN e.kind='knowledge' THEN json_extract(e.data,'$.scope') ELSE e.session_id END=? AND (e.kind!='knowledge' OR json_extract(e.data,'$.expiresAt')>?) ORDER BY bm25(memory_fts) LIMIT ?`).all(match, kind, scope, new Date(now).toISOString(), Math.max(1, Math.min(50, limit))).map(r => JSON.parse(String(r.data)) as Record<string, unknown>);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get<T>(kind: EntityKind, entityId: string): T | undefined {
    const row = this.db.prepare('SELECT data FROM entities WHERE kind=? AND id=?').get(kind, entityId);
    return row ? JSON.parse(String(row.data)) as T : undefined;
  }
  list<T>(kind: EntityKind, sessionId?: string): T[] {
    const rows = sessionId ? this.db.prepare('SELECT data FROM entities WHERE kind=? AND session_id=? ORDER BY rowid').all(kind, sessionId)
      : this.db.prepare('SELECT data FROM entities WHERE kind=? ORDER BY rowid').all(kind);
    return rows.map(row => JSON.parse(String(row.data)) as T);
  }
  put(kind: EntityKind, value: { id: string; sessionId?: string }): void {
    this.db.prepare('INSERT INTO entities VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(kind, value.id, value.sessionId ?? value.id, JSON.stringify(value));
  }
  event(sessionId: string, type: string, data: unknown): void {
    this.db.prepare('INSERT INTO events(id,session_id,type,data,timestamp) VALUES(?,?,?,?,?)').run(id(), sessionId, type, redact(JSON.stringify(data)), timestamp());
  }
  events(sessionId: string): Record<string, unknown>[] {
    return this.db.prepare('SELECT * FROM events WHERE session_id=? ORDER BY sequence').all(sessionId).map(row => ({ ...row, data: JSON.parse(String(row.data)) as unknown }));
  }
  insertMessage(message: Omit<Message, 'sequence'>): Message {
    this.db.prepare('INSERT INTO messages(id,session_id,data) VALUES(?,?,?)').run(message.id, message.sessionId, JSON.stringify(message));
    for (const recipient of message.recipients) this.db.prepare('INSERT INTO deliveries(message_id,agent_id,state) VALUES(?,?,?)').run(message.id, recipient, 'pending');
    return this.message(message.id)!;
  }
  message(messageId: string): Message | undefined {
    const row = this.db.prepare('SELECT sequence,data FROM messages WHERE id=?').get(messageId);
    return row ? { ...JSON.parse(String(row.data)) as Message, sequence: Number(row.sequence) } : undefined;
  }
  messages(sessionId: string, threadId?: string, limit = 100): Message[] {
    if (!Number.isSafeInteger(limit) || limit < 1) return [];
    const rows = this.db.prepare(`SELECT sequence,data FROM messages WHERE session_id=? ${threadId ? "AND json_extract(data,'$.threadId')=?" : ''} ORDER BY sequence DESC LIMIT ?`).all(...(threadId ? [sessionId, threadId, limit] : [sessionId, limit]));
    return rows.reverse().map(row => ({ ...JSON.parse(String(row.data)) as Message, sequence: Number(row.sequence) }));
  }
  deliveries(sessionId: string, states: Delivery['state'][] = ['pending']): Delivery[] {
    return this.db.prepare('SELECT d.* FROM deliveries d JOIN messages m ON d.message_id=m.id LEFT JOIN delivery_order o ON o.message_id=m.id WHERE m.session_id=? ORDER BY COALESCE(o.rank,m.sequence),m.sequence,d.agent_id').all(sessionId)
      .filter(row => states.includes(String(row.state) as Delivery['state']))
      .map(row => ({ messageId: String(row.message_id), agentId: String(row.agent_id), state: String(row.state) as Delivery['state'], attempts: Number(row.attempts), error: row.error ? String(row.error) : undefined }));
  }
  delivery(messageId: string, agentId: string, state: Delivery['state'], error?: string): void {
    this.db.prepare('UPDATE deliveries SET state=?, error=?, attempts=attempts+? WHERE message_id=? AND agent_id=?').run(state, error ? redact(error) : null, state === 'inflight' ? 1 : 0, messageId, agentId);
  }
  orderPending(sessionId: string, orderedHumanIds: string[]): void {
    this.transaction(() => {
      const pending = [...new Set(this.deliveries(sessionId).map(d => d.messageId))].map(key => this.message(key)!);
      const humans = pending.filter(m => m.sender === 'human');
      if (new Set(orderedHumanIds).size !== humans.length || orderedHumanIds.length !== humans.length || orderedHumanIds.some(key => !humans.some(m => m.id === key))) throw new Error('Queue changed; choose each pending human message exactly once');
      const slots = pending.map(m => m.sequence).sort((a, b) => a - b); let index = 0;
      for (const [i, message] of pending.entries()) this.db.prepare('INSERT OR REPLACE INTO delivery_order VALUES(?,?)').run(message.sender === 'human' ? orderedHumanIds[index++]! : message.id, slots[i]!);
      this.event(sessionId, 'human_queue_reordered', { messageIds: orderedHumanIds });
    });
  }
  recover(sessionId: string): void {
    this.db.prepare("UPDATE deliveries SET state='pending' WHERE state='inflight' AND message_id IN (SELECT id FROM messages WHERE session_id=?)").run(sessionId);
  }
  cached(toolCallId: string): unknown | undefined {
    const row = this.db.prepare('SELECT data FROM tool_results WHERE id=?').get(toolCallId);
    return row ? JSON.parse(String(row.data)) as unknown : undefined;
  }
  cache(toolCallId: string, sessionId: string, value: unknown): void {
    this.db.prepare('INSERT OR REPLACE INTO tool_results VALUES(?,?,?)').run(toolCallId, sessionId, JSON.stringify(value));
  }
  close(): void { try { this.db.close(); } finally { this.releaseRuntime(); } }
}
