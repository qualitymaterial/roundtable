import { render, type Instance, type SuspendTerminal } from 'ink';
import type { Interface } from 'node:readline/promises';
import type { AgentRecord, Approval, SessionRecord } from '../domain.js';
import { safeTerminalText } from '../terminal-ui.js';
import type { TerminalInput } from '../input.js';
import { PresentationController, type LiveAgent } from './controller.js';
import { RoundtableApp } from './app.js';
import { terminalTheme } from './theme.js';

export const literalApprovalText = (text: string): string => text.replace(/[\x00-\x09\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

export type Activity = { type: string; intermediate?: boolean; delta?: string; agentId?: string; name?: string; result?: unknown; error?: string; text?: string; message?: { sender: string; body: string; recipients: string[] } };
/** Typed presentation adapter. Commands and engine operations stay in cli.ts. */
export class InkTerminal {
  readonly controller = new PresentationController();
  private instance?: Instance; private suspendTerminal?: SuspendTerminal;
  private bannerShown = false; private view: 'compact' | 'verbose';
  private sessionHeading = '';
  private shownApprovals = new Set<string>();
  private chunks = new Map<string, string>();
  constructor(view: 'compact' | 'verbose' = 'compact') { this.view = view; }
  get compact(): boolean { return this.view === 'compact'; }
  private ready = (suspend: SuspendTerminal) => { this.suspendTerminal = suspend; };
  private mount(): void { this.instance ??= render(<RoundtableApp controller={this.controller} theme={terminalTheme()} terminalReady={this.ready} />, { exitOnCtrlC: false, patchConsole: true, maxFps: 20, incrementalRendering: true, alternateScreen: false, interactive: true }); }
  async close(): Promise<void> { this.controller.close(); if (this.instance) { await this.instance.waitUntilRenderFlush(); this.instance.unmount(); this.instance.cleanup(); this.instance = undefined; } }
  input(commands: () => string[]): TerminalInput {
    this.controller.reopen(); this.controller.commands = commands; this.mount();
    const events = this.controller.inputEvents as TerminalInput['rl']; events.close = () => { this.controller.close(); };
    return { rl: events, lines: this.controller.lines, ask: this.controller.ask, askValidated: this.controller.askValidated, select: this.controller.select, setProjectRoot: root => this.controller.setProjectRoot(root), suspend: async <T,>(work: () => Promise<T>): Promise<T> => {
      await this.instance?.waitUntilRenderFlush(); if (!this.suspendTerminal) throw new Error('Terminal is not ready for an external program');
      let result!: T; await this.suspendTerminal(async () => { result = await work(); }); return result;
    } };
  }
  attach(input?: Interface): void { void input; this.mount(); }
  detach(): void { this.chunks.clear(); this.controller.update({ live: [] }); }
  prompt(): void { this.mount(); }
  submitted(): void {}
  print(value: unknown): void { this.mount(); const text = safeTerminalText(typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? String(value)); this.controller.append(text.startsWith('[error]') ? 'error' : 'notice', '', text.replace(/^\[error\]\s*/, '')); }
  menu(title: string, rows: string[], hint?: string): void { this.mount(); this.controller.append('notice', title, [...rows, ...(hint ? [hint] : [])].join('\n')); }
  banner(project: string, home: string): void { void home; this.mount(); this.controller.update({ project }); if (!this.bannerShown) { this.bannerShown = true; this.controller.append('brand', 'Roundtable', project); } }
  session(session: SessionRecord): void {
    this.controller.update({ session: safeTerminalText(session.name ?? session.objective), state: session.state });
    const heading = JSON.stringify([session.id, session.name, session.objective]);
    if (heading !== this.sessionHeading) { this.sessionHeading = heading; this.controller.append('session', session.name ?? session.id.slice(0, 8), session.objective); }
  }
  summary(session: SessionRecord, agents: AgentRecord[], tasks: number, activeIds?: string[]): void {
    this.session(session); this.controller.update({ agents: agents.filter(a => a.state !== 'removed').length, tasks });
    if (activeIds) {
      if (this.controller.snapshot().live.some(a => !activeIds.includes(a.id) && (a.done || a.failed))) this.flushActivity();
      this.controller.update({ live: this.controller.snapshot().live.filter(a => activeIds.includes(a.id)) });
    }
  }
  startupAgents(agents: AgentRecord[]): void { this.controller.update({ agents: agents.length }); this.menu('Participants', agents.map(a => `${a.name} · ${a.provider}/${a.model}`)); }
  agents(agents: AgentRecord[]): void { this.menu('Participants', agents.flatMap(a => [`${a.name} · ${a.provider}/${a.model} · ${a.state}`, `${a.id} · ${a.permissions.join(', ')}`])); }
  host(policy: NonNullable<SessionRecord['hostAccess']>): void { this.menu('Folder access', [`Read: ${policy.readRoots.join(', ') || 'off'}`, `Write: ${policy.writeRoots.join(', ') || 'off'}`, `Host shell: ${policy.shell ? 'exact command approval; OS user privileges' : 'off'}`]); }
  startupAccess(policy: NonNullable<SessionRecord['hostAccess']>): void { this.print(`Access: ${policy.writeRoots.length ? 'read/edit' : policy.readRoots.length ? 'read' : 'shared workspace only'} · host shell ${policy.shell ? 'per-command approval' : 'off'} · /host for roots`); }
  status(session: SessionRecord, agents: AgentRecord[], running: number, queued: number): void { this.menu('Session status', [`${session.state} · ${agents.length} participants · ${running} running · ${queued} queued`, session.reason ?? '', `Tokens: ${session.usage.tokens} / ${session.limits.tokens ?? 'off'}`, `Provider requests: ${session.usage.requests} / ${session.limits.requests}`, `Estimated cost: $${session.usage.dollars.toFixed(4)} / $${session.limits.dollars}`, '/budget to adjust limits']); }
  settings(defaults: SessionRecord['limits'], browser: boolean, folder: string, current?: SessionRecord['limits']): void { const lines = (x: SessionRecord['limits']) => `Tokens ${x.tokens ?? 'off'} · requests ${x.requests} · tools ${x.toolCalls} · estimated cost $${x.dollars}`; this.menu('Settings', [...(current ? [`Current session: ${lines(current)}`] : []), `New sessions: ${lines(defaults)}`, `Browser login: ${browser ? 'enabled' : 'disabled'}`, folder]); }
  tools(tools: unknown[]): void { this.menu('Tools', (tools as { name: string; permission: string; availability: string }[]).map(t => `${t.name} · ${t.permission} · ${t.availability}`)); }
  paused(reason: string, help: string): void { void help; this.flushActivity(); this.chunks.clear(); this.controller.update({ live: [], state: 'paused' }); this.menu('Paused · work saved', [reason, '/resume to continue · /budget for limits']); }
  pendingApproval(approval: Approval, label?: string): void { if (!this.shownApprovals.has(approval.id)) this.approval(approval, label); }
  approval(approval: Approval, label = approval.agentId): void { this.shownApprovals.add(approval.id); this.mount(); this.controller.append('approval', label, [`Capability: ${approval.capability}`, `Scope: ${approval.command ? 'single invocation with OS user privileges; not sandboxed' : 'participant capability within this session'}`, approval.reason, ...(approval.command ? [`Directory: ${literalApprovalText(approval.command.cwd)}`, literalApprovalText(approval.command.text)] : []), `/approve ${approval.id}`, `/reject ${approval.id}`].join('\n')); }
  setView(view: 'compact' | 'verbose'): void { this.flushActivity(); this.view = view; }
  flushActivity(): void {
    const completed = this.controller.snapshot().live.filter(a => a.done || a.failed);
    if (completed.length) this.controller.append('activity', 'Activity', completed.map(a => `${a.label} · ${a.done} completed${a.failed ? ` · ${a.failed} failed` : ''} · ${a.tool ?? 'tools'}`).join('\n') + '\n/activity for details');
    this.controller.update({ live: this.controller.snapshot().live.map(a => ({ ...a, done: 0, failed: 0 })) });
  }
  private live(id: string, label: string, model: string, patch: Partial<LiveAgent>): void {
    const entries = this.controller.snapshot().live; const previous = entries.find(a => a.id === id) ?? { id, label, model, text: '', running: 0, done: 0, failed: 0 };
    this.controller.update({ live: [...entries.filter(a => a.id !== id), { ...previous, ...patch }] });
  }
  receive(event: Activity, agent?: AgentRecord): void {
    this.mount(); const id = agent?.id ?? event.agentId ?? event.message?.sender ?? 'system';
    const label = safeTerminalText(agent?.name ?? id); const model = agent ? safeTerminalText(`${agent.provider}/${agent.model}`) : '';
    if (event.type === 'stream') {
      const raw = ((this.chunks.get(id) ?? '') + (event.delta ?? '')).slice(0, 24000); this.chunks.set(id, raw);
      const hold = Math.max(128, ...Object.entries(process.env).filter(([k]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(k)).map(([, v]) => v?.length ?? 0));
      // Only complete lines beyond the credential holdback are shown before completion.
      const end = raw.lastIndexOf('\n', Math.max(0, raw.length - hold));
      this.live(id, label, model, { text: end > 0 ? safeTerminalText(raw.slice(0, end)) : '' }); return;
    }
    if (event.type === 'message' && event.message) {
      this.chunks.delete(id); this.live(id, label, model, { text: '' });
      if (this.compact && event.message.sender !== 'human' && (event.intermediate || event.message.recipients.length)) return;
      this.flushActivity(); this.controller.update({ live: this.controller.snapshot().live.filter(a => a.id !== id) });
      this.controller.append('message', event.message.sender === 'human' ? 'You' : label, event.message.body, { agentId: id, model: model || undefined }); return;
    }
    if (event.type === 'tool' || event.type === 'tool_result') {
      const previous = this.controller.snapshot().live.find(a => a.id === id); const data = event.result as { ok?: boolean; data?: unknown } | undefined;
      this.live(id, label, model, { tool: safeTerminalText(event.name ?? 'tool'), running: Math.max(0, (previous?.running ?? 0) + (event.type === 'tool' ? 1 : -1)), done: (previous?.done ?? 0) + (data?.ok === true ? 1 : 0), failed: (previous?.failed ?? 0) + (data?.ok === false ? 1 : 0) });
      if (data?.ok === false || !this.compact && data) this.controller.append(data?.ok === false ? 'error' : 'activity', `${label} · ${event.name}`, typeof data?.data === 'string' ? data.data : JSON.stringify(data?.data));
      return;
    }
    if (event.type === 'paused') this.paused(event.text ?? 'Paused', '');
    else if (event.type === 'error') { this.flushActivity(); this.controller.update({ live: this.controller.snapshot().live.filter(a => a.id !== id) }); this.controller.append('error', label, event.error ?? 'Unknown error'); }
    else if (event.type !== 'approval') this.print(event.text ?? `[${event.type}] ${label}`);
  }
}
