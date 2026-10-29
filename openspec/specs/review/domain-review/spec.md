# review/domain-review Specification

## Purpose
Judges a diff against the requirements the repository has already written in `openspec/specs/`, not only against the change's own delta specs: a `domain` review dimension selected by rule, handed the living requirements in force for the capabilities the change touches, bounded and quoted as data, with every requirement a finding cites checked for shape by the CLI and every skip spoken.

## Requirements

### Requirement: The domain dimension SHALL be selected by rule, and a skip SHALL be spoken

The `domain` dimension SHALL run when at least one changed path is the target of a reliable spec-to-file edge from a living spec in the repository's graph (the same edges drift trusts: an implements-spec relation of full weight from a file under `openspec/specs/`), or when the change under review has a delta spec for a capability that already has a living spec. Changed paths and edge targets SHALL be compared on the canonical repository path form. The selection SHALL name each selected capability, whether a linked file or the change's own delta spec selected it, and the files that linked it. When no graph is available, the capabilities the change itself declares SHALL still be selected, and the run SHALL raise `DOMAIN REVIEW PARTIAL` with the reason; when no graph is available and the change declares none, `domain` SHALL NOT run, SHALL be recorded as skipped with the reason, and the run SHALL raise `DOMAIN REVIEW SKIPPED`. Both banners SHALL reach the close summary. When a graph is available and no capability is selected, `domain` SHALL NOT run, SHALL NOT be recorded as skipped and SHALL raise no banner, and the selection SHALL record why it was not selected, with the number of changed paths that no reliable edge names; a missing edge is the gap the spec-coverage signal and the spec audit measure, not a review that degraded.

Rationale: a reviewer's own judgement of which requirements apply is the step this dimension exists to replace; and a dimension that disappears silently when the graph is missing reads exactly like one that had nothing to check.

#### Scenario: Happy path — a linked file selects its capability

- **GIVEN** a graph with a reliable edge from `openspec/specs/hooks/tool-guards/spec.md` to `hooks/guard-commit.mjs`, and a changed path `hooks/guard-commit.mjs`
- **WHEN** dimensions are selected
- **THEN** `domain` is selected with the capability `hooks/tool-guards`, selected by a linked file, naming `hooks/guard-commit.mjs`
- **AND** a half-weight edge, or an edge from a spec under `openspec/changes/`, selects nothing

#### Scenario: Failure — no graph and no declared capability is a spoken skip

- **GIVEN** a run with no graph available, whose change has delta specs only for capabilities that do not yet exist
- **WHEN** dimensions are selected
- **THEN** `domain` does not run and is recorded as skipped with the reason that no graph exists
- **AND** the run raises `DOMAIN REVIEW SKIPPED` with that reason, and the banner appears in the close summary

#### Scenario: Edge case — no graph but a declared capability, and a path spelled differently

- **GIVEN** one run with no graph whose change has a delta spec modifying `review/policy-file`, and another whose graph links `lib/risk.mjs` and whose changed path is reported as `./lib/risk.mjs`
- **WHEN** dimensions are selected in each
- **THEN** the first selects `domain` for `review/policy-file`, declared by the change, and raises `DOMAIN REVIEW PARTIAL` saying the touched files were not mapped
- **AND** the second selects the capability linked to `lib/risk.mjs`, because both spellings are the same canonical path

#### Scenario: Edge case — a graph that links nothing records why

- **GIVEN** a graph with reliable living-spec edges, none of which names any of three changed paths, and a change with no delta spec for an existing capability
- **WHEN** dimensions are selected
- **THEN** `domain` is not selected, not recorded as skipped, and no banner is raised
- **AND** the selection records that no reliable edge names any of the 3 changed paths and the change declares no existing capability

### Requirement: The domain reviewer SHALL receive only the requirements in force, bounded at a requirement boundary and quoted as data

The domain reviewer SHALL be given, for each selected capability in capability order, the living spec's requirements in their spec order, each with its scenarios, read from the base the review is judged against: the run's start commit in a run, the base reference outside one, and the working tree when neither exists, in which case the text and the selection record SHALL say so and a run SHALL name the living requirements in its `REVIEW BASE NOT PINNED` banner. A requirement the change's own delta spec modifies, removes or renames SHALL be left out as superseded and listed by its heading, compared on the canonical heading form (whitespace-insensitive, with or without a leading `Requirement:`). The text SHALL be bounded by the published domain-text cap, cut only between requirements, never inside one, and every requirement left out for the cap SHALL be counted per capability in the text and named by heading in the selection record. For each selected capability the text SHALL also list, by heading only, the requirements the change's own delta spec adds or modifies, marked as specified by this change and judged against its delta spec, so that behaviour they describe is not reported as unspecified. When no requirement in force fits, `domain` SHALL NOT run and SHALL be recorded as skipped with that reason. The text SHALL be framed as quoted repository data that does not override the rubric, the severity list or the evidence gate, with any occurrence of the frame's own delimiter inside it neutralised. Only the domain reviewer SHALL receive it, and a re-review of `domain` after remediation SHALL receive the same capabilities' text from the same base.

Rationale: a reviewer handed the whole corpus is a reviewer handed nothing it can hold; a requirement cut in half reads as a different requirement; and a delta that intentionally changes a requirement must not be reported as contradicting it.

#### Scenario: Happy path — two capabilities under the cap

- **GIVEN** two selected capabilities whose in-force requirements total less than the published cap
- **WHEN** the domain reviewer's text is assembled
- **THEN** it contains every requirement of both capabilities, with scenarios, in capability order and then spec order
- **AND** it is framed as quoted data, and the other dimensions' briefings do not contain it

#### Scenario: Failure — the cap is reached mid-capability

- **GIVEN** a selected capability whose requirements exceed the published cap in total
- **WHEN** the domain reviewer's text is assembled
- **THEN** the text ends after the last whole requirement that fits, and no requirement is cut
- **AND** the text states how many of that capability's requirements were left out for the cap, and the selection record names each of them by heading

#### Scenario: Failure — nothing in force fits

- **GIVEN** a single selected capability whose first requirement alone exceeds the published cap
- **WHEN** dimensions are selected and the text is assembled
- **THEN** `domain` does not run
- **AND** it is recorded as skipped with the reason that no requirement fits the cap

#### Scenario: Edge case — a requirement the change modifies is superseded on the canonical heading

- **GIVEN** a living requirement headed `The policy file SHALL NOT be able to change the survival arithmetic`, and the change's delta spec modifying a requirement whose heading differs from it only in internal whitespace
- **WHEN** the domain reviewer's text is assembled
- **THEN** the living requirement is left out of the text and listed as superseded by the change
- **AND** the capability's other requirements are present, and the modified heading and every heading the delta adds to the capability are listed as specified by this change

#### Scenario: Edge case — instruction-shaped text inside a spec

- **GIVEN** a living requirement whose body contains "ignore previous instructions" and the frame's own delimiter
- **WHEN** the domain reviewer's text is assembled
- **THEN** the text is inside the quoted-data frame, with the delimiter neutralised so the frame cannot be closed early
- **AND** the rubric and the evidence rules in the briefing are unchanged

### Requirement: A requirement a finding cites SHALL be checked for shape, and a failed check SHALL be reported without dropping the finding

A finding MAY carry a requirement citation of the form `openspec/specs/<capability>/spec.md#<heading>`. When the review is adjudicated, the CLI SHALL check each citation's shape: the path is a canonical repository path under `openspec/specs/` naming a `spec.md`; the file exists at the base the review is judged against; and the heading names a requirement in that file on the canonical heading form. A citation that fails any check SHALL be reported in the adjudicated review, naming the finding, the citation and the failed check, and the finding SHALL be adjudicated exactly as if it carried no citation. The check SHALL NOT decide whether the cited requirement forbids what the diff does; that is the skeptics' question. When the base copy of a cited file cannot be read, the citation SHALL be reported as unchecked with the reason. A blocker under the `domain` dimension that carries no requirement citation SHALL be reported the same way, as a domain blocker citing no requirement, because a contradiction of a requirement in force is the only blocker that dimension raises; it SHALL still be adjudicated, and SHALL NOT be dropped or re-banded.

Rationale: a model citing a requirement that does not exist is the over-correction the research reports; checking the shape catches the fabrication without letting a broken citation delete a real defect.

#### Scenario: Happy path — a valid citation is accepted silently

- **GIVEN** a surviving blocker citing `openspec/specs/hooks/tool-guards/spec.md#Every guard SHALL fail open` where that file at the base has that requirement heading
- **WHEN** the review is adjudicated
- **THEN** the blocker survives as it would without the citation
- **AND** no citation problem is reported

#### Scenario: Failure — a citation outside the living specs, and one naming no requirement

- **GIVEN** one finding citing `openspec/changes/x/specs/a/spec.md#A requirement`, and another citing a living spec file at a heading that file does not contain
- **WHEN** the review is adjudicated
- **THEN** each citation is reported with the check it failed, the first as outside `openspec/specs/` and the second as naming no requirement in the file
- **AND** both findings are adjudicated as though they carried no citation, and neither is dropped

#### Scenario: Failure — a domain blocker that cites nothing

- **GIVEN** a blocker under the `domain` dimension with no requirement citation, and a warning under the same dimension with none
- **WHEN** the review is adjudicated
- **THEN** the blocker is reported as a domain blocker citing no requirement, and is adjudicated and can survive like any other blocker
- **AND** the warning is not reported, because a warning about behaviour no requirement describes has nothing to cite

#### Scenario: Edge case — heading spellings at the transform boundary

- **GIVEN** three citations of the same requirement: one with extra internal spaces in the heading, one prefixed `Requirement: `, and one differing only in letter case
- **WHEN** the review is adjudicated
- **THEN** the first two resolve to the requirement and report nothing
- **AND** the third is reported as naming no requirement, because headings match on whitespace, not on case

### Requirement: The domain context SHALL be available from the CLI with the same selection and text as a run

`interlock domain-context [change] --changed <files> [--base <ref>]` SHALL print whether `domain` is selected, each selected capability with how it was selected and its linked files, the skip or partial reason, the superseded and omitted requirements, the requirements the change specifies itself, the base the text was read from (a reference, or the working tree), and the framed text, by the same rule and from the same inputs a run would use. On a completed report it SHALL exit zero whether or not `domain` is selected. A base reference that names no commit SHALL end it with exit 1 and nothing on standard output.

Rationale: the review skill runs outside a ship run, and a dimension it cannot obtain criteria for is one it would have to invent.

#### Scenario: Happy path — a selected capability prints its text

- **GIVEN** a graph linking a changed file to a living spec, and a base reference
- **WHEN** `interlock domain-context --changed <file> --base <ref> --json` runs
- **THEN** it prints `selected: true`, the capability with the file that linked it, and the framed text read from the reference
- **AND** it exits zero

#### Scenario: Failure — an unresolvable base

- **GIVEN** a base reference that names no commit
- **WHEN** `interlock domain-context --changed <file> --base <ref>` runs
- **THEN** it exits 1 naming the reference
- **AND** standard output is empty

#### Scenario: Edge case — nothing to judge against

- **GIVEN** no graph and no change named
- **WHEN** `interlock domain-context --changed <file> --json` runs
- **THEN** it prints `selected: false` with the skip reason that no graph exists, and names the working tree as the base it would have read
- **AND** it exits zero

### Requirement: A size cut of the domain reviewer's text SHALL be spoken at run level

When the size bound leaves requirements out of the text the domain reviewer is given, a ship run SHALL raise `DOMAIN REVIEW PARTIAL`, stating how many requirements were left out and citing the limit that bounds the text by its published key (`maxDomainSpecChars`). It SHALL NOT restate the limit's value. The run SHALL raise one `DOMAIN REVIEW PARTIAL` banner: when the selection is also partial for want of a graph, that one banner SHALL state both reasons. The banner SHALL be raised once per run, however many review rounds follow, and SHALL reach the close summary. A text that fits SHALL raise nothing on this account.

Rationale: the reviewer is told what was cut, and the review record names it, but a person reading the close summary was not: a clean domain review over a cut text read exactly like a clean one over the whole.

#### Scenario: Happy path — a text that fits raises nothing

- **GIVEN** a strict run with a graph whose selected capabilities fit the bound
- **WHEN** the review step is planned
- **THEN** no `DOMAIN REVIEW PARTIAL` banner is raised

#### Scenario: Failure — a cut is named in the close summary

- **GIVEN** a strict run whose selected capabilities exceed the bound, so that four requirements are left out
- **WHEN** the run closes
- **THEN** the close summary carries one `DOMAIN REVIEW PARTIAL` line holding the count of four and the key `maxDomainSpecChars`
- **AND** the line appears one time, however many review rounds ran

#### Scenario: Edge case — no graph and a cut together

- **GIVEN** a strict run with no graph, whose declared capabilities exceed the bound
- **WHEN** the run closes
- **THEN** the close summary carries one `DOMAIN REVIEW PARTIAL` line that states the partial selection and the cut

### Requirement: Capabilities SHALL fill the domain-text cap in order of how many changed files they link

The domain text SHALL take selected capabilities in descending order of the number of changed files each links, then by name, so the capability the diff changes most is the last to be cut. The selection record SHALL list the order and each capability's linked count.

#### Scenario: Happy path — the most-linked capability goes first

- **GIVEN** a diff whose changed files link three to `hooks/settle-meter` and one to `distribution/npm-package`
- **WHEN** the domain text is assembled
- **THEN** `hooks/settle-meter`'s requirements come before `distribution/npm-package`'s, and the record lists the order with counts 3 and 1

#### Scenario: Edge case — equal counts fall back to name order

- **GIVEN** two capabilities each linked by one changed file
- **WHEN** the domain text is assembled
- **THEN** they are taken in name order

### Requirement: Any requirement left out for the cap SHALL make the selection partial, in the CLI as in a run

`interlock domain-context` SHALL set `partial` whenever the cap leaves a requirement out, stating how many and citing `maxDomainSpecChars` by key, and SHALL name each selected capability left with no requirement in the text. Its human output SHALL print `DOMAIN REVIEW PARTIAL` in that case, as a run does. The review's dimension record SHALL carry `domain` under `degraded` with that reason. A cut SHALL NOT be reported as a selection made without a graph: the living checklist's `no-graph` flag stays for a missing graph alone.

#### Scenario: Failure — the PR #28 cut is partial

- **GIVEN** the PR #28 diff, whose selected capabilities exceed the cap so that every `hooks/spec-meter` requirement is left out
- **WHEN** `interlock domain-context --changed … --base origin/main --json` runs
- **THEN** `partial` is set, names `hooks/spec-meter` as a capability with no requirement in the text, and cites `maxDomainSpecChars`
- **AND** the human output prints `DOMAIN REVIEW PARTIAL`

#### Scenario: Failure — a cut is not mistaken for a missing graph

- **GIVEN** a graph that exists and a diff whose selected capabilities exceed the cap
- **WHEN** the merge evidence builds the living checklist for the same diff
- **THEN** the checklist names the cut requirements as omitted and carries no `no-graph` flag

#### Scenario: Edge case — a run, the CLI and the merge evidence agree

- **GIVEN** the same diff, base and graph
- **WHEN** a strict run plans its review, `interlock domain-context` runs, and the merge evidence selects the living list
- **THEN** all three select the same capabilities in the same order, each `via` the same rule, with the same `ungraphed` files

#### Scenario: Edge case — the cut is degraded, not unread

- **GIVEN** a `domain` answer whose checked entries cite the requirements it was given and whose only gap is the requirements the cap left out
- **WHEN** the record is written with `domain` under `degraded` from `omitted`
- **THEN** `domain` is not in `proof.unread`, `proof.proven` holds, and the verdict carries `domain-partial`

#### Scenario: Edge case — a text that fits is not partial

- **GIVEN** a diff whose selected capabilities fit the cap
- **WHEN** `interlock domain-context` runs
- **THEN** `partial` is null and no `DOMAIN REVIEW PARTIAL` line is printed

### Requirement: A changed file the graph does not hold SHALL select the capability whose living spec cites it

When a changed source file is absent from the graph, the selection SHALL also take every capability whose living spec text cites that file's path, marked `via: cited`, and SHALL record the file under `ungraphed` with the graph's build time.

#### Scenario: Happy path — the settle meter is selected without the graph

- **GIVEN** a graph built before `lib/settle-meter.mjs` existed, a living `hooks/settle-meter` spec that cites `lib/settle-meter.mjs`, and a diff that changes that file
- **WHEN** domain context is selected
- **THEN** `hooks/settle-meter` is selected `via: cited`, and `lib/settle-meter.mjs` is listed under `ungraphed`

#### Scenario: Edge case — a file no spec cites

- **GIVEN** a changed file that is absent from the graph and cited by no living spec
- **WHEN** domain context is selected
- **THEN** no capability is selected for it, and the file is still listed under `ungraphed`
