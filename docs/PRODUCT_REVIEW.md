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

## Settings and integrations follow-up — 0.2.0-dev.2

Implemented /settings and standalone settings; scoped current/default limits; identity-preserving /model with retained Pi history; Pi-supported /login and /logout with optional browser opening and masked prompts; explicit SKILL.md instruction snapshots and /skill:name; and named HTTP/stdio MCP connection management with exact allowlists. See [SETTINGS.md](SETTINGS.md) for supported behavior and the next UX priorities. Actual OpenAI/Anthropic account login, remote MCP OAuth, persistent servers and full executable skill-package support are not verified/implemented by this milestone.

## Full product audit — 2026-10-09, 0.2.0-dev.4

This section supersedes earlier priority ordering. Scope: current source, terminal flows, storage, independent-agent scheduling, provider adapters, tools, permissions, integrations, tests and packaging. This is a product/architecture audit with targeted reproductions, not a penetration test, exhaustive line-by-line proof, or a user study. Application code was not changed during this audit.

### Assessment

Roundtable is a working engineering alpha with a credible independent-agent foundation. It is not yet a dependable everyday harness for a general audience. The next step should be a complete, recoverable task experience: understandable setup, appropriate context, visible progress, safe changes, a verifiable deliverable and a useful handoff. More models and slash commands alone will not provide that experience.

Keep the independent Pi contexts, provider adapters, durable peer messages, task ownership, execution-layer permission checks, host-file hash guards, metered compaction/retries, session ownership, explicit integration trust and local-first design. Do not replace these with a mandatory leader or fixed personalities. The opportunity is optional collaboration that demonstrably improves an outcome, with the cost and contribution of each participant visible.

### Concrete findings

**F1 — High: removing a task owner can strand work. Reproduced.** A task remains claimed by the removed participant. Another participant cannot claim it, and cannot reopen it because transitions require the current owner. There is no human reassignment control. Reactivating the original owner is a workaround, but does not transfer responsibility to a replacement. Evidence: [task transitions](../src/tools.ts:121), [agent removal/state](../src/engine.ts:143). Fix with explicit transfer/release, owner-removal handling, stalled-owner detection and dependency recovery. Acceptance: remove an owner mid-task, reassign to a peer and finish without direct database edits.

**F2 — High: shared-workspace edits lack the protections of host edits. Reproduced.** Two authorized writers can overwrite the same workspace file; both calls succeed, the first content disappears, and no checkpoint is created. The reproduction uses sequential stale replacement, not a timing-race exploit. [workspace_write](../src/tools.ts:165) lacks expectedHash, file claims and checkpoints; [host_write](../src/host-tools.ts:139) has them. Unify guarded editing, add patch operations and introduce optional per-agent branches/worktrees for larger coding tasks. Acceptance: stale writes fail visibly, reviewed changes merge predictably, and direct edits are recoverable.

**F3 — High: failed background work can be classified as successful headless completion. Reproduced classification; exit consequence inferred from source.** A failed job with no other outstanding work produces `completionReport.state === 'idle'`. The headless CLI returns failure only when that state is not idle. Evidence: [completion report](../src/completion.ts), [headless exit handling](../src/cli.ts:461). Fix with separate execution status and acceptance status, including failed/interrupted jobs, tool failures and required validators. Permit explicit human waivers with reasons; do not equate no activity with success.

**F4 — High product gap: workflow modes are largely prompt guidance. Source-confirmed.** The scheduler dispatches pending messages the same way for open, goal, structured and parallel sessions. Policy and constraints are included in prompts, but there is no runtime stage graph, barrier, blind exploration phase, approval gate or stage acceptance contract. [Scheduler](../src/engine.ts:213), [workflow schema](../src/workflows.ts:7). Implement a small policy runner with prerequisites and exit criteria; retain free-form collaboration as a separate option.

**F5 — Medium: important model controls are missing. Source-confirmed.** Pi sessions explicitly set `thinkingLevel: 'off'`; AgentInput has no effort setting. Custom endpoints advertise text input and no reasoning. Switching a model therefore does not expose its full configurable capabilities. [Pi adapter](../src/pi-adapter.ts:32), [agent schema](../src/domain.ts:15), [endpoint registration](../src/providers.ts:33). Add capability-aware effort/output/context controls and clear unsupported-setting messages. Do not assume a catalog flag proves hosted availability.

**F6 — Medium: streaming exists below the UI but live answer text is not rendered. Source-confirmed.** Pi emits text deltas, while the CLI converts stream events to a composing indicator. Completed assistant text is later printed. [Pi stream subscription](../src/pi-adapter.ts), [CLI transcript](../src/cli.ts:52). Add per-agent buffered streaming, expandable tool results, markdown/code/diff rendering and a stable composer. Do not stream multiple writers into the same line.

**F7 — Medium: project identity is not a first-class session field. Source-confirmed.** SessionRecord stores the private workspace, but not the original project root/lineup/instruction policy. Project memory is constructed from the process's current directory even when restoring a session. Opening saved work from another folder can show a different project-memory scope. [SessionRecord](../src/domain.ts), [KnowledgeStore creation](../src/cli.ts:188). Persist project identity and resolve it before loading memory, permissions or startup defaults. Current safeguards preventing implicit new host roots on resume should remain.

**F8 — Reliability boundary: tool result caching is not transactional exactly-once execution. Source-confirmed design risk, not a reproduced crash.** Tool effects occur before the result cache is written; recovery can replay a delivery. A process failure between the effect and its durable receipt leaves ambiguity, particularly for remote MCP side effects. [Tool execution/cache](../src/tools.ts:60), [recovery](../src/storage.ts). Add durable operation IDs, prepared/committed/unknown states, provider idempotency keys where supported, and human reconciliation for non-idempotent unknown outcomes. Never advertise universal exactly-once external actions.

**F9 — Medium: tool availability and plugin isolation are incomplete. Source-confirmed.** Registry availability reflects permission, not whether Docker, research service or MCP configuration actually works; executionStatus is always ready. All registered schemas are passed to every Pi session, increasing context burden. Custom handlers have no registry-wide hard deadline and run in process; cancellation is cooperative. [Tool registry](../src/tools.ts:27). Separate installed/configured/healthy/authorized states, expose targeted schemas, and isolate third-party executable plugins with enforceable limits.

**F10 — Medium: long-running work still has poorly surfaced time limits. Source-confirmed.** Defaults include a fifteen-minute session timeout and a two-minute turn timeout. The numbered limit editor exposes tokens, cost, requests, tools, exchanges and concurrency, but not these timeouts. Advanced JSON can change them. [Limits](../src/domain.ts:22), [settings limit editor](../src/preferences-ui.ts). Put timeout/idle policies into normal settings and status, distinguish active progress from stalls, and preserve resumable work when a deadline is reached. Removing the token ceiling did not remove other stop conditions.

### Ranked product backlog

| Order | Improvement | Current gap and proposed outcome | Acceptance check |
| --- | --- | --- | --- |
| 1 | Reliable finish and recovery | Fix F1–F3; report done, blocked, failed or awaiting approval with evidence and next action. Wake affected agents after job completion, approval/rejection and dependency completion. | A removed worker, failed job and interrupted run recover without false success or manual DB edits. |
| 2 | One coherent terminal experience | Numbered menus are an improvement, but tasks, artifacts, activity, usage and summaries still expose object dumps. Add a persistent status area, readable cards, filtered transcript, keyboard picker, natural Back/cancel and inline errors. | A new user adds/changes a participant, grants access and finds a result without JSON or UUID transcription. |
| 3 | A capable composer | Add @file/path completion, multiline editing, external editor, draft recovery, queue inspection/edit/reorder, explicit direct/group/broadcast audience and turn steering. | A user safely corrects an active task and can see which agents will receive each message. |
| 4 | Files in, usable deliverables out | Current message input and artifacts are text-oriented; artifacts hold immutable text up to the tool limit. Add selected-audience file/image attachments, extraction, capability checks, binary artifact storage, previews, export and version lineage. | Compare a screenshot plus a CSV, produce a downloadable result and restore the exact inputs/output after restart. |
| 5 | Project-aware sessions | Persist project root, model lineup, reviewed instructions, trusted roots and defaults; add rename/archive/search/fork/branch and backup/import. | Resume from another folder with the correct project and permissions; fork without mutating the original history. |
| 6 | Evidence-driven collaboration | Ordinary human text currently broadcasts. Offer one-agent focus, parallel exploration, peer review and synthesis, with shared findings, disagreements, decisions and evidence links. Collaboration should be optional, not a three-agent tax on every prompt. | A multi-agent run improves a scored deliverable over a one-agent baseline, or explains why additional agents were unnecessary. |
| 7 | Model/account lifecycle | Finish real OpenAI/Anthropic sign-in acceptance; expose effort and limits, saved connection tests, expiration recovery, endpoint edit/remove, multiple models and optional explicitly approved fallback. Normal setup must not expose demo models as ordinary choices. | First-time sign-in, restart, expired-auth recovery and model replacement complete without editing JSON or migrating private credentials. |
| 8 | Practical safe execution | Exact-command approvals exist, but host/MCP programs are unsandboxed. The container tool runs isolated JS with no mounted project; it is not a general project-build environment. Add a tested project sandbox with controlled mounts/network, session-scoped grants and revocation. | A typical build/test workflow works with bounded approvals, while denied filesystem/network targets remain inaccessible. |
| 9 | Shared change review | Add real diff/patch workflows, a changed-files view, accept/reject groups, agent attribution, conflict detection and optional Git/worktree integration. Existing host checkpoints are useful but not full session rollback. | Two agents can produce independent changes, review a combined diff, and recover a direct edit without erasing user work. |
| 10 | Complete integration lifecycle | MCP starts/connects per operation; no persistent pool, remote OAuth, resources or reconnect UI. Skills snapshot one instruction body; supporting assets/scripts are not managed. Add manifests, explicit trust, pinned versions, dependency checks, update/remove and a bounded plugin host. | A reviewed real MCP integration survives restart/reconnect and an installed skill resolves its approved resources. |
| 11 | Research and knowledge tools | Web research currently requires a custom POST-JSON service. Add supported search/fetch adapters, citations, caching and optional browser inspection; add project-scoped full-text retrieval and evidence-backed decisions with freshness/expiry. Avoid a mandatory vector database. | Research conclusions link to retrieved sources, stale evidence is visible, and memory cannot silently broaden authority. |
| 12 | Release and evaluation discipline | Local 65-test baseline is valuable, but lacks broad live-provider acceptance, fresh-user studies and demonstrated quality uplift. Installation still originates in a source checkout; latest changes are unpushed. | Versioned reproducible release, fresh-machine install/update/rollback, verified OS matrix, live-provider compatibility matrix and measured task outcomes. |

### What would distinguish Roundtable

1. **A contribution/evidence board:** show what each agent investigated, produced, disputed or verified. Evidence can be an actual test result, a cited source, a file version or a human decision. Agreement alone is not validation.
2. **Dynamic, bounded teams:** the human chooses a budget and collaboration policy; agents negotiate work within it. No permanent architect/coder/reviewer roles. Extra agents should be justified by expected benefit and observable contribution.
3. **Independent verification as a first-class task:** use a separate context and deterministic validators where possible, bind findings to artifact hashes, and clearly separate untested assertions from verified results.
4. **Recoverable collaboration:** interruptions, account failures, model swaps and agent removal should preserve ownership, queued work, evidence and the user's last intent.
5. **Clear cost versus benefit:** show provider-reported token usage, estimated cost, latency and duplicate work. Support explicit cost ceilings without presenting subscription quota as known or forcing an arbitrary cumulative token cap.

### Baseline against established harnesses

These are feature baselines, not measured claims about comparative quality. Official [Codex CLI documentation](https://learn.chatgpt.com/docs/codex/cli) describes session resumption, image context, web search, MCP, permissions and editor integration. [Claude Code interactive documentation](https://code.claude.com/docs/en/interactive-mode) describes visible queued input and editing/steering controls. [OpenCode TUI documentation](https://opencode.ai/docs/tui/) documents @file references, an external editor and tool-detail controls. Roundtable needs comparable everyday interaction quality before adding an ambitious dashboard.

Recovery must have honest boundaries: [Claude Code's checkpoint documentation](https://code.claude.com/docs/en/checkpointing) explicitly excludes ordinary shell-command changes and limits subagent restoration. Roundtable should document similar limitations and offer Git or isolated-workspace recovery, rather than promise universal undo.

### Proposed evaluation gates, not implemented metrics

Following the [Langfuse guidance to tie metrics to decisions](https://langfuse.com/academy/evaluate/choosing-what-to-evaluate), start with local fixtures and human-reviewed representative runs. Do not default to telemetry or an uncalibrated model judge.

| Priority | Status | Metric | Source/evidence | Decision informed | Measurability |
| --- | --- | --- | --- | --- | --- |
| P0 | New | False-success rate | Failed tool/job/validator fixtures and headless exits | Block a release that reports failed work as successful | Deterministic expected states and exit codes |
| P0 | New | Recovery success/no duplicated effects | Process interruption and side-effect receipt fixtures | Gate recovery changes | Deterministic local effects; remote ambiguity explicitly labeled |
| P1 | Existing usage, new outcome evaluation | Verified task completion per cost/time | Representative coding, research, writing and data tasks plus current usage records | Decide whether multiple agents improve the result | Deterministic checks plus blinded human rubric; costs remain estimates |
| P1 | New | Time to first verified useful result | Fresh-user install/auth/task sessions | Prioritize onboarding and UX fixes | Manual user study; no study performed here |
| P1 | New | Human repair burden | Corrections, repeated approvals, stuck-task recoveries | Prioritize workflow friction | Manual review first; optional consent-based logging later |
| P1 | Existing guards, new broader coverage | Unauthorized side effects | Filesystem/network/plugin isolation fixtures | Block security regressions | Deterministic denied-action tests within tested deployment boundaries |

Use matched one-agent and multi-agent runs on the same task sets. Report first-pass success separately from repaired success, and include total provider requests, latency, cost estimates and human interventions. Start with a small diverse suite, then expand around observed failure clusters. Passing transport and scripted-demo tests alone does not establish usefulness.

### Execution order and scope control

**Milestone A: dependable core.** Fix F1–F3, add durable operation/recovery states, correct project restoration and add a useful completion report. Do this before expanding tools.

**Milestone B: daily-use experience.** Replace remaining raw-object screens, finish composer/steering, project/session controls, effort settings and real supported-account sign-in acceptance. Test with fresh users, not just developer transcripts.

**Milestone C: complete work.** Implement attachments, binary/document artifacts, reviewable patches and sandboxed project execution. A research/data/document task must be as usable as a coding task.

**Milestone D: prove the collaboration advantage.** Implement optional policy stages, independent validation and the evidence board; evaluate one-agent versus multi-agent quality and cost. Ship supported integrations and reviewed skill packages based on those workflows.

Defer a marketplace, arbitrary agent-created executable tools, always-on autonomous operation, cloud sync, voice, multi-user cloud infrastructure and a large desktop rewrite until the dependable task loop works. A future web/desktop UI should reuse a typed application command layer rather than copy the CLI switch statement. Avoid replacing Pi or building distributed microservices now.

### Verification and limits

- Existing current-build evidence: `provider-ux-check.txt`, strict typecheck/lint/build and 65 tests passing. That suite was not rerun merely for documentation; the audit added targeted runtime probes.
- Fresh isolated probes: `node artifacts/verification/product-audit-repro.mjs`; results in `product-audit-repro.json`. All three defect reproductions passed their assertions. They confirm problems, not fixes. No real model inference or OS shell job was used; the failed-job result is an injected executor fixture.
- `npm audit --omit=dev --json` returned zero reported production dependency vulnerabilities on 2026-10-09 (`product-audit-dependencies.json`). This is an advisory-database result, not proof of application security.
- Source confirms other gaps above; crash-window duplication and long-session performance were not fault-injected/benchmarked. SQLite transcript retrieval currently loads all session messages before applying its limit; add SQL-level pagination/indexing before long-session performance claims.
- Real OAuth completion, hosted compaction fidelity, actual LM Studio/Ollama inference, hostile-code sandbox testing, remote MCP OAuth and fresh multi-OS release verification remain unverified or incomplete. No new remote CI result was retrieved during this audit.
- No application changes, dependency upgrades, publication, credential changes or remote push were performed.
