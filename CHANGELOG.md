# Changelog

## 0.2.0-dev.12

- Handle standalone greetings and thanks locally without activating agents or tools.
- Default peer sends to stored notifications; explicit actionable requests can wake recipients. Add durable per-agent waiting and prevent tool work without a human request.
- Exclude idle/setup time from the collaboration timeout and clear completed/aborted live indicators.
- Refine the Ink layout with a compact identity, shaded composer and model/status footer, preserving plain/ASCII fallbacks and scrollback.

## 0.2.0-dev.11 � Sprint 2: everyday UX and integrations

- Rendered a restrained Markdown/code/diff subset, grouped before/after previews and reusable inline field validation; replaced raw skill/MCP/memory/workflow views with readable menus.
- Added reviewed skill package manifests, supporting-file retrieval and explicit staging for isolated script execution.
- Integrated official Pi MCP OAuth browser login/refresh/logout with exact-endpoint credential storage, approved authorization origins and resource-template discovery.
- Added configurable SearXNG/JSON search, origin-allowlisted text page reading, cited timestamped snapshots and session caches.
- Migrated notes/project memory to SQLite FTS5 while preserving scope, expiry and explicit sharing.
- Added workflow prerequisite graphs, task/validation acceptance rules and recorded solo/team evaluation reports with explicit evidence limits.
- Verified local protocol, isolation and regression coverage. Hosted service/account, fresh-user, cross-OS and model-quality acceptance remain separate; see docs/SPRINT_2.md.

## 0.2.0-dev.10 — Sprint 1: reliable everyday work

- Added required artifact validation, independent checks, stalled-task diagnosis and audited dependency/owner repairs.
- Added scoped, expiring and revocable WSL/Linux Bubblewrap project execution with private copies, no external network and bounded output.
- Added grouped file review/apply/accept/undo and optional commit-bound Git worktree review with uncommitted merge.
- Added explicit per-participant provider fallback and connection recovery without automatic failed-message replay.
- Added encrypted full-runtime backups, conservative staged restore, process exclusion and killed-process staging cleanup.
- Passed 128 tests with real WSL checks enabled, strict type checking, lint and build. See docs/SPRINT_1.md and docs/TESTING.md for limits and evidence.

## 0.2.0-dev.9 — reference layout refinement

- Refined Ink styling against the supplied Roundtable reference: compact LOCAL header, session heading above the transcript, muted rounded composer and one-line footer.
- Preserved keyboard editing, exact approvals, provider login and noninteractive behavior. Added layout assertions and checked cursor placement and pause/exit in Windows PTY.
- Terminal font/background remain native. OpenAI login and improved interaction were reported working by the user on dev.8; this release does not change authentication.

## 0.2.0-dev.8 — Ink interface and shared documents

- Integrated Ink 8 / React 19.3 with a stable composer, searchable keyboard pickers, neutral theme, grouped live activity and scrollback transcript. Plain/NDJSON output remains available.
- Added bounded PDF/DOCX/PPTX/XLSX text extraction, exact binary artifact export and recovery support.
- Added explicit Pi active-turn steering with durable delivery tracking and conservative crash recovery.
- Added per-agent MCP connection pooling, explicit reconnect and exact-URI resource allowlists.
- Added deterministic renderer, input, document, steering and MCP lifecycle regressions. Live OAuth and hosted-provider acceptance remain separate.


## 0.2.0-dev.7 — compact conversation and activity panels

- Compact terminal startup and grouped per-participant activity panels instead of separate RUN/OK lines and JSON payloads.
- Intermediate narration and peer traffic stay in history; compact mode shows completed response previews once, without duplicated streamed text.
- Long responses have a bounded preview and an explicit full-history pointer. Errors and exact approval details remain visible.
- /view compact or /view verbose persists the preference. Piped/headless traces remain unchanged.
- Verified with 100 automated tests and an isolated Windows terminal rendering fixture. Full-screen live refresh and click-to-expand cards are not implemented.


## 0.2.0-dev.6 � project recovery and composition (source milestone)

- Portable private session backup/import and forks preserve separate Pi histories, workspace files, shared state and evidence. Imported branches start paused; grants, approvals, execution receipts and pending deliveries cannot replay.
- Explicitly reviewed project instruction snapshots, project participant lineups and default limits. Repository instructions are not loaded automatically.
- Project file mentions with Tab completion, atomic multi-file snapshots, attachment version history and a human-configured external editor with recovery files.
- Durable arbitrary pending-message ordering without rewriting the transcript.
- Edit/remove custom endpoints and configure multiple models with individual context/output/image settings. Affected current-session participants disconnect before approved edits.
- Installed dev.5 remains unchanged at the user's request; no restart, publication or push in this milestone.

## 0.2.0-dev.4 — provider and model screens

- Replaced legacy `/providers` and `/models` JSON dumps with searchable, paginated menus and sign-in/model actions.
- Choose a model, select "Use for a participant", and confirm the existing model change; browsing alone performs no inference.
- Render selection menus in bounded terminal panels, including favorites, settings, login methods and participant selection.
- Standalone provider/model commands browse interactively in a terminal, print readable listings in pipes, and export JSON only with `--json`.

## 0.2.0-dev.3 — navigation and endpoint setup (local development)

- Added searchable, paginated `/commands` (or `/`), `/sessions`, provider/model menus and saved model favorites.
- Resume now opens saved sessions paused for inspection. Switching pauses the previous session; `/resume` explicitly starts provider work.
- Added LM Studio/Ollama/custom endpoint setup with optional bounded server model discovery, environment-name authentication and unique provider aliases.
- Added a configuration diagnostics report and explicitly confirmed tool-protocol probes with separately reported usage.
- Fixed dropped input when several menu answers arrive together; trailing pasted credential lines cannot become chat messages.
- Binary attachments, remote MCP OAuth, endpoint editing/removal and a full-screen command palette remain planned.

## 0.2.0-dev.2 — settings and integrations (local development)

- Added in-session `/settings`, `/model`, `/login`, `/logout`, `/skills` and `/mcp`, plus standalone `roundtable settings`.
- Fixed Pi `apiKey` metadata normalization so API-key login appears in setup; use readable OAuth/device instructions and browser launching with masked credential/code prompts on one input reader.
- Model changes preserve participant identity/history/permissions/task ownership and retain the old model after failed admission. Session limits and saved defaults have separate scope.
- Added explicitly reviewed instruction snapshots and `/skill:name`, with independent agent discovery and no implicit tool grants or script execution.
- Added named HTTP/stdio MCP connections, test/enable/disable controls, exact tool allowlists, restricted child environments and configuration-aware cache authorization.
- Added tests for real Pi auth metadata, login event handling, settings scope, model/history preservation, skill revocation and actual stdio MCP. Live account sign-in remains unverified.

## 0.2.0-dev.1 — product review integration (local development)

- Added guided provider/model/auth and folder-access setup; saving setup disables legacy implicit current-folder write grants.
- Enabled independent native Pi compaction and bounded transient retries, with guarded requests, usage accounting, retained original history and cancellation.
- Added session ownership before recovery, guarded host file claims, private checkpoints, changed-span previews and conflict-aware undo.
- Added approved background jobs with durable bounded logs, cancellation and interrupted-state recovery.
- Added completion/usage reports, explicit human acceptance, multiline drafts and direct addressing by name.
- Added human-curated project memory with expiry/provenance/deletion, four non-executable workflow recipes and headless NDJSON execution.
- Added version reporting, validated local Windows release switching and an OS CI definition. The matrix has not run remotely.
- Local typecheck, lint, build and 52 tests pass. Windows standalone installation, release validation/refusal, demo and restart pass. Hosted tests for these changes remain unverified; advanced artifact/browser/editor features and comparative evaluations remain on the roadmap.

## Unreleased — budget recovery and usability review

- New sessions have no token ceiling by default; saved ceilings remain configurable with `/budget tokens <total|off>`. Other safeguards and usage records are preserved.
- Show exact exhausted budgets, warn at 80%, and emit one pause panel with recovery instructions. Reject resume until exhausted limits are addressed; changing one limit preserves all others.
- Let paid in-flight responses finish, acknowledge completed turns, and retain interrupted deliveries without duplicate provider-error panels. Restored paused sessions defer provider probes until explicit resume.
- Added regression coverage through two independent Pi sessions, CLI controls, restart and terminal rendering; full check passes 43 tests. Hosted inference for this patch remains unverified.
- Added a prioritized, source-grounded product review covering onboarding, compaction, recovery, checkpoints, permissions, background jobs, artifacts, provider reliability and evaluation.

## Windows installation and initial GitHub source publication — 2026-10-09

- Added a standalone per-user Windows installer with locked runtime dependencies, startup validation, an absolute Node launcher, user PATH registration and backed-up PowerShell profile integration.
- Preserved existing runtime configuration, credentials and sessions. Installed application files no longer depend on a development npm link.
- Verified installation from a different folder without npm/Node on PATH, the deterministic collaboration demo and fresh-process session recovery. All 36 application tests pass.
- The user confirmed that the harness launched in their own Windows PowerShell after running the installer with `-Launch`. A separate bare-command check in a new user terminal remains unconfirmed.
- Published initial source commit `80a29d2` to `qualitymaterial/roundtable` on `main`; runtime data and raw verification/session logs are excluded. No npm package publication is included.

## Host harness and global launch — 2026-10-08

- Added opt-in host directory listing, recursive search, UTF-8 reads, hash-checked file edits and directory creation with per-agent authorization and session roots.
- Added host commands with exact, single-use human approval, audit, timeout/output limits and a reduced environment. Host execution is explicitly unsandboxed.
- Added stable user-level runtime configuration and current-folder write access opt-in, so the installed `roundtable` command can reuse models, auth and sessions from any folder.
- Refreshed the terminal with project/session/access panels, participant cards, agent colors, tool statuses, budget and approval panels, slash completion and preserved input during background updates. Redirected output remains plain. Escape/control injection is stripped from displayed content.

## Startup repair — 2026-10-08

- Interactive startup loads saved model configurations, reports connection progress and failures, and rejects chat when no agents are connected.
- A single terminal input reader preserves lines entered after the objective; `/save-agents` and `--agents <file>` support reusable membership configurations.
- Regression coverage exercises the CLI objective, saved agent admission, HTTP model response, persistence, empty membership and missing configuration errors.

## 0.1.0 — 2026-10-08 (local development release)

- Embedded official Pi SDK 1.1.0 with independent persisted agent sessions and restricted resource discovery.
- Added local SQLite state, typed asynchronous message routing, task coordination, artifacts, notes, budgets and approvals.
- Added terminal commands and deterministic three-agent demonstration with separate artifact validation.
- Added configured service research, allowlisted remote MCP and optional Docker execution.
- Added deterministic tests and release documentation. Subscription login and Docker execution remain unverified; no package or remote repository has been published.
- Added credential/model preflight and persisted collaboration acceptance with restart snapshot comparison.
- Verified three configured HTTP provider aliases through Pi's production transport; fixed compatible-endpoint environment key resolution.
- Fixed failed agent resumption, duplicate connection initialization and admission usage/budget accounting.
- Verified authorized Z.ai/OpenRouter key setup and live staged GLM/Claude/Gemini collaboration, including validator repair and restart acceptance. Open-ended convergence remains incomplete.


## 0.2.0-dev.5 — recovery and daily-use milestone

Added task transfer/removal recovery; shared guarded edits and literal patches; durable tool-operation receipts and explicit failure reconciliation; project identity; effort/output/context controls; readable views and buffered stream previews; scoped image/text/CSV snapshots; durable drafts and audience/queue controls; names/archive; staged collaboration, contribution evidence and independent JSON checks; owner notifications and SQL-bounded transcript retrieval. The full audit backlog is tracked in docs/IMPLEMENTATION_CHECKLIST.md and is not complete.


### CI portability and Windows host commands

- Compare canonical fixture paths on macOS, retain detailed shell failure output, and bound test-file concurrency.
- Initialize Windows PowerShell with built-in module lookup before parsing the approved command, avoiding slow machine-module discovery. Custom modules require explicit absolute-path import. Preserve approvals, literal scripts, exit status, timeout and cancellation.
- Verified Windows/macOS/Linux checks and demos, plus Windows standalone installation in Actions run 38009795308.
