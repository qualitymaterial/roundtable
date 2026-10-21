import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Type } from 'typebox';
import type { Engine } from './engine.js';
import { id, redact, type Task } from './domain.js';
import { codeTask, codeActor, writeCodeFile } from './code-work.js';
import { workspacePath, type ToolRegistry } from './tools.js';

type Finding = { agentId: string; files: string[]; findings: string; approach: string };
type Discussion = { agentId: string; response: string; buildsOn: string[] };
type Assignment = { agentId: string; paths: string[]; brief: string };
type Contribution = { id: string; agentId: string; path: string; expectedHash: string; content: string; summary: string; state: 'pending' | 'applying' | 'applied' | 'rejected'; inspected?: boolean; resolution?: string };
export type CodeCollaboration = {
  members: string[]; reads: Record<string, string[]>; findings: Finding[]; discussion: Discussion[];
  plan?: { summary: string; assignments: Assignment[] }; claims: Record<string, string>; ready: string[];
  questions: { id: string; from: string; to: string; question: string; answer?: string }[];
  contributions: Contribution[]; authors: Record<string, string[]>; generation: number; reminders?: Record<string, number>;
};
const key = (path: string) => path.replaceAll('\\', '/').toLowerCase();
function context(engine: Engine, taskId: string, agentId: string, phases?: string[]) {
  const task = codeActor(engine, taskId, agentId); const team = task.code.collaboration;
  if (!team?.members.includes(agentId)) throw new Error('Not a member of this collaborative work item');
  if (phases && (!phases.includes(task.code.phase) || task.state !== 'claimed')) throw new Error('This collaboration action is not available in the current phase');
  if (phases && Date.parse(task.code.expiresAt) <= Date.now()) throw new Error('Work lease expired');
  return { task, team };
}
function save(engine: Engine, task: Task, type: string, data: object) { engine.repo.put('task', task); engine.repo.event(engine.sessionId, type, { taskId: task.id, ...data }); }
function wake(engine: Engine, taskId: string, agentId: string, token: string, body: string) { engine.notify(agentId, `collaboration:${taskId}:${token}`, body, taskId); }
const label = (engine: Engine, agentId: string) => engine.agents().find(a => a.id === agentId)?.name ?? agentId;
export function newCollaboration(members: string[]): CodeCollaboration { return { members, reads: {}, findings: [], discussion: [], claims: {}, ready: [], questions: [], contributions: [], authors: {}, generation: 0 }; }
export function recordInvestigationRead(engine: Engine, taskId: string, agentId: string, path: string) {
  const task = codeTask(engine, taskId); const team = task.code.collaboration;
  if (team && task.code.phase === 'investigate') { team.reads[agentId] = [...new Set([...(team.reads[agentId] ?? []), path])]; engine.repo.put('task', task); }
}
export function submitFindings(engine: Engine, taskId: string, agentId: string, files: string[], findings: string, approach: string) {
  const { task, team } = context(engine, taskId, agentId, ['investigate']);
  if (!files.length || files.some(p => !team.reads[agentId]?.includes(p))) throw new Error('Read and cite actual project files before submitting findings');
  if (team.findings.some(f => f.agentId === agentId)) throw new Error('Investigation already submitted');
  team.findings.push({ agentId, files, findings: redact(findings), approach: redact(approach) });
  const complete = team.members.every(m => team.findings.some(f => f.agentId === m));
  if (complete) task.code.phase = 'discuss';
  save(engine, task, 'code_investigation_submitted', { agentId, files, findings: redact(findings), approach: redact(approach) }); engine.waitForHuman(agentId);
  if (complete) for (const member of team.members) wake(engine, taskId, member, 'discuss', `Independent investigations for ${taskId}:\n${team.findings.map(f => `${label(engine, f.agentId)} (${f.agentId}) read ${f.files.join(', ')}: ${f.findings}\nProposed approach: ${f.approach}`).join('\n\n')}\nDiscuss these findings with project_discuss. Reference at least one peer by buildsOn agent ID, explain what you adopt or challenge, and identify how it changes the approach. No edits yet. End after submitting.`);
  return { submitted: true, complete, instruction: 'End this turn. Runtime will deliver the next collaboration stage.' };
}
export function discussFindings(engine: Engine, taskId: string, agentId: string, response: string, buildsOn: string[]) {
  const { task, team } = context(engine, taskId, agentId, ['discuss']);
  if (!buildsOn.length || buildsOn.some(m => m === agentId || !team.members.includes(m))) throw new Error('Respond to at least one other investigator by agent ID');
  if (team.discussion.some(d => d.agentId === agentId)) throw new Error('Discussion already submitted');
  team.discussion.push({ agentId, response: redact(response), buildsOn: [...new Set(buildsOn)] });
  const complete = team.members.every(m => team.discussion.some(d => d.agentId === m)); if (complete) task.code.phase = 'plan';
  save(engine, task, 'code_discussion_submitted', { agentId, response: redact(response), buildsOn }); engine.waitForHuman(agentId);
  if (complete) wake(engine, taskId, task.owner!, 'plan', `Discussion for ${taskId}:\n${team.discussion.map(d => `${label(engine, d.agentId)}: ${d.response}`).join('\n\n')}\nUse project_team to inspect all evidence. Call project_plan with a concrete synthesis and one assignment for EVERY member. Give disjoint file paths to implementers; an empty paths list may assign investigation/test-design assistance. Explain adopted and rejected suggestions and validation. All members may propose implementation edits. You coordinate integration for this item, not the project as a whole.`);
  return { submitted: true, complete, instruction: 'End this turn; the synthesized plan follows through the runtime.' };
}
export async function setCollaborativePlan(engine: Engine, taskId: string, agentId: string, summary: string, assignments: Assignment[]) {
  let { task, team } = context(engine, taskId, agentId, ['plan']);
  if (agentId !== task.owner) throw new Error('Only the assigned editor may synthesize the plan');
  if (assignments.length !== team.members.length || new Set(assignments.map(a => a.agentId)).size !== assignments.length || assignments.some(a => !team.members.includes(a.agentId))) throw new Error('Assign each member exactly once');
  const claims: Record<string, string> = {};
  for (const assignment of assignments) for (const path of assignment.paths) {
    await workspacePath(task.code.root, path);
    if (claims[key(path)]) throw new Error('Plan file ownership overlaps'); claims[key(path)] = assignment.agentId;
  }
  if (!Object.keys(claims).length) throw new Error('Plan must assign at least one implementation file');
  // Recheck after path authorization so asynchronous plans cannot overwrite newer state.
  ({ task, team } = context(engine, taskId, agentId, ['plan']));
  team.plan = { summary: redact(summary), assignments: assignments.map(a => ({ ...a, brief: redact(a.brief) })) }; team.claims = claims; task.code.phase = 'implement';
  save(engine, task, 'code_plan_agreed', { summary: redact(summary), assignments }); engine.waitForHuman(agentId);
  for (const assignment of assignments) wake(engine, taskId, assignment.agentId, 'implement', `Shared plan for ${taskId}: ${redact(summary)}\nYour scope: ${redact(assignment.brief)}; files: ${assignment.paths.join(', ') || 'investigation/help only'}.\n${assignment.agentId === task.owner ? 'Run the named baseline check before editing. Edit your assigned files, inspect peer proposals with project_team, apply or reject with project_apply_contribution. After every contributor is ready and proposals/questions resolved, run current checks and request review.' : 'Read your assigned files and propose guarded edits with project_contribute. Use project_ask/project_answer for concrete help. When your scope is complete, call project_ready and end the turn.'}\nUse project_team for identities, claims, questions and proposal IDs. Claims may be handed to another member explicitly. Peer findings may change the plan; record that in questions/answers or proposal resolutions. No readiness acknowledgements or polling.`);
  return { planned: true, instruction: 'End this turn. Runtime starts implementation with the appropriate tools.' };
}
export function teamState(engine: Engine, taskId: string, agentId: string, proposalId?: string) {
  const { task, team } = context(engine, taskId, agentId);
  if (proposalId) {
    const proposal = team.contributions.find(c => c.id === proposalId); if (!proposal) throw new Error('Unknown contribution');
    if (agentId === task.owner) { proposal.inspected = true; engine.repo.put('task', task); }
    return proposal;
  }
  const round = task.code.rounds.at(-1);
  return { members: team.members.map(m => ({ id: m, name: label(engine, m) })), phase: task.code.phase, review: round ? { revision: round.revision, assignedFiles: round.assignments?.[agentId] ?? [], submitted: round.reviews.map(r => ({ agentId: r.agentId, verdict: r.verdict, findings: r.findings })) } : undefined, findings: task.code.phase === 'investigate' ? team.findings.filter(f => f.agentId === agentId) : team.findings, discussion: team.discussion, plan: team.plan, claims: team.claims, ready: team.ready, questions: team.questions, contributions: team.contributions.map(({ content: _content, ...c }) => { void _content; return c; }) };
}
export async function claimCodeFiles(engine: Engine, taskId: string, agentId: string, paths: string[], recipientId = agentId) {
  let { task, team } = context(engine, taskId, agentId, ['implement']);
  if (!team.members.includes(recipientId)) throw new Error('Choose a current work member');
  for (const path of paths) await workspacePath(task.code.root, path);
  ({ task, team } = context(engine, taskId, agentId, ['implement']));
  for (const path of paths) {
    if (team.claims[key(path)] && team.claims[key(path)] !== agentId) throw new Error('Only the file owner may hand off its claim');
    if (team.contributions.some(c => key(c.path) === key(path) && ['pending', 'applying'].includes(c.state))) throw new Error('Resolve the pending contribution before handing off this file');
  }
  for (const path of paths) team.claims[key(path)] = recipientId;
  team.ready = team.ready.filter(m => m !== recipientId);
  save(engine, task, 'code_files_claimed', { agentId, recipientId, paths });
  if (recipientId !== agentId) wake(engine, taskId, recipientId, `handoff:${id()}`, `${label(engine, agentId)} handed you ${paths.join(', ')} in ${taskId}. Inspect project_team and complete that scope, then project_ready. Propose guarded edits if you are not the editor.`);
  return { claimed: paths, owner: recipientId };
}
export function assertFileAuthor(task: Task, path: string, author: string) {
  const team = task.code?.collaboration; if (!team) return;
  if (team.claims[key(path)] !== author) throw new Error('This file is assigned to another member or unclaimed; use project_claim_files to agree ownership first');
}
export function recordFileAuthor(task: Task, path: string, author: string) { const team = task.code?.collaboration; if (team) team.authors[key(path)] = [...new Set([...(team.authors[key(path)] ?? []), author])]; }
export async function proposeContribution(engine: Engine, taskId: string, agentId: string, path: string, expectedHash: string, content: string, summary: string) {
  let { task, team } = context(engine, taskId, agentId, ['implement']);
  if (agentId === task.owner) throw new Error('Editor uses project_write for its own claimed files');
  assertFileAuthor(task, path, agentId);
  const target = await workspacePath(task.code.root, path);
  const actual = (() => { try { return createHash('sha256').update(readFileSync(target)).digest('hex'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'new'; throw error; } })();
  if (expectedHash !== actual) throw new Error('Contribution base changed; read current content before proposing again');
  ({ task, team } = context(engine, taskId, agentId, ['implement'])); assertFileAuthor(task, path, agentId);
  if (team.contributions.length >= 30 || team.contributions.some(c => key(c.path) === key(path) && ['pending', 'applying'].includes(c.state))) throw new Error('Resolve the pending proposal for this file or ask the human after 30 contributions');
  if (content.includes('\0') || Buffer.byteLength(content) > 64000) throw new Error('Bounded text contributions only');
  const proposal: Contribution = { id: id(), agentId, path, expectedHash, content, summary: redact(summary), state: 'pending' }; team.contributions.push(proposal); team.ready = team.ready.filter(m => m !== agentId);
  save(engine, task, 'code_contribution_proposed', { proposalId: proposal.id, agentId, path, summary: proposal.summary });
  wake(engine, taskId, task.owner!, `proposal:${proposal.id}`, `${label(engine, agentId)} proposed ${path}: ${proposal.summary}. Inspect project_team with proposalId ${proposal.id}, then apply or reject. Continue your scope; check project_team before waiting.`);
  return { proposalId: proposal.id, instruction: 'Continue your scope. Call project_ready when all your proposals/findings are submitted.' };
}
export async function resolveContribution(engine: Engine, taskId: string, agentId: string, proposalId: string, decision: 'apply' | 'reject', reason: string) {
  let { task, team } = context(engine, taskId, agentId, ['implement']);
  const proposal = team.contributions.find(c => c.id === proposalId);
  if (task.owner !== agentId || !proposal || proposal.state !== 'pending' || !proposal.inspected) throw new Error('Editor must inspect a pending contribution before resolving it');
  if (decision === 'reject') {
    proposal.state = 'rejected'; proposal.resolution = redact(reason); team.ready = team.ready.filter(m => m !== proposal.agentId); save(engine, task, 'code_contribution_rejected', { proposalId, reason: redact(reason) });
    wake(engine, taskId, proposal.agentId, `rejected:${proposalId}`, `Your contribution ${proposalId} needs correction: ${redact(reason)}. Inspect current files and propose a revision, or answer the issue and mark ready. End when done.`);
  } else {
    proposal.state = 'applying'; engine.repo.put('task', task);
    try { await writeCodeFile(engine, taskId, agentId, proposal.path, proposal.content, proposal.expectedHash, undefined, proposal.agentId); }
    catch (error) { const current = codeTask(engine, taskId); const p = current.code.collaboration!.contributions.find(c => c.id === proposalId)!; p.state = 'pending'; engine.repo.put('task', current); throw error; }
    ({ task, team } = context(engine, taskId, agentId, ['implement'])); const current = team.contributions.find(c => c.id === proposalId)!; current.state = 'applied'; current.resolution = redact(reason);
    save(engine, task, 'code_contribution_applied', { proposalId, authorId: current.agentId, path: current.path, reason: redact(reason) });
  }
  return { resolved: decision, proposalId };
}
export function askCodePeer(engine: Engine, taskId: string, agentId: string, recipientId: string, question: string) {
  const { task, team } = context(engine, taskId, agentId, ['implement']);
  if (recipientId === agentId || !team.members.includes(recipientId) || team.questions.length >= 8) throw new Error('Choose a peer; at most eight concrete questions per work item');
  const request = { id: id(), from: agentId, to: recipientId, question: redact(question) }; team.questions.push(request);
  team.ready = team.ready.filter(m => m !== recipientId);
  save(engine, task, 'code_peer_question', request); engine.waitForHuman(agentId);
  wake(engine, taskId, recipientId, `question:${request.id}`, `${label(engine, agentId)} asks about ${taskId}: ${request.question}\nQuestion ID ${request.id}. Inspect evidence and answer with project_answer, then continue your assigned scope. This is substantive help, not a readiness acknowledgement.`);
  return { questionId: request.id, instruction: 'End this turn. Runtime wakes you with the answer.' };
}
export function answerCodePeer(engine: Engine, taskId: string, agentId: string, questionId: string, answer: string) {
  const { task, team } = context(engine, taskId, agentId, ['implement']); const request = team.questions.find(q => q.id === questionId);
  if (!request || request.to !== agentId || request.answer) throw new Error('This open question is not assigned to you');
  request.answer = redact(answer); save(engine, task, 'code_peer_answer', { questionId, agentId, answer: request.answer });
  wake(engine, taskId, request.from, `answer:${questionId}`, `${label(engine, agentId)} answered your question: ${request.answer}\nUse the evidence to continue the current plan or revise scope through project_claim_files. No acknowledgement needed.`);
  return { answered: true, instruction: 'Answer delivered. Continue your scope, or project_ready when complete.' };
}
export function readyCodeContributor(engine: Engine, taskId: string, agentId: string) {
  const { task, team } = context(engine, taskId, agentId, ['implement']);
  if (team.questions.some(q => q.to === agentId && !q.answer)) throw new Error('Answer your assigned open questions before marking ready');
  team.ready = [...new Set([...team.ready, agentId])]; save(engine, task, 'code_contributor_ready', { agentId }); engine.waitForHuman(agentId);
  const peersReady = team.members.filter(m => m !== task.owner).every(m => team.ready.includes(m));
  if (peersReady) wake(engine, taskId, task.owner!, `contributors-ready:${team.generation}:${id()}`, `All contributors to ${taskId} are ready. Inspect project_team, resolve remaining proposals/questions, run current checks and request review. No polling or acknowledgement messages.`);
  return { ready: true, peersReady, instruction: 'End this turn; new concrete questions or review requests can wake you.' };
}
export function collaborationReviewAssignments(task: Task, files: string[]): Record<string, string[]> | undefined {
  const team = task.code!.collaboration; if (!team) return undefined;
  if (team.members.some(m => m !== task.owner && !team.ready.includes(m)) || team.questions.some(q => !q.answer) || team.contributions.some(c => ['pending', 'applying'].includes(c.state))) throw new Error('Contributors, proposals or questions remain unresolved. Inspect project_team; use project_ready to await collaborators without polling.');
  const assignments: Record<string, string[]> = {};
  for (const path of files) {
    const authors = team.authors[key(path)] ?? [task.owner!];
    let reviewers = task.code!.reviewers.filter(m => !authors.includes(m));
    if (!reviewers.length && !authors.includes(task.owner!)) reviewers = [task.owner!];
    if (!reviewers.length) throw new Error('No independent reviewer for ' + path + '; ask the human to inspect this shared-authorship file');
    for (const reviewer of reviewers) (assignments[reviewer] ??= []).push(path);
  }
  return assignments;
}
export function reopenCollaboration(engine: Engine, task: Task, reason: string, integrated: boolean) {
  const team = task.code!.collaboration; if (!team) return;
  team.ready = []; team.generation++; if (integrated) team.authors = {};
  for (const member of team.members.filter(m => m !== task.owner)) wake(engine, task.id, member, `rework:${team.generation}`, `Rework requested for ${task.id}: ${redact(reason)}. Inspect project_team and your existing assigned files. Offer concrete findings or corrective contributions, answer questions, then project_ready. Prior evidence stays preserved.`);
}
/** Continue an authorized stage after prose/length termination without its required submission. */
export function ensureCollaborationProgress(engine: Engine, taskId: string, agentId: string) {
  const task = codeTask(engine, taskId); const team = task.code.collaboration;
  if (!team?.members.includes(agentId) || task.state !== 'claimed' || engine.session().state !== 'active' || engine.waiting(agentId) || (engine.toolBlockReason(agentId) && !engine.waitingForPeers(agentId)) || Date.parse(task.code.expiresAt) <= Date.now()) return;
  // Implementation waits may depend on other contributors. Assigned reviews already have their inputs.
  const assignedQuestion = team.questions.find(q => q.to === agentId && !q.answer);
  if (engine.waitingForPeers(agentId) && task.code.phase === 'implement' && !assignedQuestion) return;
  let action: string | undefined;
  if (task.code.phase === 'investigate' && !team.findings.some(f => f.agentId === agentId)) action = 'project_findings with files you already read, concise findings and a proposed approach';
  if (task.code.phase === 'discuss' && !team.discussion.some(d => d.agentId === agentId)) action = 'project_discuss with a concise response and peer buildsOn agent IDs from project_team';
  if (task.code.phase === 'plan' && task.owner === agentId && !team.plan) action = 'project_plan with the synthesis and one disjoint assignment per member';
  if (task.code.phase === 'implement' && !team.ready.includes(agentId) && !team.questions.some(q => q.from === agentId && !q.answer)) action = agentId === task.owner ? 'continue your scoped implementation, inspect/apply peer proposals, then run checks and project_request_review; use project_ready to wait for contributors' : 'finish your scoped contribution or concrete help, then project_ready';
  if (task.code.phase === 'implement' && assignedQuestion) action = `complete the concrete request in question ${assignedQuestion.id}, submit any promised guarded contribution, then project_answer and project_ready; the earlier ready flag does not answer this new question`;
  if (task.code.phase === 'ready' && task.owner === agentId) action = 'project_finish after the accepted checks and reviews';
  const round = task.code.rounds.at(-1);
  if (task.code.phase === 'review' && round?.assignments?.[agentId] && !round.reviews.some(r => r.agentId === agentId)) action = `read your assigned review files if not already read (${round.assignments[agentId]!.join(', ')}), then project_review with revision ${round.revision}, verdict accept or changes and concrete findings; prose alone does not record a verdict`;
  if (!action) return;
  const phase = task.code.phase === 'review' ? `review:${round!.revision}` : task.code.phase;
  const token = `${team.generation}:${phase}:${agentId}`; const attempts = (team.reminders ??= {})[token] ?? 0;
  if (attempts >= 2) {
    if (attempts === 2) { team.reminders[token] = 3; save(engine, task, 'code_collaboration_blocked', { agentId, phase: task.code.phase, reason: 'Two bounded continuation attempts ended without the required stage submission' }); }
    return;
  }
  team.reminders[token] = attempts + 1; save(engine, task, 'code_stage_reminder', { agentId, phase: task.code.phase, attempt: attempts + 1 });
  wake(engine, taskId, agentId, `continue:${token}:${attempts + 1}`, `Continue the existing authorized work item ${taskId}. Your last response ended before its required stage action was recorded. Next: ${action}. Use concise evidence and the structured tool; further narrative alone does not advance the team. If a human decision is required, state the concrete blocker and wait for the human. This is bounded continuation ${attempts + 1}/2, not a new objective.`);
}
export function collaborationTools(role?: string): string[] | undefined {
  if (!role) return undefined;
  const read = ['project_list', 'project_search', 'project_read', 'project_relevance', 'project_team', 'roundtable_skills_list', 'roundtable_skill_read', 'roundtable_skill_file', 'roundtable_wait'];
  const assist = ['project_claim_files', 'project_ask', 'project_answer', 'project_contribute', 'project_ready'];
  if (role === 'investigator') return [...read, 'project_findings'];
  if (role === 'discussant') return [...read, 'project_discuss'];
  if (role === 'planner') return [...read, 'project_plan'];
  if (role === 'collaborator') return [...read, ...assist];
  if (role === 'editor') return [...read, ...assist, 'project_write', 'project_check', 'project_request_review', 'project_finish', 'project_apply_contribution'];
  if (role === 'reviewer') return [...read, 'project_review'];
  return ['roundtable_wait'];
}
/** Human-readable evidence, including during pause; no model turn or file access. */
export function collaborationView(engine: Engine, taskId: string): string[] {
  const task = codeTask(engine, taskId); const team = task.code.collaboration;
  if (!team) return ['This item uses direct editor/reviewer delivery. Choose Collaborative team for joint investigation and implementation.'];
  return [task.title, 'Phase: ' + task.code.phase,
    ...(task.code.judgment ? [`File relevance advice: ${task.code.judgment.backend} / ${task.code.judgment.model}; ${task.code.judgmentCalls ?? 0}/${task.code.judgment.maxFileRequests} file requests reserved. Scores are advisory; original files remain available.`] : ['File relevance advice: disabled']),
    ...team.findings.flatMap(f => [`Investigation · ${label(engine, f.agentId)} · ${f.files.join(', ')}`, f.findings, 'Approach: ' + f.approach]),
    ...team.discussion.flatMap(d => [`Discussion · ${label(engine, d.agentId)} · responds to ${d.buildsOn.map(m => label(engine, m)).join(', ')}`, d.response]),
    ...(team.plan ? ['Shared plan', team.plan.summary, ...team.plan.assignments.map(a => `${label(engine, a.agentId)}: ${a.brief}`)] : ['Waiting for the remaining perspectives before planning.']),
    ...team.questions.flatMap(q => [`${label(engine, q.from)} → ${label(engine, q.to)}: ${q.question}`, q.answer ? 'Answer: ' + q.answer : 'Awaiting answer']),
    ...team.contributions.flatMap(c => [`${label(engine, c.agentId)} · ${c.path} · ${c.state}: ${c.summary}`, ...(c.resolution ? ['Decision: ' + c.resolution] : [])])];
}
export function installCollaborationTools(registry: ToolRegistry) {
  const text = Type.String({ minLength: 1, maxLength: 4000 }); const short = Type.String({ minLength: 1, maxLength: 1000 }); const base = { taskId: short };
  const paths = Type.Array(short, { minItems: 1, maxItems: 30 }); const people = Type.Array(short, { minItems: 1, maxItems: 4 });
  registry.register('project_team', 'Read team investigations, discussion, agreed plan, claims, questions and proposals. Use proposalId to inspect full content before applying.', Type.Object({ ...base, proposalId: Type.Optional(short) }), 'collaborate', (a, { agent }) => teamState(registry.engine, a.taskId, agent.id, a.proposalId));
  registry.register('project_findings', 'Submit one independent, file-grounded investigation and proposed approach. Read cited files first; end after submitting.', Type.Object({ ...base, files: paths, findings: text, approach: text }), 'collaborate', (a, { agent }) => submitFindings(registry.engine, a.taskId, agent.id, a.files, a.findings, a.approach));
  registry.register('project_discuss', 'Adopt or challenge peer findings; explain the effect on the plan. buildsOn contains peer agent IDs. End after submitting.', Type.Object({ ...base, response: text, buildsOn: people }), 'collaborate', (a, { agent }) => discussFindings(registry.engine, a.taskId, agent.id, a.response, a.buildsOn));
  registry.register('project_plan', 'Synthesize all perspectives and assign each member a brief and disjoint file paths. Empty paths assigns investigation/help. End after planning.', Type.Object({ ...base, summary: text, assignments: Type.Array(Type.Object({ agentId: short, paths: Type.Array(short, { maxItems: 30 }), brief: text }), { minItems: 2, maxItems: 5 }) }), 'collaborate', (a, { agent }) => setCollaborativePlan(registry.engine, a.taskId, agent.id, a.summary, a.assignments));
  registry.register('project_claim_files', 'Claim unassigned paths, or explicitly hand your own claims to a peer with recipientId. Existing pending contributions must be resolved first.', Type.Object({ ...base, paths, recipientId: Type.Optional(short) }), 'collaborate', (a, { agent }) => claimCodeFiles(registry.engine, a.taskId, agent.id, a.paths, a.recipientId));
  registry.register('project_contribute', 'Propose a guarded edit for your claimed file. This does not write the tree. Editor inspects/applies; continue your scope and mark ready when finished.', Type.Object({ ...base, path: short, expectedHash: short, content: Type.String({ maxLength: 64000 }), summary: text }), 'collaborate', (a, { agent }) => proposeContribution(registry.engine, a.taskId, agent.id, a.path, a.expectedHash, a.content, a.summary));
  registry.register('project_apply_contribution', 'Editor only: apply or reject an inspected peer proposal with a concrete reason. Hash conflicts refuse stale content; passing checks must be rerun.', Type.Object({ ...base, proposalId: short, decision: Type.Union([Type.Literal('apply'), Type.Literal('reject')]), reason: text }), 'collaborate', (a, { agent }) => resolveContribution(registry.engine, a.taskId, agent.id, a.proposalId, a.decision, a.reason));
  registry.register('project_ask', 'Ask one concrete implementation question to a team member. At most eight questions; end this turn and wait for the runtime-delivered answer.', Type.Object({ ...base, recipientId: short, question: text }), 'collaborate', (a, { agent }) => askCodePeer(registry.engine, a.taskId, agent.id, a.recipientId, a.question));
  registry.register('project_answer', 'Answer a concrete question assigned to you with evidence; then continue your own scope. No acknowledgement needed.', Type.Object({ ...base, questionId: short, answer: text }), 'collaborate', (a, { agent }) => answerCodePeer(registry.engine, a.taskId, agent.id, a.questionId, a.answer));
  registry.register('project_ready', 'Finish your implementation/help scope and end this turn. Runtime wakes the editor when contributors are ready; concrete questions/reviews can wake you.', Type.Object(base), 'collaborate', (a, { agent }) => readyCodeContributor(registry.engine, a.taskId, agent.id));
}
