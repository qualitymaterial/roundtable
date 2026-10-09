import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type IncomingMessage } from 'node:http';
import { LATEST_PROTOCOL_VERSION } from '@earendil-works/pi-mcp';
import { fixture, agent, tool } from './helpers.js';

async function serve(server: Server): Promise<string> {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test address'); return `http://127.0.0.1:${address.port}/`;
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let text = ''; for await (const chunk of request) text += String(chunk); return JSON.parse(text) as Record<string, unknown>;
}
test('configured research uses a fixed service, respects permissions and rejects redirects', async () => {
  const server = createServer(async (req, res) => {
    const input = await body(req);
    if (input.query === 'redirect') { res.writeHead(302, { Location: 'http://127.0.0.1:1/' }); res.end(); return; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ findings: ['source one'], query: input.query }));
  }); const url = await serve(server); const f = fixture();
  const previous = process.env.ROUNDTABLE_RESEARCH_URL; process.env.ROUNDTABLE_RESEARCH_URL = url;
  try {
    const a = await agent(f.engine); assert.equal((await tool(f.engine, a, 'web_research', { query: 'memory' })).ok, false);
    a.permissions.push('network.research'); f.repo.put('agent', a);
    const result = await tool<{ query: string }>(f.engine, a, 'web_research', { query: 'memory' }); assert.equal(result.ok, true); assert.equal(result.data.query, 'memory');
    assert.equal((await tool(f.engine, a, 'web_research', { query: 'redirect' })).ok, false);
  } finally { if (previous === undefined) delete process.env.ROUNDTABLE_RESEARCH_URL; else process.env.ROUNDTABLE_RESEARCH_URL = previous; await f.close(); await new Promise<void>(r => server.close(() => r())); }
});
test('Pi MCP client discovers schemas and executes only allowlisted, authorized tools', async () => {
  let executions = 0;
  const server = createServer(async (req, res) => {
    if (req.method === 'DELETE') { res.writeHead(200); res.end(); return; }
    const rpc = await body(req); const params = rpc.params as { arguments?: { value: string } } | undefined;
    if (rpc.id === undefined) { res.writeHead(202); res.end(); return; }
    const result = rpc.method === 'initialize' ? { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'test-service', version: '1.0' } }
      : rpc.method === 'tools/list' ? { tools: [{ name: 'echo', description: 'Return input', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } }] }
      : { content: [{ type: 'text', text: params?.arguments?.value }] };
    if (rpc.method === 'tools/call') executions++;
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  }); const url = await serve(server); const f = fixture();
  const previousUrl = process.env.ROUNDTABLE_MCP_URL; const previousTools = process.env.ROUNDTABLE_MCP_TOOLS;
  process.env.ROUNDTABLE_MCP_URL = url; process.env.ROUNDTABLE_MCP_TOOLS = '["echo"]';
  try {
    const a = await agent(f.engine); assert.equal((await tool(f.engine, a, 'mcp_tools_list')).ok, false); a.permissions.push('mcp.remote'); f.repo.put('agent', a);
    const list = await tool<unknown[]>(f.engine, a, 'mcp_tools_list'); assert.equal(list.ok, true); assert.equal(list.data.length, 1);
    assert.equal((await tool(f.engine, a, 'mcp_call', { name: 'other', arguments: {} })).ok, false);
    assert.equal((await tool(f.engine, a, 'mcp_call', { name: 'echo', arguments: { value: 5 } })).ok, false);
    const output = await tool<{ content: { text: string }[] }>(f.engine, a, 'mcp_call', { name: 'echo', arguments: { value: 'actual MCP result' } });
    assert.equal(output.ok, true); assert.equal(output.data.content[0]?.text, 'actual MCP result'); assert.equal(executions, 1);
  } finally {
    if (previousUrl === undefined) delete process.env.ROUNDTABLE_MCP_URL; else process.env.ROUNDTABLE_MCP_URL = previousUrl;
    if (previousTools === undefined) delete process.env.ROUNDTABLE_MCP_TOOLS; else process.env.ROUNDTABLE_MCP_TOOLS = previousTools;
    await f.close(); await new Promise<void>(r => server.close(() => r()));
  }
});
