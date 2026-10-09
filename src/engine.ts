import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { Repository } from './storage.js';
import { ToolRegistry, installTools } from './tools.js';
import { installNetworkTools } from './network-tools.js';
import { installHostTools } from './host-tools.js';
import { AgentInput, Limits, MessageInput, id, timestamp, redact, type AgentAdapter, type AgentRecord, type Approval, type Message, type MessageDraft, type SessionRecord } from './domain.js';

export type AdapterFactory = (agent: AgentRecord, engine: Engine) => Promise<AgentAdapter>;
export class Engine extends EventEmitter {
  readonly tools: ToolRegistry;
  private adapters = new Map<string, AgentAdapter>();
  private active = new Map<string, Promise<void>>();
  private scheduled = false;
  private closing = false;
  private sessionTimer?: ReturnType<typeof setTimeout>;
  private started = Date.now();
  constructor(readonly repo: Repository, readonly sessionId: string, readonly factory: AdapterFactory, recover = true) {
    super(); this.session(); if (recover) this.repo.recover(sessionId); this.tools = new ToolRegistry(this); installTools(this.tools); installNetworkTools(this.tools); installHostTools(this.tools);
  }
  static create(repo: Repository, workspaceRoot: string, objective: string, options: { limits?: z.input<typeof Limits>; policy?: SessionRecord['policy']; constraints?: string; permissions?: string[] } = {}): SessionRecord {
    if (!objective.trim() || objective.length > 12000) throw new Error('Objective must be 1–12000 characters');
    const sessionId = id(); const workspace = resolve(workspaceRoot, sessionId); mkdirSync(workspace, { recursive: true });
    const record: SessionRecord = { id: sessionId, objective: redact(objective), policy: options.policy ?? 'goal', constraints: options.constraints ?? '', createdAt: timestamp(), state: 'active', workspace,
      permissions: options.permissions ?? ['collaborate', 'memory', 'artifact', 'workspace.read', 'workspace.write', 'git.read', 'execute.container', 'network.research', 'mcp.remote'], limits: Limits.parse(options.limits ?? {}),
      usage: { exchanges: 0, toolCalls: 0, requests: 0, tokens: 0, dollars: 0 }, providerRequests: {} };
    repo.put('session', record); repo.event(sessionId, 'session_created', record); return record;
  }
  session(): SessionRecord { const record = this.repo.get<SessionRecord>('session', this.sessionId); if (!record) throw new Error('Session not found'); return record; }
  agents(): AgentRecord[] { return this.repo.list<AgentRecord>('agent', this.sessionId); }
  status(): unknown { return { ...this.session(), agents: this.agents(), deliveries: this.repo.deliveries(this.sessionId, ['pending', 'inflight', 'failed']), running: this.active.size }; }
  authorized(agent: AgentRecord, permission: string): boolean {
    const current = this.repo.get<AgentRecord>('agent', agent.id);
    return current?.sessionId === this.sessionId && current.state === 'active' && current.permissions.includes(permission) && this.session().permissions.includes(permission);
  }
  consume(metric: keyof SessionRecord['usage'], amount = 1, admission = false): void {
    const session = this.session();
    if (session.state !== 'active' && !admission) throw new Error(`Session paused: ${session.reason ?? 'human request'}`);
    if (Date.now() - this.started >= session.limits.timeoutMs) { void this.pause('Session timeout'); throw new Error('Session timeout'); }
    if (session.usage[metric] + amount > session.limits[metric]) { void this.pause(`Budget reached: ${metric}`); throw new Error(`Budget reached: ${metric}`); }
    session.usage[metric] += amount; this.repo.put('session', session);
  }
  request(agent: AgentRecord, admission = false): void {
    const session = this.session(); const count = session.providerRequests?.[agent.provider] ?? 0;
    if (session.usage.tokens >= session.limits.tokens || session.usage.dollars >= session.limits.dollars) {
      void this.pause('Token or estimated spending budget reached'); throw new Error('Token or estimated spending budget reached');
    }
    const limit = session.limits.providerRequests?.[agent.provider];
    if (limit !== undefined && count >= limit) { void this.pause(`Provider request budget reached: ${agent.provider}`); throw new Error('Provider request budget reached'); }
    this.consume('requests', 1, admission);
    const updated = this.session(); updated.providerRequests = { ...updated.providerRequests, [agent.provider]: count + 1 }; this.repo.put('session', updated);
    this.repo.event(this.sessionId, 'provider_request', { agentId: agent.id, provider: agent.provider, model: agent.model, admission });
  }
  recordUsage(agentId: string, tokens: number, dollars: number, source: string): void {
    const session = this.session();
    session.usage.tokens += Math.max(0, Number.isFinite(tokens) ? tokens : 0);
    session.usage.dollars += Math.max(0, Number.isFinite(dollars) ? dollars : 0);
    this.repo.put('session', session); this.repo.event(this.sessionId, 'usage', { agentId, tokens, dollars, source });
    if (session.usage.tokens >= session.limits.tokens || session.usage.dollars >= session.limits.dollars) void this.pause('Token or estimated spending budget reached');
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
    for (const agent of this.agents().filter(a => a.state === 'active')) {
      if (this.adapters.has(agent.id)) continue;
      try { this.adapters.set(agent.id, await this.factory(agent, this)); }
      catch (error) { agent.state = 'paused'; this.repo.put('agent', agent); this.repo.event(this.sessionId, 'agent_failed', { agentId: agent.id, error: redact(String(error)) }); this.emit('activity', { type: 'error', agentId: agent.id, error: redact(String(error)) }); }
    }
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
    this.repo.event(this.sessionId, 'agent_state', { agentId, state }); this.kick();
  }
  send(draft: MessageDraft): Message {
    const input = MessageInput.parse(draft);
    if (input.sessionId !== this.sessionId) throw new Error('Wrong session');
    const duplicate = input.id ? this.repo.message(input.id) : undefined;
    if (duplicate) {
      if (duplicate.sessionId !== input.sessionId || duplicate.sender !== input.sender || duplicate.body !== redact(input.body) || duplicate.threadId !== input.threadId || duplicate.type !== input.type || duplicate.taskId !== input.taskId || duplicate.correlationId !== input.correlationId || JSON.stringify(duplicate.artifacts) !== JSON.stringify(input.artifacts) || (!input.recipients.includes('*') && JSON.stringify(duplicate.recipients) !== JSON.stringify([...new Set(input.recipients)]))) throw new Error('Message ID collision');
      return duplicate;
    }
    const sender = this.agents().find(a => a.id === input.sender);
    if (input.sender !== 'human' && input.sender !== 'system' && (!sender || sender.state !== 'active')) throw new Error('Sender is not active');
    const recipients = [...new Set(input.recipients.flatMap(r => r === '*' ? this.agents().filter(a => a.state !== 'removed' && a.id !== input.sender).map(a => a.id) : [r]))];
    for (const recipient of recipients) if (!this.agents().some(a => a.id === recipient && a.state !== 'removed')) throw new Error(`Unknown recipient: ${recipient}`);
    if (recipients.includes(input.sender)) throw new Error('Self messaging is disabled');
    if (input.taskId) { const task = this.repo.get<{ sessionId: string }>('task', input.taskId); if (!task || task.sessionId !== this.sessionId) throw new Error('Unknown session task reference'); }
    for (const ref of input.artifacts) { const artifact = this.repo.get<{ sessionId: string }>('artifact', ref); if (!artifact || artifact.sessionId !== this.sessionId) throw new Error('Unknown session artifact reference'); }
    const previous = this.repo.messages(this.sessionId, undefined, 12);
    if (input.sender !== 'human' && previous.some(m => m.sender === input.sender && m.body === redact(input.body) && m.threadId === input.threadId && JSON.stringify(m.recipients) === JSON.stringify(recipients))) throw new Error('Repeated identical message suppressed');
    if (this.repo.deliveries(this.sessionId, ['pending', 'inflight']).length + recipients.length > this.session().limits.queue) throw new Error('Message queue full');
    this.consume('exchanges');
    const message = this.repo.transaction(() => {
      return this.repo.insertMessage({ ...input, id: input.id ?? id(), recipients, body: redact(input.body), timestamp: timestamp() });
    });
    this.emit('activity', { type: 'message', message }); this.kick(); return message;
  }
  assistant(agent: AgentRecord, body: string): void {
    if (!body.trim()) return;
    const message = this.repo.insertMessage({ id: id(), sessionId: this.sessionId, sender: agent.id, recipients: [], threadId: 'main', type: 'reply', body: redact(body.slice(0, 24000)), artifacts: [], timestamp: timestamp() });
    this.emit('activity', { type: 'message', message });
  }
  decide(approvalId: string, approve: boolean): void {
    const approval = this.repo.get<Approval>('approval', approvalId);
    if (!approval || approval.sessionId !== this.sessionId || approval.state !== 'pending') throw new Error('Unknown pending approval');
    const agent = this.agents().find(a => a.id === approval.agentId); if (!agent || agent.state === 'removed') throw new Error('Agent no longer available');
    if (approve && !this.session().permissions.includes(approval.capability)) throw new Error('Capability excluded by session policy');
    approval.state = approve ? 'approved' : 'rejected';
    if (approve && !approval.command) { agent.permissions = [...new Set([...agent.permissions, approval.capability])]; this.repo.put('agent', agent); }
    this.repo.put('approval', approval); this.repo.event(this.sessionId, 'approval_decided', approval);
  }
  private kick(): void {
    if (this.scheduled || this.closing) return; this.scheduled = true;
    setImmediate(() => { this.scheduled = false; this.dispatch(); });
  }
  private dispatch(): void {
    if (this.closing || this.session().state !== 'active') return;
    for (const delivery of this.repo.deliveries(this.sessionId)) {
      if (this.active.size >= this.session().limits.concurrency) break;
      if (this.active.has(delivery.agentId)) continue;
      const agent = this.agents().find(a => a.id === delivery.agentId && a.state === 'active');
      const adapter = this.adapters.get(delivery.agentId); if (!agent || !adapter) continue;
      const message = this.repo.message(delivery.messageId)!;
      this.repo.delivery(message.id, agent.id, 'inflight');
      const job = this.deliver(adapter, agent, message).finally(() => { this.active.delete(agent.id); this.kick(); });
      this.active.set(agent.id, job);
    }
  }
  private async deliver(adapter: AgentAdapter, agent: AgentRecord, message: Message): Promise<void> {
    const timer = setTimeout(() => { void adapter.abort(); }, this.session().limits.turnTimeoutMs);
    try {
      await adapter.prompt(JSON.stringify({ objective: this.session().objective, policy: this.session().policy, constraints: this.session().constraints, incoming: message }));
      const current = this.repo.get<AgentRecord>('agent', agent.id);
      this.repo.delivery(message.id, agent.id, this.session().state === 'active' && current?.state === 'active' ? 'acknowledged' : 'pending');
    } catch (error) {
      const paused = this.session().state !== 'active' || this.closing || this.repo.get<AgentRecord>('agent', agent.id)?.state !== 'active';
      this.repo.delivery(message.id, agent.id, paused ? 'pending' : 'failed', String(error));
      this.repo.event(this.sessionId, 'delivery_error', { agentId: agent.id, messageId: message.id, error: redact(String(error)) });
      this.emit('activity', { type: 'error', agentId: agent.id, error: redact(String(error)) });
    } finally { clearTimeout(timer); }
  }
  async pause(reason = 'Human request'): Promise<void> {
    const session = this.session(); session.state = 'paused'; session.reason = reason; this.repo.put('session', session);
    this.repo.event(this.sessionId, 'paused', { reason }); clearTimeout(this.sessionTimer);
    this.emit('activity', { type: 'system', text: `Paused: ${reason}` });
    await Promise.all([...this.adapters.values()].map(a => a.abort()));
  }
  resume(): void {
    const session = this.session(); session.state = 'active'; delete session.reason; this.repo.put('session', session); this.started = Date.now();
    clearTimeout(this.sessionTimer); this.sessionTimer = setTimeout(() => { void this.pause('Session timeout'); }, session.limits.timeoutMs); this.sessionTimer.unref(); this.kick();
  }
  retryFailed(): void { for (const d of this.repo.deliveries(this.sessionId, ['failed'])) this.repo.delivery(d.messageId, d.agentId, 'pending'); this.kick(); }
  async idle(timeoutMs = 30000): Promise<void> {
    const start = Date.now();
    while (true) {
      await new Promise<void>(r => setTimeout(r, 10));
      const runnable = this.repo.deliveries(this.sessionId).some(d => this.adapters.has(d.agentId) && this.agents().some(a => a.id === d.agentId && a.state === 'active'));
      if (this.active.size === 0 && (!runnable || this.session().state === 'paused')) return;
      if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for collaboration');
    }
  }
  export(): unknown { return { session: this.session(), agents: this.agents(), messages: this.repo.messages(this.sessionId, undefined, Number.MAX_SAFE_INTEGER), deliveries: this.repo.deliveries(this.sessionId, ['pending', 'inflight', 'acknowledged', 'failed']), tasks: this.repo.list('task', this.sessionId), artifacts: this.repo.list('artifact', this.sessionId), notes: this.repo.list('note', this.sessionId), approvals: this.repo.list('approval', this.sessionId), events: this.repo.events(this.sessionId) }; }
  async close(): Promise<void> {
    this.closing = true; clearTimeout(this.sessionTimer); await Promise.all([...this.adapters.values()].map(a => a.abort()));
    await Promise.all(this.active.values()); for (const adapter of this.adapters.values()) adapter.dispose(); this.adapters.clear();
  }
}
