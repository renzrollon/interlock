# Spec Delta

## ADDED Requirements

### Requirement: The suite SHALL hold artifact-gate recall cases drawn from the gate's own failures

The suite SHALL hold two recall cases that run `/interlock:review-artifacts <change> --caller spec` in a scratch workspace and grade the findings with deterministic regex graders. Each grader names a known blocker's file and subject:

- `artifact-gate-recall-merge-verdict`: the artifacts of `add-merge-confidence-gate` as commit `496635588f0d11ae9505970b12313d2542f4a1a9` holds them;
- `artifact-gate-recall-shared-writer`: a harness hazard seeded into a change that passed its gate.

#### Scenario: Happy path — both cases are structurally valid offline

- **GIVEN** the shipped suite
- **WHEN** `npm test` runs `test/evals.test.mjs`
- **THEN** both cases pass the structural gate: a pinned schema version, provenance, `exercises` naming `skills/review-artifacts/SKILL.md`, only deterministic graders, and 40-hex shas in their scaffolds

#### Scenario: Failure — a gate that misses the contradiction

- **GIVEN** a recorded gate over the merge-verdict workspace whose findings never name the requirement that makes an all-green `MERGE` both required and impossible
- **WHEN** the case is graded
- **THEN** that blocker's grader fails, whatever the other three graders decide

#### Scenario: Failure — a gate that misses the seeded hazard

- **GIVEN** a recorded gate over the shared-writer workspace whose findings raise no blocker about parallel callers rewriting the one shared file
- **WHEN** the case is graded
- **THEN** the shared-writer grader fails

### Requirement: Each artifact-gate case SHALL cite the gate it encodes, and SHALL rebuild its workspace from commits on origin

Each case's provenance SHALL name the change, the date of the gate it encodes, and the title of the blocker or false blocker. The findings corpus is not in the repository, so the provenance cites it by those three. Each scaffold SHALL build its workspace only from 40-hex commits that are on `origin`, plus a patch the case directory holds.

#### Scenario: Happy path — the merge-verdict case names its gate

- **WHEN** `evals/artifact-gate-recall-merge-verdict/case.yaml` is read
- **THEN** its provenance names `add-merge-confidence-gate`, the gate of 2026-10-12, and the blocker "All-green MERGE is required and forbidden"

#### Scenario: Edge case — the seeded case's patch is in the case

- **WHEN** the shared-writer scaffold runs
- **THEN** it applies the patch held in its own case directory, and fails with a named reason if the patch does not apply

### Requirement: The suite SHALL hold an artifact-gate false-blocker case for an incomplete test-pin list

The suite SHALL hold `artifact-gate-clean-pin-list`. It gates a change that passed its gate and whose `tasks.md` states the bounded pin rule with a pin list it says is incomplete. A deterministic grader SHALL fail when the gate raises a blocker about that pin list. A blocker on any other ground SHALL not fail this case. The grader SHALL also fail on an output with no `SUMMARY:` line, and SHALL decide the same with or without a multiline flag.

#### Scenario: Failure — the known false blocker returns

- **GIVEN** a recorded gate over that workspace that blocks because the pin list does not name every existing test
- **WHEN** the case is graded
- **THEN** the pin-list grader fails

#### Scenario: Failure — an output that never reviewed

- **GIVEN** a recorded output with no blocker and no `SUMMARY:` line
- **WHEN** the case is graded
- **THEN** the pin-list grader fails

#### Scenario: Edge case — no credential

- **GIVEN** a CI run with no model credential
- **WHEN** the eval workflow runs
- **THEN** the three artifact-gate cases are skipped with the metered step, its reason is printed, and the structural gate still runs

### Requirement: The artifact-gate cases SHALL be full-suite cases, and pass^k SHALL be read from promotion

The three artifact-gate cases SHALL carry no smoke tag, and each SHALL bound one run with `max_turns` and a timeout. Their run-to-run reliability SHALL be the existing promotion reading, every trial of the qualifying runs passing. No new score SHALL be added, and no cost ceiling SHALL change.

#### Scenario: Happy path — no smoke tag and bounded runs

- **WHEN** the three case manifests are read
- **THEN** none carries the smoke tag, and each sets `max_turns` and `timeout_seconds`
