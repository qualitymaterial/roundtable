# Coordinated coding work

Version 0.2.0-dev.14 adds collaboration throughout repository work. Participants keep independent Pi contexts, models, configured reasoning and identities. Roles and file assignments belong to one work item; ordinary discussion remains available.

Launch Roundtable from a Git repository, connect participants, authorize that project for writes, and resume the session. Then use:

```text
/work Fix the failing invoice rounding cases
```

The dialog asks for a test command, execution mode, and delivery mode. Collaborative team is the first option; direct editor with peer review and solo remain available. Review the exact command and project before starting. The runtime assigns a least-busy editor to coordinate integration and up to two other connected participants. Starting the same normalized brief again returns the existing item. Use a different brief for a separate assignment; use `/rework` for a completed proposal that needs correction.

## Collaboration throughout the work

Each team member first investigates source independently and cites files it actually read. Findings remain hidden from other investigators until everyone submits. Then all members receive the perspectives and must respond to another participant's ideas, explaining what they adopt or challenge. The editor synthesizes a recorded plan, with one implementation or assistance scope for every member. This does not make the editor the permanent project leader: peers may implement source while the editor handles documentation or another part.

Implementation uses explicit file claims. Collaborators prepare guarded change proposals in parallel; the editor inspects each proposal, then applies or rejects it in the isolated worktree with a reason. Only the editor runs the approved named checks on the combined tree. Claims can be handed to another member explicitly as needs change. Concrete questions and answers wake the required peer and requester, while readiness acknowledgements and polling stay quiet. Each contributor marks its scope ready; unresolved questions, pending proposals and unfinished contributors block review.

Human-installed skill snapshots and their supporting content remain available through the reviewed skill tools. Skills do not grant extra permissions; no external skill store is loaded automatically.

If a response ends with prose instead of recording a required stage action, the runtime can send at most two continuation requests for that member/stage. Exhaustion appears as a blocker. Explicit human waits, pauses, expired leases and resource ceilings remain respected. Resume after inspecting the blocker; the runtime does not fabricate missing findings or approvals.

```text
/team <task-id>
```

This read-only view shows investigations, peer responses, the shared plan, substantive questions/answers, and proposal decisions. It also works while paused. These records show how ideas moved between models; they do not prove that every suggestion improved the result. Project outcomes and independent checks remain the acceptance criteria. See [live collaboration evidence](COLLABORATION.md).

Each assignment gets its own Git worktree with a bounded snapshot of current nonsensitive project text, including uncommitted and untracked text. The primary checkout is preserved. Hidden and sensitive paths are excluded. Snapshots reject dirty binary/large/deleted files they cannot preserve, more than 5,000 candidate files, or more than 32 MiB. Dependencies and ignored files are not copied: choose a check that can run in that worktree. General dependency provisioning, binary edits, file deletion and automatic conflict resolution are outside this workflow.

## Checks and permissions

The human selects commands; models invoke only those named checks. A work lease lasts 30 minutes. `/renew-work <task-id>` shows the same project and exact commands for human reauthorization for another 30 minutes; models cannot renew it. Imported or restored work leases remain disabled and require a new reviewed assignment.

- **Approved host check:** explicitly authorizes the exact command with your OS user privileges. This is unsandboxed execution and can access filesystem/network resources beyond the worktree. Each check has bounded output and a 30-second host execution limit. Pause or lease expiry cancels it. Direct project file tools remain confined to the assigned tree.
- **Sandbox check:** uses the existing scoped Bubblewrap/WSL adapter and its restrictions. It requires a working configured sandbox; there is no automatic host fallback. Live sandbox acceptance remains separate from the Windows host-check evidence.

The editor is instructed to inspect supplied tests, reproduce the failure, edit, and rerun checks. Passing checks bind to the current worktree revision; later edits invalidate them. Models cannot change the configured command, widen the lease, integrate files or commit through these tools. Tool restrictions do not make an approved host command a security sandbox.

## Review and integration

The runtime sends a batched review request after passing checks. In collaborative work, review assignments exclude every recorded author of each file. Reviewers must read their assigned files before submitting a verdict for that revision. The editor may review peer work when it is independently eligible; no participant approves its own edits. If every member coauthored a file, the runtime requires human attention. Direct editor/reviewer mode keeps its original whole-proposal peer review. All assigned reviews must accept before completion; requested changes require fresh passing checks and another review. There are at most three review rounds. Results wake the editor once the batch is complete, without acknowledgement chains.

Solo mode records zero peer reviewers. It still requires passing checks, a recorded review/completion step, and human integration. Finished work stays quiet until new input.

```text
/plan
/work-diff <task-id>
/integrate <task-id>
```

The live plan shows the editor, phase, review progress and last check outcome; `/plan` opens details. The diff command shows the completed proposal. Integration previews changes, asks the human to apply, pauses work, and uses hash-guarded checkpointed writes. If the primary checkout changed, application refuses the stale proposal. No commit or push is created. Separate worktrees allow simultaneous editing; overlapping proposals need human resolution when their base hashes conflict.

If independent acceptance finds a missed case, resume and send a concrete follow-up:

```text
/rework <task-id> The empty-file case still fails; reproduce it with the named tests.
```

Rework preserves the original check/review history, runs another checked review cycle, and creates a fresh integration proposal. It requires an unexpired lease. Evaluation records human rework separately from first-pass success.

See [measured acceptance](CODING_EVALUATION.md) and the [tool reference](TOOLS.md#coordinated-project-tools).

## Preview boundaries

Roundtable integrates reviewed file contents through hashes and checkpoints; it does not execute these previews as patches.

`unifiedDiff` produces bounded previews with common context. A final line without a trailing newline is marked by `\ No newline at end of file` immediately after that line, including when it appears as shared context; lines with different newline status are changes, not shared context. Small, complete, untruncated previews are intended to apply as patches. The row limit includes newline markers; a `[Preview truncated; ...]` sentinel means the output is for display only, not an applicable patch. Export the full proposal to inspect changes beyond the preview.
