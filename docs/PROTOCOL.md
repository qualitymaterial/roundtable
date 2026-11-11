# Collaboration protocol v0.1

MessageInput is validated with Zod before routing. Committed records include:

| Field | Meaning |
| --- | --- |
| `id`, `sequence`, `timestamp` | Unique ID, database ordering, ISO timestamp |
| `sessionId`, `sender`, `recipients` | Session and authenticated sender identity; recipient IDs |
| `threadId`, `type`, `body` | Discussion thread, typed purpose, bounded text |
| `artifacts`, `taskId`, `correlationId` | Artifact/task references and request correlation |

Types: direct, group, broadcast, tool_result, task_request, task_response, reply, artifact, human, system. Agent tools cannot impersonate human/system senders. `*` resolves current nonremoved peers, excluding the sender. Direct delivery is routing, not secrecy: session participants can retrieve the shared transcript.

SQLite assigns a monotonic sequence. A unique message ID prevents duplicate insertion. Reusing an ID with conflicting data is rejected. Recent messages with the same sender, thread, recipients, text, task and artifact references are suppressed. A corrected artifact can be sent with the original review request text. Changing only the correlation ID or reply flag leaves suppression in effect. Self-messaging is rejected and an exchange budget bounds longer cycles.

Delivery state is a separate record per recipient: pending → inflight → acknowledged or failed. It carries attempt count and an optional redacted error. Acknowledgement means the recipient's prompt run completed; it does not prove a human reviewed the output or the objective is solved. Failed deliveries require `/retry`. Paused/interrupted deliveries remain pending; abandoned inflight deliveries recover on opening the session.

Delivery is **at least once**. A retried message can generate new tool-call IDs. Roundtable caches tool receipts per session and agent and checks their input fingerprints. An interrupted tool operation with an uncertain outcome blocks further execution until human reconciliation. External tool authors should use durable operation IDs and make side effects idempotent across retries.

Queues are bounded; a full queue rejects the send without blocking on peer responses. One recipient context runs at a time, with global concurrency bounded independently. Ordinary assistant responses are transcript-only and do not route automatically. Context tools return selected messages or notes; bounded request/context budgets prevent unbounded transcript growth during execution.


## Turn activation and waiting (0.2.0-dev.12)

Standalone English greetings and thanks are handled locally with one persisted Roundtable response. They do not invoke models/tools, spend collaboration budgets, resume paused work or steer a running agent. This is intentionally a narrow courtesy matcher, not a general natural-language intent classifier. Requests containing additional instructions or attachments continue through normal delivery. Existing active work is not cancelled by a greeting.

Peer `expectsReply` defaults to false, except `task_request` defaults to true. Notifications are committed with acknowledged deliveries (stored, not model-read) and a `notification_stored` event. They remain available via thread retrieval without waking a recipient. Questions, delegated actions and results needing immediate processing must explicitly request a turn. Human and system messages retain their scheduling behavior. Historical persisted messages without this field retain their existing queue status.

Call `roundtable_wait` before ending the current turn. In `peers` mode, a review response with `expectsReply: true` can wake the owner. In `human` mode, the wait is durable and peer deliveries are cancelled while their messages remain in thread history. A targeted substantive human message or system approval/job notification clears that wait at dispatch. A greeting leaves it in place. Both modes block further tool execution and peer sends in the waiting turn.

A scheduled turn without an earlier substantive human message cannot execute tools. The prompt includes the human request and explicit project root, and distinguishes requested work from placeholder objectives or repository suggestions. This enforces the absence of a request; semantic scope within an actual request still depends on model behavior and existing permissions. Models can explicitly request further turns, so exchange/request budgets remain necessary.

The timeout now covers a continuous burst of running/queued collaboration and background work. Connection probes and idle human-input time are excluded. A settled burst resets this clock; token, cost, request, tool and exchange budgets remain cumulative. Every delivery emits `turn_end`, including errors, interruption and turn timeout. Timeouts are recorded as failures rather than successful acknowledgments.
