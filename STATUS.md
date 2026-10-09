# Roundtable current state

Updated: 2026-10-09. Canonical owner: this repository's STATUS.md. Detailed evidence: docs/TESTING.md and artifacts/verification/.

## Current milestone

Working multi-agent terminal harness with host filesystem tools, approved host commands, global launch and a terminal UI pass. Native Windows, Node 24.19.0/npm 11.17.0, official Pi packages pinned to 1.1.0. The user confirmed successful Windows launch on 2026-10-09. Initial source commit 80a29d2 was pushed to main at https://github.com/qualitymaterial/roundtable and the remote commit was verified. npm publication remains disabled.

## Operational functionality

Independent Pi contexts, persistent configurable identities/providers/permissions, typed asynchronous messages with ordering, deduplication, acknowledgement and recovery. Shared tasks, notes, decisions, hash-checked artifacts, audit, approvals and usage persist in SQLite. All 15 required collaboration tools execute through Pi. Workspace tools, configured research/MCP and optional Docker remain available. Finite request/tool/exchange/concurrency/time/token/estimated-cost budgets apply.

Host tools list folders, recursively search, read UTF-8 text, create directories and create/edit files with expected hashes. Canonical roots and per-agent permissions constrain direct file tools; credential/runtime paths and escaping links are excluded. Host commands require exact, single-use human approval and run unsandboxed with OS user privileges, reduced environment, timeout and output limits. This differs from isolated Docker execution.

Windows source installer now creates an independent release under LocalAppData/Programs/Roundtable, with locked runtime dependencies, an absolute Node launcher, user PATH and managed PowerShell profile registration. Existing runtime configuration, credentials and sessions are preserved. This authorized profile permits reads on C:, writes in the current folder for new sessions, and host command requests. Startup loads saved agents and shows access; existing sessions retain their roots. Terminal panels show project, participants, budgets and approvals. Piped output stays plain.

## Verified results

Strict typing, lint, production build and all 36 tests passed again (windows-install-check.txt). Windows PowerShell 5.1 installer smoke passed standalone installation, private-data exclusion, launch without npm/Node on PATH, three-session deterministic demo, fresh-process session listing and cwd preservation (windows-install-smoke.txt). Profile registration and doctor passed in the execution environment (windows-installed-profile.txt). Earlier host/UI tests cover paths, permissions, approved commands, display and input handling.

Live global-command session `21619b05-ddcc-44e3-b3be-93340290e813` launched from a separate fixture folder: three hosted agents read a file; Vale created a file and verified it through an exact approved command. Totals: 18 requests, nine tools, 54,856 reported tokens, $0.02268772 SDK estimate (host-live.json). Earlier GLM/Haiku/Gemini staged collaboration passed artifact/restart acceptance after validator repair; open-ended convergence failed. Z.ai/OpenRouter use authorized Pi login in the ignored ACL-protected auth store.

## Limits and next action

The user confirmed the harness launched after using the standalone installer with -Launch. This resolves the reported startup failure. Bare-command launch in a fresh user terminal is a separate check; it passed in the execution environment but has not been separately confirmed by the user. Raw logs under artifacts/verification remain local and are excluded from Git along with credentials, runtime databases and generated files.

Codex OAuth, third-provider acceptance, Docker and Linux/macOS remain unverified. Delivery is at least once; sessions need one process owner. Host file guards have residual races and cannot detect every secret; shell timeouts are not hardened isolation. Trusted plugins have host privileges. Token-by-token rendering and full-screen UI remain absent. Installed executable is independent of the checkout, but current data configuration still points inside it. Preserve that runtime folder. Node must remain installed; old archives predate these changes.

Next: reduce tool/context output and test open-ended collaboration with validator feedback under explicit budgets. Acceptance requires a verified artifact, acknowledged peer exchange and fresh-process restoration. Public release follow-ups include cross-platform CI and a confirmed private reporting channel.
