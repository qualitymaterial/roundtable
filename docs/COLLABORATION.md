# Project collaboration acceptance

The purpose of Roundtable is to combine independently configured models' reasoning, knowledge and skills to improve projects. Useful exchange, resolved disagreements, tested implementation and the delivered result are the primary criteria. Resource use remains visible. Earlier editor/reviewer cost comparisons do not establish the value of collaboration throughout a project.

The dev.14 workflow adds independent investigation, peer response, a recorded shared plan, explicit file claims, guarded implementation contributions, substantive questions/answers, and author-excluding review. `/team <task-id>` exposes the evidence and decisions; `/plan` shows current assignments and blockers. Direct editor/review and solo modes remain available.

## Observed live project improvement

The Windows acceptance used three real independent Pi sessions: Sage (`openai-codex/gpt-6-sol`), Lark (`zai/glm-5.3-flash`) and Vale (`openrouter/moonshotai/kimi-k3`). An actual Roundtable source snapshot, an editable regression scaffold and the existing coding guide formed the disposable project. The independent Git-application checker lived outside the editable tree. Exact host Node/Git checks were approved with OS privileges; this was not sandbox acceptance. No credentials were copied.

| Participant | Work and effect |
| --- | --- |
| Sage | Combined the findings, challenged a marker-only repair using Vale's EOF analysis, coordinated integration, wrote preview documentation, and identified two incorrect test expectations. |
| Lark | Implemented EOF-aware line matching and guarded source proposals, then corrected the additional suffix-context defect found in review. |
| Vale | Wrote and corrected regression tests, rejected Lark's mistaken interpretation of a JavaScript string, and found an additional source defect that the initial checker did not cover. |

All three read source independently and submitted grounded findings. All three then responded to peer ideas before the plan was recorded. Implementation was divided by file rather than assigning a permanent coder: Lark owned source, Vale tests, Sage documentation. Proposals from both peers were inspected and hash-applied by Sage.

The first checked solution passed 42 independent Git-application round trips and 13 contributed tests. During independent review, Vale found that more than three common suffix lines caused a no-newline marker to be placed on a non-final context line. The runtime held completion for changes. Lark repaired the guard; Vale added the missing regression; checks ran again, and both assigned reviewers accepted the new revision. No author approved its own file. The final live named check passed 42 round trips and 14 regression tests. A separate expanded checker passed 132 round trips including longer suffixes. Source, regression tests and the preview-boundaries section were checkpoint-applied to this checkout without committing; current documentation work was preserved.

This establishes a concrete case where communication and peer review changed the implementation and tests. It does not establish general superiority to a solo model or unattended reliability.

## Recovery, limits and evidence

This was not an uninterrupted first-pass success. Preserved iterations include a prose-only investigation stall, a Windows Git line-ending verifier error, test request/token/spending ceilings, a context guard pause, and rejected reviews using proposal IDs instead of the work revision. Repairs added bounded missing-stage continuation, explicit review revision/context, readiness reopening for concrete questions, correct idle accounting for durable notifications, and suppression of stale completed-work system actions. Independent Pi histories were compacted separately through the supported adapter; original histories remain retained. A human-only renewal reauthorized the same check commands and roots for 30 minutes without changing their scope. Models cannot renew leases.

The verifier's original Git invocation inherited global CRLF conversion. Its corrected invocation pins `core.autocrlf=false` and `core.eol=lf`; the original checker and before/after hashes remain preserved. The corrected original source reproduced the actual patch defect. The named command/path stayed fixed, and the corrected checker hash remained unchanged throughout final acceptance.

Ignored evidence: `artifacts/verification/collab-live-20261015/report.json`, separate `recovery*-report.json`, `oracle-repair.json`, `baseline-corrected.txt`, private SQLite/Pi histories and worktrees. Final authentic live result is `recovery8-report.json` (`passed:true`, two review rounds, quiet completion, disposable integration). Cumulative usage, including compatibility reconnects and recovery: 277 provider requests, 192 tools, 10,748,138 recorded tokens, SDK estimate $3.98175504. These are estimates, not invoices or an efficiency benchmark. Test controls were adjusted during recovery and recorded; final ceilings were not the initial ceilings.

`artifacts/verification/collaboration-2026-10-15/` owns source gates, canonical integration receipt, terminal acceptance and installed verification. The metered reproducer is `scripts/live-project-collaboration.mjs`; it expects an unfixed source baseline and refuses an already-fixed baseline. Do not run it against existing session data. Fresh-user, cross-OS and live sandbox acceptance remain unverified.

After delivery, the repaired scheduler was separately checked with connected real adapters: stale completed-work system notices were suppressed and a courtesy reply caused no new provider requests, tool calls, tokens or spend during an active three-second sample. One local courtesy exchange was expected. Compatibility probes occurred before that snapshot and are recorded separately in `active-quiet.json`. Verifier diagnostics from comparing the local exchange counter and reusing an identical test message remain preserved; neither was a task-model failure.
