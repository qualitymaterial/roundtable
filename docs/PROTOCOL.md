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


## Turn activation and waiting (0.2.0-dev.12)

Standalone English greetings and thanks are handled locally with one persisted Roundtable response. They do not invoke models/tools, spend collaboration budgets, resume paused work or steer a running agent. This is intentionally a narrow courtesy matcher, not a general natural-language intent classifier. Requests containing additional instructions or attachments continue through normal delivery. Existing active work is not cancelled by a greeting.

Peer `expectsReply` defaults to false, except `task_request` defaults to true. Notifications are committed with acknowledged deliveries (stored, not model-read) and a `notification_stored` event. They remain available via thread retrieval without waking a recipient. Questions, delegated actions and results needing immediate processing must explicitly request a turn. Human and system messages retain their scheduling behavior. Historical persisted messages without this field retain their existing queue status.

`roundtable_wait` persists a participant's waiting state. Further tool execution (including cached results) and peer sends from that participant are blocked. Queued/new peer requests to it are cancelled as deliveries, with message content retained in thread history. A targeted substantive human message or system approval/job notification clears the wait at dispatch. A greeting does not clear it. Independent context and membership remain intact; waiting does not remove permissions.

A scheduled turn without an earlier substantive human message cannot execute tools. The prompt includes the human request and explicit project root, and distinguishes requested work from placeholder objectives or repository suggestions. This enforces the absence of a request; semantic scope within an actual request still depends on model behavior and existing permissions. Models can explicitly request further turns, so exchange/request budgets remain necessary.

The timeout now covers a continuous burst of running/queued collaboration and background work. Connection probes and idle human-input time are excluded. A settled burst resets this clock; token, cost, request, tool and exchange budgets remain cumulative. Every delivery emits `turn_end`, including errors, interruption and turn timeout. Timeouts are recorded as failures rather than successful acknowledgments.
