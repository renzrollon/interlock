# Spec Delta

## ADDED Requirements

### Requirement: `interlock run found` SHALL fold the reviewers' answers and emit the skeptics step

After the review step, `interlock run found` MUST read each selected dimension's answer file by its expected name, record per dimension whether it ran, write the readable ledgers to the findings work file, and emit a `skeptics` step with one spawn per prompt the published skeptic assembler builds at the strict shape over the surviving blockers and warnings, each spawn writing its own verdict file. With nothing to judge it MUST write an empty verdict list and adjudicate at once.

#### Scenario: Happy path — every reviewer answered and two findings are judged

- **GIVEN** a strict run whose review step dispatched five dimensions, each of which wrote `.claude/ship/review/dimensions/<dimension>.json` holding `{ dimension, findings, coverage }`, two findings being a blocker and a warning
- **WHEN** the driver calls `interlock run found`
- **THEN** the findings work file holds the five ledgers, the manifest records all five dimensions as run and the review as completed
- **AND** the step's action is `skeptics` with four spawns of kind `skeptic`, labelled `skeptic-<id>-refute` and `skeptic-<id>-second-opinion` for each of the two findings, each briefing naming `.claude/ship/review/skeptics/<label>.json` as the only file it writes besides the `review` stage marker its stage line asks for, and `then.argv` names `run reviewed`

#### Scenario: Failure — one reviewer wrote nothing

- **GIVEN** the same run, whose `qa` reviewer wrote no answer file
- **WHEN** `interlock run found` runs
- **THEN** the step carries `REVIEW INCOMPLETE: qa — no answer file`, the manifest records `qa` as not run and the review as not completed, and the four other ledgers are folded
- **AND** the skeptics step is still emitted over the findings that were written, and the run does not halt

#### Scenario: Failure — an empty answer file, and a reviewer that said why

- **GIVEN** the same run, whose `qa` answer file holds only whitespace, and whose `language` reviewer wrote no file and returned `{ ok: false, detail: "ran out of context" }`
- **WHEN** `interlock run found` runs
- **THEN** the step carries `REVIEW INCOMPLETE: qa — .claude/ship/review/dimensions/qa.json is empty` and `REVIEW INCOMPLETE: language — no answer file; the reviewer reported: ran out of context`, and both are recorded as not run

#### Scenario: Failure — an answer under another dimension's name is not adjudicated

- **GIVEN** a `security` answer file whose `dimension` field reads `architecture`
- **WHEN** `interlock run found` runs
- **THEN** the step carries `REVIEW ANSWER MISMATCHED: security wrote architecture`, `security` is recorded as not run, and the file's findings are not folded
- **AND** a `dimension` value that is not a string is printed as its JSON, and any value is cut to one line of at most 80 characters, so a reviewer cannot put arbitrary text into a relayed banner

#### Scenario: Edge case — nothing to judge

- **GIVEN** a run whose reviewers raised only suggestions, or nothing
- **WHEN** `interlock run found` runs
- **THEN** no `skeptics` step is emitted, the verdicts work file holds an empty list, and the step returned is the adjudication's continuation, a `remediate` step or final verification, as `run reviewed` would return it

#### Scenario: Edge case — a finding the review policy excludes is never briefed

- **GIVEN** a blocker whose file matches a Do-Not-Report path of the repository's review policy
- **WHEN** `interlock run found` builds the skeptics step
- **THEN** no skeptic is briefed on it, and the adjudication later counts it under `droppedByPolicy` as it does today

### Requirement: The skeptics step SHALL be bounded by a published cap, blockers first

The spawns of a `skeptics` step MUST be bounded by `maxSkepticSpawns`, a cap stated once in the limits definition, printed by `interlock limits` and read only by the CLI. The CLI MUST give two spawns per finding, blockers before warnings in finding order, and when the rest does not fit, one per-review pair reserved inside the cap, raising `SKEPTIC CAP REACHED`. Each review and skeptics step MUST carry a `REVIEW WAVE` banner naming its reviewer and skeptic counts with their routing.

#### Scenario: Happy path — under the cap every finding gets its own pair

- **GIVEN** a cap of 16 and a review with three blockers and two warnings
- **WHEN** `interlock run found` builds the skeptics step
- **THEN** it carries ten spawns, two per finding, and no `SKEPTIC CAP REACHED` banner

#### Scenario: Failure — over the cap the remainder shares one pair

- **GIVEN** a cap of 16 and a review with four blockers and seven warnings
- **WHEN** `interlock run found` builds the skeptics step
- **THEN** it carries sixteen spawns: a pair for each of the four blockers and the first three warnings, and one `skeptic-review-refute` and `skeptic-review-second-opinion` pair briefed on the remaining four warnings
- **AND** the step carries `SKEPTIC CAP REACHED: 7 of 11 findings judged per finding, 4 judged per review`

#### Scenario: Edge case — the cap is published and read by the CLI alone

- **GIVEN** the installed CLI
- **WHEN** `interlock limits` and `interlock limits --json` run
- **THEN** the text carries a row for the skeptic spawn cap and the JSON carries `maxSkepticSpawns` under `limits`
- **AND** the cap-authority check finds its reader in the CLI and no literal of it in a driver or a skill

#### Scenario: Happy path — the review step and the skeptics step say what they spend

- **GIVEN** a strict run selecting six dimensions whose review raises two blockers
- **WHEN** the review step and then the skeptics step are emitted
- **THEN** the review step carries `REVIEW WAVE: 6 reviewers (<model>/<effort>), 0 skeptics (<model>/<effort>)`, because `run found` has not counted them yet
- **AND** the skeptics step carries `REVIEW WAVE: 6 reviewers (<model>/<effort>), 4 skeptics (<model>/<effort>)`, with `inherit` printed on either where the routing holds `null`

### Requirement: A review or skeptics step wider than the run's --max-parallel SHALL say so

A review or skeptics step whose spawns outnumber the `--max-parallel` the run was started with MUST carry `REVIEW WIDER THAN MAX PARALLEL`, naming the step, its spawn count and the flag's value, because no driver chunks a step and a runner host starts every spawn of it at once. The step's spawns MUST be the same with or without the flag.

#### Scenario: Failure — a step wider than the operator's --max-parallel is said

- **GIVEN** a strict run started with `--max-parallel 2` that selects six dimensions and whose review raises two blockers
- **WHEN** the review step and then the skeptics step are emitted
- **THEN** the review step carries `REVIEW WIDER THAN MAX PARALLEL: the review step spawns 6 agents and --max-parallel is 2` and the skeptics step the same line for its four spawns
- **AND** a run started without `--max-parallel`, or with one at least as wide as the step, carries no such line, and neither step's spawns change

### Requirement: `interlock run reviewed` SHALL fold the skeptics' verdicts and set aside an unanswered pair

`interlock run reviewed` MUST read each verdict file the skeptics step named, by its expected name, concatenate the readable ones into the verdicts work file, and adjudicate as it does today. A verdict file that is absent, unparseable or not a list MUST set aside both verdicts of its pair and raise `SKEPTIC VERDICTS MISSING: <labels>`, so the finding survives unjudged. Without a `run found` record for the run it MUST halt naming the step it needed.

#### Scenario: Happy path — every skeptic answered

- **GIVEN** a skeptics step of four spawns, each of which wrote its verdict file holding a list of verdicts
- **WHEN** the driver calls `interlock run reviewed`
- **THEN** the verdicts work file holds the four lists concatenated, and the adjudication, the dimension record, the proof, the review record, the metrics and the first remediation plan are written as they are today

#### Scenario: Failure — one skeptic wrote nothing

- **GIVEN** the same step, whose `skeptic-<id>-refute` spawn wrote no file
- **WHEN** `interlock run reviewed` runs
- **THEN** the step carries `SKEPTIC VERDICTS MISSING: skeptic-<id>-refute`, both verdicts of that finding's pair are set aside, and the finding survives with no verdict
- **AND** a merge-confidence assessment over the run flags the finding's vote count below the published floor, and the finding is never dismissed by the one verdict that did arrive

#### Scenario: Failure — a verdict file that is not a list

- **GIVEN** a verdict file holding an object with no list in it
- **WHEN** `interlock run reviewed` runs
- **THEN** the pair is set aside and named in the banner exactly as an absent file would be

#### Scenario: Failure — the review step predates the fold

- **GIVEN** a run manifest that carries no `run found` record
- **WHEN** `interlock run reviewed` runs
- **THEN** it halts with a reason naming `run found`, and reads no verdicts work file left by an earlier run

### Requirement: Dimension selection SHALL be a recorded rule

The CLI MUST select the strict depth's always-on dimensions as the limits surface publishes them, add `devops` for deploy, CI, configuration or infrastructure paths and `security` for authentication, input-handling or data-exposure paths by the run's risk path classification, and add `domain` only by the domain-review capability's rule. The step MUST record the selection, a reason per optional dimension, each skip with its reason, and why `domain` was not selected.

#### Scenario: Happy path — a deploy change adds devops

- **GIVEN** a run whose observed changed paths include a CI workflow file
- **WHEN** the `review` step is emitted
- **THEN** the selection lists the published always-on dimensions and `devops`, with a reason naming the workflow file, and the step carries one reviewer spawn per listed dimension

#### Scenario: Happy path — a change that touches a specified file adds domain

- **GIVEN** a run whose graph links `lib/risk.mjs` to a living spec by a reliable edge, and whose observed changed paths include `lib/risk.mjs`
- **WHEN** the `review` step is emitted
- **THEN** the selection includes `domain`, after the always-on dimensions, with a reason naming the capability and the file

#### Scenario: Failure — an unrelated path does not add security

- **GIVEN** a run whose only changed path is a documentation file no living spec is linked to, and whose change has no delta spec for an existing capability
- **WHEN** the `review` step is emitted
- **THEN** the selection lists exactly the published always-on dimensions
- **AND** no dimension is recorded as skipped, because a graph was available and it linked nothing, and the step records why `domain` was not selected

#### Scenario: Edge case — no graph is a recorded skip, not a silent absence

- **GIVEN** a run with no graph available and a change whose delta specs only add a new capability
- **WHEN** the `review` step is emitted
- **THEN** the selection lists exactly the published always-on dimensions
- **AND** the step records `domain` as skipped with the reason that no graph exists

### Requirement: The run's review record SHALL say per dimension whether it ran

Every review record a run writes MUST carry a dimension record holding the dimensions the CLI selected, those whose criteria could not be read, those that ran, those skipped with a reason, and whether the review completed. A dimension MUST be recorded as run only when `run found` read its own answer file under its own name; the review completed when every dispatched dimension ran. Every later adjudication of the run MUST write the record again, unchanged in meaning.

#### Scenario: Happy path — a completed review records every selected dimension as run

- **GIVEN** a review step that selected four dimensions, read the criteria of all four, and whose four reviewers each wrote their answer
- **WHEN** the run adjudicates the review
- **THEN** the review record lists the four as selected and as run, none as unavailable, and the review as completed
- **AND** a merge-confidence assessment over that record reads the `review.ran` signal green with no flag

#### Scenario: Failure — unreadable criteria, and a reviewer that did not answer

- **GIVEN** one review whose `qa` criteria file could not be read, whose `qa` reviewer was dispatched with its name alone and answered, and another review whose `regression` reviewer wrote nothing
- **WHEN** each is adjudicated
- **THEN** the first record names `qa` as unavailable and as run, and the review as completed
- **AND** the second record lists `regression` as not run and the review as not completed, and names the other dimensions as run
- **AND** a merge-confidence assessment over the second reads the `review.ran` signal amber

#### Scenario: Edge case — a skipped domain review

- **GIVEN** a review for which the `domain` dimension was skipped for want of a graph
- **WHEN** the review is adjudicated
- **THEN** the record names `domain` as skipped with the reason, and lists it neither as selected nor as run

#### Scenario: Edge case — a remediation round keeps the record

- **GIVEN** a run whose first adjudication wrote the dimension record, followed by one fixing round
- **WHEN** the round is adjudicated and the review record is rewritten
- **THEN** the rewritten record carries the same selected, run, unavailable and skipped dimensions

## MODIFIED Requirements

### Requirement: The run program SHALL emit the review, remediation and handoff steps with criteria and policy inlined

When the run manifest carries a review flag, the waves' completion MUST be followed by a `review` step carrying one spawn per selected dimension, labelled `review-<dimension>`, whose briefing is that dimension's own: its written criteria, the repository's review policy prose, the run's changed files with their changed line ranges, the run's stage line and its unvalidated-reports block, and the one answer file it writes. The step MUST continue to `interlock run found`, which emits a `skeptics` step when there is something to judge, then one `remediate` step per fixing round and one for the verdict, each inlining the round's plan and the same criteria for every dimension to be re-reviewed. When the manifest carries a handoff or conformance flag, final verification MUST be followed by a `handoff` step whose briefing states whether a manual test plan is needed and lists the conformance scenarios to answer. A dimension whose criteria cannot be read MUST still be dispatched, its briefing saying it works from the dimension name alone, and MUST place `REVIEW RUBRIC UNAVAILABLE: <dimension>` on the step. Without any tail flag the emitted program MUST be identical to the lean program.

#### Scenario: Happy path — a strict run emits the tail in order

- **GIVEN** a manifest with `strict: true` and a wave state that has reached `done`
- **WHEN** the driver follows each step's continuation
- **THEN** the steps are `review`, `skeptics` when a blocker or warning was raised, one or more `remediate`, `verify-final`, `handoff`, `commit`, `close`, in that order
- **AND** the review step carries one spawn per selected dimension, each briefing containing that dimension's criteria text and the policy prose and no other dimension's

#### Scenario: Failure — a dimension's criteria file is missing

- **GIVEN** the `qa` criteria file cannot be read
- **WHEN** the `review` step is emitted
- **THEN** the `review-qa` spawn is still emitted and its briefing says the reviewer works from the dimension name alone
- **AND** the step carries `REVIEW RUBRIC UNAVAILABLE: qa`

#### Scenario: Edge case — the changed line ranges a reviewer is given

- **GIVEN** a run that pinned its start commit, whose observed changed paths hold one tracked file with two changed hunks and one untracked file
- **WHEN** the `review` step is emitted
- **THEN** every reviewer's briefing lists the tracked file with the two hunks' line ranges from the diff against the start commit, and the untracked file as one whole-file range
- **AND** a run that pinned no start commit lists the observed paths with no ranges under the branch word, and the step carries `REVIEW BASE NOT PINNED` as today

#### Scenario: Failure — the diff against the start commit cannot be read

- **GIVEN** a run that pinned its start commit, where `git diff` against that commit fails
- **WHEN** the `review` step is emitted
- **THEN** every reviewer's briefing lists the observed changed paths with no line ranges, and the step carries `REVIEW RANGES UNREAD: git diff against <sha> failed (<reason>)`
- **AND** the step still carries one reviewer spawn per selected dimension and continues to `interlock run found`

#### Scenario: Edge case — handoff without review

- **GIVEN** a manifest with `handoff: true` and `review: false`
- **WHEN** the waves complete and final verification passes
- **THEN** no `review`, `skeptics` or `remediate` step is emitted
- **AND** a `handoff` step is emitted before `commit`

### Requirement: Review adjudication and the remediation budget SHALL be computed by the CLI from files the agents wrote

Each reviewer MUST write its ledger to its own answer file and report only that it finished; each skeptic MUST write its verdicts to its own file and report the same. `interlock run found` MUST fold the answers into the findings work file, and `interlock run reviewed` MUST fold the verdicts into the verdicts work file and adjudicate both with the same survival, evidence and band rules as `interlock review`, using the run's observed changed paths, MUST record metrics, and MUST plan round one. `interlock run remediated --round N` MUST re-adjudicate the two work files the round's worker rewrote, record fixed and deferred counts, and obtain the next round, the verdict or the halt from the published remediation cap. No agent MUST be asked to run review or remediation commands, and no driver MUST carry or copy the round budget or the skeptic cap.

#### Scenario: Happy path — one fixing round clears the blockers

- **GIVEN** a first adjudication with two surviving blockers and a cap of two fixing rounds
- **WHEN** the round-one fixer's rewritten findings and verdicts adjudicate to zero blockers
- **THEN** `run remediated --round 1` emits the verdict step
- **AND** the manifest records one fixing round used

#### Scenario: Failure — blockers survive the verdict

- **GIVEN** a blocker that survives every fixing round and the verdict
- **WHEN** `run remediated` runs for the verdict round
- **THEN** it emits a `halt` step whose reason names the surviving blocker count
- **AND** no commit step is ever emitted for the run

#### Scenario: Edge case — the cap is raised by one

- **GIVEN** the remediation cap raised from two to three in the limits definition
- **WHEN** a run with persistent blockers executes
- **THEN** three fixing rounds run before the verdict
- **AND** no driver or briefing changed to make that happen

## REMOVED Requirements

### Requirement: Dimension selection SHALL be a recorded rule, and an agent-added dimension SHALL be recorded

**Reason**: A reviewer briefed for one dimension cannot add another, so the agent-added channel has no writer; the selection rule continues under `Dimension selection SHALL be a recorded rule`, and an answer under a name the run did not brief is recorded as a mismatch by `interlock run found`.

**Migration**: Manifests written before this change may carry `reviewDimensions.added`; readers ignore it. No skill or driver read it.

### Requirement: The run's review record SHALL say which selected dimensions ran with their rubric

**Reason**: "Ran" meant dispatched inside a review the one worker reported complete; with one reviewer per dimension the CLI observes each dimension's answer, and the requirement continues as `The run's review record SHALL say per dimension whether it ran`.

**Migration**: The record keeps its fields; `completed` now follows from the per-dimension answers, and no reader of the record changes.
