# wave-isolation Specification

## Purpose

Keeps two tasks that are predicted to edit the same file out of the same concurrent batch, so that parallel implementers sharing one working tree cannot produce a lost write. This is the guarantee the repository advertises most prominently, and it must hold against how a path is spelled rather than only against how it is typed.

## Requirements

### Requirement: Path collision detection SHALL compare canonical paths

Two predicted paths that denote the same file in the repository SHALL be treated as a collision regardless of their textual spelling. The collision check SHALL canonicalize each predicted path once, at the boundary where it enters the planner, and every consumer of that path SHALL read the canonical form.

Rationale: the check exists to prevent concurrent writes to one file. A check keyed on raw text prevents concurrent writes only to one *string*.

#### Scenario: Happy path — two tasks naming one file are serialized

- **GIVEN** two tasks in the same group, each predicting it will edit `lib/waves.mjs`
- **WHEN** the planner chunks that group into batches
- **THEN** the two tasks are placed in different batches of the same group
- **AND** the serialization is recorded with the task ids and the path they contend on

#### Scenario: Failure — an uncanonicalized key admits a concurrent write

- **GIVEN** two tasks in the same group, one predicting `src/a.ts` and the other predicting `./src/a.ts`
- **WHEN** the planner chunks that group into batches
- **THEN** the two tasks SHALL be placed in different batches
- **AND** a planner that places them in one batch is a defect, not an acceptable prediction miss

#### Scenario: Edge case — spellings that differ only in a path-syntax artifact

- **GIVEN** a group whose tasks predict the same file under several spellings, including a leading `./`, a redundant `foo/../` segment, a trailing separator on a directory prefix, duplicated separators, and a mixture of separator characters
- **WHEN** the planner canonicalizes and chunks the group
- **THEN** every such spelling resolves to one canonical key
- **AND** all tasks naming that file are serialized against each other
- **AND** paths that genuinely denote different files are not merged by the canonicalization

### Requirement: Canonicalization SHALL NOT change which files a task is understood to touch

Canonicalizing a predicted path SHALL affect only collision keying and comparison. It SHALL NOT alter the paths reported to the user, recorded in the plan, or passed to a verification step as the changed-file set.

#### Scenario: Happy path — reports keep the authored spelling

- **GIVEN** a task whose predicted path was authored as `./lib/verify.mjs`
- **WHEN** the plan and the serialization report are written
- **THEN** the recorded path is recognizable to a reader of the task
- **AND** the canonical form is what the collision check compared

#### Scenario: Failure — an absolute or escaping path is rejected rather than normalized into scope

- **GIVEN** a predicted path that is absolute, or that escapes the repository root after canonicalization
- **WHEN** the planner canonicalizes it
- **THEN** the path is rejected as unusable for collision keying and the rejection is reported
- **AND** it SHALL NOT be silently rewritten into a repository-relative path that a task did not name

#### Scenario: Edge case — a task predicts no paths

- **GIVEN** a task that omits its predicted-paths field entirely
- **WHEN** the planner chunks its group
- **THEN** the task contends with nothing and is not serialized against any other task
- **AND** omission is treated as "unknown", never as "no files"
