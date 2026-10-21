import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, agent, tool } from './helpers.js';
import { normalizeHostPolicy } from '../src/host-tools.js';
import { startCodeWork, readCodeFile, writeCodeFile, checkCodeWork, requestCodeReview, submitCodeReview, finishCodeWork, integrateCodeWork, codeRevision, codeTask, workBoard, reworkCodeWork } from '../src/code-work.js';
import { compareSessions } from '../src/evaluation.js';
import { Engine } from '../src/engine.js';

async function project() {
  const f = fixture(); const root = f.session.workspace;
  const git = (...args: string[]) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
  git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, 'value.txt'), '1');
  writeFileSync(join(root, 'check.mjs'), "import {readFileSync} from 'node:fs'; if(readFileSync('value.txt','utf8')!=='2') { console.error('expected 2'); process.exit(1); } console.log('checked 2');");
  git('add', '.'); git('commit', '-m', 'baseline');
  const session = f.engine.session(); session.hostAccess = await normalizeHostPolicy({ readRoots: [root], writeRoots: [root], shell: false }); f.repo.put('session', session);
  const members = await Promise.all(['Editor', 'Review A', 'Review B'].map(name => agent(f.engine, name)));
  const command = process.platform === 'win32' ? `& '${process.execPath.replaceAll("'", "''")}' check.mjs` : `'${process.execPath.replaceAll("'", "'\\''")}' check.mjs`;
  return { ...f, root, git, members, input: { title: 'Fix value', ownerId: members[0]!.id, reviewerIds: members.slice(1).map(a => a.id), approveHostChecks: true, checks: [{ name: 'tests', command, mode: 'host' as const }] } };
}

test('coordinated starts deduplicate atomically and assign isolated editors without negotiation', async () => {
  const f = await project(); try {
    const [one, same] = await Promise.all([startCodeWork(f.engine, f.input), startCodeWork(f.engine, { ...f.input, title: '  Fix   value  ' })]);
    await f.engine.idle(); assert.equal(one.id, same.id); assert.equal(f.repo.list('task', f.session.id).length, 1); assert.equal(f.repo.messages(f.session.id).filter(m => m.sender === 'human').length, 1);
    const second = await startCodeWork(f.engine, { ...f.input, title: 'Independent work', ownerId: undefined, reviewerIds: [] }); await f.engine.idle();
    assert.notEqual(second.owner, one.owner); assert.notEqual(second.code.root, one.code.root);
    const file = await readCodeFile(f.engine, one.id, one.owner!, 'value.txt');
    await writeCodeFile(f.engine, one.id, one.owner!, 'value.txt', '2', file.sha256);
    assert.equal(readFileSync(join(second.code.root, 'value.txt'), 'utf8'), '1'); assert.equal(readFileSync(join(f.root, 'value.txt'), 'utf8'), '1');
    await assert.rejects(writeCodeFile(f.engine, one.id, f.members[1]!.id, 'value.txt', '3', file.sha256), /editor/);
    await assert.rejects(readCodeFile(f.engine, one.id, one.owner!, '../value.txt'), /path|traversal|workspace/i);
  } finally { await f.close(); }
});

test('real check failure, guarded repair, batched version-bound reviews and checked integration', async () => {
  const f = await project(); try {
    const task = await startCodeWork(f.engine, f.input); await f.engine.idle();
    const failed = await checkCodeWork(f.engine, task.id, task.owner!, 'tests'); assert.equal(failed.exitCode, 1); assert.match(failed.output, /expected 2/);
    assert.throws(() => requestCodeReview(f.engine, task.id, task.owner!, 'premature'), /passing checks/);
    const file = await readCodeFile(f.engine, task.id, task.owner!, 'value.txt'); await writeCodeFile(f.engine, task.id, task.owner!, 'value.txt', '2', file.sha256);
    await assert.rejects(writeCodeFile(f.engine, task.id, task.owner!, 'value.txt', '3', file.sha256), /changed/);
    assert.equal((await checkCodeWork(f.engine, task.id, task.owner!, 'tests')).exitCode, 0);
    const review = requestCodeReview(f.engine, task.id, task.owner!, 'Fixed and tested'); await f.engine.idle();
    await assert.rejects(writeCodeFile(f.engine, task.id, task.owner!, 'value.txt', '3', 'new'), /implementation/);
    const before = f.repo.events(f.session.id).filter(e => e.type === 'notification_queued').length;
    for (const [index, reviewer] of f.members.slice(1).entries()) {
      assert.throws(() => submitCodeReview(f.engine, task.id, reviewer.id, review.revision, 'accept', 'not read'), /Read every/);
      await readCodeFile(f.engine, task.id, reviewer.id, 'value.txt');
      const result = submitCodeReview(f.engine, task.id, reviewer.id, review.revision, 'accept', 'Read file, checked expected value and test.');
      assert.equal(result.allReviewsReceived, index === 1);
      if (index === 0) assert.equal(f.repo.events(f.session.id).filter(e => e.type === 'notification_queued').length, before);
    }
    await f.engine.idle();
    const evidence = f.engine.web.verification.require({ taskId: task.id, description: 'Protected evidence also gates project_finish', allowedHosts: ['example.com'], fields: { id: { type: 'identifier' } }, identity: ['id'] });
    assert.throws(() => finishCodeWork(f.engine, task.id, task.owner!, 'Prose cannot bypass criteria'), /Submit structured records/);
    f.engine.web.verification.drop(evidence.id, 'This fixture tests code checks and reviews; evidence criteria exercised above');
    finishCodeWork(f.engine, task.id, task.owner!, 'Checks and both reviews passed');
    assert.equal(codeTask(f.engine, task.id).state, 'done'); assert.match(workBoard(f.engine).join('\n'), /ready to integrate/);
    assert.equal(f.repo.messages(f.session.id).filter(m => m.sender === 'human').length, 1);
    await f.engine.pause(); await integrateCodeWork(f.engine, task.id);
    assert.equal(readFileSync(join(f.root, 'value.txt'), 'utf8'), '2'); assert.equal(codeTask(f.engine, task.id).code.phase, 'integrated');
    assert.equal(f.git('log', '--oneline').trim().split('\n').length, 1, 'integration never commits');
  } finally { await f.close(); }
});

test('work leases deny implicit host execution and completion cannot bypass stale checks or reviews', async () => {
  const f = await project(); try {
    await assert.rejects(startCodeWork(f.engine, { ...f.input, approveHostChecks: false }), /explicit approval/);
    const task = await startCodeWork(f.engine, { ...f.input, reviewerIds: [] }); await f.engine.idle();
    assert.throws(() => finishCodeWork(f.engine, task.id, task.owner!, 'No evidence'), /passing checks/);
    assert.equal((await tool(f.engine, f.members[0]!, 'roundtable_task_update', { taskId: task.id, findings: 'Bypass', state: 'done' })).ok, false);
    const file = await readCodeFile(f.engine, task.id, task.owner!, 'value.txt'); await writeCodeFile(f.engine, task.id, task.owner!, 'value.txt', '2', file.sha256);
    await checkCodeWork(f.engine, task.id, task.owner!, 'tests'); const before = codeRevision(f.engine, task.id);
    writeFileSync(join(task.code.root, 'value.txt'), '3'); assert.notEqual(codeRevision(f.engine, task.id), before);
    assert.throws(() => requestCodeReview(f.engine, task.id, task.owner!, 'stale'), /current file revision/);
  } finally { await f.close(); }
});

test('restored work leases cannot read old worktrees or execute their approved checks', async () => {
  const f = await project(); try {
    const task = await startCodeWork(f.engine, f.input); await f.engine.idle();
    task.code.runtimeHome += '-restored'; f.repo.put('task', task);
    await assert.rejects(readCodeFile(f.engine, task.id, task.owner!, 'value.txt'), /leases are disabled/);
    await assert.rejects(checkCodeWork(f.engine, task.id, task.owner!, 'tests'), /leases are disabled/);
    await assert.rejects(integrateCodeWork(f.engine, task.id), /leases are disabled/);
  } finally { await f.close(); }
});

test('pausing cancels an approved host check without recording success', async () => {
  const f = await project(); try {
    writeFileSync(join(f.root, 'slow.mjs'), 'setTimeout(()=>console.log("finished"),30000)'); f.git('add', 'slow.mjs'); f.git('commit', '-m', 'slow check');
    const input = { ...f.input, checks: f.input.checks.map(c => ({ ...c, command: c.command.replace('check.mjs', 'slow.mjs') })) };
    const task = await startCodeWork(f.engine, input); await f.engine.idle();
    const timer = setTimeout(() => { void f.engine.pause('Cancel check'); }, 200);
    try { await assert.rejects(checkCodeWork(f.engine, task.id, task.owner!, 'tests'), /cancel|pause/i); } finally { clearTimeout(timer); }
    assert.equal(codeTask(f.engine, task.id).code.runs.length, 0);
  } finally { await f.close(); }
});

test('comparison counts baseline versus repair failures by event order even at identical timestamps', async () => {
  const f = fixture(); let team: Engine | undefined;
  try {
    await agent(f.engine, 'Solo'); const session = Engine.create(f.repo, join(f.home, 'team'), f.session.objective); team = new Engine(f.repo, session.id, async () => ({ prompt: async () => {}, abort: async () => {}, dispose() {} }));
    await agent(team, 'Editor'); await agent(team, 'Reviewer');
    f.repo.event(f.session.id, 'code_check_finished', { exitCode: 1 }); f.repo.event(f.session.id, 'code_file_written', {}); f.repo.event(f.session.id, 'code_check_finished', { exitCode: 1 });
    f.repo.db.prepare('UPDATE events SET timestamp=?').run('2026-10-14T00:00:00.000Z');
    const result = compareSessions(f.repo, { task: 'ordered failures', solo: f.session.id, team: session.id });
    assert.equal(result.solo.baselineFailures, 1); assert.equal(result.solo.postEditFailures, 1); assert.equal(result.solo.complete, false);
  } finally { await team?.close(); await f.close(); }
});

test('worktree line-ending differences preserve primary hashes and existing edits are never overwritten', async () => {
  const f = await project(); try {
    writeFileSync(join(f.root, 'style.txt'), 'old\r\n'); f.git('add', 'style.txt'); f.git('commit', '-m', 'line endings');
    const task = await startCodeWork(f.engine, { ...f.input, reviewerIds: [] }); await f.engine.idle();
    const primaryBefore = readFileSync(join(f.root, 'style.txt'), 'utf8');
    writeFileSync(join(task.code.root, 'style.txt'), primaryBefore.replaceAll('\r\n', '\n'));
    const style = await readCodeFile(f.engine, task.id, task.owner!, 'style.txt'); await writeCodeFile(f.engine, task.id, task.owner!, 'style.txt', 'new\n', style.sha256);
    assert.equal(readFileSync(join(task.code.root, 'style.txt'), 'utf8'), 'new\r\n');
    assert.notEqual(codeTask(f.engine, task.id).code.baseFiles['style.txt'], style.sha256);
    const value = await readCodeFile(f.engine, task.id, task.owner!, 'value.txt'); writeFileSync(join(f.root, 'value.txt'), 'personal unfinished edit');
    await assert.rejects(writeCodeFile(f.engine, task.id, task.owner!, 'value.txt', '2', value.sha256), /existing changes/);
    assert.equal(readFileSync(join(f.root, 'value.txt'), 'utf8'), 'personal unfinished edit');
  } finally { await f.close(); }
});

test('isolated work includes existing nonsensitive text edits without committing them or changing the project', async () => {
  const f = await project(); try {
    writeFileSync(join(f.root, 'value.txt'), 'existing change'); writeFileSync(join(f.root, 'draft.txt'), 'untracked draft');
    const head = f.git('rev-parse', 'HEAD'); const task = await startCodeWork(f.engine, f.input); await f.engine.idle();
    assert.equal((await readCodeFile(f.engine, task.id, task.owner!, 'value.txt')).content, 'existing change');
    assert.equal((await readCodeFile(f.engine, task.id, task.owner!, 'draft.txt')).content, 'untracked draft');
    assert.equal(readFileSync(join(f.root, 'value.txt'), 'utf8'), 'existing change'); assert.equal(f.git('rev-parse', 'HEAD'), head);
    assert.deepEqual(task.code.baseFiles, {}); assert.ok(task.code.baseRevision);
  } finally { await f.close(); }
});

test('a changes-requested review round wakes the same human-waiting reviewers for a repaired revision', async () => {
  const f = await project(); try {
    const task = await startCodeWork(f.engine, f.input); await f.engine.idle();
    const value = await readCodeFile(f.engine, task.id, task.owner!, 'value.txt'); await writeCodeFile(f.engine, task.id, task.owner!, 'value.txt', '2', value.sha256); await checkCodeWork(f.engine, task.id, task.owner!, 'tests');
    const first = requestCodeReview(f.engine, task.id, task.owner!, 'first'); await f.engine.idle();
    for (const [index, reviewer] of f.members.slice(1).entries()) { await readCodeFile(f.engine, task.id, reviewer.id, 'value.txt'); submitCodeReview(f.engine, task.id, reviewer.id, first.revision, index ? 'accept' : 'changes', 'Add a note explaining the fix'); }
    await f.engine.idle(); assert.equal(codeTask(f.engine, task.id).code.phase, 'implement');
    assert.ok(f.members.slice(1).every(a => f.engine.waiting(a.id)));
    await writeCodeFile(f.engine, task.id, task.owner!, 'note.txt', 'Explanation', 'new'); await checkCodeWork(f.engine, task.id, task.owner!, 'tests');
    const second = requestCodeReview(f.engine, task.id, task.owner!, 'repaired'); await f.engine.idle();
    assert.ok(f.members.slice(1).every(a => !f.engine.waiting(a.id)), 'new assigned review events wake the existing reviewers');
    for (const reviewer of f.members.slice(1)) { for (const path of ['value.txt', 'note.txt']) await readCodeFile(f.engine, task.id, reviewer.id, path); submitCodeReview(f.engine, task.id, reviewer.id, second.revision, 'accept', 'Both files reviewed'); }
    await f.engine.idle(); finishCodeWork(f.engine, task.id, task.owner!, 'done'); assert.equal(codeTask(f.engine, task.id).code.rounds.length, 2);
  } finally { await f.close(); }
});

test('independent rework after integration retains first-pass evidence and creates a fresh guarded proposal', async () => {
  const f = await project(); try {
    const task = await startCodeWork(f.engine, { ...f.input, reviewerIds: [] }); await f.engine.idle();
    await checkCodeWork(f.engine, task.id, task.owner!, 'tests');
    const value = await readCodeFile(f.engine, task.id, task.owner!, 'value.txt'); await writeCodeFile(f.engine, task.id, task.owner!, 'value.txt', '2', value.sha256); await checkCodeWork(f.engine, task.id, task.owner!, 'tests');
    requestCodeReview(f.engine, task.id, task.owner!, 'checked'); finishCodeWork(f.engine, task.id, task.owner!, 'done'); await f.engine.pause(); await integrateCodeWork(f.engine, task.id);
    const firstGroup = codeTask(f.engine, task.id).code.groupId; f.engine.resume(); reworkCodeWork(f.engine, task.id, 'Add an independently requested note'); await f.engine.idle();
    await writeCodeFile(f.engine, task.id, task.owner!, 'note.txt', 'independent acceptance repair', 'new'); await checkCodeWork(f.engine, task.id, task.owner!, 'tests'); requestCodeReview(f.engine, task.id, task.owner!, 'repaired'); finishCodeWork(f.engine, task.id, task.owner!, 'done');
    await f.engine.pause(); await integrateCodeWork(f.engine, task.id); const final = codeTask(f.engine, task.id);
    assert.deepEqual(final.code.integrationHistory, [firstGroup]); assert.notEqual(final.code.groupId, firstGroup); assert.equal(final.code.runs[0]!.exitCode, 1);
    assert.equal(readFileSync(join(f.root, 'value.txt'), 'utf8'), '2'); assert.equal(readFileSync(join(f.root, 'note.txt'), 'utf8'), 'independent acceptance repair');
  } finally { await f.close(); }
});

test('an assigned turn cannot switch to another owned worktree', async () => {
  const f = await project(); let current: Engine | undefined; let firstId = ''; let otherId = ''; let blocked = false;
  try {
    await f.engine.close(); current = new Engine(f.repo, f.session.id, async actor => ({ prompt: async text => {
      const incoming = JSON.parse(text).incoming;
      if (incoming.body === 'Inspect only the first assigned work item') {
        try { await readCodeFile(current!, otherId, actor.id, 'value.txt'); } catch (error) { blocked = /another work item/.test(String(error)); }
      }
    }, abort: async () => {}, dispose() {} })); current.resume(); await current.connect();
    firstId = (await startCodeWork(current, { ...f.input, reviewerIds: [] })).id; await current.idle();
    otherId = (await startCodeWork(current, { ...f.input, title: 'Second owned task', reviewerIds: [] })).id; await current.idle();
    current.send({ sender: 'human', sessionId: f.session.id, recipients: [f.members[0]!.id], type: 'human', taskId: firstId, body: 'Inspect only the first assigned work item' }); await current.idle(); assert.equal(blocked, true);
    assert.equal(current.currentWorkTask(f.members[0]!.id), undefined);
  } finally { await current?.close(); await f.close(); }
});
