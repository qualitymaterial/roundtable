import { redact } from '../src/domain.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { LATEST_PROTOCOL_VERSION } from '@earendil-works/pi-mcp';
import { fixture, agent, tool } from './helpers.js';
import { loginMcp, oauthState, logoutMcp, oauthFetch } from '../src/mcp-auth.js';
import { Connection, Connections } from '../src/connections.js';

test('real Pi MCP OAuth completes PKCE/state, stores credentials by endpoint, refreshes and discovers templates', { timeout: 20000 }, async () => {
  let origin = ''; let challenge = ''; let refreshes = 0; let requireRefresh = false;
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += String(chunk);
    const send = (value: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.url?.includes('oauth-protected-resource')) { send({ resource: origin + '/mcp', authorization_servers: [origin] }); return; }
    if (req.url?.includes('oauth-authorization-server') || req.url?.includes('openid-configuration')) { send({ issuer: origin, authorization_endpoint: origin + '/authorize', token_endpoint: origin + '/token', registration_endpoint: origin + '/register', response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] }); return; }
    if (req.url === '/register') { send({ ...JSON.parse(raw), client_id: 'roundtable-fixture' }, 201); return; }
    if (req.url === '/token') {
      const form = new URLSearchParams(raw);
      if (form.get('grant_type') === 'refresh_token') { refreshes++; send({ access_token: 'FIXTURE_ACCESS_2', token_type: 'Bearer', refresh_token: 'FIXTURE_REFRESH_2', expires_in: 3600 }); }
      else { assert.equal(createHash('sha256').update(form.get('code_verifier')!).digest('base64url'), challenge); assert.equal(form.get('code'), 'fixture-code'); send({ access_token: 'FIXTURE_ACCESS_1', token_type: 'Bearer', refresh_token: 'FIXTURE_REFRESH_1', expires_in: 3600 }); }
      return;
    }
    if (req.url === '/mcp') {
      if (!req.headers.authorization || requireRefresh && req.headers.authorization === 'Bearer FIXTURE_ACCESS_1') { res.writeHead(401, { 'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"` }); res.end(); return; }
      if (req.method === 'DELETE') { res.end(); return; }
      const rpc = JSON.parse(raw); if (rpc.id === undefined) { res.writeHead(202); res.end(); return; }
      send({ jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'initialize' ? { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: { resources: {} }, serverInfo: { name: 'oauth-fixture', version: '1' } } : { resourceTemplates: [{ name: 'Document', uriTemplate: 'document://{id}' }] } }); return;
    }
    send({}, 404);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`; const f = fixture();
  try {
    const config = Connection.parse({ id: 'oauth-fixture', type: 'http', url: origin + '/mcp', oauth: true, enabled: true }); if (config.type !== 'http') throw new Error('fixture');
    const shown: string[] = [];
    await loginMcp(f.home, config, { ask: async () => 'y', print: text => { shown.push(String(text)); } }, async url => {
      const auth = new URL(url); challenge = auth.searchParams.get('code_challenge')!; assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
      const callback = new URL(auth.searchParams.get('redirect_uri')!); callback.searchParams.set('code', 'fixture-code'); callback.searchParams.set('state', auth.searchParams.get('state')!);
      assert.equal((await fetch(callback)).status, 200);
    });
    assert.equal(oauthState(f.home, config)?.state.tokens?.access_token, 'FIXTURE_ACCESS_1'); assert.ok(shown.every(s => !s.includes('FIXTURE_ACCESS')));
    assert.equal(oauthState(f.home, { ...config, url: origin + '/other' }), undefined);
    requireRefresh = true; new Connections(f.home).save(config); const a = await agent(f.engine); a.permissions.push('mcp.remote'); f.repo.put('agent', a);
    const result = await tool<{ resourceTemplates: { uriTemplate: string }[] }>(f.engine, a, 'mcp_resource_templates'); assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.data.resourceTemplates[0]?.uriTemplate, 'document://{id}'); assert.equal(refreshes, 1); assert.equal(redact('FIXTURE_ACCESS_2'), '[REDACTED]');
    await assert.rejects(oauthFetch([origin], new AbortController().signal)('http://127.0.0.1:1/private'), /Unapproved/);
    await f.engine.connections.disconnect(); logoutMcp(f.home, config); assert.equal(oauthState(f.home, config), undefined);
  } finally { await f.close(); await new Promise<void>(r => server.close(() => r())); }
});
