import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
const path = resolve(process.argv[2] ?? '');
const raw = JSON.parse(readFileSync(path, 'utf8'));
assert.equal(raw.runs.length, 6, 'Need all six trials');
assert.ok(raw.runs.every(r => r.finishedAt), 'Wait for trials to finish');
assert.equal(new Set(raw.runs.map(r => r.sessionId)).size, 6, 'Fresh sessions required');
assert.ok(raw.runs.every(r => !r.invalidBeforeWork), 'Preparation failures cannot count as valid trials');
const rows = raw.runs.map(r => {
  assert.equal(new Set(r.task.code.collaboration.members).size, 3);
  const advice = r.events.filter(e => e.type === 'file_relevance').map(e => e.data);
  const uncached = advice.filter(a => !a.cached).flatMap(a => a.candidates);
  const recovery = r.events.filter(e => e.type === 'provider_recovery_needed').map(e => e.data.message);
  return {
    task: r.kind, backend: r.backend, delivered: r.success,
    independentCheckPassed: r.oracle?.exitCode === 0,
    stage: r.task.code.phase, secondsUntilEnd: r.elapsedMs === undefined ? null : Math.round(r.elapsedMs / 100) / 10,
    reads: r.readCalls, findings: r.peerFindings, discussions: r.peerDiscussion,
    acceptedPeerAuthors: r.acceptedPeerAuthors, adviceCalls: advice.length,
    participatingAdviceUsers: new Set(advice.map(a => a.agentId)).size,
    uncachedScoredFiles: uncached.filter(c => c.status === 'scored').length,
    unscoredFiles: uncached.filter(c => c.status !== 'scored').length,
    reportedAdviceInputTokens: uncached.reduce((n, c) => n + (c.inputTokens ?? 0), 0),
    adviceTokenMetadataMissing: uncached.filter(c => c.status === 'scored' && c.inputTokens === undefined).length,
    generativeRequests: r.usage.requests - r.admissionUsage.requests,
    generativeTokens: r.usage.tokens - r.admissionUsage.tokens,
    sdkEstimateExcludingAdvice: r.usage.dollars - r.admissionUsage.dollars,
    providerRecoveryMessages: recovery, error: r.error ?? null,
  };
});
const totals = ['off', 'jev', 'laya'].map(backend => ({ backend, trials: rows.filter(r => r.backend === backend).length, delivered: rows.filter(r => r.backend === backend && r.delivered).length, independentCheckPassed: rows.filter(r => r.backend === backend && r.independentCheckPassed).length }));
const ranking = raw.rankings.map(r => ({ task: r.kind, backend: r.backend, sourceRank: r.targetRank, hitAt3: r.hitAt3, hitAt5: r.hitAt5, milliseconds: r.result.elapsedMs }));
const summary = { experimentCompleted: true, allTeamsDelivered: rows.every(r => r.delivered), rows, totals, ranking,
  limits: 'Two controlled tasks, one run per backend/task, not a representative benchmark. Failures retained. No human rescue. Preparation/auth/harness failures excluded. Advice tokens are additional to generative SDK estimates. Durations of incomplete runs are time until stopping, not successful completion times. No reliable causal or net-savings estimate.' };
const table = ['| Task | Advice | Independent check | Delivery | End after | Reads | Accepted peer authors |', '|---|---|---|---|---:|---:|---:|', ...rows.map(r => `| ${r.task} | ${r.backend} | ${r.independentCheckPassed ? 'pass' : 'fail'} | ${r.delivered ? 'completed' : 'incomplete: ' + r.stage} | ${r.secondsUntilEnd ?? 'not recorded'} s | ${r.reads ?? '-'} | ${r.acceptedPeerAuthors ?? '-'} |`)];
writeFileSync(join(dirname(path), 'summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(dirname(path), 'summary.md'), '# Controlled file relevance pilot\n\n' + table.join('\n') + '\n\n' + summary.limits + '\n');
console.log(JSON.stringify({ experimentCompleted: true, totals, ranking }, null, 2));
