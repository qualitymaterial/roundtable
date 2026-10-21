import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, agent, tool } from './helpers.js';
import { normalizeHostPolicy } from '../src/host-tools.js';
import { startCodeWork, readCodeFile, writeCodeFile, checkCodeWork, requestCodeReview, submitCodeReview, finishCodeWork, integrateCodeWork, codeTask, codeAssignment, workBoard, renewCodeWork } from '../src/code-work.js';
import { submitFindings, discussFindings, setCollaborativePlan, teamState, claimCodeFiles, proposeContribution, resolveContribution, askCodePeer, answerCodePeer, readyCodeContributor, collaborationTools, ensureCollaborationProgress, collaborationView } from '../src/code-collaboration.js';

async function project() {
  const f = fixture(); const root = f.session.workspace;
  const git = (...args: string[]) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
  git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'core.autocrlf', 'false');
  for (const path of ['value.txt', 'edge.txt', 'guide.txt']) writeFileSync(join(root, path), '1');
  writeFileSync(join(root, 'check.mjs'), "import{readFileSync}from'node:fs';for(const p of ['value.txt','edge.txt','guide.txt'])if(readFileSync(p,'utf8')!=='2')process.exit(1);");
  git('add', '.'); git('commit', '-m', 'baseline');
  const session = f.engine.session(); session.hostAccess = await normalizeHostPolicy({ readRoots: [root], writeRoots: [root], shell: false }); f.repo.put('session', session);
  const members = await Promise.all(['Editor', 'Edge expert', 'Documentation expert'].map(name => agent(f.engine, name)));
  const command = process.platform === 'win32' ? `& '${process.execPath.replaceAll("'", "''")}' check.mjs` : `'${process.execPath.replaceAll("'", "'\\''")}' check.mjs`;
  const task = await startCodeWork(f.engine, { title: 'Improve all three project pieces', collaborative: true, ownerId: members[0]!.id, checks: [{ name: 'tests', mode: 'host', command }], approveHostChecks: true }); await f.engine.idle();
  const assignments = members.map((m, i) => ({ agentId: m.id, paths: [['value.txt'], ['edge.txt'], ['guide.txt']][i]!, brief: ['Implement value', 'Address edge case', 'Explain behavior'][i]! }));
  async function investigate() {
    for (const m of members) { await readCodeFile(f.engine, task.id, m.id, 'value.txt'); submitFindings(f.engine, task.id, m.id, ['value.txt'], m.name + ' found missing edge behavior', 'Use independent tests and preserve the existing format'); }
    await f.engine.idle();
  }
  async function plan() {
    await investigate();
    for (const [i, m] of members.entries()) discussFindings(f.engine, task.id, m.id, 'Adopt peer edge case and document it in the combined plan', [members[(i + 1) % 3]!.id]);
    await f.engine.idle(); await setCollaborativePlan(f.engine, task.id, task.owner!, 'Adopt edge expert findings; divide implementation, edge behavior and documentation; run combined checks.', assignments); await f.engine.idle();
  }
  return { ...f, root, members, task, assignments, investigate, plan };
}

test('independent evidence and peer discussion are barriers before divided implementation', async () => {
  const f = await project(); try {
    const [owner, peer, third] = f.members; const taskId = f.task.id;
    assert.equal(codeAssignment(f.engine, owner!.id, taskId)?.role, 'investigator');
    await assert.rejects(writeCodeFile(f.engine, taskId, owner!.id, 'value.txt', '2', 'new'), /implementation/);
    assert.throws(() => submitFindings(f.engine, taskId, owner!.id, ['value.txt'], 'guess', 'guess'), /Read and cite/);
    await readCodeFile(f.engine, taskId, owner!.id, 'value.txt'); submitFindings(f.engine, taskId, owner!.id, ['value.txt'], 'found bug', 'first approach');
    const independent = teamState(f.engine, taskId, peer!.id); assert.ok('findings' in independent);
    assert.deepEqual(independent.findings, [], 'independent investigators cannot copy earlier reports');
    await assert.rejects(setCollaborativePlan(f.engine, taskId, owner!.id, 'premature', f.assignments), /phase/);
    for (const m of [peer!, third!]) { await readCodeFile(f.engine, taskId, m.id, 'value.txt'); submitFindings(f.engine, taskId, m.id, ['value.txt'], 'additional risk', 'edge coverage'); }
    await f.engine.idle(); assert.equal(codeTask(f.engine, taskId).code.phase, 'discuss');
    assert.throws(() => discussFindings(f.engine, taskId, owner!.id, 'self', [owner!.id]), /other investigator/);
    for (const [i, m] of f.members.entries()) discussFindings(f.engine, taskId, m.id, 'Adopt the peer risk and change validation', [f.members[(i + 1) % 3]!.id]); await f.engine.idle();
    assert.equal(codeAssignment(f.engine, owner!.id, taskId)?.role, 'planner');
    await assert.rejects(setCollaborativePlan(f.engine, taskId, peer!.id, 'steal', f.assignments), /editor/);
    await assert.rejects(setCollaborativePlan(f.engine, taskId, owner!.id, 'overlap', f.assignments.map(a => ({ ...a, paths: ['value.txt'] }))), /overlaps/);
    await setCollaborativePlan(f.engine, taskId, owner!.id, 'Combined peer-guided plan', f.assignments); await f.engine.idle();
    assert.equal(codeAssignment(f.engine, peer!.id, taskId)?.role, 'collaborator');
    assert.ok(workBoard(f.engine).some(line => line.includes('Combined peer-guided plan')));
    const view = collaborationView(f.engine, taskId).join('\n'); assert.match(view, /Investigation · Edge expert/); assert.match(view, /Discussion · Editor · responds to Edge expert/); assert.match(view, /Combined peer-guided plan/);
    assert.ok(!collaborationTools('collaborator')!.includes('project_write'));
    assert.ok(!collaborationTools('investigator')!.includes('project_check'));
    assert.deepEqual(collaborationTools('unassigned'), ['roundtable_wait']);
  } finally { await f.close(); }
});

test('only human reauthorization renews the same commands and cannot activate an imported lease', async () => {
  const f = await project(); try {
    const task = codeTask(f.engine, f.task.id); task.code.expiresAt = new Date(Date.now() - 1000).toISOString(); f.repo.put('task', task);
    await assert.rejects(renewCodeWork(f.engine, task.id), /explicit approval/);
    const renewed = await renewCodeWork(f.engine, task.id, true); assert.ok(Date.parse(renewed.code.expiresAt) > Date.now()); assert.deepEqual(renewed.code.checks, task.code.checks);
    assert.ok(!f.engine.tools.activeNames(f.members[0]!).some(n => n.includes('renew')));
    renewed.code.runtimeHome += '-imported'; f.repo.put('task', renewed); await assert.rejects(renewCodeWork(f.engine, task.id, true), /disabled/);
  } finally { await f.close(); }
});

test('prose-only stages get at most two continuations and explicit human waits remain durable', async () => {
  const f = await project(); try {
    const reminders = f.repo.events(f.session.id).filter(e => e.type === 'code_stage_reminder');
    for (const member of f.members) assert.equal(reminders.filter(e => (e.data as { agentId: string }).agentId === member.id).length, 2);
    assert.ok(workBoard(f.engine).some(line => line.includes('human attention')));
    const count = f.repo.events(f.session.id).length; for (const member of f.members) ensureCollaborationProgress(f.engine, f.task.id, member.id); await f.engine.idle(); assert.equal(f.repo.events(f.session.id).length, count);
    // A new phase can make progress, and old-phase blockers must not remain live.
    const task = codeTask(f.engine, f.task.id); task.code.phase = 'discuss'; f.repo.put('task', task);
    assert.ok(!workBoard(f.engine).some(line => line.includes('human attention')));
    task.code.collaboration!.reminders = {}; f.repo.put('task', task); f.engine.waitForHuman(f.members[0]!.id);
    const before = f.repo.events(f.session.id).length; ensureCollaborationProgress(f.engine, f.task.id, f.members[0]!.id); assert.equal(f.repo.events(f.session.id).length, before); assert.equal(f.engine.waiting(f.members[0]!.id), true);
  } finally { await f.close(); }
});

test('all three authors contribute and receive independent file reviews before guarded delivery', async () => {
  const f = await project(); try {
    await f.plan(); const taskId = f.task.id; const owner = f.task.owner!;
    assert.equal((await checkCodeWork(f.engine, taskId, owner, 'tests')).exitCode, 1);
    const value = await readCodeFile(f.engine, taskId, owner, 'value.txt'); await writeCodeFile(f.engine, taskId, owner, 'value.txt', '2', value.sha256);
    for (const [i, peer] of f.members.slice(1).entries()) {
      const path = ['edge.txt', 'guide.txt'][i]!; const before = await readCodeFile(f.engine, taskId, peer.id, path);
      await assert.rejects(writeCodeFile(f.engine, taskId, peer.id, path, '2', before.sha256), /editor/);
      const proposal = await proposeContribution(f.engine, taskId, peer.id, path, before.sha256, '2', 'Independent implementation');
      await assert.rejects(resolveContribution(f.engine, taskId, owner, proposal.proposalId, 'apply', 'blind'), /inspect/);
      teamState(f.engine, taskId, owner, proposal.proposalId); await resolveContribution(f.engine, taskId, owner, proposal.proposalId, 'apply', 'Adopt independent implementation');
      if (i === 1) { await checkCodeWork(f.engine, taskId, owner, 'tests'); assert.throws(() => requestCodeReview(f.engine, taskId, owner, 'premature'), /unresolved/); }
      readyCodeContributor(f.engine, taskId, peer.id);
    }
    await f.engine.idle(); assert.equal((await checkCodeWork(f.engine, taskId, owner, 'tests')).exitCode, 0);
    const request = requestCodeReview(f.engine, taskId, owner, 'combined checks passed'); await f.engine.idle();
    const round = codeTask(f.engine, taskId).code.rounds.at(-1)!;
    assert.equal(codeAssignment(f.engine, request.reviewers[0]!, taskId)?.reviewRevision, request.revision);
    const reviewContext = teamState(f.engine, taskId, request.reviewers[0]!); assert.ok('review' in reviewContext); assert.equal(reviewContext.review?.revision, request.revision);
    assert.equal(f.repo.events(f.session.id).filter(e => e.type === 'code_stage_reminder' && (e.data as { phase: string }).phase === 'review').length, 4, 'both prose-only reviewers get bounded stage continuations');
    assert.throws(() => submitCodeReview(f.engine, taskId, owner, request.revision, 'accept', 'self approval'), /not assigned/);
    assert.ok(!round.assignments![f.members[1]!.id]!.includes('edge.txt'));
    assert.ok(!round.assignments![f.members[2]!.id]!.includes('guide.txt'));
    for (const reviewer of request.reviewers) { for (const path of round.assignments![reviewer]!) await readCodeFile(f.engine, taskId, reviewer, path); submitCodeReview(f.engine, taskId, reviewer, request.revision, 'accept', 'Independent assigned files checked'); }
    await f.engine.idle(); finishCodeWork(f.engine, taskId, owner, 'All three contributed');
    f.engine.notify(owner, 'late-scope-ready', 'Stale action after completion', taskId); await f.engine.idle();
    assert.ok(!f.repo.messages(f.session.id).some(m => m.body === 'Stale action after completion'));
    const late = f.engine.send({ sender: 'system', sessionId: f.session.id, recipients: [owner], type: 'system', taskId, body: 'Already-flushed stale action' }); await f.engine.idle();
    assert.ok(f.repo.deliveries(f.session.id, ['cancelled']).some(d => d.messageId === late.id));
    assert.equal(readFileSync(join(f.root, 'edge.txt'), 'utf8'), '1'); await f.engine.pause(); await integrateCodeWork(f.engine, taskId);
    for (const path of ['value.txt', 'edge.txt', 'guide.txt']) assert.equal(readFileSync(join(f.root, path), 'utf8'), '2');
    assert.equal(new Set(Object.values(codeTask(f.engine, taskId).code.collaboration!.authors).flat()).size, 3);
    assert.equal(f.repo.events(f.session.id).filter(e => e.type === 'code_contribution_applied').length, 2);
  } finally { await f.close(); }
});

test('a file coauthored by every member requires independent human inspection', async () => {
  const f = await project(); try {
    await f.plan(); const taskId = f.task.id; const owner = f.task.owner!;
    for (const [i, peer] of f.members.slice(1).entries()) await claimCodeFiles(f.engine, taskId, peer.id, [['edge.txt'], ['guide.txt']][i]!, owner);
    for (const path of ['value.txt', 'edge.txt', 'guide.txt']) { const file = await readCodeFile(f.engine, taskId, owner, path); await writeCodeFile(f.engine, taskId, owner, path, '2', file.sha256); }
    let currentOwner = owner;
    for (const [i, peer] of f.members.slice(1).entries()) {
      await claimCodeFiles(f.engine, taskId, currentOwner, ['value.txt'], peer.id); currentOwner = peer.id;
      const file = await readCodeFile(f.engine, taskId, peer.id, 'value.txt'); const proposal = await proposeContribution(f.engine, taskId, peer.id, 'value.txt', file.sha256, i ? '2' : '3', 'Refine the shared file');
      teamState(f.engine, taskId, owner, proposal.proposalId); await resolveContribution(f.engine, taskId, owner, proposal.proposalId, 'apply', 'Adopt refinement'); readyCodeContributor(f.engine, taskId, peer.id);
    }
    await f.engine.idle(); await checkCodeWork(f.engine, taskId, owner, 'tests');
    assert.throws(() => requestCodeReview(f.engine, taskId, owner, 'all contributors ready'), /No independent reviewer/);
    assert.equal(codeTask(f.engine, taskId).code.phase, 'implement');
  } finally { await f.close(); }
});

test('concrete questions wake peers and deliver answers without acknowledgement loops', async () => {
  const f = await project(); try {
    await f.plan(); const owner = f.members[0]!; const peer = f.members[1]!; const taskId = f.task.id;
    readyCodeContributor(f.engine, taskId, peer.id); await f.engine.idle();
    const question = askCodePeer(f.engine, taskId, owner.id, peer.id, 'Which edge condition must the combined implementation cover?');
    assert.ok(!codeTask(f.engine, taskId).code.collaboration!.ready.includes(peer.id), 'a concrete new request reopens the peer scope');
    assert.equal(f.engine.waiting(owner.id), true);
    assert.equal((await tool(f.engine, owner, 'project_team', { taskId })).ok, false, 'waiting caller cannot poll');
    await f.engine.idle(); assert.equal(f.engine.waiting(peer.id), false);
    assert.throws(() => answerCodePeer(f.engine, taskId, f.members[2]!.id, question.questionId, 'wrong responder'), /assigned/);
    assert.throws(() => readyCodeContributor(f.engine, taskId, peer.id), /open questions/);
    answerCodePeer(f.engine, taskId, peer.id, question.questionId, 'Handle the empty value before rounding; add a fixed-output regression.'); await f.engine.idle();
    assert.equal(f.engine.waiting(owner.id), false); const events = f.repo.events(f.session.id).length; await f.engine.idle(); assert.equal(f.repo.events(f.session.id).length, events);
    assert.equal(codeTask(f.engine, taskId).code.collaboration!.questions.filter(q => q.answer).length, 1);
  } finally { await f.close(); }
});

test('contribution conflicts, claims, outstanding work and pause cannot bypass runtime guards', async () => {
  const f = await project(); try {
    await f.plan(); const taskId = f.task.id; const owner = f.task.owner!; const peer = f.members[1]!.id;
    await assert.rejects(claimCodeFiles(f.engine, taskId, peer, ['value.txt']), /Only the file owner/);
    await assert.rejects(writeCodeFile(f.engine, taskId, owner, 'edge.txt', '2', 'new'), /assigned/);
    const before = await readCodeFile(f.engine, taskId, peer, 'edge.txt'); const proposal = await proposeContribution(f.engine, taskId, peer, 'edge.txt', before.sha256, '2', 'Peer implementation');
    await assert.rejects(claimCodeFiles(f.engine, taskId, peer, ['edge.txt'], owner), /pending/);
    teamState(f.engine, taskId, owner, proposal.proposalId); writeFileSync(join(f.task.code.root, 'edge.txt'), 'user changed');
    await assert.rejects(resolveContribution(f.engine, taskId, owner, proposal.proposalId, 'apply', 'stale'), /hash|chang/i); assert.equal(readFileSync(join(f.task.code.root, 'edge.txt'), 'utf8'), 'user changed');
    assert.equal(codeTask(f.engine, taskId).code.collaboration!.contributions[0]!.state, 'pending');
    await resolveContribution(f.engine, taskId, owner, proposal.proposalId, 'reject', 'Refresh against current content'); await f.engine.idle();
    await claimCodeFiles(f.engine, taskId, peer, ['edge.txt'], owner); await f.engine.idle(); assert.equal(codeTask(f.engine, taskId).code.collaboration!.claims['edge.txt'], owner);
    await f.engine.pause(); assert.throws(() => askCodePeer(f.engine, taskId, owner, peer, 'after pause'), /paused/);
  } finally { await f.close(); }
});
