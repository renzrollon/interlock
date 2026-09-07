# Outcome-eval fixtures

Each directory here is one fixture: a complete, minimal repository holding one
OpenSpec change that the ship loop is asked to implement end to end. The eval
grades what is on disk afterwards, so a fixture is an *input*, never a case, and
never a place a run writes to.

Fixtures are copied to a scratch root outside this repository before anything
runs. Nothing under this directory is ever executed in place — see
`evals/ship/README.md` and `openspec/specs/evals/outcome-fixtures/`.

## Layout

```
<fixture-id>/
  FIXTURE.md      the description, in the format below
  fixture.json    the machine-readable declarations the suite asserts on
  start/          the fixture repository as the loop first sees it (copied whole)
  reference/      a known-correct solution, overlaid onto a copy of start/
```

`start/` is a repository root: it carries its own `package.json`, its own
`test/`, its own `.claude/testing/profile.json` naming the unit command, and its
own `openspec/changes/<change>/`. It depends on nothing outside itself — no
network, no install step, and no file from the repository that carries it.

`reference/` mirrors the paths it replaces or adds under `start/`. Applying it
means copying it over a copy of `start/`. It is held outside the starting state
so the starting state stays unimplemented, and it includes the change's
`tasks.md` with every box ticked, because "solvable" means the suite goes green
*and* no task is left over.

## The description format

`FIXTURE.md` carries exactly these two headings, in this order, and the suite
asserts both are present:

```markdown
# <fixture-id>

## Shape

Which shape this fixture exercises, and what in the loop that shape puts under
load.

## What a failure here means

What a reader should conclude if the loop fails this fixture and passes the
others — stated as a claim about the loop, not as a score.
```

A fixture whose failure would mean the same thing as another fixture's failure
is a duplicate shape and adds cost without adding signal.

## `fixture.json`

```json
{
  "schema": "interlock.ship-eval-fixture/1",
  "id": "<fixture-id>",
  "change": "<the change name under start/openspec/changes/>",
  "shape": "<short shape label, matching the FIXTURE.md heading content>",
  "taskArtifacts": { "<task id>": ["<path relative to the repository root>"] },
  "taskDependencies": [{ "task": "<task id>", "dependsOn": ["<task id>"] }]
}
```

`taskArtifacts` names, for every task id in `tasks.md`, the paths that task must
have produced or changed. The suite asserts the map is total over the task ids
and that every path exists once the reference implementation is applied — so a
reference that goes green while quietly skipping a task fails here rather than
in a metered run.

`taskDependencies` records the tasks that consume an earlier task's output. It
must be non-empty: a change with no such task would never exercise the wave loop
the eval exists to measure.
