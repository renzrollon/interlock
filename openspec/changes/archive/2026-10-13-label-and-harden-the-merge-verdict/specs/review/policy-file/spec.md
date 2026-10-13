## ADDED Requirements

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
