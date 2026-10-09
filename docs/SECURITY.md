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

Run one active Roundtable process per database/session. SQLite commits are durable, but the application scheduler is not a distributed lease service. A second active owner can replay inflight work. Cross-process locking and hardened sandbox integration are priority follow-ups before hostile multiuser use.
