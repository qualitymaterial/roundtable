# Usability and harness review — 2026-10-09

Roundtable has a working collaboration engine, but it is not yet a broadly accessible replacement for mature harnesses. The next release should make everyday work easy to start, inspect, recover and finish. Adding more agents does not by itself improve outcomes.

## Evidence and comparison

This review inspected the CLI, engine, Pi adapter, tools, storage, installer and tests. A real saved session stopped at 511,204 cumulative tokens against a 500,000 cap, while the SDK estimated about $0.15 against a $10 ceiling. This establishes the cause of that pause, not that the task itself succeeded. No private transcript is published here.

Official documentation reviewed on 2026-10-09 provides reference capabilities, not comparative benchmarks:

- [Claude Code overview](https://code.claude.com/docs/en/overview): first-use authentication, terminal/editor/desktop interfaces, skills, hooks and background workflows.
- [Claude Code checkpointing](https://code.claude.com/docs/en/checkpointing): recovery is a visible product capability; checkpoint coverage must be explicit.
- [OpenCode introduction](https://opencode.ai/docs/): provider connection, file references, plan/build interaction and undo.
- [OpenCode permissions](https://opencode.ai/docs/permissions/): discoverable allow/ask/deny rules and external-directory controls.
- [Aider repository map](https://aider.chat/docs/repomap.html): selecting relevant structural context instead of indiscriminately loading files.
- [Pi SDK](https://pi.dev/docs/latest/sdk): prefer supported session/context facilities behind Roundtable's adapter over a competing implementation.

Roundtable should match these everyday conveniences while retaining independent providers, shared objectives, and non-coding work. No claim of feature parity or superior benchmark performance is made.

## Immediate correction

Budget handling now distinguishes tokens from estimated dollars, warns near a configured cap, pauses once, and retains completed responses. New sessions have no cumulative token ceiling by default; `/budget tokens off` disables it explicitly in existing sessions. Request, tool, exchange, timeout and spending controls remain. Existing sessions are not silently reconfigured. Adjusting one ceiling preserves every other ceiling and usage total. Restored paused sessions can be inspected before paid model probes.

The review initially found compaction disabled. The integration below now enables metered native Pi compaction and exposes `/context` and `/usage`. Current cost values remain SDK estimates; configured local endpoints can report zero cost without proving zero operating cost.

## Integration ledger — 0.2.0-dev.1

The backlog below records the original gaps. This ledger records implementation, without claiming every acceptance gate has passed.

| Recommendation | Integrated now | Remaining acceptance/work |
| --- | --- | --- |
| Guided first run | Provider/auth/model selection, configurable participants, none/read/edit folder access, separate shell opt-in | Fresh-user hosted onboarding and custom endpoint editor |
| Context management | Independent native manual/automatic Pi compaction, guarded requests and summary usage, retained original entries | Hosted summary fidelity and long-task convergence |
| Completion | `/summary`, open tasks/approvals/deliveries/jobs, artifact check records, explicit human `/finish` | General-purpose validators and autonomous completion policy |
| Concurrent editing | Session owner claims before recovery, canonical file claims, hash conflict checks | Cross-database coordination and isolated worktree reconciliation |
| Recovery | Ctrl-C cancellation, bounded metered transient retries, interrupted job records | Fault injection across more provider/network failure classes |
| Checkpoints | Private before-images, `/changes`, bounded `/diff`, guarded `/undo` | Multi-file transactions and preview-before-apply; shell effects stay outside coverage |
| Permissions | Guided read/edit presets, effective roots, exact background command approval | Hardened isolated execution profile and hostile-code validation |
| Terminal | Multiline drafts, direct messages by name/ID, progress, no-color output | Searchable history, richer file references, safely buffered live token rendering and session picker |
| Background work | Approved jobs, bounded logs, inspect/cancel, interrupted recovery | Daemon ownership, reconnecting to surviving jobs and live log follow mode |
| General artifacts | Existing text/JSON provenance and integrity remain | Binary attachments, document renderers and configured browser integration |
| Reuse | Human-curated project memory, expiry/delete/provenance; four strict non-executable workflow recipes | Memory review UI, richer workflow execution and trusted skill lifecycle |
| Provider reliability | Per-agent token/cache components, cost provenance, metered retries and probes | Quota/latency diagnostics, broad hosted coverage and deliberate fallback UI |
| Distribution | Version command, validated local Windows release switching, source update path, OS CI matrix | Signed release assets, uninstall/update UX and actual remote Linux/macOS results |
| Integration | Headless NDJSON run with status/exit codes through the same engine | Versioned public API, multiple MCP servers, editor/desktop/web adapters |
| Collaboration value | Deterministic protocol/transport tests and earlier staged hosted evidence | Matched solo/team artifact evaluations on arbitrary objectives |

No new hosted inference, signed release, browser automation, desktop interface or competitive benchmark result is claimed by this integration.

## Ranked implementation backlog

| Priority | Capability | Current gap | Acceptance check |
| --- | --- | --- | --- |
| P0 | Guided first run | Adding participants requires JSON/model IDs; empty sessions are confusing | A new user selects a provider, completes supported auth, picks a tested model, chooses folder access and completes one task without editing JSON |
| P0 | Long-session context management | Compaction disabled; growing tool/history content repeatedly consumes input | Independent per-agent compaction with original-history links, retained constraints/open tasks, budgeted model calls and tests for summary failure/restart; no merged agent context |
| P0 | Reliable completion and idle state | No explicit session-level completion contract; text saying "done" is not proof | Show completed tasks, artifacts, validation, unresolved items and active work; stop unnecessary follow-up calls; distinguish idle, waiting for approval, interrupted and verified complete |
| P0 | Safe concurrent editing and session ownership | Hash checks exist, but no cross-process owner lock or coordinated file claims | Second process cannot silently recover a live session; conflicting edits are detected, isolated or queued without overwriting user work |
| P0 | Recovery and cancellation | Pause/retry exist; provider failure recovery and active-input interruption need work | Escape/Ctrl-C behavior is predictable; interrupted jobs stay inspectable; bounded 429/transient retries honor backoff, cancellation and budgets without replaying side effects |
| P1 | Checkpoints, diffs and undo | Whole-file hash edits; no user-facing restore | Preview a patch, checkpoint affected files, restore only approved changes and detect intervening user edits; label shell/external effects that cannot be undone |
| P1 | Approvals people understand | Exact command approval exists; no permission setup wizard or policy presets | Read-only, project-edit and isolated-execution profiles show effective roots/network/commands; an allow rule never silently becomes arbitrary shell authority |
| P1 | Better terminal interaction | Completed blocks, UUID-heavy commands, basic line input | Multiline paste, file/agent references, selectable sessions/models, searchable history, streaming with redaction, readable progress and accessible no-color rendering |
| P1 | Background jobs | Host commands end after 60 seconds; no durable jobs | Start, inspect, stream logs, stop and recover long builds/research jobs; bounded output, process-tree cleanup and explicit ownership |
| P1 | General-purpose artifacts and tools | Basic UTF-8/JSON artifacts; limited research endpoint and MCP configuration | Attach and retrieve PDFs/images/spreadsheets/documents with provenance and explicit access; configured browser/research tools cite evidence and handle untrusted pages |
| P1 | Reusable knowledge and workflows | Notes are durable but no curated cross-session memory, workflow library or lifecycle | User-approved memory with provenance, scopes, expiry and deletion; trusted instruction/skill loading; versioned recipes for research, writing, analysis and coding |
| P1 | Provider reliability | Probes exist; missing ergonomic diagnostics and per-agent metering | Explain auth/protocol/quota/network failures; expose request latency, token components, estimated/unknown cost and model capabilities; consent before fallback sends data elsewhere |
| P1 | Distribution and upgrades | Windows source installer works; no signed releases or update/rollback command | Fresh Windows install, update, rollback and uninstall preserve user data; CI installs and runs demos on Windows/Linux/macOS before claiming portability |
| P2 | Integration surfaces | Terminal only; partial extension/MCP configuration | Headless JSON events and stable SDK, multiple authenticated MCP servers, editor bridge and optional desktop/web views sharing the same engine |
| P2 | Proven collaboration advantage | Staged demonstrations pass; open-ended convergence is unproven | Compare solo and team runs on the same coding/research/document/data tasks; independent artifact checks, total cost/latency and failure recovery determine success |

## Collaboration should earn its cost

Keep ordinary work efficient with one participant when that is sufficient. Let the human or a session policy select parallel exploration, a second opinion, independent validation or negotiated delegation. Do not mandate a coordinator or deprive other agents of tools. Show why additional work was scheduled, which evidence it produced, and whether it changed the result. Auto-routing must never silently switch providers or expand permissions.

Useful team capabilities beyond feature parity: task dependencies with conflict handling; evidence-linked claims and disagreements; bounded independent verification; artifact handoffs with schemas; isolated worktrees where appropriate; merge/reconciliation controls; and a final report that identifies remaining uncertainty instead of manufacturing consensus. These are planned, not claims about the current scheduler.

## Quality gates

Use a small versioned suite spanning repository edits, cited research, document production, structured analysis, automation and troubleshooting. Score artifact correctness, evidence validity, user intervention count, recovery, permission boundaries, cost and elapsed time. Keep deterministic tests separate from opt-in hosted evaluations. Include a clean Windows account, paths with spaces/non-ASCII text, offline startup, expired auth, malformed model tool calls, prompt injection, model refusal, interruption and two agents editing one file.

Start with onboarding and context management, followed by completion/recovery and checkpoints. Do not build a desktop dashboard before a new user can complete and recover a real terminal task reliably. Cross-platform CI, private vulnerability reporting and an independently reviewed execution boundary remain prerequisites for strong public reliability claims.
