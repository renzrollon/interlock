# evals/capture Specification

## Purpose
Turns a recorded ship-run trajectory into an eval-case skeleton with real provenance, so the step from "a run misbehaved here" to "there is a regression case for it" does not require knowing the case schema or pasting a transcript into a chat. It emits a draft for a human to confirm; it never decides that a failure is real, and it never adds a case to the suite by itself.

## Requirements

### Requirement: Capture emits a case skeleton from a recorded trajectory

The system SHALL expose a command that, given a recorded run identifier and optionally a task identifier within it, emits an eval-case skeleton derived from that run's trajectory. The skeleton SHALL carry a provenance citation naming the trajectory locator and the range of events it was derived from, so the citation identifies the evidence rather than merely asserting that evidence exists.

The emitted skeleton SHALL satisfy the structural gate the case suite is held to, so that moving it into the suite unchanged does not fail that gate: it declares the case schema version it pins, it carries a non-empty provenance line, and every grader it emits declares a grader type the harness accepts.

#### Scenario: Happy path — a recorded run yields a citable skeleton

- **WHEN** capture is run against a recorded, reconstructable run
- **THEN** a case skeleton is emitted whose provenance names that run's trajectory and the events it was derived from

#### Scenario: The emitted skeleton passes the suite's structural gate

- **WHEN** an emitted skeleton is placed into the eval suite unchanged
- **THEN** the structural gate over eval cases accepts it

#### Scenario: A task identifier narrows the event range

- **WHEN** capture is run with a task identifier that the run recorded
- **THEN** the provenance names the event range for that task rather than the whole run

### Requirement: Capture refuses a run that is not reconstructable

The system SHALL determine reconstructability using the same decision the reconstructability check already publishes, and SHALL refuse to emit a skeleton for a run that decision reports incomplete. It SHALL NOT introduce a second, private notion of what makes a run reconstructable.

A refusal SHALL report the problems that decision named, so the caller learns why the run cannot be cited rather than only that it cannot.

#### Scenario: Happy path — a reconstructable run is accepted

- **WHEN** the reconstructability check reports a run reconstructable
- **THEN** capture proceeds

#### Scenario: Failure — an incomplete trajectory is refused with its reasons

- **WHEN** the reconstructability check reports a run incomplete
- **THEN** capture emits no skeleton, exits non-zero, and reports the problems the check named

#### Scenario: Edge case — an unknown run identifier is refused, not invented

- **WHEN** capture is given a run identifier for which no trajectory exists
- **THEN** capture refuses and says no trajectory was found for that run

### Requirement: The emitted grader quotes an observed value and is marked unconfirmed

Where the trajectory records a value the run should not have produced — a value outside a declared set, or a value the run fabricated — the emitted skeleton SHALL carry one deterministic grader whose pattern is that value, quoted from the trajectory, and the grader SHALL be marked as requiring confirmation before the case is trusted.

Where no such value can be quoted from the recorded events, the skeleton SHALL emit a grader with a stated placeholder marked as requiring confirmation, and SHALL say that no value could be quoted. It SHALL NOT invent a pattern, and SHALL NOT emit a judged grader, because nothing about a captured draft has yet been shown to need judgement.

The skeleton SHALL NOT be emitted with the per-pull-request tag, because a pattern that has not been confirmed must not run on every pull request.

#### Scenario: Happy path — an observed out-of-set value becomes the grader pattern

- **WHEN** the cited events record a value outside a declared set
- **THEN** the emitted grader's pattern is that value, quoted from the trajectory, and the grader is marked as requiring confirmation

#### Scenario: Failure — no quotable value yields a marked placeholder, not an invented pattern

- **WHEN** no out-of-set or fabricated value can be quoted from the cited events
- **THEN** the emitted grader carries a stated placeholder marked as requiring confirmation
- **AND** the output says that no value could be quoted from the trajectory

#### Scenario: Edge case — a captured skeleton is not tagged for per-pull-request running

- **WHEN** a skeleton is emitted
- **THEN** it carries no per-pull-request tag

### Requirement: Capture writes only where the caller named, and never into the suite

The system SHALL write the skeleton only under a directory the caller named, and SHALL refuse when that directory resolves inside the eval suite. Adding a case to the suite is a human decision made after reading the draft, and a command that could write into the suite would make the draft indistinguishable from a reviewed case.

The command SHALL NOT modify any existing case, and SHALL refuse rather than overwrite when the named directory already holds a case.

#### Scenario: Happy path — the skeleton lands in the caller's directory

- **WHEN** capture is given an output directory outside the eval suite
- **THEN** the skeleton is written there and nothing under the eval suite is created or modified

#### Scenario: Failure — an output directory inside the suite is refused

- **WHEN** capture is given an output directory that resolves inside the eval suite
- **THEN** capture writes nothing and reports that it does not write into the suite

#### Scenario: Edge case — an occupied output directory is refused rather than overwritten

- **WHEN** the named output directory already holds a case
- **THEN** capture writes nothing and reports that the directory is occupied

### Requirement: Capture records what the trajectory could not supply

Where the trajectory records no prompt snapshot for the cited events, the skeleton SHALL carry a stated placeholder in place of the prompt and SHALL say that no prompt was recorded, rather than reconstructing one from the events or omitting the field.

#### Scenario: Happy path — a recorded prompt snapshot is carried through

- **WHEN** the cited events carry a recorded prompt snapshot
- **THEN** the skeleton's prompt is that snapshot

#### Scenario: Failure — an absent prompt is a stated placeholder

- **WHEN** the cited events carry no recorded prompt snapshot
- **THEN** the skeleton's prompt is a stated placeholder and the output says no prompt was recorded
- **AND** no prompt is reconstructed from the recorded events
