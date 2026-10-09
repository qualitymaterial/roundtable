import { createHash } from 'node:crypto';
import { id, timestamp, redact, type Artifact } from './domain.js';
import type { Repository } from './storage.js';
import { extname } from 'node:path';
import { documentMime } from './documents.js';
export const artifactBytes = (artifact: Artifact): Buffer => Buffer.from(artifact.content, artifact.encoding === 'base64' ? 'base64' : 'utf8');
export function binaryMime(name: string, bytes: Uint8Array): string {
  const ext = extname(name).toLowerCase(); const data = Buffer.from(bytes);
  const mime = documentMime(name);
  if (ext === '.pdf' && data.subarray(0, 5).toString() === '%PDF-') return mime!;
  if (['.docx', '.pptx', '.xlsx'].includes(ext) && data.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))) return mime!;
  if (ext === '.png' && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (['.jpg', '.jpeg'].includes(ext) && data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  throw new Error('Binary artifacts require a PDF, DOCX, PPTX, XLSX, PNG or JPEG signature. This check does not validate document contents.');
}
export interface ArtifactStore {
  publish(sessionId: string, author: string, input: { name: string; content: string; provenance: string }): Artifact;
  read(sessionId: string, artifactId: string): Artifact;
}
export class SQLiteArtifactStore implements ArtifactStore {
  constructor(private readonly repo: Repository) {}
  publishBinary(sessionId: string, author: string, input: { name: string; bytes: Uint8Array; provenance: string }): Artifact {
    if (!input.bytes.length || input.bytes.length > 2 * 1024 * 1024) throw new Error('Binary artifact size must be 1 byte–2 MiB');
    const mimeType = binaryMime(input.name, input.bytes);
    if (this.repo.list<Artifact>('artifact', sessionId).filter(a => a.encoding === 'base64').reduce((n, a) => n + artifactBytes(a).length, 0) + input.bytes.length > 20 * 1024 * 1024) throw new Error('Binary artifact session limit is 20 MiB');
    const artifact: Artifact = { id: id(), sessionId, author, name: redact(input.name).slice(0, 200), provenance: redact(input.provenance).slice(0, 1000), createdAt: timestamp(), encoding: 'base64', mimeType, bytes: input.bytes.length, content: Buffer.from(input.bytes).toString('base64'), hash: createHash('sha256').update(input.bytes).digest('hex') };
    this.repo.put('artifact', artifact); this.repo.event(sessionId, 'artifact_published', { id: artifact.id, author, hash: artifact.hash, mimeType, bytes: artifact.bytes }); return artifact;
  }
  publish(sessionId: string, author: string, input: { name: string; content: string; provenance: string }): Artifact {
    const content = redact(input.content);
    const artifact: Artifact = { ...input, name: redact(input.name), provenance: redact(input.provenance), content, id: id(), sessionId, author, createdAt: timestamp(), hash: createHash('sha256').update(content).digest('hex') };
    this.repo.put('artifact', artifact); this.repo.event(sessionId, 'artifact_published', { id: artifact.id, author, hash: artifact.hash }); return artifact;
  }
  read(sessionId: string, artifactId: string): Artifact {
    const artifact = this.repo.get<Artifact>('artifact', artifactId);
    if (!artifact || artifact.sessionId !== sessionId) throw new Error('Unknown session artifact');
    const bytes = artifactBytes(artifact);
    if (createHash('sha256').update(bytes).digest('hex') !== artifact.hash || (artifact.encoding === 'base64' && bytes.length !== artifact.bytes)) throw new Error('Artifact integrity failure'); return artifact;
  }
}
