import { protectSecret } from './domain.js';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { McpOAuthProvider, OAuthCallbackServer, authorizeMcp, adaptOAuthProvider, type McpOAuthState } from '@earendil-works/pi-mcp/oauth';
import type { Connection } from './connections.js';
import type { MenuIO } from './input.js';
import { saveJson } from './setup.js';
import { openBrowser } from './auth-ui.js';
import { boundedText } from './research.js';

type Http = Extract<Connection, { type: 'http' }>;
type Saved = { redirectUrl: string; origins: string[]; state: McpOAuthState };
const key = (config: Http) => createHash('sha256').update(config.url).digest('hex');
const path = (home: string, config: Http) => join(home, 'mcp-auth', key(config) + '.json');
const adapters = new Map<string, ReturnType<typeof adaptOAuthProvider>>();
export function oauthState(home: string, config: Http): Saved | undefined {
  const file = path(home, config); if (!existsSync(file)) return undefined;
  const value = JSON.parse(readFileSync(file, 'utf8')) as Saved;
  if (value.state?.serverUrl !== config.url || !Array.isArray(value.origins) || typeof value.redirectUrl !== 'string') throw new Error('Invalid MCP OAuth state; sign in again');
  protectSecret(value.state.tokens?.access_token); protectSecret(value.state.tokens?.refresh_token); protectSecret(value.state.clientInformation?.client_secret);
  return value;
}
export function logoutMcp(home: string, config: Http): void { rmSync(path(home, config), { force: true }); adapters.delete(home + key(config)); }
export function oauthFetch(origins: string[], signal: AbortSignal, approve?: (origin: string) => Promise<boolean>) {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input); if (url.username || url.password || !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('OAuth endpoints require HTTPS or loopback HTTP');
    if (!origins.includes(url.origin)) { if (!approve || !await approve(url.origin)) throw new Error('Unapproved OAuth origin: ' + url.origin); origins.push(url.origin); }
    const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15000), ...(init?.signal ? [init.signal] : [])]) });
    // OAuth must be able to inspect non-success bodies, but never unbounded streams.
    const text = await boundedText(new Response(response.body, { status: 200 }), 65536);
    return new Response(text || null, { status: response.status, headers: response.headers });
  };
}
export function oauthAdapter(home: string, config: Http) {
  const cacheKey = home + key(config); const existing = adapters.get(cacheKey); if (existing) return existing;
  const saved = oauthState(home, config); if (!saved) throw new Error('Use /mcp manage to sign in with OAuth first');
  const provider = new McpOAuthProvider({ serverUrl: config.url, redirectUrl: saved.redirectUrl, clientMetadata: { client_name: 'Roundtable' }, clientId: config.clientId,
    store: { load: () => oauthState(home, config)?.state, save: state => { protectSecret(state.tokens?.access_token); protectSecret(state.tokens?.refresh_token); saveJson(path(home, config), { ...saved, state }); } },
    onRedirect: () => { throw new Error('MCP authorization expired or needs additional consent. Use /mcp manage to sign in again.'); } });
  const adapter = adaptOAuthProvider(provider); adapters.set(cacheKey, adapter); return adapter;
}
export async function loginMcp(home: string, config: Http, io: MenuIO, browser = openBrowser): Promise<void> {
  const callback = await OAuthCallbackServer.listen({ timeoutMs: 120000 }); let state: McpOAuthState | undefined; let authorization: URL | undefined;
  const origins = [new URL(config.url).origin]; const signal = AbortSignal.timeout(120000);
  const request = oauthFetch(origins, signal, async origin => (await io.ask(`Allow OAuth discovery/registration/token requests to ${origin}? [y/N]`)).toLowerCase() === 'y');
  const provider = new McpOAuthProvider({ serverUrl: config.url, redirectUrl: callback.redirectUrl, clientMetadata: { client_name: 'Roundtable', application_type: 'native' }, clientId: config.clientId, store: { load: () => state, save: value => { state = value; } }, onRedirect: url => { authorization = url; } });
  try {
    const result = await authorizeMcp(provider, { serverUrl: config.url, fetch: request, signal });
    if (result === 'REDIRECT') {
      if (!authorization) throw new Error('OAuth did not return an authorization URL');
      io.print('Authorize Roundtable at: ' + authorization.href);
      const pending = callback.waitForCallback(await provider.state());
      await browser(authorization.href).catch(() => io.print('Open the displayed address manually.'));
      const waiting = new AbortController();
      const response = await Promise.race([pending, io.ask('Waiting for browser sign-in. Enter waits; Escape or cancel stops.', false, waiting.signal).then(() => pending)]).finally(() => waiting.abort());
      await authorizeMcp(provider, { serverUrl: config.url, authorizationCode: response.code, iss: response.iss, fetch: request, signal });
    }
    if (!state?.tokens?.access_token) throw new Error('OAuth did not return an access token');
    protectSecret(state.tokens.access_token); protectSecret(state.tokens.refresh_token);
    mkdirSync(join(home, 'mcp-auth'), { recursive: true }); saveJson(path(home, config), { state, redirectUrl: callback.redirectUrl, origins }); adapters.delete(home + key(config)); io.print('MCP sign-in saved privately. Select tools/resources before enabling access.');
  } finally { await callback.close(); }
}
