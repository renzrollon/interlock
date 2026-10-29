# Spec Delta

## ADDED Requirements

### Requirement: The suite SHALL hold a review-recall case encoding the PR #28 miss

The suite SHALL hold `evals/review-recall-pr28/`, citing PR #28 and its comments 6471123715, 6471559316 and 6471618730 as provenance, that runs `review-code` over the PR #28 diff (`251cebe..e177e7d`) in a scratch clone and grades its findings with deterministic regex graders, one per known finding: M1 (a settle run that only the drift line ends), M2 (rows cut at the card floor), and B1 (every `settleWatching()` reader after any load). The case SHALL be a full-suite case (D15), metered only where a model credential is configured, with `max_turns` and a timeout bounding one run.

#### Scenario: Happy path — the case is structurally valid offline

- **GIVEN** the shipped suite
- **WHEN** `npm test` runs `test/evals.test.mjs`
- **THEN** `review-recall-pr28` passes the structural gate: a pinned schema version, provenance naming PR #28, and only deterministic graders

#### Scenario: Failure — a review that misses the lifecycle finding

- **GIVEN** a recorded review of the PR #28 diff whose findings do not mention the drift line as the only end of a settle run
- **WHEN** the case is graded
- **THEN** the M1 grader fails and the case score is below a pass

#### Scenario: Edge case — no credential

- **GIVEN** a CI run with no model credential
- **WHEN** the eval workflow runs
- **THEN** the metered step is skipped with its reason printed, and the structural gate still runs
