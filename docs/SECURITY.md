# Security boundaries

Pi is an in-process agent runtime, **not an OS sandbox**. Roundtable supplies an explicit resource loader and tool allowlist: no Pi host-shell/file tools, project instruction discovery, skills, automatic extensions, MCP config discovery or external application auth stores are loaded. Agents call wrappers that enforce authorization; prompts are not the permission boundary.

## Implemented controls

- Safe default capabilities are collaborate, memory and artifact. Every agent has useful tools; shell, workspace writes and network services require additional grants.
- Session capability ceiling plus current per-agent permissions/state. Approval records are pending until a human explicitly decides; a grant does not automatically rerun a denied call.
- Typed bounded messages, duplicate protection, bounded queues, recent identical-message suppression, self-message denial, finite request/exchange/tool budgets, concurrency and execution timeouts.
- Separate shared workspace, traversal/ADS/hidden-name/symlink rejection, text size limits. This is restricted file access, not a sandbox for arbitrary code.
- Docker adapter has no host mounts or network and fixed resource/security arguments. Opt-in host commands require a single-use approval bound to the exact command, canonical cwd and agent. They run with OS user privileges and are not sandboxed. Git inspection also has a separate fixed-argument workspace tool.
- Research URLs and remote MCP servers are configured by the operator. No model-selected arbitrary URL access. MCP calls also require an exact tool allowlist. Service redirects are rejected; service calls time out.
- Known environment credentials and common bearer/key patterns are redacted from Roundtable logs and displayed tool results. No telemetry adapter is installed and model catalog network refresh is disabled. Provider calls and explicitly configured services still make intentional network requests.
- Auth, database, JSONL contexts and artifacts are excluded from version control. No bundled credentials.

## Deployment responsibilities and limits

Host access is disabled for an unconfigured installation. A human may opt into host roots and per-command shell approval. On this operator-authorized checkout, the saved policy permits reads from `C:\`, excludes common credential/runtime paths, and enables command requests; the global launcher also grants writes in the folder where a new session starts. A startup banner displays the effective roots. Existing sessions retain their persisted host roots. Policy changes invalidate outstanding command approvals and cached host results cannot bypass root changes.

Approved host commands can read personal files, start processes, access the network or modify files outside the working directory. The minimized environment omits provider secrets but is not a sandbox: commands may access credentials using OS privileges. Review the exact command before approval. Timeout/process-tree termination is best effort, not a CPU/memory quota or protection from a malicious detached process. Direct file guards do not detect every secret and have residual filesystem races; do not use this mode for hostile code. Binary files, deletion and general move operations are not exposed as direct file tools.

The Node process still has the user's OS permissions. Trusted modules have those privileges and cannot be made safe by a permission string. Load only inspected modules. The Docker daemon/image and remote MCP services are separate trust boundaries; a malicious image or vulnerable daemon is not solved by path validation. Docker itself must be installed, patched and suitably isolated. Code execution has not been tested against a Docker daemon here.

File checks are vulnerable to races if an external local process concurrently replaces workspace directories. Do not share the workspace with hostile host processes; use OS/container isolation for that threat model. Filesystem scoping does not protect against the human intentionally placing secrets in a shared file. SQLite/JSONL data are plaintext and unencrypted; protect ROUNDTABLE_HOME using filesystem ACLs, backups and a private user account. Windows inherits ACLs; the app does not provision a separate OS identity.

Redaction is best effort, not general data-loss prevention. Unknown secrets, transformed/split values, provider diagnostics and raw Pi session records may retain sensitive content. Do not place secrets in agent prompts, files or artifacts. Streaming fragments are not persisted by Roundtable, but UI extensions should buffer before redacting split credentials. Exports include session contents and workspace paths; inspect before sharing.

Delivery is at least once and external side effects are not transactionally coupled to SQLite. Use idempotent service operation IDs. In-process trusted plugins must honor AbortSignal; Roundtable cannot safely preempt arbitrary synchronous JavaScript or guarantee plugin CPU/memory limits. Strong isolation is required for untrusted executable extensions; no such loader is provided.

Pause stops new scheduling and asks active Pi runs to abort. Provider calls already accepted may still incur charges. Cost/token limits use available reported values or SDK estimates and can overshoot in-flight work. Quota availability and billing belong to providers.

Direct messages are not private from session peers. Agent instructions, artifacts, tool outputs and retrieved web text can contain prompt injection; treat them as evidence, not authorization. No automatic credential disclosure, candidate-tool execution or cross-agent escalation is implemented.

Each upgraded process now acquires a SQLite-backed host/PID session claim before recovering deliveries. A live second owner is rejected; a dead local PID may be reclaimed. PID reuse and foreign-host ownership conservatively block opening. Older versions do not participate in these locks: exit an old harness before opening the same session in the new version. Processes using different databases and external editors are outside this coordination boundary.

Host-write checkpoints contain original plaintext file content in the private database. `/undo` requires an applied checkpoint, current write authorization and an unchanged post-edit hash. Prepared/failed checkpoints cannot be undone. Shell effects, directory creation, separate workspace writes and external edits are not checkpointed. Claims and double hash checks reduce accidental conflicts but do not eliminate filesystem races.

Background jobs require an approval bound to the participant, exact command, cwd, background mode and timeout. Four jobs maximum, bounded output and one-hour maximum timeout apply; pause/exit cancel managed jobs. Crash recovery marks records interrupted without rerunning commands. Detached or orphaned OS processes may survive a crash; this is not a process supervisor or hardened sandbox.

Guided setup offers none/read/edit access to the selected folder and separately opts into unsandboxed command requests. It disables legacy automatic current-folder write grants. Curated project memory is saved only by a human command, scoped to the canonical launch folder, excluded from retrieval after expiry and shared only on explicit request. Forgetting removes the current stored entry, not prior shared messages or backups. Workflow files cannot declare executable hooks or permissions.

## Skills and named MCP connections

The new skills manager imports only the human-selected SKILL.md after review, parses it with Pi's frontmatter helper, and stores a bounded snapshot. Neither skill directories nor supporting scripts execute automatically. Skill metadata never changes execution-layer permissions. Manual-only skills cannot be read by models; revoked snapshots/configurations invalidate cached tool-call identities. Instructions already sent to a model cannot be recalled.

Named MCP programs require explicit configuration and enabling by a human. Stdio programs inherit a minimal OS environment plus explicitly named variables; provider keys are excluded by default. This does not stop a trusted local program from reading credentials through OS privileges: stdio is not sandboxed. Connections have exact tool allowlists and per-agent/session permission checks. Configuration changes affect future calls, while an already-authorized in-flight request can finish. HTTP redirects are rejected; remote MCP OAuth and persistent server sessions are not implemented. See docs/SETTINGS.md for supported boundaries.


### Input snapshots and staged work

PNG/JPEG input snapshots preserve the selected bytes, including any embedded image metadata. Text/code/CSV snapshots redact known credential formats/environment secrets before hashing; they are not forensic copies. Attachment authorization is checked per recipient and session, with integrity verification on retrieval. Do not attach a sensitive image expecting text redaction to remove its contents. No PDF/Office extraction or automatic external viewer is enabled. Snapshot export uses exclusive creation and will not overwrite a destination.

Independent-exploration stages restrict new in-app peer sharing and shared/host/MCP tools. They do not erase prior context or provide operating-system isolation. Use new independent sessions for blind comparisons. New file checkpoints include scope and author. Legacy host checkpoint behavior remains supported; shell/external effects stay outside undo guarantees.

## Portable state and editor boundaries (dev.6)

Backups contain conversation histories and selected file bytes. File/path exclusions and checksums do not prove absence of secrets, trustworthy provenance, or safe instructions. Keep bundles private. Import creates a paused branch, restricts capabilities, removes effective execution approvals, and never replays deliveries or jobs. Pi histories remain untrusted conversation data; loading a backup is not an executable extension installation. Imported project instructions require new review. Backup excludes the host project itself, authentication, provider/MCP configuration and cross-session memory.

The external editor is an explicitly human-selected program with the human's OS privileges. It runs with literal executable/argument separation, without a shell; this is not agent sandboxing. Existing unsent drafts survive launch errors, and recovery files can contain private text. File mentions are bounded selected snapshots inside the canonical project root; `/attach` remains the explicit external-file selection route.

## Document and presentation boundaries (dev.8)

Document parsing runs in a disposable worker with a 128 MiB old-generation heap limit and a ten-second wall-clock deadline. A worker is not an OS sandbox and the JavaScript heap limit is not a total-process RSS guarantee. PDF.js receives bytes, no resource URLs, and a denying external-data factory; no PDF scripts/forms are executed. Office ZIP parsing bounds selected expansion and rejects unsafe paths, macros and document type declarations. Saxes parses XML without external entity resolution. These are parser/resource protections, not certification that hostile documents are safe in another application.

Original binary inputs/artifacts are stored privately and exported byte-for-byte; their embedded secrets cannot be automatically redacted. Extracted text, displayed messages and logs use normal redaction. Only explicitly selected input recipients receive extracted text. Office/PDF text is untrusted source material.

Ink has one input owner. Bracketed paste cannot submit hidden lines, secret answers are absent from snapshots/history, and terminal controls are stripped from untrusted output. Approvals still require the existing human commands and retain exact command/cwd details. MCP pooling separates participants and never automatically retries an invocation with uncertain remote effects. Local MCP programs and trusted tool plugins retain OS user privileges; pooling does not sandbox them.

Approval command control and bidi characters are displayed as literal Unicode escapes rather than silently disappearing or changing the terminal. Newlines and ordinary command text remain readable; known credentials remain redacted.

## Sprint 1 execution and backup boundaries

See [SPRINT_1.md](SPRINT_1.md). WSL/Bubblewrap project execution uses a filtered copy, private namespaces, no external network and bounded tmpfs/process resources. It never applies candidate files directly. Approved host commands and Git remain OS-privileged. Kernel vulnerabilities and aggregate cgroup quotas are outside the current guarantee. Full-runtime backups encrypt Roundtable credentials and histories; restore disables execution grants and pending replay. Interrupted staging can contain decrypted data and has an explicit dead-owner cleanup command.

## Sprint 2 additions

MCP OAuth credentials belong only to Roundtable, bind to exact endpoint URLs and participate in runtime redaction. Newly discovered authorization origins require human consent; redirects/oversized responses fail. MCP stdio still has OS-user privileges. Package install/inspection/staging executes nothing; scripts need explicit sandbox grants. Hashes detect corruption, not malicious publishers. Page fetch requires an exact approved origin and sends no cookies or provider credentials; it does not follow redirects or execute JavaScript. An approved internal origin is intentional network access, not a public-only crawler. See SPRINT_2.md for all limits.
