import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AgentInput, Limits, redact } from './domain.js';
import { saveJson } from './setup.js';
import { sensitiveHostPath } from './host-tools.js';

export const InstructionSnapshot = z.object({ content: z.string().max(12000), hash: z.string(), source: z.string(), reviewedAt: z.string() }).strict();
const Profile = z.object({ version: z.literal(1), root: z.string(), instructions: InstructionSnapshot.optional(), agents: z.array(AgentInput.omit({ id: true, permissions: true })).max(64).optional(), limits: Limits.optional() }).strict();
/** Private, human-saved project configuration. Never evaluates repository configuration or scripts. */
export class ProjectProfiles {
  readonly root: string;
  readonly path: string;
  constructor(home: string, project: string) {
    const canonical = realpathSync(project); this.root = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
    this.path = join(home, 'projects', createHash('sha256').update(this.root).digest('hex') + '.json');
  }
  read(): z.output<typeof Profile> | undefined {
    if (!existsSync(this.path)) return undefined;
    const profile = Profile.parse(JSON.parse(readFileSync(this.path, 'utf8'))); if (profile.root !== this.root) throw new Error('Project profile scope mismatch'); return profile;
  }
  save(input: { instructions?: z.input<typeof InstructionSnapshot>; agents?: unknown[]; limits?: unknown }): void {
    const profile = Profile.parse({ ...this.read(), ...input, version: 1, root: this.root }); mkdirSync(dirname(this.path), { recursive: true }); saveJson(this.path, profile);
  }
  candidate(path: string): z.output<typeof InstructionSnapshot> {
    const canonical = realpathSync(path); const rel = relative(this.root, canonical);
    if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel) || sensitiveHostPath(path) || sensitiveHostPath(canonical)) throw new Error('Choose an instruction file inside this project, outside private credential paths');
    const info = statSync(canonical); if (!info.isFile() || info.size > 48000) throw new Error('Project instructions must be a UTF-8 file up to 12,000 characters');
    const content = redact(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(canonical)));
    if (content.includes('\0') || content.length > 12000) throw new Error('Project instructions must be UTF-8 text up to 12,000 characters');
    return { content, hash: createHash('sha256').update(content).digest('hex'), source: canonical, reviewedAt: new Date().toISOString() };
  }
  forget(): void { if (existsSync(this.path)) unlinkSync(this.path); }
}
