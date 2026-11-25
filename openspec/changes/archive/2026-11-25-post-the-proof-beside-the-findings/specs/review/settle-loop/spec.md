# Spec Delta

## MODIFIED Requirements

### Requirement: `interlock settle conformance-brief` SHALL brief the confirmation of scenarios and living requirements from the CLI's own checklist, bound to the head

`interlock settle conformance-brief <change> --changed <files> --base <ref> --head <sha> [--result <file>] [--out <file>]` SHALL gather the checklist `interlock conformance <change> --changed --living --base --json` produces and print a briefing asking one worker to confirm each scenario C1..Cn and each living requirement L1..Ln against the diff, answering in its reply with one JSON object and nothing else, carrying the five keys `scenariosChecked`, `scenariosUnconfirmed`, `requirementsChecked`, `requirementsUnconfirmed` and `detail`, `head` equal to the sha the briefing names, and `rows`: one `{ id, status, cite }` for every id the briefing lists, in which `status` is `confirmed` or `unconfirmed` and a confirmed row's `cite` is a `path:line` or `path:start-end` naming where the behaviour is built or still honoured. The briefing SHALL tell the worker that a citation into the living specs or the change's own artifacts confirms nothing, because that is the requirement's text and not the code that honours it. The briefing SHALL tell the worker that it writes no file, and SHALL name no result file. `--result` SHALL name the file the caller writes that reply to, reported as `resultPath` under `--json` and defaulting to `.claude/ship/settle/handoff-reply.json`. `--out <file>` SHALL write the object `--json` prints to that file, creating the file's directories, and that object SHALL carry the change's directory as `dir`, every briefed scenario and living requirement with its id, title, artifact and line, and the living list's `skipped`, `partial` and `omitted`; a write that fails SHALL exit 1 naming the file, with no briefing printed. The briefing SHALL tell the worker to read the code and the specs and not to run the test suite or a build, because the pass verifies separately, on a line that is not the briefing's first. When the living list could not be built, the briefing SHALL still list the scenarios, say why the list is absent, and ask for the same keys with the two requirement counts reported as zero. With nothing to confirm, neither a scenario nor a living requirement, it SHALL print nothing on standard output, say so on standard error, write nothing to `--out`, and exit 0. A change that cannot be resolved SHALL exit 1 naming it.

Rationale: a lean ship leaves the two conformance signals unobserved for want of a handoff, and the strict tail's worker answers exactly this checklist; asking the same questions through the same CLI keeps the two from drifting. The head in the answer is what lets the verdict refuse a handoff written for the previous head. A worker that runs the suite beside the pass's own verification doubles the cost and can collide with it. The worker runs as the read-only reviewer type, which holds no tool that writes a file, so its answer travels in its reply and the session records it. Five counts and a paragraph are a self-report nothing can check; a row per id with a citation is what `interlock settle handoff-check` can check. The record `--out` keeps is the list of ids that check reads, so the ids are decided one time, by the briefing, and never worked out again after the worker ran.

#### Scenario: Happy path — three scenarios and two living requirements

- **GIVEN** a change whose delta specs carry three scenarios, a graph that selects two living requirements for the changed files, `--base` naming a commit and `--head H`
- **WHEN** the command runs
- **THEN** standard output lists C1, C2, C3, L1 and L2 with the artifact and line each is written at, names H, the five count keys, the `head` key and the `rows` key, and asks for the answer as the reply
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
- **AND** the briefing asks for the five keys, `head` and `rows` all the same, with the two requirement counts to be reported as zero

#### Scenario: Edge case — nothing to confirm

- **GIVEN** a change whose delta specs carry no scenario and changed files for which the graph selects no living requirement
- **WHEN** the command runs with `--out` naming a file
- **THEN** standard output is empty and standard error says there is nothing to confirm
- **AND** it exits 0 and nothing exists at the `--out` path

#### Scenario: Edge case — the worker reads and does not run

- **GIVEN** a change with scenarios to confirm
- **WHEN** the command runs
- **THEN** the briefing carries a line telling the worker not to run the test suite or a build and to read the code and the specs instead
- **AND** the briefing's first line still reads `Confirm change "<c>" against its diff at head <sha>.`

#### Scenario: Edge case — `--result` reaches the caller and not the worker

- **GIVEN** the same change and `--result out/answer.json`
- **WHEN** the command runs, with and without `--json`
- **THEN** the briefing text does not hold `out/answer.json`
- **AND** under `--json` the output's `resultPath` is `out/answer.json`, and with no `--result` it is `.claude/ship/settle/handoff-reply.json`

#### Scenario: Edge case — the briefing asks for a cited row per id

- **GIVEN** a change with three scenarios and two living requirements
- **WHEN** the command runs
- **THEN** the briefing's reply shape holds `rows` with `id`, `status` and `cite`, says there is one row for every id listed, and names `confirmed` and `unconfirmed` as the two values of `status`
- **AND** it says a citation into the living specs or the change's own artifacts confirms nothing

#### Scenario: Edge case — `--out` keeps the record the check reads

- **GIVEN** the same change and `--out` naming a file in a directory that does not yet exist
- **WHEN** the command runs without `--json`
- **THEN** standard output is the briefing, and the file holds one JSON object carrying `change`, `dir`, `head`, the five entries with their ids, titles, artifacts and lines, and the living list's `skipped`, `partial` and `omitted`
- **AND** the object equals what the same command prints under `--json`

#### Scenario: Failure — an `--out` that cannot be written

- **GIVEN** `--out` naming a path under an existing regular file
- **WHEN** the command runs
- **THEN** it exits 1 naming the path on standard error
- **AND** no briefing is printed on standard output

### Requirement: The settle skill SHALL write the confirmation's handoff from the worker's reply

`skills/settle/SKILL.md` SHALL run the conformance briefing with `--out .claude/ship/settle/conformance-brief.json`, SHALL read the conformance worker's reply for one JSON object carrying the five keys and `head`, and SHALL write that object to `.claude/ship/settle/handoff-reply.json` as returned, repairing no value. It SHALL then run `interlock settle handoff-check` with `--brief` naming the briefing's record, `--reply` naming that file and `--out .claude/ship/settle/handoff.json`, and SHALL print the lines the check prints. When the reply holds no such object it SHALL print `CONFORMANCE UNREAD: <first line of the reply>`, write no reply file, run no check, and go on to the head verification. When the check exits non-zero it SHALL print `CONFORMANCE UNCHECKED: <first line of its standard error>` and go on to the head verification. It SHALL pass `--handoff` to the assessment only when the check wrote the file, and SHALL write `.claude/ship/settle/handoff.json` by no other means.

Rationale: the worker's answer is kept as it came, so what the worker claimed can still be read; the handoff the verdict reads is the one the CLI checked, so a confirmation with no citation behind it cannot read green. The skill repairs nothing in either file.

#### Scenario: Happy path — the skill records what the worker returned

- **GIVEN** a conformance worker whose reply is one JSON object with the five keys, `head` equal to the pushed head and a row for every briefed id
- **WHEN** the skill continues
- **THEN** it writes `.claude/ship/settle/handoff-reply.json` holding that object, every value as the reply gave it, and runs `interlock settle handoff-check` with `--brief .claude/ship/settle/conformance-brief.json`, `--reply .claude/ship/settle/handoff-reply.json` and `--out .claude/ship/settle/handoff.json`
- **AND** the assessment line carries `--handoff .claude/ship/settle/handoff.json`

#### Scenario: Failure — a reply with no answer in it

- **GIVEN** a conformance worker whose reply holds no JSON object with the five keys
- **WHEN** the skill reads the reply
- **THEN** it prints `CONFORMANCE UNREAD:` followed by the reply's first line, writes no reply file and runs no check
- **AND** it runs the head verification next, and the assessment line carries no `--handoff`

#### Scenario: Edge case — a reply that names another head is written as it came

- **GIVEN** a conformance worker whose reply carries a `head` that is not the pushed head
- **WHEN** the skill writes the reply file and runs the check
- **THEN** the reply file and the checked handoff both hold the reply's own `head`, and the skill corrects nothing
- **AND** the assessment, which refuses a handoff for another head, is what says so

#### Scenario: Failure — a check that could not run leaves no handoff

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the confirmation's section
- **THEN** it finds the `interlock settle handoff-check` line after the `interlock settle conformance-brief` line and before the final verification's lines, and the token `CONFORMANCE UNCHECKED:`
- **AND** the prose says the assessment is handed `--handoff` only when the check wrote the file, and that the skill writes that file by no other means

## ADDED Requirements

### Requirement: `interlock settle handoff-check` SHALL write the handoff the verdict reads from the worker's reply and the briefing's record

`interlock settle handoff-check --brief <file> --reply <file> [--out <file>]` SHALL read the record `conformance-brief --out` kept and the worker's reply, and write to `--out`, by default `.claude/ship/settle/handoff.json`, one object: `checked: true`, the reply's `head` and `detail` unchanged, a row per briefed id, the four counts worked out from the rows, the worker's counts under `claimed`, and the living list's facts under `living`. It SHALL print the counts and exit 0 whatever they say.

#### Scenario: Happy path — every briefed id confirmed with a citation that resolves

- **GIVEN** a briefing record with three scenarios and two living requirements, and a reply with five `confirmed` rows, each citing a file and a line that exist
- **WHEN** the command runs
- **THEN** the file at `--out` holds `checked: true`, five rows reading `confirmed` each with its id, kind, title and citation, `scenariosChecked: 3`, `scenariosUnconfirmed: 0`, `requirementsChecked: 2` and `requirementsUnconfirmed: 0`
- **AND** its `living` holds the record's `skipped` and `partial` and the number of requirements the size bound left out
- **AND** standard output is one line giving those counts, and it exits 0

#### Scenario: Edge case — the worker's own counts are kept beside the checked ones

- **GIVEN** a reply that reports `scenariosUnconfirmed: 0` and holds one `confirmed` row with no citation
- **WHEN** the command runs
- **THEN** the written object's `scenariosUnconfirmed` is 1 and its `claimed.scenariosUnconfirmed` is 0
- **AND** the reply file is unchanged

#### Scenario: Edge case — a reply for another head keeps its head

- **GIVEN** a briefing record for H and a reply whose `head` is another commit
- **WHEN** the command runs
- **THEN** the written object's `head` is the reply's own
- **AND** it exits 0, because the assessment is what refuses a handoff for another head

#### Scenario: Failure — a brief or a reply that cannot be read

- **GIVEN** `--brief` naming a file that holds no list of briefed ids, and separately a `--reply` that is not a JSON object, each with an earlier file at the `--out` path
- **WHEN** the command runs for each
- **THEN** each exits 1 naming the flag and the fault on standard error, with nothing on standard output
- **AND** nothing exists at the `--out` path afterwards

### Requirement: A row SHALL read confirmed only when its citation names a file and line that exist at the head and are not the requirement's own text

A briefed id SHALL read `confirmed` only when the reply holds one row for it whose `status` is `confirmed` and whose `cite` has the form `path:line` or `path:start-end`, names a file in the working tree and a line that file has, and lies neither under `openspec/specs/` nor in the change's own directory. Every other id SHALL read `unconfirmed` with one of the seven fixed reasons.

#### Scenario: Happy path — the accepted forms

- **GIVEN** four `confirmed` rows citing an existing file as `lib/a.mjs:12`, `lib/a.mjs:12-40`, `lib/a.mjs:12:5` and `./lib/a.mjs:12`, each line within the file
- **WHEN** the command runs
- **THEN** all four ids read `confirmed`
- **AND** each row keeps the citation as the worker wrote it

#### Scenario: Failure — no citation, an invented path and a line past the end

- **GIVEN** `confirmed` rows whose `cite` is absent, is the word `yes`, is `lib/a.mjs` with no line, names `lib/nowhere.mjs:1`, names `../outside.mjs:1`, and names line 9000 of a ninety-line file
- **WHEN** the command runs
- **THEN** every one reads `unconfirmed`: the first three with the reason `no citation`, the next two `cited file not found`, and the last `cited line not in the file`
- **AND** each row keeps `claimed: confirmed`

#### Scenario: Failure — a citation into the specs or the change's own artifacts

- **GIVEN** a `confirmed` row for L1 citing the line of `openspec/specs/review/settle-loop/spec.md` the briefing listed it at, and one for C1 citing a line of the change's own delta spec
- **WHEN** the command runs
- **THEN** both read `unconfirmed` with the reason `the citation is the requirement's own text`
- **AND** a third row citing a line of an archived change's `tasks.md` reads `confirmed`

#### Scenario: Failure — a reply with no rows confirms nothing

- **GIVEN** a reply that carries the five counts and `head`, reports every scenario confirmed, and holds no `rows`
- **WHEN** the command runs
- **THEN** every briefed id reads `unconfirmed` with the reason `no row`
- **AND** `scenariosChecked` is 0

#### Scenario: Edge case — an id with no row, an id with two rows, and a row nobody briefed

- **GIVEN** a briefing record listing C1, C2 and C3, and a reply with no row for C1, two rows for C2 and a row for C9
- **WHEN** the command runs
- **THEN** C1 reads `unconfirmed` for `no row` and C2 for `more than one row`
- **AND** the written object lists C9 under `unknownRows`, the printed line names it, and no count includes it

### Requirement: An unconfirmed row SHALL carry one of seven fixed reasons, and a range or a status SHALL be read strictly

A row that does not read `confirmed` SHALL carry one `reason`: `no row`, `more than one row`, `not confirmed by the worker`, `no citation`, `cited file not found`, `cited line not in the file` or `the citation is the requirement's own text`; when two apply, the earlier in that order. A `status` that is not the string `confirmed` is not confirmed by the worker. A line or range SHALL resolve only when it starts at 1 or later, ends within the file, and does not end before it starts.

#### Scenario: Happy path — each reason is spelled as listed

- **GIVEN** a reply that leaves one id with no row, gives one two rows, reports one `unconfirmed`, confirms one with no `cite`, one citing an invented path, one citing a line past the end, and one citing its own spec line
- **WHEN** the command runs
- **THEN** the seven rows carry, in that order, `no row`, `more than one row`, `not confirmed by the worker`, `no citation`, `cited file not found`, `cited line not in the file` and `the citation is the requirement's own text`
- **AND** a confirmed row's `reason` is `null`

#### Scenario: Failure — a range that runs past the file, starts at zero or runs backwards

- **GIVEN** `confirmed` rows citing `lib/a.mjs:80-200`, `lib/a.mjs:0` and `lib/a.mjs:40-12` in a ninety-line file
- **WHEN** the command runs
- **THEN** all three read `unconfirmed` with the reason `cited line not in the file`
- **AND** a row citing `lib/a.mjs:80-90` reads `confirmed`
- **AND** a row citing line 9000 of a living spec file reads `cited line not in the file`, the earlier of the two reasons that apply

#### Scenario: Edge case — a status in another case

- **GIVEN** a row whose `status` is `Confirmed` and whose `cite` resolves
- **WHEN** the command runs
- **THEN** the id reads `unconfirmed` with the reason `not confirmed by the worker`, and its `claimed` keeps `Confirmed` as written
- **AND** the `CONFIRMATION NOT CITED:` line does not name it

### Requirement: The handoff's counts SHALL be worked out from its rows, and a refused confirmation SHALL be said

`scenariosChecked` and `requirementsChecked` SHALL be the briefed ids that have a row, and `scenariosUnconfirmed` and `requirementsUnconfirmed` the briefed ids that do not read `confirmed`. When the worker claimed a row confirmed and the check refused it, the command SHALL print a line opening `CONFIRMATION NOT CITED:` that names each such id with its reason. When the briefing's record says the living list was not built, both requirement counts SHALL be 0.

#### Scenario: Happy path — a mixed reply

- **GIVEN** three briefed scenarios: C1 confirmed with a citation that resolves, C2 reported `unconfirmed` by the worker, and C3 claimed `confirmed` citing a file that does not exist
- **WHEN** the command runs
- **THEN** `scenariosChecked` is 3 and `scenariosUnconfirmed` is 2
- **AND** standard output holds a line opening `CONFIRMATION NOT CITED:` that names C3 and its reason and does not name C2

#### Scenario: Edge case — the living list was not built

- **GIVEN** a briefing record whose living list carries a `skipped` reason and no requirement
- **WHEN** the command runs on a reply that reports two requirements checked
- **THEN** `requirementsChecked` and `requirementsUnconfirmed` are both 0, and `claimed.requirementsChecked` is 2
- **AND** the written object holds no requirement row

#### Scenario: Edge case — the verdict reads the checked counts

- **GIVEN** a checked handoff for the head with three scenario rows of which one is unconfirmed, and a change whose delta specs carry three scenarios
- **WHEN** `interlock merge-confidence --handoff <file>` assesses it
- **THEN** the delta conformance signal reads 3 of 3 checked and 1 unconfirmed
- **AND** the keys `checked`, `rows`, `claimed` and `unknownRows` change no other signal
