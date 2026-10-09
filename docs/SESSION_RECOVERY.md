# Composition, projects and portable sessions

These commands are available in source release 0.2.0-dev.6. An already-running or separately installed older harness does not hot-reload source changes.

## Compose and attach

Select `/audience`, then type `Compare @notes.md with @"source files/design.txt"`. Tab completes a directory you explicitly type inside the current project. Mentions create immutable, size-bounded snapshots for the selected recipients. They do not grant general filesystem access. `/attach` supports explicit paths outside the project and prompts for additional files. Supported inputs remain PNG, JPEG and bounded UTF-8 text/code/CSV/JSON; PDF/Office extraction is still pending.

`/attachments` shows snapshot contents/metadata, the version chain, export and an action to add a revised version. Previous bytes remain unchanged. Export refuses to overwrite existing files. Adding a version does not send it until you choose that action.

`/editor-config` asks for an executable and one argument per prompt. For VS Code use a real executable path and `--wait`; shell command strings are not accepted. `/editor` pauses agents, opens the saved draft, then lets you review it. `/end` queues the draft; `/resume` continues agents afterward. Launch failures preserve the original saved draft and show a recovery-file path. A launcher that exits early cannot reliably signal that editing is complete: unchanged drafts are preserved on disk; use a wait-capable editor. Real GUI editors have not been acceptance-tested in this release.

`/queue` can edit, cancel, move to the back, or place one message before another. Arbitrary reordering pauses work and affects pending delivery only. Original transcript order and delivered copies remain unchanged.

## Project defaults and instructions

`/project` can save the current participant lineup and limits for new sessions launched in this exact canonical folder. Explicit `--agents` wins over a project lineup, which wins over global saved participants. Lineups do not carry capability grants; host access remains a separate policy. Invalid saved model/auth choices are reported so you can repair them.

To use project instructions, choose Review instruction file (default `AGENTS.md`), read the content and hash, then approve its snapshot. This pauses the session; `/resume` applies it to subsequent prompts. Saving a snapshot never trusts later file changes. New sessions offer the saved snapshot for explicit review/application rather than silently loading it. Clearing instructions cannot remove content already in a model's conversation history.

## Back up or branch

Inside a session:

```text
/backup "C:\Backups\my session.rtbundle"
/fork alternate approach
/import "C:\Backups\my session.rtbundle"
```

Backup/fork pause and settle the current session. `/backup` leaves it paused; `/resume` continues. `/fork` opens a new paused branch and retains the original. `/import` previews the bundle before opening a new paused branch rooted at the current session's project folder.

Offline commands:

```powershell
roundtable session backup <paused-session-id> "C:\Backups\my session.rtbundle"
roundtable session import "C:\Backups\my session.rtbundle" "C:\Projects\target"
roundtable session resume <new-session-id>
```

Offline backup requires the source session to be paused and closed in other processes. The destination directory must exist, and existing backup files are never overwritten. Import does not connect to models. Review `/agents`, `/project` and `/settings` before `/resume`; credentials must already be configured separately through supported provider flows.

Bundles include independent Pi v3 JSONL histories, messages, tasks, artifacts, notes, input snapshots, evidence, audit history and regular shared-workspace files. IDs change on import; historical prose stays literal, with a model-callable resolver for source IDs. Claimed tasks reopen; pending messages are retained with cancelled deliveries; previous jobs, checkpoints and operation receipts are inert evidence. Stage definitions start again without prior human approval. Imported instruction snapshots require review.

Bundles exclude authentication, effective approvals/grants, provider/MCP configuration, project-wide memory, host project files, links, credential paths and hidden workspace entries. They are session snapshots, not full-machine backups. Historical audit records may contain old paths, private text or prior policy descriptions; those are data rather than active permissions. Limits: 64 MiB encoded bundle, 32 MiB decoded files, 16 MiB per file, with existing attachment bounds. Oversized sessions fail explicitly. A checksum detects corruption; it does not establish who created the bundle or whether its content is trustworthy. Keep bundles private and unencrypted recovery files protected by your OS account.
