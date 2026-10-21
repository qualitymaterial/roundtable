import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, tool } from '../helpers.js';
import { saveResearch } from '../../src/research.js';
import { WebConfig } from '../../src/web-types.js';

// Opt-in live smoke: real SearXNG search plus a public page read. Excluded from `npm test` (not in test/*.test.ts).
// Run: ROUNDTABLE_LIVE_SEARXNG_URL=https://searx.example/search npm run test:live-web
// Optional ROUNDTABLE_LIVE_SEARXNG_TOKEN_ENV names an existing environment variable holding a bearer token.
// Uses a throwaway Roundtable home; never reads or writes the installed release's settings or credential stores.
const endpoint = process.env.ROUNDTABLE_LIVE_SEARXNG_URL;
const tokenEnv = process.env.ROUNDTABLE_LIVE_SEARXNG_TOKEN_ENV;
const skip = endpoint ? false : 'ROUNDTABLE_LIVE_SEARXNG_URL is not set; live search smoke skipped';

test('live SearXNG search returns provenance-bound sources that a peer can read by handle', { skip, timeout: 60000 }, async () => {
  const f = fixture();
  try {
    saveResearch(f.home, { web: WebConfig.parse({ enabled: true, allowPublicRead: true, provider: { id: 'live', adapter: 'searxng', endpoint, ...(tokenEnv ? { tokenEnv } : {}), allowPrivateEndpoint: /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(endpoint!) } }) });
    const a = await f.engine.addAgent({ name: 'Searcher', provider: 'test', model: 'a', permissions: ['collaborate', 'network.research'] }, false);
    const b = await f.engine.addAgent({ name: 'Reader', provider: 'test', model: 'b', permissions: ['collaborate', 'network.research'] }, false);
    const found = await tool<{ sources: { id: string; url: string; hash: string; untrusted: boolean }[] }>(f.engine, a, 'web.search', { query: 'Node.js release schedule', count: 3 });
    assert.equal(found.ok, true, JSON.stringify(found).slice(0, 500));
    assert.ok(found.data.sources.length > 0, 'live provider returned no results');
    for (const s of found.data.sources) { assert.match(s.url, /^https?:\/\//); assert.equal(s.untrusted, true); assert.match(s.hash, /^[a-f0-9]{64}$/); }
    // Retrieval must succeed and yield a usable page snapshot with provenance, not just a search snippet.
    const read = await tool<{ sources: { id: string; kind: string; url: string; canonicalUrl: string; text: string; hash: string; retrievedAt: string; untrusted: boolean; totalChars: number }[] }>(f.engine, b, 'web.read', { url: found.data.sources[0]!.url });
    assert.equal(read.ok, true, `web.read failed: ${JSON.stringify(read).slice(0, 500)}`);
    const page = read.data.sources[0]; assert.ok(page, 'web.read returned no snapshot');
    assert.equal(page.kind, 'page'); assert.ok(page.text.trim().length >= 50, 'page snapshot has no usable text');
    assert.match(page.canonicalUrl, /^https?:\/\//); assert.match(page.hash, /^[a-f0-9]{64}$/); assert.ok(!Number.isNaN(Date.parse(page.retrievedAt))); assert.equal(page.untrusted, true);
    console.log(`live: ${found.data.sources.length} results; read ${page.totalChars} chars from ${page.canonicalUrl}`);
    const cached = await tool<{ source: { hash: string } }>(f.engine, b, 'web.cache', { action: 'get', sourceId: found.data.sources[0]!.id });
    assert.equal(cached.ok, true); assert.equal(cached.data.source.hash, found.data.sources[0]!.hash);
  } finally { await f.close(); }
});
