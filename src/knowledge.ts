import { realpathSync } from 'node:fs';
import { z } from 'zod';
import { id, redact } from './domain.js';
import type { Repository } from './storage.js';

export type Knowledge = { id: string; scope: string; text: string; sourceSession: string; author: 'human'; createdAt: string; expiresAt: string };
/** Deliberately human-only: agents cannot promote notes into cross-session authority. */
export class KnowledgeStore {
  readonly scope: string;
  constructor(private repo: Repository, project: string, private now = () => Date.now()) {
    const path = realpathSync(project); this.scope = process.platform === 'win32' ? path.toLowerCase() : path;
  }
  remember(text: string, sourceSession: string, days = 30): Knowledge {
    z.string().trim().min(1).max(12000).parse(text); z.number().int().min(1).max(365).parse(days);
    const entry: Knowledge = { id: id(), scope: this.scope, text: redact(text), sourceSession, author: 'human', createdAt: new Date(this.now()).toISOString(), expiresAt: new Date(this.now() + days * 86400000).toISOString() };
    this.repo.put('knowledge', entry); this.repo.event(sourceSession, 'knowledge_saved', { id: entry.id, scope: entry.scope, expiresAt: entry.expiresAt }); return entry;
  }
  search(query = ''): Knowledge[] {
    return this.repo.list<Knowledge>('knowledge').filter(k => k.scope === this.scope && Date.parse(k.expiresAt) > this.now() && k.text.toLowerCase().includes(query.toLowerCase())).slice(-50);
  }
  read(key: string): Knowledge {
    const entry = this.repo.get<Knowledge>('knowledge', key);
    if (!entry || entry.scope !== this.scope || Date.parse(entry.expiresAt) <= this.now()) throw new Error('Memory is absent, expired or belongs to another project folder.');
    return entry;
  }
  forget(key: string): void {
    const entry = this.repo.get<Knowledge>('knowledge', key);
    if (!entry || entry.scope !== this.scope) throw new Error('Unknown project memory');
    this.repo.db.prepare("DELETE FROM entities WHERE kind='knowledge' AND id=?").run(key);
    this.repo.event(entry.sourceSession, 'knowledge_deleted', { id: key });
  }
}
