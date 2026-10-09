# Tool registry and extension contract

Every Pi session receives model-callable ToolDefinitions translated from the registry. A tool's existence and input/output schema are distinct from authorization. Invocation checks the current agent state, agent capability list and session policy in the execution layer, validates input, applies the budget, audits activity and returns `{ok,data}`. Tool definitions have name, description, schemas, ownership and version. List availability is computed per agent. Generic output envelopes intentionally allow varied structured data.

All required collaboration tools are operational:

| Tools | Purpose / permission |
| --- | --- |
| roundtable_agents_list, roundtable_send | Discovery and asynchronous routing / collaborate |
| roundtable_threads_list, roundtable_thread_read | Selected shared discussions / collaborate |
| roundtable_task_create, roundtable_task_claim, roundtable_task_update, roundtable_tasks_list | Shared tasks / collaborate |
| roundtable_artifact_publish, roundtable_artifact_read | Immutable text artifacts / artifact |
| roundtable_tools_list, roundtable_tool_request | Capability discovery and human requests / collaborate |
| roundtable_memory_write, roundtable_memory_search | Notes and decisions / memory |
| roundtable_session_status | Budgets and activity / collaborate |
| workspace_read, workspace_search | Dedicated shared files / workspace.read |
| workspace_write | Dedicated shared files / workspace.write |
| host_roots | Discover authorized host roots and shell policy / collaborate |
| host_list, host_read, host_search | Bounded local folders, UTF-8 text and recursive literal search / host.read |
| host_write, host_mkdir | Hash-checked UTF-8 file updates and directory creation / host.write |
| host_execute | Single-use exact command approval, then host shell execution / host.execute |
| data_json_validate | Parse/normalize structured JSON, never eval / collaborate |
| git_status | Read-only workspace Git inspection / git.read |
| container_execute | Constrained Docker JavaScript execution / execute.container |
| web_research | Fixed configured POST research service / network.research |
| mcp_tools_list, mcp_call | Pi MCP discovery and allowlisted invocation / mcp.remote |
| mcp_servers_list | Configured server metadata without starting programs / collaborate |
| roundtable_skills_list, roundtable_skill_read | Explicitly reviewed instruction snapshots / collaborate |

Workspace tools reject absolute paths, traversal, hidden/sensitive names, alternate data streams and symlink paths. Search currently scans at most 100 root-level regular files, not recursive directories. Text file contents/results are bounded. Files live under a newly created session workspace, not the caller's repository or home. Git mutation tools are planned; current Git support is status only.

## Local machine tools

Host tools are separate from the dedicated session workspace. `/host-read <absolute directory>` and `/host-write <absolute directory>` configure session roots and grant the corresponding capabilities to current participants. `/host-shell on` allows command requests, each requiring `/approve <id>` before execution. `/host` displays the policy; `/host-off` clears access and rejects outstanding command approvals. `/save-access` writes the policy into the runtime's private `host-access.json` for future sessions. Ordinary `/grant` and `/revoke` continue to control individual agents.

`host_read` reads UTF-8 files up to 256 KB, returns a bounded excerpt and SHA-256. `host_write` requires `expectedHash:"new"` for exclusive creation or the current hash for replacement. Parent directories must exist; `host_mkdir` creates one level. Search visits at most 2,000 entries, depth ten, 50 results and ten seconds; it reports truncation and skips dependency/cache/system directories. Listing returns at most 300 entries. Credential/runtime directories, common secret filenames, Windows device/ADS paths, UNC shares and links escaping authorized roots are excluded. These are practical access guards, not universal secret detection or hostile-process isolation.

`host_execute` uses Windows PowerShell with `-NoProfile -NonInteractive`, or `/bin/sh` on Unix. The approval binds the exact command, canonical working directory and agent; it is consumed before launch. Approval automatically sends the requesting agent an instruction to retry. Commands receive a reduced environment, a 60-second timeout, 64 KB output bound and process-tree termination attempts. This is **unsandboxed host execution**, permitting the command to access the user's filesystem and network beyond its working directory. Root scoping only constrains direct file tools. Use the Docker adapter for isolated execution. Git, tests and builds can run through the approved command tool; there is no automatic command approval.

## Optional services

Research needs ROUNDTABLE_RESEARCH_URL and optional ROUNDTABLE_RESEARCH_TOKEN. The configured service accepts `POST {"query":"..."}` and returns JSON within 64 KiB. Redirects are rejected. Roundtable does not scrape arbitrary URLs by default.

Remote MCP needs ROUNDTABLE_MCP_URL, optional ROUNDTABLE_MCP_TOKEN, and a JSON array in ROUNDTABLE_MCP_TOOLS. Discovery returns remote schemas. Invocation requires mcp.remote permission, an exact operator allowlist match and schema validation. The official Pi McpClient handles transport. Redirects, unsolicited model sampling and local stdio process launches are not enabled. Remote services run with their own authority; approve them accordingly. Server OAuth and multi-server config are planned.

Container execution needs Docker and a trusted preinstalled ROUNDTABLE_CONTAINER_IMAGE containing Node. It runs with no network/host mounts, read-only filesystem, dropped capabilities, no-new-privileges, PID/memory/CPU bounds and a nonroot UID. The agent supplies only JavaScript source. Output/time limits and cleanup are enforced. This adapter is implemented but Docker execution is unverified in this environment.

## Trusted extensions and candidates

`ToolProvider.register(registry)` can add/remove tools using TypeBox schemas and permission identifiers. See examples/approved-tool.mjs. `/load-tool <path>` is a human-only explicit import; it runs code with host privileges. Pause/resume agents to refresh their Pi definitions after registration. Removing a tool makes existing definitions fail at invocation. Modules are not automatically reloaded after restart. An untrusted module is not safely confined by the registry.

Agents can publish candidate tool source as a nonexecuting artifact and request a capability. They cannot import it or enable it for peers. A human must inspect/validate source and dependencies, then explicitly load the trusted module and approve capabilities. Automated executable-tool certification, marketplace installation and a companion ordinary-Pi extension remain planned. Do not execute source just because another agent produced it.

## Checkpoints and background commands

Successful `host_write` returns a checkpoint ID. Human `/diff` and `/undo` operate on applied checkpoints with fresh authorization and hash checks. Only this direct edit tool is covered; shell effects and separate workspace edits are not automatically reversible.

`host_job_start(command,cwd,timeoutMs?)` uses `host.execute` and requests single-use approval bound to all invocation fields, including background mode. It returns a durable ID immediately after approval. `host_job_read(id)` returns bounded state/output, and `host_job_stop(id)` cancels a managed job. At most four jobs run concurrently, with timeouts from 1 second to 1 hour (10 minutes by default). Jobs are scoped to a session. The executor has the same unsandboxed OS privileges and best-effort process cleanup as foreground host execution.


### Guarded edits and operation recovery (0.2.0-dev.5)

`workspace_read` now returns `{path,content,sha256}`. Existing-file `workspace_write` requires that `expectedHash`; omission means exclusive new-file creation. `workspace_patch` and `host_patch` replace one unique literal `before` span with `after`, requiring the current hash. All use guarded checkpoints. `/changes` reviews applied versions; `/undo` rejects changed files. External commands, MCP effects and container changes are not universally undoable.

Tool execution records prepared/committed receipts. Prepared receipts left by process failure have unknown outcomes, block new execution and appear in `/summary`. A human can record reconciliation with `/resolve-failure`; the original call ID is never automatically re-executed. This does not provide exactly-once delivery to external services.

Pi activates configured, authorized tool schemas for each prompt. `roundtable_tools_list` still discovers restricted tools so agents can request capabilities. Health remains explicitly unprobed. Stage policies can further withhold tools; trusted plugins still run in process with cooperative cancellation.

New tools: `roundtable_stage_status`, `roundtable_stage_ready`, `roundtable_evidence_add`, `roundtable_evidence_list`, `roundtable_artifact_validate_json`. JSON validation requires a different author and binds its limited structural check to the stored artifact hash. Findings/decisions remain attributed claims.

`roundtable_reference_resolve({ids:[...]})` maps source IDs to current IDs after imports/forks, including ancestor forks, without injecting an unbounded mapping into every model prompt. It uses the existing `collaborate` permission. A missing mapping returns `current:null`; agents should rediscover current shared resources. Project instructions, editor configuration, backups/imports, endpoint edits and queue rearrangement are human actions, not model-granted capabilities.

## Documents, binary artifacts and MCP resources (dev.8)

`/attach` and project file mentions accept PDF, DOCX, PPTX and XLSX in addition to existing text/images. Documents are at most 2 MiB; extraction is limited to 64,000 characters, 200 pages/content parts, 8 MiB decompressed selected XML, 1,000 ZIP entries and 10 seconds. Agents receive scoped extracted text plus limitations, not the encoded original. `/attachments` exports the original file and preserves versions. PDF extraction does not OCR scans. Office extraction covers main text, slide text and cell values; it omits layout, images, notes and embedded objects. Spreadsheet formulas are not evaluated. Legacy Office and macros are unsupported.

`roundtable_artifact_publish_file({path,provenance})` publishes a shared-workspace PDF, DOCX, PPTX, XLSX, PNG or JPEG. It requires both `artifact` and `workspace.read`, checks format signatures and limits each file to 2 MiB / binary session total to 20 MiB. Signature checks are not semantic validation or antivirus. Tool results return metadata, not base64 payloads. `/artifact` exports exact bytes with exclusive creation. Hashes and bytes survive session backups/forks. Text JSON validation rejects binary artifacts.

MCP uses per-agent connection leases (maximum 32, 60-second idle expiry, bounded request lifetimes). Configuration/selected credential changes invalidate old leases; errors discard the connection without replay. `/mcp-reconnect [server]` closes leases so the next authorized call establishes a fresh session. Exit closes the pool. `mcp_resources_list` returns a single metadata page; `mcp_resource_read` requires an exact URI in the connection's human-configured `resources` allowlist. `/mcp manage` provides resource selection. Resource content remains untrusted. OAuth server login and resource templates remain future work.
