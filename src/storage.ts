import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { id, timestamp, redact, type Delivery, type Message } from './domain.js';

export type EntityKind = 'session' | 'agent' | 'task' | 'artifact' | 'approval' | 'note';
export interface StorageAdapter {
  get<T>(kind: EntityKind, id: string): T | undefined;
  list<T>(kind: EntityKind, sessionId?: string): T[];
  put(kind: EntityKind, value: { id: string; sessionId?: string }): void;
}
export class Repository implements StorageAdapter {
  readonly db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entities(kind TEXT NOT NULL, id TEXT NOT NULL, session_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE INDEX IF NOT EXISTS entities_session ON entities(kind,session_id);
      CREATE TABLE IF NOT EXISTS messages(sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, session_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id,sequence);
      CREATE TABLE IF NOT EXISTS deliveries(message_id TEXT NOT NULL REFERENCES messages(id), agent_id TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, PRIMARY KEY(message_id,agent_id));
      CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, session_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, timestamp TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tool_results(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, data TEXT NOT NULL);
      INSERT OR IGNORE INTO migrations VALUES(1,datetime('now'));`);
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
    const all = this.db.prepare('SELECT sequence,data FROM messages WHERE session_id=? ORDER BY sequence').all(sessionId)
      .map(row => ({ ...JSON.parse(String(row.data)) as Message, sequence: Number(row.sequence) }));
    return all.filter(m => !threadId || m.threadId === threadId).slice(-limit);
  }
  deliveries(sessionId: string, states: Delivery['state'][] = ['pending']): Delivery[] {
    return this.db.prepare('SELECT d.* FROM deliveries d JOIN messages m ON d.message_id=m.id WHERE m.session_id=? ORDER BY m.sequence,d.agent_id').all(sessionId)
      .filter(row => states.includes(String(row.state) as Delivery['state']))
      .map(row => ({ messageId: String(row.message_id), agentId: String(row.agent_id), state: String(row.state) as Delivery['state'], attempts: Number(row.attempts), error: row.error ? String(row.error) : undefined }));
  }
  delivery(messageId: string, agentId: string, state: Delivery['state'], error?: string): void {
    this.db.prepare('UPDATE deliveries SET state=?, error=?, attempts=attempts+? WHERE message_id=? AND agent_id=?').run(state, error ? redact(error) : null, state === 'inflight' ? 1 : 0, messageId, agentId);
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
  close(): void { this.db.close(); }
}
