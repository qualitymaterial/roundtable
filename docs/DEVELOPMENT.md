# Development

Requirements: Node >=24, npm, and optionally Git. The first verified platform is native Windows PowerShell. Linux/macOS portability is designed through Node APIs and fixed process argument arrays but has not been run on those hosts. Docker and provider access are optional for deterministic development.

```powershell
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm test
npm run build
node dist/cli.js doctor
node dist/cli.js demo
```

`npm run check` type-checks, lints, builds and tests. `npm test` builds the CLI before running source tests so subprocess smoke tests cannot use stale output. `test:unit` tests core invariants; `test:integration` includes SDK/session/CLI and network fixtures. Tests use temporary private directories and deterministic models; they do not need model credentials.

During this Codex Windows run, tsx's initial `os.userInfo()` failed inside the restricted execution sandbox before tests loaded. Running the same tests with approved host execution resolved that environment problem. This is not a test assertion failure or an ordinary Node installation requirement.

Direct dependency versions are exact; package-lock.json pins the installed transitive tree. Lifecycle scripts are not needed for this application. Do not auto-run Pi default extensions or add environment-aware key execution. Validate actual installed SDK exports before upgrades. Run the full suite and `npm run notices` after dependency updates.

To develop a tool, implement an explicit ToolProvider, supply real TypeBox input schema, permission and ownership, and test both authorization and denial. Trusted modules may be loaded manually with `/load-tool`. Network integrations need fixed configured service destinations and bounded responses. Use containers for agent-supplied code. Never use host-shell escaping as a sandbox.

Package metadata remains private to prevent accidental npm publication. `npm pack` creates a local installable archive; `npm link --ignore-scripts` adds a development command tied to the checkout. On Windows, `install.cmd` from a built source checkout creates an independent per-user installation. Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-windows-install.ps1` for the separate installation regression test (network access required). No operation publishes. A release maintainer must establish repository URLs, reporting contact, cross-platform CI and live provider validation before public release.
