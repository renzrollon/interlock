## Purpose
Decides, without a model, whether an eval case has earned promotion from advisory to blocking — computed from a history of triaged results runs and communicated by exit status, so the rule that governs whether evals can fail a build cannot be re-argued on each pull request.

## ADDED Requirements

### Requirement: Promotion is a decision the CLI makes, not a judgement a reviewer re-argues

The promotion decision SHALL be produced by a command that reads a directory of results files from prior runs and reports, per case, whether that case may be promoted from advisory to blocking. No consumer SHALL be asked to re-derive the decision from prose, and no reviewer SHALL be asked to argue it from a proposal.

#### Scenario: Decision is available as a command

- **WHEN** a history directory of prior results files is supplied
- **THEN** the command reports, for every case present in that history, whether it is promotable
- **AND** it names the reason for each case it refuses to promote

#### Scenario: Decision is not restated in prose

- **WHEN** the promotion rule is inspected
- **THEN** the values it turns on are read from the published limits surface
- **AND** they are not restated in a skill, a specification, or a documentation page

### Requirement: The exit status is the promotion verdict

The command SHALL communicate its verdict through its exit status, distinguishing at least: every requested case is promotable, at least one is not yet promotable, and the history was insufficient to decide. An insufficient history SHALL NOT be reported with the same status as a refusal, because "not enough evidence" and "the evidence says no" are different facts.

#### Scenario: All requested cases promotable

- **WHEN** every case in scope satisfies the promotion rule
- **THEN** the command exits with the success status

#### Scenario: A case is not yet promotable

- **WHEN** at least one case in scope fails the promotion rule
- **THEN** the command exits with a non-zero status distinct from the insufficient-history status

#### Scenario: Insufficient history is distinguishable

- **WHEN** the history directory holds fewer runs than the rule requires, or holds none
- **THEN** the command reports insufficient history and exits with a status distinct from both success and refusal
- **AND** it does not report any case as promotable

### Requirement: Promotion requires repeated whole-run success, not eventual success

A case SHALL be promotable only when it passed on every run of every qualifying run in the history — success on some runs and failure on others SHALL NOT qualify. The number of consecutive qualifying runs required SHALL be published on the limits surface and read from it.

#### Scenario: Every-run success across the required window

- **WHEN** a case passed on every run across at least the required number of consecutive qualifying runs
- **THEN** the case is reported promotable

#### Scenario: An intermittent case is refused

- **WHEN** a case passed on some runs and failed on others within the window
- **THEN** the case is reported not promotable
- **AND** the reason names the run in which it failed

#### Scenario: A run that produced no signal breaks the window

- **WHEN** a results file in the history did not complete
- **THEN** it does not count toward the consecutive-run requirement
- **AND** the command states that it was excluded and why

### Requirement: A case with a judged grader additionally requires measured judge agreement

A case whose score depends on a judged grader SHALL NOT be reported promotable on run history alone. It SHALL additionally require a measured judge/human agreement report for each of its judged graders, meeting the agreement floor published on the limits surface.

#### Scenario: Judged case with sufficient agreement

- **WHEN** a judged case satisfies the run-history rule and every judged grader's measured agreement meets the published floor
- **THEN** the case is reported promotable

#### Scenario: Judged case with no agreement measurement

- **WHEN** a judged case satisfies the run-history rule but no agreement measurement exists for one of its judged graders
- **THEN** the case is reported not promotable
- **AND** the reason names the unmeasured grader rather than reporting insufficient history

#### Scenario: Deterministic case needs no agreement measurement

- **WHEN** a case uses only deterministic graders
- **THEN** the absence of an agreement measurement does not affect its promotability

### Requirement: The decision runs without a model and without the network

The promotion decision SHALL be computed from the supplied history and agreement reports alone. It SHALL NOT call a model, SHALL NOT reach the network, and SHALL produce the same verdict from the same inputs.

#### Scenario: Same inputs yield the same verdict

- **WHEN** the decision is computed twice over the same history
- **THEN** it reports the same verdict for every case

#### Scenario: Offline operation

- **WHEN** the decision is computed with no network available
- **THEN** it completes and reports a verdict

### Requirement: An unreadable history entry is spoken, never skipped silently

When a file in the history directory cannot be read or parsed as a results file, the command SHALL name it and state that it was excluded. It SHALL NOT treat an unreadable entry as an absent one, and it SHALL NOT silently narrow the window.

#### Scenario: Unparseable entry is named

- **WHEN** a file in the history directory cannot be parsed
- **THEN** the command names the file and states that it was excluded from the decision

#### Scenario: Every entry unreadable

- **WHEN** no file in the history directory can be parsed
- **THEN** the command reports insufficient history rather than success

### Requirement: The promotion decision governs only the eval job's own blocking posture

The decision SHALL determine only whether the eval job may fail a pull request on its own account. It SHALL NOT be consumed by the readiness decision, the review gate, the autonomy decision, or the ship loop, and no eval result SHALL reach any of them.

#### Scenario: The eval job consumes the decision

- **WHEN** the eval job is configured
- **THEN** whether it tolerates a failing verdict is derived from the promotion decision rather than set by hand

#### Scenario: No other gate reads an eval result

- **WHEN** the readiness, review-gate, autonomy or ship decisions are computed
- **THEN** no eval score, triage verdict, or promotion verdict is among their inputs
