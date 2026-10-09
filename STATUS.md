# Roundtable current state

Updated: 2026-10-09. Canonical owner: this repository. Accepted scope: docs/IMPLEMENTATION_CHECKLIST.md; source audit: docs/PRODUCT_REVIEW.md. Evidence: docs/TESTING.md and ignored artifacts/verification/.

## Current milestone

Source is 0.2.0-dev.9: the Ink terminal now follows the user's visual reference with a compact LOCAL header, session details above conversation, muted bordered composer and one-line footer. Document inputs/binary artifacts, steering and MCP lifecycle remain available. Node 24.19; Pi 1.1.0; Ink 8.0.0 / React 19.3.0. The user authorized committing and pushing the accumulated improvements to qualitymaterial/roundtable on 2026-10-09. This is a source release; no npm package publication, telemetry or credential imports. This increment does not complete every accepted audit recommendation.

## Operational functionality

Interactive commands now use Ink/React with a neutral theme, stable composer/status, ordinary scrollback, grouped live tool activity, actual SDK stream previews, searchable arrow-key pickers, Unicode-aware editing/wrapping, history/completion and safe multiline paste. Secret answers are masked and excluded from public UI snapshots/history. Existing command handlers still own providers, authorization and storage; non-TTY/plain/NDJSON paths remain separate. Ctrl+C pauses; Escape cancels dialogs; Ctrl+D on empty input and /exit close cleanly. Session inspection restores recent messages without inference.

PDF, DOCX, PPTX and XLSX attachments retain exact originals and send bounded extracted text only to selected recipients. Parsing has worker/time/size limits; no OCR, formula or macro execution. Binary artifacts can be published from the authorized shared workspace, exported and restored through portable bundles. Workers are not OS sandboxes and binary secrets cannot be automatically redacted.

/steer targets running independent Pi sessions at a tool boundary. Undelivered instructions remain queued; crash-uncertain deliveries require human inspection before retry. MCP connections are pooled separately per participant with idle expiry, explicit reconnect, no automatic invocation replay and exact resource URI allowlists. Remote MCP OAuth and stronger plugin isolation remain open.

## Verification

Captured dev9-check.txt passed strict typecheck, ESLint, build and 117 tests with zero failures/skips. New coverage verifies the reference layout and ASCII borders; existing Unicode resize, approval, secrets and input tests still pass. A Windows PTY verified source launch, bordered-input cursor placement, rename, Ctrl+C pause and clean exit. Prior dev.8 checks cover the three-agent demo, restored history and editor handoff. The user reports successful OpenAI CLI login and improved interaction on dev.8; no additional live authentication or inference was performed here. Installed dev.9 release 20261009-151924-045c191e passed locked dependency installation. Fresh Windows PowerShell launched it from the user home; all five installed CLI/UI hashes match the tested build (dev9-install.txt and dev9-installed-hashes.json). Detailed evidence and repaired initial wording assertion are in docs/TESTING.md.

## Remaining work

Keep the complete checklist open: richer Markdown/diff views and inline validation, validator/recovery contracts, general workflow prerequisites, scoped project sandbox (Docker previously unavailable), grouped Git/worktree changes, full skill packages/plugin isolation, remote MCP OAuth, research/FTS, and matched collaboration evaluations. Fresh-user/multi-OS/live-account acceptance is not established by automated counts. Next executable task: user acceptance of the installed Ink interface, then recovery/validator contracts. Existing user sessions remain running until the user chooses to restart them.
