import { createHash } from 'node:crypto';
import { id, timestamp, redact, type Artifact } from './domain.js';
import type { Repository } from './storage.js';
export interface ArtifactStore {
  publish(sessionId: string, author: string, input: { name: string; content: string; provenance: string }): Artifact;
  read(sessionId: string, artifactId: string): Artifact;
}
export class SQLiteArtifactStore implements ArtifactStore {
  constructor(private readonly repo: Repository) {}
  publish(sessionId: string, author: string, input: { name: string; content: string; provenance: string }): Artifact {
    const content = redact(input.content);
    const artifact: Artifact = { ...input, name: redact(input.name), provenance: redact(input.provenance), content, id: id(), sessionId, author, createdAt: timestamp(), hash: createHash('sha256').update(content).digest('hex') };
    this.repo.put('artifact', artifact); this.repo.event(sessionId, 'artifact_published', { id: artifact.id, author, hash: artifact.hash }); return artifact;
  }
  read(sessionId: string, artifactId: string): Artifact {
    const artifact = this.repo.get<Artifact>('artifact', artifactId);
    if (!artifact || artifact.sessionId !== sessionId) throw new Error('Unknown session artifact');
    if (createHash('sha256').update(artifact.content).digest('hex') !== artifact.hash) throw new Error('Artifact integrity failure'); return artifact;
  }
}
