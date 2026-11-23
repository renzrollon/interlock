# Spec Delta

## MODIFIED Requirements

### Requirement: `interlock settle conformance-brief` SHALL brief the confirmation of scenarios and living requirements from the CLI's own checklist, bound to the head

`interlock settle conformance-brief <change> --changed <files> --base <ref> --head <sha> [--result <file>]` SHALL gather the checklist `interlock conformance <change> --changed --living --base --json` produces and print a briefing asking one worker to confirm each scenario C1..Cn and each living requirement L1..Ln against the diff, answering in its reply with one JSON object and nothing else, carrying the five keys `scenariosChecked`, `scenariosUnconfirmed`, `requirementsChecked`, `requirementsUnconfirmed` and `detail`, and `head` equal to the sha the briefing names. The briefing SHALL tell the worker that it writes no file, and SHALL name no result file. `--result` SHALL name the file the caller writes that reply to, reported as `resultPath` under `--json` and defaulting to `.claude/ship/settle/handoff.json`. The briefing SHALL tell the worker to read the code and the specs and not to run the test suite or a build, because the pass verifies separately, on a line that is not the briefing's first. When the living list could not be built, the briefing SHALL still list the scenarios, say why the list is absent, and ask for the same keys with the two requirement counts reported as zero. With nothing to confirm, neither a scenario nor a living requirement, it SHALL print nothing on standard output, say so on standard error, and exit 0. A change that cannot be resolved SHALL exit 1 naming it.

Rationale: a lean ship leaves the two conformance signals unobserved for want of a handoff, and the strict tail's worker answers exactly this checklist; asking the same questions through the same CLI keeps the two from drifting. The head in the answer is what lets the verdict refuse a handoff written for the previous head. A worker that runs the suite beside the pass's own verification doubles the cost and can collide with it. The worker runs as the read-only reviewer type, which holds no tool that writes a file, so its answer travels in its reply and the session records it.

#### Scenario: Happy path — three scenarios and two living requirements

- **GIVEN** a change whose delta specs carry three scenarios, a graph that selects two living requirements for the changed files, `--base` naming a commit and `--head H`
- **WHEN** the command runs
- **THEN** standard output lists C1, C2, C3, L1 and L2 with the artifact and line each is written at, names H, the five count keys and the `head` key, and asks for the answer as the reply
- **AND** standard output names no result file and tells the worker it writes no file
- **AND** it exits 0

#### Scenario: Failure — an unknown change

- **GIVEN** a change name that resolves to no change
- **WHEN** the command runs
- **THEN** it exits 1 naming the change on standard error
- **AND** nothing is printed on standard output

#### Scenario: Edge case — a base that names no commit

- **GIVEN** the same change and `--base` naming no commit
- **WHEN** the command runs
- **THEN** the scenarios are still listed and the briefing says the living list was not built and why
- **AND** the briefing asks for the five keys and `head` all the same, with the two requirement counts to be reported as zero

#### Scenario: Edge case — nothing to confirm

- **GIVEN** a change whose delta specs carry no scenario and changed files for which the graph selects no living requirement
- **WHEN** the command runs
- **THEN** standard output is empty and standard error says there is nothing to confirm
- **AND** it exits 0

#### Scenario: Edge case — the worker reads and does not run

- **GIVEN** a change with scenarios to confirm
- **WHEN** the command runs
- **THEN** the briefing carries a line telling the worker not to run the test suite or a build and to read the code and the specs instead
- **AND** the briefing's first line still reads `Confirm change "<c>" against its diff at head <sha>.`

#### Scenario: Edge case — `--result` reaches the caller and not the worker

- **GIVEN** the same change and `--result out/answer.json`
- **WHEN** the command runs, with and without `--json`
- **THEN** the briefing text does not hold `out/answer.json`
- **AND** under `--json` the output's `resultPath` is `out/answer.json`, and with no `--result` it is `.claude/ship/settle/handoff.json`

## ADDED Requirements

### Requirement: The settle skill SHALL write the confirmation's handoff from the worker's reply

`skills/settle/SKILL.md` SHALL read the conformance worker's reply for one JSON object carrying the five keys and `head`, and SHALL write that object to `.claude/ship/settle/handoff.json` as returned, repairing no value. When the reply holds no such object it SHALL print `CONFORMANCE UNREAD: <first line of the reply>`, write no handoff, and go on to the head verification. It SHALL pass `--handoff` to the assessment only when it wrote the file.

#### Scenario: Happy path — the skill records what the worker returned

- **GIVEN** a conformance worker whose reply is one JSON object with the five keys and `head` equal to the pushed head
- **WHEN** the skill continues
- **THEN** it writes `.claude/ship/settle/handoff.json` holding that object, every value as the reply gave it
- **AND** the assessment line carries `--handoff .claude/ship/settle/handoff.json`

#### Scenario: Failure — a reply with no answer in it

- **GIVEN** a conformance worker whose reply holds no JSON object with the five keys
- **WHEN** the skill reads the reply
- **THEN** it prints `CONFORMANCE UNREAD:` followed by the reply's first line, and writes no handoff
- **AND** it runs the head verification next, and the assessment line carries no `--handoff`

#### Scenario: Edge case — a reply that names another head is written as it came

- **GIVEN** a conformance worker whose reply carries a `head` that is not the pushed head
- **WHEN** the skill writes the handoff
- **THEN** the file holds the reply's own `head`, and the skill corrects nothing
- **AND** the assessment, which refuses a handoff for another head, is what says so
