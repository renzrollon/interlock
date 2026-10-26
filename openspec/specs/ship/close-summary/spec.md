# ship/close-summary Specification

## Purpose
Defines what the terminal ship summary carries beyond its degradation block so a reader who was not watching can find the run afterwards and knows the one chore the run cannot do for them: the run id and the directory the close ran in, and a reminder to archive a completed change after it merges.

## Requirements

### Requirement: The summary SHALL name the run and where it closed

Every terminal summary SHALL carry a `run: <runId>` row, a `project: <slug>` row and a `cwd: <absolute path>` row, and SHALL carry a `state home: <absolute path>` row directly under the `cwd:` row whenever the run's state home differs from the directory the close ran in, and no such row when the two are equal. `<runId>` is the trajectory's run id; when the run halted before a plan was adopted and therefore has no run id, the row SHALL read `run: none — the run halted before a plan was adopted` rather than printing an empty value. `<slug>` is the directory name the host uses under `~/.claude/projects` for the directory the close ran in: the absolute path with every character outside ASCII letters and digits replaced by `-`. The documentation SHALL state that the slug is derived from the directory the close ran in, which is the host's project directory only when the session was started there, and that the state home is where the run's corpora were written.

#### Scenario: Happy path — a clean run names itself

- **GIVEN** a run with run id `7c2f…` closing in `/Users/x/IdeaProjects/specflow`
- **WHEN** the summary is printed
- **THEN** it carries `run: 7c2f…`, `project: -Users-x-IdeaProjects-specflow` and `cwd: /Users/x/IdeaProjects/specflow`
- **AND** both hosts print the same three rows for the same run state, and no `state home:` row

#### Scenario: Happy path — a linked-worktree run names its state home

- **GIVEN** a run closing in `/r/.claude/worktrees/w1` whose state home is `/r`
- **WHEN** the summary is printed
- **THEN** it carries `cwd: /r/.claude/worktrees/w1` and, on the next row, `state home: /r`

#### Scenario: Edge case — a halt before any plan was adopted

- **GIVEN** a run that halted at validation, so the manifest carries no run id
- **WHEN** the summary is printed
- **THEN** the run row reads `run: none — the run halted before a plan was adopted`
- **AND** the project and cwd rows are still printed

#### Scenario: Edge case — the slug rule over dots, spaces and underscores

- **GIVEN** the close ran in `/Users/x/Application Support/repo/.claude/worktrees/w_1`
- **WHEN** the slug is derived
- **THEN** it is `-Users-x-Application-Support-repo--claude-worktrees-w-1`
- **AND** the derivation is a pure function of the path with no filesystem access

#### Scenario: Edge case — a halt before run start in a worktree

- **GIVEN** a close with no manifest, run from a linked worktree whose home resolves to `/r`
- **WHEN** the summary is printed
- **THEN** it carries the `cwd:` row and the `state home: /r` row, so the reader knows where a record would have gone

### Requirement: A clean completion SHALL remind the reader to archive after merge

When the run completes without a halt and every task of the change is ticked, the summary SHALL carry the line `ARCHIVE PENDING — <change>: after merge, run openspec archive <change>`. When other changes under the planning directory are also complete and unarchived, the summary SHALL add one line `also unarchived: <n> completed change(s) — run interlock drift`. The reminder SHALL NOT be printed on a halt, and SHALL NOT be printed when tasks are left unticked, because in both cases the change is not complete. The reminder SHALL NOT archive anything and SHALL NOT change the exit code: the decision to archive belongs to whoever merges.

#### Scenario: Happy path — one clean change

- **GIVEN** a run for `add-thing` that committed with every task ticked, and no other unarchived change
- **WHEN** the summary is printed
- **THEN** it carries `ARCHIVE PENDING — add-thing: after merge, run openspec archive add-thing`
- **AND** it carries no `also unarchived:` line
- **AND** the exit code is `0`

#### Scenario: Happy path — the ground was already stale

- **GIVEN** the same run, and two other changes whose tasks are all ticked still under the planning directory
- **WHEN** the summary is printed
- **THEN** it carries the `ARCHIVE PENDING — add-thing` line and `also unarchived: 2 completed change(s) — run interlock drift`

#### Scenario: Failure — a halted run is not reminded

- **GIVEN** a run halted by the failure budget
- **WHEN** the summary is printed
- **THEN** it carries no `ARCHIVE PENDING` line
- **AND** its first line is still `SHIP HALTED — <reason>`

#### Scenario: Edge case — leftovers

- **GIVEN** a run that completed with two tasks still unticked
- **WHEN** the summary is printed
- **THEN** its first line is `SHIP COMPLETE WITH LEFTOVERS — <change>` and it carries no `ARCHIVE PENDING` line

### Requirement: The new rows SHALL leave the existing contract lines untouched

Adding the identity rows and the archive reminder SHALL NOT change the summary's first line, its exit code, the `LEAN SHIP` line, or the degradation block. None of the new lines SHALL contain the substrings `LEAN SHIP` or `No degradation banners`, and the wording of each new line SHALL be pinned verbatim by a test so that a reword is a failing build rather than a silent change.

#### Scenario: Happy path — a lean run still reads as lean

- **GIVEN** a clean lean run
- **WHEN** the summary is printed with the new rows
- **THEN** the `LEAN SHIP:` line and the "No degradation banners" line are present exactly as before
- **AND** the first line is `SHIP COMPLETE — <change>`

#### Scenario: Failure — a reworded reminder

- **GIVEN** the archive reminder's wording is changed
- **WHEN** the verbatim-string test runs
- **THEN** it fails naming the line

### Requirement: A halt whose resume card was written SHALL be named in the summary

When a halted close wrote a resume card, the terminal summary SHALL carry a `  resume card: <repo-relative path>` row naming it. The path SHALL be repo-relative rather than absolute: it is printed beside the `cwd:` row and it is what a reader types.

The row SHALL be printed after the identity rows and before the archive-reminder block and the closing `Do not start another ship run unless the user asks.` line.

The row SHALL be printed only when a card was actually written. A row naming a file that is not there would be worse than no row, so a close that could not write its card reports that in the degradation block instead, and a clean close — which writes no card, having nothing to resume — carries no row at all.

Adding the row SHALL NOT change the summary's first line, its exit code, the `LEAN SHIP` line, or the degradation block.

#### Scenario: Happy path — a halt names the card it left behind

- **GIVEN** a halted run for `add-thing` whose card was written under the handoff directory
- **WHEN** the summary is printed
- **THEN** it carries a `resume card:` row naming that card's repo-relative path
- **AND** the row appears before the closing `Do not start another ship run unless the user asks.` line

#### Scenario: Failure — a card that could not be written is not named

- **GIVEN** a halted run whose card write failed and was bannered
- **WHEN** the summary is printed
- **THEN** it carries no `resume card:` row
- **AND** the degradation block names the card as not written, with the reason
- **AND** the exit code is the halt's own, unchanged

#### Scenario: Edge case — a clean close carries no row

- **GIVEN** a run that completed without a halt
- **WHEN** the summary is printed
- **THEN** it carries no `resume card:` row
- **AND** its `ARCHIVE PENDING` reminder and `LEAN SHIP` line are exactly as they were before the row existed

### Requirement: A completed run's summary SHALL carry the merge confidence the close assessed, and a halted run's SHALL carry none

When the close assessed merge confidence, the summary SHALL carry one unindented headline line that is character for character the first line the merge-confidence command prints for the same assessment: it begins `MERGE CONFIDENCE`, then names the verdict, the score, the score's range and how many gating signals are clean. Under it the summary SHALL carry, indented, one row per group of driving signals that has an entry, listing the signal identifiers: `needs a fix:`, `needs a person:` and `needs more evidence:`, in that order; a `flags:` row when any signal carries a flag, naming each signal with its flag; and an `assessment:` row naming the evidence file's path relative to the directory the close ran in. A group with no entry SHALL print no row. The rows SHALL carry identifiers and flags only: no reason and no evidence text.

The block SHALL be printed after the identity rows and before the archive reminder and the closing `Do not start another ship run unless the user asks.` line. A halted run's summary SHALL carry no line of the block. When the evidence file could not be written, the `assessment:` row SHALL NOT be printed, and the degradation block SHALL say the file was not written. When no assessment could be made, no line of the block SHALL be printed, and the degradation block SHALL say so.

Adding the block SHALL NOT change the summary's first line, its exit code, the `LEAN SHIP` line, or the degradation block's existing lines. No line of the block SHALL contain the substrings `LEAN SHIP` or `No degradation banners`, and the wording of the headline and of each row label SHALL be pinned verbatim by a test.

#### Scenario: Happy path — a completed run prints its verdict and what drives it

- **GIVEN** a completed run whose assessment is `HUMAN`, driven by one signal that needs a person and two that need more evidence, with one flag
- **WHEN** the summary is printed
- **THEN** it carries the `MERGE CONFIDENCE HUMAN` headline with the score, the range and the clean count
- **AND** under it a `needs a person:` row naming one signal, a `needs more evidence:` row naming two, a `flags:` row naming the signal and its flag, and an `assessment:` row naming the evidence file
- **AND** it carries no `needs a fix:` row, and the block sits above the `ARCHIVE PENDING` line

#### Scenario: Failure — a halted run prints no merge confidence

- **GIVEN** a run halted by the failure budget
- **WHEN** the summary is printed
- **THEN** it carries no line beginning `MERGE CONFIDENCE` and no `assessment:` row
- **AND** its first line is still `SHIP HALTED — <reason>`

#### Scenario: Edge case — the headline is the command's own

- **GIVEN** one assessment, printed by the merge-confidence command and by a run's close
- **WHEN** the two outputs are compared
- **THEN** the close summary's headline line equals the command's first line exactly

#### Scenario: Edge case — an evidence file that could not be written is not named

- **GIVEN** a completed run whose assessment was made and whose evidence file could not be written
- **WHEN** the summary is printed
- **THEN** it carries the headline and the group rows, and no `assessment:` row
- **AND** the degradation block names the file as not written, with the reason
- **AND** the `LEAN SHIP` line and the exit code are as they would be without the block

### Requirement: A clean completion that made a commit SHALL name the settle step

On a close that did not halt, recorded a commit and left no leftover tasks, the summary SHALL print, directly before the archive reminder, the line `NEXT — push the branch and open the pull request: /interlock:settle --create --review`. A halted run, a close that recorded no commit, and a close with leftovers SHALL print no such line. The existing contract lines SHALL be untouched.

Rationale: the only shipped text naming `/interlock:settle` was one line in the commit skill, and the summary a person reads after a ship ended in an instruction not to start another run, answering a question nobody asked.

#### Scenario: Happy path — a clean committed close

- **GIVEN** a closed summary that did not halt, with a commit recorded and no leftovers, for a change not yet archived
- **WHEN** the summary is rendered
- **THEN** the `NEXT —` line names `/interlock:settle --create --review`
- **AND** it precedes the `ARCHIVE PENDING` line, and `Do not start another ship run unless the user asks.` still follows

#### Scenario: Failure — a halt, and a close with no commit

- **GIVEN** a halted summary, and a clean summary whose commit was skipped or failed
- **WHEN** each is rendered
- **THEN** neither carries a `NEXT —` line
- **AND** every line the halt carried before this requirement is still present

#### Scenario: Edge case — leftovers

- **GIVEN** a clean committed close with one leftover task
- **WHEN** the summary is rendered
- **THEN** it carries no `NEXT —` line and no archive reminder
- **AND** a lean run's `LEAN SHIP` line is unchanged
