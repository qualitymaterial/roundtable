import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { WriteStream } from 'node:tty';
import { ProviderRegistry } from '../src/providers.js';
import { providerBrowser } from '../src/auth-ui.js';
import { TerminalUI } from '../src/terminal-ui.js';
import { readSettings } from '../src/settings.js';
import { fixture } from './helpers.js';
import type { MenuIO } from '../src/input.js';

test('provider browser renders bounded panels and routes model selection to the apply action', async () => {
  const f = fixture(); let output = ''; const applied: string[] = [];
  const ui = new TerminalUI({ columns: 64, write: (text: string) => { output += text; return true; } } as WriteStream, true, false);
  const answers = ['ui-fixture', '1', '1', '1', '1'];
  const io: MenuIO = { print: v => ui.print(v), menu: (title, rows, hint) => ui.menu(title, rows, hint), ask: async label => { assert.ok(answers.length, label); return answers.shift()!; } };
  try {
    const registry = await ProviderRegistry.create(f.home);
    registry.addEndpoint({ provider: 'ui-fixture', baseUrl: 'http://127.0.0.1:1234/v1', model: 'Friendly fixture' });
    await providerBrowser(registry, io, { login: async () => { throw new Error('Unexpected sign-in'); }, apply: async m => { applied.push(m.id); } });
    assert.deepEqual(applied, ['Friendly fixture']); assert.match(output, /PROVIDERS/); assert.match(output, /credentials configured/); assert.match(output, /Use for a participant/);
    assert.doesNotMatch(output, /"configured"|"provider"|"auth"/);
    for (const line of output.split('\n').filter(l => /^[╭│╰]/.test(l))) assert.equal(line.length, 64);
    output = ''; ui.menu('Untrusted\x1b[2J', ['Name\x1b]0;spoof\x07']); assert.ok(!output.includes('\x1b'));
  } finally { await f.close(); }
});

test('provider browser routes sign-in and refuses model application when credentials stay absent', async () => {
  const f = fixture(); let signedIn = 0; let applied = 0;
  try {
    const registry = await ProviderRegistry.create(f.home);
    registry.addEndpoint({ provider: 'missing-ui-auth', baseUrl: 'https://example.com/v1', model: 'Fixture', apiKeyEnv: 'ROUNDTABLE_UI_ABSENT_CREDENTIAL' });
    let answers = ['2']; const io = { print: () => {}, ask: async () => answers.shift()! };
    const actions = { login: async () => { signedIn++; }, apply: async () => { applied++; } };
    await providerBrowser(registry, io, actions, 'missing-ui-auth'); assert.equal(signedIn, 1);
    answers = ['1', '1', 'y'];
    await assert.rejects(providerBrowser(registry, io, actions, 'missing-ui-auth', true), /Authentication is still missing/);
    assert.equal(signedIn, 2); assert.equal(applied, 0);
  } finally { await f.close(); }
});

test('CLI /providers and /models use actionable menus; JSON is an explicit export', async () => {
  const f = fixture();
  try {
    const registry = await ProviderRegistry.create(f.home);
    registry.addEndpoint({ provider: 'ui-fixture', baseUrl: 'http://127.0.0.1:1234/v1', model: 'exact-ui-model' });
    const run = (args: string[], input?: string) => spawnSync(process.execPath, [resolve('dist/cli.js'), ...args], { input, encoding: 'utf8', timeout: 30000, env: { ...process.env, ROUNDTABLE_HOME: f.home } });
    const interactive = run(['session', 'new', 'Provider UI fixture'], '/providers\nui-fixture\n1\n3\n/models ui-fixture\n1\n2\n/exit\n');
    assert.equal(interactive.status, 0, interactive.stdout + interactive.stderr); assert.doesNotMatch(interactive.stdout, /\[error\]|"configured"|"auth"/); assert.match(interactive.stdout, /Browse models/); assert.match(interactive.stdout, /Saved exact-ui-model/);
    assert.deepEqual(readSettings(f.home).favorites, [{ provider: 'ui-fixture', id: 'exact-ui-model' }]);
    const plain = run(['providers']); assert.equal(plain.status, 0); assert.doesNotMatch(plain.stdout, /"configured"|"auth"/);
    const json = run(['models', 'ui-fixture', '--json']); assert.equal(json.status, 0); assert.equal(JSON.parse(json.stdout)[0].id, 'exact-ui-model');
  } finally { await f.close(); }
});
