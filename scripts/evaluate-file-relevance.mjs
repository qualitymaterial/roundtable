// Explicitly metered pilot. Fresh Roundtable sessions; no canonical project edits.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Repository } from '../dist/storage.js';
import { Engine } from '../dist/engine.js';
import { ProviderRegistry } from '../dist/providers.js';
import { PiAdapter } from '../dist/pi-adapter.js';
import { normalizeHostPolicy } from '../dist/host-tools.js';
import { startCodeWork, codeTask, integrateCodeWork } from '../dist/code-work.js';
import { configureRelevance, rankFileCandidates, RelevanceConfig } from '../dist/file-relevance.js';
import { protectSecret, redact } from '../dist/domain.js';
const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== '--run-live') throw Error('Usage: node scripts/evaluate-file-relevance.mjs --run-live <Roundtable-auth-home> <NEW-output-folder>. Six metered runs, each capped at 100 requests, SDK estimate $1.50 and seven minutes.');
const authHome = resolve(args[1]), out = resolve(args[2]), source = resolve('.'); mkdirSync(out);
writeFileSync(join(out, 'package.json'), JSON.stringify({ type: 'module', private: true }));
const hash = value => createHash('sha256').update(value).digest('hex');
const git = (cwd, ...a) => execFileSync('git', ['-c', 'safe.directory=' + cwd.replaceAll('\\', '/'), ...a], { cwd, encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
const registry = await ProviderRegistry.create(authHome);
const auth = await registry.runtime.getAuth('openrouter');
if (!auth?.auth?.apiKey) throw Error('Roundtable-owned OpenRouter auth required for this Jev comparison; no other auth stores are read');
process.env.ROUNDTABLE_JUDGMENT_KEY = auth.auth.apiKey; protectSecret(auth.auth.apiKey);
const lineup = JSON.parse(readFileSync(join(authHome, 'agents.json'), 'utf8'));
assert.equal(lineup.length, 3);
const backends = {
  off: undefined,
  jev: RelevanceConfig.parse({ backend: 'jev-openrouter', model: 'typesafe/jev-1.13-20260917', apiKeyEnv: 'ROUNDTABLE_JUDGMENT_KEY', excerptChars: 4000, timeoutMs: 45000, maxFileRequests: 60 }),
  laya: RelevanceConfig.parse({ backend: 'laya', model: 'multilingual', url: 'http://127.0.0.1:19517/v1/systemone', excerptChars: 4000, timeoutMs: 45000, maxFileRequests: 60 }),
};
const health = await fetch('http://127.0.0.1:19517/health').then(r => { if (!r.ok) throw Error('Laya health failed'); return r.json(); });
writeFileSync(join(out, 'laya-health.json'), JSON.stringify(health, null, 2));
const controls = {
  models: lineup.map(({ name, provider, model }) => ({ name, provider, model })),
  limits: { requests: 100, toolCalls: 120, exchanges: 60, tokens: null, dollars: 1.5, timeoutMs: 420000, turnTimeoutMs: 90000 },
  scope: 'Controlled leaf-function tasks from actual Roundtable source. Historical unifiedDiff bug and extracted current fuzzyChoices Unicode bug; realistic distractor source. Not a representative project benchmark. One run per task/backend; no inferential significance or savings claim.',
  order: [['diff', 'off'], ['diff', 'jev'], ['diff', 'laya'], ['choices', 'laya'], ['choices', 'jev'], ['choices', 'off']],
  noRecovery: true, oracleLocation: 'Outside editable worktrees; hashes verified after each run',
};
writeFileSync(join(out, 'protocol.json'), JSON.stringify(controls, null, 2));
const fixtures = {};
for (const kind of ['diff', 'choices']) {
  const files = {};
  files['package.json'] = JSON.stringify({ type: 'module', private: true });
  for (const p of ['src/diff.ts', 'src/version.ts', 'src/budgets.ts', 'src/settings.ts', 'src/completion.ts', 'src/conversation.ts', 'src/releases.ts', 'src/usage.ts', 'src/network.ts', 'src/composer.ts']) {
    try { files[p] = readFileSync(join(source, p), 'utf8'); } catch { /* optional distractor */ }
  }
  const target = kind === 'diff' ? 'src/diff.ts' : 'src/choices.ts';
  if (kind === 'diff') files[target] = git(source, 'show', 'HEAD:src/diff.ts');
  else {
    const code = readFileSync(join(source, 'src/ui/controller.ts'), 'utf8');
    const start = code.indexOf('export function fuzzyChoices('), end = code.indexOf('\n}', start) + 2;
    assert.ok(start >= 0 && end > start); files[target] = code.slice(start, end) + '\n';
  }
  files['test/behavior.test.mjs'] = `import test from 'node:test';import assert from 'node:assert/strict';test('test scaffold available',()=>assert.ok(true));\n`;
  files['docs/BEHAVIOR.md'] = '# Behavior notes\n\nAdd a concise description of the repaired behavior and its boundary here.\n';
  const request = kind === 'diff'
    ? 'Repair complete small unified patch previews: final lines without newlines and empty input must round-trip through git apply. Preserve bounded preview truncation and unchanged reporting.'
    : 'Repair model/provider picker filtering: a query containing a supplementary Unicode character such as an emoji fails to find labels containing that character. Preserve subsequence matching, case-insensitivity, empty-query behavior, input order and original label/index values.';
  const body = kind === 'diff'
    ? `const{unifiedDiff}=await import(pathToFileURL(join(process.cwd(),'src/diff.ts')).href);const samples=['','a','a\\n','a\\nb','a\\nb\\n','a\\nb\\nc','a\\nb\\nc\\n'];let count=0;for(const before of samples)for(const after of samples){if(before===after)continue;const dir=mkdtempSync(join(tmpdir(),'roundtable-judge-oracle-'));try{writeFileSync(join(dir,'f.txt'),before);writeFileSync(join(dir,'p.patch'),unifiedDiff('f.txt',before,after).join('\\n')+'\\n');const r=spawnSync('git',['-c','core.autocrlf=false','-c','core.eol=lf','apply','--no-index','--unsafe-paths','-p0','p.patch'],{cwd:dir,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,JSON.stringify([before,after])+r.stderr);let actual;try{actual=readFileSync(join(dir,'f.txt'),'utf8')}catch(e){if(e.code==='ENOENT')actual='';else throw e}assert.equal(actual,after);count++;}finally{rmSync(dir,{recursive:true,force:true})}}assert.match(unifiedDiff('f','x','x').join('\\n'),/unchanged/);console.log(count+' round trips passed');`
    : `const{fuzzyChoices}=await import(pathToFileURL(join(process.cwd(),'src/choices.ts')).href);let count=0;for(const symbol of ['🪑','😀','𐐀','𝒜','🦉']){const labels=['Alpha '+symbol+' beta',symbol+' cafe','plain','a'+symbol+'b'];for(const q of [symbol,symbol+'b','a'+symbol,'', 'a','AB','zz']){const needle=Array.from(q.toLocaleLowerCase());const expected=labels.map((label,index)=>({label,index})).filter(({label})=>{let p=0;for(const c of label.toLocaleLowerCase())if(c===needle[p])p++;return p===needle.length});assert.deepEqual(fuzzyChoices(labels,q),expected,JSON.stringify({symbol,q}));count++;}}console.log(count+' independent Unicode cases passed');`;
  const oracle = `import assert from 'node:assert/strict';import{mkdtempSync,writeFileSync,readFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{spawnSync}from'node:child_process';import{pathToFileURL}from'node:url';${body}`;
  writeFileSync(join(out, `${kind}-oracle.mjs`), oracle);
  fixtures[kind] = { files, target, request, oracleHash: hash(oracle) };
}
const report = { startedAt: new Date().toISOString(), protocol: controls, rankings: [], runs: [], passed: false };
const save = () => writeFileSync(join(out, 'report.json'), redact(JSON.stringify(report, null, 2)));
// Fixed retrieval cases are scored before agent runs; expected paths are never model inputs.
for (const kind of ['diff', 'choices']) for (const backend of ['jev', 'laya']) {
  const f = fixtures[kind]; const candidates = Object.entries(f.files).map(([path, content]) => ({ path, sha256: hash(content), excerpt: content.slice(0, 4000), excerptTruncated: content.length > 4000 }));
  const ranked = await rankFileCandidates(backends[backend], f.request, candidates);
  const position = ranked.ranking.indexOf(f.target) + 1;
  report.rankings.push({ kind, backend, target: f.target, targetRank: position || null, hitAt3: position > 0 && position <= 3, hitAt5: position > 0 && position <= 5, result: ranked }); save();
}
for (const [kind, backend] of controls.order) {
  const f = fixtures[kind], runRoot = join(out, `${kind}-${backend}`), project = join(runRoot, 'project'), home = join(runRoot, 'runtime'); mkdirSync(runRoot); mkdirSync(project); mkdirSync(home);
  for (const [path, text] of Object.entries(f.files)) { mkdirSync(resolve(project, path, '..'), { recursive: true }); writeFileSync(join(project, path), text); }
  git(project, 'init'); git(project, 'config', 'user.name', 'Roundtable evaluation'); git(project, 'config', 'user.email', 'evaluation@example.invalid'); git(project, 'config', 'core.autocrlf', 'false'); git(project, 'add', '.'); git(project, 'commit', '-m', 'Frozen pilot baseline');
  const oracle = join(out, `${kind}-oracle.mjs`); const baseline = spawnSync(process.execPath, [oracle], { cwd: project, encoding: 'utf8', windowsHide: true });
  writeFileSync(join(runRoot, 'baseline.txt'), baseline.stdout + baseline.stderr);
  assert.equal(baseline.status, 1, 'Baseline must reproduce targeted defect'); assert.match(baseline.stderr, /ERR_ASSERTION/, 'Baseline must be a behavioral assertion, not an environment/import failure');
  configureRelevance(home, backends[backend] ?? { enabled: false });
  const scoped = { home, runtime: registry.runtime, model: registry.model.bind(registry), validate: registry.validate.bind(registry) };
  const repo = new Repository(join(home, 'roundtable.db'));
  const objective = `${f.request}\nAll three participants must investigate independently, then adopt or challenge peer evidence, agree a plan, and divide real source, regression-test and documentation implementation. Discover the source file from the project; tests belong in test/behavior.test.mjs and notes in docs/BEHAVIOR.md. Apply guarded contributions from both peers; author-excluding review remains required. Reproduce the failure with the named check before editing, then pass it and your tests. The independent check is outside your editable tree and its path/command must not be changed. Use concrete questions for actual help, no acknowledgement chains. End after structured stage submissions.\n${backend === 'off' ? 'File relevance advice is disabled; use ordinary listing/search/reading.' : 'After listing/searching candidates, call project_relevance once during your independent investigation with the candidate source/test/doc paths and query empty. Use advice to prioritize reading; all candidates remain available and originals must be inspected. Do not repeatedly rank.'}`;
  const session = Engine.create(repo, join(home, 'workspaces'), objective, { projectRoot: project, limits: controls.limits });
  session.hostAccess = await normalizeHostPolicy({ readRoots: [project], writeRoots: [project], shell: false }); repo.put('session', session);
  const engine = new Engine(repo, session.id, (a, e) => PiAdapter.create(scoped, a, e));
  const run = { kind, backend, sessionId: session.id, startedAt: new Date().toISOString(), success: false, interventionCount: 0 }; report.runs.push(run); let task;
  const capture = () => { run.usage = engine.session().usage; run.events = repo.events(session.id); run.messages = repo.messages(session.id); if (task) run.task = codeTask(engine, task.id); writeFileSync(join(runRoot, 'run.json'), redact(JSON.stringify(run, null, 2))); save(); };
  try {
    const ordered = [...lineup].sort((a, b) => (a.name === 'Sage' ? -1 : b.name === 'Sage' ? 1 : 0));
    for (const config of ordered) await engine.addAgent({ ...config, permissions: ['collaborate'], maxOutputTokens: 4000, instructions: (config.instructions ?? '') + '\nFollow current runtime stage; concise actual source evidence, peer discussion and scoped contributions. project_team contains identities, file claims and proposal content. End after structured submissions; no acknowledgement/polling chains.' });
    run.admissionUsage = structuredClone(engine.session().usage);
    const command = process.platform === 'win32' ? `& '${process.execPath.replaceAll("'", "''")}' '${oracle.replaceAll("'", "''")}'; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; & '${process.execPath.replaceAll("'", "''")}' --test test/behavior.test.mjs` : `'${process.execPath}' '${oracle}' && '${process.execPath}' --test test/behavior.test.mjs`;
    const start = Date.now();
    task = await startCodeWork(engine, { title: f.request, collaborative: true, ownerId: engine.agents()[0].id, checks: [{ name: 'independent', command, mode: 'host' }], approveHostChecks: true }); capture();
    console.log(JSON.stringify({ stage: 'started', kind, backend, sessionId: session.id, taskId: task.id }));
    await engine.idle(425000); run.elapsedMs = Date.now() - start; capture();
    const current = codeTask(engine, task.id); const team = current.code.collaboration;
    run.readCalls = run.events.filter(e => e.type === 'tool_start' && e.data.name === 'project_read').length;
    run.adviceCalls = run.events.filter(e => e.type === 'file_relevance').length;
    run.rankings = run.events.filter(e => e.type === 'file_relevance').map(e => e.data);
    run.peerFindings = team.findings.length; run.peerDiscussion = team.discussion.length;
    run.acceptedPeerAuthors = new Set(team.contributions.filter(c => c.state === 'applied').map(c => c.agentId)).size;
    const check = spawnSync(process.execPath, [oracle], { cwd: current.code.root, encoding: 'utf8', timeout: 30000, windowsHide: true }); run.oracle = { exitCode: check.status, output: check.stdout + check.stderr };
    assert.equal(hash(readFileSync(oracle)), f.oracleHash); assert.equal(current.state, 'done', 'Team did not complete autonomously within fixed limits'); assert.equal(check.status, 0, 'Independent oracle failed');
    assert.equal(team.findings.length, 3); assert.equal(team.discussion.length, 3); assert.ok(team.discussion.every(d => d.buildsOn.length)); assert.equal(run.acceptedPeerAuthors, 2);
    for (const [reviewer, paths] of Object.entries(current.code.rounds.at(-1).assignments)) for (const path of paths) assert.ok(!(team.authors[path.toLowerCase()] ?? []).includes(reviewer));
    if (backend !== 'off') assert.equal(new Set(run.rankings.map(r => r.agentId)).size, 3, 'Each investigator must actually use advice');
    await engine.pause('Pilot independently checked; integrate only disposable project'); await integrateCodeWork(engine, task.id); run.success = true;
  } catch (error) { run.error = redact(String(error)); if (!task) run.invalidBeforeWork = true; }
  finally { capture(); await engine.close(); repo.close(); run.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ stage: 'finished', kind, backend, success: run.success, elapsedMs: run.elapsedMs, error: run.error })); }
  if (run.invalidBeforeWork) break;
}
report.passed = report.runs.length === 6 && report.runs.every(r => r.success); report.finishedAt = new Date().toISOString(); save();
console.log(JSON.stringify({ completed: true, allRunsPassed: report.passed, results: report.runs.map(({ kind, backend, success, elapsedMs, readCalls, peerDiscussion, acceptedPeerAuthors, error }) => ({ kind, backend, success, elapsedMs, readCalls, peerDiscussion, acceptedPeerAuthors, error })) }, null, 2));
