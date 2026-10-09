# Settings, accounts, skills and connections

Available in the 0.2.0-dev.4 development checkout. Run `roundtable settings` without opening a session, or `/settings` inside the harness. Numbered choices accept `cancel`. Settings panels distinguish the current session from saved defaults. Menus are keyboard accessible through standard readline input; Tab completes slash commands and installed skill commands.

## Choosing providers and models

Use `/providers` to find an account, then choose **Browse models** or **Sign in**. Use `/models` (or `/models openrouter`) to go directly to model browsing. Menus show twelve choices per page in terminal panels, with search and next/previous navigation. Configured credentials are labeled explicitly; that status does not prove account access or quota.

After selecting a model, choose **Use for a participant**, select the participant, and confirm the model change. An unconfigured provider offers sign-in first. **Save favorite** records a shortcut without changing a participant or making model requests. `/model [participant]` remains the direct participant-first route. Model changes preserve existing context and may send it to the new provider on future turns, as stated in the confirmation.

`roundtable providers` and `roundtable models [provider]` browse interactively in a terminal. Standalone browsing can sign in or save favorites; applying a model happens inside a session. Piped output is a readable listing. Add `--json` for machine-readable data, including `/providers --json` and `/models openrouter --json` inside a session. JSON is an explicit export, not the default selection UI.

## Models and accounts

Use `/login`, `/login openai-codex`, `/login anthropic`, or the top-level `roundtable login` command. The menu uses the installed Pi registry's supported methods. OAuth/device flows show readable instructions and open the browser unless disabled in settings; the printed link remains usable if opening fails. API keys and manual callback codes are hidden and excluded from command history. Ctrl-C cancels the flow. Login stays within Roundtable's own auth store; no other application's credentials are imported.

OpenAI Codex subscription sign-in and OpenAI API access are separate options. Anthropic's pinned Pi adapter also exposes OAuth and API-key methods. Catalog availability does not guarantee account eligibility, subscription terms, quota or model access. Browser sign-in against a real OpenAI/Anthropic account has not been verified in this change. The implementation uses Pi's existing auth flow rather than a custom OAuth client. See [Pi providers](https://pi.dev/docs/latest/providers).

`/logout` removes Roundtable's stored credential after selecting a provider; it does not revoke credentials remotely or clear environment variables. Never paste keys into ordinary chat or slash-command arguments.

Use `/model` or `/model "Participant name"` to select a provider and search its model catalog. Connecting a different model makes metered tool-protocol probes. The menu explains that future calls send the participant's existing conversation to the selected provider and asks before applying. ID, history, task ownership and permissions remain intact. Failed admission preserves the previous model. Busy participants must finish or be paused first. Saving the new startup lineup is a separate choice. The direct `/replace-agent <name> <provider> <model>` command now has the same identity-preserving behavior.

`/settings` can add participants, change current limits, save defaults, configure folder access, toggle browser opening and save the lineup. Default limits in `settings.json` affect newly created CLI sessions; old sessions keep their limits and cumulative usage. Folder presets replace the current host roots only after review. Saving them disables legacy automatic current-folder write grants. Enter `/host` to inspect effective roots.

## Instruction skills

`/skills add` asks for a `SKILL.md`, displays its content and metadata, and saves it only after review. It uses Pi's frontmatter parser and stores a bounded instruction snapshot, source path and SHA-256 in private `skills.json`. No home/project directories are scanned automatically. Supporting scripts and assets are not copied or executed; they require normal file/execution authorization.

Use `/skills` to list, disable or remove snapshots. Invoke one with `/skill:skill-name your request`; this explicitly sends the instructions to current participants. Agents can independently discover/read enabled skills through `roundtable_skills_list` and `roundtable_skill_read`. `disable-model-invocation: true` restricts a skill to explicit human invocation. An `allowed-tools` field does not grant permissions. Source edits require a newly reviewed import; disabling/removing a skill blocks future reads, but cannot erase instructions already in conversation history.

This is a constrained instruction-skill implementation, not automatic executable package loading. It follows the [Pi skill format](https://pi.dev/docs/latest/skills); native Pi discovery, extensions and arbitrary hooks remain disabled.

## MCP and external programs

Use `/mcp add` to save a named HTTP or local stdio connection. It starts disabled. `/mcp manage` lets you:

1. Review the endpoint or exact executable, arguments, cwd and forwarded environment names.
2. Test it and inspect its actual advertised tool names.
3. Select an exact allowlist and enable the connection explicitly.
4. Disable or remove it later.

Grant individual participants access with `/grant "Participant name" mcp.remote`. They use `mcp_servers_list`, `mcp_tools_list` with a server ID, and `mcp_call` with a server ID, tool name and arguments. Schemas, current connection state, allowlists, agent permissions and session policy are checked. Cached calls cannot bypass configuration changes. Listing configured server metadata does not start programs; listing remote tool schemas does connect/start the selected server.

HTTP uses streamable HTTP with redirects rejected, bounded messages and timeouts. Bearer authentication references an environment variable name, never a key in the tool description. Local stdio uses Pi's actual transport with a reduced environment plus explicitly named variables; provider keys are not inherited by default. **A trusted local MCP program runs with your OS privileges and can access files/network outside direct-tool roots.** Only configure programs you intend to trust. Do not put credentials in command arguments or URLs.

Connections are saved in private `mcp.json` and affect subsequent calls across sessions sharing that runtime. Existing `ROUNDTABLE_MCP_*` variables remain available as the `legacy` connection. A connection is opened and closed for each operation; long-lived stateful servers, resource attachments and remote MCP OAuth management are not implemented yet. Disabling a connection prevents subsequent operations; an already-running call may finish. External applications must expose an MCP server or be operated through an approved host command; this does not provide arbitrary desktop automation. See [Pi MCP documentation](https://pi.dev/docs/latest/mcp).

## Search and saved work (0.2.0-dev.3)

Enter `/` or `/commands search words` to find commands, then choose a number. Required arguments are prompted before dispatch. Enabled skills appear in the same picker. Menus display twelve choices per page; type search words to filter, `next`/`prev` to change pages, `all` to reset, or `cancel` to leave. Search matches all entered words, without fuzzy ranking. Optional command arguments can still be typed directly in chat.

Use `/sessions` inside the harness or `roundtable session resume` without an ID to search saved sessions by objective, ID, date or state. The most recently active sessions come first. Switching requires confirmation, pauses the current session, and opens the selected session paused for inspection. Use `/resume` to reconnect providers and continue pending work; that may make metered requests. Explicit `session resume <id>` now also opens for inspection. Current-folder grants are not added to a restored session. These controls do not rename or delete sessions.

`/favorites` or `roundtable favorites` saves exact provider/model pairs in settings. `/model` offers saved favorites before the full registry; provider and model lists support search and pagination. Missing models or authentication produce an actionable error. Favorites do not change participants, grant tools, or copy credentials.

## Local model setup and diagnostics

Run `roundtable endpoints` (or `/endpoints`) for LM Studio, Ollama or a custom OpenAI-compatible server. Review the base URL, choose whether to fetch `/models`, select an actual server ID or enter one yourself, and enter the server's supported context/output sizes. Save under a unique provider alias. The new model is immediately available without a restart. The endpoint menu supports edit/remove and multiple models per alias. Each model has its own context/output bounds and an explicit image-capability setting. Changes require a preview and confirmation; affected participants in the current session pause and disconnect. Existing context may be sent to the replacement destination after reconnection. Other running harnesses keep their loaded configuration.

Authentication references an environment variable **name**, not a key value. Only loopback endpoints may omit authentication. The server must already be running; the wizard does not install, start, or reconfigure it. Remote URLs require an authentication variable. URLs containing credentials, query strings or fragments are rejected; catalog fetches reject redirects and use a ten-second timeout and 64 KiB limit. A model listing is not proof of tool support.

`/diagnostics` and `roundtable diagnostics` show configured providers, custom endpoints and MCP status without connecting. `roundtable doctor` includes that report noninteractively. An optional model check requires selecting a model and confirming up to two metered tool-protocol requests. It sends only the synthetic nonce/receipt probe, not existing conversation context. Usage is reported separately and **does not use a collaboration session budget**. Zero catalog cost for a custom server means pricing is unknown. MCP connection tests remain under `/mcp manage`.

## Next UX priorities

- Keyboard-driven fuzzy command navigation and persistent, safely filtered input history.
- Explicit provider fallback and real supported-account expiration/recovery acceptance.
- MCP reconnect, remote OAuth and resource browsing.
- PDF/Office extraction, generated binary deliverables and image previews.
- A queued-work view showing which participant is acting, waiting or finished and why.
- Safe persistent input history; project lineups are implemented through `/project`.

These remaining priorities are not implemented controls or claims of parity with another harness. The current picker is a searchable numbered menu, not a full-screen keyboard palette.


## Reliability and daily-use controls (0.2.0-dev.5)

- `/tuning` selects a participant, supported reasoning effort, output-token ceiling and context-window ceiling. Applying reconnects and makes metered compatibility probes. Save participant defaults explicitly when prompted. Unsupported settings are errors; actual provider support still requires live verification.
- `/audience` selects one participant, a group, or broadcast for ordinary messages and `/attach`. `/send` remains an explicit direct-message override.
- `/attach [path]` snapshots one selected PNG/JPEG/CSV/text/code file and sends a request to that audience. Relative paths resolve against the saved project. `/attachments` inspects metadata/text and exports exact stored bytes. PDF/Office extraction is not available yet.
- `/paste` starts a multiline draft; `/end` sends and `/cancel-paste` discards. `/draft` restores unsent saved text after restart.
- `/queue` edits, cancels or moves remaining queued human deliveries to the back. Pause first if that message is already in flight. Original and already delivered copies remain unchanged.
- `/task-transfer` without arguments selects a task and new owner, or releases it to open work. `/changes` selects a file checkpoint for preview, acceptance or guarded undo.
- `/summary` shows failures and incomplete work. `/resolve-failure <id> <reason>` records an explicit repair/waiver; it does not undo effects or prove correctness. Unknown tool outcomes require inspecting actual effects before retrying with a new call ID.
- `/rename`, `/archive`, `/board`, `/artifact`, `/stage` and `/next-stage` expose saved-session metadata, evidence, deliverables and workflow gates. Start the staged example with `roundtable workflow independent-review`.
- Normal limit settings include `timeoutMs` and `turnTimeoutMs` in milliseconds. Current session timeout measures elapsed time since connection/resume; turn changes affect subsequent turns.

The detailed accepted scope and remaining work are tracked in [IMPLEMENTATION_CHECKLIST.md](IMPLEMENTATION_CHECKLIST.md).

`/add-agent` now opens the guided participant flow directly. JSON input remains optional for advanced users. Normal provider/model pickers exclude the deterministic demo provider. Session folder-access settings use the saved project root.

## Project and composer controls (dev.6)

`/project` reviews instruction files/snapshots and saves participant lineups and default limits for the current project root. Applying instructions pauses the session; `/resume` continues. Saved instructions require explicit application in each new session, and changing a repository file never updates a reviewed snapshot silently. Lineups exclude capability grants. Explicit `--agents` overrides saved lineups. Missing saved models/authentication are reported without preventing an empty session from opening.

`/editor-config` saves an executable and separate arguments; `/editor` pauses work and opens the saved draft. Use a wait argument for GUI launchers (e.g. VS Code `--wait`). No shell parsing or project editor hooks run. `/draft` recovers unsent text, including failed file-mention sends. `/attach` accepts several files; `/attachments` offers immutable version history and export. `/queue` can place a pending message before another message. See [recovery guide](SESSION_RECOVERY.md).


## Compact activity view (dev.7)

Interactive terminals default to compact mode. Startup shows the project, participant models and effective access without repeated metadata panels. Tool activity is accumulated into an ACTIVITY panel at response/pause/error boundaries, with completed/running/failed counts and the last tool for up to three participants. /activity opens full details; /messages opens internal discussion and full response text. This is command-based expansion, not a clickable GUI card or continuously refreshed full-screen region.

Compact mode suppresses raw successful tool results, peer messages, tool-use narration and partial streams; it previews completed responses once (16 lines or 1,600 characters, with an explicit continuation pointer). Errors and approvals are always visible. /view verbose restores detailed live output; /view compact returns to the default. The preference is saved. Piped output and headless events remain detailed. Filtering is presentation only: it does not reduce provider calls, fix acknowledgement loops or remove history.
