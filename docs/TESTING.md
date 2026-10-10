# Verification evidence

## 0.2.0-dev.9 visual refinement — 2026-10-09

`npm run check` passed typecheck, lint, production build and 117 tests with zero failures/skips (`artifacts/verification/dev9-check.txt`). The initial focused run passed 7/8: an old assertion expected the removed "open tasks" wording; updated it to the intended shorter footer. The next focused run passed 9/9, including new header/session/conversation ordering, no repeated objective, quiet footer, bordered composer and ASCII fallback coverage. Existing Unicode/28-column resize, masked secrets, exact approvals and keyboard behavior tests remain passing.

A source Windows PTY opened an isolated session, showed the header and objective above the transcript, placed the cursor correctly inside the bordered input, accepted `/rename product-design`, retained the new session label, paused with Ctrl+C, and exited with code 0 and restored terminal modes. No model calls or changes to user authentication were needed. The user reported successful OpenAI CLI login on dev.8; this is user-reported acceptance, not a new automated live-provider test. Pixel-level equivalence to the browser mockup is not claimed: fonts and background belong to the terminal.

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

## Settings integration verification — 2026-10-09

`settings-check.txt` records typecheck, lint, build and 57 passing tests. New checks exercise actual Pi auth metadata normalization; injected supported auth/browser events with masked key/code prompts; saved settings versus existing session limits; CLI defaults; failed model change retaining the prior adapter; participant/task/permission preservation; original Pi message IDs retained across a provider change; explicit immutable skill snapshots and manual-only/disabled cache denial; and a real local stdio MCP process using Pi's production transport with restricted environment and revoked configuration.

A Windows PTY fixture prompted for a nonsecret public entry, then a synthetic credential. The credential was received without echoed characters; pressing Up at the next prompt recalled only the prior public entry. This used a fixture string, never an actual provider secret. OAuth browser launching is tested through an injected launcher; completing OpenAI/Anthropic browser login with a real account remains unverified. External programs were fixture MCP servers, not the user's arbitrary applications. Initial compile/lint checks found readline typing and an unused metadata binding; those were repaired before the passing full run.

`settings-install-smoke.txt` verifies 0.2.0-dev.2 as an independent Windows installation: no copied private runtime, startup from another folder without Node/npm on PATH, matching version/doctor, validated release activation, refusal of a broken candidate, deterministic three-Pi demo and fresh-process recovery. Profiles and user PATH were not modified by this isolated check.

Installed final build: `20261009-105254-83214635` (`settings-installed-update.txt`). A fresh profile-enabled Windows PowerShell from the user's home returned `0.2.0-dev.2`. A real installed-app PTY check displayed the settings panel and seven saved-settings choices, then exited through Back without opening a model session. It used a new temporary runtime; existing credentials/configuration were not changed. These are execution-host checks, not a new user-terminal confirmation.

## Navigation and endpoint verification — 2026-10-09

`navigation-check.txt` records strict typecheck, lint, production build and 62 tests passed, zero failed/skipped. New tests exercise paginated command/model menus, search recovery/cancellation, persisted and stale favorites, absent authentication, real local HTTP catalog discovery, no-follow redirects, 64 KiB rejection, HTTP error handling, provider alias collisions, validated output/context sizes, credential exclusion, persisted endpoint registration, explicit diagnostic confirmation and honest failures. A CLI subprocess searches sessions, dispatches a command and switches between two sessions; both remain paused with zero provider requests.

First-pass navigation tests found an existing readline bug: consecutive menu answers could resolve one prompt repeatedly and disappear. The reader now detaches a resolved prompt immediately, queues subsequent ordinary lines, and consumes queued answers after EOF. Trailing pasted credential lines are discarded while secret entry is muted. After repair, all ten focused navigation/settings tests and the full 62-test check passed. A Windows PTY recheck confirmed hidden synthetic credential entry and Up-arrow history containing only the preceding public entry.

`navigation-install-smoke.txt` passed the Windows standalone installation, private-data exclusion, launch without Node/npm on PATH, version/doctor, release activation, broken-release refusal, deterministic three-independent-Pi demo, restart and caller cwd. No real hosted login, LM Studio or Ollama inference, remote MCP OAuth, or cross-platform runtime was exercised for this milestone.

Installed release: `20261009-112121-3ff57eef` (`navigation-installed-update.txt`). A fresh profile-enabled Windows PowerShell from the user home returned `0.2.0-dev.3`. The installed app opened a temporary session in a real PTY, searched `/commands status`, selected the result, rendered the status panel, and exited successfully. Existing profiles, PATH, credentials and private runtime were preserved. Already-running harnesses need a restart.

## Provider/model UX correction — 2026-10-09

The user's pasted 0.2.0-dev.3 transcript showed `/providers` still calling the legacy JSON listing. `/models` had the same path. Both now use an actionable provider/model browser. Shared pickers render terminal panels; `--json` preserves explicit structured export. Provider selection, sign-in routing, browse-to-apply callbacks, missing-auth refusal, bounded widths/control escaping, actual CLI navigation/favorite persistence and standalone JSON export have regression coverage.

`provider-ux-check.txt`: strict typecheck, lint, production build and all 65 tests passed on the first full run, zero failures/skips. `provider-ux-installed-update.txt`: standalone release 20261009-114724-6479c74f installed with existing profiles, PATH, private configuration and credentials preserved. A fresh profile-enabled PowerShell returned 0.2.0-dev.4. The installed `/providers` screen rendered bordered paginated choices; Anthropic selection opened Browse models/Sign in/Back and its model list rendered without JSON. The check used an isolated temporary session; no account login or live model change was made.


## 0.2.0-dev.5 verification — 2026-10-09

`npm run check` passed: strict typecheck, lint, production build and **85/85 automated tests**, zero skipped or failed. Evidence: `artifacts/verification/reliability-check.txt`. This includes new real Pi SDK activation/capability checks, local child-process failure exit checks, attachment bytes/restoration, UI/draft subprocess tests, workflow/evidence tests and concurrency/recovery fixtures. Existing three-provider tests use local deterministic HTTP endpoints through Pi, not hosted providers.

The first recovery run had one failure caused by Windows short/long path normalization during workspace checkpoint preview. Canonicalizing the workspace before computing relative checkpoint paths fixed it. An unused-binding lint error in the attachment metadata view was also corrected before the final passing check. These are repaired outcomes, not first-pass success.

No new hosted model call or real OpenAI/Anthropic OAuth completion was performed. No fresh-user study, multi-OS CI result, semantic model-quality uplift or hostile-code sandbox result is claimed. `Get-Command docker` found no Docker executable. Full product completion remains pending per IMPLEMENTATION_CHECKLIST.md.


Windows install smoke passed (`reliability-install-smoke.txt`): independent copied installation, private-data exclusion, launch without Node/npm on PATH, release activation/refusal, deterministic three-Pi demo, restart and caller cwd. A real Windows PTY launched the installed 0.2.0-dev.5 from the user home and exercised `/summary`, `/tasks`, `/queue`, `/status`, `/rename` and `/exit` without inference. That PTY exposed the old JSON-only `/add-agent` command; it now shares the settings wizard, and the final 85-test run covers selection/cancellation without provider calls. Normal pickers hide the demo provider. `git diff --check` passed (only existing LF/CRLF normalization warnings).

Final installed release: `20261009-125024-20e14b64`. `reliability-installed-update.txt` records successful private-data-preserving installation. Fresh profile-enabled `roundtable --version` returned `0.2.0-dev.5`; installed `dist/cli.js` SHA-256 exactly matched the verified checkout build. No remote push or package publication occurred.

## 0.2.0-dev.6 verification � 2026-10-09 (source only)

`npm run check` passed: strict typecheck, ESLint, production build and **96/96 tests**, zero failures/skips. Final evidence: `artifacts/verification/dev6-check.txt`. Eleven new tests cover portable branches with separate histories loaded by the real Pi SessionManager, structural ID remapping across repeated forks, no delivery replay or grants, hashes/path rejection, atomic import failures, offline CLI backup/import/fork with quoted paths, scoped project defaults and explicit CLI instruction review, file completion, literal external-editor arguments/recovery, atomic multi-file attachments/version history, durable arbitrary queue order and endpoint edit/remove/multi-model persistence with declined/approved menu flows. A full run passed before review; the final full run also passed after quoted-path, repeated-fork and unchanged-editor recovery refinements.

The first new backup fixture omitted the required message `type`, so that targeted run failed 1/3. The fixture was corrected and all three passed. This was not a production-routing failure. No other targeted or full-check failure occurred in this increment. `git diff --check` passed with existing Windows LF/CRLF normalization warnings.

A source-build Windows PTY used an isolated runtime and checked the dev.6 banner, `/project` menu/Back, actual Tab completion, `/backup`, `/fork` opening a paused branch with disabled host access, and `/exit`. Captured evidence: `dev6-terminal-smoke.txt`. Rapid scripted type-ahead after a menu can appear before the next prompt; a persistent composer/keyboard UX remains unfinished. GUI editors were tested via literal child-process fixtures, not a real Notepad/VS Code acceptance run. Detached editor launchers require a wait option; unchanged/failed output is retained for recovery.

Jev reviews flagged remaining scope/verification gaps without a concrete defect. Checked these against IMPLEMENTATION_CHECKLIST.md and actual test output, added the Windows terminal pass, and retained explicit limits. Its cost/usefulness report is advisory and does not establish quality or token savings. No hosted provider inference, OAuth completion, sandbox acceptance, fresh-machine or multi-OS acceptance was performed. No installation update, user harness restart, remote push, dependency addition or package publication occurred. Installed dev.5 remains untouched at the user's request.


## 0.2.0-dev.7 compact view verification — 2026-10-09

compact-check.txt: npm run check passed typecheck, lint, production build and 100/100 tests, zero failures/skips. Four new tests cover nested tool aggregation, no duplicated compact text/payload leakage, bounded responses, retained errors/approvals, saved display preference and persisted intermediate narration. Targeted terminal tests passed 7/7 on the first run. A Windows PTY rendered the synthetic compact-preview.mjs fixture: 20 successful tool calls from two participants produced one Activity panel and one response, with no internal file content. It was a renderer fixture, not a live model task.

Jev review raised uncertain completeness without a concrete defect; checked the requirement against the PTY output and documented that expansion uses /activity rather than a mouse-clickable card. Existing inter-agent acknowledgement loops are outside this display fix. No live provider calls or changes to user project files were made.

Installation passed (compact-install.txt), preserving private data. Release: 20261009-142847-c2db900e. A fresh profile-enabled PowerShell returned 0.2.0-dev.7; the installed CLI SHA-256 matched the tested checkout. A separate installed Windows PTY with an isolated runtime confirmed compact startup, /view verbose, /view compact and /exit. Existing user sessions were not terminated or restarted.

## 0.2.0-dev.8 — Ink, documents, steering and MCP

Final `npm run check` passed strict TypeScript, ESLint, production build and **116 tests**, zero failures/skips. Evidence: `artifacts/verification/dev8-final-check.txt`. Dependency installation completed with pinned Ink 8.0.0, React 19.3.0, PDF.js 6.4.299, fflate 0.8.3, saxes 6.0.0 and the display-width helpers. `npm run notices` preserved notices for 277 installed packages. No hosted-model inference was used for this increment.

Added tests exercise real PDF text and Office fixtures, XML/ZIP rejection and expansion bounds, scoped extracted-text delivery, atomic attachment batches, exact binary recovery/export, permissions/integrity, Pi steering at a real SDK tool boundary, pause/crash steering recovery, MCP resource allowlists and per-agent connection reuse/reconnect. Ink tests cover typed presentation, simultaneous identities, full approval commands, masked secrets without altering authentication values, paste/history/completion, Unicode editing, keyboard Ctrl+D, cancellation, color/ASCII fallbacks, 28/95-column resize and visibly escaped command controls.

Windows source PTY acceptance is recorded in `artifacts/verification/ink-pty-checks.md`: actual launch/settings, setup search/cancel, Ctrl+C, clean exit, deterministic three-agent demo, and session restore without inference. All ten demo acceptance checks passed. Early type checks caught the test fixture's ES2024 helper and missing entity-kind declaration; corrected before the passing gate. PTY inspection caught and repaired a cursor-position delay and replaced the demo's verbose JSON summary with readable check rows. These checks do not establish live OAuth/account behavior, fresh-user usability, real terminal resize across OSes, or GUI-editor acceptance.

Runtime-only checkpoint: 108 passing tests. Initial Ink gate: 114. Final gate after Unicode resize and approval-control coverage: 116. Existing session data and active user processes were preserved. Installer verification is recorded separately in `dev8-install.txt`; see STATUS for the activated release.

Installed release `20261009-150235-c16acb60` passed locked production dependency installation. A fresh profile-enabled Windows PowerShell returned `0.2.0-dev.8`; installed CLI and all three compiled UI module hashes matched the verified build (`dev8-installed-hashes.json`). An installed PTY launched `roundtable` from the user home, navigated `/settings`, and cancelled normally. `/editor` handed a deterministic Node fixture a TTY with raw mode disabled, then restored Ink with the fixture's two-line draft; `/cancel-paste` discarded it and `/exit` returned code 0 with terminal modes restored. The fixture used only an isolated test home and did not alter the user's editor settings. This verifies terminal handoff, not a GUI editor or live OAuth flow.

Installed dev.9 acceptance: release 20261009-151924-045c191e completed production dependency installation and doctor checks (dev9-install.txt). Fresh profile-enabled Windows PowerShell returned 0.2.0-dev.9, and a separate installed PTY launched the global roundtable command from the user home with the reference layout and correct input cursor. All five compiled CLI/UI hashes matched the tested source build (dev9-installed-hashes.json). User credentials, runtime configuration, and active harnesses were preserved.


## 0.2.0-dev.10 — Sprint 1

`$env:ROUNDTABLE_TEST_SANDBOX='1'; npm run check` passed strict types, ESLint, production build and **128 tests, zero failures/skips**. Captured output: `artifacts/verification/sprint1-final-check.txt`. Without that environment variable the two platform-dependent sandbox tests explicitly skip.

New coverage includes required hash-bound artifact checks and self-review rejection, completion blocking, stale owners/cancelled dependencies/cycle rejection, provider failure and explicit fallback rollback, actual Pi SDK admission against a localhost HTTP 401 endpoint, nested grouped apply/accept/undo with intervening edits, and a real Git worktree merge left uncommitted.

The existing WSL Ubuntu installation ran Bubblewrap isolation tests: host homes/drives and environment secrets absent, no external network route, process/tmpfs limits verified, candidate file capture leaves original files untouched, revocation interrupts execution and prevents reuse. The combined acceptance fixture recovers a failed provider, explicitly retries, creates/reopens SQLite inside isolation, validates an artifact independently and completes grouped review. Provider responses in this scenario are deterministic fixtures; process isolation and SQLite execution are real.

Runtime recovery tests cover an 8 MiB private workspace, encrypted fixture credentials, active-process refusal, wrong passwords, no overwrite, injected staging failure, an actual child process killed during restore, dead-stage cleanup/retry and restoration after deletion of the original home. Windows long/short path aliases, checkpoints and independent Pi history headers are rebased without changing transcript entries.

Initial checks exposed unnormalized host-root fixtures and a genuine nested Windows group-path mismatch. Those were repaired, then covered with nested-file and missing-original-home regressions. Type checking also caught excess properties on two newly added test fixtures; fixture declarations were corrected before the passing gate. No failures are suppressed.

Installed Windows terminal acceptance uses a separate test runtime: global command launch from the user home, /recovery, real /sandbox diagnostic, Ctrl+C pause, clean exit and hidden backup passphrase/confirmation. The first backup completion exposed raw JSON; it was replaced with readable backup/restore confirmation. Final install/hash evidence and the final backup/restore terminal readback are recorded in `artifacts/verification/sprint1-installed-checks.md`.

Jev advisory reviews inspected actual source changes. Their broad missed-requirement/verification probabilities provided no specific defect; scope was checked against SPRINT_1.md, and execution evidence was checked directly. Feedback remains unknown/no-difference rather than treating probabilities as findings or proof. Live hosted fallback, Anthropic credential refresh, fresh-user experience and other OSes remain unverified. No paid inference or user-runtime backup was attempted.

Final installed release: `20261009-155752-1322c851`. Fresh PowerShell reports dev.10; all 150 compiled files match source hashes. Final backup and restore confirmations were inspected in installed Windows PTY, both exited 0. Restored session readback confirmed rebased paths, paused state and disabled host roots/shell.


## 0.2.0-dev.11 � Sprint 2

The final gate is captured in `artifacts/verification/sprint2-final-check.txt`: strict TypeScript, ESLint, production build and **137 tests with real WSL checks enabled**. The first completed feature gate passed 136 tests; adding the isolated skill execution test raised coverage to 137. A later run caught the old five-recipe assertion after the sixth documented example was added. The test now checks six recipes and the new recipe's required-validation flag; the final gate then passed all 137 tests, zero failures/skips.

New deterministic tests cover control-safe Markdown parsing, before/after diffs, invalid-field retention and correction, FTS token prefixes/session scope/project expiry/deletion, complete package hashes/supporting files, prerequisite-cycle/ordering/required-task enforcement, source citations/session caching/origin rejection/redirect refusal and matched-session comparison constraints. Research-policy changes invalidate tool-call cache fingerprints, preventing stale cached reads after origin revocation.

A real localhost OAuth server exercises Pi's PKCE challenge/code exchange, callback state, dynamic registration, private endpoint-bound state, bearer refresh, runtime token redaction and MCP resource-template discovery. These are real SDK/HTTP flows with fixture credentials, not hosted account acceptance. The real WSL/Bubblewrap package test executes a captured Python script and verifies host paths are absent and output is a review candidate. Existing isolation/revocation, encrypted backup/restore, independent-agent, renderer and headless regressions remain in the full gate.

Two compilation errors were repaired early: an import initially preceded the CLI shebang, and SetupIO lacked the new optional validated-input member. No paid inference or private user-runtime mutation was used. Jev completion reviews checked incremental diffs; broad probability flags yielded no concrete finding, so acceptance was checked directly against source/tests and the bounded scope in SPRINT_2.md. No advisory score is used as proof of correctness.

Installed acceptance and SHA-256 readback are recorded in `artifacts/verification/sprint2-installed-checks.md` after the installer completes. Live third-party accounts, fresh-user studies, cross-OS operation, rendered browser automation and real matched model-quality studies remain unverified.

Final installed release `20261009-165542-3331dedf` passed locked dependency installation and doctor. Fresh PowerShell returned dev.11; all 168 compiled files matched the verified build. Real Windows PTY verified /research settings, invalid-field retention, Escape cancellation, readable /skills list and clean /exit. The installed deterministic demo returned 0 with three independent Pi sessions, three tool users, three acknowledged peer messages, a shared task and a validated artifact. Evidence: sprint2-install.txt, sprint2-installed-hashes.json, sprint2-installed-checks.md and sprint2-installed-demo.txt.


## Greeting control and reference UI pass (2026-10-09, dev.12)

Final gate: 146 tests passed, zero failures/skips with real sandbox tests enabled; strict type checking, lint and production build passed. Captured output: artifacts/verification/conversation-final-check.txt.

Eight new behavior regressions cover narrow courtesy matching; zero model calls/tools/tasks/artifacts across three independent Pi sessions for hello; peer notifications versus explicit requests; waiting persistence and cached-tool denial; missing-human-request tool gate; active versus idle timeout; failure/timeout live cleanup; and courtesy during streaming/steering. Renderer coverage checks the graphite composer, model footer, ready/working transitions, narrow live layout and NO_COLOR fallback. Existing collaboration tests use explicit actionable peer requests.

First full run found one stale fixture that recognized ordinary prompts by JSON field order; structural detection repaired it without weakening compaction assertions. The first new resize assertion incorrectly measured previously printed Static scrollback as live content; it now checks the mutable region. Early implementation type errors were resolved before the full gate. These local deterministic tests are not a hosted model-behavior study.

Windows acceptance evidence: conversation-installed-greeting.json and conversation-install.txt under artifacts/verification. A disposable three-participant session received one human hello and one Roundtable response; SQLite confirmed zero requests, tool events, tasks and artifacts. Installed CLI restoration, resume, clean exit and global command resolution were checked separately. Live compatibility admission remains metered. Existing user sessions, credentials and preferences were not used by these fixtures.


### Hosted CI portability repair

The test runner limits concurrent test files to two. Each file can create SDK sessions, parser workers and real child processes; bounding file concurrency avoids oversubscribing smaller hosted runners while preserving concurrent-agent tests. Production shell/parser deadlines remain unchanged. Canonical-path assertions resolve fixture paths (including macOS /var aliases). Shell/job failures now include fixture output and termination details, and job assertions allow timeout cleanup to finish. Hosted verification passed for the final runtime fix as recorded below.

Hosted probe https://github.com/qualitymaterial/roundtable/actions/runs/38009545882 isolated Windows PowerShell cmdlet discovery: the baseline reached process-ready but timed out before Write-Output at 15,046 ms; resetting module lookup after startup completed in 592 ms; importing the built-in utility module directly completed in 219 ms. Adding normal Windows variables or setting the inherited module path did not fix it, because PowerShell reinserts machine module paths during startup. The fix initializes built-in-only lookup, then parses the exact user command independently. Temporary diagnostic workflows were removed after collecting evidence.

Final verified source: b21d83a, https://github.com/qualitymaterial/roundtable/actions/runs/38009795308 . Windows, macOS and Ubuntu jobs all passed dependency installation, types, lint, build, 144 tests (3 opt-in sandbox skips) and the deterministic demo. Windows standalone installation also passed with Node/npm removed from PATH, version/release switching, invalid-release rejection, installed demo, fresh-process recovery and preserved caller directory. Windows approved execution took 2,950 ms; background execution/cancellation took 1,385 ms. Local npm run check passed 144 tests/3 skips (artifacts/verification/ci-shell-check.txt). No live provider inference or user installation replacement was performed.
