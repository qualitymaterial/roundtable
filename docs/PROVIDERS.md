# Providers and authentication

Roundtable embeds Pi's provider ecosystem; do not use old `@mariozechner` examples. The pinned SDK is 1.1.0. Provider/model catalog presence does not establish subscription availability, tool quality or quota.

```powershell
node dist/cli.js providers
node dist/cli.js models openai-codex
node dist/cli.js models zai
node dist/cli.js models openrouter
node dist/cli.js login openai-codex oauth
node dist/cli.js login zai api_key
```

Verified registry identifiers on 2026-10-08: `openai-codex` (OAuth), `zai` (global Coding Plan, ZAI_API_KEY), `zai-coding-cn` (China, ZAI_CODING_CN_API_KEY), and `openrouter` (OPENROUTER_API_KEY or supported OAuth). Models in examples/live-agents.json were found in the installed registry; use `models` to select an ID you can access. No subscription tokens are copied from Codex, ChatGPT, Pi's default home or other applications.

Roundtable stores supported interactive auth only in its own data directory. API keys can be supplied through Pi's provider environment variables. Secret prompts require an interactive TTY and suppress echo. Headless operation should use environment variables. `.env.example` is documentation; `.env` is not automatically loaded. The official provider flow controls whether browser/device login is available. Login was not exercised with a user's subscription during development.

A ChatGPT subscription is distinct from OpenAI API billing. Subscription access, endpoint availability and usage terms belong to each provider. Roundtable has no payment system, quota bypass or bundled key.

## This checkout's authorized setup

On 2026-10-08, the operator explicitly requested locating and wiring existing local keys. Z.ai and OpenRouter API keys were registered in this checkout's ignored `.roundtable/auth.json` through Pi's supported `api_key` login. Pi 1.1.0's OpenRouter OAuth adapter exchanges sign-in for a permanent API key, stored as non-expiring credentials with an empty refresh value; only that API key was migrated, not a subscription refresh-token session. Other applications' files were left unchanged. No credential discovery runs during normal Roundtable startup.

Both providers passed two live nonce/tool-result receipt requests. GLM-4.7, Claude Haiku 4.5 and Gemini 2.5 Flash were admitted in separate hosted Pi sessions. This machine's auth file has an explicit Windows ACL for its owner, SYSTEM and administrators, and is excluded from Git/package files. The ignored `.roundtable/live-agents.json` selects these models across two providers. `openai-codex` remains unconfigured and requires `node dist/cli.js login openai-codex oauth`; no Codex/ChatGPT subscription credentials were copied.

## Local and compatible endpoints

Run `roundtable endpoints` or `/endpoints` for guided configuration and optional server model discovery. For manual configuration, run `init` and use `endpoints.json` in the printed Roundtable data directory:

```json
[
  {
    "provider": "local",
    "baseUrl": "http://127.0.0.1:1234/v1",
    "model": "EXACT_MODEL_ID_RETURNED_BY_YOUR_SERVER",
    "apiKeyEnv": "LOCAL_API_KEY",
    "contextWindow": 32000,
    "maxTokens": 4096
  }
]
```

Set LOCAL_API_KEY to the server's key. An unauthenticated loopback server can omit apiKeyEnv; Roundtable supplies a nonsecret SDK placeholder in that case. Remote endpoints require an environment variable reference. Compatible config currently uses OpenAI chat-completions and text input. Use a distinct provider alias for each endpoint/model; built-in provider names cannot be replaced. No arbitrary command-backed key resolver is loaded. Embedded URL credentials, query strings, fragments and non-HTTP(S) schemes are rejected. Configuration is operator-trusted: an endpoint can receive prompts and its own configured key. Context/output limits are entered by the operator, not inferred from model names.

| Server | Common base URL / setup |
| --- | --- |
| LM Studio | `http://127.0.0.1:1234/v1`; enable a tool-capable model/server |
| Ollama | `http://127.0.0.1:11434/v1`; use the exact loaded model tag |
| RunPod | Your authenticated HTTPS OpenAI-compatible deployment URL |
| Custom API | Its verified chat-completions base URL and exact model ID |

These are conventional endpoint examples, not connection tests against installed services. Tool-protocol admission must pass before an agent is usable. Servers that ignore tool definitions fail explicitly.

## Diagnostics and budgets

`doctor` checks local runtime/storage configuration without inference. `/add-agent` checks the actual tool protocol, making two short calls. Each agent retains its provider/model. Requests and usage are audited by agent; session global/provider request limits are enforced before requests. Example `/limits {"providerRequests":{"openrouter":20},"requests":60,"tokens":100000,"dollars":2}`.

Token counts are provider-reported where supplied. Dollar values come from Pi's model metadata and are **estimates**, not invoices or subscription quota. Zero cost/usage may mean unavailable metering, especially local endpoints. Token/spend limits pause after a response is reported and can overshoot by concurrent in-flight responses. No fixed prices are embedded in Roundtable.

Before a live demo, run `node dist/cli.js demo --live examples/live-agents.json --check`. All three model IDs and configured authentication must pass local preflight before any session or provider request is created. This does not validate credentials with a server. Admission checks the nonce tool call and returned receipt. Every returned admission response records usage, including incompatible responses; token/spend exhaustion prevents the next probe.

Compatible endpoint `apiKeyEnv` names are converted to explicit Pi `$VARIABLE` references internally. A missing variable reports unconfigured authentication; the variable name is never sent as the credential. Tests verify the actual Authorization header through Pi's production HTTP transport. The three-provider fixture is scripted locally and does not establish compatibility with hosted subscriptions or particular inference servers.

## Context, retry and usage controls

Pi native independent-session compaction is enabled; both manual and automatic summary requests use Roundtable's provider guard and usage ledger. Two bounded transient agent retries are enabled with 1-second base delay and a 5-second maximum agent retry delay; hidden provider transport retries are disabled. Retries use the same provider/model and do not grant tools or replay completed tool calls. Compatibility probes, ordinary responses and compaction all consume session request/usage budgets.

`/usage` displays available input, output, cache-read and cache-write totals by participant with source labels. Older records lack component fields and are not reconstructed. SDK price estimates are not invoices; zero-price custom endpoints may have unknown operating cost. No automatic fallback sends conversation data to a different provider.

## Settings integration authentication

`/login` and `roundtable login` select providers and supported methods from the pinned registry. Pi exposes API-key metadata as `apiKey`, while its login call uses `api_key`; the registry now normalizes that distinction, fixing missing API-key choices in the earlier wizard. Both `openai-codex` and `anthropic` expose OAuth in Pi 1.1.0; successful subscription login/account eligibility remains unverified here. API-key and manual-code prompts share the terminal input owner, suppress echo and avoid command history. Automatic HTTPS browser opening can be toggled in settings. `/model` validates the candidate before changing the participant; IDs and existing Pi history persist. See [settings guide](SETTINGS.md).
