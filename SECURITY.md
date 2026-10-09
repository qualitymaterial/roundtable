# Security policy

This initial v0.1 release is not independently security audited. Read [docs/SECURITY.md](docs/SECURITY.md) for implemented controls and deployment requirements.

Do not put credentials or private user data in issues, artifacts, transcripts, screenshots or reproduction logs. The source repository is https://github.com/qualitymaterial/roundtable. A dedicated private vulnerability-reporting channel is not yet confirmed. If GitHub's Security tab offers "Report a vulnerability", use that private flow. Otherwise, request a private contact from the maintainer without disclosing exploit details in public. Establishing a reliable private reporting channel remains a release-readiness task.

For a useful report, describe the affected version, attack prerequisites, permission scope, minimal reproduction and expected boundary. Dependencies are pinned in package-lock.json; run `npm audit` when updating them. A clean audit is not proof of application security.
