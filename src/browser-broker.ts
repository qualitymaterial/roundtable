import { createServer, type Server, type Socket } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, lstatSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { browserPrivateDirectory } from './browser-private.js';
import { BrowserFrames, BrowserSnapshot, browserProof, sameProof, encodeBrowserFrame, type BrowserPage } from './browser-protocol.js';

const Hello = z.object({ type: z.literal('hello'), nonce: z.string().regex(/^[a-f0-9]{64}$/), proof: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; } }
export function readBrowserFile(path: string): unknown {
  const st = lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink() || st.size > 4096) throw new Error('Invalid browser bridge configuration');
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** One broker per home; one authenticated browser connection, bound to one session. */
export class BrowserBroker {
  private server?: Server;
  private peer?: Socket;
  private sockets = new Set<Socket>();
  private directory?: string;
  private instance = randomUUID();
  private recent: number[] = [];
  constructor(readonly home: string, readonly sessionId: string, private readonly receive: (snapshot: BrowserPage) => { sourceId: string; hash: string }, private readonly disconnected: () => void) {}
  status() { return { running: !!this.server, connected: !!this.peer, sessionId: this.sessionId, transport: 'authenticated native messaging and local IPC', readOnly: true }; }
  async start(): Promise<void> {
    if (this.server) return;
    const directory = browserPrivateDirectory(this.home); this.directory = directory;
    const lock = join(directory, 'broker.lock');
    if (existsSync(lock)) {
      const value = z.object({ pid: z.number().int().positive(), instance: z.string().uuid() }).strict().parse(readBrowserFile(lock));
      if (alive(value.pid)) throw new Error('A browser broker already owns this Roundtable home; close its browser session first');
      unlinkSync(lock);
    }
    const fd = openSync(lock, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify({ pid: process.pid, instance: this.instance })); closeSync(fd);
    const key = randomBytes(32).toString('hex');
    const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\roundtable-browser-${this.instance}` : join(tmpdir(), `roundtable-browser-${this.instance}.sock`);
    const server = createServer(socket => this.accept(socket, key));
    this.server = server;
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(endpoint, () => { server.off('error', reject); resolve(); }); });
      server.on('error', () => { void this.close(); });
      const route = join(directory, `route-${this.instance}.json`);
      writeFileSync(route, JSON.stringify({ protocol: 1, sessionId: this.sessionId, instance: this.instance, endpoint, key }), { mode: 0o600, flag: 'wx' });
      renameSync(route, join(directory, 'route.json')); // Replace the directory entry; never follow a stale destination link.
    } catch (error) { await this.close(); throw error; }
  }
  private accept(socket: Socket, key: string): void {
    this.sockets.add(socket); const frames = new BrowserFrames(); const nonce = randomBytes(32).toString('hex'); let paired = false;
    const deadline = setTimeout(() => socket.destroy(), 5000); deadline.unref();
    socket.on('error', () => {});
    socket.on('close', () => { clearTimeout(deadline); this.sockets.delete(socket); if (this.peer === socket) { this.peer = undefined; this.disconnected(); } });
    socket.write(encodeBrowserFrame({ type: 'challenge', protocol: 1, sessionId: this.sessionId, nonce, proof: browserProof(key, `server:${nonce}:${this.sessionId}`) }));
    socket.on('data', chunk => {
      try {
        for (const frame of frames.push(chunk)) {
          if (!paired) {
            const hello = Hello.parse(frame);
            if (!sameProof(browserProof(key, `client:${nonce}:${hello.nonce}:${this.sessionId}`), hello.proof) || this.peer) { socket.destroy(); return; }
            paired = true; clearTimeout(deadline); this.peer = socket;
            socket.write(encodeBrowserFrame({ type: 'ready', protocol: 1, sessionId: this.sessionId })); continue;
          }
          const page = BrowserSnapshot.parse(frame);
          this.recent = this.recent.filter(at => Date.now() - at < 60000);
          if (this.recent.length >= 10) { socket.write(encodeBrowserFrame({ type: 'error', message: 'Capture rate limit reached; wait before sharing again' })); continue; }
          this.recent.push(Date.now());
          try { const stored = this.receive(page); socket.write(encodeBrowserFrame({ type: 'captured', ...stored, sessionId: this.sessionId })); }
          catch { socket.write(encodeBrowserFrame({ type: 'error', message: 'Capture unavailable: use an active local-only browser session and an HTTP(S) page' })); }
        }
      } catch { socket.destroy(); }
    });
  }
  async close(): Promise<void> {
    const server = this.server; this.server = undefined;
    for (const socket of this.sockets) socket.destroy(); this.sockets.clear(); this.peer = undefined; this.disconnected();
    if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    if (this.directory) for (const name of ['route.json', 'broker.lock']) {
      const path = join(this.directory, name);
      try { const value = readBrowserFile(path) as { instance?: string }; if (value.instance === this.instance) unlinkSync(path); } catch { /* Another owner or already removed: leave it alone. */ }
    }
  }
}
