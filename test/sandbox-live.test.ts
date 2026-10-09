import { Skills } from '../src/skills.js';
import { mkdirSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, agent } from './helpers.js';
import { sandboxDoctor, grantSandbox, revokeSandbox, runSandbox } from '../src/sandbox.js';
import { requireValidation, validateContract } from '../src/recovery.js';
import { tool } from './helpers.js';
import type { Task, Artifact } from '../src/domain.js';
import { normalizeHostPolicy } from '../src/host-tools.js';
import { sandboxChanges, applyChanges, settleChanges } from '../src/change-groups.js';
import { setFallback, recoverProvider } from '../src/provider-recovery.js';
import { completionReport } from '../src/completion.js';
import { noop } from './helpers.js';

test('real project sandbox isolates filesystem/network, captures candidates, and enforces grant revocation', { skip: process.env.ROUNDTABLE_TEST_SANDBOX !== '1', timeout: 90000 }, async () => {
  const f = fixture(); try {
    assert.match(sandboxDoctor(), /passed/); const a = await agent(f.engine);
    writeFileSync(join(f.session.workspace, 'input.txt'), 'original'); writeFileSync(join(f.session.workspace, '.env'), 'PRIVATE_FIXTURE');
    const grant = grantSandbox(f.engine, a.id, f.session.workspace);
    const result = await runSandbox(f.engine, a.id, grant.id, ['/bin/sh', '-c', 'test ! -e /home && test ! -e /mnt/c && test ! -e /work/.env && test ! -e /proc/1/root/mnt/c && test "$(wc -l < /proc/net/route)" -eq 1 && test -z "$OPENAI_API_KEY" && echo updated > input.txt && echo PASS']);
    assert.equal(result.exitCode, 0); assert.match(result.output, /PASS/); assert.equal(result.files[0]?.content, 'updated\n'); assert.equal(readFileSync(join(f.session.workspace, 'input.txt'), 'utf8'), 'original');
    const limits = await runSandbox(f.engine, a.id, grant.id, ['/usr/bin/python3', '-c', 'import resource,os; assert resource.getrlimit(resource.RLIMIT_AS)[0]==268435456; assert resource.getrlimit(resource.RLIMIT_NPROC)[0]==32; assert resource.getrlimit(resource.RLIMIT_CPU)[0]==15; assert os.statvfs("/work").f_blocks*os.statvfs("/work").f_frsize<=67108864; print("LIMITS_OK")']);
    assert.equal(limits.exitCode, 0); assert.match(limits.output, /LIMITS_OK/);
    const task = (await tool<Task>(f.engine, a, 'roundtable_task_create', { title: 'Arbitrary check' })).data;
    const artifact = (await tool<Artifact>(f.engine, a, 'roundtable_artifact_publish', { name: 'result.json', content: '{"answer":42}', provenance: 'fixture' })).data;
    const contract = requireValidation(f.engine, { taskId: task.id, artifactName: 'result.json', description: 'Execute independent Python assertion', validator: { kind: 'command', grantId: grant.id, argv: ['/usr/bin/python3', '-c', 'import json,sys; assert json.load(open(sys.argv[1]))["answer"]==42', '{artifact}'] } });
    assert.equal((await validateContract(f.engine, contract.id, artifact.id, 'human')).passed, true);
    const running = runSandbox(f.engine, a.id, grant.id, ['/bin/sleep', '20']);
    setTimeout(() => revokeSandbox(f.engine, grant.id), 2000);
    await assert.rejects(running, /revoked/);
    await assert.rejects(runSandbox(f.engine, a.id, grant.id, ['/bin/true']), /revoked/);
  } finally { await f.close(); }
});

test('sprint acceptance: failed provider, explicit recovery, sandbox prototype, independent validation and grouped review', { skip: process.env.ROUNDTABLE_TEST_SANDBOX !== '1', timeout: 60000 }, async () => {
  const f = fixture(async actor => ({ ...noop, prompt: async () => { if (actor.provider === 'test') throw new Error('503 provider unavailable'); } }));
  try {
    const writer = await agent(f.engine, 'Writer'); const reviewer = await agent(f.engine, 'Verifier');
    const s = f.engine.session(); s.hostAccess = await normalizeHostPolicy({ readRoots: [s.workspace], writeRoots: [s.workspace], shell: false }); f.repo.put('session', s);
    const task = (await tool<Task>(f.engine, writer, 'roundtable_task_create', { title: 'Tested persistent memory prototype' })).data;
    await tool(f.engine, writer, 'roundtable_task_claim', { taskId: task.id });
    const check = requireValidation(f.engine, { taskId: task.id, artifactName: 'memory-result.json', description: 'Persist and retrieve an independent result', validator: { kind: 'json', required: ['stored', 'retrieved'], equals: { stored: 42, retrieved: 42 } } });
    f.engine.send({ sessionId: s.id, sender: 'human', recipients: [writer.id], type: 'human', body: 'Build the prototype' }); await f.engine.idle();
    assert.equal(f.repo.deliveries(s.id, ['failed']).length, 1); setFallback(f.engine, writer.id, 'fixture-fallback', 'available'); await recoverProvider(f.engine, writer.id, true);
    assert.equal(f.repo.deliveries(s.id, ['failed']).length, 1); f.engine.retryFailed(); await f.engine.idle();
    assert.equal(f.repo.deliveries(s.id, ['failed']).length, 0);
    const grant = grantSandbox(f.engine, writer.id, s.workspace);
    const result = await runSandbox(f.engine, writer.id, grant.id, ['/usr/bin/python3', '-c', 'import sqlite3,json; db=sqlite3.connect("memory.db"); db.execute("create table notes(value integer)"); db.execute("insert into notes values(42)"); db.commit(); db.close(); db=sqlite3.connect("memory.db"); value=db.execute("select value from notes").fetchone()[0]; assert value==42; open("memory-result.json","w").write(json.dumps({"stored":42,"retrieved":value})); print("PERSISTENCE_VERIFIED")']);
    assert.equal(result.exitCode, 0); assert.match(result.output, /PERSISTENCE_VERIFIED/);
    const content = result.files.find(f => f.path === 'memory-result.json')!.content;
    const artifact = (await tool<Artifact>(f.engine, writer, 'roundtable_artifact_publish', { name: 'memory-result.json', content, provenance: result.runId })).data;
    assert.equal((await validateContract(f.engine, check.id, artifact.id, reviewer.id)).passed, true);
    assert.equal((await tool(f.engine, writer, 'roundtable_task_update', { taskId: task.id, state: 'done', findings: 'SQLite reopened and independently checked.' })).ok, true);
    const group = sandboxChanges(f.engine, result.runId); await f.engine.pause(); await applyChanges(f.engine, group.id);
    assert.ok(completionReport(f.engine).failures.some(f => f.id === `changegroup:${group.id}`)); await settleChanges(f.engine, group.id, 'accept');
    assert.equal(completionReport(f.engine).failures.length, 0); assert.equal(completionReport(f.engine).outstandingTasks.length, 0); assert.deepEqual(JSON.parse(readFileSync(join(s.workspace, 'memory-result.json'), 'utf8')), { stored: 42, retrieved: 42 });
  } finally { await f.close(); }
});


test('reviewed skill scripts execute only in an explicitly granted isolated package snapshot', { skip: process.env.ROUNDTABLE_TEST_SANDBOX !== '1', timeout: 30000 }, async () => {
  const f = fixture(); try {
    const root = join(f.home, 'package'); mkdirSync(root);
    writeFileSync(join(root, 'SKILL.md'), '---\nname: isolation-check\ndescription: Check isolation\n---\nRun check.py only after a sandbox grant.');
    writeFileSync(join(root, 'check.py'), 'import os\nassert not os.path.exists("/mnt/c")\nassert not os.path.exists("/home")\nopen("result.txt","w").write("ISOLATED_SKILL_OK")\nprint("PASS")');
    const skills = new Skills(f.home); skills.save(skills.packageCandidate(join(root, 'SKILL.md'))); const staged = skills.stage('isolation-check', f.session.workspace); const a = await agent(f.engine);
    const grant = grantSandbox(f.engine, a.id, staged); const result = await runSandbox(f.engine, a.id, grant.id, ['/usr/bin/python3', 'check.py']);
    assert.equal(result.exitCode, 0); assert.equal(result.files.find(f => f.path === 'result.txt')?.content, 'ISOLATED_SKILL_OK');
    assert.equal(readFileSync(join(root, 'check.py'), 'utf8'), readFileSync(join(staged, 'check.py'), 'utf8'));
  } finally { await f.close(); }
});
