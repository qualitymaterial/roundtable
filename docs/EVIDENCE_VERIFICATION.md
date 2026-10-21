# Evidence verification

Implemented source behavior, 2026-10-20. This extends [Web Intelligence](WEB_ORCHESTRATION.md) and the existing human-required artifact checks. It uses the shared registry for local and cloud models, with no model-specific verifier or new dependencies.

## What is enforced

`roundtable_task_update` cannot mark a task done using findings alone. It requires current human-required artifact checks, protected evidence contracts, or the existing code checks and author-excluding reviews. All applicable checks must pass. `project_finish` and code integration honor additional evidence/artifact contracts too. Dependencies require current completion evidence. Completion diagnostics exclude historical done tasks whose evidence has expired or whose checks fail; these failures cannot be waived through ordinary failure resolution. Stage task requirements also check evidence.

Agents may append findings while waiting for criteria. Existing tasks completed under earlier releases are historical reports until their evidence satisfies the current gate. Use `/require-check` for artifact/test outcomes and `/require-evidence` for structured web records. A human can repair/reopen an old task through the existing recovery controls. Existing code work continues using its current checks and reviews.

This gate controls runtime task state and verified results. Arbitrary assistant prose is still an agent report. The runtime does not semantically certify an explanation, infer that every statement in it is supported, or prevent a model from emitting an inaccurate sentence. Prompts explicitly distinguish reports from evidence. A confirmed result applies to its structured records and criteria only.

## Establish protected criteria

In an interactive session, load a human-authored JSON file:

```text
/require-evidence C:/project/schedule-criteria.json
```

Example (replace the task ID and source scope with the actual human-selected values):

```json
{
  "taskId": "unfinished-session-task-id",
  "description": "Compare all unique schedule records for October 20",
  "allowedHosts": ["example.com"],
  "sourceUrls": ["https://example.com/schedule/2026-10-20"],
  "maxAgeSeconds": 60,
  "minimumSources": 1,
  "recordsKey": "games",
  "fields": {
    "id": { "type": "identifier" },
    "team": {
      "type": "name",
      "aliases": { "New York Knicks": ["NY Knicks"] }
    },
    "date": { "type": "date" },
    "start": { "type": "time" },
    "tickets": { "type": "count" },
    "price": { "type": "number" }
  },
  "identity": ["id"],
  "requiredValues": { "date": "2026-10-20" },
  "aggregates": [
    { "name": "games", "operation": "count" },
    { "name": "tickets", "operation": "sum", "field": "tickets" }
  ],
  "maxAttempts": 5
}
```

`taskId` is optional for factual checks without a task. `expectedRecords` optionally pins a complete expected record set. `requiredValues` applies protected normalized values to each claimed record, useful for a requested date or entity. Criteria descriptions are documentation; only the structured fields are executable conditions. Select identity fields that distinguish real entities. Date-bound URLs and explicit criteria matter: retrieval time alone never proves that a publisher's schedule is for today.

Host integrations can call `engine.web.verification.require(input)` instead. No model tool creates, edits, drops or extends criteria. The runtime stores a criteria hash anchored in a human-configuration event. To retire a requirement deliberately, the human can use `/drop-evidence <contract-id> <reason>` or the host `drop` API. Original criteria, claims and evidence remain. Dropping the last requirement does not make an unverified ordinary task completable.

## Agent tools and evidence format

Models discover `roundtable_verification_requirements` through the shared registry. With `taskId`, it lists up to 20 contract summaries and current statuses; with `contractId`, it returns the full protected criteria. The model then uses `web.read` to retrieve permitted public URLs and `web.cache` to inspect additional sections beyond the default excerpt.

The deterministic parser currently accepts a complete readable JSON array, or an object containing an array at the protected `recordsKey`. `web.read` supports `application/json`, HTML and plain text; HTML/plain text can be verified only when their complete extracted text is valid JSON in this format. It does not ask a model to convert arbitrary prose into authoritative records. Extra root properties such as `instructions` are data and grant no authority. Snippets, truncated pages, malformed records and keyword matches cannot establish a fact.

Canonical tool names below are exposed to Pi models as `web__read`, `web__verify`, etc.:

```json
{
  "contractId": "uuid-from-protected-criteria",
  "claim": {
    "text": "The selected source records and totals",
    "records": [
      {
        "id": "game-01",
        "team": "NY Knicks",
        "date": "2026-10-20",
        "start": "2026-10-20T23:30:00Z",
        "tickets": 10,
        "price": 12.5
      }
    ],
    "totals": { "games": 1, "tickets": 10 }
  },
  "citations": [{ "sourceId": "uuid-from-web-read" }]
}
```

Supply exactly the configured fields and totals. `claim.text` is retained for audit and never establishes the verdict. Optional citation `start`, `end` and `quote` must match the snapshot exactly. Structured checks currently require the complete document; partial quotations cannot prove complete record sets or totals. This deliberately avoids cherry-picking a subset of a schedule. The legacy `web.verify` quote/text schema remains available for occurrence checks and does not confirm factual claims.

## Deterministic semantics

- Names use NFC Unicode normalization, case folding and whitespace normalization. Only human-defined aliases equate different spellings; punctuation, accents and different entities are preserved. Ambiguous alias groups are rejected. IDs retain case and punctuation.
- Dates require valid `YYYY-MM-DD`. Times accept `HH:mm[:ss]`, or ISO timestamps with explicit offsets normalized to UTC. Bare times are compared as local wall-clock values; the runtime never guesses a timezone or converts one into an instant.
- Numbers accept finite decimal values within the safe numeric range and exactly supported decimal precision; counts must be nonnegative safe integers. Decimal sums avoid binary addition drift. Locale-ambiguous numbers, relative dates and timezone abbreviations are rejected.
- Rows are compared as complete sets by protected identity. Identical duplicates do not inflate counts or sums. Conflicting records sharing an identity make the source unsuitable. Empty retrieved arrays can support zero counts; that alone does not establish a date or publisher completeness.
- Every supplied citation is validated. Matching snapshots plus conflicting snapshots produce `insufficient_evidence`, with precise field/total discrepancies. No majority vote resolves a conflict. `minimumSources` counts distinct permitted origins, not independent organizations or publication authors.

Structured verdicts are `confirmed`, `contradicted`, `insufficient_evidence`, or `verification_error`. They identify `deterministic_records_v1`, `usedLLM: false` and `independentlyVerified: false`. Confirmation means record agreement under the configured criteria, not independent publisher truth. Model verdicts/extra input fields are rejected; there is no model-assisted verdict promoted into deterministic acceptance.

## Provenance, freshness and recovery

SQLite retains separate protected contracts, immutable claim submissions, evidence snapshots and verdicts. Evidence records bind claim and contract IDs to source ID, original/canonical URL, retrieval/expiry timestamps, the source integrity hash, SHA-256 of the retained UTF-8 content, and exact extracted passages. Complete JSON document passages remain outside active model context; discrepancies and source/evidence handles are returned. `web.cache` provides bounded source sections. Existing legacy artifact findings remain separate.

Sources must belong to this session and current web policy, match their integrity hashes, remain within both contract freshness and runtime cache limits, and be untruncated pages in the exact permitted host/URL scope. Missing, future-dated, stale or corrupted evidence cannot confirm. Successful receipts are revalidated against the latest verdict and current source freshness; a superseded success cannot replay as current. Retrieval time is observation time, not publication time.

Failures return discrepancy codes, expected/actual values, source/evidence IDs and actionable feedback. Retries consume normal runtime tool budgets plus the protected contract attempt limit (default 5). Repeating unchanged failed evidence stops recovery; three corrections with no improvement also stop. Neither a rewritten explanation, alias spelling nor a new claim ID resets the same contract's budget. Only the human can replace exhausted criteria. Verification itself performs no new network requests; retries that retrieve evidence use existing web permissions, search budgets, deadlines and loop prevention.

Bounds: 100 contracts, 200 claim submissions and 1,000 evidence records per session; up to 100 records/20 fields and 64 KiB per record set or criteria document; 10 citations per check; 30 returned discrepancies plus an additional-discrepancy marker. Full passages remain stored. Limits fail closed without evicting audit evidence. Verification events appear in existing completion diagnostics (`/summary` and the host `completionReport` API).

## Security and limits

Retrieval keeps existing DNS-pinned public destinations, redirect denial, response caps and credential redaction. Retrieved instructions never enter a policy evaluator or executable code path. Verification parses JSON and compares values; it neither evaluates code nor follows URLs embedded in a document. Credentials stay in the runtime. Web execution and receipt replay recheck current membership, network permission, session/stage state and configuration.

Host access to the Roundtable database is a trusted boundary. This is not tamper-proof storage against an attacker who controls the host. Same-session restart retains evidence. Portable session bundles currently exclude web/evidence verification state; imported tasks cannot regain verified completion from historical findings and require fresh host configuration/evidence. Existing MCP tools remain available, but arbitrary MCP output is not automatically registered as trusted web provenance. New extraction formats or MCP evidence adapters must retain deterministic parsing, protected criteria and source integrity before they can satisfy this gate.

General prose fact-checking, publisher reliability, entity resolution beyond explicit aliases, natural-language entailment, live NBA feeds and real local/cloud model behavior are not established by these deterministic fixtures. Those remain separate acceptance work.
