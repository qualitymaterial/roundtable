# Contributing

Use Node.js 24+, `npm ci --ignore-scripts`, and `npm run check`. Keep TypeScript strict and dependencies pinned. Read STATUS.md before changing implementation; it is the canonical current-state record. Update it after verified milestones and link detailed evidence in docs/TESTING.md.

Build vertical slices with executable tests. Preserve independent agent contexts and provider choice. Do not introduce fixed agent roles, implicit tool approval, unrestricted shell tools, automatic plugin loading, telemetry, or credential discovery in other applications.

Include a focused problem description, the behavior after the change, checks run, and material limitations. Use deterministic fixtures for CI; never claim they demonstrate live inference. Tests requiring credentials must be opt-in and must not print secrets. License contributions under MIT and retain dependency notices. Run `npm run notices` after dependency updates.

Contribute through pull requests at https://github.com/qualitymaterial/roundtable. Do not publish packages or push directly without the repository owner's approval. See SECURITY.md for vulnerability reporting limitations.
