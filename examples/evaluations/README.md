# Matched solo/team evaluation

This measures recorded evidence, not model quality automatically. Start with the same task brief, source files, provider model/version, combined request/token/cost limits and tool policy in two independent sessions. Use one participant in the solo run and two or more independent participants in the team run. Do not share one run's findings with the other.

1. Select a task from tasks.json; review its assertions and human rubric.
2. Create two sessions with the identical objective using `roundtable session new "<objective>"`. Add the desired participants and set matching combined budgets in /settings.
3. Before starting, configure /require-check contracts for the deliverable in both sessions. Use the same deterministic validator specification. Record every intervention through the existing repair commands and evaluation notes.
4. Finish both runs, inspect required checks and /summary, and pause the sessions. Have a human review anonymized artifacts against the rubric without participant/model labels.
5. Create a comparison file: {"task":"task-id","solo":"SOLO-SESSION-UUID","team":"TEAM-SESSION-UUID","humanNotes":"Describe interventions and any setup mismatch","qualityScores":{"solo":0,"team":0,"rubric":"Use scores 0–5 after independent human review"}}. Omit qualityScores until reviewed.
6. Run `roundtable evaluate comparison.json > comparison-results.json`.

The report labels missing checks and pending work, separates first-pass from repaired completion, reports provider usage/estimated costs and warns about unmatched limits. A zero cost estimate does not mean a subscription has unlimited quota. Repeat and rotate run order before drawing conclusions. Agent count, agreement and transport test success are not quality metrics. Human scores are user-supplied, not a calibrated model judge.
