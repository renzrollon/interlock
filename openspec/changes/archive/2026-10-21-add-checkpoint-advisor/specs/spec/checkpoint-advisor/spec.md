# spec/checkpoint-advisor Specification

## Purpose

One stronger-model, read-only consult at the end of the spec flow that reads the whole change as the human about to review it would, and leaves its questions and risks in `openspec/changes/<change>/advisor.md` for that human. The model is bracketed by two model-free CLI steps that own every threshold, every citation check and the file it writes, so a bad draft is caught by code and a missing consult is written down rather than skipped. Nothing gates on its output.

## ADDED Requirements

### Requirement: The brief SHALL be assembled by the CLI, bounded, and name what it left out

`interlock advisor <change> --brief [--findings <file>] [--json]` SHALL assemble the advisor's brief from the change folder alone: `proposal.md`, `design.md`, `tasks.md`, every `specs/**/spec.md`, and `decisions.md` when present, each quoted as data under a heading naming the file. When `decisions.md` is absent the brief SHALL say `ledger: absent`. When `--findings` names an artifact-review findings file the brief SHALL list each finding's `file`, `title` and `severity` under a heading saying these were already raised and are not to be repeated; when the flag is absent the brief SHALL say `review findings: none given`; when the named file cannot be read or carries no findings list the brief SHALL say `review findings: unreadable — <reason>` and the command SHALL still exit 0. The brief SHALL carry the compound notes `interlock note match <change>` would return for the change, or `compound notes: none matched`, or `compound notes: unreadable — <reason>`, and when the table parsed with problems it SHALL carry the well-formed matched rows and one line `compound notes: <n> rows unreadable`. The brief SHALL state the question cap `LIMITS.maxAdvisorQuestions`, the closed list of risk kinds, the JSON shape the reply must take, the list of citable files (`proposal.md`, `design.md`, `tasks.md` and each `specs/**/spec.md` path; the ledger is quoted but not citable), and the instruction to cite each question to one heading of one citable file as `<file>#<heading>`. The brief SHALL copy no `<context>`, `<rules>` or `<project_context>` block. The brief's total size SHALL not exceed `LIMITS.maxAdvisorBriefChars` while any cuttable section remains; when the sections exceed it the CLI SHALL cut whole sections in a fixed order (matched notes first, then the delta specs one file at a time largest first, then `design.md`, then `proposal.md`; `tasks.md`, the ledger, the findings list and the instructions are never cut) and list each cut section by name under `## Omitted`. When the never-cut sections alone exceed the cap the brief SHALL still be written with all of them, `## Omitted` SHALL carry the line `cap exceeded by <n> chars`, and the JSON `overrun` SHALL be that count; otherwise `overrun` SHALL be `0`. The brief SHALL be written to `.claude/metrics/advisor-brief-<change>-<YYYYMMDD-HHMMSS>.md` and its path printed; with `--json` the output SHALL be `{ step: "brief", change, path, chars, omitted: [names], overrun, notes: <count>, findings: <count> }`. The assembler SHALL be a registered entry of `lib/prompts/` whose output depends only on its inputs: the stamp and every path are chosen by `bin/interlock` and passed in, so the prompt-registry test's same-bytes rule holds. A change name that does not resolve SHALL exit non-zero with `error` and `candidates`, in the shape `interlock validate` uses. When the brief file cannot be written the command SHALL exit non-zero with the write error as its first output line and SHALL print no `path`, so the skill never spawns the consult on a brief that does not exist.

#### Scenario: Happy path — a complete change folder, a findings file and two matched notes

- **GIVEN** `openspec/changes/add-the-thing/` with the three artifacts, two delta specs and a `decisions.md`, a findings file holding one warning, and a compound-notes table with two rows whose `file` is a path `tasks.md` names
- **WHEN** `interlock advisor add-the-thing --brief --findings .claude/metrics/review-artifacts-add-the-thing-20261019-120000.json --json` runs
- **THEN** the JSON reads `step: "brief"`, `notes: 2`, `findings: 1`, `overrun: 0`, an empty `omitted`, and a `path` under `.claude/metrics/` that exists
- **AND** the file at that path quotes each artifact under a heading naming it, lists the warning's `file` and `title` as already raised, carries both notes, the cap, the risk kinds, the citable-files list and the reply shape, and nowhere copies a `<context>` or `<rules>` block

#### Scenario: Failure — the sections exceed the cap

- **GIVEN** a change whose two delta specs together with the other sections exceed `LIMITS.maxAdvisorBriefChars`, the larger spec alone enough to bring the rest under it
- **WHEN** `--brief` runs
- **THEN** the brief's `## Omitted` section names the matched notes and the larger delta spec as cut, and the smaller spec, `design.md`, `proposal.md`, `tasks.md`, the ledger and the instructions are present in full
- **AND** the JSON `omitted` lists the same names, `overrun` is `0`, and the written file is no larger than the cap

#### Scenario: Failure — tasks.md alone exceeds the cap

- **GIVEN** a change whose `tasks.md` is larger than `LIMITS.maxAdvisorBriefChars`
- **WHEN** `--brief` runs
- **THEN** every cuttable section is listed under `## Omitted`, `tasks.md` is present in full, the section also carries `cap exceeded by <n> chars`, and the JSON `overrun` is that `<n>`
- **AND** the command exits 0 and the file is written

#### Scenario: Edge case — no ledger, no findings flag, no notes table

- **GIVEN** a change folder with no `decisions.md`, a run with no `--findings`, and no `docs/notes/compound.md` in the repository
- **WHEN** `--brief` runs
- **THEN** the brief says `ledger: absent`, `review findings: none given` and `compound notes: none matched`, and the command exits 0
- **AND** nothing in the output implies a ledger or a review existed

#### Scenario: Edge case — the findings file cannot be read

- **GIVEN** `--findings` naming a path that does not exist
- **WHEN** `--brief` runs
- **THEN** the brief says `review findings: unreadable — <reason>`, the JSON `findings` is `0`, and the command exits 0
- **AND** the consult still runs on the brief
- **AND** when instead `.claude/metrics/` cannot be written, the command exits non-zero with the write error as its first output line and prints no `path`

### Requirement: The consult SHALL be one Agent-tool spawn of the plugin's advisor agent, declared once

The plugin SHALL ship `agents/advisor.md` with frontmatter `name: advisor`, `model: opus`, `tools: Read`, and `disallowedTools` naming `Skill`, `Agent`, `Bash`, `Write`, `Edit` and `mcp__*`, and no `effort` key. Its description SHALL say only what it is for: that it is spawned by the spec skill's consult step with the path of a CLI-assembled brief, replies with the JSON the brief specifies, and is not useful without a brief. The description SHALL NOT say it is never invoked from a user conversation, because the spec skill's Agent call is the user's own session turn and a model honouring that clause would refuse the one spawn the agent exists for. The body SHALL instruct the agent to read the one brief path it is given and nothing else, reply with the JSON object the brief specifies and nothing else, cite each question to a heading in the brief, stay within the stated cap, raise no question the brief lists as already raised, and prefer questions a repository cannot answer. `skills/spec/SKILL.md` SHALL run the consult in a section between the artifact-review gate and the hand-off, only on the clean-gate path, as: the fenced line `interlock advisor "<name>" --brief --findings <findings path> --json`; one Agent tool call with `subagent_type: "interlock:advisor"` whose prompt names the brief's path; a Write of the reply, verbatim, to `.claude/metrics/advisor-<name>-<YYYYMMDD-HHMMSS>.json`; then the fenced line `interlock advisor "<name>" --check <that path> --json`. The skill SHALL say the consult runs once, is never retried, never writes `decisions.md`, and that `advisor.md` is never edited by hand. The skill's `allowed-tools` SHALL admit `Agent`. The model name SHALL appear in `agents/advisor.md` and in no skill prose.

#### Scenario: Happy path — the clean gate leads to one consult

- **GIVEN** `/interlock:review-artifacts` returned `passed: true` and `interlock autonomy clean review-artifacts explore spec` ran
- **WHEN** the spec skill continues
- **THEN** it runs the brief line, spawns `interlock:advisor` once with the brief's path, writes the reply under `.claude/metrics/advisor-<name>-*.json`, and runs the check line with that path
- **AND** the skill suite finds the four tokens on fenced lines in that order, between `interlock autonomy clean review-artifacts explore spec` and `interlock notify checkpoint`

#### Scenario: Failure — a blocked gate halts before the consult

- **GIVEN** the artifact review returned a blocker
- **WHEN** the spec skill records `interlock autonomy record review-artifacts --blockers <n>`
- **THEN** it halts as §5 says, and no advisor line runs and no agent is spawned
- **AND** no `advisor.md` is written for the change

#### Scenario: Edge case — the agent file is checked statically

- **GIVEN** the plugin as shipped
- **WHEN** `node --test test/spine/plugin-agents.test.mjs` runs
- **THEN** `agents/advisor.md` passes the slim-frontmatter check with `Read` as its only tool, `model: opus`, the six disallowed names, no `effort`, a description containing `consult step` and `brief`, and no `Never invoke`
- **AND** `grep -rn opus skills/` matches nothing

### Requirement: The check SHALL validate the draft by code, render the file, and always exit 0

`interlock advisor <change> --check <draft|-> [--json]` SHALL read a JSON object `{ questions: [{ question, why, cite }], risks: [{ task | cite, kind, note }] }` from the named file or stdin. It SHALL assign each question the id `Q<n>` and each risk the id `R<n>` by its position in the draft, counting from 1 and ignoring any `id` the draft carries, so the kept and dropped tables share one numbering and no pane key collides. It SHALL validate before it caps: first it SHALL drop a question missing `question` or `cite` with the reason `missing field`, and a question whose `cite` does not name a citable file of the change (`proposal.md`, `design.md`, `tasks.md`, or a path under `specs/`) followed by `#` and the text of a `##`, `###` or `####` heading that file contains, compared after folding case and surrounding whitespace, with the reason `cite does not resolve`; then it SHALL keep at most `LIMITS.maxAdvisorQuestions` of the surviving questions, in the draft's order, and drop the rest with the reason `over cap`. A risk SHALL say where it lies by `task` (a checkbox id `N.M` in `tasks.md`) or by `cite` (a heading reference in the question's form); it SHALL be dropped with the reason `no such task` when its `task` matches no checkbox, `cite does not resolve` when its `cite` does not resolve, `missing field` when it carries neither, and `unknown kind` when its `kind` is not in the closed list `RISK_KINDS` exported by `lib/advisor.mjs`. Dropped rows SHALL be listed, never silently removed. The check SHALL render `openspec/changes/<change>/advisor.md` with: a heading naming the change; a status line `drafted <ISO> from <brief path if known>`; a `## Questions for the human` table with `id`, `question`, `why`, `cites`; a `## Risks` table with `id`, `where`, `kind`, `note`; a `## Dropped` table with `id`, `reason`; and one closing line saying the file is advisory, that `interlock ready`, `interlock ledger` and `interlock validate` do not read it, and that a question becomes a decision only when a person writes it into `decisions.md`. A table with no rows SHALL read `none`. The draft SHALL be kept where it was given; the check SHALL not move or delete it. With `--json` the output SHALL be `{ step: "check", change, status: "drafted", questions: [{ id, question }], dropped: <count>, risks: <count>, path }`. A draft that is not a JSON object, whose `questions` or `risks` is present and not an array, or a file that cannot be read, SHALL be treated as a consult that did not run with that reason (`draft is not a JSON object`, `questions is not an array`, `risks is not an array`, or the read error). The check SHALL exit 0 in every case except a change name that does not resolve. The stamp in the status line SHALL be chosen by `bin/interlock` and passed to the renderer. Every cap it applies SHALL be read from `lib/limits.mjs` and SHALL appear in `interlock limits`.

#### Scenario: Happy path — a draft of eight questions and three risks

- **GIVEN** a draft of eight questions each citing `design.md#Decisions` or `tasks.md#1. Failing tests first`, and three risks, two naming tasks `2.1` and `3.4` and one citing `proposal.md#What Changes`, with kinds from `RISK_KINDS`
- **WHEN** `interlock advisor add-the-thing --check .claude/metrics/advisor-add-the-thing-20261019-121000.json --json` runs
- **THEN** the JSON reads `status: "drafted"`, eight `questions` with ids `Q1` to `Q8`, `dropped: 0`, `risks: 3`, and `path: openspec/changes/add-the-thing/advisor.md`
- **AND** the file carries the three tables, `R3`'s `where` reading `proposal.md#What Changes`, and the closing line, and the exit code is 0

#### Scenario: Failure — thirteen questions, two bad citations and an unknown kind

- **GIVEN** a draft of thirteen questions, of which the fourth and the seventh cite `design.md#Nonexistent`, and a risk whose kind is `vibes`
- **WHEN** the check runs
- **THEN** the `## Dropped` table lists `Q4` and `Q7` with `cite does not resolve`, `Q13` with `over cap`, and the risk with `unknown kind`
- **AND** `questions` carries the ten kept rows `Q1`–`Q3`, `Q5`, `Q6`, `Q8`–`Q12` in the draft's order, the exit code is 0, and no dropped row is silently absent

#### Scenario: Edge case — the draft is not JSON

- **GIVEN** a draft file containing a prose apology
- **WHEN** the check runs
- **THEN** `advisor.md` is written as a consult that did not run with the reason `draft is not a JSON object`, the JSON reads `status: "did-not-run"`, and the exit code is 0
- **AND** the draft file is left where it was

#### Scenario: Edge case — an empty draft and a non-array questions field

- **GIVEN** a draft `{ "questions": [], "risks": [] }`
- **WHEN** the check runs
- **THEN** the JSON reads `status: "drafted"`, `questions: []`, `dropped: 0`, `risks: 0`, each table reads `none`, and the exit code is 0
- **AND** a draft `{ "questions": "see above" }` is written as a consult that did not run with the reason `questions is not an array`

### Requirement: A consult that did not run SHALL be written down, and the spec SHALL continue

`interlock advisor <change> --check --failed "<reason>" [--json]` SHALL render `openspec/changes/<change>/advisor.md` with the heading, a status line `did not run: <reason>`, no tables, and the same closing line, and SHALL print `{ step: "check", change, status: "did-not-run", reason, questions: [], dropped: 0, risks: 0, path }` with `--json`, exiting 0. `skills/spec/SKILL.md` SHALL run that line when the brief line failed, the Agent spawn errored or returned no reply, or the reply could not be written, and SHALL then continue to the hand-off, which SHALL say the consult did not run and why. When the `--failed` line itself exits non-zero (the change name did not resolve), the skill SHALL report that line's first output line as the did-not-run reason in the hand-off and SHALL still continue. The skill SHALL never retry the consult and SHALL never fall back to drafting questions in its own prose.

#### Scenario: Happy path — the spawn errors and the file says so

- **GIVEN** the brief was written and the Agent tool returned an error
- **WHEN** the skill runs `interlock advisor "add-the-thing" --check --failed "agent spawn errored" --json`
- **THEN** `advisor.md` reads `did not run: agent spawn errored` and carries the closing line
- **AND** the hand-off names the reason, `interlock notify checkpoint "add-the-thing"` still runs, and `GOAL MET: interlock spec stopped at the checkpoint.` is printed

#### Scenario: Failure — the brief could not be assembled

- **GIVEN** `--brief` exited non-zero because `.claude/metrics/` could not be written
- **WHEN** the skill reaches the consult
- **THEN** it spawns nothing and runs the `--failed` line with the brief's error as the reason, which writes `advisor.md` because the change folder still resolves
- **AND** the spec flow does not stop there

#### Scenario: Failure — the failed line itself exits non-zero

- **GIVEN** the change folder was renamed between the gate and the consult, so `--check --failed` exits non-zero with `error` and `candidates`
- **WHEN** the skill reads that exit
- **THEN** the hand-off reports the line's first output line as the did-not-run reason, and `interlock notify checkpoint` still runs
- **AND** no `advisor.md` exists and nothing is retried

#### Scenario: Edge case — an empty reason

- **GIVEN** `--check --failed ""`
- **WHEN** the check runs
- **THEN** the status line reads `did not run: no reason given` and the exit code is 0

### Requirement: No gate SHALL read advisor.md, and the ledger SHALL stay the human's to write

`interlock ready`, `interlock ledger`, `interlock validate`, `interlock drift` and the risk classifier SHALL not read `openspec/changes/<change>/advisor.md`, and `interlock validate` SHALL not list it as a required or unexpected artifact. The presence, absence or content of `advisor.md` SHALL change no verdict, exit code or `problems` entry of those commands. The CLI SHALL never write a row to `decisions.md` from a draft. A test SHALL pin this by running the readiness, ledger and validate decisions on a change folder with and without an `advisor.md` and asserting identical outputs.

#### Scenario: Happy path — a change with ten advisor questions is still ready

- **GIVEN** a change whose `decisions.md` has no `needs_human` row and whose `advisor.md` lists ten questions
- **WHEN** `interlock ready <change> --findings <f> --json` and `interlock ledger <change> --json` run
- **THEN** `ready` and `blocking` read exactly what they read with `advisor.md` removed
- **AND** no output mentions `advisor.md`

#### Scenario: Failure — a draft question the human adopts becomes a ledger row by hand

- **GIVEN** `advisor.md` lists `Q2 Which package name is published?`
- **WHEN** the human writes `| D20 | Which package name is published? | needs_human | — | — |` into `decisions.md`
- **THEN** `interlock ledger` blocks on D20 as it blocks on any `needs_human` row
- **AND** `advisor.md` is unchanged and still not read

#### Scenario: Edge case — advisor.md is the only file in the folder

- **GIVEN** `openspec/changes/odd/` containing only `advisor.md`
- **WHEN** `interlock validate odd --json` runs
- **THEN** `ready` is false and `problems` name the three missing artifacts, and `advisor.md` is named nowhere

### Requirement: The kill criterion SHALL be a CLI tally of human labels against caps

`interlock advisor --verdict --labels <evals dir> [--json]` SHALL read, through the same reader `interlock evals calibrate` uses, only the label files under `<evals dir>/spec-range-*/calibration/matches-label/*.md` and `<evals dir>/spec-range-*/calibration/answered-already/*.md`; label files of other cases or other graders SHALL be neither counted nor listed. A case SHALL count as labelled when it holds at least one well-formed label on each of the two graders. A case's label on a grader SHALL be the majority of its well-formed label files for that grader, `pass` or `fail`; a tie SHALL count as neither. The command SHALL count the labelled cases, the labelled cases whose `matches-label` label is `pass` (`matches`), and the labelled cases whose `answered-already` label is `fail` (`repeats`), and print `KEEP` when the labelled cases number at least `LIMITS.advisorVerdictMinLabels`, `matches` is at least `LIMITS.advisorKeepMinMatches`, and `repeats` is at most `LIMITS.advisorRepeatMaxPercent` percent of the labelled cases; `KILL` when the labelled cases suffice and either condition fails; `INSUFFICIENT LABELS (<n> of <min>)` otherwise. The output SHALL name each count and each cap beside it. With `--json` it SHALL print `{ step: "verdict", verdict, labelled, matches, repeats, caps: { minLabels, keepMinMatches, repeatMaxPercent }, problems }`. Label files the reader reports as malformed SHALL be listed under `problems` and not counted. The command SHALL exit 0 in every case; the verdict is a statement for a person, not a gate.

#### Scenario: Happy path — ten labels, five matches, two repeats

- **GIVEN** ten Spec Range cases each with one `matches-label` label and one `answered-already` label, five `pass` on the first and two `fail` on the second
- **WHEN** `interlock advisor --verdict --labels evals --json` runs
- **THEN** `verdict` reads `KEEP`, `labelled: 10`, `matches: 5`, `repeats: 2`, and the caps are printed beside them
- **AND** the exit code is 0

#### Scenario: Failure — two matches out of ten

- **GIVEN** the same ten cases with two `pass` on `matches-label`
- **WHEN** the verdict runs
- **THEN** it reads `KILL`, naming `matches 2 < keepMinMatches 3`
- **AND** the exit code is still 0

#### Scenario: Edge case — four labels and one malformed file

- **GIVEN** four cases labelled on both graders and a fifth whose only `matches-label` file lacks the `label:` line
- **WHEN** the verdict runs
- **THEN** it reads `INSUFFICIENT LABELS (4 of 10)` and `problems` names the malformed file
- **AND** nothing is counted from the malformed file, and the fifth case is not labelled

#### Scenario: Edge case — several transcripts, one grader, a tie

- **GIVEN** a case with three `matches-label` files reading `pass`, `pass`, `fail`, no `answered-already` file, and a second case with two `answered-already` files reading `pass` and `fail` and one `matches-label` file reading `pass`
- **WHEN** the verdict runs
- **THEN** the first case is not labelled, the second is labelled with `matches-label` `pass` and `answered-already` counting as neither, so `labelled: 1`, `matches: 1`, `repeats: 0`
- **AND** a label file under `evals/skill-routing-explore/calibration/` is neither counted nor listed
