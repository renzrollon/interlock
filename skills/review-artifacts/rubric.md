## Base rubric

Judge the change's artifacts (`proposal.md`, `specs/**/*.md`, `design.md`, `tasks.md`, and `decisions.md` when it exists) as the person who must build from them. A question that does not apply to this change is skipped, not answered with a finding.

## Architecture

- **Structure and ownership.** Are layer boundaries placed correctly in `design.md` for this stack, and does the structure follow the patterns already in this project? Are state and ownership decisions appropriate?
- **Data flow.** Is it clear: reads, writes, mutations, side effects?
- **Failure.** What happens when a step fails, and does the design say so?
- **Consistency.** Is the approach consistent with the project's own docs (`CLAUDE.md`, `AGENTS.md`, `docs/`)?
- **Non-Goals, alternatives and rollback.** Does `design.md` state what it does not do, the alternatives it considered and why it rejected them, and how the change is undone? Ask for this as content. Never ask for a new heading for it.
- **Simpler alternative.** Is there one that reaches the same outcome? Is the design proportionate to the problem, or does it add structure it does not need?

## QA

First list the tests the scenarios imply. Then judge:

- **Scenario truth.** Does each GIVEN produce its THEN?
- **Observable outcome.** Is each THEN observable: an exit code, a file, stdout, a record? "Should work properly" is not a criterion.
- **No contradiction.** Does any scenario contradict another, or a requirement already in force?
- **Traceability, both ways.** Does every requirement have a task that verifies it, and every task a requirement or a stated reason?
- **Omissions.** Would the system do exactly, and only, what the artifacts ask? What does a real user or caller hit that no scenario mentions?
- **One term, one meaning.** Does each term keep one sense across the proposal, the design, the specs and the tasks?
- **Edge cases.** Empty, absent, malformed, boundary, error, concurrent, interrupted, re-run.
- **Each task states its own verification.** The check is in that task's own checkbox description. A separate verification task is only for a broader integration check.
- **Ordering.** Do dependencies precede dependents, and is each task small enough for one focused session?
- **Same-file staircase.** Do consecutive checkboxes name the same production path, one per TDD beat, comment move or trap? That is one checkbox, not five. Report it as a warning naming the repeated path. It is not a ship halt: `planWaves` folds the resulting one-task waves back together, so the cost is implementer count and lost parallelism.
- **Sections as waves.** Does each numbered section hold work that could share a wave? Independent files belong in one section; a new section is only an output-exists boundary.
- **Delta-spec quality.** Are ADDED, MODIFIED and REMOVED used correctly, and do the deltas describe behaviour, not implementation? A MODIFIED requirement keeps every living scenario title.

## Invariant check

If the change transforms a shared or derived value (normalizing an identity, deriving a cache or dedup key, canonicalizing a field), then `tasks.md` must contain a task for every consumer of that value, not just the one the change is about. When the graph exists, run `interlock-graph consumers <symbol>` for each shared value `design.md` names. A change that updates one call site and leaves its siblings reading the raw form is a blocker at this gate, because it is far cheaper to add the tasks now than to find the surviving bug after review. The sweep itself is in `shared/INVARIANT-SWEEP.md`, at the plugin path the brief names.

## Decision ledger

A `needs_human` row in `decisions.md` is a question held for the person, not a finding. An `agent_resolved` row is a claim: check its resolution against `design.md`, and report a resolution the design contradicts.

## What a blocker is

This section decides the severity of every finding, a lens's findings included. A blocker means that implementing the artifacts as written would fail its own verification or ship a defect: a task whose test cannot pass, a scenario the design contradicts, a consumer the invariant sweep missed. Everything else is a warning or a suggestion. An incomplete list of the existing test pins a change breaks is never a blocker when `tasks.md` states the bounded pin rule (the spec skill's "Where the tests go": a pin found later is updated in the task that changes its meaning, never during remediation, and reported with the requirement). Nobody can enumerate every pin before the code exists, so a finding that asks for a list nobody can write yet is a warning.
