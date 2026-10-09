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

Migration 1 creates indexed entities, append-only messages/events, per-recipient delivery state, tool-result cache and a migration ledger. Entities hold sessions, agents, tasks, artifacts, approvals and notes. Repository transactions use BEGIN IMMEDIATE; writes are committed locally. Task claim checks and mutation are atomic. Artifact content is immutable through public tools and hash-checked on read.

Optional host policy is stored with session JSON; older records remain readable without a table migration. Command approvals move from pending to approved/rejected, then approved to consumed before process launch. A crash after consumption may require a new approval; commands are never automatically replayed. Host cache fingerprints include the current root policy, preventing cached reads after root revocation.

Ordered message sequences and delivery records allow restart recovery. Inflight records become pending when Engine opens a session; acknowledged records remain acknowledged. Failed deliveries are preserved for explicit `/retry`. Removed/paused agents retain history. Each active agent uses SessionManager.continueRecent on its own directory, preserving independent context instead of merging all history.

SQLite and Pi JSONL are separate stores. A crash can happen between side effect, JSONL persistence and acknowledgement. Delivery is at least once; cached tool IDs reduce replay but do not promise exactly-once effects. The database is not encrypted, tamper-proof or a multi-process job queue.

`session verify <id>` reads committed evidence and Pi contexts without connecting providers or recovering deliveries. Successful demo runs append a `collaboration_acceptance` event. Verification hashes agent identities, ordered messages, delivery state, tasks, artifacts and context checksums; `matchesLastAcceptance` compares this snapshot with that event. Reopening unchanged state preserves the hash. Continuing work changes it; the earlier event remains historical evidence. These checks are structural and do not authenticate model output or protect against an operator editing storage.

`session export` produces session/agent metadata, messages/deliveries, tasks, artifact contents, notes, approvals and audit events. It excludes auth.json and Pi's raw context files. Inspect exported conversation content for sensitive data before sharing. Back up the complete data directory while the app is stopped; do not copy only the SQLite main file while WAL writes are active.

## New durable records

The existing generic entity repository stores `checkpoint`, `job` and `knowledge` records without changing older entity data. The ownership component creates `session_owners(session_id,pid,host,token)` and claims it transactionally before inflight recovery. Session records may include human completion metadata; new usage events optionally include token components. Older records remain readable.

Checkpoint original file text stays private and is not included in ordinary session exports. Knowledge is scoped to a canonical launch folder and intentionally excluded from automatic session/model context. Pi compaction retains original JSONL entries plus a compaction record; agent histories never merge. SQLite and JSONL do not form one transaction, so crash recovery remains at least once.
