# Sprint 2 — usable integrations and evidence

Delivery: 0.2.0-dev.11. STATUS.md is canonical. This builds on Sprint 1 without replacing Pi or changing independent agent contexts. No telemetry, hosted model calls or remote publication were added.

## Conversation and settings

Ink agent messages render headings, bold spans, inline code, fenced code/diff blocks, quotes and explicit HTTP links. Links display their destinations as text; there is no active HTML or OSC hyperlink execution. Native terminal fonts/backgrounds, NO_COLOR, ASCII mode and narrow wrapping remain supported. This is a bounded Markdown subset, not a browser or a full syntax-highlighting engine. Approval and error content remains literal.

Grouped change review now shows removed and added lines with common context. The preview is capped at 160 changed/context lines per file; /change-group export retains the full proposal. It is a single change-block diff, not a minimal patch algorithm.

Invalid budget and research settings stay in the input field with a useful message. Endpoint URL/context/output fields also use the reusable validation mechanism. Other existing dialogs retain their existing error handling; a complete form-library conversion is not claimed. Skill, MCP, memory and workflow inspection no longer require reading raw JSON. Scripted exports remain structured.

## Complete reviewed skill packages

- /skills package selects SKILL.md and captures its folder, including references, scripts, assets and license files.
- Review the instructions and file/hash manifest before accepting. /skills inspect reads individual installed text files; binary files require an appropriate external viewer.
- /skill:name invokes instructions. Agents use roundtable_skill_file for supporting files. Disabled/manual-only skills remain restricted.
- /skill-stage name explicitly copies the saved package into the shared workspace. Then /sandbox grant authorizes a participant for that exact folder. The participant can run Linux interpreters through sandbox_execute; humans can use /sandbox run.

Nothing executes on installation, inspection, discovery or staging. There is no in-process JavaScript plugin loader. Executable extensions in this increment are reviewed package scripts under the existing sandbox boundary; arbitrary native host plugins remain unsupported. A human can still separately authorize existing host/MCP execution with its documented OS privileges.

Bounds: 100 files, 2 MiB total, 512 KB each, ten directory levels; symlinks and unsafe/sensitive paths are rejected. .git, node_modules and __pycache__ are excluded. File hashes and the manifest detect corruption; these are not publisher signatures or malware detection. Known text credentials are refused. Binary secrets cannot be recognized reliably. Package licenses are retained, not re-licensed by Roundtable.

## MCP browser sign-in and templates

/mcp manage offers OAuth browser sign-in/logout, tool discovery, exact tool/resource allowlists and resource-template inspection. Roundtable embeds the verified Pi 1.1.0 OAuth implementation, including PKCE, state, discovery, client registration and refresh. Enter an optional pre-registered client ID when the server requires one; otherwise dynamic registration is attempted. Servers requiring client secrets or unsupported registration methods need additional integration.

Each newly encountered authorization origin requires human approval. HTTPS is required except loopback HTTP. Redirects and oversized OAuth responses are refused. The loopback callback has a two-minute timeout; Escape/cancel stops the waiting prompt. Credentials are stored privately under ROUNDTABLE_HOME/mcp-auth, bound to the exact resource URL. Tokens are registered with runtime redaction. They are included only in encrypted full-runtime backups, not portable session bundles. Windows protection still depends on the user's account/directory ACLs.

Refresh reuses approved origins through Pi. Additional consent returns the human to sign-in. Existing per-participant connections remain separate; failed invocations are not blindly replayed. Pi may retry an HTTP request rejected with 401 after authentication, following its transport behavior. Changing tokens/configuration rebuilds subsequent pooled connections. Close/reconnect an in-flight connection when revoking access.

mcp_resource_templates lists one bounded page. Templates themselves grant no read rights: substitute a value and explicitly allow its exact URI through select-resources before using mcp_resource_read. Hosted OAuth server acceptance is still separate from the complete local protocol test.

## Research and memory

/research settings configures either a SearXNG JSON endpoint or a JSON service accepting POST {query} and returning {results:[{url,title,content}]}. The SearXNG instance must enable JSON responses. Authentication uses a named environment variable; nothing discovers another application's credentials.

/research search and the web_search tool return source URLs/titles/excerpts, retrieval time and content hash. /research fetch and web_fetch read only human-approved exact origins, without cookies, model credentials, redirects or JavaScript. The server returns at most 1 MiB; HTML script/style content is removed and extracted text is limited to 16000 characters. This is text inspection, not rendered browser automation. The allowlist can intentionally include an internal service; approve only origins you intend agents to read, since query strings may convey data.

Search/page snapshots are scoped to a session, cached for 15 minutes by default (configurable 0–86400 seconds), and remain untrusted evidence. Policy and credential changes invalidate cache identity. /research sources lists provenance; /research clear-cache removes that session's snapshots. fresh:true bypasses the cache. Agents still require network.research authorization.

Session notes and human-curated project memory now use SQLite FTS5 with ranked Unicode token/prefix matching, not arbitrary substring matching. Migration 3 indexes existing notes and keeps inserts, edits and deletions synchronized. Project boundaries and expiry are enforced before returning results. /share-memory remains the explicit cross-session disclosure step; search does not inject history into model contexts.

## Workflow prerequisites and comparison

Workflow stages may specify requires (stage names), taskTitles and requireValidation. Names must be unique; missing/cyclic prerequisites are rejected. Without requires, existing workflows retain sequential order. /next-stage [name] chooses an eligible stage after all participants finish; /stage shows blockers. One stage is active at a time. Required tasks/checks are rechecked at human approval, including artifact versions. Examples include examples/workflows/verified-delivery.json. Existing /add-agent and budget controls remain human-controlled; this does not enable automatic team spawning.

roundtable evaluate comparison.json compares existing one-participant and multi-participant sessions with the same objective. It reports checks, completion evidence, first-pass versus repaired outcomes, usage, elapsed time, peer messages and explicit human rubric scores. It initiates no inference. Different limits and mock models are flagged; time includes human waits and prices retain existing estimate limitations. See examples/evaluations/README.md for matched-run instructions. No model-quality advantage is established by deterministic fixtures.

## Verification and remaining release acceptance

See TESTING.md for actual results. The local OAuth fixture completes browser callback/PKCE, refresh and template discovery using Pi's real implementation. Real WSL tests execute installed package scripts under isolation. Research tests use real local HTTP responses; UI, FTS, prerequisite and comparison tests are deterministic.

Live third-party OAuth, fresh-user usability, other OSes, rendered browser automation, arbitrary host-plugin isolation and real matched hosted-quality studies remain unverified or outside this bounded release. Source tests do not establish those claims.

## References

- Pi SDK's installed @earendil-works/pi-mcp 1.1.0 README and exported OAuth/client declarations.
- https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- https://docs.searxng.org/dev/search_api.html
- https://langfuse.com/academy/evaluate/choosing-what-to-evaluate — evaluation guidance only; no Langfuse service/telemetry dependency.
