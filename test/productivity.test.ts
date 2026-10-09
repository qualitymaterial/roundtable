import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { fixture, agent, tool, noop } from './helpers.js';
import { Engine } from '../src/engine.js';
import { ProviderRegistry } from '../src/providers.js';
import { PiAdapter } from '../src/pi-adapter.js';
import { registerMock } from '../src/demo.js';
import { normalizeHostPolicy, undoCheckpoint, listCheckpoints, previewCheckpoint, executeHost } from '../src/host-tools.js';
import { BackgroundJobs } from '../src/jobs.js';
import { completionReport } from '../src/completion.js';
import { setup } from '../src/setup.js';
import { usageReport } from '../src/usage.js';

test('session ownership rejects a second engine before recovery and reclaims a dead process', async () => {
  const f = fixture(); let restored: Engine | undefined;
  try {
    const a = await agent(f.engine); const m = f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body: 'owned' });
    f.repo.delivery(m.id, a.id, 'inflight');
    assert.throws(() => new Engine(f.repo, f.session.id, async () => noop), /already open/);
    assert.equal(f.repo.deliveries(f.session.id, ['inflight']).length, 1);
    await f.engine.close();
    const child = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
    assert.equal(child.status, 0);
    const { hostname } = await import('node:os');
    f.repo.db.prepare('INSERT INTO session_owners VALUES(?,?,?,?)').run(f.session.id, Number(child.stdout.trim()), hostname(), 'dead-owner');
    restored = new Engine(f.repo, f.session.id, async () => noop);
    assert.equal(f.repo.deliveries(f.session.id, ['pending']).length, 1);
  } finally { await restored?.close(); await f.close(); }
});

test('guided setup saves usable configuration without model JSON and cancellation preserves it', async () => {
  const f = fixture();
  try {
    const registry = { home: f.home, providers: () => [{ id: 'fixture', configured: false, auth: ['api_key'] }], models: () => [{ id: 'verified-model', name: 'Example', provider: 'fixture' }] } as unknown as ProviderRegistry;
    const inputs = ['1', '1', 'Participant', '', 'n', '2', 'n', 'y']; let logins = 0;
    await setup(registry, f.home, { ask: async () => inputs.shift()!, print: () => {}, login: async (provider, method) => { assert.equal(provider, 'fixture'); assert.equal(method, 'api_key'); logins++; } });
    assert.equal(logins, 1);
    const path = join(f.home, 'agents.json'); const content = readFileSync(path, 'utf8');
    assert.equal(JSON.parse(content)[0].model, 'verified-model');
    const access = JSON.parse(readFileSync(join(f.home, 'host-access.json'), 'utf8'));
    assert.equal(access.readRoots.length, 1); assert.equal(access.writeRoots.length, 0); assert.equal(access.shell, false);
    assert.equal(JSON.parse(readFileSync(join(f.home, 'preferences.json'), 'utf8')).projectAccess, false);
    await assert.rejects(setup(registry, f.home, { ask: async () => 'cancel', print: () => {}, login: async () => {} }), /cancelled/);
    assert.equal(readFileSync(path, 'utf8'), content);
  } finally { await f.close(); }
});

test('host checkpoints restore content, refuse conflicts and cannot undo failed creation', async () => {
  const f = fixture();
  try {
    const a = await agent(f.engine); a.permissions.push('host.read', 'host.write'); f.repo.put('agent', a);
    const s = f.engine.session(); s.hostAccess = await normalizeHostPolicy({ writeRoots: [f.home] }); s.permissions.push('host.read', 'host.write'); f.repo.put('session', s);
    const path = join(f.home, 'document.txt');
    const first = await tool<{ checkpointId: string; sha256: string }>(f.engine, a, 'host_write', { path, content: 'Original', expectedHash: 'new' }); assert.equal(first.ok, true);
    const second = await tool<{ checkpointId: string }>(f.engine, a, 'host_write', { path, content: 'Edited', expectedHash: first.data.sha256 }); assert.equal(second.ok, true);
    assert.match(await previewCheckpoint(f.engine, second.data.checkpointId), /-Original\n\+Edited/);
    writeFileSync(path, 'Human edit'); await assert.rejects(undoCheckpoint(f.engine, second.data.checkpointId), /changed since/);
    writeFileSync(path, 'Edited'); await undoCheckpoint(f.engine, second.data.checkpointId); assert.equal(readFileSync(path, 'utf8'), 'Original');
    const failed = await tool(f.engine, a, 'host_write', { path, content: 'Original', expectedHash: 'new' }); assert.equal(failed.ok, false);
    const prepared = listCheckpoints(f.engine).find(c => c.state === 'prepared')!;
    await assert.rejects(undoCheckpoint(f.engine, prepared.id), /applied checkpoint/); assert.ok(existsSync(path));
    await undoCheckpoint(f.engine, first.data.checkpointId); assert.equal(existsSync(path), false);
  } finally { await f.close(); }
});

test('Pi retries transient responses with metering and honors the request ceiling', async () => {
  const f = fixture(); await f.engine.close();
  const registry = await ProviderRegistry.create(f.home); await registerMock(registry); await registry.runtime.setRuntimeApiKey('roundtable-mock', 'fixture-only');
  let calls = 0; let alwaysFail = false;
  const engine = new Engine(f.repo, f.session.id, PiAdapter.factory(registry, model => {
    const output = createAssistantMessageEventStream(); const fail = ++calls === 1 || alwaysFail;
    queueMicrotask(() => {
      const message: AssistantMessage = { role: 'assistant', api: model.api, model: model.id, provider: model.provider, timestamp: Date.now(), content: fail ? [] : [{ type: 'text', text: 'Recovered response' }], stopReason: fail ? 'error' : 'stop', ...(fail ? { errorMessage: '503 Service Unavailable' } : {}), usage: { input: 4, output: 2, totalTokens: 9, cacheRead: 3, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      if (fail) output.push({ type: 'error', reason: 'error', error: message }); else output.push({ type: 'done', reason: 'stop', message });
    }); return output;
  }));
  try {
    const a = await engine.addAgent({ name: 'Retry fixture', provider: 'roundtable-mock', model: 'alpha' });
    engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body: 'Retry once' }); await engine.idle();
    assert.equal(calls, 2); assert.equal(f.repo.deliveries(f.session.id, ['acknowledged']).length, 1);
    assert.ok(f.repo.events(f.session.id).some(e => e.type === 'provider_retry'));
    const usage = usageReport(engine)[0]!; assert.equal(usage.requests, 2); assert.equal(usage.cacheReadTokens, 6); assert.equal(usage.tokens, 18);
    engine.updateLimits({ requests: 3 }); alwaysFail = true;
    engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body: 'Stop at ceiling' }); await engine.idle();
    assert.equal(calls, 3); assert.equal(engine.session().state, 'paused'); assert.equal(engine.session().usage.requests, 3);
  } finally { await engine.close(); await f.close(); }
});

test('idle completion reporting does not claim validation or task success', async () => {
  const f = fixture();
  try {
    const a = await agent(f.engine); const result = await tool(f.engine, a, 'roundtable_task_create', { title: 'Unfinished' }); assert.equal(result.ok, true);
    const report = completionReport(f.engine); assert.equal(report.state, 'idle with open tasks'); assert.equal(report.checks.length, 0); assert.equal(report.completion, null);
  } finally { await f.close(); }
});

test('background jobs require distinct approvals, persist output and cancel without replay', async () => {
  const f = fixture();
  try {
    const a = await agent(f.engine); a.permissions.push('host.execute'); f.repo.put('agent', a);
    const s = f.engine.session(); s.permissions.push('host.execute'); s.hostAccess = await normalizeHostPolicy({ readRoots: [f.home], shell: true }); f.repo.put('session', s);
    const args = { command: 'echo background-fixture', cwd: f.home, timeoutMs: 10000 };
    const request = await tool<{ approvalId: string }>(f.engine, a, 'host_job_start', args); assert.equal(request.ok, true); assert.equal(f.engine.jobs.list().length, 0);
    f.engine.decide(request.data.approvalId, true);
    const changed = await tool<{ approvalRequired: boolean }>(f.engine, a, 'host_job_start', { ...args, timeoutMs: 11000 }); assert.equal(changed.data.approvalRequired, true);
    const started = await tool<{ id: string }>(f.engine, a, 'host_job_start', args); assert.equal(started.ok, true);
    const until = Date.now() + 10000;
    while (f.engine.jobs.read(started.data.id).state === 'running' && Date.now() < until) await new Promise(r => setTimeout(r, 20));
    assert.equal(f.engine.jobs.read(started.data.id).state, 'done'); assert.match(f.engine.jobs.read(started.data.id).output, /background-fixture/);
    const jobs = new BackgroundJobs(f.repo, f.session.id, async (_command, _cwd, signal) => new Promise(resolve => signal.addEventListener('abort', () => resolve({ code: 1 }), { once: true })));
    const pending = jobs.start(a.id, 'fixture-only', f.home, 10000); await jobs.stop(pending.id); assert.equal(jobs.read(pending.id).state, 'cancelled'); await jobs.close();
    const realJobs = new BackgroundJobs(f.repo, f.session.id, executeHost);
    try {
      const long = realJobs.start(a.id, process.platform === 'win32' ? 'Write-Output "cancel-fixture-ready"; Start-Sleep -Seconds 30' : 'echo cancel-fixture-ready; sleep 30', f.home, 40000);
      const deadline = Date.now() + 10000;
      while (!realJobs.read(long.id).output.includes('cancel-fixture-ready') && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
      assert.match(realJobs.read(long.id).output, /cancel-fixture-ready/);
      await realJobs.stop(long.id); assert.equal(realJobs.read(long.id).state, 'cancelled');
      assert.equal((realJobs.read(long.id).result as { stopped: string }).stopped, 'cancelled');
    } finally { await realJobs.close(); }
  } finally { await f.close(); }
});

test('Pi compaction is metered, independent, durable and preserves history on failure', async () => {
  const f = fixture(); await f.engine.close();
  const registry = await ProviderRegistry.create(f.home); await registerMock(registry); await registry.runtime.setRuntimeApiKey('roundtable-mock', 'fixture-only');
  let fail = false; let summaryCalls = 0; const adapters = new Map<string, PiAdapter>();
  const engine = new Engine(f.repo, f.session.id, async (a, e) => {
    const adapter = await PiAdapter.create(registry, a, e, (model, context) => {
      const user = context.messages.findLast(m => m.role === 'user');
      const text = user?.role === 'user' ? (typeof user.content === 'string' ? user.content : user.content.filter(c => c.type === 'text').map(c => c.text).join('')) : '';
      let summary = true;
      try { const payload = JSON.parse(text) as { objective?: unknown; incoming?: unknown }; summary = !(typeof payload.objective === 'string' && payload.incoming); } catch { /* Pi compaction is plain text. */ }
      if (summary) summaryCalls++;
      const output = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const message: AssistantMessage = { role: 'assistant', api: model.api, model: model.id, provider: model.provider, timestamp: Date.now(), content: [{ type: 'text', text: summary ? '## Goal\nRetain the objective.\n## Open work\nContinue independent evidence review.' : `Evidence ${model.id}. ` + 'bounded evidence '.repeat(1100) }], stopReason: summary && fail ? 'error' : 'stop', ...(summary && fail ? { errorMessage: 'Fixture summary failure' } : {}), usage: { input: 10, output: 10, totalTokens: 20, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        if (!summary && text.includes('Auto pass')) { message.usage.input = 95000; message.usage.totalTokens = 95010; }
        if (message.stopReason === 'error') output.push({ type: 'error', reason: 'error', error: message });
        else output.push({ type: 'done', reason: 'stop', message });
      }); return output;
    }); adapters.set(a.id, adapter); return adapter;
  });
  try {
    const a = await engine.addAgent({ name: 'A', provider: 'roundtable-mock', model: 'alpha' });
    const b = await engine.addAgent({ name: 'B', provider: 'roundtable-mock', model: 'beta' });
    for (let i = 0; i < 5; i++) { engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body: `Evidence pass ${i}` }); await engine.idle(); }
    const manager = adapters.get(a.id)!.session.sessionManager; const before = manager.getEntries().length;
    assert.ok(before >= 10, `Expected persisted turns, found ${before}; ${JSON.stringify(f.repo.events(f.session.id).filter(e => e.type === 'delivery_error'))}`);
    assert.equal(summaryCalls, 0, 'ordinary turns must not be classified as summaries');
    fail = true; await assert.rejects(engine.compactAgent(a.id), /summary failure/i);
    assert.equal(manager.getEntries().length, before, 'failed compaction must not replace history');
    fail = false; const requests = engine.session().usage.requests; await engine.compactAgent(a.id);
    assert.ok(engine.session().usage.requests > requests); assert.ok(summaryCalls >= 2);
    assert.ok(manager.getEntries().some(e => e.type === 'compaction'));
    assert.ok(manager.getEntries().length > before, 'original entries retained');
    assert.equal(adapters.get(b.id)!.session.sessionManager.getEntries().some(e => e.type === 'compaction'), false);
    assert.ok(f.repo.events(f.session.id).some(e => e.type === 'usage' && String((e.data as { source: string }).source).includes('compaction')));
    engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body: 'Auto pass' }); await engine.idle();
    assert.ok(f.repo.events(f.session.id).some(e => e.type === 'compaction_end' && (e.data as { reason: string }).reason === 'threshold'));
    await engine.close();
    const reopened = SessionManager.continueRecent(f.session.workspace, join(f.home, 'sessions', f.session.id, a.id));
    assert.ok(reopened.getEntries().some(e => e.type === 'compaction'));
  } finally { await engine.close(); await f.close(); }
});
