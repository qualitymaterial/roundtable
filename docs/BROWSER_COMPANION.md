# Read-only browser companion prototype

Date: 2026-11-02. Source implementation; opt-in and experimental. The normal installed release remains the previously verified `20261101-233657-fdae7475`. No extension was enabled in the owner's normal browser profile. Actual extension capture and real local-model inference remain unverified.

The companion is original Roundtable code. It has no WebBrain dependency, extra model loop, cloud account, remote script, or new npm dependency. It reads a tab only when the human presses **Share selected page**. It does not click, type, navigate, read cookies, capture screenshots, or scrape every tab.

## Data path and scope

The popup talks to its own service worker. Chrome/Chromium `activeTab` plus `scripting` permits a fixed, isolated-world text reader on the selected main document. Standard input/textarea/select/editable fields, hidden text and scripts are excluded. The reader is bounded to 16,000 characters, 10,000 text nodes and a bounded ancestor walk. A second browser-document check rejects navigation during capture. Frames, shadow roots, pseudo-content, PDFs and image-only pages are not supported in this milestone.

The service worker opens native messaging to `com.roundtable.companion`. The Node host forwards bounded length-prefixed JSON to one local IPC broker for the active Roundtable home. Windows uses a named pipe, not a TCP listener. Private routing files have a current-user/SYSTEM ACL on Windows and owner-only permissions on Unix. A mutual HMAC challenge binds the connection to a session; fresh nonces reject proof replay. The broker permits one authenticated browser connection, rate-limits captures, and does not replace an existing owner. A disconnect clears the current selection. Route files are replaced atomically rather than following destination links.

Snapshots are immutable untrusted records with session/source IDs, browser document/tab IDs, server capture time, URL, title, bounded text and SHA-256. URL query strings and fragments are omitted, and normal runtime redaction applies. `browser.read` and `browser.sources` expose retained snapshots only within their session. Reads reject tampering, another session's source, and excessive age. Retained snapshots are explicitly `snapshotOnly:true`; they do not claim to represent the live page or establish publisher truth. The default maximum age is five minutes, and a new capture always requires another human action.

## Local-only execution boundary

`node dist/cli.js browser [objective]` creates a dedicated session and starts the broker in the existing terminal UI. It does not automatically load the saved cloud lineup. `/browser status`, `/browser sources`, and `/browser read [source-id]` let the human inspect the connection and capture without a model.

At creation, the session pins models from explicitly configured literal-loopback OpenAI-compatible endpoints (`127.0.0.1` or `[::1]`). An empty pin list supports human capture/inspection only. Configure an endpoint and create a new browser session before adding a model if none was configured. Connecting an agent requires `browser.read` permission as well as a matching model pin. A localhost alias, remote endpoint, changed endpoint or different provider is refused before admission/inference. The policy has a separate persisted integrity seal and survives paused reopening.

Browser sessions expose an explicit allowlist of local coordination, text artifact/memory, JSON validation and browser read tools. Merely having `collaborate` permission is insufficient to expose project checks, sandbox execution, MCP or host tools. Both tool discovery and invocation enforce the allowlist, and session capability edits cannot widen it. Loading arbitrary host modules is disabled. All peers remain subject to the same local model pins, so ordinary peer messages and derived artifacts cannot automatically reach a cloud-backed participant.

Production Pi admission, normal requests and summary streams use the guarded stream path. Its direct HTTP transport pins the endpoint, avoids environment proxy routing and rejects redirects or alternate destinations. Real adapter fixtures check that a request containing browser context cannot follow a 307 redirect to another listener. The endpoint process is still trusted: Roundtable cannot determine whether a deliberately configured local gateway forwards requests elsewhere. These controls cover application-controlled inference and tools, not an OS administrator, deliberate manual file disclosure, or arbitrary code running as the same user.

Portable export/fork is disabled for browser sessions in this prototype. Encrypted full-runtime recovery retains the local-only policy and evidence but excludes temporary bridge routes, keys and process locks. This avoids silently transplanting credentials or weakening locality during a restore. Broader portable private-evidence support is future work.

## Windows setup and optional real-browser test

Build the checkout with the existing dependencies, then run `node dist/cli.js browser`. Register the native host with `scripts/install-browser-native-host.ps1 -Browser Chrome` (or Edge), explicitly selecting the same Roundtable home if necessary. Load `companion/` as an unpacked extension through the browser's developer interface. Its stable development ID is `egkfedophfeojpgaoifcemhapmfohnhk`; the manifest contains only a public identity key, not a signing private key. Registration permits only that exact extension origin. No developer-mode change or extension installation was performed in the owner's regular profile during implementation.

For controlled development acceptance, `scripts/start-browser-smoke.ps1` uses an already installed Chromium/Chrome for Testing binary, a new profile, a cookie-protected loopback fixture, temporary native-host registration and an isolated model-free Roundtable session. It downloads nothing and restores the prior Chromium registration. In that test window, use Extensions -> Roundtable Companion -> Connect -> Share selected page. `scripts/browser-companion-smoke.mjs` independently checks visible fixture text, excluded hidden/form markers, provenance and zero model calls. Reports are retained per attempt. A timeout or blocked launcher is not a passed browser test.

The shell browser launch was rejected by automatic approval review even after explicit owner approval. The alternative app launcher opened a normal blank Chrome window; it was closed without loading the companion. A user-assisted launcher was prepared, but no isolated capture has been observed. No further owner action is required for normal Roundtable use. Live extension UI/native registration compatibility and real local inference remain the next acceptance work.

## Verification and references

Automated coverage includes real local IPC/native framing, wrong session/integrity/freshness checks, nonce replay, ownership, capture refusal while paused, disconnect behavior, sealed policy recovery, cloud admission/model-change refusal, external-tool denial, local HTTP and production Pi protocol fixtures, a redirect containing retained browser context, and a no-model browser CLI. These protocol fixtures are scripted servers, not real local-model inference.

Implementation uses documented [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [selected-tab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), and [script injection](https://developer.chrome.com/docs/extensions/reference/api/scripting). Canonical implementation status is in `STATUS.md`; captured checks are in `docs/TESTING.md` and `artifacts/verification/browser-companion-2026-11-02/`.
