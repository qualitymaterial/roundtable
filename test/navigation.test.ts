import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { searchChoose, commandPicker, commandEntries, recentSessions } from '../src/navigation.js';
import { connectionReport, discoverModels, endpointWizard, diagnosticsMenu } from '../src/connection-ui.js';
import { ProviderRegistry, EndpointConfig } from '../src/providers.js';
import { selectModel, favoritesMenu } from '../src/auth-ui.js';
import { readSettings, saveSettings } from '../src/settings.js';
import { Engine } from '../src/engine.js';
import { Repository } from '../src/storage.js';
import { fixture } from './helpers.js';
import type { MenuIO } from '../src/input.js';
import type { SessionRecord } from '../src/domain.js';

function menu(answers: string[]) {
  const output: unknown[] = [];
  const io: MenuIO = { print: value => output.push(value), ask: async label => { assert.ok(answers.length, `Unexpected prompt: ${label}`); return answers.shift()!; } };
  return { io, output };
}
test('search menus paginate, recover from empty matches, and cancel without executing commands', async () => {
  const entries = Array.from({ length: 30 }, (_, i) => `Choice ${i + 1}`);
  const m = menu(['next', '1']); assert.equal(await searchChoose(m.io, 'Models', entries, s => s), 'Choice 13');
  const recover = menu(['missing', 'all', 'Choice 29', '1']); assert.equal(await searchChoose(recover.io, 'Models', entries, s => s), 'Choice 29');
  assert.ok(recover.output.some(v => String(v).includes('0 matches')));
  await assert.rejects(searchChoose(menu(['cancel']).io, 'Models', entries, s => s), /Cancelled/);
  const commands = commandEntries('/settings | /send <name> <message>\n/model [participant]\n/exit');
  assert.equal(await commandPicker(menu(['send', '1', 'Peer evidence']).io, commands), '/send Peer evidence');
  await assert.rejects(commandPicker(menu(['send', '1', '']).io, commands), /Arguments required/);
});
test('favorites persist, select exact registered models, and refuse stale or unauthenticated favorites', async () => {
  const f = fixture();
  try {
    const registry = await ProviderRegistry.create(f.home);
    registry.addEndpoint({ provider: 'favorite-local', baseUrl: 'http://127.0.0.1:1234/v1', model: 'exact-fixture' });
    saveSettings(f.home, { ...readSettings(f.home), favorites: [{ provider: 'favorite-local', id: 'exact-fixture' }] });
    assert.equal((await selectModel(registry, menu(['1', '1']).io)).id, 'exact-fixture');
    saveSettings(f.home, { ...readSettings(f.home), favorites: [{ provider: 'missing-provider', id: 'gone' }] });
    await assert.rejects(selectModel(registry, menu(['1', '1']).io), /no longer registered/);
    registry.addEndpoint({ provider: 'noauth-fixture', baseUrl: 'https://example.com/v1', model: 'fixture', apiKeyEnv: 'ROUNDTABLE_TEST_ABSENT_KEY' });
    saveSettings(f.home, { ...readSettings(f.home), favorites: [{ provider: 'noauth-fixture', id: 'fixture' }] });
    await assert.rejects(selectModel(registry, menu(['1', '1']).io), /Connect/);
    await favoritesMenu(registry, menu(['3', '1']).io); assert.deepEqual(readSettings(f.home).favorites, []);
  } finally { await f.close(); }
});
test('endpoint discovery uses server IDs, restricts redirects/size, and never exposes key values', async () => {
  const requests: string[] = []; let mode = 'ok';
  const server = createServer((req, res) => {
    requests.push(req.url!); assert.equal(req.headers.authorization, 'Bearer synthetic-fixture-key');
    if (mode === 'redirect') { res.writeHead(302, { location: '/other' }); res.end(); }
    else if (mode === 'large') res.end('x'.repeat(65537));
    else if (mode === 'error') { res.writeHead(401); res.end('private-provider-error'); }
    else res.end(JSON.stringify({ data: [{ id: 'server-exact-id' }] }));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  const keyName = 'ROUNDTABLE_NAV_TEST_KEY'; const prior = process.env[keyName]; process.env[keyName] = 'synthetic-fixture-key';
  const f = fixture();
  try {
    assert.deepEqual(await discoverModels(endpoint, keyName), ['server-exact-id']);
    mode = 'redirect'; await assert.rejects(discoverModels(endpoint, keyName)); assert.ok(!requests.includes('/other'));
    mode = 'large'; await assert.rejects(discoverModels(endpoint, keyName), /64 KiB/);
    mode = 'error'; await assert.rejects(discoverModels(endpoint, keyName), /HTTP 401/);
    mode = 'ok'; const registry = await ProviderRegistry.create(f.home);
    const m = menu(['3', endpoint, keyName, 'y', '1', 'wizard-local', '16000', '2000', 'y']);
    await endpointWizard(registry, m.io);
    assert.equal(registry.models('wizard-local')[0]!.id, 'server-exact-id');
    const restarted = await ProviderRegistry.create(f.home); assert.equal(restarted.model('wizard-local', 'server-exact-id').contextWindow, 16000);
    assert.ok(!readFileSync(join(f.home, 'endpoints.json'), 'utf8').includes('synthetic-fixture-key'));
    assert.ok(!JSON.stringify(connectionReport(registry)).includes('synthetic-fixture-key'));
    assert.throws(() => registry.addEndpoint({ provider: 'anthropic', baseUrl: endpoint, model: 'overwrite' }), /already exists/);
    assert.throws(() => EndpointConfig.parse({ provider: 'bad', baseUrl: 'https://example.com/v1?key=private', model: 'x' }));
    assert.throws(() => EndpointConfig.parse({ provider: 'bad', baseUrl: 'https://example.com/v1', model: 'x' }));
    assert.throws(() => EndpointConfig.parse({ provider: 'bad', baseUrl: endpoint, model: 'x', contextWindow: 100, maxTokens: 101 }));
  } finally { if (prior === undefined) delete process.env[keyName]; else process.env[keyName] = prior; await f.close(); await new Promise<void>(r => server.close(() => r())); }
});
test('diagnostics makes no requests without explicit selection and reports probe failures honestly', async () => {
  const f = fixture();
  try {
    const registry = await ProviderRegistry.create(f.home); registry.addEndpoint({ provider: 'diagnostic-local', baseUrl: 'http://127.0.0.1:1/v1', model: 'fixture' });
    let calls = 0; registry.validate = async () => { calls++; throw new Error('fixture refusal'); };
    await diagnosticsMenu(registry, menu(['n']).io); assert.equal(calls, 0);
    const m = menu(['y', 'diagnostic-local', '1', 'y']); await diagnosticsMenu(registry, m.io); assert.equal(calls, 1);
    assert.match(JSON.stringify(m.output), /Compatibility test failed/); assert.doesNotMatch(JSON.stringify(m.output), /Passed:/);
  } finally { await f.close(); }
});
test('recent sessions sort by activity; CLI picker switches sessions paused without model admission', async () => {
  const f = fixture();
  try {
    const other = Engine.create(f.repo, join(f.home, 'workspaces'), 'Other objective');
    f.repo.event(f.session.id, 'recent fixture', {});
    f.repo.db.prepare('UPDATE events SET timestamp=? WHERE session_id=?').run('2099-01-01T00:00:00.000Z', f.session.id);
    assert.equal(recentSessions(f.repo)[0]!.id, f.session.id); assert.ok(recentSessions(f.repo).some(s => s.id === other.id));
    const db = new Repository(join(f.home, 'roundtable.db'));
    const a = Engine.create(db, join(f.home, 'workspaces'), 'First session'); const b = Engine.create(db, join(f.home, 'workspaces'), 'Second session'); db.close();
    const run = spawnSync(process.execPath, [resolve('dist/cli.js'), 'session', 'resume'], { input: 'First session\n1\n/commands status\n1\n/sessions\nSecond session\n1\ny\n/status\n/exit\n', encoding: 'utf8', timeout: 30000, env: { ...process.env, ROUNDTABLE_HOME: f.home } });
    assert.equal(run.status, 0, run.stdout + run.stderr); assert.doesNotMatch(run.stdout, /\[error\]/); assert.match(run.stdout, /Second session/);
    const restored = new Repository(join(f.home, 'roundtable.db'));
    try { for (const session of [a, b]) { const saved = restored.get<SessionRecord>('session', session.id)!; assert.equal(saved.state, 'paused'); assert.equal(saved.usage.requests, 0); } }
    finally { restored.close(); }
  } finally { await f.close(); }
});
