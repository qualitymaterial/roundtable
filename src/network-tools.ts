import { Type, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { McpClient, StreamableHttpTransport } from '@earendil-works/pi-mcp';
import type { ToolRegistry } from './tools.js';

function endpoint(variable: string): string {
  const raw = process.env[variable]; if (!raw) throw new Error(`Operator must configure ${variable}`);
  const url = new URL(raw); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Service URL must be HTTP(S), without embedded credentials'); return url.href;
}
async function mcp<T>(signal: AbortSignal, action: (client: McpClient) => Promise<T>): Promise<T> {
  const url = endpoint('ROUNDTABLE_MCP_URL');
  const client = new McpClient({ name: 'roundtable', version: '0.1.0', requestTimeoutMs: 15000 });
  const token = process.env.ROUNDTABLE_MCP_TOKEN;
  const transport = new StreamableHttpTransport({ url, openGetStream: false, maxMessageBytes: 65536, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    fetch: (input, init) => {
      if (new URL(input).href !== url) throw new Error('MCP attempted an unconfigured endpoint');
      return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15000), ...(init?.signal ? [init.signal] : [])]) });
    },
  });
  try { await client.connect(transport); return await action(client); } finally { await client.close(); }
}
export function installNetworkTools(registry: ToolRegistry): void {
  registry.register('web_research', 'Query the operator-configured research service. No arbitrary URL fetching. Service must accept POST {query} and return JSON.', Type.Object({ query: Type.String({ minLength: 1, maxLength: 1000 }) }), 'network.research', async (args, { signal }) => {
    const url = endpoint('ROUNDTABLE_RESEARCH_URL'); const token = process.env.ROUNDTABLE_RESEARCH_TOKEN;
    const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(args), signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
    if (!response.ok) throw new Error(`Research service HTTP ${response.status}`);
    const reader = response.body?.getReader(); if (!reader) throw new Error('Empty service response');
    let total = 0; const chunks: Uint8Array[] = [];
    try { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > 65536) throw new Error('Research result exceeds 64 KiB'); chunks.push(value); } }
    finally { await reader.cancel(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  });
  registry.register('mcp_tools_list', 'Discover tool schemas on the configured remote MCP service. Only operator-allowlisted tools can execute.', Type.Object({}), 'mcp.remote', (_args, { signal }) => mcp(signal, client => client.listTools({ signal })));
  registry.register('mcp_call', 'Invoke an operator-allowlisted remote MCP tool. The server has its own privileges; approval trusts that service.', Type.Object({ name: Type.String({ minLength: 1, maxLength: 100 }), arguments: Type.Record(Type.String(), Type.Unknown()) }), 'mcp.remote', async (args, { signal }) => {
    const allowed: unknown = JSON.parse(process.env.ROUNDTABLE_MCP_TOOLS ?? '[]');
    if (!Array.isArray(allowed) || !allowed.includes(args.name)) throw new Error('MCP tool excluded by operator allowlist');
    return mcp(signal, async client => {
      const definition = (await client.listTools({ signal })).find(t => t.name === args.name);
      if (!definition || !Value.Check(definition.inputSchema as TSchema, args.arguments)) throw new Error('Remote MCP schema rejected input');
      return client.callTool(args.name, args.arguments, { signal, timeoutMs: 15000 });
    });
  });
}
