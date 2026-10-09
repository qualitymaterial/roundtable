# Roundtable

**Independent agents. Shared objectives. Universal capabilities. Real collaboration.**

Roundtable is an MIT-licensed, local-first terminal application embedding the official Pi SDK. Independent agent sessions can use different providers, communicate asynchronously, negotiate shared tasks, use authorized tools, publish artifacts, and resume committed collaboration state. Agents have configurable instructions and permissions; there are no built-in roles or mandatory coordinator.

The terminal defaults to a compact view: grouped activity panels, completed responses, and no raw tool payloads. `/activity` opens tool details, `/messages` shows full conversation history, and `/view verbose` restores the live trace. Display changes do not stop model calls or change permissions.

Inside the harness, `/` searches commands, `/sessions` finds saved work, `/favorites` saves model choices, and `/endpoints` configures a local server without editing JSON. `roundtable session resume` opens the session picker directly; saved work opens paused until `/resume`. `/diagnostics` shows connection configuration and offers an explicit metered tool-protocol test. See the [settings and navigation guide](docs/SETTINGS.md).

This checkout is **0.2.0-dev.7**, integrating the usability review and in-harness settings. Automated tests use **deterministic model fixtures with actual independent Pi sessions**. Earlier hosted acceptance passed with GLM-4.7, Claude Haiku 4.5 and Gemini 2.5 Flash across Z.ai and OpenRouter, using human-staged collaboration and one independent-validator correction. New compaction/recovery features have not been tested with hosted inference. Subscription login, Docker isolation and Linux/macOS execution remain unverified. See [STATUS.md](STATUS.md) and [test evidence](docs/TESTING.md).

Use `/project` to review project instructions and save a folder-specific lineup/limits. `/editor` opens a recoverable draft; `@path` or `@"path with spaces"` attaches project files, with Tab completion. `/backup`, `/fork`, and `/import` preserve independent Pi histories in private portable bundles. See [session recovery and composition](docs/SESSION_RECOVERY.md). These source changes are not automatically installed into an already-running harness.

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

Startup uses a human-saved lineup for the exact project folder first, then loads model definitions from `agents.json` in the configured runtime directory, falling back to `live-agents.json` there. It shows each connection and checks tool compatibility using two provider requests per agent. Enter the objective, then type a message at `roundtable>` to talk to the connected agents. Provider charges or quotas may apply. To choose a different file, run `npm start -- --agents examples/live-api-agents.json`. Credentials remain in Roundtable's own auth store or supported environment variables.

Without saved agents, interactive startup opens guided setup. Run `roundtable setup` to select providers, use supported authentication, search registered models, name participants and choose folder access. Setup does not make model inference calls; subsequent admission checks tool compatibility. Existing membership can also be changed with `/add-agent` and `/save-agents`. Piped startup requires a saved or explicit configuration. Resuming uses the session's stored membership.

For everyday work, use `/paste` to compose several lines (`/end` sends, `/cancel-paste` discards), `/send "Agent name" <message>` to address a participant, `/summary` to inspect unfinished work, `/context` for context capacity and `/usage` for token components. Pi compacts each participant independently; `/compact <name>` requests a metered manual summary. Ctrl-C pauses work while keeping the harness open. `/changes`, `/diff <checkpoint-id>` and `/undo <checkpoint-id>` inspect and restore guarded host edits; commands and external changes are not automatically undoable.

Approved background commands are visible through `/jobs`, `/job <id>` and `/stop-job <id>`. Project memory is human-curated with `/remember <text>`, `/memory`, `/share-memory <id>` and `/forget <id>`; no automatic cross-session injection occurs. `roundtable workflows` lists research, writing, analysis and coding recipes; `roundtable workflow research` opens one using saved agents. `roundtable run "your objective" --agents config.json` emits headless NDJSON events with workspace-only access. See [terminal commands](docs/TERMINAL.md) for boundaries and exit codes.

Agents can browse folders, recursively search and read local text, create/edit files, and request commands for Git, builds and tests. Use `/host` to inspect access, `/host-read "D:\Projects"` or `/host-write "D:\Projects\example"` to add roots, `/host-shell on` to enable command requests, and `/save-access` to keep that policy. Each host command displays its exact text and cwd for `/approve <id>` or `/reject <id>`. Host commands run with your OS user privileges, without a sandbox. `/host-off` disables host access. See [tool details](docs/TOOLS.md#local-machine-tools).

The terminal includes participant cards, colored model identities, readable message/tool events, machine-access and budget panels, exact command approval cards, and slash-command Tab completion. Background updates preserve the input line. See [terminal usage](docs/TERMINAL.md); `NO_COLOR` disables colors and `ROUNDTABLE_ASCII=1` uses ASCII borders.

Use `/budget` to inspect session limits and `/budget tokens off` to disable a saved token ceiling. New sessions have no cumulative token cap by default. Other request, tool, exchange, timeout and estimated-spending limits remain visible and enforced. A limit change does not restart work; `/resume` continues after all exhausted limits are addressed. See [budget controls](docs/TERMINAL.md#budget-controls) and the [usability review and priorities](docs/PRODUCT_REVIEW.md).

## Connect your models

Start with `roundtable settings` or `/settings` inside the harness. Use `/login` for supported browser/API-key flows, `/model` to select a participant's model without losing its identity/history, `/skills` to review and install instruction snapshots, and `/mcp` to connect external HTTP services or trusted local programs. Current-session changes and saved defaults are shown separately. See the [settings and connections guide](docs/SETTINGS.md).

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


### Current development milestone

0.2.0-dev.5 adds recovery, guarded workspace patches, model tuning, scoped PNG/JPEG/CSV/text attachments, saved drafts/audiences, queued-message editing, readable progress views and human-gated collaboration stages. Try `/summary`, `/tuning`, `/audience`, `/attach`, `/queue`, `/changes`, and `/board`. `roundtable workflow independent-review` starts the staged recipe. See [settings](docs/SETTINGS.md) and the [complete implementation checklist](docs/IMPLEMENTATION_CHECKLIST.md) for exact behavior and remaining work. This is still an engineering alpha; the full product audit is not finished.

### Ink terminal (0.2.0-dev.8)

Run `roundtable` for the conversation-first Ink interface. Type `/settings` for searchable keyboard menus. Tool activity stays grouped, and finished messages remain in scrollback. `/steer` updates a running participant at its next tool boundary; `/pause` interrupts. PDF/Office attachments, binary artifact export and per-agent MCP connection reuse are included. No live account or permission behavior is bypassed by the UI. See [terminal controls](docs/TERMINAL.md) and [implemented versus remaining work](docs/IMPLEMENTATION_CHECKLIST.md).
