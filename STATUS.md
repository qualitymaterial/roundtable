# Roundtable current state

Updated: 2026-10-09. Canonical owner: this repository. Accepted scope: docs/IMPLEMENTATION_CHECKLIST.md. Sprint commands/limits: docs/SPRINT_1.md and docs/SPRINT_2.md. Evidence: docs/TESTING.md and ignored artifacts/verification/.

## Current milestone

Source 0.2.0-dev.11 implements the bounded Sprint 2 UX/integration work on top of Sprint 1. Node 24.19, Pi 1.1.0, Ink 8 / React 19.3. Independent contexts, execution-layer permissions, persistence and existing supported authentication are preserved. No paid hosted calls, imported credentials, telemetry or package publication were performed for these sprints. The owner authorized committing and pushing both sprints to GitHub on 2026-10-09.

## Operational functionality

Sprint 1 provides required artifact checks, task/dependency repairs, scoped WSL/Linux project isolation, grouped change review/undo, optional Git worktrees, explicit provider recovery and encrypted full-runtime restoration.

Sprint 2 adds restrained Markdown/code/diff presentation and inline invalid-field feedback in budget, research and initial endpoint settings. Skill packages preserve supporting files/licenses and integrity manifests; explicit staging plus per-agent sandbox grants enables isolated scripts. No automatic plugin execution occurs.

Official Pi MCP OAuth now supports browser callbacks, PKCE/state, registration, refresh and logout. Credentials bind to exact endpoints; additional authorization origins require consent. Templates can be discovered, while reading still requires exact URI allowlists. Existing trusted stdio remains outside isolation.

Configured SearXNG/JSON search and allowlisted page text retrieval produce cited, timestamped, hashed snapshots with session caches. SQLite FTS5 searches notes and project memory with scope/expiry checks. Workflow graphs reject missing/cyclic prerequisites and recheck required tasks/artifacts before approval. The evaluation command compares recorded solo/team sessions without inference or claims of model superiority.

## Verification

Captured sprint2-final-check.txt records strict type checking, ESLint, production build and 137 tests passing, zero failures/skips, with real sandbox tests enabled. The new local HTTP fixture exercises Pi OAuth end to end, refresh and resource templates. Research/cache/revocation, FTS, package integrity, inline input, prerequisite and comparison regressions pass. Real WSL execution of a staged skill script passes. Existing three-agent, recovery, backup and installation regression tests remain included. Initial shebang/SetupIO compilation issues and the stale recipe-count assertion were repaired before the gate.

Installed release 20261009-165542-3331dedf passed locked installation, fresh PowerShell resolution and all 168 compiled-file hash comparisons. Real Windows PTY verified the research picker, invalid-field retention/cancel, readable skills and clean exit. The installed three-agent deterministic demo returned 0 with all collaboration checks passing. Existing user sessions retain their loaded release until explicitly closed; private runtime data is untouched by acceptance fixtures.

## Remaining boundaries and next milestone

Markdown is a subset; page inspection does not render JavaScript; only one workflow stage is active; executable packages use the bounded Linux sandbox. Arbitrary native-plugin isolation, full legacy-dialog conversion, rendered browser automation, hosted OAuth diversity and fresh-user/cross-OS acceptance remain open. No real matched hosted-quality study was run. The next highest-value milestone is a user-accepted end-to-end task with configured real providers and integrations, followed by matched solo/team evaluation under equal budgets.
