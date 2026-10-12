## ADDED Requirements

### Requirement: Declared always-human-review paths SHALL be parsed like do-not-report paths and enforced only by the merge verdict

A `REVIEW.md` MAY declare an `## Always Human Review` section. Its paths SHALL be parsed with the same list grammar and the same canonical path form as `## Do Not Report`, and a malformed block or a path that is not repository-relative SHALL be reported the same way. The list SHALL be scope, not a threshold: it SHALL NOT drop, add or re-band any finding, SHALL NOT change what `interlock review` or `interlock gate` decide, and SHALL be read only by the merge verdict, where a changed path under a listed path makes the change need a person. The policy command SHALL print the list beside the exclusions.

Rationale: some paths need a person whatever the evidence says (a release script, a CI workflow, the policy file itself). Saying so in the repository's own policy file keeps the decision versioned and owned, and keeping it out of the review keeps one fact from moving two gates.

#### Scenario: Happy path — a declared section is parsed and printed

- **GIVEN** a `REVIEW.md` whose `## Always Human Review` section lists `- lib/release/` and `- .github/workflows/`
- **WHEN** the policy is read with `interlock review-policy --json`
- **THEN** the output lists both paths in canonical form as always-human-review paths
- **AND** the exclusions and the prose are unchanged by the section's presence

#### Scenario: Failure — a malformed section is reported and applies nothing

- **GIVEN** a `## Always Human Review` section that holds prose and no list item, and a second file whose section lists `- ../outside`
- **WHEN** each policy is read
- **THEN** the first reports that the section has content but no path list items and declares no paths
- **AND** the second reports `../outside` as not a repository-relative path, and declares no path for it

#### Scenario: Edge case — the list never moves a finding

- **GIVEN** a `REVIEW.md` listing `lib/release/` as always-human-review, and a surviving blocker on `lib/release/publish.mjs`
- **WHEN** `interlock review` decides survival and `interlock gate` evaluates the result
- **THEN** the blocker survives and the gate blocks exactly as with no such section
- **AND** a path spelled `./lib/release` in the section matches `lib/release/publish.mjs` on the canonical form, as an exclusion would

### Requirement: With a base reference, the enforced path lists SHALL be read from the base and the prose from the working tree, and a difference SHALL be reported

When `interlock review` or `interlock review-policy` is given a base reference, the do-not-report and always-human-review lists SHALL be read from the `REVIEW.md` committed at that reference, and the advice prose SHALL be read from the working tree. A reference that does not name a commit SHALL end the command with exit 1 before any review is decided. A `REVIEW.md` absent at the reference SHALL declare no lists, without a problem, as an absent file does. A committed copy larger than the policy scan cap SHALL be reported and not parsed, as an oversized working copy is. When the working-tree copy differs from the committed copy, ignoring line-ending differences, the output SHALL say so and name the reference whose lists were applied. Problems SHALL be reported with the copy they came from. Without a base reference, both commands SHALL read the working tree exactly as before.

Rationale: an exclusion list the pull request can edit is not an exclusion list. The prose is advice that cannot relax the gate, so reading the copy the change proposes costs nothing and keeps a reviewer's context current; any edit to the file is still visible.

#### Scenario: Happy path — a pull request cannot exclude its own paths

- **GIVEN** a base reference whose `REVIEW.md` excludes only `dist/`, a working tree whose `REVIEW.md` also excludes `lib/`, and a surviving blocker on `lib/a.mjs`
- **WHEN** `interlock review --base <ref>` decides survival
- **THEN** the blocker on `lib/a.mjs` survives, because the lists were read from the reference
- **AND** the output says the working-tree `REVIEW.md` differs from the reference and that the reference's lists were applied

#### Scenario: Failure — a reference that names no commit

- **GIVEN** a base reference that does not resolve to a commit
- **WHEN** `interlock review --base <ref>` runs
- **THEN** it exits 1 naming the reference
- **AND** no review result is printed

#### Scenario: Edge case — absent at the base, differing only in line endings, and no base given

- **GIVEN** a reference with no `REVIEW.md` while the working tree has one, a second reference whose `REVIEW.md` differs from the working copy only in line endings, and a third invocation with no reference
- **WHEN** the policy is read in each case
- **THEN** the first declares no lists and reports no problem, and says the working copy differs from the reference
- **AND** the second reports no difference
- **AND** the third reads prose and lists from the working tree, identical to the behaviour before this requirement

### Requirement: A ship run SHALL read the enforced path lists from the commit it started on

`run start` SHALL record the commit the run started on. The run's review adjudication SHALL read the do-not-report list from the `REVIEW.md` committed at that commit, and its reviewer briefings SHALL keep reading the prose from the working tree. When the working-tree copy differs from the start commit's, the run SHALL raise `POLICY DIFFERS FROM BASE` naming the file and the commit whose lists were applied, and the banner SHALL reach the close summary. When no start commit could be recorded, the adjudication SHALL read the working tree and the run SHALL raise `REVIEW BASE NOT PINNED` once, with the reason, naming every input it read from the working tree instead (the `REVIEW.md` lists, and the living requirements when the domain dimension runs) and reaching the close summary. No driver SHALL pass or read the commit.

Rationale: the run must not be able to quiet its own review; the commit it started on is the one base every run has, and a pull request's own base is applied when the pull request is reviewed with a base reference.

#### Scenario: Happy path — an unchanged policy raises nothing

- **GIVEN** a run started on a commit whose `REVIEW.md` excludes `test/fixtures/`, and a working tree whose copy is identical
- **WHEN** the run's review is adjudicated
- **THEN** findings under `test/fixtures/` are dropped by the policy filter
- **AND** no policy banner is raised

#### Scenario: Failure — a working copy that adds an exclusion is not applied

- **GIVEN** a run started on a commit whose `REVIEW.md` excludes nothing, and a working tree whose copy excludes `lib/`, with a surviving blocker on `lib/a.mjs`
- **WHEN** the run's review is adjudicated
- **THEN** the blocker survives
- **AND** the run raises `POLICY DIFFERS FROM BASE` naming `REVIEW.md` and the start commit, and the banner appears in the close summary

#### Scenario: Edge case — prose still comes from the working tree, and no start commit

- **GIVEN** one run whose working-tree `REVIEW.md` is uncommitted and defines "Important", and another run in a repository with no commit to record
- **WHEN** each run emits its review step and adjudicates
- **THEN** the first run's reviewer briefing carries the working-tree prose, and its adjudication applies the start commit's lists
- **AND** the second run reads the working tree for both and raises `REVIEW BASE NOT PINNED` once, with the reason and the inputs read from the working tree, and the banner appears in the close summary

## MODIFIED Requirements

### Requirement: The policy file SHALL NOT be able to change the survival arithmetic

`REVIEW.md` SHALL NOT be a place to set the numeric quality band or the nit cap. Those values remain owned by the CLI. The policy file controls scope (which paths are reviewed, and which need a person) and advice (prose), not the thresholds that decide how many findings survive. A threshold-shaped line SHALL be reported and ignored wherever it appears in the file, including as a list item inside a path section, where it SHALL NOT be read as a path.

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

#### Scenario: Edge case — a threshold-shaped list item is not a path

- **GIVEN** a `## Do Not Report` section and an `## Always Human Review` section, each holding the list item `- nitCap: 0` beside a valid path
- **WHEN** the file is parsed
- **THEN** each section reports the item as a threshold-shaped line that was ignored
- **AND** neither section declares `nitCap: 0` as a path, and the valid paths are still declared
