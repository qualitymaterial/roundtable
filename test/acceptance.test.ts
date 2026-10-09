import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runDemo } from '../src/demo.js';
import { verifyCollaboration } from '../src/acceptance.js';
import { Repository } from '../src/storage.js';
import { ProviderRegistry } from '../src/providers.js';
import type { AgentRecord } from '../src/domain.js';

test('acceptance verifies durable evidence and rejects one-way messages, single-writer tasks and damaged contexts', async () => {
  const home = mkdtempSync(join(tmpdir(), 'roundtable-acceptance-')); const repo = new Repository(join(home, 'test.db'));
  try {
    const { sessionId } = await runDemo(repo, home);
    const report = verifyCollaboration(repo, sessionId, home); assert.equal(report.passed, true);
    repo.event(sessionId, 'collaboration_acceptance', report);
    assert.equal(verifyCollaboration(repo, sessionId, home).matchesLastAcceptance, true);
    const agents = repo.list<AgentRecord>('agent', sessionId);
    const alpha = agents.find(a => a.model === 'alpha')!;
    const peerMessages = repo.messages(sessionId).filter(m => m.sender !== alpha.id && m.sender !== 'human' && m.recipients.length);
    for (const message of peerMessages) for (const recipient of message.recipients) repo.delivery(message.id, recipient, 'failed');
    const failed = verifyCollaboration(repo, sessionId, home);
    assert.equal(failed.passed, false);
    assert.equal(failed.checks.find(c => c.name === 'reciprocal_acknowledged_peer_messages')?.passed, false);
    assert.equal(failed.matchesLastAcceptance, false);
    for (const message of peerMessages) for (const recipient of message.recipients) repo.delivery(message.id, recipient, 'acknowledged');
    repo.db.prepare("DELETE FROM events WHERE session_id=? AND type='tool_result' AND json_extract(data,'$.name')='roundtable_task_update' AND json_extract(data,'$.agentId')<>?").run(sessionId, alpha.id);
    assert.equal(verifyCollaboration(repo, sessionId, home).checks.find(c => c.name === 'jointly_updated_completed_task')?.passed, false);
    const directory = join(home, 'sessions', sessionId, alpha.id);
    writeFileSync(join(directory, readdirSync(directory).find(name => name.endsWith('.jsonl'))!), 'corrupt');
    assert.equal(verifyCollaboration(repo, sessionId, home).checks.find(c => c.name === 'independent_persisted_contexts')?.passed, false);
  } finally { repo.close(); rmSync(home, { recursive: true, force: true }); }
});

test('live preflight rejects missing auth and unknown models without creating a session or making inference calls', async () => {
  const home = mkdtempSync(join(tmpdir(), 'roundtable-preflight-'));
  try {
    writeFileSync(join(home, 'endpoints.json'), JSON.stringify([{ provider: 'fixture-unconfigured', model: 'known', baseUrl: 'http://127.0.0.1:1/v1', apiKeyEnv: 'ROUNDTABLE_MISSING_FIXTURE_CREDENTIAL_918' }]));
    const registry = await ProviderRegistry.create(home);
    assert.equal(registry.providers().find(p => p.id === 'fixture-unconfigured')?.configured, false);
    const known = registry.preflight(['one', 'two', 'three'].map(name => ({ name, provider: 'fixture-unconfigured', model: 'known' })));
    assert.equal(known.agents[0]?.knownModel, true); assert.equal(known.ready, false);
    const config = ['one', 'two', 'three'].map(name => ({ name, provider: 'fixture-unconfigured', model: 'missing' }));
    const result = registry.preflight(config);
    assert.equal(result.ready, false); assert.equal(result.agents[0]?.knownModel, false);
    assert.equal(result.agents[0]?.configuredAuth, false);
    assert.throws(() => registry.preflight(config.slice(1)));
    const path = join(home, 'agents.json'); writeFileSync(path, JSON.stringify(config));
    const cli = spawnSync(process.execPath, [resolve('dist/cli.js'), 'demo', '--live', path, '--check'], { encoding: 'utf8', env: { ...process.env, ROUNDTABLE_HOME: home }, timeout: 60000 });
    assert.equal(cli.status, 1); assert.match(cli.stdout, /No session or provider request was created/);
    const repo = new Repository(join(home, 'roundtable.db'));
    try { assert.equal(repo.list('session').length, 0); } finally { repo.close(); }
  } finally { rmSync(home, { recursive: true, force: true }); }
});
