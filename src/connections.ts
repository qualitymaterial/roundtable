import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { McpClient, StreamableHttpTransport, StdioTransport } from '@earendil-works/pi-mcp';
import { saveJson } from './setup.js';
import { VERSION } from './version.js';
import { createHash } from 'node:crypto';

const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const common = { id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), enabled: z.boolean().default(false), tools: z.array(z.string().min(1).max(100)).max(200).default([]), resources: z.array(z.string().min(1).max(2000)).max(200).default([]) };
export const Connection = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('http'), url: z.url().refine(raw => { const u = new URL(raw); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; }, 'Use HTTP(S) without embedded credentials'), tokenEnv: envName.optional() }).strict(),
  z.object({ ...common, type: z.literal('stdio'), command: z.string().min(1).max(2000), args: z.array(z.string().max(4000)).max(40).default([]), cwd: z.string().min(1), envVars: z.array(envName).max(32).default([]) }).strict(),
]);
export type Connection = z.output<typeof Connection>;
export class Connections {
  constructor(readonly home: string) {}
  list(): Connection[] {
    const path = join(this.home, 'mcp.json');
    const saved = existsSync(path) ? z.array(Connection).max(32).parse(JSON.parse(readFileSync(path, 'utf8'))) : [];
    if (new Set(saved.map(c => c.id)).size !== saved.length) throw new Error('Duplicate MCP connection ID');
    if (!saved.some(c => c.id === 'legacy') && process.env.ROUNDTABLE_MCP_URL) saved.push(Connection.parse({ id: 'legacy', type: 'http', enabled: true, url: process.env.ROUNDTABLE_MCP_URL, tokenEnv: 'ROUNDTABLE_MCP_TOKEN', tools: JSON.parse(process.env.ROUNDTABLE_MCP_TOOLS ?? '[]') }));
    return saved;
  }
  save(input: unknown): Connection { const c = Connection.parse(input); if (c.id === 'legacy') throw new Error('legacy is reserved for environment configuration'); const entries = this.list().filter(e => e.id !== c.id && e.id !== 'legacy'); saveJson(join(this.home, 'mcp.json'), [...entries, c]); return c; }
  remove(id: string): void { if (id === 'legacy') throw new Error('Unset ROUNDTABLE_MCP_URL to remove the legacy connection'); saveJson(join(this.home, 'mcp.json'), this.list().filter(c => c.id !== id && c.id !== 'legacy')); }
  get(id?: string): Connection {
    const list = this.list(); const c = id ? list.find(c => c.id === id) : list.length === 1 ? list[0] : undefined;
    if (!c) throw new Error('Select a configured MCP server by ID; use mcp_servers_list.');
    if (!c.enabled) throw new Error('MCP server is disabled; human must enable it using /mcp.'); return c;
  }
  async withClient<T>(config: Connection, signal: AbortSignal, action: (client: McpClient) => Promise<T>): Promise<T> {
    const client = await this.open(config, signal);
    const abort = () => { void client.close().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
    try { signal.throwIfAborted(); return await action(client); }
    finally { signal.removeEventListener('abort', abort); await client.close(); }
  }
  protected async open(config: Connection, signal: AbortSignal): Promise<McpClient> {
    signal.throwIfAborted(); const client = new McpClient({ name: 'roundtable', version: VERSION, requestTimeoutMs: 15000 });
    const transport = config.type === 'http' ? new StreamableHttpTransport({ url: config.url, openGetStream: false, maxMessageBytes: 65536,
      headers: config.tokenEnv && process.env[config.tokenEnv] ? { Authorization: `Bearer ${process.env[config.tokenEnv]}` } : undefined,
      fetch: (input, init) => { if (new URL(input).href !== new URL(config.url).href) throw new Error('MCP attempted an unconfigured endpoint'); return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15000), ...(init?.signal ? [init.signal] : [])]) }); },
    }) : new StdioTransport({ command: config.command, args: config.args, cwd: config.cwd, inheritEnv: false,
      env: Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && (/^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LANG)$/i.test(key) || config.envVars.includes(key)))) as Record<string, string>,
      stderr: 'pipe', maxStderrBytes: 4096, maxMessageBytes: 65536, closeTimeoutMs: 1000 });
    const abort = () => { void client.close().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
    try { await client.connect(transport); signal.throwIfAborted(); return client; }
    catch (error) { await client.close().catch(() => {}); throw error; }
    finally { signal.removeEventListener('abort', abort); }
  }
}

type Lease = { key: string; server: string; owner: string; busy: boolean; controller: AbortController; client: Promise<McpClient>; timer?: ReturnType<typeof setTimeout> };
/** Per-agent server sessions. No cross-agent state sharing and no automatic tool replay. */
export class ConnectionPool extends Connections {
  private leases = new Map<string, Lease>();
  private closed = false;
  status(): { server: string; owner: string; busy: boolean }[] { return [...this.leases.values()].map(({ server, owner, busy }) => ({ server, owner, busy })); }
  async disconnect(server?: string): Promise<void> {
    await Promise.all([...this.leases.values()].filter(l => !server || l.server === server).map(l => this.drop(l)));
  }
  async close(): Promise<void> { this.closed = true; await this.disconnect(); }
  private async drop(lease: Lease): Promise<void> {
    clearTimeout(lease.timer); lease.controller.abort();
    if (this.leases.get(lease.key) === lease) this.leases.delete(lease.key);
    await lease.client.then(client => client.close(), () => {}).catch(() => {});
  }
  override async withClient<T>(requested: Connection, signal: AbortSignal, action: (client: McpClient) => Promise<T>, owner = 'human'): Promise<T> {
    signal.throwIfAborted(); if (this.closed) throw new Error('MCP pool is closed');
    const config = this.get(requested.id);
    if (JSON.stringify(config) !== JSON.stringify(requested)) throw new Error('MCP configuration changed; inspect before retrying');
    const credential = config.type === 'http' ? process.env[config.tokenEnv ?? ''] : config.envVars.map(key => process.env[key]);
    const key = createHash('sha256').update(JSON.stringify({ owner, config, credential })).digest('hex');
    for (const old of this.leases.values()) if (old.owner === owner && old.server === config.id && old.key !== key) await this.drop(old);
    let lease = this.leases.get(key);
    if (!lease) {
      if (this.leases.size >= 32) {
        const idle = [...this.leases.values()].find(l => !l.busy); if (!idle) throw new Error('MCP connection capacity reached'); await this.drop(idle);
      }
      const controller = new AbortController();
      lease = { key, server: config.id, owner, busy: false, controller, client: this.open(config, controller.signal) }; this.leases.set(key, lease);
    }
    if (lease.busy) throw new Error('This participant already has a request running on this MCP server');
    clearTimeout(lease.timer); lease.busy = true; const current = lease;
    const abort = () => { void this.drop(current); }; signal.addEventListener('abort', abort, { once: true });
    const deadline = setTimeout(abort, 20000); deadline.unref();
    try { const client = await current.client; signal.throwIfAborted(); return await action(client); }
    catch (error) { await this.drop(current); throw error; }
    finally {
      clearTimeout(deadline); signal.removeEventListener('abort', abort); current.busy = false;
      if (this.leases.get(key) === current) { current.timer = setTimeout(() => { void this.drop(current); }, 60000); current.timer.unref(); }
    }
  }
}
