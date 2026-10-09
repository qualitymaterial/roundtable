import { clearLine, cursorTo, moveCursor } from 'node:readline';
import { stripVTControlCharacters } from 'node:util';
import type { Interface } from 'node:readline/promises';
import type { WriteStream } from 'node:tty';
import { redact, type AgentRecord, type Approval, type SessionRecord } from './domain.js';
import { VERSION } from './version.js';

export function safeTerminalText(text: string): string {
  const withoutStrings = redact(text).replace(/\x1b(?:\]|P|\^|_)[\s\S]*?(?:\x07|\x1b\\)/g, '');
  return stripVTControlCharacters(withoutStrings).replace(/\r\n/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '');
}
const palette = ['36', '35', '34', '33', '32'];
export class TerminalUI {
  private input?: Interface;
  private prompting = false;
  private bannerShown = false;
  private responding = new Set<string>();
  private streams = new Map<string, { text: string; shown: number }>();
  private working = false;
  private activity = new Map<string, { running: number; completed: number; failed: number; last: string }>();
  constructor(private readonly output: WriteStream, private readonly interactive = Boolean(output.isTTY), private readonly color = interactive && !('NO_COLOR' in process.env), private readonly ascii = process.env.ROUNDTABLE_ASCII === '1', private view: 'compact' | 'verbose' = 'compact') {}
  get compact(): boolean { return this.interactive && this.view === 'compact'; }
  setView(view: 'compact' | 'verbose'): void { this.flushActivity(); this.view = view; this.streams.clear(); this.responding.clear(); this.working = false; }
  flushActivity(): void {
    if (!this.compact || !this.activity.size) return;
    const entries = [...this.activity];
    const completed = entries.reduce((n, [, a]) => n + a.completed, 0); const failed = entries.reduce((n, [, a]) => n + a.failed, 0); const running = entries.reduce((n, [, a]) => n + a.running, 0);
    this.emit(this.panel(`ACTIVITY · ${completed} done · ${running} running${failed ? ` · ${failed} failed` : ''}`, [
      ...entries.slice(-3).map(([label, a]) => `${label.split(' [')[0]} · ${a.running ? `${a.running} running` : a.failed ? `${a.failed} failed` : 'OK'} · ${a.last}`),
      ...(entries.length > 3 ? [`+ ${entries.length - 3} other participants`] : []), '/activity expands tool details · /messages shows internal discussion',
    ], '2'));
    for (const [label, a] of entries) { if (a.running) this.activity.set(label, { ...a, completed: 0, failed: 0 }); else this.activity.delete(label); }
  }
  private ink(text: string, code: string): string { return this.color ? `\x1b[${code}m${text}\x1b[0m` : text; }
  private agentColor(name: string): string { return palette[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length]!; }
  private width(): number { return Math.max(32, Math.min(this.output.columns || 88, 110)); }
  private panel(title: string, lines: string[], tone = '36'): string {
    const width = this.width() - 4; const edge = this.ascii ? '+' : '╭'; const h = this.ascii ? '-' : '─';
    const rows = lines.flatMap(line => {
      const clean = safeTerminalText(line); const parts = [];
      for (const paragraph of clean.split('\n')) { if (!paragraph) parts.push(''); else for (let i = 0; i < paragraph.length; i += width) parts.push(paragraph.slice(i, i + width)); }
      return parts;
    });
    const bar = this.ascii ? '|' : '│';
    const heading = safeTerminalText(title).slice(0, width - 2);
    return [this.ink(`${edge}${h} ${heading} ${h.repeat(Math.max(0, width - heading.length - 1))}${this.ascii ? '+' : '╮'}`, tone),
      ...rows.map(line => `${this.ink(bar, tone)} ${line.padEnd(width)} ${this.ink(bar, tone)}`), this.ink(`${this.ascii ? '+' : '╰'}${h.repeat(width + 2)}${this.ascii ? '+' : '╯'}`, tone)].join('\n');
  }
  private emit(text: string): void {
    const restore = this.interactive && this.prompting && this.input;
    if (restore) {
      const position = this.input!.getCursorPos();
      if (position.rows) moveCursor(this.output, 0, -position.rows);
      cursorTo(this.output, 0); this.output.write('\x1b[J'); clearLine(this.output, 0);
    }
    this.output.write(text + '\n');
    if (restore) this.input!.prompt(true);
  }
  print(value: unknown): void {
    const text = safeTerminalText(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    if (!this.interactive) { this.emit(text); return; }
    if (text.startsWith('[error]')) this.emit(this.panel('ERROR', [text.slice(7).trim()], '31'));
    else if (text.startsWith('[connecting]')) this.emit(`  ${this.ink(this.ascii ? '>' : '◌', '33')} ${this.ink(text.slice(13).trim(), '2')}  connecting`);
    else if (text.startsWith('[connected]')) this.emit(`  ${this.ink(this.ascii ? '+' : '●', '32')} ${text.slice(12).trim()}  ${this.ink('ready', '32')}`);
    else this.emit(text);
  }
  banner(project: string, home: string): void {
    if (this.bannerShown || !this.interactive) return;
    this.bannerShown = true;
    if (this.compact) { this.emit(`\n${this.ink(`ROUNDTABLE ${VERSION}`, '1;36')}  ${safeTerminalText(project)}\n/ help: /help   /settings   /sessions   /view verbose\n`); return; }
    this.emit('\n' + this.panel(`ROUNDTABLE  /  ${VERSION}`, ['Independent agents. Shared objectives.', '', `Project  ${project}`, `Runtime  ${home}`, '', '/  commands   /sessions  recent   /settings  configure'], '36') + '\n');
  }
  menu(title: string, rows: string[], hint = ''): void {
    const lines = [...rows, ...(hint ? ['', hint] : [])];
    if (this.interactive) this.emit(this.panel(title.toUpperCase(), lines));
    else this.print(`${title}\n${lines.join('\n')}`);
  }
  settings(defaults: SessionRecord['limits'], browserLogin: boolean, configurationFolder: string, current?: SessionRecord['limits']): void {
    if (!this.interactive) { this.print({ currentSession: current, defaultsForNewSessions: defaults, browserLogin, configurationFolder }); return; }
    const rows = (limits: SessionRecord['limits']) => [`Tokens: ${limits.tokens ?? 'off'}    Estimated dollars: ${limits.dollars}`, `Requests: ${limits.requests}    Tools: ${limits.toolCalls}`, `Exchanges: ${limits.exchanges}    Parallel agents: ${limits.concurrency}`, `Session timeout: ${limits.timeoutMs / 60000} min    Turn timeout: ${limits.turnTimeoutMs / 1000} s`];
    if (current) this.emit(this.panel('SETTINGS / CURRENT SESSION', [...rows(current), 'Applies here; usage totals are retained.'], '36'));
    this.emit(this.panel('SETTINGS / NEW SESSION DEFAULTS', [...rows(defaults), `Open login browser: ${browserLogin ? 'yes' : 'no'}`, `Saved in: ${configurationFolder}`, 'Defaults do not rewrite existing sessions.', '/login  accounts   /mcp  connections   /skills  instructions'], '35'));
  }
  attach(input?: Interface): void { this.input = input; input?.setPrompt(this.ink('roundtable', '1;36') + this.ink(this.ascii ? ' > ' : ' › ', '36')); }
  prompt(): void { this.prompting = true; if (this.interactive && this.input) this.input.prompt(); else this.output.write('roundtable> '); }
  submitted(): void { if (this.prompting && this.interactive) this.output.write('\n'); this.prompting = false; }
  detach(): void { this.prompting = false; this.input = undefined; }
  session(session: SessionRecord): void {
    if (this.compact) { this.print(`${session.name ?? session.objective}  · ${session.state}`); return; }
    if (!this.interactive) { this.print(`Session ${session.id}\n${session.objective}`); return; }
    this.emit(this.panel('SESSION', [session.objective, `ID  ${session.id}`, `Mode  ${session.policy}    State  ${session.state}`]));
  }
  host(policy: NonNullable<SessionRecord['hostAccess']>): void {
    if (!this.interactive) { this.print({ hostAccess: policy }); return; }
    this.emit(this.panel('MACHINE ACCESS', [`Read   ${policy.readRoots.join(', ') || 'disabled'}`, `Write  ${policy.writeRoots.join(', ') || 'disabled'}`, `Shell  ${policy.shell ? 'exact command approval / runs as your OS user' : 'disabled'}`], '2'));
  }
  startupAccess(policy: NonNullable<SessionRecord['hostAccess']>): void {
    if (!this.compact) { this.host(policy); return; }
    this.print(`Access: read ${policy.readRoots.join(', ') || 'off'} · write ${policy.writeRoots.join(', ') || 'off'} · shell ${policy.shell ? 'per-command approval (OS user)' : 'off'}. /host for details.`);
  }
  startupAgents(agents: AgentRecord[]): void {
    if (!this.compact) { this.agents(agents); return; }
    this.print(agents.map(a => `${a.name} [${a.provider}/${a.model}]`).join('\n') || 'No participants. /add-agent to connect.');
  }
  agents(agents: AgentRecord[]): void {
    if (!this.interactive) { this.print(agents); return; }
    const rows = agents.flatMap(a => [`${a.name}  /  ${a.state}${a.compatible ? ' / tool-compatible' : ''}`, `  ${a.provider}  /  ${a.model}`, `  ${a.id}`, `  ${a.permissions.join(', ')}`, '']);
    this.emit(this.panel('PARTICIPANTS', rows.length ? rows : ['No agents connected. /add-agent opens guided setup.']));
  }
  status(session: SessionRecord, agents: AgentRecord[], running: number, queued: number): void {
    if (!this.interactive) { this.print({ ...session, agents, running, queued }); return; }
    this.emit(this.panel('SESSION STATUS', [`${session.state.toUpperCase()}  /  ${agents.filter(a => a.state === 'active').length} active agents  /  ${running} running  /  ${queued} queued`,
      ...(session.reason ? [`Paused: ${session.reason}`] : []), '', `Requests   ${session.usage.requests} / ${session.limits.requests}     Tools   ${session.usage.toolCalls} / ${session.limits.toolCalls}`,
      `Exchanges  ${session.usage.exchanges} / ${session.limits.exchanges}`, `Timeouts   session ${session.limits.timeoutMs / 60000} min / turn ${session.limits.turnTimeoutMs / 1000} s`, `Tokens     ${session.usage.tokens.toLocaleString()} / ${session.limits.tokens?.toLocaleString() ?? 'off'}`,
      `SDK cost   $${session.usage.dollars.toFixed(4)} / $${session.limits.dollars.toFixed(2)} (estimate)`, '', '/budget  inspect or change limits   /pause  stop work   /resume  continue']));
  }
  paused(reason: string, help: string): void {
    this.flushActivity();
    this.responding.clear(); this.working = false;
    if (this.compact) { this.print(`Paused: ${reason}\n/resume to continue · /budget for limits · /status for details`); return; }
    if (!this.interactive) { this.print(`[paused] ${reason}\n${help}`); return; }
    this.emit(this.panel('PAUSED / WORK SAVED', [reason, '', help], '33'));
  }
  approval(approval: Approval): void {
    if (!this.interactive) { this.print(approval); return; }
    this.emit(this.panel(`APPROVAL  /  ${approval.state.toUpperCase()}`, [approval.reason, ...(approval.command ? [`Directory: ${approval.command.cwd}`, '', approval.command.text] : [`Capability: ${approval.capability}`]), '', `/approve ${approval.id}`, `/reject ${approval.id}`], '33'));
  }
  endTurn(label: string): void { this.flushActivity(); this.streams.delete(label); this.responding.delete(label); }
  message(label: string, body: string, targets: string[], human: boolean, intermediate = false): void {
    this.streams.delete(label);
    this.responding.delete(label);
    if (human) this.working = false;
    if (this.compact) {
      if (!human && (targets.length || intermediate)) return;
      this.flushActivity();
      const clean = safeTerminalText(body); const lines = clean.split('\n');
      const preview = human ? clean : lines.slice(0, 16).join('\n').slice(0, 1600);
      this.emit(`\n${this.ink(human ? 'You' : safeTerminalText(label), human ? '1;37' : this.agentColor(label))}\n${preview}${preview.length < clean.length ? '\n… Full response saved: /messages' : ''}\n`); return;
    }
    if (!this.interactive) { this.print(`\n[message] ${label} -> ${targets.join(', ') || 'human transcript'}\n${body}`); return; }
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.emit(`\n  ${this.ink(human ? 'YOU' : safeTerminalText(label), human ? '1;37' : this.agentColor(label))}  ${this.ink(stamp, '2')}\n  ${this.ink(targets.length ? `to ${safeTerminalText(targets.join(', '))}` : 'to conversation', '2')}\n\n${safeTerminalText(body).split('\n').map(line => `  ${line}`).join('\n')}\n`);
  }
  composing(label: string): void {
    if (this.compact) { if (!this.working) { this.working = true; this.emit(this.ink('Working… /status for progress · /activity for tools · /pause to interrupt', '2')); } return; }
    if (!this.interactive || this.responding.has(label)) return;
    this.responding.add(label); this.emit(`  ${this.ink(safeTerminalText(label), this.agentColor(label))} ${this.ink('is responding…', '2')}`);
  }
  stream(label: string, delta: string): void {
    if (!this.interactive) return;
    this.composing(label);
    if (this.compact) return;
    const state = this.streams.get(label) ?? { text: '', shown: 0 };
    state.text = (state.text + delta).slice(0, 24000);
    // Retain a suffix longer than configured secrets. Redact the accumulated text,
    // not isolated provider chunks, before emitting complete lines.
    const hold = Math.max(128, ...Object.entries(process.env).filter(([key]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(key)).map(([, value]) => value?.length ?? 0));
    const clean = safeTerminalText(state.text);
    const end = clean.lastIndexOf('\n', Math.max(0, clean.length - hold));
    if (end > state.shown) {
      this.emit(`  ${this.ink(safeTerminalText(label) + ' · live', '2')}\n${clean.slice(state.shown, end).split('\n').map(line => '  ' + line).join('\n')}`);
      state.shown = end + 1;
    }
    this.streams.set(label, state);
  }
  tools(tools: unknown[]): void {
    if (!this.interactive) { this.print(tools); return; }
    const rows = (tools as { name: string; permission: string; availability: string }[]).map(t => `${t.availability === 'authorized' ? '+' : '?'} ${t.name}  /  ${t.permission}`);
    this.emit(this.panel('TOOLS  /  + authorized  ? request access', rows));
  }
  tool(label: string, name: string, result?: unknown): void {
    if (this.compact) {
      const data = result as { ok?: boolean; data?: unknown } | undefined;
      const group = this.activity.get(label) ?? { running: 0, completed: 0, failed: 0, last: name };
      group.last = name;
      if (result === undefined) group.running++; else { group.running = Math.max(0, group.running - 1); if (data?.ok === false) group.failed++; else group.completed++; }
      this.activity.set(label, group);
      if (data?.ok === false) this.print(`[error] ${label} · ${name}: ${safeTerminalText(typeof data.data === 'string' ? data.data : JSON.stringify(data.data) ?? 'Tool failed').slice(0, 600)}\n/activity for full details`);
      else if (result === undefined) this.composing(label);
      return;
    }
    if (!this.interactive) { this.print(result === undefined ? `[tool] ${label}: ${name}` : `[result] ${label}: ${name} ${JSON.stringify(result).slice(0, 600)}`); return; }
    const data = result as { ok?: boolean; data?: unknown } | undefined;
    const state = !data ? 'RUN' : data.ok ? 'OK' : 'FAIL';
    this.emit(`  ${this.ink(state.padEnd(4), !data ? '33' : data.ok ? '32' : '31')} ${this.ink(safeTerminalText(name), '1')}  ${this.ink(safeTerminalText(label), '2')}`);
    if (data) {
      const text = JSON.stringify(data.data) ?? String(data.data);
      this.emit(`       ${safeTerminalText(text).slice(0, 450)}${text.length > 450 ? ' … /activity for details' : ''}`);
    }
  }
}
