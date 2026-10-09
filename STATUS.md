# Roundtable current state

Updated: 2026-10-09. Canonical owner: this repository. Scope: docs/IMPLEMENTATION_CHECKLIST.md. Sprint documentation: docs/SPRINT_1.md and docs/SPRINT_2.md. Verification evidence: docs/TESTING.md and ignored artifacts/verification/.

## Current milestone

Source 0.2.0-dev.12 repairs the unsolicited collaboration observed after a human greeting and refines the Ink layout toward the latest supplied terminal reference. Both prior sprints were pushed as 826b9a4. The owner authorized committing and pushing these follow-up changes on 2026-10-09. No paid Roundtable inference, credential import, telemetry or package publication was performed.

## Operational functionality

Standalone greetings and thanks receive one local Roundtable reply, without model calls, tools, task creation or peer traffic. Actual requests and attachments retain normal independent-agent delivery. Peer sends now default to stored notifications; task requests or explicit expectsReply requests trigger turns. Notifications remain retrievable from thread history. Durable roundtable_wait blocks fresh/cached tools and peer-triggered work until targeted human/system input. Dispatched turns with no earlier substantive human request cannot execute tools. A greeting does not resume paused work or cancel existing active work.

The session timeout measures a continuous burst of collaboration/background work, excluding connection and idle human-input time; resource budgets remain cumulative. All delivered, failed, cancelled and timed-out turns clear live indicators. The UI uses a compact identity, graphite shaded input with green accent, quiet model/status footer, and full details through existing commands. NO_COLOR retains outlined input; narrow terminals hide model metadata. Duplicate restore-pause notices are suppressed. Inline scrollback is preserved.

Prior capabilities remain: independent Pi contexts, multi-provider configuration, execution-layer permissions, scoped Linux/WSL isolation, change groups/worktrees, recovery/backup, MCP OAuth/templates, reviewed skill packages, configured research, FTS memory, workflow validation and recorded session comparisons.

## Verification

Final conversation-final-check.txt: strict TypeScript, ESLint, build and 146 tests passed, zero failures/skips, including real sandbox tests. New tests cover three independent Pi sessions with zero inference/tool effects for hello, notification routing, durable waits, cached-tool denial, timeout/cancellation and UI modes. Existing collaboration, compaction, persistence and installation tests pass. A JSON-field-order fixture and static-scrollback resize assertion were repaired before the final gate.

Windows acceptance on a disposable installed session confirmed a single greeting response and zero requests/tools/tasks/artifacts in SQLite, plus resume and clean terminal exit. Installation details and final compiled-file checks are recorded with the acceptance evidence. Real user sessions and private runtime state remain untouched.

## Boundaries and next executable task

Courtesy matching is intentionally narrow English matching, not general semantic intent detection. Model adherence still determines scope after an actual request; explicit wake requests remain subject to budgets. Live provider admission still uses metered probes. Hosted behavioral validation, broader cross-platform acceptance, native-plugin isolation and rendered browser automation remain unverified or incomplete. Input stays inline rather than pinned to a full-screen viewport.

Next: user acceptance with configured real providers: hello should yield one local reply with no agent work; a concrete task should still complete with evidence; idle/wait and cancellation should remain quiet. Only run paid comparisons when explicitly requested.
