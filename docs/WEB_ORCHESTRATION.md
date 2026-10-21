# Runtime web orchestration

Structured record verification and protected completion criteria are now documented in [Evidence verification](EVIDENCE_VERIFICATION.md). Earlier quotation checks remain occurrence checks.

Date: 2026-10-20. Extends the [Phase 2 web tools](WEB_INTELLIGENCE_PHASE_2.md) through the same registry, permissions, provider interface and SQLite repository. These rules supersede Phase 2's fixed three-repeat cutoff, uniform source TTL and full-page model output. No model provider or fixed agent role is required.

## Freshness and reuse

Search/read classify the query plus the **targeted human request** as changing, stable-topic or unknown. Current news, schedules, prices, releases, advisories, versions and other changing external facts use short-lived observations. Unknown classification is conservative. Default maximum ages are 60 seconds for current/unknown and 3,600 seconds for stable topics, additionally capped by `web.cacheSeconds` (900 seconds by default) and any smaller `maxAgeSeconds`.

This classification governs **observation age**, not factual truth or a publisher's publication date. Responses identify live-source snapshots, retrieval times, cache age and the freshness decision. Model knowledge never enters the source store. A recently fetched webpage can itself contain old facts; agents must inspect relevant dates and evidence, and `web.verify` still does not independently verify general claims.

Agent `fresh:true` or `maxAgeSeconds:0` requests a new retrieval. A human's explicit fresh/live request bypasses an earlier task's cache on its first successful retrieval, then allows equivalent calls to reuse that task's recent observations. Replaying an old call ID cannot silently refresh; issue a new call ID. Expired data never falls back as a current answer when the provider is unavailable.

`timeZone` accepts an IANA zone, otherwise the runtime's local zone is used. Today's schedule requests are anchored to that zone's calendar date before sending the query. Midnight changes cache identity. Dates, times, regions, filters and intent remain part of request identity.

## Query equivalence and loops

Normalization retains quoted whitespace, case-sensitive literal text, operators and token order. It sorts/deduplicates domain filters and normalizes region casing. A small deterministic, anchored paraphrase recognizer merges forms such as “today's NBA schedule,” “NBA games today” and “NBA fixtures for today.” It rewrites them to an explicit calendar date. Tonight remains distinct from all-day today. This is conservative pattern-based equivalence, not a claim to recognize every natural-language paraphrase.

New optional search fields:

```json
{
  "query": "technical performance comparison",
  "intent": "comparison",
  "region": "US",
  "dateRange": { "from": "2026-01-01", "to": "2026-02-01" },
  "timeZone": "America/New_York",
  "fresh": false
}
```

Intent is `factual|comparison|historical|technical`. Region/date-range support must be declared by an adapter; the current SearXNG adapter rejects these structured filters rather than ignoring them. Existing `freshness`, language and domain options remain supported. Different date ranges, regions, intents, counts, filters, quoted meaning or timezones do not share a cache identity accidentally.

Fresh equivalent calls reuse source IDs and timestamps without backend requests, even after three repeats. Concurrent equivalent requests in one engine share one backend operation. Waiters have independent cancellation; cancelling one does not cancel a remaining waiter. Separate service/process instances share durable quotas but do not share an in-memory request promise. No MCP participant sessions are pooled across agents by this feature.

Two failed attempts at the same retrieval trigger a default 30-second retry cooldown. Suppressed calls return a structured reason, retry time and suggestions. Repeated forced refreshes that return identical content are suppressed after two no-new-evidence refreshes while a valid observation remains available; expiration permits a meaningful refresh again. This includes the `maxAgeSeconds:0` route. Changed page content resets novelty. New queries are not blocked solely because earlier different queries were unproductive; ordinary scoped/session quotas still apply.

Feedback suggests retained source handles, waiting for provider recovery, or adding a genuinely missing date/region/primary-source constraint. It never starts another search automatically. Search/research retain partial errors and source lineage rather than synthesizing consensus.

## Task and agent budgets

The runtime binds scopes to targeted human request IDs. Peer handoffs and model-created task names cannot create a fresh allocation. Agent IDs come from the tool execution context, never model arguments. Human requests explicitly asking for deep/extensive/comprehensive/thorough investigation receive a deep profile; otherwise the simple profile applies. Embedders can supply a trusted `WebContext`; that is a runtime API, not an agent-controlled schema.

Defaults:

| Boundary | Backend searches | Page reads |
| --- | --- | --- |
| Simple human request, shared by participating agents | 3 | 4 |
| Deep human request | 8 | 12 |
| Per-agent session ceiling | 20 | 40 |
| Existing whole-session ceiling | 20 | 40 |

Cache reuse consumes logical attempt/tool limits but no backend request allowance. Reservations are transactional with session limits. Scope allocations are established when a scope first performs work; changing defaults does not silently reauthorize an existing scope. Current agent/session hard ceilings and permissions remain enforced.

A deep task can receive **one runtime-policy extension** of four searches/four reads when at least two backend operations have retained distinct source content and the latest backend calls are still productive. Repeated cached responses do not consume that productivity signal. An unproductive loop cannot earn an automatic grant. This is a finite resource policy, not a claim that source novelty proves research quality.

Use `/diagnostics web` for an explicit human extension when evidence remains insufficient. It shows task counts, requests a bounded addition and unresolved-gap reason, then displays the exact proposed grant before confirmation. The agent-facing tools cannot approve it. The trusted library API is `engine.web.approveBudgetExtension(scopeId, searches, reads, reason)`. An extension never runs/retries a call or bypasses rate, session, agent, destination or permission ceilings. Raise those human-configured ceilings separately when deliberately planning a larger project.

The runtime tracks potential conflicts in explicit `Field: value` lines from retained pages. Different current URLs with different values remain separately attributed and prompt comparison. Newer observations of the same URL replace that URL's older value for this narrow signal; expired observations are removed. This is a bounded literal conflict detector, not semantic contradiction detection or independent truth verification. Human extensions can cite unresolved conflicts as their reason.

## Context-efficient source access

The immutable source store retains up to 64,000 extracted/redacted characters per page, outside active model context. Normal search/read responses return a relevant excerpt of at most 900 characters, its exact UTF-16 offsets, full-snapshot hash, total character count, next-section offset and source handle. Read accepts an optional `focus` string for local excerpt selection; it is not forwarded to the page server.

```json
{ "url": "https://example.org/article", "focus": "performance limitations" }
```

Read additional sections through the existing cache tool:

```json
{ "action": "get", "sourceId": "RETURNED_SOURCE_UUID", "start": 13000, "length": 1500 }
```

Length defaults to 1,200 and is capped at 4,000. Identical content/ranges already delivered to that agent in that human-request scope are omitted (`contentOmitted:true`); metadata and handles remain. Other agents retain independent delivery state. If compaction or context loss removed a needed section, explicitly use `includePreviouslySeen:true`. Delivery state persists in SQLite; agents cannot write it or impersonate another recipient. Full-snapshot hashes refer to stored text, not just the returned excerpt. Verify/citation offsets continue to address the complete stored snapshot.

The existing 1 MiB HTTP cap, 200-snapshot session retention ceiling, global result-byte cap, public-address validation, no redirects/cookies/scripts and credential separation remain in force. No browser, parser dependency or telemetry service was added in this increment.

## Configuration and diagnostics

Keep existing `research.json` fields; add overrides under `web.orchestration`. For example:

```json
{
  "web": {
    "enabled": true,
    "allowPublicRead": true,
    "provider": {
      "id": "main-search",
      "adapter": "searxng",
      "endpoint": "http://127.0.0.1:8080/search",
      "allowPrivateEndpoint": true,
      "estimatedCostPerSearch": 0.002
    },
    "maxSearches": 40,
    "maxReads": 60,
    "requestsPerMinute": 20,
    "orchestration": {
      "currentSeconds": 60,
      "unknownSeconds": 60,
      "stableSeconds": 3600,
      "simpleSearches": 3,
      "simpleReads": 4,
      "deepSearches": 12,
      "deepReads": 20,
      "agentSearches": 40,
      "agentReads": 60,
      "autoExtendDeep": true,
      "extensionSearches": 4,
      "extensionReads": 4,
      "retryCooldownMs": 30000,
      "excerptChars": 900
    }
  }
}
```

The cost value above is an **example operator estimate in dollars**, not a SearXNG price or measured invoice. Omit it when cost is unknown. Native read costs remain unknown rather than assumed free. Reports keep known estimates, unknown-cost request counts and model-provider costs separate.

Session `/diagnostics` now includes web metrics; `/diagnostics web` also provides the extension flow. Programmatic access: `engine.web.diagnostics()`. The standalone provider-diagnostics command without an open session retains its existing behavior. Metrics report successful searches/reads, duplicate/reused calls, cache hits, retry/loop suppressions, failed backend/tool calls, backend latency, approximate cost and scoped allocations. Permission/schema failures are counted without pretending a backend request ran.

SQLite `web_orchestration` audit events record query fingerprints, freshness decisions, reused/suppressed source handles, outcomes, latency, configured estimates and exact budget-extension reasons. Raw search strings, human request bodies, headers and credentials are omitted. Existing source-bearing tool history remains private evidence, not a deletion guarantee. Web counters cover instrumented calls after this upgrade; earlier recorded events cannot reconstruct missing provider metrics.

## Verification and limits

Deterministic scenarios live in `test/web-orchestration.test.ts`, alongside existing `test/web-intelligence.test.ts`. The NBA fixture preloads an expired observation, refreshes it, merges equivalent schedule phrasings, reads dated page evidence, and answers from that fixture without repeated backend calls. The extensive technical-research fixture produces distinct sources, exercises runtime-policy/human extensions and preserves conflicting evidence. Other cases cover unknown/explicit freshness, midnight, failed/unavailable providers, retries, quoted/date/region/intent distinctions, sections/context recovery, independent agents, coalescing/cancellation, permission/schema metrics and diagnostics approval.

These tests do not call a real NBA feed or prove a local/cloud model's answer quality. The actual check counts and retained command output are recorded in [TESTING.md](TESTING.md) and canonical [STATUS.md](../STATUS.md). General semantic equivalence, publisher freshness verification, semantic conflict resolution and measured end-to-end token/cost savings remain unproven. The service does not treat an LLM opinion or novelty count as independent verification.
