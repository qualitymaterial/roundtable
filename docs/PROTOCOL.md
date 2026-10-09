# Collaboration protocol v0.1

MessageInput is validated with Zod before routing. Committed records include:

| Field | Meaning |
| --- | --- |
| `id`, `sequence`, `timestamp` | Unique ID, database ordering, ISO timestamp |
| `sessionId`, `sender`, `recipients` | Session and authenticated sender identity; recipient IDs |
| `threadId`, `type`, `body` | Discussion thread, typed purpose, bounded text |
| `artifacts`, `taskId`, `correlationId` | Artifact/task references and request correlation |

Types: direct, group, broadcast, tool_result, task_request, task_response, reply, artifact, human, system. Agent tools cannot impersonate human/system senders. `*` resolves current nonremoved peers, excluding the sender. Direct delivery is routing, not secrecy: session participants can retrieve the shared transcript.

SQLite assigns a monotonic sequence. A unique message ID prevents duplicate insertion. Reusing an ID with conflicting data is rejected. Repeated identical messages in the recent sender/thread/recipient window and self-messaging are rejected. An explicit exchange budget stops longer cycles that evade the repeated-text guard.

Delivery state is a separate record per recipient: pending → inflight → acknowledged or failed. It carries attempt count and an optional redacted error. Acknowledgement means the recipient's prompt run completed; it does not prove a human reviewed the output or the objective is solved. Failed deliveries require `/retry`. Paused/interrupted deliveries remain pending; abandoned inflight deliveries recover on opening the session.

Delivery is **at least once**, not exactly once. A crash between a tool side effect and its result-cache commit can replay that effect. Tool-call IDs are cached per session/agent and checked against input fingerprints. This reduces duplicates but does not provide distributed transactions with external services or Pi's JSONL store. Extension tools should be idempotent and use durable operation IDs for external side effects.

Queues are bounded; a full queue rejects the send without blocking on peer responses. One recipient context runs at a time, with global concurrency bounded independently. Ordinary assistant responses are transcript-only and do not route automatically. Context tools return selected messages or notes; bounded request/context budgets prevent unbounded transcript growth during execution.
