import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ProjectProfiles } from '../src/projects.js';
import { fixture, agent, noop } from './helpers.js';
import { Repository } from '../src/storage.js';
import type { SessionRecord } from '../src/domain.js';

test('project profiles isolate folders, pin reviewed snapshots and cannot grant tools through saved lineups', async () => {
  const prompts: string[] = []; const f = fixture(async () => ({ ...noop, prompt: async text => { prompts.push(text); } }));
  try {
    const root = f.session.workspace; const profiles = new ProjectProfiles(f.home, root);
    writeFileSync(join(root, 'AGENTS.md'), 'Do careful work'); assert.equal(profiles.read(), undefined);
    const snapshot = profiles.candidate(join(root, 'AGENTS.md'));
    profiles.save({ instructions: snapshot, agents: [{ name: 'A', provider: 'test', model: 'test', permissions: ['host.execute'] }], limits: { requests: 42 } });
    writeFileSync(join(root, 'AGENTS.md'), 'Unreviewed replacement');
    assert.equal(profiles.read()?.instructions?.content, 'Do careful work');
    assert.equal('permissions' in profiles.read()!.agents![0]!, false);
    const other = join(f.home, 'other'); mkdirSync(other); assert.equal(new ProjectProfiles(f.home, other).read(), undefined);
    writeFileSync(join(root, '.env'), 'PRIVATE'); assert.throws(() => profiles.candidate(join(root, '.env')), /private credential/);
    const a = await agent(f.engine); f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body: 'Before applying' }); await f.engine.idle();
    assert.doesNotMatch(prompts[0]!, /careful work|Unreviewed replacement/);
    const state = f.engine.session(); state.projectInstructions = snapshot; f.repo.put('session', state);
    f.engine.send({ sessionId: f.session.id, sender: 'human', recipients: [a.id], type: 'human', body: 'After review' }); await f.engine.idle();
    assert.match(prompts[1]!, /Do careful work/); assert.doesNotMatch(prompts[1]!, /Unreviewed replacement/);
    profiles.forget(); assert.equal(profiles.read(), undefined);
  } finally { await f.close(); }
});

test('CLI project instruction approval is explicit and saved defaults do not automatically trust instruction files', async () => {
  const f = fixture();
  try {
    const root = f.session.workspace; writeFileSync(join(root, 'AGENTS.md'), 'Reviewed instructions');
    const run = (input: string) => spawnSync(process.execPath, [resolve('dist/cli.js'), 'session', 'new', 'Project UX'], { cwd: root, input, encoding: 'utf8', timeout: 30000, env: { ...process.env, ROUNDTABLE_HOME: f.home } });
    const first = run('/project\n1\n\ny\n/project\n3\n/exit\n'); assert.equal(first.status, 0, first.stdout + first.stderr); assert.doesNotMatch(first.stdout, /\[error\]/);
    const second = run('/exit\n'); assert.equal(second.status, 0, second.stdout + second.stderr);
    const repo = new Repository(join(f.home, 'roundtable.db'));
    try { const sessions = repo.list<SessionRecord>('session'); assert.equal(sessions[0]?.projectInstructions?.content, 'Reviewed instructions'); assert.equal(sessions[1]?.projectInstructions, undefined); }
    finally { repo.close(); }
  } finally { await f.close(); }
});
