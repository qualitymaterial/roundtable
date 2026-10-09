import { clearLine, cursorTo, moveCursor } from 'node:readline';
import { stripVTControlCharacters } from 'node:util';
import type { Interface } from 'node:readline/promises';
import type { WriteStream } from 'node:tty';
import { redact, type AgentRecord, type Approval, type SessionRecord } from './domain.js';

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
  constructor(private readonly output: WriteStream, private readonly interactive = Boolean(output.isTTY), private readonly color = interactive && !('NO_COLOR' in process.env), private readonly ascii = process.env.ROUNDTABLE_ASCII === '1') {}
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
    this.emit('\n' + this.panel('ROUNDTABLE  /  0.1.0', ['Independent agents. Shared objectives.', '', `Project  ${project}`, `Runtime  ${home}`, '', '/help  commands   /agents  participants   /status  budgets'], '36') + '\n');
  }
  attach(input: Interface): void { this.input = input; input.setPrompt(this.ink('roundtable', '1;36') + this.ink(this.ascii ? ' > ' : ' › ', '36')); }
  prompt(): void { this.prompting = true; if (this.interactive && this.input) this.input.prompt(); else this.output.write('roundtable> '); }
  submitted(): void { if (this.prompting && this.interactive) this.output.write('\n'); this.prompting = false; }
  detach(): void { this.prompting = false; this.input = undefined; }
  session(session: SessionRecord): void {
    if (!this.interactive) { this.print(`Session ${session.id}\n${session.objective}`); return; }
    this.emit(this.panel('SESSION', [session.objective, `ID  ${session.id}`, `Mode  ${session.policy}    State  ${session.state}`]));
  }
  host(policy: NonNullable<SessionRecord['hostAccess']>): void {
    if (!this.interactive) { this.print({ hostAccess: policy }); return; }
    this.emit(this.panel('MACHINE ACCESS', [`Read   ${policy.readRoots.join(', ') || 'disabled'}`, `Write  ${policy.writeRoots.join(', ') || 'disabled'}`, `Shell  ${policy.shell ? 'exact command approval / runs as your OS user' : 'disabled'}`], '2'));
  }
  agents(agents: AgentRecord[]): void {
    if (!this.interactive) { this.print(agents); return; }
    const rows = agents.flatMap(a => [`${a.name}  /  ${a.state}${a.compatible ? ' / tool-compatible' : ''}`, `  ${a.provider}  /  ${a.model}`, `  ${a.id}`, `  ${a.permissions.join(', ')}`, '']);
    this.emit(this.panel('PARTICIPANTS', rows.length ? rows : ['No agents connected. /add-agent <JSON> to join.']));
  }
  status(session: SessionRecord, agents: AgentRecord[], running: number, queued: number): void {
    if (!this.interactive) { this.print({ ...session, agents, running, queued }); return; }
    this.emit(this.panel('SESSION STATUS', [`${session.state.toUpperCase()}  /  ${agents.filter(a => a.state === 'active').length} active agents  /  ${running} running  /  ${queued} queued`,
      ...(session.reason ? [`Paused: ${session.reason}`] : []), '', `Requests   ${session.usage.requests} / ${session.limits.requests}     Tools   ${session.usage.toolCalls} / ${session.limits.toolCalls}`,
      `Exchanges  ${session.usage.exchanges} / ${session.limits.exchanges}`, `Tokens     ${session.usage.tokens.toLocaleString()} / ${session.limits.tokens.toLocaleString()}`,
      `SDK cost   $${session.usage.dollars.toFixed(4)} / $${session.limits.dollars.toFixed(2)} (estimate)`, '', '/pause  stop work   /resume  continue   /limits <JSON>  adjust']));
  }
  approval(approval: Approval): void {
    if (!this.interactive) { this.print(approval); return; }
    this.emit(this.panel(`APPROVAL  /  ${approval.state.toUpperCase()}`, [approval.reason, ...(approval.command ? [`Directory: ${approval.command.cwd}`, '', approval.command.text] : [`Capability: ${approval.capability}`]), '', `/approve ${approval.id}`, `/reject ${approval.id}`], '33'));
  }
  message(label: string, body: string, targets: string[], human: boolean): void {
    this.responding.delete(label);
    if (!this.interactive) { this.print(`\n[message] ${label} -> ${targets.join(', ') || 'human transcript'}\n${body}`); return; }
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.emit(`\n  ${this.ink(human ? 'YOU' : safeTerminalText(label), human ? '1;37' : this.agentColor(label))}  ${this.ink(stamp, '2')}\n  ${this.ink(targets.length ? `to ${safeTerminalText(targets.join(', '))}` : 'to conversation', '2')}\n\n${safeTerminalText(body).split('\n').map(line => `  ${line}`).join('\n')}\n`);
  }
  composing(label: string): void {
    if (!this.interactive || this.responding.has(label)) return;
    this.responding.add(label); this.emit(`  ${this.ink(safeTerminalText(label), this.agentColor(label))} ${this.ink('is responding…', '2')}`);
  }
  tools(tools: unknown[]): void {
    if (!this.interactive) { this.print(tools); return; }
    const rows = (tools as { name: string; permission: string; availability: string }[]).map(t => `${t.availability === 'authorized' ? '+' : '?'} ${t.name}  /  ${t.permission}`);
    this.emit(this.panel('TOOLS  /  + authorized  ? request access', rows));
  }
  tool(label: string, name: string, result?: unknown): void {
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
