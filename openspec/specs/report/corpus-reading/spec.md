# report/corpus-reading Specification

## Purpose
Defines how the report reads the four corpora it may read — the three Interlock writes during real work (outcome records, run trajectories, review metrics) and the committed outcome-eval history, which records fixture runs rather than real ones — covering classification, damage tolerance, scan bounds, the isolation that keeps a fixture result out of a real-run figure, and the absolute prohibition on writing, so a reader that runs against a torn, heterogeneous or oversized corpus produces a report rather than an exception.

## Requirements

### Requirement: The reader never throws

Reading SHALL never raise. A missing corpus, an unreadable file, a torn line, a malformed record and an unreadable directory SHALL each become a reported condition carrying its reason.

#### Scenario: A missing corpus directory is reported, not raised

- **WHEN** no corpus directory exists beneath the repository root
- **THEN** the report completes and states that the corpus is absent

#### Scenario: An unreadable file is named and skipped

- **WHEN** one file in a corpus cannot be read
- **THEN** the report names it as unreadable and computes every indicator from the remaining files

### Requirement: A torn line costs one record, never the file

A corpus line that cannot be parsed SHALL be skipped and counted, and SHALL NOT prevent the remaining lines of that file from being read.

#### Scenario: A truncated final line is skipped

- **WHEN** a corpus file's final line was truncated mid-write
- **THEN** every earlier record in that file is read and the skipped line is counted

### Requirement: Metrics files are classified by schema, not by filename

A metrics file SHALL be classified by its declared schema. A file whose schema is not recognized SHALL be counted as unrecognized, identified by name, and excluded from every indicator — including when its filename matches the pattern of a recognized file.

#### Scenario: A skill-written file with a matching filename prefix is excluded

- **WHEN** a metrics file's name shares a prefix with the review-metrics naming pattern but the file declares no recognized schema
- **THEN** it is counted as unrecognized and contributes to no indicator

#### Scenario: Unrecognized files are surfaced, not silently dropped

- **WHEN** the metrics corpus contains unrecognized files
- **THEN** the report states how many and names them

### Requirement: The scan is bounded and truncation is reported

The number of trajectory files opened in one invocation SHALL be bounded by a published cap. When the bound is reached, the report SHALL state that the scan was truncated and how many files were not read. It SHALL NOT sample silently.

#### Scenario: Reaching the bound is stated in the output

- **WHEN** more trajectory files exist than the cap permits
- **THEN** the report states that the scan was truncated and how many files were skipped

#### Scenario: The cap is published rather than restated

- **WHEN** a reader asks what the scan bound is
- **THEN** the bound is obtainable from the published limits, and is not restated as a literal number in prose

### Requirement: The report writes nothing

The report SHALL create, modify and delete no file, including no cache and no index.

#### Scenario: A read-only checkout produces a full report

- **WHEN** the report runs against a checkout in which nothing may be written
- **THEN** it completes and produces every indicator the corpora support

### Requirement: The window and change filters restrict the record set only

When a window or a change filter is supplied, records outside it SHALL be excluded from every indicator and from every denominator, and the report SHALL state the filter it applied.

#### Scenario: A window narrows the denominators

- **WHEN** a window excludes some records
- **THEN** the excluded records contribute to no value and to no denominator

#### Scenario: The applied filter is stated

- **WHEN** a filter is supplied
- **THEN** the report states which filter it applied

### Requirement: The output declares its own schema version

The machine-readable output SHALL carry a schema version, so a later change to an indicator's definition is legible to a reader comparing two reports.

#### Scenario: Machine-readable output is versioned

- **WHEN** the report is requested in machine-readable form
- **THEN** the payload declares a schema version

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
