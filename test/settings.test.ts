import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { LATEST_PROTOCOL_VERSION } from '@earendil-works/pi-mcp';
import type { AuthInteraction } from '@earendil-works/pi-ai';
import { fixture, agent, tool, noop } from './helpers.js';
import { ProviderRegistry } from '../src/providers.js';
import { loginFlow } from '../src/auth-ui.js';
import { readSettings, saveSettings } from '../src/settings.js';
import { Skills } from '../src/skills.js';
import { Connections, Connection } from '../src/connections.js';
import { Engine } from '../src/engine.js';
import { Repository } from '../src/storage.js';
import type { SessionRecord } from '../src/domain.js';

test('real Pi auth metadata normalizes API-key selection and login UI hides keys/codes', async () => {
  const f = fixture();
  try {
    const registry = await ProviderRegistry.create(f.home);
    assert.ok(registry.providers().find(p => p.id === 'anthropic')!.auth.includes('api_key'));
    assert.ok(registry.providers().find(p => p.id === 'openai-codex')!.auth.includes('oauth'));
    const prompts: boolean[] = []; const messages: unknown[] = []; const opened: string[] = [];
    const fake = { providers: () => [{ id: 'anthropic', auth: ['api_key', 'oauth'], configured: false }], login: async (provider: string, method: string, interaction: AuthInteraction) => {
      assert.equal(provider, 'anthropic'); assert.equal(method, 'oauth');
      interaction.notify({ type: 'auth_url', url: 'https://example.com/auth' });
      await interaction.prompt({ type: 'secret', message: 'Key' }); await interaction.prompt({ type: 'manual_code', message: 'Code' });
    } } as unknown as ProviderRegistry;
    await loginFlow(fake, { ask: async (_label, secret) => { prompts.push(Boolean(secret)); return 'fixture-private-value'; }, print: value => messages.push(value) }, 'anthropic', 'oauth', true, async url => { opened.push(url); });
    assert.deepEqual(prompts, [true, true]); assert.equal(opened.length, 1); assert.ok(!JSON.stringify(messages).includes('fixture-private-value'));
    await assert.rejects(loginFlow(fake, { ask: async () => '', print: () => {} }, 'anthropic', 'invalid'), /Unsupported/);
  } finally { await f.close(); }
});

test('settings persist separately from live limits and CLI defaults apply to new sessions', async () => {
  const f = fixture();
  try {
    const original = f.engine.session().limits;
    saveSettings(f.home, { ...readSettings(f.home), limits: { ...original, tokens: 12345, concurrency: 1 } });
    assert.equal(f.engine.session().limits.tokens, original.tokens); assert.equal(readSettings(f.home).limits.tokens, 12345);
    const child = spawnSync(process.execPath, [resolve('dist/cli.js'), 'session', 'new', 'Settings fixture'], { input: '/settings\n6\n/exit\n', encoding: 'utf8', timeout: 30000, env: { ...process.env, ROUNDTABLE_HOME: f.home } });
    assert.equal(child.status, 0, child.stdout + child.stderr); assert.match(child.stdout, /defaultsForNewSessions/);
    const stored = new Repository(join(f.home, 'roundtable.db'));
    try { const created = stored.list<SessionRecord>('session')[0]!; assert.equal(created.limits.tokens, 12345); assert.equal(created.limits.concurrency, 1); }
    finally { stored.close(); }
    assert.equal(readSettings(f.home).openBrowser, false);
    assert.throws(() => saveSettings(f.home, { limits: { concurrency: 0 } }));
  } finally { await f.close(); }
});

test('model changes retain identity, permissions and task ownership; failed admission preserves old model', async () => {
  const f = fixture(); await f.engine.close(); let disposed = 0;
  const engine = new Engine(f.repo, f.session.id, async a => { if (a.model === 'broken') throw new Error('Admission failed'); return { ...noop, dispose: () => { disposed++; } }; });
  try {
    const a = await agent(engine); const task = await tool<{ id: string }>(engine, a, 'roundtable_task_create', { title: 'Preserve ownership' }); await tool(engine, a, 'roundtable_task_claim', { taskId: task.data.id });
    const original = engine.agents()[0]!;
    await assert.rejects(engine.changeModel(a.id, 'fixture', 'broken'), /Admission/); assert.equal(engine.agents()[0]!.model, original.model); assert.equal(disposed, 0);
    await engine.changeModel(a.id, 'new-provider', 'new-model');
    const changed = engine.agents()[0]!; assert.equal(changed.id, original.id); assert.deepEqual(changed.permissions, original.permissions); assert.equal(disposed, 1);
    assert.equal(f.repo.get<{ owner: string }>('task', task.data.id)?.owner, a.id);
  } finally { await engine.close(); await f.close(); }
});

test('skills require explicit snapshots, do not grant tools and enforce disable/manual-only on cached reads', async () => {
  const f = fixture();
  try {
    const path = join(f.home, 'SKILL.md'); writeFileSync(path, '---\nname: verify-work\ndescription: Check evidence\nallowed-tools: host_execute\n---\nReview source evidence.');
    const store = new Skills(f.home); assert.equal(store.list().length, 0); const entry = store.candidate(path); store.save(entry);
    writeFileSync(path, 'changed after review'); assert.equal(store.read('verify-work').content, 'Review source evidence.');
    const a = await agent(f.engine); assert.ok(!a.permissions.includes('host.execute'));
    const first = await f.engine.tools.execute(a, 'roundtable_skill_read', { name: entry.name }, 'read-skill') as { ok: boolean }; assert.equal(first.ok, true);
    store.save({ ...entry, enabled: false }); assert.equal((await f.engine.tools.execute(a, 'roundtable_skill_read', { name: entry.name }, 'read-skill') as { ok: boolean }).ok, false);
    store.save({ ...entry, manualOnly: true }); assert.throws(() => store.read(entry.name), /unavailable/); assert.match(store.prompt(entry.name, 'do it'), /Human request: do it/);
    store.remove(entry.name); assert.equal(store.list().length, 0);
  } finally { await f.close(); }
});

test('named stdio MCP programs execute through Pi with restricted environment and revocable allowlists', async () => {
  const f = fixture(); const old = process.env.ROUNDTABLE_TEST_SECRET_KEY; process.env.ROUNDTABLE_TEST_SECRET_KEY = 'must-not-reach-child';
  try {
    const script = join(f.home, 'server.cjs');
    writeFileSync(script, `const readline=require('node:readline');readline.createInterface({input:process.stdin}).on('line', line=>{const r=JSON.parse(line);if(r.id===undefined)return;let result=r.method==='initialize'?{protocolVersion:${JSON.stringify(LATEST_PROTOCOL_VERSION)},capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:r.method==='tools/list'?{tools:[{name:'echo',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}]}:{content:[{type:'text',text:r.params.arguments.value}],credentialLeaked:!!process.env.ROUNDTABLE_TEST_SECRET_KEY};console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,result}));});`);
    const connections = new Connections(f.home);
    const c = connections.save({ id: 'local-fixture', type: 'stdio', command: process.execPath, args: [script], cwd: f.home, enabled: true, tools: ['echo'] });
    connections.save({ id: 'disabled', type: 'http', url: 'https://example.com/mcp' }); assert.throws(() => connections.get(), /Select/); assert.throws(() => connections.get('disabled'), /disabled/);
    const a = await agent(f.engine); a.permissions.push('mcp.remote'); f.repo.put('agent', a);
    const args = { server: c.id, name: 'echo', arguments: { value: 'MCP result' } };
    const result = await f.engine.tools.execute(a, 'mcp_call', args, 'mcp-fixture') as { ok: boolean; data: { content: { text: string }[]; credentialLeaked: boolean } };
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.data.content[0]?.text, 'MCP result'); assert.equal(result.data.credentialLeaked, false);
    connections.save({ ...c, enabled: false }); assert.equal((await f.engine.tools.execute(a, 'mcp_call', args, 'mcp-fixture') as { ok: boolean }).ok, false);
    assert.throws(() => Connection.parse({ id: 'bad', type: 'http', url: 'https://user:secret@example.com' }));
    assert.ok(!readFileSync(join(f.home, 'mcp.json'), 'utf8').includes('must-not-reach-child'));
  } finally { if (old === undefined) delete process.env.ROUNDTABLE_TEST_SECRET_KEY; else process.env.ROUNDTABLE_TEST_SECRET_KEY = old; await f.close(); }
});
