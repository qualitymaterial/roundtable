import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine, type AdapterFactory } from '../src/engine.js';
import { Repository } from '../src/storage.js';
import { id, type AgentAdapter, type AgentRecord } from '../src/domain.js';
export const noop: AgentAdapter = { prompt: async () => {}, abort: async () => {}, dispose: () => {} };
export function fixture(factory: AdapterFactory = async () => noop, limits: Parameters<typeof Engine.create>[3] = {}) {
  const home = mkdtempSync(join(tmpdir(), 'roundtable-test-'));
  const repo = new Repository(join(home, 'test.db'));
  const session = Engine.create(repo, join(home, 'workspaces'), 'Test independent collaboration', limits);
  const engine = new Engine(repo, session.id, factory);
  return { home, repo, engine, session, async close() { await engine.close(); repo.close(); rmSync(home, { recursive: true, force: true }); } };
}
export async function agent(engine: Engine, name = 'Participant'): Promise<AgentRecord> { return engine.addAgent({ name, provider: 'test', model: name }, false); }
export async function tool<T = unknown>(engine: Engine, actor: AgentRecord, name: string, args: unknown = {}): Promise<{ ok: boolean; data: T }> { return await engine.tools.execute(actor, name, args, id()) as { ok: boolean; data: T }; }
