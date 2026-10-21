import type { Engine } from './engine.js';
import type { Task } from './domain.js';
import { taskValidation } from './recovery.js';
import { assertCodeComplete } from './code-work.js';

export function taskEvidenceStatus(engine: Engine, task: Task, visited = new Set<string>()): { passed: boolean; detail: string } {
  try {
    if (task.sessionId !== engine.sessionId || visited.has(task.id)) return { passed: false, detail: 'Invalid session task or dependency cycle' };
    const path = new Set([...visited, task.id]);
    for (const dependencyId of task.dependencies) {
      const dependency = engine.repo.get<Task>('task', dependencyId);
      if (!dependency || dependency.state !== 'done' || !taskEvidenceStatus(engine, dependency, path).passed) return { passed: false, detail: 'Dependency lacks current completion evidence: ' + dependencyId };
    }
    const artifacts = taskValidation(engine, task.id);
    const contracts = engine.web.verification.contracts(task.id);
    if (artifacts.some(c => !c.passed)) return { passed: false, detail: 'Required independent artifact validation has not passed' };
    for (const c of contracts) { const status = engine.web.verification.status(c.id); if (!status.passed) return { passed: false, detail: c.description + ': ' + status.detail }; }
    if (task.code) { assertCodeComplete(engine, task); return { passed: true, detail: 'Current code revision passed required checks and author-excluding reviews' }; }
    if (artifacts.length || contracts.length) return { passed: true, detail: 'Protected acceptance checks passed; only their stated scope is verified' };
    return { passed: false, detail: 'Agent findings are not completion evidence. The human must establish /require-check or /require-evidence criteria, or use checked project work' };
  } catch { return { passed: false, detail: 'Current required checks or evidence could not be validated' }; }
}
export function assertTaskEvidence(engine: Engine, task: Task): void {
  const status = taskEvidenceStatus(engine, task); if (!status.passed) throw new Error(status.detail);
}
