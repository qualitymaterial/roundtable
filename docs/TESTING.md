# Verification evidence

Budget recovery patch, 2026-10-09: `npm run check` passed strict typing, lint, build and 43 tests (`budget-check.txt`, local). New cases reproduce and prevent repeated pause events, misleading interruption errors and replay of completed turns. Two real independent Pi sessions driven by deterministic model fixtures finish at the configured token ceiling and remain acknowledged after resume. Tests also cover optional token caps with spending enforcement, partial-limit preservation, warnings, CLI commands, deferred provider probes on paused restoration and recovery panel rendering. A first regression run exposed Zod defaults resetting unrelated limits; explicit-key merging fixed it. No hosted inference was run for this patch.

The updated Windows standalone installation passed its doctor check and a fresh installed-CLI smoke for set limit, pause, disable token cap, resume and inspect saved status (`budget-install.txt`, `budget-installed-cli.txt`). This used isolated test data and no live providers. The user's already-running session was not restarted or modified.

Publication check on 2026-10-09: `npm run check` passed strict typing, lint, build and all 36 tests (`github-initial-check.txt`, retained locally). The initial 61-file source commit passed the credential-pattern and excluded-path checks. Upstream license notices retain their original whitespace. GitHub `main` was verified against local initial commit `80a29d2` after pushing.

Verified on 2026-10-08 using native Windows, Node 24.19.0, npm 11.17.0 and pinned Pi SDK 1.1.0. Raw evidence is retained locally under artifacts/verification/ and excluded from Git because it can contain machine paths and session content. The summaries and reproduction commands here are public. Test success comes from process exit codes and assertions, not advisory model review.

| Check | Result |
| --- | --- |
| `npm ci --ignore-scripts` | Passed; 229 installed packages, 230 audited, zero reported vulnerabilities |
| Strict TypeScript | Passed for application and test source |
| ESLint | Passed |
| Production build | Passed |
| Deterministic tests | 36 passed, zero failed/skipped; strict typing, lint and production build also passed in harness-ui-check.txt |
| CLI subprocess smoke | Help, init, doctor, demo, list, export, validate, offline acceptance and restart/resume passed |
| Interactive startup repair | Passed saved-agent loading, objective/input preservation, model response and acknowledged delivery through a local HTTP fixture; empty membership and missing configuration errors also checked |
| Live interactive startup | Three independent hosted models connected and each replied to a human greeting; three acknowledged deliveries, nine requests, 9,451 reported tokens, $0.00798792 SDK estimate |
| Provider admission fixture | Two independent provider adapters passed nonce/tool-result receipt and Pi tool execution |
| Production provider transport | Three configured local HTTP/SSE provider aliases passed admission and independent Pi collaboration; actual Authorization headers checked |
| Acceptance failure cases | Rejected one-way/unacknowledged messages, single-writer tasks, damaged contexts, missing auth and unknown models |
| Research/MCP | Passed against real local HTTP protocol fixtures; no hosted service credentials used |
| Local package / standalone install | Passed; archive installed with 123 runtime packages and no development dependencies; packaged demo passed |
| Live hosted inference | Passed with three models across Z.ai and OpenRouter; human-staged workflow plus one validator repair, then fresh-process acceptance |
| Codex subscription auth | Unverified; requires supported OAuth login |
| Docker execution | Implemented, unverified against a daemon |
| Linux/macOS | Unverified; implementation uses portable Node APIs |

## Coverage

The global launcher also passed `roundtable doctor` from the user home in classic Windows PowerShell 5.1 with `-NoProfile` (windows-powershell-command.txt), in addition to the PowerShell 7/PTY checks.

Host harness verification: `host-check.txt` passed strict typing, lint, build and 33 tests before the UI changes. Added host tests cover canonical roots and Windows aliases, permission denial, credential exclusion, escaping links, hash conflict handling, cache revocation, and exact per-agent one-use command approval followed by real PowerShell execution. UI tests add panel wrapping, identifying provider/model and budgets, exact approval text, terminal control stripping and prompt preservation.

`global-command-doctor.txt` verifies the installed `roundtable` command from the user's home directory resolves the original runtime. `host-live.json` and `host-live.txt` record live session `21619b05-ddcc-44e3-b3be-93340290e813` launched with the global command from `artifacts/host-fixture`. Three hosted agents read the fixture; Vale created `created.txt` and ran an exact approved PowerShell read to verify it. The smoke operator approved only that preselected harmless command. Totals: 18 requests, nine tool calls, 54,856 reported tokens, $0.02268772 SDK estimate. No arbitrary automatic approval policy was enabled. A Windows PTY check also exercised the terminal header, objective, status/tools/approvals and exit with no live models.

Startup repair evidence: `artifacts/verification/startup-check.txt` captures strict typing, lint, build and all 30 passing tests. Existing CLI and transport tests were expanded. `startup-live.json` and `startup-live.txt` record successful no-argument startup with the saved `.roundtable/live-agents.json`, session `db766e31-4603-4e97-941f-0ea8009c5b6e`. All three hosted agents passed admission and responded: Z.ai GLM-4.7, OpenRouter Claude Haiku 4.5 and Gemini 2.5 Flash. The live smoke used a subprocess with piped input; manual Windows console rendering was not independently tested. No archive rebuild was performed for this repair; run the freshly built repository CLI.

Unit and budget tests cover schema rejection, routing validation, duplicate IDs, sequence order, lifecycle, fresh permissions, tool registration/removal, human approvals, task dependencies/atomic claims/transitions, artifact integrity/session scoping, workspace traversal/ADS/symlinks, tool replay, credential redaction, request/provider/tool/token budgets, queue limits and repeated-message/self-loop denial.

Integration tests run three independently persisted Pi sessions through a deterministic model stream. All three use actual registered tools, peer messages cross session boundaries, collaborators update a shared task, an artifact is published and a separate host step checks hash/schema/event order. Tests close and reopen SQLite, reconnect each Pi context, and restore a session in a different CLI process. Other tests cover bounded concurrent delivery, failure/retry, permission-denial audit, pause/cancellation, finite recursive conversations, incompatible provider rejection, configured research redirects, allowlisted MCP schema validation and result exchange.

`npm test` builds before testing the CLI. `npm run check` type-checks, lints, builds and tests. `npm run test:unit` selects unit/budget tests; `npm run test:integration` selects SDK/CLI/provider/network integration tests.

## First failures and repairs

- Initial install reported nine high lint-tree advisories. Updating typescript-eslint to 8.71.1 removed them; subsequent audit reported zero.
- A first CLI build used an unavailable readline `closed` type. Replaced it with an async input iterator and enabled noEmitOnError to prevent failed builds from emitting partial artifacts.
- tsx failed inside Codex's Windows restricted sandbox at os.userInfo before tests loaded. Approved host execution ran the assertions successfully.
- One workspace test compared Windows short and full path spellings. The assertion now normalizes via realpath; traversal/symlink checks pass.
- Initial lint caught unused variables; repaired before the passing full runs.
- Extending strict typing to test source caught two fixture-only typing errors; repaired before the final passing check.
- Production HTTP testing found that bare environment-variable names were sent as literal endpoint keys. Pi 1.1.0 requires `$VARIABLE` references; corrected and verified headers. The new server fixture also needed to decode OpenAI content arrays; corrected before the passing run.
- Admission metering previously recorded responses only after both probes succeeded. Usage now records each returned response; regression assertions cover incompatible responses and stopping the second probe at a token limit. Failed agent resume remains paused, and repeated connect calls retain existing adapters.

## Local package evidence

`npm pack --ignore-scripts --pack-destination artifacts --json` created an unpublished local archive. Its refreshed 60-file manifest is in artifacts/verification/package.json; no auth/database/environment/runtime-state files were included. A separate installation with `--omit=dev --ignore-scripts` installed 123 runtime packages; the refreshed archive replaced the application package in that installation. Its demo completed the task, independently validated SHA-256 `94bbbfd3b276355898d4479f7f6ce654c1aa1f8bad4b32181b5d3a1854bde4d7`, and a fresh process returned passed=true and matchesLastAcceptance=true. Latest evidence: continuation-package-install.txt, continuation-packaged-demo.txt and continuation-packaged-restore.txt. These are deterministic results, not live inference.

An earlier advisory completion check raised a nonspecific missing-requirement flag when hosted execution was unverified; subsequent evidence is below. Structured constraints still have no stage-enforcement DSL, and the terminal renders completed text. Advisory results do not replace assertions or establish workflow savings.

## Reproduction

```powershell
npm ci --ignore-scripts
npm run check
node dist/cli.js demo
node dist/cli.js session list
node dist/cli.js session resume <printed-session-id>
node dist/cli.js validate <printed-session-id>
node dist/cli.js session verify <printed-session-id>
```

For open-ended acceptance, configure auth, edit examples/live-agents.json, run `node dist/cli.js demo --live examples/live-agents.json --check`, then run without `--check`. For staged collaboration use `node examples/live-staged.mjs examples/live-api-agents.json`. Acceptance requires three independent persisted contexts, reciprocal acknowledged messages, contributions and tools, a jointly updated completed task, an independently checked and exchanged artifact, and no unfinished deliveries. Run `node dist/cli.js session verify <id>` in a fresh process and inspect passed and matchesLastAcceptance.

Latest full check: artifacts/verification/auth-wiring-check.txt (30 passed, zero failed/skipped). Local HTTP fixtures remain explicitly scripted. Live-preflight.txt records the historical missing-auth failure before authorized API-key setup.

## Hosted acceptance

Verified 2026-10-08 EDT (2026-10-09 UTC). Operator-authorized API keys were registered through Pi API-key login without printing values. GLM-4.7 and Claude Haiku 4.5 passed live nonce/tool-result checks (live-admission.json); Gemini 2.5 Flash also passed admission in the three-agent runs.

The first open-ended session, `81dc2698-2aa2-42be-abb1-afb48e22e1a5`, paused at its 500,000-token budget (500,751 reported tokens, 52 requests) with unfinished deliveries and invalid artifact fields. It failed acceptance. Unconfigured execution/research requests stayed unapproved. Transcript: live-collaboration.txt. Demo instructions now specify exact JSON fields, structured artifact references and available capabilities.

Staged session `27156577-1129-4f6c-952c-b1312687e179` used independent persisted Pi contexts for GLM, Claude Haiku and Gemini across two providers. Peers exchanged an architecture question and substantive response, appended task findings, independently synthesized an artifact, and completed the task. The host validator rejected the first artifact: its selected hybrid was absent from the alternatives. After restarting and reconnecting the original contexts, one bounded feedback step produced a corrected immutable artifact, peer-read and independently validated.

All ten acceptance checks passed: three successful tool users, five acknowledged peer messages, completed task, no unfinished deliveries, and artifact SHA-256 `d3a134974b01403599dd00e7180c14de099a762e190a5dcccc47c2148b849a4b`. A fresh process returned passed=true and matchesLastAcceptance=true. Evidence: live-final-acceptance.json, live-validator-repair.txt and live-restored-acceptance.json. Totals: 40 requests, 19 charged tool invocations, 187,242 reported tokens, $0.08868921 SDK-estimated cost (not an invoice or subscription quota measurement). Raise the consumed request limit explicitly before more connected work.

This is a reviewed design specification with four alternatives, five invariants and four ordered example events. No generated code was executed or external web research performed. Autonomous convergence, Codex subscription auth, a third provider, Docker and other operating systems remain unverified. The public staged example mirrors the operator workflow with one bounded validation retry and passed syntax checking; captured hosted execution used local operator scripts rather than an automated credential-bearing test.
# Windows installer verification (2026-10-09)

`npm run check` passed strict typing, lint, production build and all 36 tests again: `artifacts/verification/windows-install-check.txt`.

Run the additional Windows PowerShell 5.1 installation test from the checkout:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-windows-install.ps1
```

Passed on this execution host: runtime-only locked dependency installation into a separate release, no development junction, private root files excluded, launch from a different folder with Node/npm absent from PATH, deterministic three-Pi-session demo, fresh-process session listing and cwd preservation. Test data is retained in a unique temporary folder; profiles and user PATH are not changed by this test. Evidence: `windows-install-smoke.txt`.

Actual default installer plus a new profile-enabled Windows PowerShell `roundtable doctor` also passed here (`windows-user-install.txt`, `windows-installed-profile.txt`). No new live inference was performed. The user's PowerShell reported the previous npm launcher missing while this execution host saw it; the project manifest was visible to the user. On 2026-10-09 the user confirmed that the harness launched after running the new installer with `-Launch`. This is user-reported startup confirmation; a separate bare-command check in a fresh user PowerShell has not been reported.

## Product integration verification — 2026-10-09

`artifacts/verification/product-integration-check.txt`: typecheck, lint, production build and 52 tests passed, zero failed/skipped. This supersedes earlier counts for the development checkout. `productivity-tests.txt` captures focused native Pi compaction/manual failure/automatic threshold/original history/restart checks, metered transient retry and request ceilings, ownership recovery, checkpoint conflict handling and background approval/cancellation. The transport test uses scripted local HTTP providers through Pi's production request/SSE/tool path; it additionally verifies headless NDJSON and literal multiline input. Memory tests cover project scope, expiry, deletion, provenance and recipe schema restrictions.

`product-install-smoke.txt`: Windows PowerShell 5.1 standalone installation passed with paths containing spaces, private-data exclusion, Node/npm absent from PATH, matching version/doctor output, local release activation, refusal of a broken candidate without launcher mutation, deterministic demo, restart and caller cwd preservation. Test data was retained under a unique temporary folder. No user runtime, profile or PATH was changed by this isolated test.

A GitHub Actions matrix now defines Node 24 checks/demo on Windows, Linux and macOS plus the Windows installation test. It has not run remotely for this local change. Native Windows is the only OS verified here. Hosted compaction quality, first-time real-user onboarding, hostile-code isolation, general autonomous convergence, binary document workflows and solo-versus-team outcome comparisons remain unverified. Deterministic model responses are not evidence of hosted model quality.

Final cancellation check: the background-job regression also starts an actual sleeping host process, waits for its ready output, cancels it, and observes closure with a cancelled result. The executor owns cancellation and waits for the child close event, preventing an AbortError from releasing job/database state while output is still arriving. Full check remains 52 passed after this correction. This is cooperative local process cleanup, not proof against malicious detached processes.

Final standalone update: release `20261009-102525-d4b265c1` passed copied-application doctor; `product-installed-update.txt` records installation. A fresh profile-enabled Windows PowerShell from the user's home returned `0.2.0-dev.1` for `roundtable --version`, and the installed command listed all four workflow recipes. Existing profiles, user PATH and private runtime were preserved by `-NoUserIntegration`. This is execution-host verification; no new user-terminal confirmation or hosted inference is claimed.
