---
date: 2026-11-01
status: research-only
---

# WebBrain and interactive browser access

Update 2026-11-02: the independent read-only companion is now implemented in source. See [BROWSER_COMPANION.md](BROWSER_COMPANION.md) for its boundaries and checks. The assessment below is the original research record; live extension capture and real local inference remain unverified.

Recommendation: add browser access as an optional Roundtable capability behind a replaceable adapter. Use WebBrain for a small, read-only feasibility trial before deciding whether to build a native extension. No integration, dependency, installation, or live browser test was performed in this assessment.

## Evidence examined

Reviewed upstream WebBrain main on 2026-11-01, whose reported head was `351ca8cab82f8bfafe9e11ae321a4652fccbed23` (2026-10-31). Sources: [README](https://github.com/webbrain-one/webbrain/blob/351ca8cab82f8bfafe9e11ae321a4652fccbed23/README.md), [MCP documentation](https://github.com/webbrain-one/webbrain/blob/351ca8cab82f8bfafe9e11ae321a4652fccbed23/mcp-server/README.md), [MCP implementation](https://github.com/webbrain-one/webbrain/blob/351ca8cab82f8bfafe9e11ae321a4652fccbed23/mcp-server/src/index.ts), [architecture](https://github.com/webbrain-one/webbrain/blob/351ca8cab82f8bfafe9e11ae321a4652fccbed23/docs/architecture.md), [privacy](https://github.com/webbrain-one/webbrain/blob/351ca8cab82f8bfafe9e11ae321a4652fccbed23/docs/privacy-and-data-flow.md), and [injection defenses](https://github.com/webbrain-one/webbrain/blob/351ca8cab82f8bfafe9e11ae321a4652fccbed23/docs/prompt-injection-defense.md).

Local evidence: `src/network-tools.ts`, `src/connections.ts`, `src/web-tools.ts`, `docs/WEB_INTELLIGENCE.md`, `docs/WEB_ORCHESTRATION.md`, and canonical `STATUS.md`. Older web-gap descriptions in WEB_INTELLIGENCE are partly superseded by WEB_ORCHESTRATION; use current source for delivered behavior.

## What it adds

Roundtable already has explicit HTTP/stdio MCP connections, exact tool allowlists, schema validation, per-agent capability checks, and isolated MCP leases. Its current `web.read` deliberately reads public HTTP without scripts or credentials. WebBrain can operate inside an existing signed-in browser session, reaching authenticated dashboards and JavaScript applications and, in action mode, interacting with forms and controls.

The MCP interface exposes six task-level tools: run, extract, status, respond, abort, and connection. It delegates to WebBrain's own agent and configured provider; it does not expose direct click/type/snapshot primitives. Structured extraction always uses Ask mode. Run accepts Ask or Act, and `wait:false` returns a run identifier for later status calls. Extraction remains model-mediated; valid JSON is not proof that values match the page.

This fits Roundtable as an external browser worker. Roundtable can plan, coordinate, and independently check results while the browser worker performs a bounded task. It also introduces another model loop, configuration, latency, and usage that need separate accounting. A localhost bridge does not make inference local: WebBrain sends page context to its configured provider. Its privacy document distinguishes local, bring-your-own cloud, managed Compass, decision-provider, and optional sharing paths.

## Integration issues found in source

1. Roundtable pools stdio connections by participant, so two participants can launch two WebBrain server processes that compete for the default port 17374. The extension has one bridge socket. Use one deliberately managed broker/connection with per-caller authorization and task ownership; preserve independent model conversations.
2. Roundtable MCP calls time out after 15 seconds, with a 20-second pool watchdog and 60-second idle lease expiry. WebBrain runs can last minutes. Use asynchronous start/status calls and track ownership and lifecycle. A start reply still needs to fit the caller deadline; browser-run cancellation needs explicit handling. A WebBrain timeout does not abort the browser run, and abort cannot undo actions. A managed broker should outlive an individual agent's idle lease.
3. Generic MCP allowlisting checks tool names, not whether `webbrain_run` uses Ask or Act. A first read-only trial should allow connection/extract/status/abort and omit run/respond, or use a runtime wrapper that enforces allowed modes and human-only approval responses. Prompt instructions alone do not establish read-only access. Use browser UI for any clarification during the first trial.
4. Multiple agents must not drive the same tab concurrently. Add task-scoped browser/tab ownership, queued writes, run ownership, and precise result routing. A temporarily designated browser operator is a pilot constraint, not a mandatory production identity.
5. Browser-derived data must remain untrusted evidence in Roundtable. Preserve source URL, retrieval time, relevant page excerpts or screenshots, and operation receipts. Feed suitable structured evidence into existing verification contracts; WebBrain summaries and completion claims are not independent proof. Confirm exactly which evidence the adapter can retrieve before promising this integration.

## Build versus adopt

An optional WebBrain adapter offers the fastest way to test authenticated page extraction and delegated browser work. It retains WebBrain's own model loop and browser permission interface. Do not bypass its permission gate by directly exposing internal primitives; its MCP documentation explicitly explains why the gate belongs to the agent execution loop.

A native Roundtable extension would give Roundtable control over the model loop, browser tools, permissions, budgets, task ownership, and evidence. Keep the initial scope narrow: selected-tab access, bounded accessible/DOM snapshots with ephemeral references, navigation, clicks, typing, screenshots, and post-action checks. Strong execution boundaries, frame/shadow-DOM support, reliable lifecycle handling, origin checks, prompt-injection resistance, and browser compatibility are the substantial engineering work. Building the transport alone does not establish reliability.

Licenses differ: the [browser project notice](https://github.com/webbrain-one/webbrain/blob/351ca8cab82f8bfafe9e11ae321a4652fccbed23/LICENSE) specifies GPL-3.0-or-later for version 33 onward; the [separate MCP package](https://github.com/webbrain-one/webbrain/blob/351ca8cab82f8bfafe9e11ae321a4652fccbed23/mcp-server/LICENSE) has an MIT license. Treat copying/bundling the extension as a distinct decision from talking to an independently installed service. Any distribution decision needs its own license review; this assessment does not establish legal compatibility.

## Proposed trial and acceptance

Use Chromium first, an explicitly selected provider, and a version-pinned optional adapter. Begin with a single authorized caller and one managed connection. Preserve the existing public-web path for ordinary research. Read a signed-in dashboard into an explicit schema, extract information from a JavaScript-rendered page, and hand evidence back to a peer for checking. Compare the extracted values against human-inspected page evidence. Record task success, corrections, elapsed time, both model loops' usage, and evidence completeness. Exercise disconnect, timeout, stale tab, permission denial, and attempted page-instruction escalation.

Only after read-only acceptance, try a reversible form draft on a disposable page, with explicit Act authorization, visible user control, and final-state verification. Measure stop/abort behavior and ensure a timeout never triggers an automatic duplicate mutation.

Next action, if selected by the owner: prepare the small optional adapter trial with acceptance fixtures. Acceptance means one managed bridge, enforced read-only operations, correct source-backed extraction, preserved per-agent authorization, and explicit unverified/error states on disconnection or missing evidence. Real browser behavior, upstream test results, task reliability, model cost, and native implementation effort remain unmeasured.

## Follow-up: an independently implemented Roundtable companion

On 2026-11-01 the owner asked what building our own would take to avoid external services, resource dependencies and conflicts. This establishes interest in the native option; no implementation has been requested or performed. The earlier WebBrain pilot remains an alternative rather than a prerequisite for this path.

Proposed topology: independent Roundtable agents -> existing tool registry and guards -> shared browser broker -> local IPC bridge -> our Chromium extension -> explicitly selected tabs. Keep the model loop in Roundtable. The extension executes bounded commands and returns observations; it does not select a provider, send inference requests, load remote agent code, or run a separate agent loop.

Use a persistent native messaging connection between the extension and a small host installed with Roundtable. Chrome launches native hosts over stdin/stdout, restricts allowed extension identities through the host manifest, and requires per-platform host registration. On Windows, connect the host to the appropriate Roundtable broker using a user-restricted named pipe and a session handshake. This avoids a fixed TCP port. Profile/session routing, reconnects, duplicate host connections, and authorization still need explicit design and tests; native messaging does not create a shared singleton broker automatically. See [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

Implement original source and assets against documented browser APIs. Keep a dependency/license inventory for anything deliberately reused. The [U.S. Copyright Office](https://www.copyright.gov/help/faq/faq-protect.html) distinguishes software expression from ideas, systems and methods. This is a plan for an independent implementation, not a conclusion that copied or translated WebBrain code loses its existing license obligations.

For page operations, start with bounded DOM/accessibility observations and stable snapshot-scoped target references. Chrome's [debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger) can expose selected DevTools protocol domains including DOM, accessibility and input, with explicit debugger permission. Handle detach, navigation and stale references; do not promise universal page support. A native host installer, extension packaging and browser permissions are unavoidable parts of a local companion, even without an external automation service.

Local-only browser tasks need an enforced data-flow rule: only approved local model endpoints may receive page-derived text, screenshots and their derivatives. Block disclosure through artifacts, persistence recovery, summaries, logs and peer messages to cloud-backed agents; fail closed if the local endpoint is unavailable. A local browser operator alone is insufficient in a mixed local/cloud team. The target website still receives ordinary browsing requests and form submissions. Cloud processing can be a separately explicit opt-in later.

Suggested milestones:

1. Read-only vertical slice: one browser/profile and selected tab, local bridge, bounded snapshot, source URL/time, local-model interpretation, explicit disconnect/stale-tab states. Verify extraction against a controlled page and a human-inspected authenticated page.
2. Interaction: navigation, click, typing, screenshot and post-action checks. Add execution-layer read/action scopes, origin checks, stale-target rejection, task-scoped tab ownership, bounded waits, stop/cancel and operation receipts. Verify simultaneous-agent exclusion, navigation races, denial and ambiguous outcomes without automatic mutation replay.
3. Hardening: reconnect/restart and profile/session isolation, broader frames/shadow DOM, image-heavy pages, hostile page instructions, local-only egress/peer-routing tests, packaging and installation. Browser-native limits and site-specific behavior remain compatibility work we own.

This can avoid WebBrain's runtime dependency, separate model loop and fixed-port coupling. It cannot eliminate dependence on browser APIs or guarantee that no browser/site conflict will occur. No timeline is measured; estimate implementation effort after the first vertical slice and its acceptance results.
