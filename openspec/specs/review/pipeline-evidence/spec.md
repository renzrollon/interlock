# review/pipeline-evidence Specification

## Purpose
Turns a platform's own check output into the pipeline input the merge verdict reads, by code, so no model transcribes a check's state and a result the platform did not give never reads as a pass.

## Requirements

### Requirement: The pipeline input SHALL be produced by the CLI from the platform's own output, offline

`interlock pipeline` SHALL read a JSON document the caller obtained from the platform's own CLI, from a file or from standard input, and SHALL produce the pipeline input `interlock merge-confidence --pipeline` reads: the commit the checks belong to, one entry per check carrying its name, its state as one of `pass`, `fail`, `pending` or `skipped`, and whether the platform requires it, and the names of any checks the caller excluded. The transformation, the four states and the rule for what a well-formed pipeline input is SHALL live in `lib/pipeline.mjs` as pure functions. The command SHALL NOT call `gh`, `glab` or the network. The input SHALL carry names and states only, and SHALL NOT carry a check's link, description or log text. With `--out <file>` the command SHALL write the input to the file, creating the directories above it; with `--json` it SHALL print the same object on standard output.

A document that is not JSON, or is not the document the chosen platform flag expects, SHALL exit 1 with the reason on standard error and nothing on standard output. When `--out` names a file that already exists and the command produces no input, the command SHALL remove that file and SHALL say so on standard error, so that an earlier input is never left where the next command would read it.

Rationale: the state of a check decides whether the verdict can read `MERGE`. A mapping written as prose in a skill is a mapping a model applies differently on every run; a mapping in code is one a test can hold. An output path that keeps its last good file after a refusal hands the next command evidence about an earlier moment.

#### Scenario: Happy path — a pull request's checks become the pipeline input

- **GIVEN** the document `gh pr view --json headRefOid,statusCheckRollup` prints for a pull request whose head commit has three completed, successful check runs
- **WHEN** `interlock pipeline --github <file> --out <path>` runs
- **THEN** the file at the path carries the head commit as `sha` and three entries, each with its name, the state `pass` and `required: false`
- **AND** no entry carries a link, a description or a timestamp

#### Scenario: Failure — a document that is not the expected one is refused, and an earlier input does not survive it

- **GIVEN** a file holding the array `gh pr checks --json` prints, and an output path that already holds an earlier pipeline input
- **WHEN** `interlock pipeline --github <file> --out <path>` runs
- **THEN** it exits 1, standard error says the document carries no head commit and no check list, and standard output is empty
- **AND** the file at the output path no longer exists, and standard error says it was removed

#### Scenario: Edge case — the document arrives on standard input and the output directory does not exist

- **GIVEN** the pull request document piped to `interlock pipeline --github - --out <dir>/pipeline.json`, where the directory does not exist
- **WHEN** the command runs
- **THEN** the directory is created and the file is written
- **AND** the command made no network request

### Requirement: A GitHub check's state SHALL be read from a published table, and an unfinished or unknown result SHALL read pending

For a check run, a status other than completed SHALL read `pending`. A completed check run SHALL read `pass` for the conclusion success; `skipped` for neutral and skipped; `fail` for failure, timed out, action required and startup failure; and `pending` for cancelled, stale and any conclusion the table does not name. A commit status SHALL read `pass` for success, `fail` for failure and error, and `pending` otherwise. When the platform reports the same check more than one time (a re-run), the entry SHALL be read from the one that started last. When a start time among them cannot be read (absent, not a date, or the platform's zero time), no run can be called the last: the entry SHALL read the least favourable state among the last timed run and every untimed one, in the order `fail`, `pending`, `skipped`, `pass`, and the command SHALL name the check on standard error. The order the document lists the runs in SHALL NOT decide which is read. The `sha` SHALL be the head commit the document itself carries, never one read from the local repository. A document whose check list is present and empty SHALL produce an input with no checks; a document with no check list SHALL be refused.

Rationale: a cancelled or unknown result is a result the platform did not give. Reading it as a pass would grant a merge on nothing; reading it as a failure would report a defect nobody found.

#### Scenario: Happy path — each named conclusion maps to its state

- **GIVEN** a document with one check run per conclusion the table names and one commit status per state
- **WHEN** the pipeline input is produced
- **THEN** each entry carries the state the table gives for it

#### Scenario: Failure — a conclusion the table does not name never reads pass

- **GIVEN** a completed check run whose conclusion is a value the table does not name
- **WHEN** the pipeline input is produced
- **THEN** its entry reads `pending`
- **AND** the merge verdict assessed with that input cannot read `MERGE`

#### Scenario: Edge case — a re-run, a cancelled run and an empty list

- **GIVEN** three documents: one where a check failed and a later run of the same check passed, one with a cancelled check run, and one whose check list is empty
- **WHEN** each is turned into a pipeline input
- **THEN** the first carries one entry for that check, reading `pass`
- **AND** the second reads the cancelled check `pending`
- **AND** the third carries the head commit and no checks

#### Scenario: Failure — a re-run with no start time does not hide a failure

- **GIVEN** a document in which a required check failed with a start time, and a run of the same check passed with none, listed after it
- **WHEN** the pipeline input is produced
- **THEN** it carries one entry for that check, reading `fail`, and standard error names the check and says its runs could not be ordered
- **AND** the merge verdict assessed with that input is `BLOCK`, whichever of the two the document lists last

### Requirement: Required checks SHALL be named by the caller for GitHub and read from the job for GitLab, and a mistake SHALL NOT turn a reported check green

For GitHub, each name given with `--required` SHALL mark the check of that exact name as required; every other check SHALL be not required. The flag SHALL be repeatable, and every name given SHALL be kept. A required name that matches no reported check SHALL produce an entry of that name with the state `pending` and `required: true`, unless the same name is excluded. With no `--required` given, the command SHALL say on standard error that the required set was not given. For GitLab, a job SHALL be required when its `allow_failure` is false.

Rationale: the list of required checks comes from a second platform call the caller makes. Getting it wrong can move a failed check between "needs a fix" and "needs more evidence"; it can never make a check the platform reported as failed or unfinished read as passed. A required check that has not reported at all is visible only when it is named, which is why the unmatched name becomes an entry.

#### Scenario: Happy path — two named checks are required and the rest are not

- **GIVEN** a document with the checks `unit`, `lint` and `docs`, and `--required unit --required lint`
- **WHEN** the pipeline input is produced
- **THEN** `unit` and `lint` carry `required: true` and `docs` carries `required: false`

#### Scenario: Failure — a required check the platform has not reported is pending, not absent

- **GIVEN** a document with the single passing check `lint`, and `--required unit`
- **WHEN** the pipeline input is produced
- **THEN** it carries an entry `unit` with the state `pending` and `required: true`
- **AND** the merge verdict assessed with that input reads the pipeline signal unobserved

#### Scenario: Edge case — no required set is given

- **GIVEN** a document with one failed check and no `--required`
- **WHEN** the pipeline input is produced
- **THEN** the failed check carries `required: false` and standard error says the required set was not given
- **AND** the merge verdict assessed with that input reads the pipeline signal amber, never green

### Requirement: A GitLab pipeline SHALL be read from the merge request's head pipeline, for the head commit the merge request itself states

GitLab SHALL be read in two steps, and no commit SHALL be typed by the caller. `interlock pipeline --gitlab-mr <file> --out <path>` SHALL read the merge request document `glab mr view <iid> --output json` prints. A document without a head commit, or without a `head_pipeline` key, SHALL be refused. When `head_pipeline` is null the command SHALL write a pipeline input with the merge request's head commit and no checks. When it names a pipeline the command SHALL write a pending record carrying the head commit and the pipeline's identifier and no check list, which is not a well-formed pipeline input and which `interlock merge-confidence` therefore refuses.

`interlock pipeline --gitlab <file> --mr <path> --out <path>` SHALL read the document `glab ci get --merge-request <iid> --output json` prints, and the pending record. It SHALL refuse a pipeline whose identifier is not the one the record names. A job SHALL read `pass` for success, `fail` for failed, `skipped` for skipped, `skipped` for a manual job that is allowed to fail, and `pending` for every other status, a manual job that is not allowed to fail included. The `sha` of the input SHALL be the head commit the record carries. When the pipeline's reference is not a merged-result or merge-train reference and the pipeline's own commit differs from that head, the command SHALL exit 1 naming both commits.

Rationale: a merged-result pipeline runs on a commit the platform made, so its own commit never equals the head; the merge request is the platform's statement of which commit the head pipeline answers for. Carrying that commit from one command to the next in a file keeps it out of anyone's hands, and "no pipeline" has to be something the platform said, not an error message somebody read.

#### Scenario: Happy path — a branch pipeline for the head commit

- **GIVEN** a pending record for a head commit and a pipeline, and that pipeline's document on a branch reference with the same commit, holding a successful job that is not allowed to fail, a failed job that is allowed to fail and a failed job that is not
- **WHEN** `interlock pipeline --gitlab <file> --mr <path> --out <path>` runs
- **THEN** the input carries the head commit, the first job as `pass` and required, the second as `fail` and not required, and the third as `fail` and required

#### Scenario: Failure — another pipeline, another commit, or a document missing the key

- **GIVEN** a pipeline document whose identifier differs from the record's; a branch pipeline document whose commit differs from the record's head; and a merge request document with no `head_pipeline` key
- **WHEN** each is given to its flag
- **THEN** each exits 1 naming what did not match or what was missing, and no pipeline input is left at the output path

#### Scenario: Edge case — a merged-result pipeline, a manual job and no pipeline at all

- **GIVEN** a pipeline document on a merged-result reference whose own commit differs from the record's head, holding a manual job that is not allowed to fail; and a merge request document whose `head_pipeline` is null
- **WHEN** each is given to its flag
- **THEN** the first produces an input whose `sha` is the record's head and whose manual job reads `pending` and required
- **AND** the second produces an input with the merge request's head commit and no checks

#### Scenario: Edge case — the second step never ran

- **GIVEN** a pending record written for a merge request that has a head pipeline, and no second step
- **WHEN** `interlock merge-confidence --pipeline <path>` is given the record
- **THEN** it exits 1 saying the file carries no check list, and prints no verdict

### Requirement: An excluded check SHALL be left out by exact name, recorded in the input, and never dropped silently

Each name given with `--exclude` SHALL leave out the check of that exact name and SHALL be recorded under `excluded` in the input. The flag SHALL be repeatable, and every name given SHALL be kept. An exclusion SHALL also apply to a required name that matched no reported check: no pending entry SHALL be produced for it, and the name SHALL be recorded. A name that matches neither a reported check nor a required name SHALL be reported on standard error and SHALL NOT be recorded. An exclusion SHALL NOT be a pattern: no character in the name is special.

Rationale: a check whose own result depends on the verdict, such as a job that fails until the merge request is labelled, cannot be evidence for that verdict; counted, it holds the verdict away from `MERGE` for ever, whether it has reported yet or not. Leaving it out has to be the caller's stated act, visible wherever the verdict is shown.

#### Scenario: Happy path — the gate's own check is left out and named

- **GIVEN** a document with a passing check `unit` and a failing required check `merge-gate`, and `--exclude merge-gate`
- **WHEN** the pipeline input is produced
- **THEN** it carries one entry, `unit`, and `excluded` holds `merge-gate`

#### Scenario: Failure — an exclusion is never a pattern

- **GIVEN** a document with the failing checks `test-a` and `test-b`, and `--exclude "test-*"`
- **WHEN** the pipeline input is produced
- **THEN** both checks are entries, `excluded` is empty, and standard error says the name matched no check

#### Scenario: Edge case — a required gate check that has not reported, and two exclusions

- **GIVEN** a document with the passing checks `unit` and `lint`, `--required merge-gate`, and `--exclude merge-gate --exclude lint`
- **WHEN** the pipeline input is produced
- **THEN** it carries one entry, `unit`, and no pending entry for `merge-gate`
- **AND** `excluded` holds `merge-gate` and `lint`
