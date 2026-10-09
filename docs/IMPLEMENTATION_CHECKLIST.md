# Product audit implementation checklist

Accepted scope: every recommendation in the 2026-10-09 full audit in PRODUCT_REVIEW.md. This checklist tracks that scope; it does not narrow it to the features in one release. STATUS.md remains the canonical current-state summary.

## 0.2.0-dev.5: implemented, subject to verification recorded in TESTING.md

- Task claims release when an owner is removed, including recovery of claims stranded by older versions. Removed participants' pending deliveries are cancelled. Human task transfer preserves findings and enforces dependencies.
- Shared-workspace and host edits use the same hash/lock/checkpoint implementation. Literal patches require one unique matching span. Checkpoint review and undo work for both scopes and reject intervening changes.
- Completion separates execution state from human acceptance. Failed/cancelled/interrupted jobs, tool failures and uncertain operations require review. Explicit human resolutions preserve original audit evidence. The headless exit policy returns nonzero for unresolved failures.
- Tool operations have durable prepared/committed receipts. Interrupted prepared operations block additional tool execution until human reconciliation. Live concurrent operations do not trigger this recovery block. External exactly-once execution is not promised.
- New sessions persist their canonical project root. Legacy sessions without one use their private workspace for project memory, rather than guessing from the launching folder.
- `/add-agent` opens guided provider/model setup without JSON, and normal model pickers hide the deterministic demo provider.
- Model effort/output/context controls use verified Pi 1.1.0 APIs and catalog bounds. Unsupported controls fail explicitly. Only currently authorized/configured tool schemas are active in Pi; schemas refresh at each prompt. Discovery distinguishes configuration from unverified health.
- Session/turn timeouts are exposed in normal settings and status. Changing the session timeout reschedules its current deadline; the turn timeout applies to subsequent turns.
- Tasks, artifacts, summaries, usage, filtered messages/activity and jobs have readable displays. JSON remains an explicit option for the main data views. Artifact export and file-change review use numbered selection.
- Buffered per-agent live text previews retain a suffix for cross-chunk redaction and emit complete lines. Final responses still render in full. This is not a full-screen terminal renderer.
- Human-selected PNG/JPEG/text/code/CSV snapshots have explicit audiences, hashes, size limits, durable storage and export without overwriting a destination. Model image compatibility is checked. Text is redacted before snapshot hashing/storage. Image bytes are preserved exactly. Optional version links exist in the storage API.
- Human message audience supports one participant, a group or broadcast. Multiline drafts survive restart. Queued human deliveries can be edited, cancelled or moved to the back without changing original transcript entries or already delivered copies.
- Sessions can be named and archived. Archived sessions remain resumable by ID; resume removes the archive flag.
- Explicit workflow stages enforce readiness barriers and human advancement. Independent exploration restricts peer communication and tools to a narrow allowlist; each participant can be required to publish a new artifact. This prevents new in-app sharing during the stage; it cannot erase knowledge from earlier context. Use fresh sessions for independent comparisons. External filesystem/MCP tools are withheld during this stage.
- The contribution board stores findings, disagreements and proposed decisions with exact artifact hashes. A different participant can invoke a deterministic JSON/required-field validator. This checks integrity and structure, not semantic truth or general task correctness.
- Job completion/interruption and approval decisions produce durable, deduplicated owner notifications. Paused sessions retain notifications for resume.
- Transcript retrieval applies its thread filter and limit in SQL.

## 0.2.0-dev.6: source milestone

- Portable `/backup`, `/fork` and `/import` preserve independent Pi v3 histories and bounded shared files/state. Imported branches are paused, untrusted, stripped of execution grants, and cannot replay pending deliveries. Old IDs resolve across repeated forks. See SESSION_RECOVERY.md for exclusions and privacy boundaries.
- `/project` explicitly reviews instruction snapshots, saves folder-specific lineups/defaults and applies instructions only by human request. Saved lineup permissions never grant capabilities.
- Project `@path`/quoted file mentions with Tab completion, external editor with saved drafts/recovery, atomic multi-file attachments and version-lineage UI.
- Arbitrary pending human message ordering survives restart and does not rewrite transcript order.
- Custom endpoint editing/removal and multiple model IDs per server, with model-specific context/output/image controls and readable previews. Affected current-session participants disconnect before approved mutation.
- This increment is source-only. The running/installed dev.5 harness has not been restarted or replaced.

## Remaining accepted scope

| Audit item | Implemented foundation | Still required |
| --- | --- | --- |
| 1. Finish/recovery | Owner release/transfer, failure review, durable receipts/notifications, stalled-task/dependency repair and required validators | Richer repair UI and further fault injection at external side-effect boundaries |
| 2. Coherent terminal | Ink conversation UI, stable composer/status, searchable arrow-key pickers, grouped live activity, safe paste and Unicode editing | Markdown/code/diff subset and inline budget/research validation implemented in dev.11; full syntax/tables, remaining legacy dialogs and fresh-user acceptance remain |
| 3. Composer | Audience, drafts/editor, file mentions/completion, queue edits/cancellation/arbitrary ordering and explicit Pi active-turn steering | Broader interactive terminal acceptance |
| 4. Files/deliverables | Scoped image/text/CSV/PDF/Office snapshots and text/binary artifact export | Image previews and graphical file browsing |
| 5. Project sessions | Root persistence, names/archive/search, reviewed instructions/defaults/lineups, forks, portable bundles and encrypted full-runtime backup/restore including Pi histories; killed-restore acceptance | Larger production-runtime and cross-OS restore acceptance |
| 6. Evidence collaboration | Explicit stages, independent exploration, contribution board, JSON validation | Prerequisite graphs/acceptance rules and recorded solo/team reports implemented; optional autonomous teams and measured hosted benefit remain |
| 7. Models/accounts | Supported login UI, model picker, effort/output/context controls and explicit provider fallback/recovery | Hosted fallback and Anthropic first-login/expiration acceptance; OpenAI login user-confirmed |
| 8. Safe execution | Constrained container JS, approved host commands and real WSL/Linux project sandbox with tested isolation/scoped grants/revocation | Aggregate cgroup limits, larger workloads and other OS acceptance. Host/MCP programs remain unsandboxed. |
| 9. Change review | Hash-protected writes/patches, attribution, change groups and optional commit-bound Git worktree review/merge | Rich diff rendering, binary/deletion proposals and stronger multi-file transactional recovery |
| 10. Integrations | Explicit MCP connections/allowlists, per-agent pool/reconnect/resources and instruction snapshots | Pi OAuth/templates and reviewed complete packages with sandbox script execution implemented; hosted OAuth acceptance and arbitrary native-plugin isolation remain |
| 11. Research/memory | Configured research service, scoped expiring human memory | SearXNG/JSON search, allowlisted page text/citations/cache and FTS implemented; rendered browser and richer evidence/freshness controls remain |
| 12. Release/evaluation | Local Windows installer/rollback and deterministic coverage | Published reproducible release, fresh-machine/OS matrix, live-provider matrix, fresh-user study and matched outcome/cost/latency evaluations |

## Acceptance boundaries

Automated provider tests use deterministic mocks or local HTTP protocol fixtures. They are not live hosted inference. Account authorization requires the user's supported interactive flow; credentials are never copied from other applications. No remote publication or push is part of this milestone. Do not mark this checklist complete based on the local test count.

Sprint 1 implementation is documented in SPRINT_1.md. Sprint 2 implementation and explicit limits are documented in SPRINT_2.md; hosted/fresh-user acceptance remains separate. The two real sandbox tests require the documented Linux isolation runtime.


## dev.7 focused readability correction

Compact startup and grouped activity panels are implemented and tested. Successful raw tool results, peer chatter, intermediate narration and duplicated streamed text no longer flood the default interactive display. Full history remains available; errors/approvals remain visible. /view switches and saves compact/verbose mode. Still outstanding: full-screen live activity/composer refresh, keyboard/click expansion and improved conversation convergence.
