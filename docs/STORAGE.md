# Storage and recovery

The default runtime directory is `~/.roundtable`, independent of the launch folder. `ROUNDTABLE_HOME` overrides it; optional `~/.roundtable/config.json` selects an existing `dataDir`. This checkout points that configuration at its original repository `.roundtable` directory, preserving keys and sessions. Keep the runtime private and back it up before upgrades.

```text
.roundtable/
  roundtable.db                 SQLite WAL database
  auth.json                     supported Pi auth, when configured
  catalog.json                  SDK local catalog state
  endpoints.json                operator compatible-endpoint configuration
  agents.json                   saved startup membership (live-agents.json fallback)
  host-access.json              explicitly saved filesystem/shell policy
  sessions/<session>/<agent>/   separate Pi JSONL context files
  workspaces/<session>/         explicitly shared files
```

Migration 2 adds `delivery_order(message_id,rank)`, preserving human-selected queue order separately from immutable transcript sequences. It is additive; normal delivery falls back to message sequence. Migration 1 creates indexed entities, append-only messages/events, per-recipient delivery state, tool-result cache and a migration ledger. Entities hold sessions, agents, tasks, artifacts, approvals and notes. Repository transactions use BEGIN IMMEDIATE; writes are committed locally. Task claim checks and mutation are atomic. Artifact content is immutable through public tools and hash-checked on read.

Optional host policy is stored with session JSON; older records remain readable without a table migration. Command approvals move from pending to approved/rejected, then approved to consumed before process launch. A crash after consumption may require a new approval; commands are never automatically replayed. Host cache fingerprints include the current root policy, preventing cached reads after root revocation.

Ordered message sequences and delivery records allow restart recovery. Inflight records become pending when Engine opens a session; acknowledged records remain acknowledged. Failed deliveries are preserved for explicit `/retry`. Removed/paused agents retain history. Each active agent uses SessionManager.continueRecent on its own directory, preserving independent context instead of merging all history.

SQLite and Pi JSONL are separate stores. A crash can happen between side effect, JSONL persistence and acknowledgement. Delivery is at least once; cached tool IDs reduce replay but do not promise exactly-once effects. The database is not encrypted, tamper-proof or a multi-process job queue.

`session verify <id>` reads committed evidence and Pi contexts without connecting providers or recovering deliveries. Successful demo runs append a `collaboration_acceptance` event. Verification hashes agent identities, ordered messages, delivery state, tasks, artifacts and context checksums; `matchesLastAcceptance` compares this snapshot with that event. Reopening unchanged state preserves the hash. Continuing work changes it; the earlier event remains historical evidence. These checks are structural and do not authenticate model output or protect against an operator editing storage.

`session export` produces session/agent metadata, messages/deliveries, tasks, artifact contents, notes, approvals and audit events. It excludes auth.json and Pi's raw context files. Inspect exported conversation content for sensitive data before sharing. Back up the complete data directory while the app is stopped; do not copy only the SQLite main file while WAL writes are active.

## New durable records

The existing generic entity repository stores `checkpoint`, `job` and `knowledge` records without changing older entity data. The ownership component creates `session_owners(session_id,pid,host,token)` and claims it transactionally before inflight recovery. Session records may include human completion metadata; new usage events optionally include token components. Older records remain readable.

Checkpoint original file text stays private and is not included in ordinary session exports. Knowledge is scoped to a canonical launch folder and intentionally excluded from automatic session/model context. Pi compaction retains original JSONL entries plus a compaction record; agent histories never merge. SQLite and JSONL do not form one transaction, so crash recovery remains at least once.


### Development release 0.2.0-dev.5

Generic entity records now include operations, notification receipts, drafts, scoped attachments and contribution evidence. New session fields preserve project root, optional name/archive and workflow stage state. These additions use the existing generic entity table; old records remain readable with conservative defaults. Message attachments are optional IDs. Cancelled deliveries retain original messages and audit history. Queued replacement insertion and original-delivery cancellation commit together. Message thread filtering and bounded retrieval execute in SQL.

Tool prepared receipts precede handlers; completion receipt/cache/event commit together. A crash between an external effect and its receipt remains ambiguous and requires human reconciliation. Checksums establish stored-byte integrity, not correctness or safety. Images are base64 snapshots in the private SQLite store, bounded to 2 MiB each and 20 MiB per session. Text snapshots are bounded and redacted; original selected files are not modified. Existing JSON transcript export is not a full portable backup of Pi histories, attachment bytes or filesystem contents.

## Portable bundles (dev.6)

`session-bundles.ts` captures a paused, settled session as a versioned `.rtbundle` with an envelope checksum and per-file hashes. It includes agents, messages, shared entities, event history, regular shared-workspace files and separate Pi v3 JSONL histories. The default bounds are 64 MiB encoded, 32 MiB decoded files, 16 MiB per file, and the existing attachment bounds. Hidden workspace entries, credential paths and links are excluded and reported. Host project files, project-wide memory, authentication and other runtime configuration are not included.

Import validates shapes, references, hashes, dependency cycles and paths before SQLite commit, then creates a fresh paused branch with new IDs. It retains text literally and provides `roundtable_reference_resolve` for historical IDs across repeated forks. Active task claims release. Historical approvals are excluded; jobs/checkpoints/tool receipts are inert audit data. Imported messages have cancelled deliveries, never automatic replay. Separate Pi contexts use new directories/headers. Imported workflow stages start at the first gate with no prior approval; instruction snapshots require human review again. File staging is removed on caught failure; a process crash during staging can leave an unreferenced UUID directory, never a visible partial session.

`projects/<root-hash>.json` contains human-saved per-folder defaults and instruction snapshots. `drafts/<uuid>.txt` holds temporary external-editor files; failed, unchanged or detached-launcher drafts are retained for manual recovery. Bundles and recovery files are private, unencrypted content, not safe public exports. See SESSION_RECOVERY.md for commands and limits.

Migration 3 creates memory_fts (SQLite FTS5) for notes and human project knowledge and populates existing rows. Triggers update/delete indexed text with entity mutations; search filters scope and expiry. Research snapshots are session-scoped research entities with timestamp, expiry, source hash and bounded text. MCP OAuth state is private runtime data under mcp-auth; portable session bundles exclude it, encrypted full-runtime backup includes it.
