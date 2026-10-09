import { extractionSchema, documentTypes } from './documents.js';
import { artifactBytes, binaryMime } from './artifacts.js';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Engine } from './engine.js';
import type { Repository, EntityKind } from './storage.js';
import { AgentInput, Limits, MessageInput, id, timestamp, type AgentRecord, type SessionRecord } from './domain.js';
import { sensitiveHostPath } from './host-tools.js';
import { Stage } from './policy.js';
import { InstructionSnapshot } from './projects.js';

const maxBytes = 64 * 1024 * 1024;
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const kinds = ['task', 'artifact', 'note', 'attachment', 'evidence', 'draft', 'checkpoint', 'job', 'operation'] as const;
const jsonRecord = z.record(z.string(), z.unknown());
const File = z.object({ area: z.enum(['workspace', 'history']), agentId: z.string().optional(), path: z.string().min(1).max(2000), data: z.string().max(maxBytes), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const Payload = z.object({
  version: z.literal(1), createdAt: z.string(), session: jsonRecord,
  agents: z.array(AgentInput.extend({ id: z.uuid(), state: z.enum(['active', 'paused', 'removed']), compatible: z.boolean(), sessionId: z.string() })).max(64),
  entities: z.array(z.object({ kind: z.enum(kinds), value: jsonRecord })).max(100000),
  messages: z.array(MessageInput.extend({ id: z.string(), timestamp: z.string(), sequence: z.number() })).max(100000),
  events: z.array(jsonRecord).max(200000), files: z.array(File).max(10000), excluded: z.array(z.string()).max(10000),
}).strict();
export type SessionBundle = z.output<typeof Payload>;
const Envelope = z.object({ format: z.literal('roundtable-session'), sha256: z.string(), payload: Payload }).strict();
const base = z.object({ id: z.string().min(1).max(200), sessionId: z.string() });
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const schemas = {
  task: base.extend({ title: z.string().max(500), state: z.enum(['open', 'claimed', 'done', 'cancelled']), owner: z.string().optional(), findings: z.string().max(64000), dependencies: z.array(z.string()).max(1000) }),
  artifact: base.extend({ name: z.string().max(200), content: z.string().max(3 * 1024 * 1024), encoding: z.literal('base64').optional(), mimeType: z.string().max(200).optional(), bytes: z.number().int().min(1).max(2 * 1024 * 1024).optional(), hash: digestSchema, author: z.string(), createdAt: z.string(), provenance: z.string().max(1000) }),
  note: base.extend({ author: z.string(), text: z.string().max(64000), kind: z.enum(['note', 'decision']), timestamp: z.string() }),
  attachment: base.extend({ name: z.string().max(500), mimeType: z.enum(['text/plain', 'image/png', 'image/jpeg', ...Object.values(documentTypes)]), data: z.string().max(3 * 1024 * 1024), hash: digestSchema, bytes: z.number().int().nonnegative().max(2 * 1024 * 1024), recipients: z.array(z.string()).max(64), createdAt: z.string(), previousVersion: z.string().optional(), extraction: extractionSchema.optional(), extractionHash: digestSchema.optional() }),
  evidence: base.extend({ author: z.string(), kind: z.enum(['finding', 'disagreement', 'decision']), claim: z.string().max(4000), artifacts: z.array(z.object({ id: z.string(), hash: digestSchema })).max(16), createdAt: z.string() }),
  draft: z.union([base.extend({ body: z.string().max(24000) }), base.extend({ recipients: z.array(z.string()).max(64) })]),
};

function validateContents(bundle: SessionBundle): void {
  const sourceId = z.uuid().parse(bundle.session.id);
  const agents = new Set(bundle.agents.map(a => a.id));
  const lookup = (kind: string, key: string) => bundle.entities.find(e => e.kind === kind && e.value.id === key)?.value;
  const participant = (key: string) => { if (!agents.has(key) && key !== 'human' && key !== 'system') throw new Error('Unknown participant in backup'); };
  let attachmentBytes = 0; let binaryBytes = 0;
  for (const agent of bundle.agents) if (agent.sessionId !== sourceId) throw new Error('Cross-session participant in backup');
  for (const entity of bundle.entities) {
    if (entity.value.sessionId !== sourceId) throw new Error('Cross-session resource in backup');
    if (entity.kind in schemas) entity.value = schemas[entity.kind as keyof typeof schemas].parse(entity.value);
    const v = entity.value;
    if (typeof v.author === 'string') participant(v.author);
    if (entity.kind === 'task') {
      const task = schemas.task.parse(v); if (task.owner) participant(task.owner);
      for (const key of task.dependencies) if (!lookup('task', key) || key === task.id) throw new Error('Invalid task dependency');
    }
    if (entity.kind === 'artifact') {
      const a = schemas.artifact.parse(v); const bytes = artifactBytes(a);
      if (hash(bytes) !== a.hash) throw new Error('Artifact checksum mismatch');
      if (a.encoding === 'base64') {
        binaryBytes += bytes.length;
        if (bytes.length !== a.bytes || binaryBytes > 20 * 1024 * 1024 || binaryMime(a.name, bytes) !== a.mimeType) throw new Error('Binary artifact size or format mismatch');
      } else if (a.content.length > 64000) throw new Error('Text artifact too large');
    }
    if (entity.kind === 'attachment') {
      const a = schemas.attachment.parse(v); const bytes = Buffer.from(a.data, 'base64'); attachmentBytes += bytes.length;
      if (bytes.length !== a.bytes || hash(bytes) !== a.hash || attachmentBytes > 20 * 1024 * 1024) throw new Error('Attachment checksum or size mismatch');
      a.recipients.forEach(participant);
      if (a.extraction && hash(JSON.stringify(a.extraction)) !== a.extractionHash) throw new Error('Document extraction checksum mismatch');
      if (a.previousVersion && !lookup('attachment', a.previousVersion)) throw new Error('Missing attachment version');
    }
    if (entity.kind === 'evidence') for (const ref of schemas.evidence.parse(v).artifacts) if (lookup('artifact', ref.id)?.hash !== ref.hash) throw new Error('Evidence artifact mismatch');
    if (entity.kind === 'draft') {
      if (![sourceId, `${sourceId}:audience`].includes(String(v.id))) throw new Error('Invalid draft identity');
      if ('recipients' in v) for (const recipient of v.recipients as string[]) if (recipient !== '*') participant(recipient);
    }
  }
  // Imported graphs must not introduce dependency deadlocks.
  const visited = new Set<string>(); const visiting = new Set<string>();
  const visit = (key: string) => { if (visiting.has(key)) throw new Error('Cyclic task dependencies'); if (visited.has(key)) return; visiting.add(key); for (const dep of lookup('task', key)!.dependencies as string[]) visit(dep); visiting.delete(key); visited.add(key); };
  for (const task of bundle.entities.filter(e => e.kind === 'task')) visit(String(task.value.id));
  for (const message of bundle.messages) {
    if (message.sessionId !== sourceId || new Set(message.recipients).size !== message.recipients.length) throw new Error('Invalid message routing in backup');
    participant(message.sender); message.recipients.forEach(participant);
    if (message.taskId && !lookup('task', message.taskId)) throw new Error('Missing message task');
    for (const key of message.artifacts) if (!lookup('artifact', key)) throw new Error('Missing message artifact');
    for (const key of message.attachments ?? []) {
      const a = lookup('attachment', key); if (!a || message.recipients.some(r => !(a.recipients as string[]).includes(r))) throw new Error('Unauthorized message attachment');
    }
  }
}

function safeRelative(path: string): string[] {
  const parts = path.split('/');
  if (path.includes('\\') || path.includes(':') || path.includes('\0') || parts.some(p => !p || p === '.' || p === '..' || p.endsWith('.') || p.endsWith(' ') || sensitiveHostPath(p))) throw new Error('Unsafe archive file path');
  return parts;
}
export function captureSession(engine: Engine): SessionBundle {
  if (engine.session().state !== 'paused' || (engine.status() as { running: number }).running || engine.jobs.list().some(j => j.state === 'running')) throw new Error('Pause and settle this session before creating a backup or fork');
  const files: z.output<typeof File>[] = []; const excluded: string[] = []; let total = 0;
  const collect = (root: string, area: 'workspace' | 'history', agentId?: string, relative = '') => {
    if (!existsSync(root)) return;
    if (lstatSync(root).isSymbolicLink()) throw new Error('Backup roots cannot be links');
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name; const full = join(root, entry.name);
      if (entry.isSymbolicLink() || sensitiveHostPath(entry.name) || (area === 'workspace' && entry.name.startsWith('.'))) { excluded.push(`${area}/${path}`); continue; }
      if (entry.isDirectory()) collect(full, area, agentId, path);
      else if (entry.isFile() && (area === 'workspace' || entry.name.endsWith('.jsonl'))) {
        safeRelative(path); const size = lstatSync(full).size;
        if (size > 16 * 1024 * 1024) throw new Error('Backup file exceeds 16 MiB');
        const bytes = readFileSync(full); total += bytes.length;
        if (bytes.length > 16 * 1024 * 1024 || total > 32 * 1024 * 1024) throw new Error('Backup files exceed 16 MiB per file or 32 MiB total');
        files.push({ area, agentId, path, data: bytes.toString('base64'), hash: hash(bytes) });
      }
    }
  };
  collect(engine.session().workspace, 'workspace');
  for (const agent of engine.agents()) collect(join(dirname(engine.repo.path), 'sessions', engine.sessionId, agent.id), 'history', agent.id);
  return Payload.parse({ version: 1, createdAt: timestamp(), session: engine.session(), agents: engine.agents(), entities: kinds.flatMap(kind => engine.repo.list<Record<string, unknown>>(kind, engine.sessionId).map(value => ({ kind, value }))), messages: engine.repo.messages(engine.sessionId, undefined, Number.MAX_SAFE_INTEGER), events: engine.repo.events(engine.sessionId), files, excluded });
}
export function writeBundle(bundle: SessionBundle, path: string): void {
  const payload = Payload.parse(bundle); const text = JSON.stringify({ format: 'roundtable-session', sha256: hash(JSON.stringify(payload)), payload });
  if (Buffer.byteLength(text) > maxBytes) throw new Error('Session backup exceeds 64 MiB');
  writeFileSync(path, text, { flag: 'wx', mode: 0o600 });
}
export function readBundle(path: string): SessionBundle {
  if (!lstatSync(path).isFile() || lstatSync(path).size > maxBytes) throw new Error('Backup must be a regular file up to 64 MiB');
  const raw = readFileSync(path); if (raw.length > maxBytes) throw new Error('Backup exceeds 64 MiB');
  const envelope = Envelope.parse(JSON.parse(raw.toString('utf8')));
  if (hash(JSON.stringify(envelope.payload)) !== envelope.sha256) throw new Error('Session backup checksum mismatch');
  return envelope.payload;
}

/** Import creates a new paused branch. Historical instructions are data, never grants. */
export function restoreBundle(repo: Repository, input: SessionBundle, projectRoot: string, name?: string): SessionRecord {
  const bundle = Payload.parse(input); const source = bundle.session;
  if (Buffer.byteLength(JSON.stringify(bundle)) > maxBytes) throw new Error('Session backup exceeds 64 MiB');
  validateContents(bundle);
  const sessionId = id(); const home = dirname(repo.path); const workspace = join(home, 'workspaces', sessionId); const histories = join(home, 'sessions', sessionId);
  const ids = new Map<string, string>([[z.string().parse(source.id), sessionId]]);
  const unique = new Set<string>();
  for (const value of [...bundle.agents, ...bundle.entities.map(e => e.value), ...bundle.messages]) {
    const old = z.string().min(1).parse(value.id);
    if (unique.has(old) || (old === source.id && !bundle.entities.some(e => e.kind === 'draft' && e.value === value))) throw new Error('Duplicate resource identity in backup'); unique.add(old);
    if (!ids.has(old)) ids.set(old, id());
  }
  if (source.referenceMap) for (const [ancestor, current] of Object.entries(z.record(z.string(), z.string()).parse(source.referenceMap))) {
    const mapped = ids.get(current); if (mapped && !ids.has(ancestor)) ids.set(ancestor, mapped);
  }
  const ref = (key: string) => ids.get(key) ?? key;
  // Only structural references change. Text and artifact bytes retain their original hashes.
  const remap = (value: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(value).map(([key, v]) => [key,
    ['id', 'sessionId', 'sender', 'author', 'owner', 'taskId', 'correlationId', 'previousVersion'].includes(key) && typeof v === 'string' ? ref(v) :
    ['recipients', 'dependencies', 'attachments', 'artifacts'].includes(key) && Array.isArray(v) ? v.map(item => typeof item === 'string' ? ref(item) : { ...item, id: ref(item.id) }) : v]));
  const safePermissions = ['collaborate', 'memory', 'artifact', 'workspace.read'];
  const session: SessionRecord = { id: sessionId, objective: z.string().min(1).max(12000).parse(source.objective), constraints: z.string().max(12000).parse(source.constraints ?? ''), policy: z.enum(['open', 'goal', 'structured', 'parallel']).parse(source.policy), createdAt: timestamp(), state: 'paused', reason: 'Imported branch: review inputs, participants and access before /resume', workspace, projectRoot: realpathSync(projectRoot), name: name ?? `${String(source.name ?? source.objective).slice(0, 100)} (branch)`, permissions: safePermissions, limits: Limits.parse(source.limits), usage: { exchanges: 0, toolCalls: 0, requests: 0, tokens: 0, dollars: 0 }, providerRequests: {}, sourceSession: String(source.id), referenceMap: Object.fromEntries(ids) };
  if (source.workflow) {
    const workflow = z.object({ stages: z.array(Stage).min(1).max(20) }).parse(source.workflow);
    session.workflow = { stages: workflow.stages, index: 0, ready: [], startedAt: timestamp(), artifactIds: [], history: [] };
  }
  if (source.projectInstructions ?? source.importedProjectInstructions) session.importedProjectInstructions = InstructionSnapshot.parse(source.projectInstructions ?? source.importedProjectInstructions);
  // Validate and stage all files before making the branch visible in SQLite.
  const paths = new Set<string>(); let total = 0;
  try {
    mkdirSync(workspace, { recursive: true });
    for (const file of bundle.files) {
      const parts = safeRelative(file.path); const bytes = Buffer.from(file.data, 'base64'); total += bytes.length;
      if (hash(bytes) !== file.hash || bytes.length > 16 * 1024 * 1024 || total > 32 * 1024 * 1024) throw new Error('Backup file checksum or size mismatch');
      if (file.area === 'history' && (!file.agentId || !bundle.agents.some(a => a.id === file.agentId) || parts.length !== 1 || !file.path.endsWith('.jsonl'))) throw new Error('Invalid agent history file');
      const root = file.area === 'workspace' ? workspace : join(histories, ids.get(file.agentId!)!);
      const destination = resolve(root, ...parts); const key = process.platform === 'win32' ? destination.toLowerCase() : destination;
      if (paths.has(key)) throw new Error('Duplicate archive file path'); paths.add(key); mkdirSync(dirname(destination), { recursive: true });
      if (file.area === 'history') {
        const lines = bytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
        if (lines[0]?.type !== 'session' || lines[0]?.version !== 3) throw new Error('Unsupported Pi history header; expected version 3');
        const entries = new Set<string>();
        for (const line of lines.slice(1)) {
          const entry = z.object({ type: z.string(), id: z.string().min(1), parentId: z.string().nullable(), timestamp: z.string() }).parse(line);
          if (entries.has(entry.id) || (entry.parentId !== null && !entries.has(entry.parentId))) throw new Error('Invalid Pi history ancestry');
          entries.add(entry.id);
        }
        lines[0] = { ...lines[0], id: id(), cwd: workspace, parentSession: undefined };
        writeFileSync(destination, lines.map(line => JSON.stringify(line)).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
      } else writeFileSync(destination, bytes, { flag: 'wx', mode: 0o600 });
    }
    repo.transaction(() => {
      repo.put('session', session);
      for (const original of bundle.agents) {
        const agent: AgentRecord = { ...original, id: ids.get(original.id)!, sessionId, state: original.state === 'removed' ? 'removed' : 'active', compatible: false, permissions: original.permissions.filter(p => safePermissions.includes(p)) };
        repo.put('agent', agent);
      }
      for (const entity of bundle.entities) {
        const value = remap(entity.value) as Record<string, unknown>; value.sessionId = sessionId;
        if (entity.kind === 'draft') value.id = entity.value.id === source.id ? sessionId : `${sessionId}:audience`;
        // Historical execution receipts/checkpoints/jobs are retained as evidence, never executable control records.
        if (['checkpoint', 'job', 'operation'].includes(entity.kind)) { repo.event(sessionId, 'imported_execution_record', { kind: entity.kind, original: entity.value }); continue; }
        if (entity.kind === 'task' && value.state === 'claimed') { value.state = 'open'; delete value.owner; }
        repo.put(entity.kind as EntityKind, value as { id: string; sessionId: string });
      }
      for (const original of bundle.messages) {
        const m = remap(original) as typeof original; m.sessionId = sessionId;
        repo.insertMessage(m); for (const recipient of m.recipients) repo.delivery(m.id, recipient, 'cancelled', 'Imported history; no automatic replay');
      }
      repo.event(sessionId, 'branch_imported', { sourceSession: source.id, sourceCreatedAt: bundle.createdAt, referenceMap: session.referenceMap, excludedFiles: bundle.excluded, originalEvents: bundle.events, warning: 'Prior effects are history, not rerun instructions. Required access and workflow acceptance must be configured again.' });
    });
    return session;
  } catch (error) {
    // Both paths contain a freshly generated UUID beneath this runtime; no archive path controls cleanup roots.
    rmSync(workspace, { recursive: true, force: true }); rmSync(histories, { recursive: true, force: true }); throw error;
  }
}
