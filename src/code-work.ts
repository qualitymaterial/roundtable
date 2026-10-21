import { assertTaskEvidence } from './verification-gate.js';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync, realpathSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { Engine } from './engine.js';
import { id, timestamp, redact, type Task } from './domain.js';
import { createWorktree, proposeChanges, reviewChanges, applyChanges, settleChanges } from './change-groups.js';
import { guardedWrite, hostPath, executeHost, sensitiveHostPath, previewCheckpoint } from './host-tools.js';
import { workspacePath, type ToolRegistry } from './tools.js';
import { grantSandbox, runSandbox, parseSandboxArgv } from './sandbox.js';
import { Type } from 'typebox';
import { ProviderRegistry } from './providers.js';
import { readRelevanceConfig, relevanceInput, relevanceIdentity, rankFileCandidates, type FileRelevanceConfig, type RelevanceCandidate } from './file-relevance.js';
import { newCollaboration, recordInvestigationRead, assertFileAuthor, recordFileAuthor, collaborationReviewAssignments, reopenCollaboration, installCollaborationTools, type CodeCollaboration } from './code-collaboration.js';

export type CodeCheck = { name: string; command: string; mode: 'sandbox' | 'host' };
type CheckRun = { id: string; name: string; revision: string; exitCode: number | null; output: string; elapsedMs: number; at: string; sandboxRunId?: string };
type ReviewRound = { revision: string; files: string[]; assignments?: Record<string, string[]>; reviews: { agentId: string; verdict: 'accept' | 'changes'; findings: string }[] };
export type CodeWork = { judgment?: FileRelevanceConfig; judgmentCalls?: number; root: string; worktreeId: string; baseHead: string; baseRevision?: string; phase: 'preparing' | 'investigate' | 'discuss' | 'plan' | 'implement' | 'review' | 'ready' | 'integrated'; reviewers: string[]; checks: CodeCheck[]; runs: CheckRun[]; rounds: ReviewRound[]; baseFiles: Record<string, string>; inspected: Record<string, string[]>; expiresAt: string; leaseSession: string; runtimeHome: string; sandboxGrant?: string; groupId?: string; integrationHistory?: string[]; collaboration?: CodeCollaboration };
const Input = z.object({ title: z.string().min(1).max(1000), key: z.string().min(1).max(300).optional(), ownerId: z.string().optional(), reviewerIds: z.array(z.string()).max(4).optional(), collaborative: z.boolean().default(false), checks: z.array(z.object({ name: z.string().min(1).max(80), command: z.string().min(1).max(2000), mode: z.enum(['sandbox', 'host']) }).strict()).min(1).max(5), approveHostChecks: z.boolean().default(false) }).strict();
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const workKey = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const git = (root: string, ...args: string[]) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-c', 'core.hooksPath=' + join(root, '.roundtable-no-hooks'), '-c', 'core.fsmonitor=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 }).trim();
async function snapshotWorkingText(primary: string, branch: string) {
  const files = git(primary, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean); let bytes = 0;
  if (files.length > 5000) throw new Error('Work snapshot exceeds 5000 files');
  for (const path of files) {
    if (sensitiveHostPath(path) || path.split('/').some(p => p.startsWith('.'))) continue;
    const from = await workspacePath(primary, path); const to = await workspacePath(branch, path);
    if (!existsSync(from)) { if (existsSync(to)) throw new Error('Working tree has deleted files; review those changes before starting this work item'); continue; }
    const stat = lstatSync(from); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Only regular project files may enter a work snapshot');
    if ((bytes += stat.size) > 32 * 1024 * 1024) throw new Error('Work snapshot exceeds 32 MiB');
    const data = readFileSync(from); const base = existsSync(to) ? readFileSync(to) : undefined;
    if (base?.equals(data)) continue;
    if (data.includes(0) || data.length > 256000) throw new Error('Dirty binary/large file requires explicit review before work: ' + path);
    mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, data);
  }
}
export function codeTask(engine: Engine, taskId: string): Task & { code: CodeWork } {
  const task = engine.repo.get<Task>('task', taskId);
  if (!task?.code || task.sessionId !== engine.sessionId) throw new Error('Unknown session work item');
  if (task.code.leaseSession !== engine.sessionId || task.code.runtimeHome !== realpathSync.native(dirname(engine.repo.path)) || engine.repo.get<{ suspended?: boolean }>('worktree', task.code.worktreeId)?.suspended) throw new Error('Imported/restored work leases are disabled; start a new work item');
  return task as Task & { code: CodeWork };
}
export function codeActor(engine: Engine, taskId: string, agentId: string, edit = false) {
  const task = codeTask(engine, taskId);
  if (engine.currentWorkTask(agentId) && engine.currentWorkTask(agentId) !== taskId) throw new Error('This turn belongs to another work item; use the assigned task ID');
  if (!engine.agents().some(a => a.id === agentId && a.state === 'active') || (task.owner !== agentId && !task.code.reviewers.includes(agentId))) throw new Error('Not assigned to this work item');
  if (edit && (task.owner !== agentId || task.state !== 'claimed' || task.code.phase !== 'implement')) throw new Error('Only the assigned editor may edit during implementation');
  if (engine.session().state !== 'active') throw new Error('Session paused');
  return task;
}
const actor = codeActor;
export function codeRevision(engine: Engine, taskId: string): string {
  const { root } = codeTask(engine, taskId).code; if (!root) throw new Error('Worktree is still preparing');
  const files = git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean).sort();
  if (files.length > 5000) throw new Error('Work item exceeds 5000 tracked/candidate files');
  let bytes = 0; const entries: string[] = [];
  for (const file of files) {
    if (sensitiveHostPath(file) || file.split('/').some(p => p.startsWith('.'))) continue;
    const path = join(root, file); let stat;
    try { stat = lstatSync(path); } catch { entries.push(file + ':deleted'); continue; }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Worktree contains a nonregular tracked file');
    if ((bytes += stat.size) > 32 * 1024 * 1024) throw new Error('Work item exceeds 32 MiB');
    entries.push(file + ':' + hash(readFileSync(path)));
  }
  return hash(entries.join('\n'));
}
/** Human entry point. Models can use the resulting lease, never create or widen it. */
export async function startCodeWork(engine: Engine, input: z.input<typeof Input>): Promise<Task & { code: CodeWork }> {
  const config = Input.parse(input); const key = workKey(config.key ?? config.title);
  const existing = engine.repo.list<Task>('task', engine.sessionId).find(t => t.key === key && t.code);
  if (existing) return codeTask(engine, existing.id);
  if (engine.session().state !== 'active') throw new Error('Resume before starting work');
  if (new Set(config.checks.map(c => c.name)).size !== config.checks.length) throw new Error('Check names must be unique');
  if (config.checks.some(c => c.mode === 'host') && !config.approveHostChecks) throw new Error('Host checks require explicit approval of their exact commands and OS privileges');
  const members = engine.agents().filter(a => a.state === 'active'); if (!members.length) throw new Error('Connect participants first');
  const claimed = engine.repo.list<Task>('task', engine.sessionId).filter(t => t.state === 'claimed');
  const owner = config.ownerId ? members.find(a => a.id === config.ownerId) : [...members].sort((a, b) => claimed.filter(t => t.owner === a.id).length - claimed.filter(t => t.owner === b.id).length)[0];
  if (!owner) throw new Error('Unknown active editor');
  const reviewers = config.reviewerIds ?? members.filter(a => a.id !== owner.id).slice(0, 2).map(a => a.id);
  if (new Set(reviewers).size !== reviewers.length || reviewers.some(r => r === owner.id || !members.some(a => a.id === r))) throw new Error('Reviewers must be distinct active peers');
  if (config.collaborative && !reviewers.length) throw new Error('Collaborative work requires at least two participants');
  await hostPath(engine.session(), engine.session().projectRoot ?? engine.session().workspace, true);
  // Reserve synchronously after authorization: concurrent starts reuse the same key.
  const duplicate = engine.repo.list<Task>('task', engine.sessionId).find(t => t.key === key && t.code); if (duplicate) return codeTask(engine, duplicate.id);
  const task: Task & { code: CodeWork } = { id: id(), sessionId: engine.sessionId, key, title: redact(config.title), owner: owner.id, state: 'claimed', findings: '', dependencies: [], updatedAt: timestamp(), code: { judgment: readRelevanceConfig(dirname(engine.repo.path)), root: '', worktreeId: '', baseHead: '', phase: 'preparing', reviewers, checks: config.checks, runs: [], rounds: [], baseFiles: {}, inspected: {}, expiresAt: new Date(Date.now() + 30 * 60000).toISOString(), leaseSession: engine.sessionId, runtimeHome: realpathSync.native(dirname(engine.repo.path)) } };
  engine.repo.put('task', task);
  try {
    const tree = await createWorktree(engine, 'roundtable/work-' + task.id.slice(0, 12), true);
    task.code.root = tree.path; task.code.worktreeId = tree.id; task.code.baseHead = git(tree.path, 'rev-parse', 'HEAD'); engine.repo.put('task', task);
    await snapshotWorkingText(engine.session().projectRoot!, tree.path); task.code.baseRevision = codeRevision(engine, task.id); task.code.phase = config.collaborative ? 'investigate' : 'implement';
    if (config.collaborative) task.code.collaboration = newCollaboration([owner.id, ...reviewers]);
    if (config.checks.some(c => c.mode === 'sandbox')) task.code.sandboxGrant = grantSandbox(engine, owner.id, tree.path).id;
    engine.repo.put('task', task); engine.repo.event(engine.sessionId, 'code_work_started', { taskId: task.id, owner: owner.id, reviewers, checks: config.checks, baseHead: task.code.baseHead });
    engine.send({ sender: 'human', sessionId: engine.sessionId, recipients: config.collaborative ? [owner.id, ...reviewers] : [owner.id], type: 'human', taskId: task.id, body: config.collaborative ? `${task.title}\nCollaborative work item ${task.id}. Independently inspect relevant source/tests using project_list/search/read, then submit file-grounded project_findings and a proposed approach. All members will exchange findings, challenge assumptions and agree a divided implementation plan before editing. Use project_team for member identities. No edits, role negotiation or acknowledgements now. End after submitting findings; runtime delivers peer perspectives.` : `${task.title}\nAssigned work item: ${task.id}. You are the sole editor; reviewers are assigned by the runtime. Use project_read/project_write in its isolated worktree. Run project_check first to reproduce the baseline, then edit and rerun until checks pass. Call project_request_review, end the turn, and wait for the batched review result. After acceptance call project_finish. Do not create duplicate tasks, negotiate roles, contact reviewers yourself, weaken tests, or use host/workspace tools for this work item.` });
    return task;
  } catch (error) { task.state = 'cancelled'; task.findings = 'Preparation failed: ' + redact(String(error)); engine.repo.put('task', task); throw error; }
}
export async function readCodeFile(engine: Engine, taskId: string, agentId: string, path: string) {
  const task = actor(engine, taskId, agentId); const target = await workspacePath(task.code.root, path); const stat = lstatSync(target);
  if (stat.size > 256000) throw new Error('File exceeds 256 KiB');
  const content = readFileSync(target, 'utf8'); if (content.includes('\0')) throw new Error('Text files only');
  const round = task.code.rounds.at(-1);
  if (task.code.phase === 'review' && round && codeRevision(engine, taskId) === round.revision && round.files.includes(path)) {
    const token = `${round.revision}:${agentId}`; task.code.inspected[token] = [...new Set([...(task.code.inspected[token] ?? []), path])]; engine.repo.put('task', task);
  }
  recordInvestigationRead(engine, taskId, agentId, path);
  return { path, content: redact(content), sha256: hash(content) };
}
/** Human-only reauthorization of the same named checks, never exposed as a model tool. */
export async function renewCodeWork(engine: Engine, taskId: string, approveHostChecks = false) {
  const task = codeTask(engine, taskId);
  if (task.state === 'cancelled' || task.code.phase === 'integrated') throw new Error('Start a new work item after cancellation or integration');
  if (task.code.checks.some(c => c.mode === 'host') && !approveHostChecks) throw new Error('Renewal requires explicit approval of the exact host checks and OS privileges');
  await hostPath(engine.session(), engine.session().projectRoot!, true);
  const current = codeTask(engine, taskId); const previous = current.code.expiresAt;
  if (current.code.checks.some(c => c.mode === 'sandbox')) current.code.sandboxGrant = grantSandbox(engine, current.owner!, current.code.root).id;
  current.code.expiresAt = new Date(Date.now() + 30 * 60000).toISOString(); engine.repo.put('task', current);
  engine.repo.event(engine.sessionId, 'human_code_lease_renewed', { taskId, previous, expiresAt: current.code.expiresAt, checks: current.code.checks }); return current;
}
export async function listCodeFiles(engine: Engine, taskId: string, agentId: string, path = '') {
  const task = actor(engine, taskId, agentId); const root = path ? await workspacePath(task.code.root, path) : task.code.root;
  return readdirSync(root, { withFileTypes: true }).filter(e => !e.name.startsWith('.') && e.name !== 'node_modules' && !sensitiveHostPath(e.name) && !e.isSymbolicLink()).slice(0, 200).map(e => ({ name: e.name, directory: e.isDirectory() }));
}
export async function searchCode(engine: Engine, taskId: string, agentId: string, query: string) {
  const task = actor(engine, taskId, agentId); const files = git(task.code.root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean); const results: { path: string; line: number; text: string }[] = []; let scanned = 0;
  for (const path of files) {
    if (results.length >= 20 || scanned >= 1000) break;
    if (path.split('/').some(p => p.startsWith('.')) || sensitiveHostPath(path)) continue;
    const file = await workspacePath(task.code.root, path); const stat = lstatSync(file); if (!stat.isFile() || stat.size > 256000) continue;
    scanned++; const content = readFileSync(file, 'utf8'); if (content.includes('\0')) continue;
    for (const [i, line] of content.split('\n').entries()) if (line.includes(query) && results.length < 20) results.push({ path, line: i + 1, text: redact(line.slice(0, 400)) });
  }
  return { results, scanned, truncated: results.length >= 20 || scanned >= 1000 };
}
/** Advisory excerpts never satisfy investigation/read or independent review barriers. */
export async function rankCodeFiles(engine: Engine, taskId: string, agentId: string, input: unknown, signal?: AbortSignal) {
  const task = actor(engine, taskId, agentId); const args = relevanceInput.parse(input);
  const candidates: RelevanceCandidate[] = [];
  for (const path of args.paths) {
    try {
      if (sensitiveHostPath(path) || path.split('/').some(p => /^(node_modules|dist|vendor|coverage)$/i.test(p))) throw new Error('Excluded');
      const target = await workspacePath(task.code.root, path); const stat = lstatSync(target);
      if (!stat.isFile() || stat.size > 128000) throw new Error('Not bounded text');
      const content = readFileSync(target, 'utf8'); if (content.includes('\0')) throw new Error('Not text');
      const limit = task.code.judgment?.excerptChars ?? 1600;
      candidates.push({ path, sha256: hash(content), excerpt: redact(content.slice(0, limit)), excerptTruncated: content.length > limit });
    } catch { candidates.push({ path, status: 'excluded-or-unreadable' }); }
  }
  const query = task.title + '\nInvestigation: ' + args.query;
  const key = relevanceIdentity(task.code.judgment ?? { backend: 'laya', model: 'disabled', excerptChars: 1600, timeoutMs: 15000, maxFileRequests: 60 }, query, candidates);
  const cacheKey = `file-relevance:${engine.sessionId}:${key}`;
  const cached = engine.repo.cached(cacheKey) as Awaited<ReturnType<typeof rankFileCandidates>> | undefined;
  if (!cached && task.code.judgment) {
    const current = actor(engine, taskId, agentId);
    if (current.state !== 'claimed' || Date.parse(current.code.expiresAt) <= Date.now()) throw new Error('Work lease ended; inspect files without advisory requests');
    const requests = candidates.filter(c => !c.status).length;
    if ((current.code.judgmentCalls ?? 0) + requests > task.code.judgment.maxFileRequests) throw new Error('Advisory request budget reached; inspect original candidates normally');
    current.code.judgmentCalls = (current.code.judgmentCalls ?? 0) + requests; engine.repo.put('task', current);
  }
  let selectedCredential: string | undefined;
  if (!cached && task.code.judgment?.credentialProvider) {
    try { const registry = await ProviderRegistry.create(dirname(engine.repo.path)); selectedCredential = (await registry.runtime.getAuth(task.code.judgment.credentialProvider))?.auth?.apiKey; }
    catch { /* Missing selected auth falls back to unscored candidates, never another app's store. */ }
  }
  const result = cached ?? await rankFileCandidates(task.code.judgment, query, candidates, signal, selectedCredential);
  // Recheck current authorization after asynchronous advice; cancelled turns do not publish it.
  actor(engine, taskId, agentId); if (signal?.aborted) throw new Error('Relevance cancelled');
  if (!cached && result.candidates.every(c => c.status === 'scored')) engine.repo.cache(cacheKey, engine.sessionId, result);
  engine.repo.event(engine.sessionId, 'file_relevance', { taskId, agentId, key, cached: Boolean(cached), ...result });
  return { ...result, cached: Boolean(cached) };
}
export async function writeCodeFile(engine: Engine, taskId: string, agentId: string, path: string, content: string, expectedHash: string, signal = new AbortController().signal, authorId = agentId) {
  const task = actor(engine, taskId, agentId, true); if (Date.parse(task.code.expiresAt) <= Date.now()) throw new Error('Work lease expired');
  assertFileAuthor(task, path, authorId);
  let integrationHash = task.code.baseFiles[path];
  let lineStyle: string | undefined;
  if (!integrationHash) {
    const primary = await workspacePath(engine.session().projectRoot!, path); const branch = await workspacePath(task.code.root, path);
    if (expectedHash === 'new') { if (existsSync(primary)) throw new Error('Project already contains this path; refusing to overwrite existing work'); integrationHash = 'new'; }
    else {
      if (!existsSync(primary)) throw new Error('Project path was removed; inspect existing work');
      const primaryContent = readFileSync(primary, 'utf8'); const branchContent = readFileSync(branch, 'utf8');
      if (primaryContent.replaceAll('\r\n', '\n') !== branchContent.replaceAll('\r\n', '\n')) throw new Error('Project has existing changes in this file; preserve them before starting this work item');
      integrationHash = hash(primaryContent);
      lineStyle = primaryContent;
    }
  }
  const authorize = () => workspacePath(task.code.root, path);
  const branchPath = await authorize();
  lineStyle ??= existsSync(branchPath) ? readFileSync(branchPath, 'utf8') : undefined;
  if (lineStyle?.includes('\r\n') && !lineStyle.replaceAll('\r\n', '').includes('\n')) content = content.replace(/\r?\n/g, '\r\n');
  const result = await guardedWrite(engine, authorize, content, expectedHash, signal, 'host', agentId);
  const current = codeTask(engine, taskId); current.code.baseFiles[path] ??= integrationHash; recordFileAuthor(current, path, authorId); engine.repo.put('task', current);
  engine.repo.event(engine.sessionId, 'code_file_written', { taskId, agentId, authorId, path }); return result;
}
export async function checkCodeWork(engine: Engine, taskId: string, agentId: string, name: string, signal = new AbortController().signal) {
  const task = actor(engine, taskId, agentId, true); if (Date.parse(task.code.expiresAt) <= Date.now()) throw new Error('Work lease expired');
  const check = task.code.checks.find(c => c.name === name); if (!check) throw new Error('Unknown approved check');
  const revision = codeRevision(engine, taskId); const started = Date.now(); let exitCode: number | null; let output: string; let sandboxRunId: string | undefined;
  const cancel = new AbortController(); const executionSignal = AbortSignal.any([signal, cancel.signal]);
  const watch = setInterval(() => { if (engine.session().state !== 'active' || Date.parse(task.code.expiresAt) <= Date.now()) cancel.abort(new Error('Work check cancelled by pause or lease expiry')); }, 100);
  try {
  if (check.mode === 'sandbox') { const result = await runSandbox(engine, agentId, task.code.sandboxGrant!, parseSandboxArgv(check.command), executionSignal); exitCode = result.exitCode; output = result.output; sandboxRunId = result.runId; }
  else {
    const command = process.platform === 'win32' ? `$ErrorActionPreference = 'Stop'; ${check.command}\nif ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }` : check.command;
    const result = await executeHost(command, task.code.root, executionSignal, 30000) as { code: number | null; output: string; stopped?: string }; exitCode = result.stopped ? null : result.code; output = result.output;
  }
  } finally { clearInterval(watch); }
  executionSignal.throwIfAborted(); if (engine.session().state !== 'active') throw new Error('Check interrupted by pause');
  const run: CheckRun = { id: id(), name, revision, exitCode, output: redact(output), elapsedMs: Date.now() - started, at: timestamp(), ...(sandboxRunId ? { sandboxRunId } : {}) };
  const current = codeTask(engine, taskId); current.code.runs.push(run); engine.repo.put('task', current);
  engine.repo.event(engine.sessionId, 'code_check_finished', { taskId, ...run }); return run;
}
function passedChecks(engine: Engine, taskId: string): string {
  const task = codeTask(engine, taskId); const revision = codeRevision(engine, taskId);
  for (const check of task.code.checks) { const run = task.code.runs.findLast(r => r.name === check.name); if (!run || run.exitCode !== 0 || run.revision !== revision) throw new Error('Run passing checks on the current file revision before review/completion: ' + check.name); }
  return revision;
}
export function requestCodeReview(engine: Engine, taskId: string, agentId: string, summary: string) {
  const task = actor(engine, taskId, agentId, true); const revision = passedChecks(engine, taskId);
  if (!Object.keys(task.code.baseFiles).length) throw new Error('No file changes to review');
  if (task.code.rounds.at(-1)?.revision === revision) throw new Error('This revision was already reviewed; implement the requested changes before another review');
  if (task.code.rounds.length >= 3) throw new Error('Three review rounds exhausted; ask the human to inspect this work');
  const files = Object.keys(task.code.baseFiles).sort(); const assignments = collaborationReviewAssignments(task, files);
  const round: ReviewRound = { revision, files, ...(assignments ? { assignments } : {}), reviews: [] }; const reviewers = assignments ? Object.keys(assignments) : task.code.reviewers;
  task.code.rounds.push(round); task.code.phase = reviewers.length ? 'review' : 'ready'; engine.repo.put('task', task);
  for (const reviewer of reviewers) engine.notify(reviewer, `code-review-request:${taskId}:${revision}`, `Review work item ${taskId}, revision ${revision}. ${redact(summary)}\nRead each file assigned to your independent review with project_read: ${(assignments?.[reviewer] ?? round.files).join(', ')}. Other files may be read as context, but your verdict covers only the assigned files, excluding your own contributions. Inspect tests and consider regression edge cases beyond provided examples. Submit one project_review with revision, verdict accept or changes, and concrete findings. End after submission.`, taskId);
  if (reviewers.length) engine.waitForInput(agentId, 'peers');
  return { taskId, revision, reviewers, instruction: reviewers.length ? 'End this turn. The runtime will wake you once all assigned reviews arrive.' : 'No peer reviewers in this solo session. Call project_finish after verifying checks.' };
}
export function submitCodeReview(engine: Engine, taskId: string, agentId: string, revision: string, verdict: 'accept' | 'changes', findings: string) {
  const task = actor(engine, taskId, agentId); const round = task.code.rounds.at(-1);
  const reviewers = round?.assignments ? Object.keys(round.assignments) : task.code.reviewers;
  if (task.code.phase !== 'review' || !reviewers.includes(agentId) || !round || round.revision !== revision || codeRevision(engine, taskId) !== revision) throw new Error('Review is not assigned or its revision changed');
  if (round.reviews.some(r => r.agentId === agentId)) throw new Error('Review already submitted for this revision');
  if ((round.assignments?.[agentId] ?? round.files).some(f => !task.code.inspected[`${revision}:${agentId}`]?.includes(f))) throw new Error('Read every changed file assigned to you before submitting its review');
  round.reviews.push({ agentId, verdict, findings: redact(findings) });
  const complete = reviewers.every(r => round.reviews.some(v => v.agentId === r));
  if (complete) task.code.phase = round.reviews.every(r => r.verdict === 'accept') ? 'ready' : 'implement';
  engine.repo.put('task', task); engine.repo.event(engine.sessionId, 'code_review_submitted', { taskId, revision, agentId, verdict });
  engine.waitForHuman(agentId);
  if (complete) engine.notify(task.owner!, `code-review:${taskId}:${revision}`, `All assigned reviews for work item ${taskId} arrived. Phase: ${task.code.phase}. ${round.reviews.map(r => `${r.verdict}: ${r.findings}`).join('\n')}\nIf changes are required, repair and rerun checks, then request another review. If ready, call project_finish. Do not poll.`, taskId);
  return { recorded: true, allReviewsReceived: complete, instruction: 'Review recorded. End this turn; no peer acknowledgements are needed.' };
}
export function assertCodeComplete(engine: Engine, task: Task): void {
  if (!task.code) return;
  const revision = passedChecks(engine, task.id); const round = task.code.rounds.at(-1);
  const reviewers = round?.assignments ? Object.keys(round.assignments) : task.code.reviewers;
  if (!['ready', 'integrated'].includes(task.code.phase) || !round || round.revision !== revision || task.code.reviewers.includes(task.owner!) || reviewers.some(r => !round.reviews.some(v => v.agentId === r && v.verdict === 'accept'))) throw new Error('Current revision needs all assigned accepting reviews before completion');
}
export function finishCodeWork(engine: Engine, taskId: string, agentId: string, findings: string) {
  const task = actor(engine, taskId, agentId); if (task.owner !== agentId || task.state !== 'claimed') throw new Error('Only the assigned editor may finish');
  assertCodeComplete(engine, task); assertTaskEvidence(engine, task); task.state = 'done'; task.findings = redact(findings); task.updatedAt = timestamp(); engine.repo.put('task', task);
  engine.repo.event(engine.sessionId, 'code_work_finished', { taskId, revision: codeRevision(engine, taskId) }); engine.waitForHuman(agentId);
  return { completed: true, integration: 'Changes remain in the isolated worktree. The human can inspect /work-diff and /integrate.' };
}
/** Human-only follow-up after independent acceptance finds an issue. Original evidence stays intact. */
export function reworkCodeWork(engine: Engine, taskId: string, reason: string) {
  if (!reason.trim() || reason.length > 2000) throw new Error('Provide a concrete rework reason up to 2000 characters');
  if (engine.session().state !== 'active') throw new Error('Resume before requesting rework');
  const task = codeTask(engine, taskId);
  if (Date.parse(task.code.expiresAt) <= Date.now()) throw new Error('Check lease expired; start a new work item with reviewed commands');
  if (!['ready', 'integrated'].includes(task.code.phase) || task.state !== 'done') throw new Error('Use rework for a completed proposal; active revisions follow their existing review round');
  const integrated = task.code.phase === 'integrated'; if (integrated) task.code.baseFiles = {};
  if (task.code.groupId) { task.code.integrationHistory = [...(task.code.integrationHistory ?? []), task.code.groupId]; delete task.code.groupId; }
  task.state = 'claimed'; task.code.phase = 'implement'; task.updatedAt = timestamp(); task.findings += '\nIndependent acceptance requested rework: ' + redact(reason); reopenCollaboration(engine, task, reason, integrated); engine.repo.put('task', task);
  engine.repo.event(engine.sessionId, 'human_code_rework', { taskId, reason: redact(reason) });
  engine.send({ sender: 'human', sessionId: engine.sessionId, recipients: [task.owner!], type: 'human', taskId, body: `Independent acceptance found an issue in work item ${taskId}: ${reason}\nUse the same project_* workflow. Reproduce with the approved named check, repair the source, rerun checks, request a new batched review, and finish. Preserve prior evidence and do not weaken the tests.` });
  return task;
}
export async function codeIntegration(engine: Engine, taskId: string) {
  const task = codeTask(engine, taskId); assertCodeComplete(engine, task);
  if (task.state !== 'done') throw new Error('Finish work before preparing integration');
  assertTaskEvidence(engine, task);
  if (task.code.groupId) return engine.repo.get<import('./change-groups.js').ChangeGroup>('changegroup', task.code.groupId)!;
  const changes = await Promise.all(Object.entries(task.code.baseFiles).map(async ([path, beforeHash]) => ({ path, beforeHash, content: readFileSync(await workspacePath(task.code.root, path), 'utf8') })));
  const group = proposeChanges(engine, task.title.slice(0, 300), engine.session().projectRoot!, changes); task.code.groupId = group.id; engine.repo.put('task', task); return group;
}
export async function integrateCodeWork(engine: Engine, taskId: string) {
  assertCodeComplete(engine, codeTask(engine, taskId)); const group = await codeIntegration(engine, taskId);
  await applyChanges(engine, group.id); await settleChanges(engine, group.id, 'accept'); const current = codeTask(engine, taskId); current.code.phase = 'integrated'; current.code.groupId = group.id; engine.repo.put('task', current); return group;
}
export async function codeDiff(engine: Engine, taskId: string) { const group = await codeIntegration(engine, taskId); return group.state === 'accepted' ? Promise.all(group.checkpoints.map(key => previewCheckpoint(engine, key))) : reviewChanges(engine, group.id); }
export function codeAssignment(engine: Engine, agentId: string, taskId?: string) {
  if (!taskId) return undefined; const task = engine.repo.get<Task>('task', taskId); if (!task?.code || task.sessionId !== engine.sessionId) return undefined;
  const team = task.code.collaboration; const member = task.owner === agentId || task.code.reviewers.includes(agentId); const round = task.code.rounds.at(-1);
  const role = !member ? 'unassigned' : team && task.code.phase === 'investigate' ? 'investigator' : team && task.code.phase === 'discuss' ? 'discussant' : team && task.code.phase === 'plan' ? task.owner === agentId ? 'planner' : 'unassigned' : task.code.phase === 'review' && round?.assignments?.[agentId] ? 'reviewer' : task.owner === agentId ? 'editor' : team && task.code.phase === 'implement' ? 'collaborator' : 'reviewer';
  return { taskId, role, phase: task.code.phase, fileRelevance: task.code.judgment ? { backend: task.code.judgment.backend, remainingRequests: task.code.judgment.maxFileRequests - (task.code.judgmentCalls ?? 0), instruction: 'After listing/searching, project_relevance can advise on candidates. Read originals before findings/review; all candidates remain accessible.' } : 'disabled', checks: task.code.checks.map(c => c.name), changedFiles: Object.keys(task.code.baseFiles), reviewRevision: round?.revision, reviewFiles: round?.assignments?.[agentId], instruction: 'Use project_* tools for this work item. Independent perspectives, shared findings, explicit file claims and concrete peer questions guide collaboration. Runtime routes stages and reviews; do not create duplicate tasks, poll or send acknowledgement chains. For project_review use the full reviewRevision, not a file hash, proposal ID or round label. End after recording the verdict.' };
}
export function workBoard(engine: Engine): string[] {
  return engine.repo.list<Task>('task', engine.sessionId).filter(t => t.code).slice(-6).flatMap(task => {
    const code = task.code!; const name = engine.agents().find(a => a.id === task.owner)?.name ?? 'unassigned';
    const checks = code.checks.map(c => { const r = code.runs.findLast(r => r.name === c.name); return `${c.name}: ${!r ? 'not run' : r.exitCode === 0 ? 'passed' : 'failed'}`; }).join(' · ');
    const round = code.rounds.at(-1); const reviews = `${round?.reviews.length ?? 0}/${round?.assignments ? Object.keys(round.assignments).length : code.reviewers.length}`; const team = code.collaboration;
    return [`${task.id.slice(0, 8)} · ${task.title}`, `Editor ${name} · ${task.state === 'done' ? code.phase === 'integrated' ? 'integrated' : 'ready to integrate' : code.phase} · reviews ${reviews}`, checks, ...(team ? [`Team: findings ${team.findings.length}/${team.members.length} · discussion ${team.discussion.length}/${team.members.length} · ready ${team.ready.length}/${team.members.length} · proposals ${team.contributions.filter(c => c.state === 'applied').length}/${team.contributions.length}`, ...(Object.entries(team.reminders ?? {}).some(([token, count]) => token.startsWith(team.generation + ':' + code.phase + (code.phase === 'review' ? ':' + round?.revision : '') + ':') && count > 2) ? ['Blocked: collaboration stage needs human attention after bounded continuation attempts.'] : []), ...(team.plan ? ['Plan: ' + team.plan.summary, ...Object.entries(team.claims).map(([path, owner]) => `${engine.agents().find(a => a.id === owner)?.name ?? owner}: ${path}`)] : []), ...team.questions.filter(q => !q.answer).map(q => `Blocked: ${engine.agents().find(a => a.id === q.to)?.name ?? q.to} owes answer: ${q.question}`)] : []), ...(task.state === 'done' && code.phase !== 'integrated' ? [`/work-diff ${task.id} · /integrate ${task.id}`] : [])];
  });
}
export function installCodeTools(registry: ToolRegistry): void {
  installCollaborationTools(registry);
  const str = Type.String({ minLength: 1, maxLength: 1000 }); const task = { taskId: str };
  registry.register('project_list', 'List files/directories in your assigned worktree. Hidden, sensitive and dependency paths are excluded.', Type.Object({ ...task, path: Type.Optional(Type.String({ maxLength: 1000 })) }), 'collaborate', (a, { agent }) => listCodeFiles(registry.engine, a.taskId, agent.id, a.path));
  registry.register('project_search', 'Bounded literal search in tracked/candidate project text. Search before opening many files.', Type.Object({ ...task, query: Type.String({ minLength: 1, maxLength: 200 }) }), 'collaborate', (a, { agent }) => searchCode(registry.engine, a.taskId, agent.id, a.query));
  registry.register('project_relevance', 'Optional advisory ranking of up to 20 candidate files from bounded excerpts. Human-enabled backend only; all candidates stay accessible. Search/list first, inspect originals, and do not treat ranking as reading evidence or a review verdict.', Type.Object({ ...task, paths: Type.Array(str, { minItems: 1, maxItems: 20 }), query: Type.Optional(Type.String({ maxLength: 1000 })) }), 'collaborate', (a, { agent, signal }) => rankCodeFiles(registry.engine, a.taskId, agent.id, { paths: a.paths, query: a.query }, signal));
  registry.register('project_read', 'Read a file in your assigned isolated worktree. Reviewers must read changed files before reviewing.', Type.Object({ ...task, path: str }), 'collaborate', (a, { agent }) => readCodeFile(registry.engine, a.taskId, agent.id, a.path));
  registry.register('project_write', 'Editor-only guarded text edit in the assigned worktree. Read for SHA-256 first; use expectedHash:new for a new file. Never edit tests to hide failures.', Type.Object({ ...task, path: str, content: Type.String({ maxLength: 64000 }), expectedHash: str }), 'collaborate', (a, { agent, signal }) => writeCodeFile(registry.engine, a.taskId, agent.id, a.path, a.content, a.expectedHash, signal));
  registry.register('project_check', 'Run one human-approved named check in the assigned worktree. Read exitCode and repair failures; commands cannot be changed by the model.', Type.Object({ ...task, name: str }), 'collaborate', (a, { agent, signal }) => checkCodeWork(registry.engine, a.taskId, agent.id, a.name, signal));
  registry.register('project_request_review', 'After checks pass, request a bounded, revision-bound review round. Runtime routes and batches peers; end your response afterwards.', Type.Object({ ...task, summary: str }), 'collaborate', (a, { agent }) => requestCodeReview(registry.engine, a.taskId, agent.id, a.summary));
  registry.register('project_review', 'Assigned reviewer only: submit one verdict after reading every changed file. Runtime wakes the editor after all reviews. End your response afterwards.', Type.Object({ ...task, revision: str, verdict: Type.Union([Type.Literal('accept'), Type.Literal('changes')]), findings: str }), 'collaborate', (a, { agent }) => submitCodeReview(registry.engine, a.taskId, agent.id, a.revision, a.verdict, a.findings));
  registry.register('project_finish', 'Editor only: complete the current checked, reviewed revision. Leaves a guarded proposal for human integration; end your response.', Type.Object({ ...task, findings: str }), 'collaborate', (a, { agent }) => finishCodeWork(registry.engine, a.taskId, agent.id, a.findings));
}
