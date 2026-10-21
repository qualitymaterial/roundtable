# Coding acceptance: solo and reviewed work

Windows acceptance used actual Roundtable source from upstream commit `aaaedd5400aad6d7b0a0069481a03b44f2c9d35c`, without injecting an implementation defect. Disposable repositories and runtime data preserved the canonical checkout and existing sessions. Commands were approved host Node checks with OS privileges. These results do not establish sandbox isolation or general model quality.

Both modes used Sage as editor with the same model, source snapshot, brief, named check and limits within each pair. Reviewed mode added Lark and Vale. Independent real Pi/provider sessions read actual source/tests, ran the failing check, edited, reran checks and completed the runtime workflow. Reviewers read the resulting files. Provided tests stayed unchanged. Team proposals were checkpoint-integrated into disposable repositories; independently verified repairs were subsequently checkpoint-applied to this checkout without a commit.

| Task and stage | Mode | Requests | Tool calls | Tokens | SDK estimate |
| --- | --- | ---: | ---: | ---: | ---: |
| Diff line counts, initial scope | Solo | 12 | 9 | 52,419 | $0.047571 |
| Diff line counts, initial scope | Reviewed | 26 | 18 | 98,711 | $0.086674 |
| Diff including EOF rework, cumulative | Solo | 22 | 16 | 133,770 | $0.107577 |
| Diff including EOF rework, cumulative | Reviewed | 51 | 33 | 292,654 | $0.214974 |
| Courtesy recognition | Solo | 10 | 9 | 38,869 | $0.029472 |
| Courtesy recognition | Reviewed | 22 | 16 | 73,281 | $0.053799 |

SDK amounts are estimates, not invoices. Initial and cumulative diff rows must not be added together. Rework elapsed time includes a human inspection gap; it cannot establish a speed improvement.

The initial diff scope passed five provided tests and 320 independent assertions in both modes. Independent inspection found that **both missed an EOF-newline-only change**. The original report is preserved. A sixth regression and 180 additional independent assertions were added; both original sessions received one human rework request, repaired the source, reran checks and completed another review cycle. Each final diff solution passed all 500 expanded independent assertions. Both courtesy solutions passed four provided tests and 315 independent assertions. Final combined coverage was 1,630 independent assertions across four solutions. Completed sessions and a courtesy reply stayed quiet without more provider usage.

Reviewed mode demonstrated no correctness advantage on these small tasks and consumed more requests, tokens and estimated spend. Peer acceptance establishes that a review occurred, not correctness. Solo remains an explicit option. Larger changes, longer runs, other editors/providers, fresh users and other operating systems require further evidence.

## Reproduction and evidence

```text
npm run check
node scripts/live-coding-evaluation.mjs --run-live .roundtable <new-output-folder>
node scripts/live-coding-rework.mjs --run-live .roundtable <existing-output-folder>
```

Live commands are metered and need supported configured credentials. Read their argument guards first; use disposable output. The evaluator uses Roundtable's provider registry without copying credentials. Rework requires the matching initial report and unexpired leases.

Ignored evidence: `artifacts/verification/code-live2-20261014/` holds immutable `report.json`, separate `rework-report.json`, private SQLite/Pi records, worktrees and independent oracles. `artifacts/verification/orchestrated-coding-2026-10-14/` holds source gates, canonical integration receipt, terminal chunks and installed verification.

Preserved setup/verifier failures: a deep Windows Git worktree path exceeded Git's internal path limit (shorter worktree names fixed it); an initial integrity check falsely treated Git LF/CRLF normalization as changed tests (normalized content comparison fixed it). Neither establishes model success or failure. A stale task overwrite originally lost the accepted group receipt link; source and a regression now preserve it. Terminal inspection reconciled only the private acceptance record to its unique pre-existing accepted group, checkpoint and matching hashes, with an audit event. Original reports and source contents stayed intact.
