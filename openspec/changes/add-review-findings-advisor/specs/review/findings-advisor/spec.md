## Purpose

An opt-in, read-only, stronger-model consult after `/interlock:review-code`'s gate. It reads the resolved review the way the human about to act on it would, and leaves flags in `openspec/changes/<change>/review-advisor.md`: dismissals worth re-reading, survivors that share one cause, and changed files no dimension engaged. Two model-free CLI steps own every threshold, every target check and the file the consult writes. Nothing gates on that file.

## ADDED Requirements

### Requirement: The review SHALL write the advisor's brief when asked, and never fail because of it

`interlock review` SHALL accept `--advisor-brief <change>`. When given, after resolving the review, it SHALL write a brief to `.claude/metrics/review-advisor-brief-<change>-<YYYYMMDD-HHMMSS>.md` and an id index to the same path with a `.json` suffix in place of `.md`. The brief SHALL contain:
- each surviving finding as `S<n>`, numbered by its position in the resolved survivors list
- each dismissed finding as `D<n>`, numbered by its position in the resolved dismissed list, with every raw verdict the review matched to it (the verdict's verdict, reasoning, evidence and refined severity) and its vote counts
- every finding dropped for quality, and every finding dropped by repository policy with the pattern that excluded it
- the per-dimension raised and surviving counts
- the changed-file list

The brief SHALL also state the flag cap `LIMITS.maxReviewAdvisorFlags`, the closed list of flag kinds with the targets each takes, and the JSON shape of the reply. It SHALL say the advisor raises and never decides. Every finding and verdict SHALL be quoted as data.

The index SHALL map each `S<n>` and `D<n>` to its finding's `file` and `title`, and carry the changed-file list. The brief's size SHALL not exceed `LIMITS.maxReviewAdvisorBriefChars` while a cuttable section remains. Policy drops are cut first, then quality drops, and each cut section is named under `## Omitted`. Survivors, dismissals and the instructions are never cut. When those alone exceed the cap, `## Omitted` SHALL carry `cap exceeded by <n> chars`.

With `--json`, the review's output SHALL gain `advisorBrief: { written, path, index, chars, omitted, overrun }`. When the change does not resolve, or a file cannot be written, the review SHALL print a warning, set `advisorBrief.written` to `false` with a `reason`, and keep the exit code it would have had without the flag. Without the flag the review's output SHALL be unchanged.

The assembler's output SHALL depend only on its inputs: `bin/interlock` chooses the stamp and the paths and passes them in.

#### Scenario: Happy path — a review with survivors and a dismissal

- **GIVEN** a findings file with three findings and a verdicts file in which two skeptics dismiss the second finding on `lib/a.mjs:10` and the other two survive
- **WHEN** `interlock review --findings f.json --verdicts v.json --changed lib/a.mjs lib/b.mjs --advisor-brief add-the-thing --json` runs
- **THEN** the JSON carries `advisorBrief.written: true` and a `path` and `index` that exist
- **AND** the brief lists the survivors as `S1` and `S2` and the dismissal as `D1`, with both skeptics' reasoning and evidence under `D1`
- **AND** the index maps `D1` to that finding's file and title and lists both changed files

#### Scenario: Failure — the brief cannot be written

- **GIVEN** a `.claude/metrics/` that cannot be written
- **WHEN** the review runs with `--advisor-brief add-the-thing`
- **THEN** a warning names the write error, `advisorBrief.written` is `false` with that `reason`, and the review's exit code equals the exit code of the same review without the flag

#### Scenario: Edge case — survivors and dismissals alone exceed the cap

- **GIVEN** a review whose survivors and dismissals alone are larger than `LIMITS.maxReviewAdvisorBriefChars`
- **WHEN** the brief is written
- **THEN** both drop sections are named under `## Omitted`, every survivor and dismissal is present, `## Omitted` carries `cap exceeded by <n> chars`, and `advisorBrief.overrun` is that `<n>`

#### Scenario: Edge case — the flag is absent

- **WHEN** the same review runs without `--advisor-brief`
- **THEN** its JSON has no `advisorBrief` key, and no `review-advisor-brief-*` file is written

### Requirement: The consult SHALL be one spawn of a dedicated read-only agent

The plugin SHALL ship `agents/review-advisor.md` with frontmatter `name: review-advisor`, `model: opus`, `tools: Read`, `disallowedTools` naming `Skill`, `Agent`, `Bash`, `Write`, `Edit` and `mcp__*`, and no `effort` key. Its one-line description SHALL say it is spawned by the review-code skill's consult step with the path of a CLI-assembled brief, replies with the brief's JSON, and is not useful without a brief. It SHALL NOT say it is never invoked from a user conversation.

The body SHALL instruct the agent to:
- read the one brief path and nothing else
- reply with the JSON object only
- target each flag at ids or paths the brief lists
- stay within the cap
- raise and never decide: no flag claims a finding is real or fake, only what a human should re-read and why

The agent type SHALL differ from the checkpoint advisor's, so the spec meter never counts a review consult as a spec consult.

#### Scenario: Happy path — the agent's frontmatter

- **WHEN** the plugin-agents suite reads `agents/review-advisor.md`
- **THEN** it finds `model: opus`, tools of `Read` alone, all six disallowed names, no `effort` key, and a description naming the consult step and the brief

#### Scenario: Edge case — a review consult during a live spec run

- **GIVEN** a session whose spec meter is live
- **WHEN** an Agent call spawns `interlock:review-advisor` and a Bash line runs `interlock review-advisor add-the-thing --check - --json`
- **THEN** the meter's consult count and advisor lines are unchanged

### Requirement: The check SHALL validate the draft against the index, persist it, and render one file

`interlock review-advisor <change> --check <draft path>|-|--failed "<reason>" [--json]` SHALL read the newest index for the change and validate the draft against it.

**Draft persistence.** With `-`, the draft is read from standard input and written unchanged to `.claude/metrics/review-advisor-<change>-<YYYYMMDD-HHMMSS>.json`, so no skill-side file write is needed.

**Draft shape.** The draft is `{ "flags": [ { "kind", "targets", "why", "check" } ] }`. A flag is kept only when:
- its `kind` is one of the following, with targets that resolve:

  | kind | targets |
  |---|---|
  | `dismissal-doubt` | one target, a `D<n>` in the index |
  | `shared-root-cause` | two or more distinct `S<n>` in the index |
  | `uncovered` | one target, a path in the index's changed-file list |

- `why` and `check` are non-empty strings

Any other flag SHALL be dropped with a reason that names what failed.

**Order of checks.** Validation SHALL run before the cap. Kept flags beyond `LIMITS.maxReviewAdvisorFlags` SHALL be dropped as `over cap`. Ids SHALL be assigned as `F<n>` by draft position, and any id the model wrote SHALL be ignored.

**Output file.** The CLI SHALL write `openspec/changes/<change>/review-advisor.md` with:
- a status line
- `## Flags`, a table of id, kind, targets (each with its finding title or path), why, and check
- `## Dropped`, with reasons
- a closing line saying no gate reads the file

**Did-not-run path.** When the draft is not a JSON object, `flags` is not an array, no index exists, or `--failed` was given, the file SHALL be a did-not-run stanza with the reason.

**Exit codes.** The command SHALL exit 0 whenever the change resolves, including the did-not-run cases. With `--json` it SHALL print `{ step: "check", change, status: "drafted"|"did-not-run", flags: [ { id, kind } ], dropped: <count>, reason?, draft?, path }`. A change that does not resolve SHALL exit non-zero with `error` and `candidates`. The file SHALL never be edited by hand.

#### Scenario: Happy path — three valid flags

- **GIVEN** an index with `S1`, `S2`, `D1` and changed files `lib/a.mjs` and `lib/b.mjs`
- **WHEN** a draft with a `dismissal-doubt` on `D1`, a `shared-root-cause` on `S1` and `S2`, and an `uncovered` on `lib/b.mjs` is piped to `--check - --json`
- **THEN** the JSON reads `status: "drafted"`, flags `F1`, `F2` and `F3` with their kinds, and `dropped: 0`
- **AND** `review-advisor.md` lists the three flags with the finding titles beside `D1`, `S1` and `S2`
- **AND** the draft is persisted under `.claude/metrics/review-advisor-add-the-thing-*.json`

#### Scenario: Failure — targets that do not resolve

- **WHEN** a draft flags `D7` (absent from the index), a `shared-root-cause` on `S1` alone, and an `uncovered` on `lib/z.mjs` (not changed)
- **THEN** all three are dropped with reasons naming the unresolved target, the single survivor and the unchanged path, and `status` is `"drafted"` with no flags

#### Scenario: Failure — the draft is not JSON

- **WHEN** the text `I could not read the brief` is piped to `--check -`
- **THEN** `review-advisor.md` is a did-not-run stanza whose reason says the draft is not JSON, the JSON `status` is `"did-not-run"`, and the exit code is 0

#### Scenario: Edge case — more valid flags than the cap

- **GIVEN** a draft whose first flag has an unresolved target, followed by more valid flags than `LIMITS.maxReviewAdvisorFlags`
- **WHEN** it is checked
- **THEN** the invalid flag is dropped for its target, the first `LIMITS.maxReviewAdvisorFlags` valid flags are kept, and only the rest are dropped as `over cap`

#### Scenario: Edge case — the consult failed

- **WHEN** `interlock review-advisor add-the-thing --check --failed "spawn errored" --json` runs
- **THEN** `review-advisor.md` is a did-not-run stanza carrying `spawn errored`, and the exit code is 0

### Requirement: No gate SHALL read the advisor's file

The decisions of `interlock gate`, `interlock autonomy`, `interlock note derive`, `interlock ready`, `interlock validate`, `interlock ledger` and `interlock merge-confidence` SHALL be byte-identical whether or not `openspec/changes/<change>/review-advisor.md` exists. No flag SHALL revive a dismissed finding, change a severity, or add a compound note.

#### Scenario: Happy path — the same decisions with and without the file

- **GIVEN** a change and a review fixture
- **WHEN** each listed command runs once without `review-advisor.md` and once with a drafted one carrying a `dismissal-doubt`
- **THEN** each pair of outputs is byte-identical, and none mentions `review-advisor.md`

### Requirement: Review-code SHALL run the consult only when asked, once, and report it

`skills/review-code/SKILL.md` SHALL accept `--advisor`. Only with it, after §4's gate and note-derive lines, a `## 4a.` section SHALL:
1. pass `--advisor-brief <change>` on the review line
2. make one Agent tool call with `subagent_type: "interlock:review-advisor"` whose prompt names the brief path and nothing else
3. pipe the reply to the fenced line `interlock review-advisor "<change>" --check - --json`
4. on a brief that was not written, a spawn that errored, or no reply, run `interlock review-advisor "<change>" --check --failed "<reason>" --json` instead

The skill SHALL say the consult is never retried, reads no other file, and never changes the gate's verdict. §5 SHALL report the flag ids and kinds and the file path, or that the consult did not run with the reason. When the run resolved no OpenSpec change, the skill SHALL say the consult did not run because there is no change folder. Without `--advisor` the skill SHALL run as before. No skill prose SHALL name the model or restate a cap.

#### Scenario: Happy path — the step's lines in order

- **WHEN** the skills suite reads review-code
- **THEN** it finds `--advisor-brief`, `subagent_type: "interlock:review-advisor"`, `--check - --json` and `--check --failed`, in that order, after `interlock note derive` and before `## 5. `
- **AND** the review line still carries `--metrics` and `--base`

#### Scenario: Edge case — no flag

- **WHEN** review-code runs without `--advisor`
- **THEN** no brief is written, no review-advisor spawn happens, and §5 says nothing about the advisor

### Requirement: The verdict SHALL be tallied from Review Range labels

`interlock review-advisor --verdict --labels <evals dir> [--json]` SHALL read human calibration labels on the `matches-label` and `repeats-survivor` graders of `review-range-*` cases only. It SHALL print:
- `KEEP` when at least `LIMITS.reviewAdvisorVerdictMinLabels` cases are labelled and at least `LIMITS.reviewAdvisorKeepMinMatches` of them pass `matches-label`
- `KILL` when that many are labelled and fewer pass
- `INSUFFICIENT LABELS (<n> of <min>)` otherwise

It SHALL always exit 0. The checkpoint advisor's `interlock advisor --verdict` SHALL keep reading `spec-range-*` cases with its own graders and print the same output as before this change.

#### Scenario: Happy path — no labels yet

- **WHEN** `interlock review-advisor --verdict --labels evals` runs on a tree with no Review Range labels
- **THEN** it prints `INSUFFICIENT LABELS (0 of <min>)` and exits 0

#### Scenario: Edge case — the checkpoint verdict is unchanged

- **WHEN** `interlock advisor --verdict --labels evals` runs on the same tree
- **THEN** its output is the same as before this change
