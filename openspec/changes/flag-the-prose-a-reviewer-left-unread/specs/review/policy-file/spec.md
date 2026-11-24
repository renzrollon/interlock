# Spec Delta

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Declared counts-as-source paths SHALL be parsed like the other path lists and SHALL be read only by the size signal

**Reason**: The proof of coverage now reads the list too, to keep an `unread` entry on a listed path under `unread`. The requirement's name and its "no merge signal other than `diff.shape`" clause would both be false.

**Migration**: Replaced by "Declared counts-as-source paths SHALL be parsed like the other path lists and SHALL be read by the size signal and the proof of coverage alone", which keeps every scenario of this requirement, and by "The counts-as-source list SHALL reach `review.ran` only through the proof of coverage, and only to keep an entry unread". A `REVIEW.md` needs no edit: the section's grammar and its effect on the size signal are unchanged.
