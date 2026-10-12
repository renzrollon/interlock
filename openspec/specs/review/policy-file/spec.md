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

### Requirement: A glob-shaped item in an enforced path list SHALL be a reported problem and SHALL NOT be read as a path

An item of `## Do Not Report` or `## Always Human Review` that contains `*` or `?` SHALL be reported as a problem and SHALL NOT be added to the list. The problem SHALL name the section it was found in and the item, and SHALL say that only a path or a directory prefix is read. Square brackets and braces are characters a path may hold and SHALL be read as part of the path. At the merge verdict, such a problem in the always-human-review section committed at the base SHALL read the human-paths signal amber, marked as needing a person, as any other problem in that section does; the same problem in the do-not-report section SHALL NOT move the human-paths signal.

Rationale: the lists hold prefixes, not patterns. A pattern read as a literal path matches no file, so `- src/**` under `## Always Human Review` listed nothing, said nothing, and every path under it read as not needing a person. The merge verdict tells the two sections' problems apart by the section each names, so the problem has to say which it is.

#### Scenario: Happy path — a directory prefix covers the files under it

- **GIVEN** an always-human-review section listing `src/`
- **WHEN** a change touches a file under that directory and the merge confidence is assessed against that base
- **THEN** the human-paths signal is amber, marked as needing a person, naming the listed path

#### Scenario: Failure — a pattern is reported and never silently matches nothing

- **GIVEN** an always-human-review section committed at the base whose only item is `src/**`
- **WHEN** the policy is parsed, and the merge confidence is assessed for a change under that directory
- **THEN** the parse reports the item as a pattern in `Always Human Review` that was not read as a path
- **AND** the human-paths signal is amber, marked as needing a person, naming the item; it is not green

#### Scenario: Edge case — brackets are a path, and a pattern in the other list moves nothing at the merge verdict

- **GIVEN** an always-human-review item `app/[id]/` and, committed at the base, a do-not-report item `docs/*.md`
- **WHEN** the policy is parsed, and the merge confidence is assessed against that base for a change that touches neither path
- **THEN** the first is read as a path with no problem reported
- **AND** the second is reported as a pattern in `Do Not Report`, and no finding is dropped on its account
- **AND** the human-paths signal is green
