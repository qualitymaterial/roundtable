# Terminal interface

## Windows installation

After `npm ci --ignore-scripts` and `npm run build`, run `.\install.cmd` from the checkout. The installer supports Windows PowerShell 5.1, requires Node 24+ and npm, and needs no administrator access. It copies only distribution files, documentation, examples, manifests and license notices into a unique release under `%LOCALAPPDATA%\Programs\Roundtable`. It installs locked production dependencies with lifecycle scripts disabled. A failed dependency or doctor check leaves the old launcher intact. Previous releases are retained; `installation.json` identifies the active one.

The stable `bin\roundtable.cmd` calls the resolved Node executable and installed CLI using absolute paths and preserves the current folder. The installer adds this bin folder to user PATH and updates only the marked Roundtable block in current-user all-hosts profiles for Windows PowerShell and PowerShell. Existing profiles are backed up alongside the originals. It replaces the earlier npm launcher workaround. If profiles are disabled by policy, use the absolute launcher or restart the terminal host to reload user PATH. Already-open shells do not inherit environment/profile changes; `-Launch` opens the harness directly after installation.

Run the installer in the same Windows environment where you intend to use the application. A launcher found by an automation tool does not prove it exists in your terminal. `Get-Command roundtable` in a fresh PowerShell verifies registration there. The installer does not repair Node removal or relocation; rerun it after moving Node. Updates require rebuilding the checkout and rerunning the installer. `-InstallRoot` selects an alternate destination; `-NoUserIntegration` skips PATH/profile changes for tests. This is a local source installer, not a published package or signed binary.

Runtime data defaults to `~/.roundtable`; `ROUNDTABLE_HOME` overrides it. Optional `~/.roundtable/config.json` can point `dataDir` at an existing runtime and set `projectAccess:true` to grant write access in the current folder for new sessions. The installer preserves this configuration and never copies credentials or session data. If this pointer selects a directory inside the checkout, keep that data directory even though the installed executable is independent of it. Resuming a session keeps its existing project roots.

## Using the harness

### Budget controls

Startup prints the session limits. `/budget` shows usage and ceilings. New sessions have no cumulative token cap; existing sessions retain their saved settings. Other limits remain enforced. To remove an existing token ceiling, enter `/budget tokens off`, then `/resume` if paused. To set a ceiling, use `/budget tokens 1000000`, `/budget dollars 5`, `/budget requests 200`, `/budget tools 500`, or `/budget exchanges 150`. Values are total session ceilings, not additional allowances. A change never resets usage or resumes work automatically. `/limits <JSON>` remains available for advanced controls such as per-provider request ceilings.

Tokens are cumulative across all agents and calls, including repeated input context. This is different from a model's context window. Cost is an SDK estimate, not an invoice or subscription quota reading. Enabled limits warn at 80% usage. A budget pause blocks new work while already-running responses can finish; their usage can exceed a ceiling. Completed turns are acknowledged; interrupted turns remain pending. Human `/pause` still cancels active work. Restoring a paused session does not probe providers until you adjust the exhausted limits and `/resume`.

The pause panel shows the specific limit and recovery commands. `/export` and `/exit` work while paused. Disabling the token ceiling does not implement compaction or disable provider/context limits, approval policy, estimated spending, request/tool/exchange caps or timeouts.

Enter an objective, wait for the connection checks, then type a message. Messages broadcast to active participants; `/send <agent-id> <text>` addresses one participant. Tab completes slash commands; Up/Down recall in-memory input history. `/exit` persists and closes the session.

The terminal shows a project/runtime header, session objective, machine access, connection status and participant cards. Agent messages identify the provider/model, recipient and time. Color separates participants, tool results and errors. A composing indicator appears when a model begins streaming text; the final response is displayed as a block. Token-by-token text rendering is not implemented.

- `/agents`: identities, provider/model, states, IDs and permissions.
- `/tools`: compact availability view; `+` means authorized and `?` requires access.
- `/status`: session state, active/running/queued work, budgets and SDK cost estimates.
- `/host`: read/write roots and host command policy.
- `/approvals`: exact pending command text and working directory; `/approve <id>` or `/reject <id>` decides.
- `/activity`: detailed persisted tool inputs/results; `/export` saves session history.

Background updates redraw the input prompt while preserving its editable line. Host command approval panels are operational controls, not decorative buttons. Terminal control strings are stripped from model/tool text before display. Narrow panels wrap long paths; East Asian character widths and complex multiline pasted input are not exhaustively tested.

Colors are enabled for a terminal unless `NO_COLOR` is set. `ROUNDTABLE_ASCII=1` uses ASCII panel borders and prompt. Piped output remains plain for scripts and verification. No web dashboard, full-screen layout or mouse interaction is required.

## Daily controls in 0.2.0-dev.1

- `roundtable setup` guides provider authentication, registered model selection, participant instructions and none/read/edit access to the current folder. Existing participants are retained. Setup makes no inference calls; connection subsequently probes tool support. Saving setup disables the legacy implicit current-folder write option so a read-only choice stays read-only.
- `/paste` starts a multiline draft. `/end` sends it and `/cancel-paste` discards it. Other slash commands inside the draft are literal text. Drafts are bounded to 24,000 characters. Ctrl-C clears the draft and pauses active work. Up-arrow uses readline's in-process history; persistent searchable history is not implemented.
- `/send @Name message`, `/send "Name With Spaces" message`, and unique ID prefixes of at least eight characters select participants. `/pause-agent`, `/resume-agent` and `/remove-agent` accept the same names. Duplicate names require IDs.
- `/context [name-or-id]` shows SDK context estimates. `/compact <name-or-id>` makes a metered summary call when that participant is idle and the session is active. Native automatic compaction also runs near the SDK threshold. Failed summaries retain original history. `/usage` separates available input/output/cache components from estimated cost; neither costs nor token counts establish subscription quota.
- `/summary` reports active work, tasks, approvals, failed deliveries, artifacts and recorded checks. Idle does not mean successful. `/finish <note>` records human acceptance only after active/open work is resolved. `/resume` removes the current completion label while preserving the audit event.
- `/changes`, `/diff <checkpoint-id>`, `/undo <checkpoint-id>` inspect and restore applied `host_write` changes. Diffs are bounded changed-span previews, not directly applicable patches. Undo refuses an intervening file change. Shell effects, workspace tools and directory creation are outside checkpoint coverage.
- `/jobs`, `/job <id>` and `/stop-job <id>` inspect bounded background output and cancel managed jobs. Agents request `host_job_start`; exact command/cwd/timeout/background approvals are single-use. Pause/exit stop managed jobs. A crash marks records interrupted on recovery without replay; detached OS children can survive a crash.
- `/remember <text>` stores human-curated memory for the canonical folder from which this harness was launched, with source session and 30-day expiry. `/memory [query]` retrieves it for the human; `/share-memory <id>` explicitly sends it to participants; `/forget <id>` deletes the stored entry. Expired entries are not retrieved. Prior shared messages/backups are not erased. Agents cannot promote notes into this store themselves.

`roundtable workflows` lists four versioned recipes. Start with `roundtable workflow research`, `writing`, `analysis` or `coding`, or pass your own strict JSON file. These supply an objective and instruction constraints, without granting permissions or executing hooks. They are not an enforced multistage workflow engine. Enter your concrete brief after the session opens.

## Headless execution

```powershell
roundtable run "Compare these design alternatives and publish findings" --agents config.json
```

Stdout contains newline-delimited JSON: session, message/tool/system activity and a final summary. Partial text deltas are omitted; diagnostics from Node may appear on stderr. The command uses explicit participant permissions and a separate session workspace; saved host roots are not inherited. Exit 0 means idle with no outstanding shared tasks/deliveries/approvals, not independently verified success. Exit 2 means incomplete/paused work; exit 1 means a command failure. A session ID is emitted before admission so failures remain inspectable. Ctrl-C signal handling for headless children is not a daemon recovery guarantee.

## Updating and changing Windows releases

From a newly built checkout, run `install.cmd` again to install a separate release and switch the stable launcher. The installer preserves runtime data. `roundtable --version` identifies the executable; `roundtable releases` lists local installed copies. `roundtable rollback <release-id>` validates the target using isolated temporary data before switching new invocations. It never downloads code or migrates user data. A failed target leaves the launcher unchanged. Old executables may not understand new data: back up the private runtime before downgrading. Close old harnesses before resuming their sessions under a new version, because old versions do not honor the new ownership lock.
