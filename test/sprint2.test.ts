import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { fixture, agent, tool } from './helpers.js';
import { KnowledgeStore } from '../src/knowledge.js';
import { Skills } from '../src/skills.js';
import { markdownLines } from '../src/ui/markdown.js';
import { unifiedDiff } from '../src/diff.js';
import { PresentationController } from '../src/ui/controller.js';
import { validateStages, stageReady, advanceStage } from '../src/policy.js';
import { ResearchService, saveResearch } from '../src/research.js';
import { compareSessions } from '../src/evaluation.js';
import { Engine } from '../src/engine.js';

test('Markdown keeps code literal, strips controls and shows links; diff contains removed and added lines', () => {
  const lines = markdownLines('# Heading\n```diff\n-old\n+new\n```\n\u001b[2J[link](https://example.test)');
  assert.equal(lines[0]?.kind, 'heading'); assert.equal(lines[2]?.kind, 'remove'); assert.equal(lines[3]?.kind, 'add');
  assert.ok(lines.every(l => !l.text.includes('\u001b')));
  const diff = unifiedDiff('a.txt', 'same\nold\ntail', 'same\nnew\ntail').join('\n'); assert.match(diff, /-old\n\+new/); assert.match(diff, /@@/);
});
test('inline validation preserves the invalid field and accepts a correction without restarting the dialog', async () => {
  const c = new PresentationController(); const answer = c.askValidated('Count', v => Number(v) > 0 ? undefined : 'Enter a positive number');
  c.paste('0'); c.key('', { return: true }); assert.equal(c.snapshot().composer.notice, 'Enter a positive number'); assert.equal(c.snapshot().composer.text, '0');
  c.key('u', { ctrl: true }); c.paste('3'); c.key('', { return: true }); assert.equal(await answer, '3'); c.close();
});
test('FTS searches rank token prefixes and respect session/project/expiry and deletion', async () => {
  const f = fixture(); try {
    const a = await agent(f.engine); await tool(f.engine, a, 'roundtable_memory_write', { text: 'Persistent memory indexing and recovery' });
    const result = await tool<unknown[]>(f.engine, a, 'roundtable_memory_search', { query: 'persist recov' }); assert.equal(result.data.length, 1);
    assert.equal(f.repo.search('note', 'another-session', 'memory').length, 0);
    const k = new KnowledgeStore(f.repo, f.session.workspace); const note = k.remember('Durable artifact provenance', f.session.id); assert.equal(k.search('art prov').length, 1); k.forget(note.id); assert.equal(k.search('provenance').length, 0);
    assert.deepEqual(f.repo.search('note', f.session.id, '" OR *'), []);
  } finally { await f.close(); }
});
test('reviewed skill packages retain references and licenses, detect tampering and never run during installation', async () => {
  const f = fixture(); try {
    const root = join(f.home, 'candidate'); mkdirSync(root); mkdirSync(join(root, 'scripts'));
    writeFileSync(join(root, 'SKILL.md'), '---\nname: sample\ndescription: Test package\n---\nRead LICENSE and scripts/check.py.'); writeFileSync(join(root, 'LICENSE'), 'MIT fixture'); writeFileSync(join(root, 'scripts/check.py'), 'print("explicit execution only")');
    const skills = new Skills(f.home); const candidate = skills.packageCandidate(join(root, 'SKILL.md')); skills.save(candidate);
    assert.equal(skills.file('sample', 'LICENSE').content, 'MIT fixture'); const staged = skills.stage('sample', f.session.workspace); assert.match(readFileSync(join(staged, 'scripts/check.py'), 'utf8'), /explicit execution/);
    assert.throws(() => skills.file('sample', '../auth.json'), /Unknown/);
    candidate.files![0]!.data = Buffer.from('changed').toString('base64'); skills.save(candidate); assert.throws(() => skills.file('sample', candidate.files![0]!.path), /integrity/);
  } finally { await f.close(); }
});
test('workflow graph rejects cycles and stage approval enforces required work and dependency order', async () => {
  assert.throws(() => validateStages([{ name: 'a', objective: 'A', requires: ['b'] }, { name: 'b', objective: 'B', requires: ['a'] }]), /cycle/);
  const f = fixture(undefined, { stages: [{ name: 'start', objective: 'Start' }, { name: 'left', objective: 'Left', requires: ['start'] }, { name: 'right', objective: 'Right', requires: ['start'] }, { name: 'finish', objective: 'Finish', requires: ['left', 'right'], taskTitles: ['Deliver'] }] });
  try { const a = await agent(f.engine); stageReady(f.engine, a.id); assert.throws(() => advanceStage(f.engine, 'finish'), /prerequisites/); advanceStage(f.engine, 'right'); assert.equal(f.engine.session().workflow?.index, 2); stageReady(f.engine, a.id); advanceStage(f.engine); assert.equal(f.engine.session().workflow?.index, 1); stageReady(f.engine, a.id); advanceStage(f.engine); assert.throws(() => stageReady(f.engine, a.id), /Complete required task/); }
  finally { await f.close(); }
});
test('research uses real service responses, scopes cache, preserves citations and blocks unapproved origins/redirects', async () => {
  let calls = 0; let origin = '';
  const server = createServer((req, res) => { calls++; if (req.url === '/redirect') { res.writeHead(302, { Location: origin + '/page' }); res.end(); return; } res.setHeader('Content-Type', req.url?.startsWith('/search') ? 'application/json' : 'text/html'); res.end(req.url?.startsWith('/search') ? JSON.stringify({ results: [{ title: 'Evidence', url: origin + '/page', content: 'Source excerpt' }] }) : '<title>Evidence</title><script>secret()</script><p>Verified page text</p>'); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`; const f = fixture();
  try {
    saveResearch(f.home, { searchUrl: origin + '/search', adapter: 'searxng', fetchOrigins: [origin] }); const service = new ResearchService(f.repo, f.session.id); const signal = new AbortController().signal;
    const a = await service.run('search', 'memory', signal); assert.equal(a.sources[0]?.url, origin + '/page'); const count = calls; assert.equal((await service.run('search', 'memory', signal)).cached, true); assert.equal(calls, count);
    const page = await service.run('fetch', origin + '/page', signal); assert.match(page.sources[0]!.text, /Verified page/); assert.doesNotMatch(page.sources[0]!.text, /secret/);
    await assert.rejects(service.run('fetch', 'http://127.0.0.1:1/private', signal), /approve/); await assert.rejects(service.run('fetch', origin + '/redirect', signal));
    const participant = await agent(f.engine); participant.permissions.push('network.research'); f.repo.put('agent', participant); const first = await f.engine.tools.execute(participant, 'web_fetch', { input: origin + '/page' }, 'fetch-fixed'); assert.equal((first as { ok: boolean }).ok, true);
    saveResearch(f.home, { fetchOrigins: [] }); await assert.rejects(service.run('fetch', origin + '/page', signal), /approve/);
    const repeated = await f.engine.tools.execute(participant, 'web_fetch', { input: origin + '/page' }, 'fetch-fixed'); assert.equal((repeated as { ok: boolean }).ok, false);
  } finally { await f.close(); await new Promise<void>(r => server.close(() => r())); }
});
test('matched comparison refuses shared sessions or different objectives and labels unverified completion', async () => {
  const f = fixture(); try {
    await agent(f.engine); const s = Engine.create(f.repo, join(f.home, 'workspaces'), f.session.objective); const team = new Engine(f.repo, s.id, async () => ({ prompt: async () => {}, abort: async () => {}, dispose() {} }));
    try { await agent(team, 'A'); await agent(team, 'B'); const result = compareSessions(f.repo, { task: 'Fixture comparison', solo: f.session.id, team: s.id }); assert.equal(result.solo.complete, false); assert.equal(result.team.complete, false); assert.throws(() => compareSessions(f.repo, { task: 'same', solo: s.id, team: s.id }), /independent/); }
    finally { await team.close(); }
  } finally { await f.close(); }
});
