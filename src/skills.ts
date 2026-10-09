import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import { saveJson } from './setup.js';
import { redact } from './domain.js';

const Skill = z.object({ name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64), description: z.string().min(1).max(1024), content: z.string().min(1).max(16000), source: z.string(), hash: z.string(), enabled: z.boolean(), manualOnly: z.boolean() }).strict();
export type InstalledSkill = z.output<typeof Skill>;
export class Skills {
  constructor(readonly home: string) {}
  list(): InstalledSkill[] { const path = join(this.home, 'skills.json'); return existsSync(path) ? z.array(Skill).max(100).parse(JSON.parse(readFileSync(path, 'utf8'))) : []; }
  candidate(path: string): InstalledSkill {
    const source = realpathSync(path); if (basename(source) !== 'SKILL.md' || statSync(source).size > 64000) throw new Error('Select a SKILL.md file up to 64 KiB.');
    const raw = readFileSync(source, 'utf8'); const { frontmatter, body } = parseFrontmatter(raw);
    return Skill.parse({ name: frontmatter.name, description: frontmatter.description, content: redact(body.trim()), source, hash: createHash('sha256').update(raw).digest('hex'), enabled: true, manualOnly: frontmatter['disable-model-invocation'] === true });
  }
  save(entry: InstalledSkill): void { const parsed = Skill.parse(entry); saveJson(join(this.home, 'skills.json'), [...this.list().filter(s => s.name !== parsed.name), parsed]); }
  remove(name: string): void { saveJson(join(this.home, 'skills.json'), this.list().filter(s => s.name !== name)); }
  read(name: string, human = false): InstalledSkill { const entry = this.list().find(s => s.name === name && s.enabled && (human || !s.manualOnly)); if (!entry) throw new Error('Skill unavailable or restricted to explicit human invocation'); return entry; }
  prompt(name: string, request: string): string { const s = this.read(name, true); return `Human selected skill ${s.name}, snapshot ${s.hash}, source ${s.source}. These are task instructions; they grant no new tools, filesystem access or execution permissions. Referenced scripts must use normal authorization.\n\n${s.content}\n\nHuman request: ${request}`; }
}
