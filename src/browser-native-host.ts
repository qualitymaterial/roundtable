import { connect } from 'node:net';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';
import { readBrowserFile } from './browser-broker.js';
import { BrowserRoute, BrowserFrames, BrowserSnapshot, browserProof, sameProof, encodeBrowserFrame } from './browser-protocol.js';

const Challenge = z.object({ type: z.literal('challenge'), protocol: z.literal(1), sessionId: z.string().uuid(), nonce: z.string().regex(/^[a-f0-9]{64}$/), proof: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const Reply = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), protocol: z.literal(1), sessionId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('captured'), sourceId: z.string().uuid(), hash: z.string().regex(/^[a-f0-9]{64}$/), sessionId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('error'), message: z.string().max(500) }).strict(),
]);
export function runBrowserNativeHost(home: string, input: Readable, output: Writable): () => void {
  const route = BrowserRoute.parse(readBrowserFile(join(home, 'browser-private', 'route.json')));
  const expectedEndpoint = process.platform === 'win32' ? `\\\\.\\pipe\\roundtable-browser-${route.instance}` : join(tmpdir(), `roundtable-browser-${route.instance}.sock`);
  if (route.endpoint !== expectedEndpoint) throw new Error('Browser bridge route is outside its owned local IPC namespace');
  const socket = connect(route.endpoint); const ipc = new BrowserFrames(); const native = new BrowserFrames(); let paired = false; let challenged = false; let closed = false;
  const send = (message: unknown) => { if (!closed) output.write(encodeBrowserFrame(message)); };
  const end = () => { if (closed) return; closed = true; clearTimeout(deadline); socket.destroy(); input.off('data', onInput); input.pause(); };
  const onInput = (chunk: Buffer) => {
    try {
      for (const frame of native.push(chunk)) {
        if (!paired) throw new Error('Bridge is not ready');
        socket.write(encodeBrowserFrame(BrowserSnapshot.parse(frame)));
      }
    } catch { send({ type: 'error', message: 'Invalid or unavailable read-only browser bridge' }); end(); }
  };
  const deadline = setTimeout(() => { send({ type: 'error', message: 'No authenticated Roundtable browser session is ready' }); end(); }, 5000); deadline.unref();
  socket.on('data', chunk => {
    try {
      for (const frame of ipc.push(chunk)) {
        if (!challenged) {
          const challenge = Challenge.parse(frame);
          if (challenge.sessionId !== route.sessionId || !sameProof(browserProof(route.key, `server:${challenge.nonce}:${route.sessionId}`), challenge.proof)) throw new Error('Untrusted broker');
          const nonce = randomBytes(32).toString('hex');
          socket.write(encodeBrowserFrame({ type: 'hello', nonce, proof: browserProof(route.key, `client:${challenge.nonce}:${nonce}:${route.sessionId}`) })); challenged = true; continue;
        }
        const reply = Reply.parse(frame);
        if ('sessionId' in reply && reply.sessionId !== route.sessionId) throw new Error('Wrong browser session');
        if (reply.type === 'ready') { if (paired) throw new Error('Duplicate handshake'); paired = true; clearTimeout(deadline); }
        else if (!paired) throw new Error('Bridge is not paired');
        send(reply);
      }
    } catch { send({ type: 'error', message: 'Browser bridge authentication or protocol failed' }); end(); }
  });
  socket.on('error', () => { send({ type: 'error', message: 'Roundtable browser session is unavailable; start roundtable browser' }); end(); });
  socket.on('close', () => { send({ type: 'error', message: 'Roundtable browser session disconnected; share again after reconnecting' }); end(); });
  input.on('data', onInput); input.once('end', end); input.once('error', end); output.once('error', end);
  return end;
}
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  try { if (!process.argv[2]) throw new Error('Home is required'); runBrowserNativeHost(resolve(process.argv[2]), process.stdin, process.stdout); }
  catch { process.stdout.write(encodeBrowserFrame({ type: 'error', message: 'Start a local-only Roundtable browser session before connecting' })); process.exitCode = 1; }
}
