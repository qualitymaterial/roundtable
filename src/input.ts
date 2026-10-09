import type { EventEmitter } from 'node:events';
import type { Interface } from 'node:readline/promises';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';
import { completeFileMention } from './composer.js';

export interface MenuIO { select?(label: string, choices: string[]): Promise<number>; ask(label: string, secret?: boolean, signal?: AbortSignal): Promise<string>; print(value: unknown): void; menu?(title: string, rows: string[], hint?: string): void }
/** One input owner for chat, menus and authentication. Secret lines never enter chat/history. */
export function createInput(commands: () => string[] = () => []) {
  let muted = false; let closed = false;
  let projectRoot: string | undefined;
  const output = new Writable({ write(chunk, _encoding, done) { if (!muted) stdout.write(chunk); done(); } });
  Object.defineProperties(output, { isTTY: { get: () => stdout.isTTY }, columns: { get: () => stdout.columns } });
  const rl = createInterface({ input: stdin, output, terminal: Boolean(stdout.isTTY), completer: line => projectRoot && /(?:^|\s)@/.test(line) ? completeFileMention(line, projectRoot) : [commands().filter(c => c.startsWith(line)), line] });
  let history: string[] = [];
  rl.on('history', values => { if (muted) values.splice(0, values.length, ...history); else history = [...values]; });
  const queue: string[] = []; const waiting: ((value: IteratorResult<string>) => void)[] = [];
  let prompt: { resolve(value: string): void; reject(error: Error): void } | undefined;
  rl.on('line', line => {
    if (prompt) { const pending = prompt; prompt = undefined; pending.resolve(line); }
    else if (muted) return; // Never route trailing pasted credential lines into chat.
    else if (waiting.length) waiting.shift()!({ value: line, done: false });
    else queue.push(line);
  });
  rl.on('close', () => { closed = true; prompt?.reject(new Error('Input closed')); for (const resolve of waiting.splice(0)) resolve({ value: undefined, done: true }); });
  rl.on('SIGINT', () => prompt?.reject(new Error('Cancelled')));
  const lines: AsyncIterableIterator<string> = { [Symbol.asyncIterator]() { return this; }, next() { return queue.length ? Promise.resolve({ value: queue.shift()!, done: false }) : closed ? Promise.resolve({ value: undefined, done: true }) : new Promise(resolve => waiting.push(resolve)); } };
  const ask = async (label: string, secret = false, signal?: AbortSignal): Promise<string> => {
    if (prompt) throw new Error('Another prompt is already open');
    if (closed && !queue.length) throw new Error('Input closed');
    if (secret && !stdin.isTTY) throw new Error('Secret entry requires a terminal; use a supported provider environment variable.');
    signal?.throwIfAborted();
    stdout.write(`${label}: `); muted = secret;
    const answer = new Promise<string>((resolve, reject) => { prompt = { resolve, reject }; });
    const abort = () => prompt?.reject(new Error('Cancelled')); signal?.addEventListener('abort', abort, { once: true });
    if (queue.length) prompt!.resolve(queue.shift()!);
    try { const value = await answer; if (!secret && value.trim().toLowerCase() === 'cancel') throw new Error('Cancelled'); return value; }
    finally { prompt = undefined; signal?.removeEventListener('abort', abort); if (secret) { rl.write(null, { ctrl: true, name: 'u' }); stdout.write('\n'); } muted = false; }
  };
  return { rl, legacyReadline: rl, lines, ask, setProjectRoot(root: string) { projectRoot = root; }, async suspend<T>(work: () => Promise<T>): Promise<T> { rl.pause(); const raw = stdin.isRaw; if (stdin.isTTY) stdin.setRawMode(false); try { return await work(); } finally { if (stdin.isTTY) stdin.setRawMode(Boolean(raw)); rl.resume(); } } };
}
export interface TerminalInput {
  rl: EventEmitter & { close(): void };
  legacyReadline?: Interface;
  lines: AsyncIterableIterator<string>;
  ask(label: string, secret?: boolean, signal?: AbortSignal): Promise<string>;
  select?(label: string, choices: string[]): Promise<number>;
  setProjectRoot(root: string): void;
  suspend<T>(work: () => Promise<T>): Promise<T>;
}
export async function choose<T>(io: MenuIO, label: string, entries: readonly T[], display: (value: T) => string): Promise<T> {
  if (!entries.length) throw new Error('No matching choices. Change the search or connect a provider.');
  if (io.select) return entries[await io.select(label, entries.map(display))]!;
  const rows = entries.map((value, i) => `${i + 1}. ${display(value)}`);
  if (io.menu) io.menu(label, rows, 'Choose a number. Type cancel to return.'); else io.print(rows.join('\n'));
  while (true) { const answer = await io.ask(label + ' (number; cancel to leave)'); const n = Number(answer); if (Number.isInteger(n) && n >= 1 && n <= entries.length) return entries[n - 1]!; io.print('Select a listed number.'); }
}
