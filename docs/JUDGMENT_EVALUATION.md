# File relevance pilot: 2026-10-16

Jev identified the required source better than local Laya on these two controlled retrieval cases. Neither assisted condition demonstrated more reliable completed three-model delivery. The feature remains optional and disabled by default. These observations do not establish a general causal benefit or harm.

## Protocol and scope

Six fresh Roundtable sessions used the same Sage (openai-codex/gpt-6-sol), Lark (zai/glm-5.3-flash) and Vale (openrouter/moonshotai/kimi-k3) lineup. The tasks were a historical Roundtable unifiedDiff defect and the current fuzzyChoices supplementary-Unicode matching defect, extracted into a small independently runnable leaf. Real Roundtable source files supplied distractors. This was controlled project work, not six improvements to the canonical application.

Each task ran once with advice off, Jev, and Laya; order was off/Jev/Laya for patches and Laya/Jev/off for picker filtering. Every session had separate Pi contexts, an isolated disposable Git worktree and the same limits: 100 generative requests including admission, 120 tools, SDK estimate $1.50, seven-minute session and 90-second turns. Advisory requests had an additional per-work cap of 60. No human repair, extra wake-up, compaction or retry occurred inside valid trials. Independent oracles were outside editable worktrees and hash-checked. Disposable integration required passing checks, accepted peer contributions and author-excluding reviews.

Both oracles were verified against failing baselines and positive references: 42 Git-apply round trips for patches and 35 independent Unicode cases for filtering. Expected target paths were withheld from relevance inputs. Jev used typesafe/jev-1.13-20260917 through OpenRouter. Laya 0.4.8 served multilingual on CPU, four threads, checkpoint revision 7b928d828b7b0e022f929d9bd2e44165aa270148. Excerpts were capped at 4,000 characters in the experiment. All four retrieval probes scored every candidate; Laya reported no backend truncation.

## Observed results

| Advice | Required-source ranks (patch / picker) | Patches passing independent checks | Completed delivery |
|---|---|---:|---:|
| Off | Not ranked | 1/2 | 1/2 |
| Jev | 1 / 1 | 2/2 | 0/2 |
| Laya | 8 / 4 | 1/2 | 0/2 |

| Task | Advice | Independent check | Final state | End after | Full-file reads | Accepted peer authors |
|---|---|---|---|---:|---:|---:|
| Patch | Off | Pass | Delivered | 210.0 s | 30 | 2 |
| Patch | Jev | Pass | Review incomplete | 283.3 s | 27 | 2 |
| Patch | Laya | Pass | Implementation incomplete | 208.7 s | 14 | 1 |
| Picker | Laya | Fail | Investigation incomplete | 90.4 s | 18 | 0 |
| Picker | Jev | Pass | Review incomplete | 222.6 s | 35 | 2 |
| Picker | Off | Fail | Investigation incomplete | 90.5 s | 8 | 0 |

Every assisted run recorded one relevance invocation by each of its three participants. Both Jev runs and the Laya patch run recorded all three grounded investigations and peer discussions. The two Jev runs accepted changes from both peers and passed the independent checks, but stopped before review completion. The Laya patch run passed the checker with only one peer author's contribution accepted. Both baseline and Laya picker runs stopped after roughly one turn with two findings and no discussion.

Request-abort/recovery events appear in both Jev runs and in the baseline/Laya picker runs. The Jev patch trial also records repeated review attempts before required full-file reading. These events and varying plans make this a workflow pilot, not an isolated causal measurement of ranking. Fewer reads or an earlier stop in an incomplete run is not evidence of efficiency. A passing patch is not a delivered result when independent review is missing.

The task-level advice audit recorded 14 and 7 uncached scored files for Jev, and 7 and 12 for Laya; other advice results reused successful rankings. Raw metadata separates advisory tokens from generative SDK usage. No net savings or invoice estimate is claimed. Two cases, one run per condition, small projects and provider interruptions are insufficient to recommend an automatic default.

## Preparation, implementation and evidence

Preparations are retained separately: pilot1 admission failed on expired Sage OAuth; the supported Roundtable SDK refresh restored tool compatibility. Pilot2 exposed an invalid ancestor package.json that prevented the external oracle from running and was stopped. Pilot3 establishes its own package scope and requires an actual behavioral assertion before live work. Neither preparation attempt counts in the table. Canonical source was not changed by the trial implementations; the picker bug remains a separate potential project fix.

Production boundary tests cover sensitive/dependency/traversal exclusions, no implicit cloud credential to Laya, malformed/oversized/stalled responses, refused redirects, cache invalidation, read barriers, pause and concurrent request reservations. A fresh-runtime installed configuration check caught an absent-directory defect, which was fixed and regression-covered. Final npm run check passed typecheck/lint/build, 195 tests, zero failures and three optional skips (198 total).

Dev.16's final installed build matched all 180 distribution hashes. From the normal user home/profile, version/init/doctor/mock demo and fresh judgment configure/status/off passed. One real installed native relevance request used explicitly selected Roundtable-owned OpenRouter auth, without copying credentials or changing defaults. Laya's temporary listener was stopped; cached weights and evidence were retained. User sessions, host policy, profiles and prior installations were preserved. New-user and cross-OS acceptance remain unverified.

Reproduce from this repository checkout with scripts/evaluate-file-relevance.mjs and scripts/summarize-file-relevance.mjs. Raw protocol, reports, per-session SQLite/Pi state, baselines, frozen oracles, positive references and summary live under artifacts/verification/judgment-2026-10-16/pilot3/. Source and installed verification live in the parent evidence folder. The raw report's `passed` field means all teams delivered and is false; summary.json separately marks the six-run experiment complete.

Jev is the more promising retrieval candidate from this pilot. Before promoting it, address review/readiness completion and request recovery, then use a broader held-out project set with repeated counterbalanced runs. Laya needs task-specific validation or adaptation before relying on its rankings.
