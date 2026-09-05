# Decisions — emit-strict-tail-from-cli

| id | question | class | resolution | evidence |
|----|----------|-------|------------|----------|
| D1 | Keep today's tail order, or reorder (for example handoff before final verify)? | agent_resolved | Today's order: review → remediation → final verify → handoff → commit → close. | `workflows/ship.js:2058-2356` (sections 4–8); design.md D1 |
| D2 | Should the review agent keep running `interlock review` and copying `roundCap`, or should the CLI adjudicate from the files? | agent_resolved | The CLI adjudicates `findings.json`/`verdicts.json` with the observed changed paths and owns every round; agents write files and report counts. | `workflows/ship.js:2082-2087`, `:2129-2134`; `openspec/specs/ship/outcome-provenance/spec.md:39`; design.md D2 |
| D3 | Deliver rubrics by instruction (agent reads files) or inline them in the briefing? | agent_resolved | Inline, read by the CLI; a missing rubric is a sentence in the briefing and a banner on the step. | `workflows/ship.js:535-565`, `openspec/specs/review/rubric-delivery/spec.md`; design.md D3 |
| D4 | Who chooses the optional `devops` and `security` dimensions? | agent_resolved | A recorded CLI rule over observed changed paths, using the run's existing path classification; the agent may add a dimension with a reason and the addition is recorded. | `workflows/ship.js:2066-2068`, `lib/risk.mjs`, `lib/surface.mjs`; design.md D4 |
| D5 | Should the handoff agent run `surface` and `conformance`, or should the CLI pre-compute them? | agent_resolved | The CLI runs both and inlines the results. | `workflows/ship.js:2295-2319`; design.md D5 |
| D6 | Who writes the autonomy record for a strict run? | agent_resolved | `run close`, from the CLI's adjudicated blocker count; the commit agent is no longer asked. | `workflows/ship.js:2368-2372`, `openspec/specs/ship/outcome-provenance/spec.md:39`; design.md D6 |
| D8 | Where do the skeptic and verify efforts come from? | agent_resolved | `EFFORT` in `lib/limits.mjs`, read by `lib/run.mjs`; the script's literals are deleted. | `workflows/ship.js:749-754`; design.md D8 |
