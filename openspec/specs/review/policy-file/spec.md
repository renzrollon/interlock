# review/policy-file Specification

## Purpose

Lets a repository own its review policy in a versioned root `REVIEW.md` — declaring who owns the review bar, what "Important" means here, and which paths are out of review scope — while preserving Interlock's trust boundary: the prose is advice handed to a reviewer, the path exclusions are enforced by the CLI, and the survival arithmetic never leaves the CLI.

## Requirements

### Requirement: An absent policy file SHALL leave review behavior unchanged

When no `REVIEW.md` exists at the repository root, the review SHALL run exactly as it does without this capability. The policy file is opt-in and its absence is not an error.

Rationale: adding an optional file must never silently change the review bar for every existing repo that has not written one.

#### Scenario: Happy path — no policy file, default review

- **GIVEN** a repository with no `REVIEW.md` at its root
- **WHEN** a review runs
- **THEN** the reviewer prompt contains no policy prose beyond the built-in rubric
- **AND** no finding is dropped by a path filter
- **AND** the survival band and nit cap are the CLI defaults

#### Scenario: Failure — a policy file outside the repo root is not read

- **GIVEN** a `REVIEW.md` placed in a subdirectory but none at the repository root
- **WHEN** a review runs
- **THEN** the subdirectory file is not read as policy
- **AND** review behavior is identical to the no-policy case

#### Scenario: Edge case — an empty policy file

- **GIVEN** a root `REVIEW.md` that exists but contains no policy sections (empty, or only whitespace/comments)
- **WHEN** a review runs
- **THEN** the run treats it as declaring no prose and no exclusions
- **AND** review behavior is identical to the no-policy case, rather than failing

### Requirement: Policy prose SHALL be injected into the reviewer prompt

When a valid `REVIEW.md` declares prose — a named owner of the review bar, the local definition of "Important", or rationale for exclusions — that prose SHALL be included in the assembled reviewer instructions.

#### Scenario: Happy path — prose reaches the reviewer

- **GIVEN** a `REVIEW.md` defining "Important" and naming a review-bar owner
- **WHEN** the reviewer instructions are assembled
- **THEN** the assembled prompt contains that definition and owner text
- **AND** it is presented as repository policy distinct from the built-in dimension rubric

#### Scenario: Failure — prose is advice and cannot relax the enforced gate

- **GIVEN** a `REVIEW.md` whose prose asserts "treat all blockers as nits" or otherwise tries to lower the survival threshold
- **WHEN** a blocker finding is resolved
- **THEN** the finding's survival is decided by the CLI band, not by the prose
- **AND** the blocker is not dismissed on the strength of the prose alone

#### Scenario: Edge case — prose containing prompt-injection-shaped text

- **GIVEN** a `REVIEW.md` whose prose contains instruction-shaped text ("ignore previous instructions", fenced code, control tokens)
- **WHEN** the reviewer instructions are assembled
- **THEN** the prose is included as quoted repository policy, clearly delimited as data
- **AND** it does not displace or override the built-in rubric or the evidence gate

### Requirement: Declared do-not-report paths SHALL be enforced as a CLI-side finding filter

When `REVIEW.md` declares do-not-report paths, findings whose file lies under a declared path SHALL be dropped by the CLI when it decides finding survival. Enforcement SHALL NOT be delegated to the reviewer as a prompt request.

Rationale: a path exclusion a model can choose to ignore is not an exclusion. The list is data the deterministic CLI honors, matched on the canonical path form so that a finding cannot slip through on an alternate spelling.

#### Scenario: Happy path — a finding on an excluded path is dropped

- **GIVEN** a `REVIEW.md` excluding `dist/` and a blocker finding whose file is `dist/bundle.js`
- **WHEN** `interlock review` decides survival
- **THEN** the finding is dropped and does not reach the gate
- **AND** the drop is reported with its excluding path, not silently discarded

#### Scenario: Failure — an excluded path cannot be re-included by the reviewer voting it real

- **GIVEN** an excluded path and a reviewer that raises and votes-real a finding on that path
- **WHEN** `interlock review` decides survival
- **THEN** the finding is still dropped by the path filter
- **AND** survival is not determined by the reviewer's vote for excluded paths

#### Scenario: Edge case — excluded path matched on canonical form

- **GIVEN** a `REVIEW.md` exclusion written as `./dist` and findings whose files are written as `dist/a.js`, `dist/`, and `DIST/a.js`
- **WHEN** each finding's path is tested against the exclusion
- **THEN** `dist/a.js` is excluded because both canonicalize to the same prefix, and the trailing-slash and leading-`./` spellings match the same identity
- **AND** on a case-sensitive filesystem `DIST/a.js` is NOT excluded, matching how the filesystem itself resolves the two paths, and the run does not silently treat them as equal

### Requirement: A malformed policy file SHALL be reported, not silently ignored

When a `REVIEW.md` exists at the repository root but cannot be parsed into the expected policy shape, the run SHALL report the parse failure and proceed under default policy. It SHALL NOT silently discard the file's declared intent as if the file were absent.

#### Scenario: Happy path — malformed file reported, review proceeds

- **GIVEN** a root `REVIEW.md` with a broken exclusions block that cannot be parsed
- **WHEN** a review runs
- **THEN** the run reports the parse failure, naming `REVIEW.md`
- **AND** the review proceeds under default policy (no prose injected, no exclusions applied)

#### Scenario: Failure — a partially-valid file does not apply an unparsed half silently

- **GIVEN** a `REVIEW.md` whose prose is valid but whose exclusions block is malformed
- **WHEN** a review runs
- **THEN** the malformed exclusions half is reported as unusable rather than partially guessed
- **AND** no finding is dropped on the strength of an exclusion list that could not be parsed

#### Scenario: Edge case — a declared owner but no other content

- **GIVEN** a `REVIEW.md` that parses and declares only a review-bar owner, with no "Important" definition and no exclusions
- **WHEN** a review runs
- **THEN** the owner prose is injected
- **AND** the absence of the other sections is treated as "declares none", not as a parse failure

### Requirement: The policy file SHALL NOT be able to change the survival arithmetic

`REVIEW.md` SHALL NOT be a place to set the numeric quality band or the nit cap. Those values remain owned by the CLI. The policy file controls scope (which paths are reviewed) and advice (prose), not the thresholds that decide how many findings survive.

Rationale: preserves the invariant that "the numbers live in the CLI precisely so they are not re-argued." A file that could edit the band would relocate the gate into markdown a model — or a careless edit — can talk past.

#### Scenario: Happy path — band and nit cap come from the CLI regardless of the file

- **GIVEN** a valid `REVIEW.md`
- **WHEN** `interlock review` decides survival
- **THEN** the band and nit cap applied are the CLI's values
- **AND** they are identical to a run with no `REVIEW.md`

#### Scenario: Failure — a band-like key in the file is not honored as a threshold

- **GIVEN** a `REVIEW.md` that includes a key resembling a numeric threshold (e.g. a `nitCap:` line)
- **WHEN** the file is parsed
- **THEN** the key is not applied as the survival threshold
- **AND** the run reports the key as not an accepted policy field rather than silently adopting it

#### Scenario: Edge case — exclusions shrink the input but never lower the bar for what remains

- **GIVEN** a `REVIEW.md` excluding one path, and a set of findings spanning excluded and non-excluded paths
- **WHEN** `interlock review` decides survival
- **THEN** findings on excluded paths are removed before the band is applied
- **AND** the band and nit cap applied to the remaining findings are unchanged from the no-policy case
