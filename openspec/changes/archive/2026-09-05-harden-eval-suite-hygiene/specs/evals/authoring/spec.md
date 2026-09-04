## ADDED Requirements

### Requirement: The skill reads transcripts before explaining a judged case

After a run that includes a judged grader, the skill SHALL read at least one transcript for each judged case before writing its explanation of that case. It SHALL NOT explain a judged result from scores alone. A score movement whose cause is visible only in the trace — a model that satisfied a judge by narrowing the task rather than by doing it — is invisible to every other step in the loop.

#### Scenario: Judged case explained after reading a transcript

- **WHEN** the skill explains a case whose score depends on a judged grader
- **THEN** it has read at least one transcript for that case first

#### Scenario: Deterministic-only run needs no transcript

- **WHEN** every grader in the run is deterministic
- **THEN** the transcript-reading step does not apply

#### Scenario: Reading does not become reclassification

- **WHEN** reading a transcript suggests a different classification than triage produced
- **THEN** the skill reports what it saw in the transcript as explanation
- **AND** it does not restate, override, or soften the verdict triage gave

### Requirement: The report names the transcripts that were read

The skill's report SHALL carry a line naming which transcripts it read. When it read none, the report SHALL say so explicitly rather than omitting the line, so a reader can tell an unexamined result from an examined one.

#### Scenario: Transcripts read are named

- **WHEN** the skill reports on a run in which it read transcripts
- **THEN** the report names each transcript it read

#### Scenario: No transcripts read is stated

- **WHEN** the skill reports on a run and read no transcript
- **THEN** the report states that none were read
- **AND** the line is present rather than omitted

#### Scenario: Unavailable transcripts are spoken

- **WHEN** the run produced no readable transcript
- **THEN** the report states that transcripts were unavailable and why
- **AND** it does not present the explanation as transcript-grounded
