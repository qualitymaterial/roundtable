// Explicitly opt-in metered coding evaluation. No credential copying or remote Git operations.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Engine} from '../dist/engine.js';
import {Repository} from '../dist/storage.js';
import {ProviderRegistry} from '../dist/providers.js';
import {PiAdapter} from '../dist/pi-adapter.js';
import {normalizeHostPolicy} from '../dist/host-tools.js';
import {startCodeWork,codeTask,integrateCodeWork,workBoard} from '../dist/code-work.js';
import {compareSessions} from '../dist/evaluation.js';
import {protectSecret,redact} from '../dist/domain.js';
const args=process.argv.slice(2);
if(args.length!==3||args[0]!=='--run-live')throw new Error('Usage: node scripts/live-coding-evaluation.mjs --run-live <auth-home> <NEW-evidence-folder>. Makes metered model calls and approved Node checks on disposable project worktrees.');
const authHome=resolve(args[1]),out=resolve(args[2]),source=resolve('.');mkdirSync(out,{recursive:false});
const home=join(out,'runtime');mkdirSync(home);const repo=new Repository(join(home,'roundtable.db'));
const configs=JSON.parse(readFileSync(join(authHome,'agents.json'),'utf8'));
const protect=x=>{if(typeof x==='string')protectSecret(x);else if(x&&typeof x==='object')Object.values(x).forEach(protect)};protect(JSON.parse(readFileSync(join(authHome,'auth.json'),'utf8')));
const registry=await ProviderRegistry.create(authHome);const scoped={home,runtime:registry.runtime,model:registry.model.bind(registry),validate:registry.validate.bind(registry)};
const editor=configs.find(x=>x.name==='Sage')??configs.at(-1);assert.ok(editor);const peers=configs.filter(x=>x!==editor).slice(0,2);assert.equal(peers.length,2);
const environment=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|LANG)$/i.test(k)));
const git=(cwd,...a)=>execFileSync('git',['-c',`safe.directory=${cwd.replaceAll('\\','/')}`,'-c','core.hooksPath='+join(out,'no-hooks'),'-c','commit.gpgsign=false',...a],{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
const upstreamHead=git(source,'rev-parse','HEAD');const archive=execFileSync('git',['-c',`safe.directory=${source.replaceAll('\\','/')}`,'archive','--format=tar','HEAD'],{cwd:source,maxBuffer:32*1024*1024});writeFileSync(join(out,'upstream.tar'),archive);
const digest=x=>createHash('sha256').update(x).digest('hex');
const cases=[{
 name:'diff',file:'src/diff.ts',
 brief:'Fix Roundtable src/diff.ts unifiedDiff line counting for empty files and terminal newlines. A genuinely empty input has zero lines, and a terminal newline must not create a phantom context line. Preserve bounded previews and unrelated context. Read test/coding-acceptance.test.mjs, run the named tests check BEFORE editing to reproduce failures, then repair ONLY src/diff.ts. Do not change the provided tests. Complete the assigned review/finish workflow.',
 tests:`import test from 'node:test';import assert from 'node:assert/strict';import {unifiedDiff} from '../src/diff.ts';\ntest('empty insertion counts zero old lines',()=>{const d=unifiedDiff('x','','hello\\n');assert.equal(d[2],'@@ -0,0 +1,1 @@');assert.deepEqual(d.slice(3),['+hello']);});\ntest('full deletion counts zero new lines',()=>{const d=unifiedDiff('x','hello\\n','');assert.equal(d[2],'@@ -1,1 +0,0 @@');assert.deepEqual(d.slice(3),['-hello']);});\ntest('terminal newline is not a phantom line',()=>{const d=unifiedDiff('x','one\\n','two\\n');assert.equal(d[2],'@@ -1,1 +1,1 @@');assert.deepEqual(d.slice(3),['-one','+two']);});\ntest('identical inputs stay unchanged',()=>assert.deepEqual(unifiedDiff('x','same\\n','same\\n'),['x: unchanged']));\ntest('bounded preview remains bounded',()=>assert.ok(unifiedDiff('x','',Array.from({length:300},(_,i)=>String(i)).join('\\n'),4).at(-1).includes('truncated')));\n`,
 oracle:`const {unifiedDiff}=await import(MODULE);for(let n=1;n<=80;n++){const lines=Array.from({length:n},(_,i)=>'value_'+i);const d=unifiedDiff('oracle','',lines.join('\\n')+'\\n',1000);assert.equal(d[2],'@@ -0,0 +1,'+n+' @@');assert.deepEqual(d.slice(3),lines.map(x=>'+'+x));const r=unifiedDiff('oracle',lines.join('\\n')+'\\n','',1000);assert.equal(r[2],'@@ -1,'+n+' +0,0 @@');assert.deepEqual(r.slice(3),lines.map(x=>'-'+x));}console.log('320 independent assertions passed');`
},{
 name:'courtesy',file:'src/conversation.ts',
 brief:'Extend Roundtable src/conversation.ts local courtesy recognition to thanks team, thank you team, thanks, everyone, and common terminal Unicode punctuation such as a fullwidth exclamation mark or ellipsis. Keep matching narrow: requests mixed with greetings/thanks, multiline requests, hello world, and unsupported non-English input must still return undefined. Read test/coding-acceptance.test.mjs, run the named tests check BEFORE editing to reproduce failures, then repair ONLY src/conversation.ts. Do not change provided tests. Complete the assigned review/finish workflow.',
 tests:`import test from 'node:test';import assert from 'node:assert/strict';import {courtesyReply} from '../src/conversation.ts';\ntest('team thanks stay local',()=>{for(const s of ['thanks team','thank you team','thanks, everyone'])assert.equal(courtesyReply(s),'You’re welcome.');});\ntest('terminal Unicode punctuation stays local',()=>{assert.equal(courtesyReply('Hello！'),'Hello! What would you like to work on?');assert.equal(courtesyReply('Thanks…'),'You’re welcome.');});\ntest('existing English courtesies work',()=>{for(const s of ['hello','hi team','good morning!','thank you'])assert.ok(courtesyReply(s));});\ntest('real work is not swallowed',()=>{for(const s of ['thanks, now fix it','hello\\ninspect files','thank you team please fix this','hello world','bonjour'])assert.equal(courtesyReply(s),undefined);});\n`,
 oracle:`const {courtesyReply}=await import(MODULE);for(const phrase of ['thanks team','thank you team','thanks, everyone'])for(const suffix of ['', '!', '！', '…', '?'])assert.equal(courtesyReply(phrase+suffix),'You’re welcome.');for(let i=0;i<100;i++)for(const prefix of ['hello','thanks team','thank you'])assert.equal(courtesyReply(prefix+' please fix task '+i),undefined);console.log('315 independent assertions passed');`
}];
const report={startedAt:new Date().toISOString(),upstreamHead,upstreamArchiveHash:digest(archive),scope:'actual Roundtable source snapshot; no injected implementation defect; provided regressions; real providers and model-executed checks; operator-approved host Node checks with OS privileges',cases:[]};
const save=()=>writeFileSync(join(out,'report.json'),redact(JSON.stringify(report,null,2)));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let engine;
try{
for(const scenario of cases){
 const root=join(out,'projects',scenario.name);mkdirSync(root,{recursive:true});execFileSync('tar',['-xf',join(out,'upstream.tar'),'-C',root],{windowsHide:true});git(root,'init');git(root,'config','core.autocrlf','false');git(root,'config','user.name','Roundtable Acceptance');git(root,'config','user.email','acceptance@example.invalid');
 const testFile=join(root,'test','coding-acceptance.test.mjs');writeFileSync(testFile,scenario.tests);const testHash=digest(scenario.tests);git(root,'add','.');git(root,'commit','-m','Roundtable source with coding acceptance checks');
 const baseline=spawnSync(process.execPath,['--test',testFile],{cwd:root,encoding:'utf8',env:environment,timeout:30000});const baselineOutput=(baseline.stdout??'')+(baseline.stderr??'');writeFileSync(join(out,scenario.name+'-baseline.txt'),baselineOutput);assert.equal(baseline.status,1);assert.ok(baselineOutput.includes('AssertionError')&&!baselineOutput.includes('SyntaxError'),'Baseline must fail assertions, not setup/parsing');
 const result={name:scenario.name,root,baseHead:git(root,'rev-parse','HEAD'),file:scenario.file,brief:scenario.brief,runs:[]};report.cases.push(result);save();
 for(const mode of ['solo','team']){
  const session=Engine.create(repo,join(home,'workspaces'),scenario.brief,{projectRoot:root,permissions:['collaborate'],limits:{requests:60,toolCalls:70,exchanges:12,tokens:500000,dollars:0.75,timeoutMs:360000,turnTimeoutMs:120000,concurrency:3}});
  session.hostAccess=await normalizeHostPolicy({readRoots:[root],writeRoots:[root],shell:false});repo.put('session',session);
  engine=new Engine(repo,session.id,PiAdapter.factory(scoped));const run={mode,sessionId:session.id,startedAt:new Date().toISOString(),passed:false};result.runs.push(run);save();
  console.log(JSON.stringify({case:scenario.name,mode,stage:'admission'}));
  for(const c of [editor,...(mode==='team'?peers:[])])await engine.addAgent({...c,permissions:['collaborate'],maxOutputTokens:4096,instructions:c.instructions+'\nWhen an assignment is supplied, follow its runtime role and project_* tool workflow; do not negotiate roles or create tasks.'});
  const actors=engine.agents();const command=process.platform==='win32'?`& '${process.execPath.replaceAll("'","''")}' --test test/coding-acceptance.test.mjs`:`'${process.execPath.replaceAll("'","'\\''")}' --test test/coding-acceptance.test.mjs`;
  const task=await startCodeWork(engine,{title:scenario.brief,key:scenario.name,ownerId:actors[0].id,reviewerIds:actors.slice(1).map(a=>a.id),checks:[{name:'tests',command,mode:'host'}],approveHostChecks:true});run.taskId=task.id;save();console.log(JSON.stringify({case:scenario.name,mode,stage:'model-coding',taskId:task.id}));
  await engine.idle(365000);const current=codeTask(engine,task.id);run.task=current;run.status=engine.status();run.events=repo.events(session.id);run.messages=repo.messages(session.id);run.usage=engine.session().usage;
  assert.equal(current.state,'done','Model work did not finish');assert.ok(current.code.runs.some(c=>c.exitCode!==0),'Model did not reproduce failing baseline');assert.equal(current.code.runs.at(-1).exitCode,0);assert.equal(current.code.rounds.at(-1).reviews.length,mode==='team'?2:0);
  assert.equal(digest(readFileSync(join(current.code.root,'test','coding-acceptance.test.mjs'),'utf8').replaceAll('\r\n','\n')),testHash,'Provided tests were modified');assert.deepEqual(Object.keys(current.code.baseFiles),[scenario.file],'Unexpected source changes');
  const oracle=`import assert from 'node:assert/strict';const MODULE=${JSON.stringify(pathToFileURL(join(current.code.root,scenario.file)).href)};${scenario.oracle}`;const oracleFile=join(out,`${scenario.name}-${mode}-oracle.mjs`);writeFileSync(oracleFile,oracle);run.oracle=execFileSync(process.execPath,[oracleFile],{cwd:current.code.root,encoding:'utf8',env:environment,timeout:30000,windowsHide:true});
  const counters=JSON.stringify(engine.session().usage);const events=repo.events(session.id).length;await sleep(3000);assert.equal(JSON.stringify(engine.session().usage),counters);assert.equal(repo.events(session.id).length,events);assert.equal(repo.deliveries(session.id,['pending','inflight','failed']).length,0);
  engine.send({sender:'human',sessionId:session.id,recipients:['*'],type:'human',body:'thanks'});await engine.idle();assert.equal(JSON.stringify(engine.session().usage),counters);run.quiet=true;run.passed=true;run.finishedAt=new Date().toISOString();run.workBoard=workBoard(engine);save();
  console.log(JSON.stringify({case:scenario.name,mode,stage:'passed',usage:run.usage,oracle:run.oracle.trim()}));
  if(mode==='team'){await engine.pause('Independent verification passed; prepare integration');await integrateCodeWork(engine,task.id);run.integrated=true;run.proposal=codeTask(engine,task.id).code.groupId;save();}
  await engine.close();engine=undefined;
 }
 result.comparison=compareSessions(repo,{task:scenario.name,solo:result.runs[0].sessionId,team:result.runs[1].sessionId,humanNotes:'Independent oracle passed; provided tests unchanged. Baseline failures are expected reproduction, not post-edit regressions. One run per mode is not a general model-quality study.'});save();
}
report.passed=true;report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({passed:true,cases:report.cases.map(c=>({name:c.name,comparison:c.comparison}))}));
}catch(error){report.error=redact(String(error));save();throw error;}finally{await engine?.close();repo.close();}
