# Reproducible memory design collaboration

Run `npm run build` and `npm run demo`. The human creates a new goal session; three independent Pi sessions use deterministic alpha, beta and gamma model fixtures. These names are fixture identities, not built-in production roles.

Alpha discovers participants, creates and claims a task, records a note and sends a task request to Beta. Beta receives that message in its own Pi context, writes comparison evidence, updates the task and replies to Alpha. The human asks Gamma for an independent contribution. Gamma searches persisted evidence, appends task findings, publishes a JSON design artifact and notifies Alpha. Alpha reads it through the artifact tool, parses its JSON and completes the task. A separate host validator verifies its SHA-256, schema and event ordering. No artifact code executes.

The artifact compares JSONL, SQLite events and vector retrieval, with limitations and invariants. This is a verifiable technical artifact fixture, not generated live research or a runnable model-created prototype. Unit and integration tests independently exercise the implemented SQLite state store.

The demo prints the session ID. Use `node dist/cli.js session export <id> conversation.json`, `node dist/cli.js validate <id>`, or `node dist/cli.js session resume <id>`. `/messages`, `/tasks`, `/artifacts`, `/activity` and `/status` inspect restored data. Production agents are added with `/add-agent` JSON; the same engine supports mixed providers.
