import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { KnowledgeStore } from '../src/knowledge.js';
import { fixture } from './helpers.js';
import { Workflow, workflows, loadWorkflow } from '../src/workflows.js';

test('curated memory is scoped, expires, survives reopening and deletes without exposing content in audit', async () => {
  const f = fixture();
  try {
    let now = Date.now(); const store = new KnowledgeStore(f.repo, f.home, () => now);
    const entry = store.remember('Project preference: preserve source evidence.', f.session.id, 1);
    assert.equal(new KnowledgeStore(f.repo, f.home).search('source')[0]?.id, entry.id);
    const other = join(f.home, 'another-project'); mkdirSync(other);
    const different = new KnowledgeStore(f.repo, other); assert.equal(different.search().length, 0); assert.throws(() => different.read(entry.id), /another project/);
    assert.ok(!JSON.stringify(f.repo.events(f.session.id)).includes('Project preference'));
    now += 86400001; assert.equal(store.search().length, 0); assert.throws(() => store.read(entry.id), /expired/);
    store.forget(entry.id); assert.equal(f.repo.get('knowledge', entry.id), undefined);
    assert.throws(() => store.remember(' ', f.session.id));
  } finally { await f.close(); }
});

test('workflow recipes validate without executable hooks or implicit permissions', () => {
  assert.equal(workflows().length, 4);
  const recipe = loadWorkflow('research'); assert.equal(recipe.version, 1);
  assert.throws(() => Workflow.parse({ ...recipe, permissions: ['host.execute'] }));
  assert.throws(() => Workflow.parse({ ...recipe, hook: 'arbitrary command' }));
  assert.throws(() => Workflow.parse({ ...recipe, version: 2 }));
});
