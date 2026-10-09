# Changelog

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
