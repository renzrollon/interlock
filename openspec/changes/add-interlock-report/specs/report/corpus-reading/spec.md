## Purpose

Defines how the report reads the three corpora Interlock writes — classification, damage tolerance, scan bounds, and the absolute prohibition on writing — so a reader that runs against a torn, heterogeneous or oversized corpus produces a report rather than an exception.

## ADDED Requirements

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
