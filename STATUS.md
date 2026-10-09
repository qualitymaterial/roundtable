# Roundtable current state

Updated: 2026-10-09. Canonical owner: this repository. Evidence: docs/TESTING.md and ignored artifacts/verification/. Every product recommendation is tracked in docs/PRODUCT_REVIEW.md, with implemented versus remaining work.

## Current milestone

0.2.0-dev.1 product-review integration. Native Windows, Node 24.19.0, Pi packages pinned to 1.1.0. Source repository: https://github.com/qualitymaterial/roundtable. This milestone is approved for GitHub publication; npm publication remains disabled. No additional dependencies or mandatory services were added.

## Operational functionality

Independent Pi contexts/providers, asynchronous messaging, shared tasks/artifacts/notes, SQLite persistence, real tools and human approvals remain. New sessions have no cumulative token cap; saved ceilings stay explicit. Request/tool/exchange/time/estimated-cost limits still apply and pause once with recovery controls.

Guided setup selects providers/models, supported authentication, participant instructions and folder-access presets. Native manual/automatic per-agent compaction and bounded transient retries use guarded, metered requests. Original Pi history stays durable. Context and usage reports distinguish available cache/input/output counts from SDK cost estimates.

Host/PID claims reject a second live session owner before recovery. Guarded host edits acquire file claims, store private checkpoints and support previews and hash-protected undo. Approved background jobs have bounded logs, timeouts, inspect/cancel and interrupted recovery. Completion summaries expose open work and validation records; human acceptance is explicit. Multiline drafts, name-based direct messages, human-curated project memory with expiry/delete, four non-executable workflow recipes and headless NDJSON are available.

Windows installation copies an independent release, validates it and maintains a stable launcher. Version reporting and validated local release switching are implemented. Existing credentials, runtime configuration and sessions are preserved. Close old harnesses before resuming their sessions under the upgraded version: older processes do not honor ownership claims.

Installed final build: releases/20261009-102525-d4b265c1. A fresh profile-enabled Windows PowerShell launched from the user's home returned 0.2.0-dev.1 for roundtable --version; the installed workflow list also passed. This verifies this execution host, not a new report from the user's separate terminal.

## Verified results

Typecheck, lint, production build and 52 tests pass in product-integration-check.txt. Tests cover manual/automatic compaction, summary failure/history retention, restart, independent contexts, transient retry/request ceilings, ownership, checkpoint conflicts, background approvals/cancellation, scoped memory, recipes and real Pi HTTP transport with deterministic responses. Headless JSON and multiline CLI checks use local scripted providers.

product-install-smoke.txt passes isolated Windows installation, private-data exclusion, launch without Node/npm on PATH, version, valid release activation, broken-release rejection without launcher change, deterministic three-Pi demo, restart and cwd preservation. CI is defined for Windows/Linux/macOS but has not run remotely. Earlier hosted staged collaboration passed on Z.ai/OpenRouter after validator repair; no new hosted inference was performed for this integration.

## Limits and next executable task

The full review is not finished. Hosted compaction fidelity, fresh-user onboarding, autonomous convergence, Codex OAuth and Linux/macOS remain unverified. Binary/document artifacts, browser integration, richer terminal navigation, enforced stages, broader MCP/editor/desktop surfaces and matched solo/team evaluation remain incomplete.

Host shell is unsandboxed; filesystem guards and process cleanup are not hardened isolation. Checkpoints cover host_write only. Claims coordinate upgraded processes sharing a database, not external editors or other databases. Recovery never reruns jobs but cannot guarantee orphan cleanup. Data are private plaintext; the existing operator configuration still points inside the checkout, so preserve that runtime folder.

Next: a bounded hosted long-task evaluation crossing compaction, checking retained constraints/evidence, creating a validated artifact and resuming in a fresh process. Then implement authorized binary attachments and richer project/session navigation against that acceptance suite.
