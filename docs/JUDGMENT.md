# Optional file relevance advice

Roundtable now has an optional `project_relevance` tool for participants working in isolated project worktrees. It supports Jev and local Laya. Advice is disabled by default; stall/completion judges remain future work.

## Configure

For Jev through OpenRouter, use Roundtable's own login and select the example:

```powershell
roundtable login openrouter
roundtable judgment configure examples/judgment-jev.json
roundtable judgment status
```

`credentialProvider: "openrouter"` explicitly selects this Roundtable runtime's OpenRouter credential. No other application's auth store is read. Alternatively replace that field with `apiKeyEnv: "OPENROUTER_API_KEY"`. Backend `jev-typesafe` uses TypeSafe's fixed HTTPS endpoint and defaults to `TYPESAFE_API_KEY`. Keys are never saved in judgment configuration or results.

For Laya, run a separately managed server bound to literal loopback, then configure:

```powershell
roundtable judgment configure examples/judgment-laya.json
```

The example uses `http://127.0.0.1:8000/v1/systemone`, model `multilingual`. Roundtable does not install Python, download models or start services automatically. See Laya's [HTTP guide](https://github.com/NandhaKishorM/laya/blob/main/docs/http-api.md). Redirects and non-loopback Laya URLs are refused. A local bearer token is used only when explicitly selected with `apiKeyEnv`; cloud credentials are never implicitly sent to Laya.

`roundtable judgment off` or `/judgment off` disables advice for **new work**. `/judgment` shows configuration. The human-owned `judgment.json` is in Roundtable's private runtime. Each new `/work` snapshots configuration; changing defaults does not rewrite an existing work item.

## Workflow and boundaries

After listing/searching, a participant supplies its assigned task ID, up to 20 distinct candidate paths and an optional focused query. The native project tool uses the worktree's existing authorization, hashes and audit trail; it does not require a separate MCP service. It reads bounded regular text only. Hidden/sensitive paths, dependencies, symlinks/junctions, binaries and files over 128 KB are excluded.

The selected backend receives the task, filename and redacted excerpt, one file per state, and returns a relevance probability. Results keep **all original candidates**, status, SHA-256, excerpt truncation, score, reported model and available token/truncation metadata, alongside scored paths in priority order. Missing backend truncation metadata means unknown. Scores are uncalibrated; low-ranked/unscored files remain accessible. No rationale is fabricated from a probability.

Ranking excerpts do not satisfy full-file investigation or independent-review barriers. Successful complete rankings can be reused within a session for the same configuration, query and file hashes. Changed content invalidates them. Changing weights behind the same backend/model name is not detected; pin services operationally. `/team` shows backend/request reservations; `file_relevance` audit events keep scores/cache status without raw excerpts.

Defaults are 1,600 excerpt characters, 15 seconds for the entire ranking, and 60 reserved file requests per work item. Configurable bounds are 200-8,000 characters, 0.1-60 seconds and 1-200 requests. Two requests run concurrently per invocation, sharing one deadline. Reservations are made before requests, including concurrent participants. There are no automatic retries.

Timeouts, missing credentials, malformed/oversized/error responses leave candidates unscored. Exhausted advisory budgets return a clear tool error directing ordinary inspection. Work lease, pause and cancellation checks remain in force. Advice cannot grant permissions, renew leases, resolve uncertain outcomes, pass checks, accept reviews or integrate changes. It does not replace other tool results. Advisory tokens/requests are separate from participant SDK cost totals.

## Controlled evaluation

See the [six-run pilot results](JUDGMENT_EVALUATION.md). Jev ranked source better in these cases, but neither assisted condition improved completed delivery; defaults remain disabled.

`node scripts/evaluate-file-relevance.mjs --run-live <Roundtable-auth-home> <NEW-output-folder>` explicitly runs metered comparisons. It needs Roundtable-owned OpenRouter auth and local Laya at port 19517. Six runs use two tasks based on actual Roundtable leaf functions, real source distractors, fresh three-model contexts, disposable Git projects and frozen external behavioral oracles. No canonical project edits are integrated.

Each run is capped at 100 generative requests, an SDK estimate of $1.50, seven minutes and 60 advisory file requests. SDK estimates are not invoices. The protocol separates admission overhead, generative usage and advice. It reports source-file ranks, correctness, peer discussion, accepted contributions, reads and time, preserving failures. A behavioral assertion must fail before work starts; import/auth/environment failures invalidate preparation. Valid trials receive no human repair, compaction or retry.

This is a small pilot with one run per task/backend, not a representative benchmark or reliable causal/net-savings estimate. Compare accepted results and regressions before speed/cost. The approach uses [Langfuse evaluation guidance](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge) without requiring its service. Jev's [typed API](https://docs.typesafe.ai/introduction) and Laya's [limits](https://github.com/NandhaKishorM/laya#honest-limits) do not establish equal capabilities.
