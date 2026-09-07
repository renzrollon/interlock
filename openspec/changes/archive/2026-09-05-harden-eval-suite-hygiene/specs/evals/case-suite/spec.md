## ADDED Requirements

### Requirement: A conditional instruction is tested on both sides

Where a case tests an instruction whose correct behaviour depends on a condition in the environment, the suite SHALL also hold a case for the opposite condition. A suite that only tests when a behaviour should occur, and never when it should not, applies one-sided pressure to the surface it grades.

#### Scenario: Halting case has a launching twin

- **WHEN** a case asserts that the entry point halts because a required host capability is absent
- **THEN** the suite also holds a case asserting that, with that capability present, the entry point launches the workflow exactly once and does not launch it again

#### Scenario: Routing case has a sibling-destination twin

- **WHEN** a case asserts that one request routes to a named skill rather than a confusable sibling
- **THEN** the suite also holds a case for a request that should route to that sibling instead

#### Scenario: Read-scope case has an upper-tier twin

- **WHEN** a case asserts that the narrowest context tier must not read the change's design and delta specifications
- **THEN** the suite also holds a case asserting that the widest context tier reads them in full

### Requirement: A twin case cites the case it twins, and the citation resolves

A case authored to supply the opposite side of a conditional instruction, rather than from an independently observed failure, SHALL declare the case it twins in a dedicated field of its case definition. The declared name SHALL resolve to a case that exists in the suite. A twin declaration SHALL NOT substitute for provenance on a case that encodes an independently observed failure.

#### Scenario: Twin declaration resolves

- **WHEN** a case declares the case it twins
- **THEN** the structural gate confirms that a case of that name exists in the suite

#### Scenario: Dangling twin declaration is rejected

- **WHEN** a case declares a twin that does not exist in the suite
- **THEN** the structural gate fails, naming the case and the unresolved twin

#### Scenario: Twin declaration is distinguishable from an observed failure

- **WHEN** the suite is inspected for which cases encode an observed failure
- **THEN** a case that carries a twin declaration is separable from one that cites only an observed failure

### Requirement: Every judged grader carries a calibration set or a recorded deferral

Each grader whose verdict depends on a model judge SHALL either have a stored set of human-labelled transcripts kept with its case, or be named in a committed deferral record that states why the set does not yet exist. A judged grader that is neither calibrated nor recorded as deferred SHALL fail the structural gate.

#### Scenario: Judged grader with a calibration set

- **WHEN** a judged grader has a stored calibration set
- **THEN** the structural gate accepts it

#### Scenario: Judged grader with a recorded deferral

- **WHEN** a judged grader has no calibration set and is named in the deferral record with a stated reason
- **THEN** the structural gate accepts it, and the deferral is visible to a reader

#### Scenario: Silently uncalibrated judged grader is rejected

- **WHEN** a judged grader has neither a calibration set nor a deferral entry
- **THEN** the structural gate fails, naming the grader

#### Scenario: A stale deferral is visible

- **WHEN** a deferral record names a grader that no longer exists, or a grader that now has a calibration set
- **THEN** the structural gate fails, so the record cannot outlive the condition it describes

### Requirement: Surfaces with no observed failure are recorded by name, not filled with hypotheticals

When a model-facing surface has been swept for observed failures and none was found, that surface SHALL be recorded by name in the suite's baseline record as unexercised with no provenance. The absence SHALL NOT be closed by authoring a case for a failure nobody observed.

#### Scenario: Swept surface with no provenance is recorded

- **WHEN** a surface is swept for observed model-behaviour failures and none is found
- **THEN** the surface is named in the baseline record as unexercised, with no case authored for it

#### Scenario: Swept surface with provenance gets a case

- **WHEN** the sweep finds an observed failure on a surface
- **THEN** a case is authored citing that failure, and the surface is not listed as unexercised

#### Scenario: Empty corpus is stated

- **WHEN** a source the sweep was required to read holds no records
- **THEN** the baseline record states that the source was empty, rather than reporting the sweep as complete over it

### Requirement: The suite reports which model-facing surfaces it exercises

The suite SHALL be able to partition every model-facing file and every assembled prompt into those named by at least one case and those named by none, and SHALL print the unexercised set by name. A case SHALL be able to name the surfaces it exercises directly, in addition to whatever its provenance citation names. The partition SHALL be a report: it SHALL NOT fail on the size of the unexercised set, and coverage SHALL NOT gate a change.

#### Scenario: Partition is total

- **WHEN** the coverage report is produced
- **THEN** every model-facing file and every assembled prompt appears in exactly one of the exercised and unexercised sets

#### Scenario: Unexercised surfaces are named

- **WHEN** surfaces are exercised by no case
- **THEN** the report prints them by name

#### Scenario: Coverage never fails a build

- **WHEN** the unexercised set is large, or grows
- **THEN** the report states it and the check still passes

#### Scenario: A case may name what it exercises

- **WHEN** a case declares the surfaces it exercises
- **THEN** those surfaces are counted as exercised regardless of what its provenance citation names

#### Scenario: A declared surface that does not exist is rejected

- **WHEN** a case names a surface that is not present in the repository
- **THEN** the structural gate fails, naming the case and the unresolved surface
