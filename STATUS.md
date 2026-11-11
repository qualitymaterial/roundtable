# Roundtable current state

Updated 2026-11-11 (America/New_York). This repository owns implementation state. See [collaboration](docs/COLLABORATION.md), [protocol](docs/PROTOCOL.md) and [verification results](docs/TESTING.md#localcloud-receipt-collaboration--2026-11-11).

## Goal and setup

Independently configured local and hosted agents share task references and artifacts, run permitted tools and verify deliverables in separate Pi contexts. The milestone branch `codex/collaboration-milestone` starts from `106e067` on `main`. It uses Roundtable 0.2.0-dev.16, the existing Node/TypeScript and Pi architecture, and the existing dependencies. The normal Windows installation was outside this source acceptance. The last recorded verified installed release is `20261101-233657-fdae7475`.

## Verified results

The recent-message guard distinguishes a new task or artifact version while continuing to suppress an otherwise identical message. Session evaluation counts delivery failures and SDK retries when reporting first-pass status.

Windows Node 24.19.0 baseline had 274 passing tests and three optional sandbox skips. Final `npm.cmd run check` passed typecheck, lint and build, with 275 passing tests, zero failures and three optional skips. The new loopback regression used real Pi OpenAI-compatible and Anthropic Messages transports. Solo and team completed with the same receipt hash. A corrected receipt passed re-review with the same request wording, and an injected HTTP 401 recovered after reconnect and explicit retry. Both recovery trials completed with first-pass status false. Direct tool execution denied the reviewer's workspace write even with a stale permission record supplied by the caller.

The bounded live comparison passed using Qwen3.8 27B through LM Studio and hosted OpenRouter Kimi K3. The solo run used a human-role deterministic check. The team completed the correlated peer handoff and verified the same artifact bytes. Solo used eight requests and 60,146 reported tokens. Team used 16 requests, 108,500 reported tokens and an estimated $0.02171895. Evidence is in `artifacts/verification/collaboration-milestone/`. This is one synthetic task.

## Known gaps and next action

The first live attempt stopped on a local turn deadline and GLM-5.3 rejected admission because the probe disabled thinking. The second attempt allowed a longer turn and used Kimi. GLM-5.3 compatibility remains unresolved. The selected-tab browser companion still needs actual capture through its native host. Browser-private inference, live search, live sandbox and broader platform/provider acceptance remain open. Historical coding and web results remain in [TESTING.md](docs/TESTING.md).

Next acceptance check for GLM-5.3 is a fresh nonce and receipt probe with a supported thinking level, followed by one correlated receipt handoff under the same task contract.
