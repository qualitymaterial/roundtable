# Web Intelligence — Phase 2

Structured record verification and protected completion criteria are now documented in [Evidence verification](EVIDENCE_VERIFICATION.md). Earlier quotation checks remain occurrence checks.

Date: 2026-10-20. This increment implements bounded search/read/evidence/cache primitives, a small research coordinator and deterministic quotation checks. The [audit and larger plan](WEB_INTELLIGENCE.md) remain the design reference. This document describes implemented interfaces; [TESTING.md](TESTING.md) records actual acceptance results and [STATUS.md](../STATUS.md) owns current state.

Subsequent [runtime orchestration](WEB_ORCHESTRATION.md) supersedes this increment's uniform TTL, three-repeat cutoff, full-page model output and deferred in-engine coalescing. It documents current freshness, scoped budgets/extensions, section handles and diagnostics. The Phase 2 baseline and dated acceptance below remain historical evidence.

## Configure

Disabled by default. Add a `web` section to `research.json` in the existing Roundtable data directory (`ROUNDTABLE_HOME` or the configured private directory), preserving any legacy settings. Example for an independently managed local SearXNG instance:

```json
{
  "web": {
    "enabled": true,
    "allowPublicRead": true,
    "provider": {
      "id": "main-search",
      "adapter": "searxng",
      "endpoint": "http://127.0.0.1:8080/search",
      "allowPrivateEndpoint": true
    },
    "timeoutMs": 15000,
    "cacheSeconds": 900,
    "maxSearches": 20,
    "maxReads": 40,
    "maxAttempts": 100,
    "requestsPerMinute": 10
  }
}
```

`allowPrivateEndpoint` authorizes only the fixed human-configured **search endpoint** and its selected port; it never authorizes private page URLs. Omit it for a public HTTPS search service (default false). Optional `tokenEnv` names an environment variable containing its bearer credential. That credential goes only to the selected endpoint; HTTPS is required except explicit loopback/localhost. Never put keys in configuration or prompts. `.env` is not loaded automatically. Redirects are rejected for all new web requests.

Enable JSON responses in SearXNG. The adapter uses `q`, `format=json`, optional `language` and `time_range=day|month|year`, following the [SearXNG Search API](https://docs.searxng.org/dev/search_api.html). Engine support for time/language filters varies; time filters do not verify publication dates. Domains are enforced locally against returned URL hosts/subdomains. Count is an upper bound; the adapter does not guarantee an engine understands `site:` syntax.

Participants also require `network.research` within the session capability ceiling. They may request it through `roundtable_tool_request`; the existing human approval flow decides. Configuration grants no permissions. Paused/waiting/frozen/blind stages still block access. Existing coding-assignment tool lists continue to omit web tools; no stages or roles were widened. Reconnect an existing participant after upgrading the executable so its registered definitions include these tools.

## Names and schemas

| Canonical registry/library name | Model wire name |
| --- | --- |
| `web.search` | `web__search` |
| `web.read` | `web__read` |
| `web.research` | `web__research` |
| `web.verify` | `web__verify` |
| `web.cache` | `web__cache` |

Some model APIs restrict function names, so Pi receives stable underscore aliases. All model providers receive the same schemas; wrappers execute the canonical name. Discovery reports both `name` and `wireName`. No model-provider browsing API is used.

The legacy `web_search`, `web_fetch`, `web_research` and `/research` retain their earlier contracts. They are compatibility interfaces, not aliases for these versioned tools. `/research settings` preserves nested web configuration but does not edit the new fields. `/research sources` and `clear-cache` affect legacy records; use `web.cache` for Phase 2 evidence. Generic MCP connection/authentication/allowlist behavior remains unchanged.

### Search

```json
{
  "query": "release documentation",
  "count": 5,
  "freshness": "month",
  "language": "en-US",
  "domains": ["example.org"],
  "maxAgeSeconds": 300
}
```

Only query is required. Count: 1–10 (default 5); freshness: `any|day|month|year` (default any); domains: at most 10 DNS names. Unsupported provider options fail explicitly. Unknown fields are rejected. Query whitespace is normalized conservatively; case, quoted text, operators and URL query semantics are retained. All effective filters participate in cache identity. Duplicate result URLs/fragments are merged; unsafe result URLs are omitted. Search snippets are explicitly distinguished from read pages.

### Read

```json
{ "url": "https://example.org/article", "maxAgeSeconds": 300 }
```

Public reads require explicit `allowPublicRead:true`. They allow HTTP(S) on standard ports, without URL credentials. Every DNS answer is checked; one validated address is pinned into the socket lookup while TLS validates the original hostname. Private/loopback/link-local/metadata/special-use IPv4 and non-global/transition IPv6 addresses are blocked, including alternate encodings and mixed public/private DNS answers. No redirects, proxy environment, cookies, browser state, authorization headers or page JavaScript are used.

Responses are capped at 1 MiB. Compressed responses, unsupported MIME types and empty extraction fail explicitly. Pinned `parse5@8.0.1` parses HTML without executing it; extraction prefers the first main/article region, decodes entities, and excludes script/style/navigation/form/hidden content. Plain text is supported. This is a bounded extractor, not browser rendering or full article-quality analysis. UTF-8 is used; other declared charsets receive warnings. Page text is capped at 12,000 characters with truncation metadata. Canonical hints are accepted only if safe and same-origin; they never trigger retrieval or merge snapshots.

Search/read return the existing `{ok:true,data}` wrapper. Data include `schemaVersion:1`, sources, retrieval time, cache flag, warnings and `untrusted:true`. Each source has a UUID `id`, snippet/page kind, title/text, URL/canonical URL, session/policy binding, retrieval/expiry timestamps, provider ID, MIME type, truncation, warnings and SHA-256 `hash`. Snippets are capped at 1,500 characters. Hashes cover retained metadata and extracted/redacted text, not original server bytes. Retrieval today does not prove publication today. IDs and exact text offsets support citations; hashes establish snapshot integrity, not factual truth.

### Research

```json
{
  "queries": [{ "query": "topic primary sources", "count": 3 }],
  "urls": ["https://example.org/article"],
  "maxReads": 2
}
```

Runs 1–3 searches and at most 0–5 reads (default 2), with selected URLs first, within shared session budgets and one overall deadline. Equivalent queries/URLs are deduplicated. Returns source IDs, URLs, titles, kinds, hashes, timestamps, exact character locators, bounded text, explicit partial errors and `conclusion:null`. Aggregate text is capped at 24,000 characters/20 entries. Failed sources are never invented. It does not recursively follow links, wake peers, run another model or synthesize unsupported conclusions. Concurrent equivalent requests may still contact the backend separately; shared transactional ceilings remain enforced.

### Verify

```json
{
  "claim": { "kind": "quote", "text": "The value is 42.", "counterText": "The value is 99." },
  "sourceIds": ["REPLACE_WITH_RETURNED_SOURCE_UUID"]
}
```

Literal snapshot checks only:

- For `kind:quote`, exact text occurring in a fresh, integrity-checked page snapshot is supporting. Only caller-specified counter-text occurring while claim text is absent is contradicting in this narrow quotation comparison. Both/neither occurring, snippets, missing/stale/corrupt sources yield insufficient.
- For `kind:text`, evidence remains insufficient even if wording appears. Presence is not factual verification. Literal matches are reported separately.
- Matches include snapshot hashes and exact text offsets. Results explicitly report `method:literal_snapshot_check`, `usedLLM:false`, `independentlyVerified:false` and the scope limitation. Counter-text is supplied by the caller, not independently discovered contradiction.

General numerical/date/factual checks, semantic entailment and independent corroboration remain extensions. The structured claim boundary and tested insufficient result are explicit extension points; no hidden LLM judge is implemented.

### Cache

```json
{ "action": "list" }
```

```json
{ "action": "get", "sourceId": "REPLACE_WITH_RETURNED_SOURCE_UUID", "maxAgeSeconds": 300 }
```

Read-only list returns up to 50 metadata entries; get validates schema, session ownership, current policy, hash and age. Agents cannot insert entries, override session IDs or read other sessions. Indexed cache keys bind effective options, provider ID/version, extraction version, configuration and credential revision. Policy/credential changes invalidate reuse. Hashes detect corruption, not an attacker controlling the database/code.

Search/read reuse permitted records. `maxAgeSeconds:0` forces a backend request with a **new call ID**. Durable registry receipts never silently start network work: stale or force-refresh replays require a new ID. Expired records remain for audit but cannot be read through cache/verify. Retained sources are capped at 200/session. Model-accessible deletion/writes, cross-session reuse, portable snapshot export and automatic eviction of cited evidence are not implemented. Portable bundles retain safe grants and omit these new entity kinds; historical source references in imported conversations may no longer resolve.

## Limits, errors and extension boundary

Defaults: 20 backend searches, 40 reads, 100 logical search/read attempts, 10 backend requests/minute, two concurrent backend operations, and at most three equivalent attempts including cache hits, all per session. Counters/reservations persist transactionally before dispatch across service instances. Dispatched failures/timeouts consume counts. Expired reservations release capacity without replay. Peer handoffs/model changes/new task names do not reset caps. Verify/cache still consume ordinary registry tool-call limits. Search-provider spending is not estimated or mixed into Pi model cost totals.

Deadlines default to 15 seconds (maximum 30), combined with caller cancellation. Research has one enclosing deadline. Production HTTP honors abort; late adapter responses cannot persist evidence after cancellation/revocation. Trusted additional adapters must honor the supplied signal. Permissions/policy are checked before work and delivery; an already-sent query cannot be recalled.

New web failures use `{ok:false,data:{code,message}}`. Codes distinguish invalid input/config, unconfigured/unavailable providers, unsupported options/media/encoding, denied destinations/redirects/permissions, changed policy, sensitive input, budgets, loops, rate limits, timeout/cancellation, malformed/oversized responses, extraction failure, unavailable sources and unmet freshness. Existing general runtime guards may return their established string errors. Empty search is success with no sources. No automatic retry or provider cycling occurs.

Audit reuses SQLite/activity events. New start events omit raw inputs; operation events record outcome/duration. Source-bearing tool results still enter existing history/audit. Detected credential-bearing queries/URLs are rejected; known credentials are removed before snapshot persistence. No keys or headers appear in schemas/results. Redaction cannot recognize arbitrary private text, so choose outbound queries deliberately. Retrieved instructions remain untrusted evidence and cannot grant permissions or modify configuration. This restricts requested effects; it cannot guarantee a model ignores hostile prose.

`SearchProvider`, factories, registry and service are exported. Register inspected factories through `engine.web.providers.register(adapterId,factory)` and select them in human configuration. Factories receive configuration/guarded transport; normalized arrays are independently validated. The shared service enforces count/domains. `MockSearchProvider` is an explicit deterministic fixture, never a fallback on service failure. `WebOptions` supplies transport/configuration/clock seams for tests; models cannot set them. Trusted factory code has Node process privileges. Core logic imports no LLM provider registry.

Deferred: automatic MCP web mappings/common raw-MCP budgets, richer live provider acceptance, browser rendering, conditional HTTP revalidation, concurrent request coalescing, semantic verification and citation-aware portable evidence export. Generic MCP compatibility does not claim control of a remote server's network behavior.

## Acceptance

On 2026-10-20, final `npm run check` passed typecheck, lint, build and **215 tests**, zero failures, with three existing optional sandbox tests skipped (218 total). All 20 new web tests passed, including independent scripted Pi providers consuming identical schemas/results, native HTTP fixtures, SSRF/DNS controls, provider validation, timeouts, cache isolation, credential rotation, quoted-query preservation, revocation and budget concurrency. Evidence: `artifacts/verification/web-phase2-2026-10-20/full-check.txt`. A real public HTTPS read/extraction smoke also passed (`public-read-smoke.json`). Scripted providers are not live local/cloud inference; no production SearXNG quality or general fact-verification claim is established.
