import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, agent } from './helpers.js';
import { RelevanceConfig, configureRelevance, readRelevanceConfig, rankFileCandidates } from '../src/file-relevance.js';
import { startCodeWork, rankCodeFiles, codeTask } from '../src/code-work.js';
import { submitFindings } from '../src/code-collaboration.js';
import { normalizeHostPolicy } from '../src/host-tools.js';

async function server(handler: RequestListener) {
  const http = createServer(handler); await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const port = (http.address() as { port: number }).port;
  return { config: RelevanceConfig.parse({ backend: 'laya', model: 'fixture', url: `http://127.0.0.1:${port}/v1/systemone`, timeoutMs: 2000 }), async close() { http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); } };
}

test('judgment configuration restricts endpoints and defaults to disabled without credentials discovery', async () => {
  const f = fixture(); try {
    assert.equal(readRelevanceConfig(f.home), undefined);
    configureRelevance(f.home, { enabled: false }); assert.equal(readRelevanceConfig(f.home), undefined);
    const fresh = join(f.home, 'not-initialized'); configureRelevance(fresh, { backend: 'laya', model: 'multilingual' }); assert.equal(readRelevanceConfig(fresh)!.backend, 'laya');
    for (const url of ['https://example.com/v1/systemone', 'http://localhost/v1/systemone', 'http://127.0.0.1/v1/systemone?token=secret', 'http://user:secret@127.0.0.1/v1/systemone']) assert.throws(() => RelevanceConfig.parse({ backend: 'laya', model: 'x', url }));
    assert.throws(() => RelevanceConfig.parse({ backend: 'jev-openrouter', model: 'x', url: 'https://example.com' }));
    const result = await rankFileCandidates(undefined, 'task', [{ path: 'a', excerpt: 'text' }]); assert.equal(result.candidates[0]!.status, 'disabled'); assert.deepEqual(result.ranking, []);
  } finally { await f.close(); }
});

test('typed scores rank without removing original candidates; malformed and oversized responses fail open', async () => {
  const oldKey = process.env.TYPESAFE_API_KEY; process.env.TYPESAFE_API_KEY = 'synthetic-key-must-not-reach-local-server';
  const s = await server(async (req, res) => {
    assert.equal(req.headers.authorization, undefined);
    let body = ''; for await (const chunk of req) body += chunk;
    const value = JSON.parse(body) as { state: string };
    if (value.state.includes('oversized')) { res.end('x'.repeat(65000)); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ model: 'local-pinned', answers: { relevant: { type: 'noul', noul: value.state.includes('malformed') ? 2 : value.state.includes('useful') ? 0.9 : 0.1 } }, usage: { input_tokens: 20, output_tokens: 0, truncated: true } }));
  });
  try {
    const candidates = ['other', 'useful', 'malformed', 'oversized'].map(path => ({ path, excerpt: path }));
    const r = await rankFileCandidates(s.config, 'task', candidates);
    assert.deepEqual(r.candidates.map(c => c.path), candidates.map(c => c.path)); assert.deepEqual(r.ranking, ['useful', 'other']);
    assert.equal(r.candidates[0]!.backendTruncated, true); assert.equal(r.candidates[2]!.status, 'unavailable'); assert.equal(r.candidates[3]!.status, 'unavailable');
  } finally { if (oldKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = oldKey; await s.close(); }
});

test('one deadline bounds stalled response bodies, and redirects never receive a second request', async () => {
  let calls = 0;
  const s = await server((req, res) => {
    calls++;
    if (req.headers['content-type'] && calls === 1) { res.writeHead(200); res.write('{'); }
    else { res.writeHead(302, { location: '/stolen' }); res.end(); }
  });
  try {
    const r = await rankFileCandidates({ ...s.config, timeoutMs: 100 }, 'task', [{ path: 'a', excerpt: 'data' }]);
    assert.equal(r.candidates[0]!.status, 'cancelled-or-timeout'); assert.ok(r.elapsedMs < 1500);
    const next = await rankFileCandidates(s.config, 'task', [{ path: 'b', excerpt: 'data' }]); assert.equal(next.candidates[0]!.status, 'unavailable'); assert.equal(calls, 2);
  } finally { await s.close(); }
});

test('worktree ranking excludes sensitive paths, preserves evidence barriers and invalidates cache after edits', async () => {
  let calls = 0; const payloads: string[] = [];
  const s = await server(async (req, res) => { let body = ''; for await (const c of req) body += c; calls++; payloads.push(body); res.end(JSON.stringify({ model: 'fixture', answers: { relevant: { type: 'noul', noul: 0.8 } } })); });
  const f = fixture();
  try {
    const root = f.session.workspace;
    const git = (...args: string[]) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
    git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    writeFileSync(join(root, 'value.txt'), 'ordinary text'); git('add', '.'); git('commit', '-m', 'baseline');
    const session = f.engine.session(); session.hostAccess = await normalizeHostPolicy({ readRoots: [root], writeRoots: [root], shell: false }); f.repo.put('session', session);
    configureRelevance(f.home, { ...s.config, maxFileRequests: 3 });
    const a = await agent(f.engine, 'One'); const b = await agent(f.engine, 'Two');
    const task = await startCodeWork(f.engine, { title: 'Change text', ownerId: a.id, collaborative: true, checks: [{ name: 'test', command: 'unused', mode: 'host' }], approveHostChecks: true }); await f.engine.idle();
    writeFileSync(join(task.code.root, '.env'), 'excluded-secret'); mkdirSync(join(task.code.root, 'node_modules')); writeFileSync(join(task.code.root, 'node_modules', 'data.txt'), 'dependency-secret');
    const input = { paths: ['value.txt', '.env', '../outside', 'node_modules/data.txt'] };
    const first = await rankCodeFiles(f.engine, task.id, a.id, input); assert.equal(first.candidates.length, 4); assert.equal(calls, 1);
    assert.equal(first.candidates.filter(c => c.status === 'excluded-or-unreadable').length, 3); assert.ok(payloads.every(p => !p.includes('excluded-secret') && !p.includes('dependency-secret')));
    assert.throws(() => submitFindings(f.engine, task.id, a.id, ['value.txt'], 'Advice is not a full read', 'Inspect originals'), /read/i);
    const valid = { paths: ['value.txt'] };
    const one = await rankCodeFiles(f.engine, task.id, a.id, valid); const two = await rankCodeFiles(f.engine, task.id, b.id, valid); assert.equal(two.cached, true); assert.equal(calls, 2);
    configureRelevance(f.home, { enabled: false }); // Existing work keeps its human-selected backend.
    writeFileSync(join(task.code.root, 'value.txt'), 'new content');
    const changed = await rankCodeFiles(f.engine, task.id, b.id, valid); assert.equal(changed.cached, false); assert.notEqual(changed.candidates[0]!.sha256, one.candidates[0]!.sha256); assert.equal(calls, 3);
    writeFileSync(join(task.code.root, 'value.txt'), 'another revision');
    await assert.rejects(rankCodeFiles(f.engine, task.id, a.id, valid), /budget reached/i); assert.equal(calls, 3);
    // Reset the fixture counter to exercise four independent, concurrent cache misses.
    const current = codeTask(f.engine, task.id); current.code.judgmentCalls = 0; f.repo.put('task', current);
    const concurrent = await Promise.allSettled(['first', 'second', 'third', 'fourth'].map(query => rankCodeFiles(f.engine, task.id, a.id, { ...valid, query })));
    assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 3); assert.equal(concurrent.filter(r => r.status === 'rejected').length, 1);
    assert.equal(calls, 6); assert.equal(codeTask(f.engine, task.id).code.judgmentCalls, 3);
    await f.engine.pause(); await assert.rejects(rankCodeFiles(f.engine, task.id, a.id, valid), /paused/i);
  } finally { await f.close(); await s.close(); }
});
