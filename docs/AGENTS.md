# Agent configuration and lifecycle

Every agent has a persistent UUID, display name, provider/model, its own instructions, capability permissions, runtime state and separate Pi JSONL directory. Models are selected from Pi's actual installed registry or explicitly configured compatible endpoints. There are no hardcoded production roles. Names in the demo identify deterministic fixtures only.

`/add-agent` accepts JSON with `name`, `provider`, `model`, optional `instructions`, and optional `permissions`. Safe defaults are `collaborate`, `memory` and `artifact`. Every member can discover tools and request more capabilities. An agent may remain fully tool-capable without shell or network access.

`/pause-agent`, `/resume-agent` and `/remove-agent` preserve historical records. Removal stops execution and excludes future routing. `/replace-agent <id> <provider> <model>` removes the old member and creates a new independent identity with the same display name/instructions/permissions. Old context remains available in its original session directory. It does not silently migrate hidden state to the new model.

Live admission runs a harmless provider protocol probe: a nonce tool call, then a receipt supplied as a tool result. Both must be handled correctly. Text-only or malformed responses produce a compatibility error and pause the attempted agent. Subscription/API auth failure also remains visible; no fake tool call fallback exists. Deterministic fixtures explicitly bypass live admission and have their own provider label.

`/agents` shows membership and model identity. `/activity` contains per-agent requests, tool calls, usage and errors. Usage is also durable in SQLite events. Providers can share an auth runtime without sharing context. There is no global active-model switch.

Session policy choices are open, goal, structured and parallel. Programmatic `Engine.create` accepts policy, constraints, limits and session permissions. The CLI currently creates goal sessions. A temporary human-designated coordinator can be expressed in instructions; it gains no exclusive tool access.
