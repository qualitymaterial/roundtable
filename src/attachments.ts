import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { id, timestamp, redact } from './domain.js';
import type { Repository } from './storage.js';
import { documentMime, extractDocument, type Extraction } from './documents.js';
import { sensitiveHostPath } from './host-tools.js';

export type Attachment = { id: string; sessionId: string; name: string; mimeType: string; data: string; hash: string; bytes: number; recipients: string[]; createdAt: string; previousVersion?: string; extraction?: Extraction; extractionHash?: string };
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
/** Explicit human-selected snapshots, stored privately. No automatic filesystem discovery. */
export class Attachments {
  constructor(private repo: Repository, private sessionId: string) {}
  addMany(paths: string[], recipients: string[]): Attachment[] {
    if (!paths.length || paths.length > 16) throw new Error('Select 1–16 files');
    return this.repo.transaction(() => paths.map(path => this.add(path, recipients)));
  }
  async addFiles(paths: string[], recipients: string[], previousVersion?: string): Promise<Attachment[]> {
    if (!paths.length || paths.length > 16) throw new Error('Select 1–16 files');
    const entries: Attachment[] = [];
    for (const path of paths) {
      const entry = this.snapshot(path, recipients, previousVersion);
      if (documentMime(entry.name)) {
        entry.extraction = await extractDocument(entry.name, Buffer.from(entry.data, 'base64'));
        entry.extraction.text = redact(entry.extraction.text);
        entry.extractionHash = digest(Buffer.from(JSON.stringify(entry.extraction)));
      }
      entries.push(entry);
    }
    return this.repo.transaction(() => entries.map(entry => this.commit(entry)));
  }
  private commit(entry: Attachment): Attachment {
    if (!entry.recipients.length || entry.recipients.some(r => !this.repo.list<{ id: string; state: string }>('agent', this.sessionId).some(a => a.id === r && a.state !== 'removed'))) throw new Error('Choose existing participants for the attachment');
    if (this.list().reduce((n, a) => n + a.bytes, 0) + entry.bytes > 20 * 1024 * 1024) throw new Error('Session attachment limit is 20 MiB');
    this.repo.put('attachment', entry);
    this.repo.event(this.sessionId, 'human_attachment_added', { id: entry.id, name: entry.name, mimeType: entry.mimeType, hash: entry.hash, bytes: entry.bytes, recipients: entry.recipients, extractionHash: entry.extractionHash });
    return entry;
  }
  lineage(key: string): Omit<Attachment, 'data'>[] {
    const entries = this.list(); const chain: Omit<Attachment, 'data'>[] = []; const seen = new Set<string>();
    let current = entries.find(a => a.id === key); if (!current) throw new Error('Attachment not found');
    while (current) { if (seen.has(current.id)) throw new Error('Cyclic attachment versions'); seen.add(current.id); chain.push(current); current = current.previousVersion ? entries.find(a => a.id === current!.previousVersion) : undefined; }
    return chain;
  }
  list(): Omit<Attachment, 'data'>[] { return this.repo.list<Attachment>('attachment', this.sessionId).map(({ id, sessionId, name, mimeType, hash, bytes, recipients, createdAt, previousVersion }) => ({ id, sessionId, name, mimeType, hash, bytes, recipients, createdAt, previousVersion })); }
  add(path: string, recipients: string[], previousVersion?: string): Attachment {
    if (documentMime(path)) throw new Error('Use asynchronous addFiles for PDF/Office documents');
    return this.commit(this.snapshot(path, recipients, previousVersion));
  }
  private snapshot(path: string, recipients: string[], previousVersion?: string): Attachment {
    const canonical = realpathSync(path);
    if (sensitiveHostPath(path) || sensitiveHostPath(canonical)) throw new Error('Credential and private runtime paths cannot be attached');
    const info = statSync(canonical); if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error('Select a regular file up to 2 MiB');
    if (this.list().reduce((n, a) => n + a.bytes, 0) + info.size > 20 * 1024 * 1024) throw new Error('Session attachment limit is 20 MiB');
    if (!recipients.length || recipients.some(r => !this.repo.list<{ id: string; state: string }>('agent', this.sessionId).some(a => a.id === r && a.state !== 'removed'))) throw new Error('Choose existing participants for the attachment');
    let bytes = readFileSync(canonical); if (bytes.length > 2 * 1024 * 1024) throw new Error('File grew beyond the attachment limit');
    const ext = extname(canonical).toLowerCase(); let mimeType: string;
    if (ext === '.png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mimeType = 'image/png';
    else if (['.jpg', '.jpeg'].includes(ext) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) mimeType = 'image/jpeg';
    else if (['.txt', '.md', '.csv', '.json', '.ts', '.js', '.py', '.html', '.xml', '.yaml', '.yml'].includes(ext)) {
      if (bytes.length > 64000 || bytes.includes(0)) throw new Error('Text attachments must be UTF-8 and at most 64 KiB');
      bytes = Buffer.from(redact(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); mimeType = 'text/plain';
    } else if (documentMime(canonical)) mimeType = documentMime(canonical)!;
    else throw new Error('Supported inputs: text/code, PNG, JPEG, PDF, DOCX, PPTX and XLSX. Legacy Office and macro formats are unsupported.');
    if (previousVersion) this.read(previousVersion);
    const entry: Attachment = { id: id(), sessionId: this.sessionId, name: basename(canonical), mimeType, data: bytes.toString('base64'), hash: digest(bytes), bytes: bytes.length, recipients: [...new Set(recipients)], createdAt: timestamp(), ...(previousVersion ? { previousVersion } : {}) };
    return entry;
  }
  read(key: string, recipient?: string): Attachment {
    const entry = this.repo.get<Attachment>('attachment', key);
    if (!entry || entry.sessionId !== this.sessionId || (recipient && !entry.recipients.includes(recipient))) throw new Error('Attachment is not authorized for this participant/session');
    if ((entry.extraction && digest(Buffer.from(JSON.stringify(entry.extraction))) !== entry.extractionHash) || digest(Buffer.from(entry.data, 'base64')) !== entry.hash) throw new Error('Attachment integrity failure'); return entry;
  }
  export(key: string, path: string): void { const entry = this.read(key); writeFileSync(path, Buffer.from(entry.data, 'base64'), { flag: 'wx', mode: 0o600 }); }
}
