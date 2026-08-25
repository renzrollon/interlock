## ADDED Requirements

### Requirement: A run SHALL record one receipt event carrying what it observed

The system SHALL append exactly one `run-receipt` event per ship run, at run close, for halted and clean runs alike. The receipt MUST carry, from what the orchestrator observed rather than from prose: the per-wave tally of succeeded, failed, and not-attempted tasks; whether the plan was reused or rebuilt and under which verdict; the plan fingerprint hash; review blocker and warning counts when a review ran; remediation rounds consumed; the count of skipped verifications and how many were skipped for cap exhaustion; the count of unresolved errors carried past a wave; the leftover task ids; the halt reason or the fact of completion; the commit identifier when a commit was made; and the run's degradation list.

The degradation list MUST be the same list the run reports to its reader, produced once and used for both, so the banner a human reads and the record a later process reads cannot disagree. The leftover task ids MUST likewise be one list, reported to the reader and recorded in the receipt, on a halted run as well as a clean one.

The leftover task ids are every task still unticked at close, which is not the same set as the tasks that failed: a run that halts at a verification checkpoint leaves whole waves that never ran and therefore never failed, and those are precisely the tasks a later reader has to be told about. The tick state MUST be read from the change's own task list at close rather than inferred from the run's failure list. A run that cannot read that list MUST leave the field unobserved rather than empty, because an empty list claims the run finished everything.

The receipt MUST be written with fields copied by name, like every other event type, so handing the writer the run's whole summary object cannot leak prompts, diffs, finding bodies, or suite output into the trajectory.

#### Scenario: Happy path — a clean run records a complete receipt

- **GIVEN** a run that executed three waves, reused its plan, ran no review, consumed no remediation rounds, and committed
- **WHEN** the run reaches its close
- **THEN** the trajectory contains exactly one `run-receipt` event carrying the three wave tallies, the plan-reuse verdict, the fingerprint hash, zero remediation rounds, an empty leftover list, the commit identifier, and the run's degradation list

#### Scenario: Failure — a halted run records a receipt naming the halt and what was left

- **GIVEN** a run that halts partway through its second wave with two tasks unticked
- **WHEN** the run closes on its halt path
- **THEN** the trajectory contains one `run-receipt` whose halt reason names the halt and whose leftover task ids list both unticked tasks
- **AND** the receipt is present even though no commit was made

#### Scenario: Edge case — a halt at a checkpoint lists the waves that never ran

- **GIVEN** a run that halts at the verification checkpoint after its first wave, leaving every task of the later waves unticked and unattempted
- **WHEN** the run closes on its halt path
- **THEN** the receipt's leftover task ids list those tasks, none of which failed
- **AND** the run reports the same list to its reader rather than reporting nothing left behind

#### Scenario: Edge case — a fat summary object cannot leak content into the receipt

- **GIVEN** a run whose summary object also holds a review result with finding bodies and a verification result with suite output
- **WHEN** the receipt is appended from that object
- **THEN** the written event contains only the named receipt fields
- **AND** it contains no finding text, no suite transcript, and no diff content

### Requirement: A run SHALL record the commit identifier next to the run

When a ship run creates a commit, the receipt SHALL carry that commit's identifier. A run that made no commit MUST record the absence explicitly rather than omitting the field, so that "did not commit" and "we never found out" remain distinguishable.

This exists so a later process can ask what happened to the changed files afterwards. That question cannot be asked at all from a commit identifier that only ever reached standard output.

#### Scenario: Happy path — a committing run records its commit identifier

- **GIVEN** a run whose commit step reports success with an identifier
- **WHEN** the receipt is written
- **THEN** the receipt carries that identifier

#### Scenario: Failure — a run stopped before committing records no-commit explicitly

- **GIVEN** a run invoked so that it stops after its waves without committing
- **WHEN** the receipt is written
- **THEN** the receipt records that no commit was made, distinctly from a run whose commit outcome was never observed

#### Scenario: Edge case — a commit step that reported failure does not yield an identifier

- **GIVEN** a run whose commit step reports failure
- **WHEN** the receipt is written
- **THEN** the receipt records the absence of a commit identifier and does not carry a fabricated or partial one

### Requirement: A missing receipt SHALL NOT by itself make a run unreconstructable

The reconstructability check SHALL recognize `run-receipt` as a valid event type and SHALL NOT require one for a run to pass. A run that halted before reaching its own close could not have written a receipt, and refusing to reconstruct such a run would withhold exactly the trajectory a reader most needs.

The absence of a receipt on an otherwise-closed run MUST remain observable to a reader, because it means the run did not reach its own close.

#### Scenario: Happy path — a run with a receipt passes reconstructability

- **GIVEN** a closed run whose trajectory has contiguous sequence numbers, a run-start, a receipt, and a closing event
- **WHEN** the reconstructability check runs
- **THEN** it reports the run reconstructable

#### Scenario: Failure — a run that died before its close still reconstructs

- **GIVEN** a run whose trajectory has a run-start and a closing event but no receipt
- **WHEN** the reconstructability check runs
- **THEN** the check does not report a problem on account of the absent receipt
- **AND** a reader listing the run can still tell that no receipt was recorded

#### Scenario: Edge case — a second receipt on one run is reported

- **GIVEN** a trajectory that somehow carries two `run-receipt` events for the same run
- **WHEN** the reconstructability check runs
- **THEN** it reports the duplicate as a problem, because a run has one close and therefore one receipt

### Requirement: A trajectory file SHALL be scorable without the repository beside it

After this change a trajectory file SHALL carry enough observed facts that a reader on a different machine, with no version-control checkout, no change artifacts, and no test suite available, can determine what the run did and what it degraded on. Facts that cannot travel MUST be represented by an identifier rather than silently omitted: the executed plan is represented by its fingerprint hash, not by its contents.

#### Scenario: Happy path — a copied trajectory answers the run's outcome

- **GIVEN** a trajectory file copied to a machine with no checkout of the repository it came from
- **WHEN** a reader lists and shows that run
- **THEN** the reader can state the change name, whether it halted and why, the per-wave tallies, the degradations, and the commit identifier without consulting version control

#### Scenario: Failure — an absent fact reads as unknown, not as clean

- **GIVEN** a run that halted before its review step ran
- **WHEN** the receipt is read from a copied trajectory
- **THEN** the review counts read as not observed rather than as zero blockers

#### Scenario: Edge case — two runs of the same plan are identifiable as such

- **GIVEN** two trajectory files from runs that executed identical plans over identical artifacts
- **WHEN** their receipts are compared on a machine holding neither repository
- **THEN** their plan fingerprint hashes match
- **AND** neither receipt carries the plan's full contents
