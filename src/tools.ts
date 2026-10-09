import { Type, type Static, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { JsonValue } from '@earendil-works/pi-ai';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, lstat, realpath } from 'node:fs/promises';
import { resolve, relative, dirname, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { id, timestamp, redact, messageTypes, type AgentRecord, type Approval, type Note, type Task } from './domain.js';
import { SQLiteArtifactStore } from './artifacts.js';
import type { Engine } from './engine.js';

export type ToolContext = { engine: Engine; agent: AgentRecord; signal: AbortSignal };
export type ToolSpec = { name: string; description: string; inputSchema: TSchema; outputSchema: TSchema; permission: string; version: string; owner: string; execute: (args: unknown, context: ToolContext) => Promise<unknown> };
export interface ToolProvider { register(registry: ToolRegistry): void }
export interface ToolExecutor { execute(agent: AgentRecord, name: string, args: unknown, callId: string, signal?: AbortSignal): Promise<unknown> }
export const resultSchema = Type.Object({ ok: Type.Boolean(), data: Type.Unknown() });
const text = (max = 12000) => Type.String({ minLength: 1, maxLength: max });
const empty = Type.Object({}, { additionalProperties: false });

export class ToolRegistry implements ToolExecutor {
  private entries = new Map<string, ToolSpec>();
  private pending = new Map<string, { fingerprint: string; promise: Promise<unknown> }>();
  constructor(readonly engine: Engine) {}
  register<T extends TSchema>(name: string, description: string, schema: T, permission: string, execute: (args: Static<T>, context: ToolContext) => Promise<unknown> | unknown, owner = 'roundtable'): void {
    if (!/^[a-z][a-z0-9_]{2,80}$/.test(name) || this.entries.has(name)) throw new Error('Invalid or duplicate tool name');
    this.entries.set(name, { name, description, inputSchema: schema, outputSchema: resultSchema, permission, version: '0.1.0', owner,
      execute: async (args, context) => { if (!Value.Check(schema, args)) throw new Error('Invalid tool input'); return execute(args as Static<T>, context); } });
  }
  remove(name: string): void { this.entries.delete(name); }
  list(agent: AgentRecord): unknown[] {
    return [...this.entries.values()].map(spec => ({ name: spec.name, description: spec.description, inputSchema: spec.inputSchema, outputSchema: spec.outputSchema, permission: spec.permission, version: spec.version, owner: spec.owner, availability: this.engine.authorized(agent, spec.permission) ? 'authorized' : 'approval-required', executionStatus: 'ready' }));
  }
  names(): string[] { return [...this.entries.keys()]; }
  async execute(agent: AgentRecord, name: string, args: unknown, callId: string, signal?: AbortSignal): Promise<unknown> {
    const key = `${agent.sessionId}:${agent.id}:${callId}`;
    const fingerprint = this.fingerprint(name, args);
    const existing = this.pending.get(key); if (existing) return existing.fingerprint === fingerprint ? existing.promise : { ok: false, data: 'Tool call ID collision' };
    const execution = this.executeOnce(agent, name, args, callId, signal).finally(() => { this.pending.delete(key); });
    this.pending.set(key, { fingerprint, promise: execution }); return execution;
  }
  private async executeOnce(agent: AgentRecord, name: string, args: unknown, callId: string, signal?: AbortSignal): Promise<unknown> {
    const cacheId = `${agent.sessionId}:${agent.id}:${callId}`;
    const tool = this.entries.get(name);
    const fingerprint = this.fingerprint(name, args);
    const cached = this.engine.repo.cached(cacheId) as { fingerprint: string; result: unknown } | undefined;
    if (cached && tool && this.engine.authorized(agent, tool.permission)) {
      if (cached.fingerprint !== fingerprint) return { ok: false, data: 'Tool call ID collision' };
      return cached.result;
    }
    const context = { engine: this.engine, agent, signal: signal ?? new AbortController().signal };
    this.engine.repo.event(agent.sessionId, 'tool_start', { agentId: agent.id, name, callId, input: args });
    this.engine.emit('activity', { type: 'tool', agentId: agent.id, name });
    let result: unknown;
    try {
      if (!tool) throw new Error('Tool unavailable');
      if (context.signal.aborted) throw new Error('Tool cancelled');
      if (!this.engine.authorized(agent, tool.permission)) throw new Error(`Permission denied: ${tool.permission}. Use roundtable_tool_request.`);
      this.engine.consume('toolCalls');
      const data = await tool.execute(args, context);
      result = { ok: true, data: data ?? null };
    } catch (error) { result = { ok: false, data: redact(error instanceof Error ? error.message : String(error)) }; }
    result = JSON.parse(redact(JSON.stringify(result))) as unknown;
    this.engine.repo.cache(cacheId, agent.sessionId, { fingerprint, result });
    this.engine.repo.event(agent.sessionId, 'tool_result', { agentId: agent.id, name, callId, result });
    this.engine.emit('activity', { type: 'tool_result', agentId: agent.id, name, result });
    return result;
  }
  piTools(agent: AgentRecord): ToolDefinition[] {
    return [...this.entries.values()].map(tool => ({
      name: tool.name, label: tool.name, description: tool.description, parameters: tool.inputSchema, outputSchema: tool.outputSchema,
      execute: async (callId, args, signal) => {
        const result = await this.execute(agent, tool.name, args, callId, signal);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result, structuredContent: result as JsonValue };
      },
    }));
  }
  private fingerprint(name: string, args: unknown): string {
    return createHash('sha256').update(JSON.stringify({ name, args, ...(name.startsWith('host_') ? { hostAccess: this.engine.session().hostAccess ?? null } : {}) })).digest('hex');
  }
}

// Workspace is an explicitly shared directory, never the caller's home or repository.
// Reject symlinks/reparse paths and sensitive names. This is file scoping, NOT a shell sandbox.
export async function workspacePath(root: string, path: string): Promise<string> {
  if (!path || isAbsolute(path) || path.includes(':') || path.includes('\\') || path.includes('\0')) throw new Error('Use a relative workspace path with / separators');
  const parts = path.split('/');
  if (parts.some(p => !p || p === '..' || p.startsWith('.') || /^(auth|credentials|secrets)(\.|$)/i.test(p))) throw new Error('Unsafe or sensitive workspace path');
  const base = await realpath(root);
  const target = resolve(base, path);
  const rel = relative(base, target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path escapes workspace');
  let current = base;
  for (const part of parts) {
    current = resolve(current, part);
    try { const info = await lstat(current); if (info.isSymbolicLink()) throw new Error('Symlinks are not shared'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return target;
}
export function installTools(registry: ToolRegistry): void {
  const engine = registry.engine;
  const artifacts = new SQLiteArtifactStore(engine.repo);
  const local = <T extends { sessionId: string }>(kind: 'task' | 'artifact', entityId: string): T => {
    const value = engine.repo.get<T>(kind, entityId);
    if (!value || value.sessionId !== engine.sessionId) throw new Error('Unknown session resource');
    return value;
  };
  registry.register('roundtable_agents_list', 'Discover session agents, models and permission scopes.', empty, 'collaborate', () => engine.agents());
  registry.register('roundtable_send', 'Queue a message; returns immediately without waiting for a reply. Use * for all other active agents.', Type.Object({ recipients: Type.Array(text(100), { minItems: 1, maxItems: 64 }), body: text(24000), type: Type.Optional(Type.Union(messageTypes.filter(t => !['human', 'system'].includes(t)).map(t => Type.Literal(t)))), threadId: Type.Optional(text(100)), correlationId: Type.Optional(text(100)), taskId: Type.Optional(text(100)), artifacts: Type.Optional(Type.Array(text(100), { maxItems: 32 })) }), 'collaborate', (args, { agent }) => engine.send({ ...args, type: args.type ?? 'direct', sender: agent.id, sessionId: engine.sessionId }));
  registry.register('roundtable_threads_list', 'List discussion threads with message counts.', empty, 'collaborate', () => {
    const counts = new Map<string, number>(); for (const m of engine.repo.messages(engine.sessionId, undefined, 10000)) counts.set(m.threadId, (counts.get(m.threadId) ?? 0) + 1);
    return [...counts].map(([threadId, count]) => ({ threadId, count }));
  });
  registry.register('roundtable_thread_read', 'Read the latest selected messages in a session thread.', Type.Object({ threadId: text(100), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }), 'collaborate', args => engine.repo.messages(engine.sessionId, args.threadId, args.limit ?? 20));
  registry.register('roundtable_task_create', 'Create a shared task. Dependencies must already exist; this prevents dependency cycles.', Type.Object({ title: text(300), dependencies: Type.Optional(Type.Array(text(100), { maxItems: 20 })) }), 'collaborate', args => {
    for (const dependency of args.dependencies ?? []) local<Task>('task', dependency);
    const task: Task = { id: id(), sessionId: engine.sessionId, title: redact(args.title), state: 'open', findings: '', dependencies: args.dependencies ?? [] };
    engine.repo.put('task', task); engine.repo.event(engine.sessionId, 'task_created', task); return task;
  });
  registry.register('roundtable_task_claim', 'Atomically claim an open task after its dependencies complete.', Type.Object({ taskId: text(100) }), 'collaborate', (args, { agent }) => engine.repo.transaction(() => {
    const task = local<Task>('task', args.taskId);
    if (task.state !== 'open') throw new Error('Task is not open');
    if (task.dependencies.some(d => local<Task>('task', d).state !== 'done')) throw new Error('Task dependencies are incomplete');
    task.state = 'claimed'; task.owner = agent.id; engine.repo.put('task', task); engine.repo.event(engine.sessionId, 'task_claimed', task); return task;
  }));
  registry.register('roundtable_task_update', 'Append findings from any collaborator. Only the owner may complete or reopen a claimed task.', Type.Object({ taskId: text(100), findings: text(), state: Type.Optional(Type.Union(['open', 'done', 'cancelled'].map(s => Type.Literal(s)))) }), 'collaborate', (args, { agent }) => {
    const task = local<Task>('task', args.taskId);
    if (['done', 'cancelled'].includes(task.state)) throw new Error('Task is terminal');
    if (args.state && (task.state !== 'claimed' || task.owner !== agent.id)) throw new Error('Only the current owner can transition a claimed task');
    if (task.findings.length + args.findings.length > 48000) throw new Error('Task findings limit reached');
    task.findings += `\n${agent.name}: ${redact(args.findings)}`;
    if (args.state) task.state = args.state;
    if (args.state === 'open') delete task.owner;
    engine.repo.put('task', task); engine.repo.event(engine.sessionId, 'task_updated', task); return task;
  });
  registry.register('roundtable_tasks_list', 'Inspect shared task states and findings.', empty, 'collaborate', () => engine.repo.list<Task>('task', engine.sessionId));
  registry.register('roundtable_artifact_publish', 'Store an immutable text artifact with SHA-256 and provenance. Content is never executed.', Type.Object({ name: text(200), content: text(64000), provenance: text(1000) }), 'artifact', (args, { agent }) => {
    return artifacts.publish(engine.sessionId, agent.id, args);
  });
  registry.register('roundtable_artifact_read', 'Read a session artifact and validate its stored hash.', Type.Object({ artifactId: text(100) }), 'artifact', args => {
    return artifacts.read(engine.sessionId, args.artifactId);
  });
  registry.register('roundtable_tools_list', 'Discover registered tools, input/output schemas, ownership and required permissions.', empty, 'collaborate', (_args, { agent }) => registry.list(agent));
  registry.register('roundtable_tool_request', 'Request human approval for a capability; does not grant it or run a pending invocation.', Type.Object({ capability: text(100), reason: text(1000) }), 'collaborate', (args, { agent }) => {
    const existing = engine.repo.list<Approval>('approval', engine.sessionId).find(a => a.agentId === agent.id && a.capability === args.capability && a.state === 'pending');
    if (existing) return existing;
    const approval: Approval = { ...args, id: id(), sessionId: engine.sessionId, agentId: agent.id, state: 'pending' };
    engine.repo.put('approval', approval); engine.repo.event(engine.sessionId, 'approval_requested', approval); return approval;
  });
  registry.register('roundtable_memory_write', 'Store a concise persistent session note or decision.', Type.Object({ text: text(8000), kind: Type.Optional(Type.Union([Type.Literal('note'), Type.Literal('decision')])) }), 'memory', (args, { agent }) => {
    const note: Note = { ...args, text: redact(args.text), kind: args.kind ?? 'note', id: id(), sessionId: engine.sessionId, author: agent.id, timestamp: timestamp() };
    engine.repo.put('note', note); engine.repo.event(engine.sessionId, 'memory_written', { id: note.id, author: note.author }); return note;
  });
  registry.register('roundtable_memory_search', 'Search persistent session notes by case-insensitive substring.', Type.Object({ query: text(300), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })) }), 'memory', args => engine.repo.list<Note>('note', engine.sessionId).filter(n => n.text.toLowerCase().includes(args.query.toLowerCase())).slice(-(args.limit ?? 10)));
  registry.register('roundtable_session_status', 'Inspect objective, policy, budgets and pending deliveries.', empty, 'collaborate', () => engine.status());
  registry.register('workspace_read', 'Read a UTF-8 text file from the dedicated shared workspace (maximum 64 KiB).', Type.Object({ path: text(500) }), 'workspace.read', async args => {
    const path = await workspacePath(engine.session().workspace, args.path);
    if ((await lstat(path)).size > 65536) throw new Error('File too large'); return readFile(path, 'utf8');
  });
  registry.register('workspace_write', 'Create or replace a text file in the dedicated shared workspace.', Type.Object({ path: text(500), content: Type.String({ maxLength: 64000 }) }), 'workspace.write', async args => {
    const path = await workspacePath(engine.session().workspace, args.path); await mkdir(dirname(path), { recursive: true });
    await writeFile(path, redact(args.content), 'utf8'); return { path: args.path, bytes: Buffer.byteLength(args.content) };
  });
  registry.register('workspace_search', 'Search up to 100 regular text files in the workspace root; no hidden files or directories.', Type.Object({ query: text(300) }), 'workspace.read', async args => {
    const root = engine.session().workspace; const results: unknown[] = [];
    for (const entry of (await readdir(root, { withFileTypes: true })).slice(0, 100)) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      try { const path = await workspacePath(root, entry.name); if ((await lstat(path)).size > 65536) continue;
        const content = await readFile(path, 'utf8'); if (content.includes(args.query)) results.push({ path: entry.name, excerpt: content.slice(Math.max(0, content.indexOf(args.query) - 80), content.indexOf(args.query) + 300) });
      } catch { /* Exclude sensitive paths. */ }
    } return results;
  });
  registry.register('data_json_validate', 'Parse and normalize JSON without evaluating code.', Type.Object({ content: text(64000) }), 'collaborate', args => JSON.parse(args.content) as unknown);
  registry.register('git_status', 'Inspect Git status in the dedicated workspace. No write operations, external diff drivers or hooks.', empty, 'git.read', (_args, { signal }) => runProcess('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', 'status', '--short', '--untracked-files=no'], engine.session().workspace, signal));
  registry.register('container_execute', 'Execute JavaScript only in the operator-configured Docker image, with no network, no host mounts and no inherited credentials.', Type.Object({ code: text(16000) }), 'execute.container', (args, { signal }) => {
    const image = process.env.ROUNDTABLE_CONTAINER_IMAGE;
    if (!image || !/^[a-zA-Z0-9][a-zA-Z0-9./:@_-]+$/.test(image)) throw new Error('Operator must configure ROUNDTABLE_CONTAINER_IMAGE (prefer an immutable digest)');
    const name = `roundtable-${id()}`;
    return runProcess('docker', ['run', '--rm', '--name', name, '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=64', '--memory=128m', '--cpus=1', '--user=65534:65534', image, 'node', '--input-type=module', '-e', args.code], engine.session().workspace, signal)
      .finally(() => { const cleanup = spawn('docker', ['rm', '-f', name], { stdio: 'ignore', windowsHide: true }); cleanup.on('error', () => {}); });
  });
}

async function runProcess(command: string, args: string[], cwd: string, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, signal, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: cwd, USERPROFILE: cwd, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '', GIT_TERMINAL_PROMPT: '0' } });
    let output = ''; const timer = setTimeout(() => child.kill(), 15000);
    const capture = (chunk: Buffer) => { output += chunk.toString(); if (output.length > 64000) child.kill(); };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (code !== 0) reject(new Error(`Process failed (${code}): ${redact(output.slice(0, 64000))}`)); else resolveResult({ code, output }); });
  });
}
