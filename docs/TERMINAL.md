# Terminal interface

## Windows installation

After `npm ci --ignore-scripts` and `npm run build`, run `.\install.cmd` from the checkout. The installer supports Windows PowerShell 5.1, requires Node 24+ and npm, and needs no administrator access. It copies only distribution files, documentation, examples, manifests and license notices into a unique release under `%LOCALAPPDATA%\Programs\Roundtable`. It installs locked production dependencies with lifecycle scripts disabled. A failed dependency or doctor check leaves the old launcher intact. Previous releases are retained; `installation.json` identifies the active one.

The stable `bin\roundtable.cmd` calls the resolved Node executable and installed CLI using absolute paths and preserves the current folder. The installer adds this bin folder to user PATH and updates only the marked Roundtable block in current-user all-hosts profiles for Windows PowerShell and PowerShell. Existing profiles are backed up alongside the originals. It replaces the earlier npm launcher workaround. If profiles are disabled by policy, use the absolute launcher or restart the terminal host to reload user PATH. Already-open shells do not inherit environment/profile changes; `-Launch` opens the harness directly after installation.

Run the installer in the same Windows environment where you intend to use the application. A launcher found by an automation tool does not prove it exists in your terminal. `Get-Command roundtable` in a fresh PowerShell verifies registration there. The installer does not repair Node removal or relocation; rerun it after moving Node. Updates require rebuilding the checkout and rerunning the installer. `-InstallRoot` selects an alternate destination; `-NoUserIntegration` skips PATH/profile changes for tests. This is a local source installer, not a published package or signed binary.

Runtime data defaults to `~/.roundtable`; `ROUNDTABLE_HOME` overrides it. Optional `~/.roundtable/config.json` can point `dataDir` at an existing runtime and set `projectAccess:true` to grant write access in the current folder for new sessions. The installer preserves this configuration and never copies credentials or session data. If this pointer selects a directory inside the checkout, keep that data directory even though the installed executable is independent of it. Resuming a session keeps its existing project roots.

## Using the harness

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
