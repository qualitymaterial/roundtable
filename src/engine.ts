import { EventEmitter } from 'node:events';
import { mkdirSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { z } from 'zod';
import { Repository } from './storage.js';
import { ToolRegistry, installTools } from './tools.js';
import { installNetworkTools } from './network-tools.js';
import { installHostTools, executeHost } from './host-tools.js';
import { ConnectionPool } from './connections.js';
import { BackgroundJobs } from './jobs.js';
import { budgetMetrics, budgetReason, exhaustedBudgets, budgetHelp } from './budgets.js';
import { Attachments } from './attachments.js';
import { Stage, stageStatus } from './policy.js';
import { acquireSession } from './session-lock.js';
import { AgentInput, Limits, MessageInput, id, timestamp, redact, type AgentAdapter, type AgentRecord, type Approval, type Message, type MessageDraft, type SessionRecord, type Task } from './domain.js';

export type AdapterFactory = (agent: AgentRecord, engine: Engine) => Promise<AgentAdapter>;
type Steering = { id: string; sessionId: string; messageId: string; agentId: string; state: 'queued' | 'delivered' | 'fallback' | 'uncertain' };
export class Engine extends EventEmitter {
  readonly tools: ToolRegistry;
  readonly jobs: BackgroundJobs;
  readonly connections: ConnectionPool;
  private adapters = new Map<string, AgentAdapter>();
  private active = new Map<string, Promise<void>>();
  private scheduled = false;
  private closing = false;
  private sessionTimer?: ReturnType<typeof setTimeout>;
  private started = Date.now();
  private warned = new Set<string>();
  private stopping?: Promise<void>;
  private releaseOwnership?: () => void;
  constructor(readonly repo: Repository, readonly sessionId: string, readonly factory: AdapterFactory, recover = true) {
    super(); this.session();
    if (recover) {
      this.releaseOwnership = acquireSession(repo.db, sessionId); this.repo.recover(sessionId); this.releaseOrphanedTasks();
      for (const pending of repo.list<Steering>('steering', sessionId).filter(s => s.state === 'queued')) {
        pending.state = 'uncertain'; repo.put('steering', pending);
        repo.delivery(pending.messageId, pending.agentId, 'failed', 'Steering interrupted by process exit; inspect agent history before retrying');
      }
    }
    this.jobs = new BackgroundJobs(repo, sessionId, executeHost, recover, job => this.notify(job.agentId, `job:${job.id}`, `Background job ${job.id} finished: ${job.state}. Inspect host_job_read for its actual result before reporting success.`));
    for (const job of this.jobs.list().filter(j => j.state === 'interrupted')) this.notify(job.agentId, `job:${job.id}`, `Background job ${job.id} was interrupted by process exit. Inspect its output; do not assume it completed or automatically rerun side effects.`);
    this.connections = new ConnectionPool(dirname(repo.path));
    this.tools = new ToolRegistry(this); installTools(this.tools); installNetworkTools(this.tools); installHostTools(this.tools);
  }
  static create(repo: Repository, workspaceRoot: string, objective: string, options: { stages?: z.input<typeof Stage>[]; projectRoot?: string; limits?: z.input<typeof Limits>; policy?: SessionRecord['policy']; constraints?: string; permissions?: string[] } = {}): SessionRecord {
    if (!objective.trim() || objective.length > 12000) throw new Error('Objective must be 1–12000 characters');
    const sessionId = id(); const workspace = resolve(workspaceRoot, sessionId); mkdirSync(workspace, { recursive: true });
    const record: SessionRecord = { id: sessionId, projectRoot: realpathSync(options.projectRoot ?? workspace), objective: redact(objective), policy: options.policy ?? 'goal', constraints: options.constraints ?? '', createdAt: timestamp(), state: 'active', workspace,
      permissions: options.permissions ?? ['collaborate', 'memory', 'artifact', 'workspace.read', 'workspace.write', 'git.read', 'execute.container', 'network.research', 'mcp.remote'], limits: Limits.parse(options.limits ?? {}),
      usage: { exchanges: 0, toolCalls: 0, requests: 0, tokens: 0, dollars: 0 }, providerRequests: {} };
    if (options.stages?.length) record.workflow = { stages: z.array(Stage).min(1).max(20).parse(options.stages), index: 0, ready: [], startedAt: timestamp(), artifactIds: [], history: [] };
    repo.put('session', record); repo.event(sessionId, 'session_created', record); return record;
  }
  session(): SessionRecord { const record = this.repo.get<SessionRecord>('session', this.sessionId); if (!record) throw new Error('Session not found'); return record; }
  agents(): AgentRecord[] { return this.repo.list<AgentRecord>('agent', this.sessionId); }
  status(): unknown { return { ...this.session(), agents: this.agents(), deliveries: this.repo.deliveries(this.sessionId, ['pending', 'inflight', 'failed']), running: this.active.size }; }
  context(agentId: string): unknown { return this.adapters.get(agentId)?.context?.() ?? { available: false }; }
  async compactAgent(agentId: string): Promise<unknown> {
    if (this.session().state !== 'active') throw new Error('Resume the session before compacting; compaction makes a metered provider call.');
    if (this.active.has(agentId)) throw new Error('Wait for this agent to finish before compacting.');
    const adapter = this.adapters.get(agentId); if (!adapter?.compact) throw new Error('Agent is not connected or does not support compaction');
    const operation = adapter.compact(); const job = operation.then(() => {}, () => {});
    this.active.set(agentId, job);
    try { return await operation; } finally { this.active.delete(agentId); this.kick(); }
  }
  authorized(agent: AgentRecord, permission: string): boolean {
    const current = this.repo.get<AgentRecord>('agent', agent.id);
    return current?.sessionId === this.sessionId && current.state === 'active' && current.permissions.includes(permission) && this.session().permissions.includes(permission);
  }
  consume(metric: keyof SessionRecord['usage'], amount = 1, admission = false): void {
    const session = this.session();
    if (session.state !== 'active' && !admission) throw new Error(`Session paused: ${session.reason ?? 'human request'}`);
    if (Date.now() - this.started >= session.limits.timeoutMs) { void this.pause('Session timeout'); throw new Error('Session timeout'); }
    const limit = session.limits[metric];
    if (limit !== null && session.usage[metric] + amount > limit) {
      const reason = budgetReason(session, metric); void this.pause(reason, true); throw new Error(reason);
    }
    session.usage[metric] += amount; this.repo.put('session', session);
    this.warnBudget();
  }
  request(agent: AgentRecord, admission = false): void {
    const session = this.session(); const count = session.providerRequests?.[agent.provider] ?? 0;
    const tokensReached = session.limits.tokens !== null && session.usage.tokens >= session.limits.tokens;
    if (tokensReached || session.usage.dollars >= session.limits.dollars) {
      const reason = budgetReason(session, tokensReached ? 'tokens' : 'dollars');
      void this.pause(reason, true); throw new Error(reason);
    }
    const limit = session.limits.providerRequests?.[agent.provider];
    if (limit !== undefined && count >= limit) {
      const reason = `Provider request budget reached: ${agent.provider} (${count} / ${limit})`;
      void this.pause(reason, true); throw new Error(reason);
    }
    this.consume('requests', 1, admission);
    const updated = this.session(); updated.providerRequests = { ...updated.providerRequests, [agent.provider]: count + 1 }; this.repo.put('session', updated);
    this.repo.event(this.sessionId, 'provider_request', { agentId: agent.id, provider: agent.provider, model: agent.model, admission });
  }
  recordUsage(agentId: string, tokens: number, dollars: number, source: string, details?: Record<string, number>): void {
    const session = this.session();
    session.usage.tokens += Math.max(0, Number.isFinite(tokens) ? tokens : 0);
    session.usage.dollars += Math.max(0, Number.isFinite(dollars) ? dollars : 0);
    this.repo.put('session', session); this.repo.event(this.sessionId, 'usage', { agentId, tokens, dollars, source, details });
    const tokensReached = session.limits.tokens !== null && session.usage.tokens >= session.limits.tokens;
    if (tokensReached || session.usage.dollars >= session.limits.dollars) {
      void this.pause(budgetReason(session, tokensReached ? 'tokens' : 'dollars'), true);
    } else this.warnBudget();
  }
  private warnBudget(): void {
    const session = this.session(); if (session.state !== 'active') return;
    for (const metric of budgetMetrics) {
      const key = `${metric}:${session.limits[metric]}`;
      const limit = session.limits[metric];
      if (limit === null || session.usage[metric] < limit * 0.8 || this.warned.has(key)) continue;
      this.warned.add(key);
      const text = `${metric}: ${session.usage[metric].toLocaleString('en-US')} / ${limit.toLocaleString('en-US')} used. Approaching the session limit; /budget shows recovery options.`;
      this.repo.event(this.sessionId, 'budget_warning', { metric, text }); this.emit('activity', { type: 'budget_warning', text });
    }
  }
  updateLimits(input: unknown): void {
    const parsed = Limits.partial().strict().parse(input);
    // Zod defaults also apply inside partial objects. Only explicitly supplied keys may change.
    const patch = Object.fromEntries(Object.keys(input as object).filter(key => (input as Record<string, unknown>)[key] !== undefined).map(key => [key, parsed[key as keyof typeof parsed]]));
    const session = this.session();
    session.limits = Limits.parse({ ...session.limits, ...patch }); this.repo.put('session', session);
    this.repo.event(this.sessionId, 'limits_changed', session.limits);
    if ('timeoutMs' in patch && session.state === 'active') {
      clearTimeout(this.sessionTimer); const remaining = session.limits.timeoutMs - (Date.now() - this.started);
      this.sessionTimer = setTimeout(() => { void this.pause('Session timeout'); }, Math.max(0, remaining)); this.sessionTimer.unref();
    }
  }
  async addAgent(input: z.input<typeof AgentInput>, validate = true): Promise<AgentRecord> {
    const parsed = AgentInput.parse(input);
    if (parsed.id && this.repo.get('agent', parsed.id)) throw new Error('Agent ID already exists');
    if (this.agents().filter(a => a.state !== 'removed').length >= 64) throw new Error('Session membership limit reached');
    const agent: AgentRecord = { ...parsed, instructions: redact(parsed.instructions), id: parsed.id ?? id(), sessionId: this.sessionId, state: 'active', compatible: false };
    this.repo.put('agent', agent);
    try {
      const adapter = await this.factory(agent, this); this.adapters.set(agent.id, adapter);
      // Live adapter performs a round-trip tool probe before returning. Test adapters opt out explicitly.
      agent.compatible = validate; this.repo.put('agent', agent); this.repo.event(this.sessionId, 'agent_added', agent); this.kick(); return agent;
    } catch (error) { agent.state = 'paused'; this.repo.put('agent', agent); this.repo.event(this.sessionId, 'agent_failed', { agentId: agent.id, error: redact(String(error)) }); throw error; }
  }
  async connect(): Promise<void> {
    // A restored paused session must remain inspectable without paid compatibility probes.
    if (this.session().state !== 'active') return;
    for (const agent of this.agents().filter(a => a.state === 'active')) {
      if (this.session().state !== 'active') break;
      if (this.adapters.has(agent.id)) continue;
      try { this.adapters.set(agent.id, await this.factory(agent, this)); }
      catch (error) {
        const budget = this.session().pauseKind === 'budget';
        agent.state = budget ? 'active' : 'paused'; this.repo.put('agent', agent);
        this.repo.event(this.sessionId, budget ? 'agent_connection_interrupted' : 'agent_failed', { agentId: agent.id, error: redact(String(error)) });
        if (!budget) this.emit('activity', { type: 'error', agentId: agent.id, error: redact(String(error)) });
      }
    }
    if (this.session().state !== 'active') return;
    this.started = Date.now(); clearTimeout(this.sessionTimer);
    this.sessionTimer = setTimeout(() => { void this.pause('Session timeout'); }, this.session().limits.timeoutMs); this.sessionTimer.unref(); this.kick();
  }
  async setAgentState(agentId: string, state: AgentRecord['state']): Promise<void> {
    const agent = this.agents().find(a => a.id === agentId); if (!agent) throw new Error('Unknown agent');
    agent.state = state; this.repo.put('agent', agent);
    const adapter = this.adapters.get(agentId);
    if (state !== 'active') { await adapter?.abort(); await this.active.get(agentId); adapter?.dispose(); this.adapters.delete(agentId); }
    else if (!adapter) {
      try { this.adapters.set(agentId, await this.factory(agent, this)); }
      catch (error) {
        agent.state = 'paused'; this.repo.put('agent', agent);
        this.repo.event(this.sessionId, 'agent_failed', { agentId, error: redact(String(error)) });
        throw error;
      }
    }
    if (state === 'removed') {
      this.releaseOrphanedTasks();
      for (const delivery of this.repo.deliveries(this.sessionId, ['pending', 'failed']).filter(d => d.agentId === agentId)) this.repo.delivery(delivery.messageId, agentId, 'cancelled', 'Participant removed by human');
    }
    this.repo.event(this.sessionId, 'agent_state', { agentId, state }); this.kick();
  }
  releaseOrphanedTasks(): void {
    const members = this.agents();
    this.repo.transaction(() => {
      for (const task of this.repo.list<Task>('task', this.sessionId)) {
        if (task.state !== 'claimed' || members.some(a => a.id === task.owner && a.state !== 'removed')) continue;
        const previousOwner = task.owner; delete task.owner; task.state = 'open';
        this.repo.put('task', task); this.repo.event(this.sessionId, 'task_owner_released', { taskId: task.id, previousOwner });
      }
    });
  }
  reassignTask(taskId: string, owner?: string): Task {
    if (this.active.size) throw new Error('Pause the session before transferring tasks while agents are working.');
    return this.repo.transaction(() => {
      const task = this.repo.get<Task>('task', taskId);
      if (!task || task.sessionId !== this.sessionId) throw new Error('Unknown session task');
      if (['done', 'cancelled'].includes(task.state)) throw new Error('Task is terminal');
      if (owner && !this.agents().some(a => a.id === owner && a.state === 'active')) throw new Error('New owner must be an active participant');
      if (owner && task.dependencies.some(d => this.repo.get<Task>('task', d)?.state !== 'done')) throw new Error('Task dependencies are incomplete');
      const previousOwner = task.owner;
      task.state = owner ? 'claimed' : 'open'; if (owner) task.owner = owner; else delete task.owner;
      this.repo.put('task', task); this.repo.event(this.sessionId, 'human_task_transfer', { taskId, previousOwner, owner }); return task;
    });
  }
  async changeModel(agentId: string, provider: string, model: string, controls: Pick<AgentRecord, 'effort' | 'maxOutputTokens' | 'contextWindowTokens'> = {}): Promise<void> {
    const old = this.agents().find(a => a.id === agentId && a.state !== 'removed');
    if (!old) throw new Error('Unknown participant');
    if (this.active.has(agentId)) throw new Error('Participant is busy. Pause it or wait for the response before changing models.');
    const candidate = AgentInput.parse({ ...old, provider, model, ...controls });
    const replacementRecord: AgentRecord = { ...old, ...candidate, compatible: true };
    let release!: () => void; const reserved = new Promise<void>(r => { release = r; }); this.active.set(agentId, reserved);
    try {
      // Validate/create before replacing the old adapter; ID, history, tasks and permissions stay intact.
      const replacement = await this.factory(replacementRecord, this);
      this.adapters.get(agentId)?.dispose(); this.adapters.set(agentId, replacement); this.repo.put('agent', replacementRecord);
      this.repo.event(this.sessionId, 'agent_model_changed', { agentId, from: { provider: old.provider, model: old.model }, to: { provider, model } });
    } finally { release(); this.active.delete(agentId); this.kick(); }
  }
  queuedHumanMessages(): Message[] {
    return [...new Set(this.repo.deliveries(this.sessionId, ['pending']).map(d => d.messageId))].map(key => this.repo.message(key)!).filter(m => m.sender === 'human');
  }
  async steer(body: string, recipients: string[]): Promise<{ message: Message; steering: number; queued: number }> {
    const message = this.send({ sessionId: this.sessionId, sender: 'human', recipients, type: 'human', body });
    const candidates = message.recipients.filter(agentId => this.session().state === 'active' && this.active.has(agentId) && this.agents().some(a => a.id === agentId && a.state === 'active') && !stageStatus(this)?.ready.includes(agentId) && this.adapters.get(agentId)?.steer);
    const records = candidates.map(agentId => {
      const record: Steering = { id: `${message.id}:${agentId}`, sessionId: this.sessionId, messageId: message.id, agentId, state: 'queued' };
      this.repo.put('steering', record); this.repo.delivery(message.id, agentId, 'inflight'); return record;
    });
    let steering = 0;
    for (const record of records) {
      const adapter = this.adapters.get(record.agentId);
      const delivered = () => {
        const current = this.repo.get<Steering>('steering', record.id);
        if (!current || current.state !== 'queued') return;
        current.state = 'delivered'; this.repo.put('steering', current); this.repo.delivery(message.id, record.agentId, 'acknowledged');
        this.repo.event(this.sessionId, 'steering_delivered', { messageId: message.id, agentId: record.agentId });
      };
      try {
        if (this.repo.get<Steering>('steering', record.id)?.state === 'queued' && await adapter?.steer?.(JSON.stringify({ humanSteering: true, incoming: message }), delivered)) { steering++; continue; }
      } catch (error) { this.repo.event(this.sessionId, 'steering_error', { agentId: record.agentId, messageId: message.id, error: redact(String(error)) }); }
      this.releaseSteering(record);
    }
    this.kick(); return { message, steering, queued: message.recipients.length - steering };
  }
  private releaseSteering(record: Steering): void {
    if (this.repo.get<Steering>('steering', record.id)?.state !== 'queued') return;
    record.state = 'fallback'; this.repo.put('steering', record); this.repo.delivery(record.messageId, record.agentId, 'pending');
    this.repo.event(this.sessionId, 'steering_queued_for_next_turn', { messageId: record.messageId, agentId: record.agentId });
  }
  reorderQueue(orderedIds: string[]): void {
    if (this.session().state !== 'paused' || this.active.size) throw new Error('Pause and settle the session before reordering pending messages');
    this.repo.orderPending(this.sessionId, orderedIds);
  }
  cancelQueued(messageId: string): void {
    const message = this.repo.message(messageId);
    if (!message || message.sessionId !== this.sessionId || message.sender !== 'human') throw new Error('Select a queued human message');
    if (this.repo.deliveries(this.sessionId, ['inflight']).some(d => d.messageId === messageId)) throw new Error('Pause the session before editing a message that is being delivered');
    this.repo.transaction(() => {
      for (const d of this.repo.deliveries(this.sessionId, ['pending']).filter(d => d.messageId === messageId)) this.repo.delivery(d.messageId, d.agentId, 'cancelled', 'Human cancelled queued delivery');
      this.repo.event(this.sessionId, 'human_queue_cancelled', { messageId });
    });
  }
  send(draft: MessageDraft, replaceQueuedId?: string): Message {
    const input = MessageInput.parse(draft);
    if (replaceQueuedId) {
      if (input.sender !== 'human' || !this.queuedHumanMessages().some(m => m.id === replaceQueuedId)) throw new Error('Only queued human messages may be replaced');
      if (this.repo.deliveries(this.sessionId, ['inflight']).some(d => d.messageId === replaceQueuedId)) throw new Error('Pause before replacing an in-flight message');
      const pending = this.repo.deliveries(this.sessionId).filter(d => d.messageId === replaceQueuedId).map(d => d.agentId).sort();
      if (JSON.stringify([...input.recipients].sort()) !== JSON.stringify(pending)) throw new Error('Replacement must target only the remaining queued recipients');
    }
    if (input.sessionId !== this.sessionId) throw new Error('Wrong session');
    const duplicate = input.id ? this.repo.message(input.id) : undefined;
    if (duplicate) {
      if (duplicate.sessionId !== input.sessionId || duplicate.sender !== input.sender || duplicate.body !== redact(input.body) || duplicate.threadId !== input.threadId || duplicate.type !== input.type || duplicate.taskId !== input.taskId || JSON.stringify(duplicate.attachments ?? []) !== JSON.stringify(input.attachments ?? []) || duplicate.correlationId !== input.correlationId || JSON.stringify(duplicate.artifacts) !== JSON.stringify(input.artifacts) || (!input.recipients.includes('*') && JSON.stringify(duplicate.recipients) !== JSON.stringify([...new Set(input.recipients)]))) throw new Error('Message ID collision');
      return duplicate;
    }
    const sender = this.agents().find(a => a.id === input.sender);
    if (input.sender !== 'human' && input.sender !== 'system' && (!sender || sender.state !== 'active')) throw new Error('Sender is not active');
    const recipients = [...new Set(input.recipients.flatMap(r => r === '*' ? this.agents().filter(a => a.state !== 'removed' && a.id !== input.sender).map(a => a.id) : [r]))];
    if (sender && stageStatus(this)?.ready.includes(sender.id)) throw new Error('Stage work is frozen until human approval');
    if (sender && stageStatus(this)?.current?.blind && recipients.length) throw new Error('Peer communication is held during independent exploration. Publish your own findings, then use roundtable_stage_ready.');
    for (const recipient of recipients) if (!this.agents().some(a => a.id === recipient && a.state !== 'removed')) throw new Error(`Unknown recipient: ${recipient}`);
    if (recipients.includes(input.sender)) throw new Error('Self messaging is disabled');
    for (const attachment of input.attachments ?? []) for (const recipient of recipients) new Attachments(this.repo, this.sessionId).read(attachment, recipient);
    if (input.taskId) { const task = this.repo.get<{ sessionId: string }>('task', input.taskId); if (!task || task.sessionId !== this.sessionId) throw new Error('Unknown session task reference'); }
    for (const ref of input.artifacts) { const artifact = this.repo.get<{ sessionId: string }>('artifact', ref); if (!artifact || artifact.sessionId !== this.sessionId) throw new Error('Unknown session artifact reference'); }
    const previous = this.repo.messages(this.sessionId, undefined, 12);
    if (input.sender !== 'human' && previous.some(m => m.sender === input.sender && m.body === redact(input.body) && m.threadId === input.threadId && JSON.stringify(m.recipients) === JSON.stringify(recipients))) throw new Error('Repeated identical message suppressed');
    if (this.repo.deliveries(this.sessionId, ['pending', 'inflight']).length + recipients.length - (replaceQueuedId ? recipients.length : 0) > this.session().limits.queue) throw new Error('Message queue full');
    const state = this.session();
    if (input.sender === 'human' && state.state === 'paused') {
      if (state.usage.exchanges >= state.limits.exchanges) throw new Error('Exchange limit reached; increase it before queuing more messages');
      state.usage.exchanges++; delete state.completion; this.repo.put('session', state);
    } else this.consume('exchanges');
    const message = this.repo.transaction(() => {
      const created = this.repo.insertMessage({ ...input, id: input.id ?? id(), recipients, body: redact(input.body), timestamp: timestamp() });
      if (replaceQueuedId) {
        for (const recipient of recipients) this.repo.delivery(replaceQueuedId, recipient, 'cancelled', 'Superseded by human');
        this.repo.event(this.sessionId, 'human_queue_replaced', { original: replaceQueuedId, replacement: created.id });
      }
      return created;
    });
    this.emit('activity', { type: 'message', message }); this.kick(); return message;
  }
  assistant(agent: AgentRecord, body: string, intermediate = false): void {
    if (!body.trim()) return;
    const message = this.repo.insertMessage({ id: id(), sessionId: this.sessionId, sender: agent.id, recipients: [], threadId: 'main', type: 'reply', body: redact(body.slice(0, 24000)), artifacts: [], timestamp: timestamp() });
    this.emit('activity', { type: 'message', message, intermediate });
  }
  decide(approvalId: string, approve: boolean): void {
    const approval = this.repo.get<Approval>('approval', approvalId);
    if (!approval || approval.sessionId !== this.sessionId || approval.state !== 'pending') throw new Error('Unknown pending approval');
    const agent = this.agents().find(a => a.id === approval.agentId); if (!agent || agent.state === 'removed') throw new Error('Agent no longer available');
    if (approve && !this.session().permissions.includes(approval.capability)) throw new Error('Capability excluded by session policy');
    approval.state = approve ? 'approved' : 'rejected';
    if (approve && !approval.command) { agent.permissions = [...new Set([...agent.permissions, approval.capability])]; this.repo.put('agent', agent); }
    this.repo.put('approval', approval); this.repo.event(this.sessionId, 'approval_decided', approval);
    this.notify(approval.agentId, `approval:${approval.id}`, `Human ${approve ? 'approved' : 'rejected'} request ${approval.id}: ${approval.capability}.${approve && approval.command ? ` Retry the exact ${approval.command.background ? 'host_job_start' : 'host_execute'} invocation: ${JSON.stringify({ command: approval.command.text, cwd: approval.command.cwd, ...(approval.command.background ? { timeoutMs: approval.command.timeoutMs } : {}) })}` : ' Adjust your next action accordingly.'}`);
  }
  notify(agentId: string, key: string, body: string): void {
    const notification = { id: `${this.sessionId}:${key}:${agentId}`, sessionId: this.sessionId, agentId, body: redact(body), state: 'pending', messageId: id() };
    if (!this.repo.get('notification', notification.id)) this.repo.put('notification', notification);
    this.kick();
  }
  private flushNotifications(): void {
    for (const n of this.repo.list<{ id: string; sessionId: string; agentId: string; body: string; state: string; messageId: string }>('notification', this.sessionId)) {
      if (n.state !== 'pending' || !this.agents().some(a => a.id === n.agentId && a.state === 'active')) continue;
      try { this.send({ id: n.messageId, sessionId: this.sessionId, sender: 'system', recipients: [n.agentId], type: 'system', body: n.body }); n.state = 'sent'; this.repo.put('notification', n); }
      catch { break; } // Budget or queue pressure: durable notification waits for resume.
    }
  }
  private kick(): void {
    if (this.scheduled || this.closing) return; this.scheduled = true;
    setImmediate(() => { this.scheduled = false; this.dispatch(); });
  }
  private dispatch(): void {
    if (this.closing || this.session().state !== 'active') return;
    this.flushNotifications();
    for (const delivery of this.repo.deliveries(this.sessionId)) {
      if (this.session().state !== 'active') break;
      if (this.active.size >= this.session().limits.concurrency) break;
      if (this.active.has(delivery.agentId)) continue;
      const agent = this.agents().find(a => a.id === delivery.agentId && a.state === 'active');
      const adapter = this.adapters.get(delivery.agentId); if (!agent || !adapter) continue;
      const message = this.repo.message(delivery.messageId)!;
      const stage = stageStatus(this);
      if (stage && (!stage.current || stage.ready.includes(agent.id) || (stage.current.blind && !['human', 'system'].includes(message.sender)))) continue;
      this.repo.delivery(message.id, agent.id, 'inflight');
      const job = this.deliver(adapter, agent, message).finally(() => { this.active.delete(agent.id); this.kick(); });
      this.active.set(agent.id, job);
    }
  }
  private async deliver(adapter: AgentAdapter, agent: AgentRecord, message: Message): Promise<void> {
    const timer = setTimeout(() => { void adapter.abort(); }, this.session().limits.turnTimeoutMs);
    try {
      const attached = (message.attachments ?? []).map(key => new Attachments(this.repo, this.sessionId).read(key, agent.id));
      const images = attached.filter(a => a.mimeType.startsWith('image/')).map(a => ({ type: 'image' as const, data: a.data, mimeType: a.mimeType }));
      await adapter.prompt(JSON.stringify({ objective: this.session().objective, policy: this.session().policy, constraints: this.session().constraints, reviewedProjectInstructions: this.session().projectInstructions?.content, stage: stageStatus(this)?.current, branch: this.session().sourceSession ? 'This is a new branch. Historical IDs refer to the source session. Discover current IDs with shared tools or roundtable_reference_resolve. Prior effects are history, never automatically repeat them.' : undefined, incoming: message, selectedReferences: attached.filter(a => a.mimeType === 'text/plain' || a.extraction).map(a => ({ name: a.name, hash: a.hash, untrustedText: a.extraction?.text ?? Buffer.from(a.data, 'base64').toString('utf8'), limitations: a.extraction?.warnings })) }), images);
      const current = this.repo.get<AgentRecord>('agent', agent.id);
      const session = this.session();
      this.repo.delivery(message.id, agent.id, !this.closing && (session.state === 'active' || session.pauseKind === 'budget') && current?.state === 'active' ? 'acknowledged' : 'pending');
    } catch (error) {
      const paused = this.session().state !== 'active' || this.closing || this.repo.get<AgentRecord>('agent', agent.id)?.state !== 'active';
      this.repo.delivery(message.id, agent.id, paused ? 'pending' : 'failed', String(error));
      this.repo.event(this.sessionId, paused ? 'delivery_interrupted' : 'delivery_error', { agentId: agent.id, messageId: message.id, error: redact(String(error)) });
      if (!paused) this.emit('activity', { type: 'error', agentId: agent.id, error: redact(String(error)) });
    } finally {
      clearTimeout(timer); adapter.clearSteering?.();
      for (const record of this.repo.list<Steering>('steering', this.sessionId).filter(s => s.agentId === agent.id && s.state === 'queued')) this.releaseSteering(record);
    }
  }
  async pause(reason = 'Human request', budget = false): Promise<void> {
    const session = this.session();
    if (session.state === 'paused') {
      if (budget || session.pauseKind !== 'budget') return this.stopping;
      // A human can still cancel calls that were finishing at a budget boundary.
      session.pauseKind = 'manual'; this.repo.put('session', session);
      this.stopping = Promise.all([...this.adapters.values()].map(a => a.abort()).concat(this.jobs.close())).then(() => {}); return this.stopping;
    }
    session.state = 'paused'; session.reason = reason; session.pauseKind = budget ? 'budget' : 'manual'; this.repo.put('session', session);
    this.repo.event(this.sessionId, 'paused', { reason }); clearTimeout(this.sessionTimer);
    this.emit('activity', { type: 'paused', text: reason });
    // Let responses already paid for finish. Execution guards block all new calls/tools.
    if (!budget) { this.stopping = Promise.all([...this.adapters.values()].map(a => a.abort()).concat(this.jobs.close())).then(() => {}); await this.stopping; }
  }
  resume(): void {
    const session = this.session(); const exhausted = exhaustedBudgets(session);
    if (exhausted.length) throw new Error(`${exhausted.join('; ')}. ${budgetHelp}`);
    if (this.active.size) throw new Error('Wait for current responses to finish before resuming. /status shows running work.');
    session.state = 'active'; session.archived = false; delete session.reason; delete session.pauseKind; delete session.completion; this.repo.put('session', session); this.started = Date.now();
    clearTimeout(this.sessionTimer); this.sessionTimer = setTimeout(() => { void this.pause('Session timeout'); }, session.limits.timeoutMs); this.sessionTimer.unref(); this.kick();
  }
  retryFailed(): void { for (const d of this.repo.deliveries(this.sessionId, ['failed'])) this.repo.delivery(d.messageId, d.agentId, 'pending'); this.kick(); }
  async idle(timeoutMs = 30000): Promise<void> {
    const start = Date.now();
    while (true) {
      await new Promise<void>(r => setTimeout(r, 10));
      const stage = stageStatus(this);
      const runnable = this.repo.deliveries(this.sessionId).some(d => this.adapters.has(d.agentId) && this.agents().some(a => a.id === d.agentId && a.state === 'active') && (!stage || (stage.current && !stage.ready.includes(d.agentId) && (!stage.current.blind || ['human', 'system'].includes(this.repo.message(d.messageId)!.sender)))));
      if (this.active.size === 0 && !this.jobs.list().some(j => j.state === 'running') && (!runnable || this.session().state === 'paused')) return;
      if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for collaboration');
    }
  }
  export(): unknown { return { session: this.session(), agents: this.agents(), messages: this.repo.messages(this.sessionId, undefined, Number.MAX_SAFE_INTEGER), deliveries: this.repo.deliveries(this.sessionId, ['pending', 'inflight', 'acknowledged', 'failed', 'cancelled']), tasks: this.repo.list('task', this.sessionId), artifacts: this.repo.list('artifact', this.sessionId), notes: this.repo.list('note', this.sessionId), approvals: this.repo.list('approval', this.sessionId), events: this.repo.events(this.sessionId) }; }
  async close(): Promise<void> {
    this.closing = true; clearTimeout(this.sessionTimer); await Promise.all([...this.adapters.values()].map(a => a.abort()).concat(this.jobs.close()));
    await Promise.all(this.active.values()); for (const adapter of this.adapters.values()) adapter.dispose(); this.adapters.clear();
    await this.connections.close();
    this.releaseOwnership?.(); this.releaseOwnership = undefined;
  }
}
