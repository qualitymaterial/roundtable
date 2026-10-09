# Changelog

## Windows installation and initial GitHub source publication — 2026-10-09

- Added a standalone per-user Windows installer with locked runtime dependencies, startup validation, an absolute Node launcher, user PATH registration and backed-up PowerShell profile integration.
- Preserved existing runtime configuration, credentials and sessions. Installed application files no longer depend on a development npm link.
- Verified installation from a different folder without npm/Node on PATH, the deterministic collaboration demo and fresh-process session recovery. All 36 application tests pass.
- The user confirmed that the harness launched in their own Windows PowerShell after running the installer with `-Launch`. A separate bare-command check in a new user terminal remains unconfirmed.
- Prepared the initial source publication at `qualitymaterial/roundtable`; runtime data and raw verification/session logs are excluded. No npm package publication is included.

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
