# report/html-surface Specification

## Purpose
Gives the accumulated corpora a surface a person can scan rather than parse — one self-contained HTML document derived from the same report object the text and JSON surfaces render, so that gaining a visual medium never gains a verdict, a threshold, or a claim the corpora do not support.

## Requirements

### Requirement: The HTML surface renders the same report object

The HTML SHALL be rendered from the same report object that the text and machine-readable surfaces render. No indicator SHALL be computed, re-derived, rounded differently, or omitted during rendering.

#### Scenario: Every indicator present in the report object appears in the document

- **WHEN** the HTML is rendered from a report object
- **THEN** every indicator the object carries is present in the document

#### Scenario: The three surfaces cannot disagree about a value

- **WHEN** the same report object is rendered to text, to machine-readable output and to HTML
- **THEN** each indicator carries the same value and the same denominator in all three

### Requirement: The document is self-contained

The document SHALL be a single file that renders with no network access. It SHALL NOT reference an external stylesheet, script, font, image or data source, and SHALL NOT require a server, a build step, or a runtime dependency to display.

#### Scenario: Rendering offline produces the complete document

- **WHEN** the document is opened with no network available
- **THEN** it renders completely, including its layout and any graphics

#### Scenario: No external reference appears in the document

- **WHEN** the document is inspected for outbound references
- **THEN** it contains no reference resolving to a host, and every style and graphic is inline

### Requirement: Absence is rendered as prominently as a value

An indicator that is unobserved or not computable SHALL be rendered with the same visual weight as one carrying a value, together with the reason the report gives for it. It SHALL NOT be omitted, collapsed behind an interaction, greyed out, rendered as a zero, or rendered as an empty cell.

#### Scenario: An unobserved indicator states its reason

- **WHEN** an indicator is unobserved
- **THEN** the document renders it with its reason, at the same visual weight as an indicator carrying a value

#### Scenario: Absence is never rendered as zero

- **WHEN** an indicator is unobserved
- **THEN** the document does not render a numeral in its place

#### Scenario: A wholly empty corpus still yields a readable document

- **WHEN** every indicator is unobserved
- **THEN** the document renders, states that the corpora are empty, and states why each indicator is unobserved

### Requirement: Coverage precedes the indicators

The document SHALL present the corpus coverage — what was scanned, what was recognized, and what was excluded — before any indicator, so that a reader learns what the figures rest on before reading a figure.

#### Scenario: Coverage is the first substantive section

- **WHEN** the document is read from the top
- **THEN** the coverage of the corpora is reached before the first indicator

#### Scenario: Excluded files are named in the document

- **WHEN** the report excluded files as unrecognized or unreadable
- **THEN** the document names them rather than reporting only a count

### Requirement: The visual medium issues no verdict

The document SHALL NOT render a threshold, a target, a goal line, a pass or fail label, a trend arrow, or a colour that encodes health. Colour and emphasis SHALL carry structure and reading order only.

#### Scenario: No indicator is coloured by its value

- **WHEN** an indicator carries a value
- **THEN** its colour and emphasis are the same as every other indicator's, whatever that value is

#### Scenario: No threshold or target is drawn

- **WHEN** a figure is rendered graphically
- **THEN** no threshold line, target marker or acceptable range is drawn alongside it

#### Scenario: Rendering does not introduce a comparison

- **WHEN** the document is produced
- **THEN** it contains no comparison of an indicator against a value the report object did not itself carry

### Requirement: Producing the document exits zero and writes only where told

Producing the HTML SHALL exit zero on every invocation in which a document was produced, including when every indicator is unobserved. It SHALL write only to the destination the caller named, and SHALL NOT write into any corpus.

#### Scenario: An empty corpus still exits zero

- **WHEN** the document is produced from empty corpora
- **THEN** the document is written and the exit status is zero

#### Scenario: Producing the document leaves the corpora unchanged

- **WHEN** the document has been produced
- **THEN** no corpus file has been created, modified or removed

#### Scenario: An unwritable destination fails without a partial document

- **WHEN** the named destination cannot be written
- **THEN** the failure is reported and no partially written document is left at that path
