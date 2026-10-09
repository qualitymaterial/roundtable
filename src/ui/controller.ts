import { EventEmitter } from 'node:events';
import type { Key } from 'ink';
import { completeFileMention } from '../composer.js';
import { safeTerminalText } from '../terminal-ui.js';

export type Entry = { id: number; kind: 'brand' | 'session' | 'message' | 'notice' | 'error' | 'approval' | 'activity'; title: string; body: string; agentId?: string; model?: string };
export type LiveAgent = { id: string; label: string; model: string; text: string; tool?: string; running: number; done: number; failed: number };
export type Composer = { mode: 'idle' | 'chat' | 'ask' | 'pick'; label: string; text: string; cursor: number; secret: boolean; choices: { index: number; label: string }[]; selected: number; suggestions: string[]; notice?: string };
export type Presentation = { entries: Entry[]; live: LiveAgent[]; composer: Composer; project: string; session: string; state: string; agents: number; tasks: number; closed: boolean };
export const graphemes = (value: string): string[] => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(s => s.segment);
const clean = (value: string) => safeTerminalText(value);
export function fuzzyChoices(labels: string[], query: string): { index: number; label: string }[] {
  const needle = query.toLocaleLowerCase();
  return labels.map((label, index) => ({ label, index })).filter(({ label }) => { let position = 0; for (const char of label.toLocaleLowerCase()) if (char === needle[position]) position++; return position === needle.length; });
}
/** View state and input only. No database, provider calls or authorization decisions. */
export class PresentationController {
  private events = new EventEmitter();
  readonly inputEvents = new EventEmitter();
  private state: Presentation = { entries: [], live: [], composer: { mode: 'idle', label: '', text: '', cursor: 0, secret: false, choices: [], selected: 0, suggestions: [] }, project: '', session: '', state: 'local', agents: 0, tasks: 0, closed: false };
  private buffer = ''; private cursor = 0; private history: string[] = []; private historyIndex = 0; private historyDraft = ''; private labels: string[] = [];
  private waiting: ((line: IteratorResult<string>) => void)[] = [];
  private question?: { resolve(value: string): void; reject(error: Error): void };
  private validator?: (value: string) => string | undefined;
  private index = 0;
  private root?: string;
  commands: () => string[] = () => [];
  snapshot = (): Presentation => this.state;
  subscribe = (callback: () => void): (() => void) => { this.events.on('change', callback); return () => this.events.off('change', callback); };
  update(patch: Partial<Presentation>): void { this.state = { ...this.state, ...patch }; this.events.emit('change'); }
  append(kind: Entry['kind'], title: string, body: string, identity?: Pick<Entry, 'agentId' | 'model'>): void {
    this.update({ entries: [...this.state.entries, { id: ++this.index, kind, title: clean(title), body: clean(body), ...identity }] });
  }
  private edit(patch: Partial<Composer> = {}): void {
    const c = { ...this.state.composer, ...patch };
    c.text = c.secret ? '*'.repeat(graphemes(this.buffer).length) : this.buffer; c.cursor = this.cursor;
    c.suggestions = c.mode === 'chat' && /^\/[\w-]*$/.test(this.buffer) ? this.commands().filter(command => command.startsWith(this.buffer)).slice(0, 5) : [];
    if (c.mode === 'pick') { c.choices = fuzzyChoices(this.labels, this.buffer); c.selected = Math.min(c.selected, Math.max(0, c.choices.length - 1)); }
    this.update({ composer: c });
  }
  setProjectRoot(root: string): void { this.root = root; }
  readonly lines: AsyncIterableIterator<string> = { [Symbol.asyncIterator]() { return this; }, next: () => {
    if (this.state.closed) return Promise.resolve({ done: true, value: undefined });
    this.edit({ mode: 'chat', label: 'Message the selected audience', secret: false });
    return new Promise(resolve => this.waiting.push(resolve));
  } };
  ask = async (label: string, secret = false, signal?: AbortSignal): Promise<string> => {
    if (this.question || this.state.closed) throw new Error('Input is unavailable'); signal?.throwIfAborted();
    const saved = { buffer: this.buffer, cursor: this.cursor, composer: this.state.composer }; this.buffer = ''; this.cursor = 0;
    const promise = new Promise<string>((resolve, reject) => { this.question = { resolve, reject }; });
    this.edit({ mode: 'ask', label: clean(label), secret, notice: undefined });
    const abort = () => this.question?.reject(new Error('Cancelled')); signal?.addEventListener('abort', abort, { once: true });
    try { return await promise; }
    finally { signal?.removeEventListener('abort', abort); this.question = undefined; this.buffer = saved.buffer; this.cursor = saved.cursor; this.update({ composer: saved.composer }); }
  };
  askValidated = async (label: string, validate: (value: string) => string | undefined): Promise<string> => {
    this.validator = validate; try { return await this.ask(label); } finally { this.validator = undefined; }
  };
  select = async (label: string, labels: string[]): Promise<number> => {
    if (this.question || this.state.closed) throw new Error('Input is unavailable');
    const saved = { buffer: this.buffer, cursor: this.cursor, composer: this.state.composer }; this.buffer = ''; this.cursor = 0; this.labels = labels.map(clean);
    const promise = new Promise<string>((resolve, reject) => { this.question = { resolve, reject }; });
    this.edit({ mode: 'pick', label: clean(label), secret: false, selected: 0, notice: undefined });
    try { const index = Number(await promise); this.append('notice', label, this.labels[index]!); return index; }
    finally { this.question = undefined; this.labels = []; this.buffer = saved.buffer; this.cursor = saved.cursor; this.update({ composer: saved.composer }); }
  };
  paste(text: string): void {
    if (this.state.composer.mode === 'idle') return;
    const normalized = text.replace(/\r\n?/g, '\n');
    if (this.state.composer.secret && /[\x00-\x08\x0b-\x1f\x7f]/.test(normalized)) { this.edit({ notice: 'Control characters were discarded.' }); return; }
    const value = this.state.composer.secret ? normalized : clean(normalized);
    if (this.state.composer.secret && /\n/.test(value.trim())) { this.edit({ notice: 'Paste a single credential value. Multiple lines were discarded.' }); return; }
    this.insert(this.state.composer.secret ? value.trim() : value);
  }
  private insert(text: string): void {
    if (this.buffer.length + text.length > 24000) { this.edit({ notice: 'Input limit is 24,000 characters. Use an attachment for larger text.' }); return; }
    const value = graphemes(this.buffer); const added = graphemes(text); value.splice(this.cursor, 0, ...added); this.buffer = value.join(''); this.cursor += added.length; this.edit({ selected: 0, notice: undefined });
  }
  key(input: string, key: Partial<Key>): void {
    const mode = this.state.composer.mode;
    if (key.ctrl && input === 'c') { this.question?.reject(new Error('Cancelled')); this.inputEvents.emit('SIGINT'); return; }
    if (key.ctrl && input === 'd' && !this.buffer) { this.close(); return; }
    if (mode === 'idle') return;
    if (key.escape) { if (this.question) this.question.reject(new Error('Cancelled')); else this.edit({ notice: 'Draft retained. Ctrl+U clears; Ctrl+C pauses work.' }); return; }
    if (mode === 'pick' && (key.upArrow || key.downArrow)) { const n = this.state.composer.choices.length; this.edit({ selected: n ? (this.state.composer.selected + (key.upArrow ? -1 : 1) + n) % n : 0 }); return; }
    if (key.return) {
      if (key.shift || key.meta) { if (mode === 'chat') this.insert('\n'); return; }
      if (mode === 'pick' && this.buffer.trim().toLowerCase() === 'cancel') { this.question?.reject(new Error('Cancelled')); return; }
      if (mode === 'pick') { const choice = this.state.composer.choices[this.state.composer.selected]; if (choice) this.question?.resolve(String(choice.index)); return; }
      if (this.question) { if (!this.state.composer.secret && this.buffer.trim().toLowerCase() === 'cancel') this.question.reject(new Error('Cancelled')); else { const error = this.validator?.(this.buffer); if (error) { this.edit({ notice: clean(error) }); return; } this.question.resolve(this.buffer); } return; }
      if (this.waiting.length) { const value = this.buffer; if (value.trim()) { this.history.push(value); if (this.history.length > 100) this.history.shift(); } this.historyIndex = this.history.length; this.buffer = ''; this.cursor = 0; this.edit({ mode: 'idle' }); this.waiting.shift()!({ value, done: false }); } return;
    }
    if (key.tab) {
      if (mode !== 'chat') return;
      const choices = this.root && /(?:^|\s)@/.test(this.buffer) ? completeFileMention(this.buffer, this.root)[0] : this.commands().filter(c => c.startsWith(this.buffer));
      if (choices.length) { this.buffer = choices[0]!; this.cursor = graphemes(this.buffer).length; this.edit(); } return;
    }
    if (mode === 'chat' && (key.upArrow || key.downArrow)) {
      if (this.historyIndex === this.history.length) this.historyDraft = this.buffer;
      this.historyIndex = Math.max(0, Math.min(this.history.length, this.historyIndex + (key.upArrow ? -1 : 1)));
      this.buffer = this.history[this.historyIndex] ?? this.historyDraft; this.cursor = graphemes(this.buffer).length; this.edit(); return;
    }
    const value = graphemes(this.buffer);
    if (key.leftArrow) this.cursor = Math.max(0, this.cursor - 1);
    else if (key.rightArrow) this.cursor = Math.min(value.length, this.cursor + 1);
    else if (key.home || key.ctrl && input === 'a') this.cursor = 0;
    else if (key.end || key.ctrl && input === 'e') this.cursor = value.length;
    else if (key.ctrl && input === 'u') { this.buffer = ''; this.cursor = 0; }
    else if (key.ctrl && input === 'k') this.buffer = value.slice(0, this.cursor).join('');
    else if (key.backspace || key.delete) { const position = key.backspace ? this.cursor - 1 : this.cursor; if (position >= 0) { value.splice(position, 1); this.buffer = value.join(''); this.cursor = Math.min(value.length, Math.max(0, position)); } }
    else if (!key.ctrl && !key.meta && input) { this.paste(input); return; }
    this.edit({ notice: undefined });
  }
  close(): void {
    if (this.state.closed) return; this.question?.reject(new Error('Input closed')); this.buffer = ''; this.cursor = 0;
    this.edit({ mode: 'idle', secret: false }); this.update({ closed: true });
    for (const done of this.waiting.splice(0)) done({ done: true, value: undefined }); this.inputEvents.emit('close');
  }
  reopen(): void { if (this.state.closed) this.update({ closed: false }); }
}
