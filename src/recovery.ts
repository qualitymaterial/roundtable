import { runSandbox, type SandboxGrant } from './sandbox.js';
import { artifactBytes } from './artifacts.js';
import { z } from 'zod';
import { Type } from 'typebox';
import { id, timestamp, redact, type Task, type Artifact } from './domain.js';
import type { Engine } from './engine.js';
import type { ToolRegistry } from './tools.js';
import { SQLiteArtifactStore } from './artifacts.js';

export const ContractInput = z.object({ taskId: z.string(), artifactName: z.string().min(1).max(200), description: z.string().min(1).max(1000), validator: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('json'), required: z.array(z.string().min(1).max(200)).max(100), equals: z.record(z.string(), z.unknown()).default({}) }).strict(),
  z.object({ kind: z.literal('text'), includes: z.array(z.string().min(1).max(2000)).min(1).max(100) }).strict(),
  z.object({ kind: z.literal('command'), grantId: z.string(), argv: z.array(z.string().min(1).max(16000)).min(1).max(64) }).strict(),
  z.object({ kind: z.literal('sha256'), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]) }).strict();
export type Contract = z.output<typeof ContractInput> & { id: string; sessionId: string; active: boolean; createdAt: string };
type Validation = { id: string; sessionId: string; contractId: string; artifactId: string; hash: string; reviewer: string; passed: boolean; detail: string; createdAt: string };
export function requireValidation(engine: Engine, input: unknown): Contract {
  const data = ContractInput.parse(input); const task = engine.repo.get<Task>('task', data.taskId);
  if (!task || task.sessionId !== engine.sessionId || ['done', 'cancelled'].includes(task.state)) throw new Error('Choose an unfinished session task');
  const record = { ...data, id: id(), sessionId: engine.sessionId, active: true, createdAt: timestamp() };
  engine.repo.put('contract', record); engine.repo.event(engine.sessionId, 'human_validation_required', record); return record;
}
export function taskValidation(engine: Engine, taskId: string) {
  return engine.repo.list<Contract>('contract', engine.sessionId).filter(c => c.active && c.taskId === taskId).map(contract => {
    const artifact = engine.repo.list<Artifact>('artifact', engine.sessionId).filter(a => a.name === contract.artifactName).at(-1);
    const check = engine.repo.list<Validation>('validation', engine.sessionId).filter(v => v.contractId === contract.id && v.artifactId === artifact?.id && v.hash === artifact.hash).at(-1);
    return { contract, artifactId: artifact?.id, passed: check?.passed === true, detail: check?.detail ?? 'Publish the named artifact and run its independent check.' };
  });
}
export async function validateContract(engine: Engine, contractId: string, artifactId: string, reviewer: string, signal = new AbortController().signal): Promise<Validation> {
  const contract = engine.repo.get<Contract>('contract', contractId);
  if (!contract?.active || contract.sessionId !== engine.sessionId) throw new Error('Unknown active validation contract');
  const artifact = new SQLiteArtifactStore(engine.repo).read(engine.sessionId, artifactId);
  if (artifact.name !== contract.artifactName) throw new Error('Artifact name does not match contract');
  if (artifact.author === reviewer) throw new Error('A different participant or human must run validation');
  let passed = false; let detail = '';
  try {
    const v = contract.validator;
    if (v.kind === 'command') {
      const grant = engine.repo.get<SandboxGrant>('sandbox', v.grantId); if (!grant || grant.sessionId !== engine.sessionId || (reviewer !== 'human' && grant.agentId !== reviewer)) throw new Error('Validator requires a grant for its independent reviewer');
      const name = `validation-${id()}`; const result = await runSandbox(engine, grant.agentId, grant.id, v.argv.map(a => a.replaceAll('{artifact}', '/work/' + name)), signal, { name, data: artifactBytes(artifact) });
      passed = result.exitCode === 0;
    } else if (v.kind === 'sha256') passed = artifact.hash === v.hash;
    else {
      if (artifact.encoding === 'base64') throw new Error('Text validator cannot read a binary artifact');
      if (v.kind === 'text') passed = v.includes.every(part => artifact.content.includes(part));
      else { const parsed: unknown = JSON.parse(artifact.content); passed = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && v.required.every(k => Object.hasOwn(parsed, k)) && Object.entries(v.equals).every(([k, value]) => JSON.stringify((parsed as Record<string, unknown>)[k]) === JSON.stringify(value)); }
    }
    detail = passed ? 'Required deterministic check passed for this exact artifact hash.' : 'Artifact does not satisfy the required check.';
  } catch (error) { detail = redact(String(error)); }
  const result = { id: id(), sessionId: engine.sessionId, contractId, artifactId, hash: artifact.hash, reviewer, passed, detail, createdAt: timestamp() };
  engine.repo.put('validation', result); engine.repo.event(engine.sessionId, 'required_validation_result', result); return result;
}
export function recoveryReport(engine: Engine, staleMs = 15 * 60 * 1000, now = Date.now()) {
  const tasks = engine.repo.list<Task>('task', engine.sessionId);
  return tasks.flatMap(task => {
    if (['done', 'cancelled'].includes(task.state)) return [];
    const issues: string[] = [];
    if (task.state === 'claimed') {
      const owner = engine.agents().find(a => a.id === task.owner);
      if (!owner || owner.state !== 'active') issues.push(`Owner ${owner?.state ?? 'missing'}`);
      if (now - Date.parse(task.updatedAt ?? engine.session().createdAt) >= staleMs) issues.push('No task progress within the stale threshold');
    }
    for (const key of task.dependencies) { const dep = tasks.find(t => t.id === key); if (!dep || dep.state === 'cancelled') issues.push(`Unavailable dependency: ${key}`); }
    return issues.length ? [{ taskId: task.id, title: task.title, issues }] : [];
  });
}
export function repairTask(engine: Engine, taskId: string, action: 'release' | 'reopen' | 'cancel' | 'dependencies', reason: string, dependencies: string[] = []): Task {
  if (engine.session().state !== 'paused' || (engine.status() as { running: number }).running) throw new Error('Pause and wait for running work before repairing tasks');
  if (!reason.trim() || reason.length > 2000) throw new Error('A repair reason is required (up to 2000 characters)');
  const task = engine.repo.get<Task>('task', taskId); if (!task || task.sessionId !== engine.sessionId) throw new Error('Unknown session task');
  if (action === 'dependencies') {
    const visit = (key: string, path: Set<string>) => { if (key === taskId || path.has(key)) throw new Error('Dependency cycle'); const dep = engine.repo.get<Task>('task', key); if (!dep || dep.sessionId !== engine.sessionId) throw new Error('Unknown dependency'); for (const next of dep.dependencies) visit(next, new Set([...path, key])); };
    if (dependencies.length > 20 || new Set(dependencies).size !== dependencies.length) throw new Error('Use up to 20 unique dependencies');
    dependencies.forEach(d => visit(d, new Set())); task.dependencies = dependencies;
  } else { task.state = action === 'cancel' ? 'cancelled' : 'open'; delete task.owner; }
  task.updatedAt = timestamp(); engine.repo.put('task', task); engine.repo.event(engine.sessionId, 'human_task_repair', { taskId, action, reason: redact(reason), dependencies }); return task;
}
export function installRecoveryTools(registry: ToolRegistry): void {
  registry.register('roundtable_task_requirements', 'Inspect required independent artifact checks for a task.', Type.Object({ taskId: Type.String() }), 'collaborate', ({ taskId }) => taskValidation(registry.engine, taskId));
  registry.register('roundtable_validation_run', 'Run a human-required deterministic check against an exact artifact hash. The author cannot validate their own artifact.', Type.Object({ contractId: Type.String(), artifactId: Type.String() }), 'artifact', (args, { agent, signal }) => validateContract(registry.engine, args.contractId, args.artifactId, agent.id, signal));
}
