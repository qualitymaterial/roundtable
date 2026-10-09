# Sprint 1 — reliable everyday work

Accepted 2026-10-09. Delivery: 0.2.0-dev.10. STATUS.md is canonical; detailed verification is in TESTING.md. This sprint covers recovery/validation, project isolation, grouped change review, provider resilience and runtime disaster recovery.

## Recovery and required validation

`/recovery` finds stale claims (15 minutes without a task update), missing/paused owners and cancelled/missing prerequisites. Diagnosis does not seize a task from an active agent. Pause first, then `/task-repair <task-id> release|reopen|cancel|dependencies <reason>`. Dependency repair prompts for the new list and rejects cycles. Every repair records its reason.

`/require-check` opens a guided task/artifact/validator picker. `/require-check <file>` also accepts an explicit contract JSON file. Validators support required JSON fields (with exact expected values in file configuration), required text, SHA-256 and arbitrary test commands inside the project sandbox. Command arguments use `{artifact}` for a private copy of the exact artifact bytes. Commands execute only after the human creates a contract and grants its reviewer a sandbox; publishing another agent's code does not activate it.

`/check <contract-id> <artifact-id>` runs a human check; agents use `roundtable_task_requirements` and `roundtable_validation_run`. Authors cannot independently validate their own artifacts. Required checks gate task completion and `/finish`, and a newer artifact with the same name needs a new check. `/drop-check <id> <reason>` explicitly removes a requirement with an audit event. `/resolve-failure` cannot waive a required check. Checks establish the declared assertions, not universal semantic correctness. Keep command validators in a dedicated reviewed folder and recreate their contract when changing the test specification.

## Project sandbox

`/sandbox` runs an isolation diagnostic. On this Windows machine the backend is **WSL Ubuntu with Bubblewrap 0.11.1**; Linux uses local Bubblewrap. The backend requires `/usr/bin/bwrap`, Python 3, GNU timeout and prlimit. Missing tools or failed isolation cause a hard error; there is no host-shell fallback. macOS needs a separately configured Linux environment and is not verified here. No software or distro was installed for this sprint.

`/sandbox grant` selects a participant and project root and explicitly grants 30 minutes. `/sandbox revoke <grant-id>` revokes it and cancels active execution. Agents discover grants with `sandbox_grants` and use `sandbox_execute` with an argv array. Humans can use `/sandbox run <grant-id> <quoted argv>`. Quoting groups arguments; it does not expand variables or invoke a shell. Use `/bin/sh -c "..."` explicitly for shell syntax.

The sandbox receives a filtered project **copy**, not a live writable project mount. It excludes common credential paths, symlinks, `.git`, dependencies and caches. Limits: 5000 input files/32 MiB, 64 MiB private work filesystem, 8 MiB temporary filesystem, 30 seconds wall time, 15 seconds CPU per process, 256 MiB address space per process, 32 user processes, 128 file descriptors and 8 MiB per file. The network namespace has no external route. Environment credentials are not inherited. `/usr` is read-only, and host homes and Windows drives are absent. These are Linux kernel/process controls, not a VM or a guarantee against kernel exploits; process limits are not aggregate cgroup CPU/RAM quotas. Review sensitive data inside the selected project: filename exclusions are not a universal secret detector.

Output is bounded. Up to 100 changed UTF-8 files (256 KB each, 2 MB total) become review candidates; deletions and binary files are not automatically copied back. Use existing artifact tools for binary deliverables. Installed Linux interpreters determine available commands; Windows executables and a host's Node dependencies are not imported. Failed, interrupted or unfinished sandbox runs appear in `/summary` for explicit reconciliation.

## Grouped file and Git review

`/change-group sandbox <run-id>` creates a proposal from sandbox output. `/change-group checkpoints <id,id,...>` groups existing applied checkpoints (one current checkpoint per file). `/change-group review <id>` displays the proposed content and before/current hashes; `/change-group export <id>` writes full details for large reviews without overwriting a file.

Pause, grant the destination root with the existing host-write controls, then `/change-group apply <id>`. All files are checked before editing, and each write rechecks its expected hash. `/change-group accept <id>` records acceptance; `/change-group undo <id>` restores its checkpoints and refuses intervening edits. Filesystem writes are not a cross-file atomic transaction: partial/crashed groups become review blockers with retained checkpoints. Unreviewed applied groups also block a clean completion report.

Optional Git operations are human commands: `/worktree create <branch>`, `/worktree review <id>` and `/worktree merge <id>`. They operate on a paused session and authorized Git root. Review records both commit hashes; merge refuses changed commits or dirty worktrees, disables hooks and leaves a no-fast-forward merge **uncommitted** for inspection. Inspect `git status`, then commit or `git merge --abort` yourself. Git runs with OS user privileges and may use repository-configured filters; it is separate from the sandbox. Nothing commits or pushes automatically.

## Provider resilience

`/fallback <participant>` opens model selection if no fallback is saved, then explicitly confirms that participant history will be shared with the chosen provider. `/fallback <participant> <provider> <model>` saves a target without connecting. A switch uses the normal tool-compatibility admission check and keeps identity, history, tasks, permissions and usage records. A failed probe preserves the old model. Model-specific tuning resets when switching to the fallback.

After supported `/login`, use `/provider-recover <participant>` to rebuild its connection. Authentication, quota and availability errors include recovery guidance. Failed deliveries remain failed until explicit `/retry`; changing providers does not undo tool effects or automatically replay them. Inspect `/summary` first. Provider-reported errors are classified heuristically; real account policies and refresh behavior still depend on the provider.

## Full-runtime disaster recovery

Close **all** harnesses using the runtime, then:

```powershell
roundtable runtime backup "D:\Backups\roundtable.rtb"
roundtable runtime restore "D:\Backups\roundtable.rtb" "D:\Roundtable-Restored"
$env:ROUNDTABLE_HOME = "D:\Roundtable-Restored"
roundtable session list
```

A hidden passphrase prompt requires at least 12 characters. Backups include Roundtable's own credentials, settings, SQLite state, independent Pi histories, shared workspaces and completed sandbox output. They use scrypt-derived AES-256-GCM encryption and gzip, with per-file SHA-256 checks. The passphrase is never saved; losing it prevents recovery. This is private local backup, not a sharing format. External project folders and their Git repositories need separate backups.

Backup requires quiescence: runtime process leases and legacy session ownership refuse an active source. SQLite is snapshotted consistently. Bounds are 256 MiB and 20000 regular files, no symlinks. Backups are created outside the runtime and never overwrite an existing file. Restore validates paths, hashes, duplicate names and the database before activating a new destination by directory rename. A failed/stopped restore cannot replace an existing installation.

Restored sessions start paused; host and sandbox grants are disabled, pending approvals are rejected and unfinished deliveries require explicit review/retry. Independent Pi history headers and internal workspace paths are rebased. Managed Git worktrees are suspended because external repository metadata may not have been restored; recreate them after recovering the project. Checkpoint/group evidence remains available for review.

An abruptly killed backup/restore can leave a private `.roundtable-backup-*` or `.roundtable-restore-*` staging folder beside the destination. `roundtable runtime cleanup "<stage-path>"` removes only a marked stage whose local owner process is gone. Protect these staging folders like the runtime: they can contain decrypted private data.

## Acceptance

Deterministic component tests plus a real WSL end-to-end fixture cover provider failure/recovery, persistent SQLite output, exact artifact validation and grouped human review. Separate tests cover encrypted restore, an 8 MiB file, live-owner refusal, wrong passphrases, injected staging failure and an actual killed restore process followed by cleanup/retry. Real Pi HTTP admission is tested with a localhost 401 response. Existing independent-Pi and session-recovery tests remain part of the full gate.

Run all gates, including this machine's real sandbox checks:

```powershell
$env:ROUNDTABLE_TEST_SANDBOX = "1"
npm run check
```

Without that variable, the two real-isolation tests explicitly skip; ordinary deterministic tests still run. Live hosted fallback, Anthropic login/refresh, other operating systems and hostile-kernel resistance are not established by these fixtures. OpenAI login was previously confirmed by the user.
