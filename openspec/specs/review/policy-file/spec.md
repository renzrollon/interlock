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

### Requirement: With a base reference, the counts-as-source list SHALL be read from the base

With a base reference, the merge verdict and `interlock review-policy` SHALL read the counts-as-source list from the `REVIEW.md` committed at that reference, as they read the always-human-review list, so a change cannot edit the list applied to it. A `REVIEW.md` absent at the reference SHALL declare no such path, without a problem. Without a base reference the policy command SHALL read the list from the working tree.

#### Scenario: Happy path — a pull request cannot take its own prose out of the count

- **GIVEN** a base whose `REVIEW.md` lists `skills/` under `## Counts as Source`, a working tree whose `REVIEW.md` no longer lists it, and a change to `skills/settle/SKILL.md` of more lines than the published line cap
- **WHEN** the merge confidence is assessed with that base
- **THEN** the diff-shape signal is amber, and its evidence names `skills/` and the reference the list was read from
- **AND** the human-paths signal is amber, because the policy file was edited

#### Scenario: Failure — a list the change adds is not applied to it

- **GIVEN** a base whose `REVIEW.md` has no `## Counts as Source` section, a working tree whose `REVIEW.md` lists `skills/` there, and a change to `skills/settle/SKILL.md`
- **WHEN** the merge confidence is assessed with that base, and `interlock review-policy --base <ref> --json` is run
- **THEN** the diff-shape signal counts the file as prose
- **AND** the policy command lists no counts-as-source path and says the working copy differs from the reference

#### Scenario: Edge case — absent at the base, and no base given

- **GIVEN** a reference with no `REVIEW.md` while the working tree's lists `skills/` under `## Counts as Source`, and a second invocation with no reference
- **WHEN** `interlock review-policy --json` is run with the reference, and again without one
- **THEN** the first lists no counts-as-source path and reports no problem
- **AND** the second lists `skills` from the working tree

### Requirement: Declared counts-as-source paths SHALL be parsed like the other path lists and SHALL be read by the size signal and the proof of coverage alone

A `REVIEW.md` MAY declare a `## Counts as Source` section. Its paths SHALL be parsed with the grammar, the canonical path form and the problem reporting of the other two path lists, a pattern item included. The list SHALL be scope, not a threshold: it SHALL move no finding, no survival or gate decision, and no merge signal other than `diff.shape` and `review.ran`, and a problem in it SHALL NOT move the human-paths signal. The policy command SHALL print the list beside the other two.

#### Scenario: Happy path — a declared section is parsed and printed

- **GIVEN** a `REVIEW.md` whose `## Counts as Source` section lists `- skills/` and `- ./agents`
- **WHEN** the policy is read with `interlock review-policy --json`, and again without `--json`
- **THEN** the JSON output lists `skills` and `agents` in canonical form under `sourcePaths`
- **AND** the text output prints the list on its own line beside the exclusions and the always-human-review list
- **AND** the exclusions, the always-human-review list and the prose are unchanged by the section's presence

#### Scenario: Failure — a malformed section is reported and declares nothing

- **GIVEN** three policy files whose `## Counts as Source` section holds, in turn, prose and no list item, the item `- ../outside`, and the item `- skills/**`
- **WHEN** each policy is read
- **THEN** the first reports that the section has content and no path list items, and declares no path
- **AND** the second reports `../outside` as not a repository-relative path, and declares no path for it
- **AND** the third reports the item as a pattern in `Counts as Source` that was not read as a path

#### Scenario: Edge case — the list moves no finding and no gate

- **GIVEN** a base whose `REVIEW.md` lists `skills/` under `## Counts as Source` and nothing under the other two lists, a surviving blocker on `skills/settle/SKILL.md`, and a change whose only changed path is that file
- **WHEN** `interlock review` decides survival, `interlock gate` evaluates the result, and the merge confidence is assessed with that base
- **THEN** the blocker survives and the gate blocks exactly as with no such section
- **AND** the risk signal and the human-paths signal read what they read with no such section

#### Scenario: Edge case — a problem in the section does not move the human-paths signal

- **GIVEN** a base whose `## Counts as Source` section holds the item `skills/**` and whose `## Always Human Review` section lists `lib/release/`, and a change that touches no path under `lib/release/`
- **WHEN** the merge confidence is assessed with that base
- **THEN** the human-paths signal is green
- **AND** the problem is named by the diff-shape signal's evidence and by no other signal

### Requirement: The counts-as-source list SHALL reach `review.ran` only through the proof of coverage, and only to keep an entry unread

The proof of coverage SHALL read the list to class the changed files an `unread` entry names. An entry naming a file under a listed path SHALL stay under `proof.unread`. The list SHALL never cause an entry to be listed apart, and SHALL move `review.ran` in no other way.

#### Scenario: Happy path — a listed path keeps a skipped skill file amber

- **GIVEN** a base whose `REVIEW.md` lists `skills/` under `## Counts as Source`, and a review whose only gap is an `unread` entry naming the changed file `skills/settle/SKILL.md`
- **WHEN** the review is recorded with that base and the merge confidence is assessed
- **THEN** the entry is under `proof.unread`, the ran signal is amber, and it carries no `prose-unread` flag

#### Scenario: Failure — removing an item in the change does not lift the change's own review

- **GIVEN** the same base and review, on a head whose `REVIEW.md` no longer lists `skills/`
- **WHEN** the review is recorded with that base
- **THEN** the entry is still under `proof.unread`

#### Scenario: Edge case — with no list, a path is classed by the path rule alone

- **GIVEN** a base with no `REVIEW.md`, and a review whose only gap is an `unread` entry naming the changed file `docs/guide.md`
- **WHEN** the review is recorded with that base and the merge confidence is assessed
- **THEN** the entry is under `proof.proseUnread`, and the ran signal is green with the `prose-unread` flag

#### Scenario: Edge case — a file that is prose by its extension alone is listed apart until the base lists it

- **GIVEN** a base whose `REVIEW.md` has no `## Counts as Source` section, and a review whose only gap is an `unread` entry naming the changed file `requirements.txt`
- **WHEN** the review is recorded with that base and the merge confidence is assessed
- **THEN** the entry is under `proof.proseUnread`, and the ran signal is green with the `prose-unread` flag
- **AND** with a base that lists `requirements.txt` under `## Counts as Source`, the entry is under `proof.unread`, and the ran signal is amber with no `prose-unread` flag

### Requirement: `REVIEW.md` SHALL declare artifact-review lenses and checks under two known headings, read from the base

`## Artifact Review Lenses` and `## Artifact Checks` SHALL each be a list of `- ` items: lens names, and one-line checks. With a base reference both SHALL be read from the base, as the path lists are, and without one from the working tree. A threshold-shaped item SHALL be a reported problem and never read. `interlock review-policy` SHALL print the lens names and the number of checks, and its JSON SHALL carry `artifactLenses` and `artifactChecks`.

#### Scenario: Happy path — both sections are parsed and printed

- **GIVEN** a `REVIEW.md` with `## Artifact Review Lenses` listing `agentic-harness` and `## Artifact Checks` listing two lines
- **WHEN** `interlock review-policy --json` runs
- **THEN** `artifactLenses` is `["agentic-harness"]` and `artifactChecks` holds the two lines in file order
- **AND** the text output carries one line naming the lens and one counting two checks

#### Scenario: Failure — a check added in the working copy is not read from the base

- **GIVEN** a `REVIEW.md` at HEAD with one Artifact Check and a working copy with two
- **WHEN** `interlock review-policy --base HEAD --json` runs
- **THEN** `artifactChecks` holds the one check from HEAD, and the output says `REVIEW.md` differs from HEAD

#### Scenario: Edge case — a threshold-shaped item is refused

- **GIVEN** an `## Artifact Checks` list holding `- nitCap: 0` and one ordinary check
- **WHEN** the policy is parsed
- **THEN** `artifactChecks` holds the ordinary check alone, and `problems` names the threshold-shaped item as ignored

#### Scenario: Edge case — a section with text but no list items declares nothing

- **GIVEN** an `## Artifact Review Lenses` section holding a paragraph and no `- ` item
- **WHEN** the policy is parsed
- **THEN** `artifactLenses` is empty and `problems` says the section has content but no list items

#### Scenario: Edge case — the shipped template parses clean and declares nothing

- **GIVEN** `skills/review-code/REVIEW.template.md` as shipped
- **WHEN** it is parsed
- **THEN** it holds both artifact headings, `problems` is empty, and `artifactLenses` and `artifactChecks` are empty

### Requirement: An artifact-section item SHALL be read as written, never as a path or a pattern

An item of `## Artifact Review Lenses` or `## Artifact Checks` SHALL be read as the text it holds. It SHALL not be canonicalized as a path, and an item holding `?` or `*` SHALL not be refused as a pattern, so a check may ask a question or name a glob.

#### Scenario: Edge case — a check written as a question is read

- **GIVEN** an `## Artifact Checks` list holding `- Does every task name its verification?` and `- Is lib/*.mjs free of node: imports?`
- **WHEN** the policy is parsed
- **THEN** `artifactChecks` holds both lines as written, and `problems` is empty

### Requirement: A heading that names an artifact section but is not a known one SHALL be a reported problem

A `##` heading SHALL be a misnamed artifact heading when it is neither of the two known artifact headings, its normalized words hold `artifact` or `artifacts` together with `lens`, `lenses`, `check`, `checks` or `review`, and its last word is not `rationale`. A misnamed artifact heading SHALL add a problem that names the heading and the two known ones, and SHALL declare nothing. Every other unknown heading SHALL stay ignored.

#### Scenario: Failure — a misnamed heading is reported

- **GIVEN** a `REVIEW.md` with `## Artifact Lenses` listing `agentic-harness`
- **WHEN** `interlock review-policy --json` runs
- **THEN** `artifactLenses` is empty and `problems` names `Artifact Lenses` and the known headings `Artifact Review Lenses` and `Artifact Checks`

#### Scenario: Failure — a plural misspelling is reported too

- **GIVEN** a `REVIEW.md` with `## Artifacts Checks`
- **WHEN** the policy is parsed
- **THEN** `problems` names `Artifacts Checks` and the two known headings

#### Scenario: Edge case — an unrelated unknown heading stays ignored

- **GIVEN** a `REVIEW.md` with a `## Notes` section
- **WHEN** the policy is parsed
- **THEN** no problem names it, as before this change

#### Scenario: Edge case — a rationale heading stays ignored

- **GIVEN** a `REVIEW.md` with `## Artifact checks rationale` holding a paragraph, beside `## Always-human rationale`
- **WHEN** the policy is parsed
- **THEN** no problem names either heading

### Requirement: A problem the artifact sections report SHALL leave the proof of coverage and the merge verdict as they were

`sectionOfProblem` SHALL answer `artifact` for every problem `## Artifact Review Lenses`, `## Artifact Checks` or a misnamed artifact heading reports. `proofSourcePaths` SHALL keep the counts-as-source list beside an `artifact` problem, and the merge verdict's human-paths signal SHALL not read one. A threshold-shaped line written without a list marker SHALL stay a problem of no section, as it is in every other section.

#### Scenario: Happy path — an artifact-section problem is classed as its own section

- **GIVEN** each problem a malformed `## Artifact Review Lenses`, a malformed `## Artifact Checks` and an `## Artifact Lenses` heading report, as is and labelled with the copy it came from
- **WHEN** `sectionOfProblem` reads each
- **THEN** it answers `artifact` for every one

#### Scenario: Failure — a misnamed artifact heading leaves the proof's source list in place

- **GIVEN** a `REVIEW.md` holding `## Counts as Source` with `- skills/` and an `## Artifact Lenses` heading
- **WHEN** `proofSourcePaths` reads the parsed policy
- **THEN** it answers `["skills"]`, not `null`

#### Scenario: Failure — a misnamed artifact heading at the base does not make the merge verdict ask for a person

- **GIVEN** a base `REVIEW.md` holding `## Always Human Review` with `- lib/release/` and an `## Artifact Lenses` heading, and a change that touches no path under `lib/release/`
- **WHEN** `interlock merge-confidence --base <ref>` runs
- **THEN** the `policy.humanPaths` signal reads as it does without the misnamed heading, and its problems do not include the heading's

#### Scenario: Edge case — a problem in Counts as Source still drops the list

- **GIVEN** a `REVIEW.md` holding `## Counts as Source` with `- skills/**` beside an `## Artifact Checks` list
- **WHEN** `proofSourcePaths` reads the parsed policy
- **THEN** it answers `null`, as before this change
