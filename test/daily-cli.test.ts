import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture } from './helpers.js';
import { Repository } from '../src/storage.js';
import type { SessionRecord } from '../src/domain.js';
import { ProviderRegistry } from '../src/providers.js';
import { readSettings } from '../src/settings.js';

test('CLI saves drafts, restores them, renames sessions and renders readable summaries', async () => {
  const f = fixture();
  try {
    const run = (args: string[], input: string) => spawnSync(process.execPath, [resolve('dist/cli.js'), ...args], { input, encoding: 'utf8', timeout: 30000, env: { ...process.env, ROUNDTABLE_HOME: f.home } });
    const first = run(['session', 'new', 'Draft recovery'], '/summary\n/tasks\n/paste\nAn unsent useful draft\n');
    assert.equal(first.status, 0, first.stdout + first.stderr); assert.match(first.stdout, /Progress and acceptance/);
    const repo = new Repository(join(f.home, 'roundtable.db')); const session = repo.list<SessionRecord>('session')[0]!; repo.close();
    const second = run(['session', 'resume', session.id], '/draft\n/cancel-paste\n/rename Readable project\n/summary\n/exit\n');
    assert.equal(second.status, 0, second.stdout + second.stderr); assert.match(second.stdout, /An unsent useful draft/); assert.doesNotMatch(second.stdout, /\[error\]/);
    const check = new Repository(join(f.home, 'roundtable.db'));
    try { assert.equal(check.get<SessionRecord>('session', session.id)?.name, 'Readable project'); assert.equal(check.get<{ body: string }>('draft', session.id)?.body, ''); }
    finally { check.close(); }
  } finally { await f.close(); }
});

test('headless execution exit policy returns nonzero for failed jobs in a real child process', () => {
  const helpers = pathToFileURL(resolve('test/helpers.ts')).href; const completion = pathToFileURL(resolve('src/completion.ts')).href;
  const script = `const {fixture}=await import(${JSON.stringify(helpers)}); const {completionReport,executionExitCode}=await import(${JSON.stringify(completion)}); const f=fixture(); try { f.repo.put('job',{id:'failed',sessionId:f.session.id,state:'failed',command:'validator'}); process.exitCode=executionExitCode(completionReport(f.engine)); } finally { await f.close(); }`;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 15000 });
  assert.equal(child.status, 2, child.stdout + child.stderr);
});

test('/add-agent is guided without JSON and decline makes no provider request', async () => {
  const f = fixture();
  try {
    const registry = await ProviderRegistry.create(f.home);
    registry.addEndpoint({ provider: 'onboarding-fixture', baseUrl: 'http://127.0.0.1:1/v1', model: 'Example model' });
    const run = spawnSync(process.execPath, [resolve('dist/cli.js'), 'session', 'new', 'Onboarding'], { input: '/add-agent\nonboarding-fixture\n1\n1\nParticipant\n\nn\n/exit\n', encoding: 'utf8', timeout: 30000, env: { ...process.env, ROUNDTABLE_HOME: f.home } });
    assert.equal(run.status, 0, run.stdout + run.stderr); assert.match(run.stdout, /Participant name/); assert.match(run.stdout, /Connect this participant/);
    assert.doesNotMatch(run.stdout, /\[error\]|roundtable-mock|JSON\.parse/);
  } finally { await f.close(); }
});

test('display command saves a reversible preference and rejects unknown modes', async () => {
  const f = fixture();
  try {
    assert.equal(readSettings(f.home).view, 'compact');
    const run = spawnSync(process.execPath, [resolve('dist/cli.js'), 'session', 'new', 'Display'], { input: '/view verbose\n/view invalid\n/exit\n', encoding: 'utf8', timeout: 30000, env: { ...process.env, ROUNDTABLE_HOME: f.home } });
    assert.equal(run.status, 0, run.stdout + run.stderr); assert.match(run.stdout, /Display: verbose/); assert.match(run.stdout, /Use \/view compact or \/view verbose/);
    assert.equal(readSettings(f.home).view, 'verbose');
  } finally { await f.close(); }
});
