// Opt-in follow-up to the matched coding evaluation. Keeps initial results immutable.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Engine} from '../dist/engine.js';import{Repository}from'../dist/storage.js';import{ProviderRegistry}from'../dist/providers.js';import{PiAdapter}from'../dist/pi-adapter.js';
import{codeTask,reworkCodeWork,integrateCodeWork}from'../dist/code-work.js';import{compareSessions}from'../dist/evaluation.js';import{protectSecret,redact}from'../dist/domain.js';
const args=process.argv.slice(2);if(args.length!==3||args[0]!=='--run-live')throw Error('Usage: node scripts/live-coding-rework.mjs --run-live <auth-home> <existing-evaluation-folder>');
const authHome=resolve(args[1]),out=resolve(args[2]);const initial=JSON.parse(readFileSync(join(out,'report.json'),'utf8'));const scenario=initial.cases.find(c=>c.name==='diff');assert.ok(scenario?.runs.every(r=>r.passed));
const protect=x=>{if(typeof x==='string')protectSecret(x);else if(x&&typeof x==='object')Object.values(x).forEach(protect)};protect(JSON.parse(readFileSync(join(authHome,'auth.json'),'utf8')));
const registry=await ProviderRegistry.create(authHome);const home=join(out,'runtime');const scoped={home,runtime:registry.runtime,model:registry.model.bind(registry),validate:registry.validate.bind(registry)};const repo=new Repository(join(home,'roundtable.db'));
const environment=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|LANG)$/i.test(k)));
const report={startedAt:new Date().toISOString(),initialReport:'report.json',reason:'Independent review found both original diff solutions hide EOF-newline-only changes. Added regression and reworked both original sessions; initial task data/report remain preserved.',runs:[]};
const save=()=>writeFileSync(join(out,'rework-report.json'),redact(JSON.stringify(report,null,2)));const sleep=ms=>new Promise(r=>setTimeout(r,ms));let engine;
try{for(const original of scenario.runs){
 const task=repo.get('task',original.taskId);const testFile=join(task.code.root,'test','coding-acceptance.test.mjs');const previous=readFileSync(testFile,'utf8');
 assert.ok(!previous.includes('EOF-only changes remain visible'),'Refuse duplicate follow-up test injection');
 const extra=`\ntest('EOF-only changes remain visible',()=>{for(const [before,after] of [['same','same\\n'],['same\\n','same']]){const d=unifiedDiff('x',before,after);assert.equal(d[2],'@@ -1,1 +1,1 @@');assert.ok(d.includes('-same'));assert.ok(d.includes('+same'));assert.ok(d.includes('\\\\ No newline at end of file'));}});\n`;
 writeFileSync(testFile,previous+extra);const testHash=createHash('sha256').update(previous+extra).digest('hex');
 engine=new Engine(repo,original.sessionId,PiAdapter.factory(scoped));engine.resume();await engine.connect();
 reworkCodeWork(engine,task.id,'Independent regression: unifiedDiff currently returns unchanged for a file whose only change is adding/removing its terminal newline. The approved tests now include EOF-only changes remain visible. Keep original empty-file/count/bounded-preview behavior, but show a one-line replacement with standard \\ No newline at end of file metadata for these byte changes. Repair only src/diff.ts, do not edit tests, and complete a new checked/reviewed round.');
 console.log(JSON.stringify({mode:original.mode,stage:'rework',taskId:task.id}));await engine.idle(365000);
 const current=codeTask(engine,task.id);assert.equal(current.state,'done');assert.equal(current.code.runs.at(-1).exitCode,0);assert.equal(createHash('sha256').update(readFileSync(testFile)).digest('hex'),testHash);
 const oracle=`import assert from 'node:assert/strict';const {unifiedDiff}=await import(${JSON.stringify(pathToFileURL(join(current.code.root,'src/diff.ts')).href)});for(let n=1;n<=80;n++){const a=Array.from({length:n},(_,i)=>'v'+i);let d=unifiedDiff('x','',a.join('\\n')+'\\n',1000);assert.equal(d[2],'@@ -0,0 +1,'+n+' @@');assert.deepEqual(d.slice(3),a.map(x=>'+'+x));d=unifiedDiff('x',a.join('\\n')+'\\n','',1000);assert.equal(d[2],'@@ -1,'+n+' +0,0 @@');assert.deepEqual(d.slice(3),a.map(x=>'-'+x));}for(let i=0;i<30;i++)for(const [a,b]of [['value'+i,'value'+i+'\\n'],['value'+i+'\\n','value'+i]]){const d=unifiedDiff('x',a,b);assert.equal(d[2],'@@ -1,1 +1,1 @@');assert.ok(d.includes('\\\\ No newline at end of file'));assert.ok(!d.includes('x: unchanged'));}console.log('500 independent assertions passed');`;
 const oracleFile=join(out,`diff-${original.mode}-expanded-oracle.mjs`);writeFileSync(oracleFile,oracle);const oracleOutput=execFileSync(process.execPath,[oracleFile],{cwd:current.code.root,env:environment,encoding:'utf8',windowsHide:true,timeout:30000});
 const before=JSON.stringify(engine.session().usage);await sleep(3000);assert.equal(JSON.stringify(engine.session().usage),before);assert.equal(repo.deliveries(engine.sessionId,['pending','inflight','failed']).length,0);
 const result={mode:original.mode,taskId:task.id,sessionId:original.sessionId,passed:true,rounds:current.code.rounds.length,usage:engine.session().usage,oracle:oracleOutput.trim(),task:current};report.runs.push(result);save();
 if(original.mode==='team'){await engine.pause('Expanded independent oracle passed');await integrateCodeWork(engine,task.id);result.integrated=true;save();}
 await engine.close();engine=undefined;console.log(JSON.stringify({mode:original.mode,passed:true,usage:result.usage}));
}
report.comparison=compareSessions(repo,{task:'diff with independent EOF rework',solo:scenario.runs[0].sessionId,team:scenario.runs[1].sessionId,humanNotes:'Both original solutions passed limited checks but missed an EOF-only regression. Expanded independent acceptance requested one rework in each mode. Report original scope separately from this repaired result.'});report.passed=true;report.finishedAt=new Date().toISOString();save();
}catch(error){report.error=redact(String(error));save();throw error;}finally{await engine?.close();repo.close();}
