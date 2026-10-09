# Roundtable

**Independent agents. Shared objectives. Universal capabilities. Real collaboration.**

Roundtable is an MIT-licensed, local-first terminal application embedding the official Pi SDK. Independent agent sessions can use different providers, communicate asynchronously, negotiate shared tasks, use authorized tools, publish artifacts, and resume committed collaboration state. Agents have configurable instructions and permissions; there are no built-in roles or mandatory coordinator.

This is an initial v0.1 implementation. Automated tests use **deterministic model fixtures with three actual Pi sessions**. Hosted acceptance also passed with GLM-4.7, Claude Haiku 4.5 and Gemini 2.5 Flash across Z.ai and OpenRouter, using human-staged collaboration and one independent-validator correction. Subscription login, Docker isolation and Linux/macOS execution remain unverified. See [STATUS.md](STATUS.md) and [live evidence](docs/TESTING.md#hosted-acceptance).

## Quickstart

Install Node.js **24 or newer** and Git, then get the source:

```powershell
git clone https://github.com/qualitymaterial/roundtable.git
cd roundtable
```

Install dependencies and run the credential-free demonstration:

```powershell
npm ci --ignore-scripts
npm run build
node dist/cli.js init
node dist/cli.js doctor
node dist/cli.js demo
```

The demo prints messages, originating providers/models, tool executions, results and the validated artifact hash. It uses no credentials. Copy the printed session ID to inspect or resume it:

```powershell
node dist/cli.js session list
node dist/cli.js session resume <session-id>
node dist/cli.js validate <session-id>
node dist/cli.js session export <session-id> conversation.json
```

On Windows, run `.\install.cmd` from the built checkout. It installs an independent copy under `%LOCALAPPDATA%\Programs\Roundtable`, installs locked runtime dependencies, checks startup, and registers `roundtable` in your user PATH and PowerShell profiles. Open a new PowerShell and type `roundtable` from any folder. Use `.\install.cmd -Launch` to start immediately after installation. Node.js 24+ and network access for npm dependencies are required; administrator access is not. Existing data and credentials are preserved. See [installation details](docs/TERMINAL.md).

For development (or other platforms), `npm link --ignore-scripts` creates a command tied to this checkout. `npm start` also opens the interface. Exit with `/exit`; committed data stays in the stable runtime directory, independent of your current folder.

The default runtime directory is `~/.roundtable`, overridable with `ROUNDTABLE_HOME`. An optional `~/.roundtable/config.json` selects `{ "dataDir": "absolute existing runtime directory", "projectAccess": true }`. With `projectAccess:true`, new sessions grant file writes in the folder where you launch `roundtable`; startup prints the effective roots. A fresh clone includes no credentials or machine-access grants. Configure access explicitly using the commands below. No credentials are copied to each project folder.

Startup loads model definitions from `agents.json` in the configured runtime directory, falling back to `live-agents.json` there. It shows each connection and checks tool compatibility using two provider requests per agent. Enter the objective, then type a message at `roundtable>` to talk to the connected agents. Provider charges or quotas may apply. To choose a different file, run `npm start -- --agents examples/live-api-agents.json`. Credentials remain in Roundtable's own auth store or supported environment variables.

Without a saved configuration, startup explicitly reports that no agents are connected. Add agents using `/add-agent`, then `/save-agents` to remember their configuration for future sessions. Messages with no active recipients are rejected. Resuming an existing session uses its stored membership instead of importing the startup file.

Agents can browse folders, recursively search and read local text, create/edit files, and request commands for Git, builds and tests. Use `/host` to inspect access, `/host-read "D:\Projects"` or `/host-write "D:\Projects\example"` to add roots, `/host-shell on` to enable command requests, and `/save-access` to keep that policy. Each host command displays its exact text and cwd for `/approve <id>` or `/reject <id>`. Host commands run with your OS user privileges, without a sandbox. `/host-off` disables host access. See [tool details](docs/TOOLS.md#local-machine-tools).

The terminal includes participant cards, colored model identities, readable message/tool events, machine-access and budget panels, exact command approval cards, and slash-command Tab completion. Background updates preserve the input line. See [terminal usage](docs/TERMINAL.md); `NO_COLOR` disables colors and `ROUNDTABLE_ASCII=1` uses ASCII borders.

## Connect your models

```powershell
node dist/cli.js providers
node dist/cli.js models openai-codex
node dist/cli.js models zai
node dist/cli.js models openrouter
node dist/cli.js login openai-codex oauth
# API-key alternative, only in your own terminal:
$env:ZAI_API_KEY = "your-key"
$env:OPENROUTER_API_KEY = "your-key"
node dist/cli.js session new "Compare approaches to a persistent memory system"
```

Use exact model IDs shown by `/models`. Inside the session:

```text
/add-agent {"name":"Ada","provider":"zai","model":"glm-4.7","instructions":"Choose your own approach and share evidence"}
/agents
/tools
Investigate the objective, negotiate useful tasks, and exchange findings using roundtable_send.
/tasks
/artifacts
/status
/pause
/approvals
/approve <request-id>
/resume
/export conversation.json
/exit
```

`glm-4.7` was found in the installed Pi 1.1.0 registry on 2026-10-08; registry inclusion does not promise account access. Adding a live agent makes two provider requests to validate tool calls and tool-result handling. A text-only endpoint is rejected explicitly. Each agent selects its own provider/model; there is no global model switch.

For a three-provider live run, edit [examples/live-agents.json](examples/live-agents.json) to match your access and run:

```powershell
node dist/cli.js demo --live examples/live-agents.json --check
node dist/cli.js demo --live examples/live-agents.json
node dist/cli.js session verify <printed-session-id>
```

`--check` checks the complete model/auth configuration without inference or creating a session. Admission still makes real tool-protocol requests. `session verify` runs offline in a new process: it checks three distinct persisted Pi contexts, acknowledged peer request/reply, independent contributions, successful tools, a jointly updated completed task, and an exchanged artifact with a valid hash/schema. `matchesLastAcceptance: true` means the committed collaboration snapshot and Pi contexts match the prior acceptance record. Continued work changes that snapshot; verification does not certify inference origin or research quality.

Provider calls may incur charges or consume subscriptions. A ChatGPT subscription does not grant OpenAI API credits. Roundtable uses supported Pi auth flows and its own `.roundtable/auth.json`; it never scans other applications' credential stores at startup. Explicit operator-authorized API-key migration for this checkout is documented in [provider setup](docs/PROVIDERS.md), alongside LM Studio, Ollama, RunPod and compatible endpoints.

With Z.ai and OpenRouter configured, this bounded example stages three independently configured models and one validation-feedback retry:

```powershell
node examples/live-staged.mjs examples/live-api-agents.json
node dist/cli.js session verify <printed-session-id>
```

It produces a design artifact, not an executed prototype. Participants retain the same tool capabilities; stages specify temporary responsibilities. The initial open-ended live run reached its token budget before acceptance, so autonomous convergence is not claimed.

## Capabilities and boundaries

- Separate Pi contexts and durable session directories for every agent.
- Ordered, validated, durable messages with duplicate protection, acknowledgement, bounded queues and restart recovery.
- Shared tasks with atomic claims, dependencies and owner-controlled completion; session notes, decisions and SHA-256 artifacts.
- All 15 required collaboration tools, workspace tools, scoped host browse/read/search/edit and approved host commands for Git, tests and builds.
- Permission-checked configured research service and remote MCP tools through Pi's MCP client.
- Optional constrained Docker execution; no default host shell and no automatic extension discovery.
- Human pause/resume, agent replacement, permissions, approvals, retry, audit history and exports.
- Exchange, tool-call, global/provider request, concurrency, timeout, token and estimated spending budgets.

Direct messages specify routing, **not privacy**: participants can read the shared session transcript. Workspace file scoping is not OS sandboxing. Trusted tool modules run with host privileges; remote MCP services have their own privileges. See [security boundaries](docs/SECURITY.md) before granting additional access.

No Roundtable account, cloud backend, telemetry adapter, subscription, bundled key or payment system is required. Users bring provider access or a compatible local server. Node dependencies retain their own licenses and notices.

## Development and documentation

```powershell
npm run check
npm run test:unit
npm run test:integration
npm run notices
```

See [architecture](docs/ARCHITECTURE.md), [protocol](docs/PROTOCOL.md), [agents](docs/AGENTS.md), [tools](docs/TOOLS.md), [storage](docs/STORAGE.md), [development](docs/DEVELOPMENT.md), [test evidence](docs/TESTING.md), [roadmap](docs/ROADMAP.md), [contributor guidance](CONTRIBUTING.md), and [third-party notices](THIRD_PARTY_NOTICES.md).
