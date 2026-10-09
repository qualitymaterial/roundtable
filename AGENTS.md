# Repository instructions

Read STATUS.md first; it owns current implementation state. Keep it concise and update it after verified milestones. Detailed evidence belongs in docs/TESTING.md and artifacts/verification/.

Preserve independent Pi contexts, configurable agent identities and execution-layer permissions. Do not load Pi default tools, project instructions, extensions, skills, credential resolvers or other application auth stores automatically. Remote pushes and package publication require explicit owner authorization. Never commit credentials or unrelated project changes.

Run `npm run check` after code changes. Add regression coverage for meaningful runtime/security defects. Document unverified live behavior separately from deterministic test results. Prefer focused modules to new frameworks.
