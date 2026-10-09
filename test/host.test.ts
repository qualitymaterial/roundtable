import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, symlink, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, agent, tool } from './helpers.js';
import { hostPath, normalizeHostPolicy } from '../src/host-tools.js';
import type { Approval } from '../src/domain.js';

test('host tools require permissions and canonical roots; block credentials and escaping links', async () => {
  const f = fixture();
  try {
    const a = await agent(f.engine); const root = join(f.home, 'project'); await mkdir(root);
    await mkdir(join(root, 'nested')); await writeFile(join(root, 'nested', 'hello.txt'), 'searchable evidence');
    await writeFile(join(root, '.env'), 'fixture-secret');
    assert.equal((await tool(f.engine, a, 'host_list', { path: root })).ok, false);
    const s = f.engine.session(); s.hostAccess = await normalizeHostPolicy({ readRoots: [root] }); s.permissions.push('host.read'); f.repo.put('session', s);
    a.permissions.push('host.read'); f.repo.put('agent', a);
    const listing = await tool<{ entries: { name: string }[] }>(f.engine, a, 'host_list', { path: root });
    assert.equal(listing.ok, true, JSON.stringify(listing)); assert.ok(!listing.data.entries.some(e => e.name === '.env'));
    const result = await tool<{ matches: { path: string }[] }>(f.engine, a, 'host_search', { path: root, query: 'searchable', content: true });
    assert.equal(result.ok, true); assert.ok(result.data.matches.some(m => m.path.endsWith('hello.txt')));
    assert.equal((await tool(f.engine, a, 'host_read', { path: join(root, '.env') })).ok, false);
    await writeFile(join(root, 'auth.ts'), 'export const fixture = true;');
    assert.equal((await tool(f.engine, a, 'host_read', { path: join(root, 'auth.ts') })).ok, true);
    await writeFile(join(root, 'auth.json'), '{}');
    assert.equal((await tool(f.engine, a, 'host_read', { path: join(root, 'auth.json') })).ok, false);
    await assert.rejects(hostPath(s, join(f.home, 'outside.txt')), /outside/);
    const outside = join(f.home, 'outside'); await mkdir(outside); await writeFile(join(outside, 'public-data.txt'), 'outside');
    await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(hostPath(s, join(root, 'escape', 'public-data.txt')), /escapes/);
    assert.equal(await hostPath(s, join(root, 'nested', 'hello.txt')), join(await realpath(root), 'nested', 'hello.txt'));
  } finally { await f.close(); }
});

test('host writes are scoped and require the current file hash; cached reads respect root revocation', async () => {
  const f = fixture();
  try {
    const a = await agent(f.engine); const root = join(f.home, 'project'); await mkdir(root); const path = join(root, 'output.txt');
    const s = f.engine.session(); s.hostAccess = await normalizeHostPolicy({ writeRoots: [root] }); s.permissions.push('host.read', 'host.write'); f.repo.put('session', s);
    a.permissions.push('host.read', 'host.write'); f.repo.put('agent', a);
    assert.equal((await tool(f.engine, a, 'host_write', { path, content: 'first', expectedHash: 'new' })).ok, true);
    assert.equal((await tool(f.engine, a, 'host_write', { path, content: 'overwrite', expectedHash: 'new' })).ok, false);
    const read = await tool<{ sha256: string }>(f.engine, a, 'host_read', { path }); assert.equal(read.ok, true);
    await writeFile(path, 'external edit');
    assert.equal((await tool(f.engine, a, 'host_write', { path, content: 'lost update', expectedHash: read.data.sha256 })).ok, false);
    const current = await tool<{ sha256: string }>(f.engine, a, 'host_read', { path });
    assert.equal((await tool(f.engine, a, 'host_write', { path, content: 'final', expectedHash: current.data.sha256 })).ok, true);
    assert.equal(await readFile(path, 'utf8'), 'final');
    assert.equal((await tool(f.engine, a, 'host_write', { path: join(f.home, 'outside.txt'), content: 'bad', expectedHash: 'new' })).ok, false);
    const callId = 'reused-host-read'; const first = await f.engine.tools.execute(a, 'host_read', { path }, callId) as { ok: boolean }; assert.equal(first.ok, true);
    s.hostAccess = { readRoots: [], writeRoots: [], shell: false }; f.repo.put('session', s);
    const replay = await f.engine.tools.execute(a, 'host_read', { path }, callId) as { ok: boolean }; assert.equal(replay.ok, false);
  } finally { await f.close(); }
});

test('host commands require exact per-agent single-use human approval before real execution', async () => {
  const f = fixture();
  try {
    const a = await agent(f.engine); const b = await agent(f.engine, 'Other');
    const s = f.engine.session(); s.hostAccess = await normalizeHostPolicy({ readRoots: [f.home], shell: true }); s.permissions.push('host.execute'); f.repo.put('session', s);
    for (const actor of [a, b]) { actor.permissions.push('host.execute'); f.repo.put('agent', actor); }
    const args = { command: process.platform === 'win32' ? 'Write-Output roundtable-host-test' : 'printf roundtable-host-test', cwd: f.home };
    const requested = await tool<{ approvalId: string; approvalRequired: boolean }>(f.engine, a, 'host_execute', args);
    assert.equal(requested.ok, true, JSON.stringify(requested)); assert.equal(requested.data.approvalRequired, true);
    f.engine.decide(requested.data.approvalId, true);
    const other = await tool<{ approvalRequired: boolean }>(f.engine, b, 'host_execute', args); assert.equal(other.data.approvalRequired, true);
    const changed = await tool<{ approvalRequired: boolean }>(f.engine, a, 'host_execute', { ...args, command: args.command + ' changed' }); assert.equal(changed.data.approvalRequired, true);
    const executed = await tool<{ code: number; output: string }>(f.engine, a, 'host_execute', args);
    assert.equal(executed.ok, true); assert.equal(executed.data.code, 0); assert.ok(executed.data.output.includes('roundtable-host-test'));
    assert.equal(f.repo.get<Approval>('approval', requested.data.approvalId)?.state, 'consumed');
    assert.equal((await tool<{ approvalRequired: boolean }>(f.engine, a, 'host_execute', args)).data.approvalRequired, true);
    assert.ok(f.repo.events(s.id).some(e => e.type === 'host_command_consumed'));
  } finally { await f.close(); }
});
