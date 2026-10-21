// Explicit opt-in live acceptance; real providers, private data, approved host checks.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Engine} from '../dist/engine.js';
import {Repository} from '../dist/storage.js';
import {ProviderRegistry} from '../dist/providers.js';
import {PiAdapter} from '../dist/pi-adapter.js';
import {normalizeHostPolicy} from '../dist/host-tools.js';
import {startCodeWork,codeTask,integrateCodeWork,workBoard} from '../dist/code-work.js';
import {protectSecret,redact} from '../dist/domain.js';
const args=process.argv.slice(2);
if(args.length!==3||args[0]!=='--run-live')throw Error('Usage: node scripts/live-project-collaboration.mjs --run-live <auth-home> <NEW-output-folder>. Metered models and approved host Node/Git checks.');
const authHome=resolve(args[1]),out=resolve(args[2]),source=resolve('.');mkdirSync(out);
const root=join(out,'project'),home=join(out,'runtime');mkdirSync(root);mkdirSync(home);
const git=(cwd,...a)=>execFileSync('git',['-c','safe.directory='+cwd.replaceAll('\\','/'),...a],{cwd,encoding:'utf8',windowsHide:true,stdio:'pipe'});
const archive=join(out,'source.tar');git(source,'archive','--format=tar','--output',archive,'HEAD');execFileSync('tar',['-xf',archive,'-C',root],{windowsHide:true});
// Overlay only existing current project files plus an explicit editable test scaffold.
for(const path of ['src/diff.ts','docs/CODING.md'])copyFileSync(join(source,path),join(root,path));
writeFileSync(join(root,'test/collaborative-diff.test.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';import{unifiedDiff}from'../src/diff.ts';\ntest('bounded preview remains available',()=>{assert.ok(unifiedDiff('f.txt','a','b').length>=4);});\n");
git(root,'init');git(root,'config','user.name','Roundtable acceptance');git(root,'config','user.email','acceptance@example.invalid');git(root,'config','core.autocrlf','false');git(root,'add','.');git(root,'commit','-m','Actual Roundtable baseline with editable test scaffold');
const fixedCheck=join(out,'fixed-check.mjs');
writeFileSync(fixedCheck,`import assert from 'node:assert/strict';import{mkdtempSync,writeFileSync,readFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{spawnSync}from'node:child_process';import{pathToFileURL}from'node:url';const{unifiedDiff}=await import(pathToFileURL(join(process.cwd(),'src/diff.ts')).href);const samples=['','a','a\\n','a\\nb','a\\nb\\n','a\\nb\\nc','a\\nb\\nc\\n'];let count=0;for(const before of samples)for(const after of samples){if(before===after)continue;const dir=mkdtempSync(join(tmpdir(),'roundtable-patch-'));try{writeFileSync(join(dir,'f.txt'),before);writeFileSync(join(dir,'change.patch'),unifiedDiff('f.txt',before,after).join('\\n')+'\\n');const applied=spawnSync('git',['-c','core.autocrlf=false','-c','core.eol=lf','apply','--no-index','--unsafe-paths','-p0','change.patch'],{cwd:dir,encoding:'utf8',windowsHide:true});assert.equal(applied.status,0,'Patch did not apply for '+JSON.stringify([before,after])+': '+applied.stderr);let actual;try{actual=readFileSync(join(dir,'f.txt'),'utf8')}catch(e){if(e.code==='ENOENT')actual='';else throw e}assert.equal(actual,after);count++;}finally{rmSync(dir,{recursive:true,force:true})}}console.log(count+' independent Git-apply round trips passed');`);
const command=process.platform==='win32'?`& '${process.execPath.replaceAll("'","''")}' '${fixedCheck.replaceAll("'","''")}'; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; & '${process.execPath.replaceAll("'","''")}' --test test/collaborative-diff.test.mjs`:`'${process.execPath.replaceAll("'","'\\''")}' '${fixedCheck.replaceAll("'","'\\''")}' && '${process.execPath.replaceAll("'","'\\''")}' --test test/collaborative-diff.test.mjs`;
const baseline=spawnSync(process.execPath,[fixedCheck],{cwd:root,encoding:'utf8',timeout:30000,windowsHide:true});writeFileSync(join(out,'baseline.txt'),baseline.stdout+baseline.stderr);assert.equal(baseline.status,1);assert.ok(baseline.stderr.includes('Patch did not apply'),'Baseline must reproduce the actual patch defect, not line-ending conversion');
const frozenHash=createHash('sha256').update(readFileSync(fixedCheck)).digest('hex');
const configs=JSON.parse(readFileSync(join(authHome,'agents.json'),'utf8'));
const protect=value=>{if(typeof value==='string')protectSecret(value);else if(value&&typeof value==='object')Object.values(value).forEach(protect)};protect(JSON.parse(readFileSync(join(authHome,'auth.json'),'utf8')));
const registry=await ProviderRegistry.create(authHome);const scoped={home,runtime:registry.runtime,model:registry.model.bind(registry),validate:registry.validate.bind(registry)};
const repo=new Repository(join(home,'roundtable.db'));
const brief='Improve Roundtable unifiedDiff so small complete previews apply correctly when a final line without a newline becomes shared prefix or suffix context. Preserve empty-file/count/EOF-only behavior and bounded previews. All three models must investigate, exchange findings, and divide real implementation: src/diff.ts, regression tests in test/collaborative-diff.test.mjs, and a concise preview-boundaries section in docs/CODING.md. Integrate peer suggestions into the plan and accept guarded contributions from both peers. Use concrete peer questions when uncertain. The named tests check includes an independent Git-apply oracle outside your editable tree; do not alter its path or command. Reproduce baseline failure, repair, run combined checks, independently review assigned files and finish.';
const session=Engine.create(repo,join(home,'workspaces'),brief,{projectRoot:root,limits:{requests:240,toolCalls:200,exchanges:70,tokens:null,dollars:3,timeoutMs:600000,turnTimeoutMs:150000}});
session.hostAccess=await normalizeHostPolicy({readRoots:[root],writeRoots:[root],shell:false});repo.put('session',session);
const engine=new Engine(repo,session.id,(a,e)=>PiAdapter.create(scoped,a,e));let taskId;
const report={startedAt:new Date().toISOString(),sessionId:session.id,project:root,oracleHash:frozenHash,upstreamHead:git(source,'rev-parse','HEAD').trim(),scope:'Actual current diff and coding guide over upstream project archive; editable regression scaffold; real independent contexts and unsandboxed exact host checks',passed:false};
const save=()=>{report.usage=engine.session().usage;report.status=engine.status();report.events=repo.events(session.id);report.messages=repo.messages(session.id);if(taskId)report.task=codeTask(engine,taskId);writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));};
try{
 const editor=configs.find(c=>c.name==='Sage');assert.ok(editor);const peers=configs.filter(c=>c.name!==editor.name).slice(0,2);assert.equal(peers.length,2);
 for(const config of [editor,...peers])await engine.addAgent({...config,permissions:['collaborate'],maxOutputTokens:6000,instructions:(config.instructions??'')+'\nFor assigned project work follow its current runtime stage and tools. Investigate independently, respond substantively to peers, contribute your assigned implementation, and avoid readiness acknowledgements/polling. End after a stage submission or project_ready. Use project_team for current identities, proposals and questions.'});
 const task=await startCodeWork(engine,{title:brief,collaborative:true,ownerId:engine.agents()[0].id,checks:[{name:'tests',command,mode:'host'}],approveHostChecks:true});taskId=task.id;save();console.log(JSON.stringify({stage:'started',sessionId:session.id,taskId}));
 await engine.idle(605000);save();assert.equal(report.task.state,'done','Live collaboration did not complete');const team=report.task.code.collaboration;assert.equal(team.findings.length,3);assert.equal(team.discussion.length,3);assert.ok(team.discussion.every(d=>d.buildsOn.length));assert.ok(team.plan.assignments.length===3);assert.ok(new Set(team.contributions.filter(c=>c.state==='applied').map(c=>c.agentId)).size===2,'Both peers must contribute accepted implementation');assert.ok(report.task.code.runs.some(r=>r.exitCode!==0),'Model must reproduce baseline');assert.equal(report.task.code.runs.at(-1).exitCode,0);assert.equal(createHash('sha256').update(readFileSync(fixedCheck)).digest('hex'),frozenHash);
 report.oracle=execFileSync(process.execPath,[fixedCheck],{cwd:report.task.code.root,encoding:'utf8',windowsHide:true,timeout:30000});
 const round=report.task.code.rounds.at(-1);for(const [reviewer,paths]of Object.entries(round.assignments))for(const path of paths)assert.ok(!(team.authors[path.toLowerCase()]??[]).includes(reviewer),'No author may review own file');
 assert.equal(repo.deliveries(session.id,['pending','inflight','failed']).length,0);const quiet=JSON.stringify(engine.session().usage);await new Promise(r=>setTimeout(r,3000));assert.equal(JSON.stringify(engine.session().usage),quiet);report.quiet=true;
 await engine.pause('Independent acceptance passed; integrate disposable project');await integrateCodeWork(engine,taskId);report.workBoard=workBoard(engine);report.passed=true;report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({passed:true,usage:report.usage,oracle:report.oracle}));
}catch(error){report.error=redact(String(error));save();console.error(report.error);process.exitCode=1;}finally{await engine.close();repo.close();}
