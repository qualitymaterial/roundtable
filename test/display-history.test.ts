import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, agent } from './helpers.js';

test('intermediate display metadata never removes narration from persisted history', async () => {
  const f = fixture();
  try {
    const a = await agent(f.engine); const events: { intermediate?: boolean }[] = [];
    f.engine.on('activity', event => events.push(event));
    f.engine.assistant(a, 'Inspecting evidence', true);
    f.engine.assistant(a, 'Verified finding');
    assert.equal(events[0]?.intermediate, true); assert.equal(events[1]?.intermediate, false);
    assert.deepEqual(f.repo.messages(f.session.id).map(m => m.body), ['Inspecting evidence', 'Verified finding']);
  } finally { await f.close(); }
});
