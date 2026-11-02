// Controlled real-browser capture only: no model inference or personal browser data.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Repository } from '../dist/storage.js';
import { Engine } from '../dist/engine.js';

if (process.argv.length !== 4 || process.argv[2] !== '--run-live-browser') throw new Error('Usage: node scripts/browser-companion-smoke.mjs --run-live-browser <NEW-evidence-folder>');
const output = resolve(process.argv[3]); mkdirSync(output, { recursive: false });
const home = join(output, 'runtime'); mkdirSync(home);
const repo = new Repository(join(home, 'roundtable.db'));
const session = Engine.create(repo, join(home, 'workspaces'), 'Controlled browser companion acceptance; no inference', { browserLocal: { models: [] } });
const engine = new Engine(repo, session.id, async () => { throw new Error('No model is authorized in this browser-only smoke'); });
const cookie = randomUUID();
const report = { passed: false, startedAt: new Date().toISOString(), sessionId: session.id, scope: 'Actual extension/native-host/local-IPC capture of a cookie-protected loopback fixture; no real account, local inference or cloud inference' };
const save = () => writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
const server = createServer((req, res) => {
  if (req.url === '/start') { res.writeHead(302, { 'set-cookie': `rt_fixture=${cookie}; HttpOnly; SameSite=Strict; Path=/`, location: '/private?view=fixture#roundtable' }); res.end(); return; }
  if (!req.url?.startsWith('/private') || !req.headers.cookie?.includes(`rt_fixture=${cookie}`)) { res.writeHead(401); res.end('Fixture session is not active. Open /start.'); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><title>Roundtable Companion Acceptance</title><style>body{font:20px system-ui;padding:50px;background:#f5f8f5;color:#193522}input,textarea{display:block;margin:16px 0;padding:8px}</style><h1>Roundtable Companion Acceptance</h1><p>ROUNDTABLE_VISIBLE_FIXTURE_MARKER</p><p>This page is protected by a local HttpOnly test cookie. Share it with the companion.</p><div hidden>HIDDEN_SECRET_MARKER</div><div style="display:none">CSS_HIDDEN_MARKER</div><input type="password" value="PASSWORD_SECRET_MARKER"><input value="INPUT_SECRET_MARKER"><textarea>TEXTAREA_SECRET_MARKER</textarea><div contenteditable="true">EDITABLE_SECRET_MARKER</div>');
});
let closing = false;
async function close() { if (closing) return; closing = true; clearTimeout(timeout); await engine.close(); await new Promise(r => server.close(r)); repo.close(); report.finishedAt = new Date().toISOString(); save(); process.exitCode = report.passed ? 0 : 1; }
const timeout = setTimeout(() => { report.error = 'Real-browser capture was not completed before the smoke deadline'; void close(); }, 600000);
engine.on('activity', event => {
  if (event.type !== 'system' || !event.text?.startsWith('Browser page shared')) return;
  try {
    const source = engine.browser.read();
    assert.ok(source.text.includes('ROUNDTABLE_VISIBLE_FIXTURE_MARKER'));
    for (const marker of ['HIDDEN_SECRET_MARKER', 'CSS_HIDDEN_MARKER', 'PASSWORD_SECRET_MARKER', 'INPUT_SECRET_MARKER', 'TEXTAREA_SECRET_MARKER', 'EDITABLE_SECRET_MARKER']) assert.ok(!source.text.includes(marker), 'Private form/hidden content was captured');
    assert.equal(new URL(source.url).pathname, '/private'); assert.equal(new URL(source.url).search, ''); assert.equal(new URL(source.url).hash, '');
    assert.equal(engine.session().usage.requests, 0);
    report.passed = true; report.source = source; report.checks = { realBrowserNativeCapture: true, visibleTextIncluded: true, hiddenAndFormTextExcluded: true, queryAndFragmentExcluded: true, zeroModelRequests: true, untrustedSnapshot: source.untrusted && source.snapshotOnly };
    save(); console.log(JSON.stringify({ passed: true, sourceId: source.id, characters: source.text.length }));
  } catch (error) { report.error = String(error); save(); console.error(report.error); }
  setTimeout(() => { void close(); }, 3000);
});
process.once('SIGINT', () => { void close(); }); process.once('SIGTERM', () => { void close(); });
await engine.browser.start();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const address = server.address(); report.fixtureUrl = `http://127.0.0.1:${address.port}/start`; report.home = home; save();
console.log(JSON.stringify({ ready: true, fixtureUrl: report.fixtureUrl, home, sessionId: session.id }));
