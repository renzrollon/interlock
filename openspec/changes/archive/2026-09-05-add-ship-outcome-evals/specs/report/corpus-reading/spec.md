## ADDED Requirements

### Requirement: The outcome-eval history is read as a fourth corpus under the existing rules

The report MAY read the committed outcome-eval history in addition to the corpora it already reads. When it does, that corpus SHALL be read under exactly the rules the others are read under: reading never raises, a missing or unreadable file becomes a reported condition carrying its reason, a torn line costs that one record rather than the file, records are classified by their declared schema rather than by filename, nothing is written, and the exit status is unaffected.

#### Scenario: Happy path — an absent history is reported, not raised

- **WHEN** no outcome-eval history exists beneath the repository root
- **THEN** the report completes, states that the corpus is absent, and exits zero

#### Scenario: Failure — an unreadable history is named and skipped

- **WHEN** the history file cannot be read
- **THEN** the report names it as unreadable, computes every other indicator from the remaining corpora, and exits zero

#### Scenario: Edge case — a line of an unrecognized schema is excluded

- **WHEN** a line in the history declares a schema the reader does not recognize
- **THEN** it is counted as unrecognized, named, and contributes to no indicator

### Requirement: Outcome-eval records are never folded into another corpus's figures

A record from the outcome-eval history SHALL contribute only to indicators sourced from that corpus. It SHALL NOT be counted in any indicator sourced from the outcome corpus, the trajectory corpus or the metrics corpus, and the two SHALL never be summed.

Each indicator the report derives from the history SHALL name that corpus as its source and SHALL carry its own denominator.

#### Scenario: Happy path — a history-derived indicator names its own source and denominator

- **WHEN** an indicator is derived from the outcome-eval history
- **THEN** it names that corpus as its source and reports the number of records it observed

#### Scenario: Failure — an eval record does not inflate a real-run figure

- **WHEN** the history holds results and the trajectory corpus holds real runs
- **THEN** no indicator counts both, and no figure sums a fixture result with a real run

### Requirement: A filter that cannot apply to the history excludes it and says so

The report's change filter keys on a change name that an outcome-eval result does not carry. When a filter cannot be applied to the history, the report SHALL exclude that corpus from the filtered view and state that it was excluded and why, rather than applying a filter that does not match the records' keys or silently returning them unfiltered.

#### Scenario: Happy path — a window filter narrows the history like any other corpus

- **WHEN** a time window excludes some outcome-eval results
- **THEN** those results contribute to no value and to no denominator

#### Scenario: Failure — a change filter excludes the history explicitly

- **WHEN** a change filter is supplied
- **THEN** the outcome-eval history is excluded from the filtered view
- **AND** the report states that it was excluded and that the filter does not apply to it

### Requirement: The history's figures license nothing about a gate

Every figure the report derives from the outcome-eval history SHALL be presented as a value with its denominator, with no verdict label and no comparison against any threshold, and SHALL be reachable only by a human reader or by the skill that explains the report.

#### Scenario: Happy path — a history figure carries no verdict

- **WHEN** a figure derived from the history is presented
- **THEN** it carries no pass, fail, healthy, degraded or blocking label

#### Scenario: Failure — a thin history is stated as licensing nothing

- **WHEN** the history holds too few records for a comparison
- **THEN** the report states the denominator and that the figure licenses no conclusion
