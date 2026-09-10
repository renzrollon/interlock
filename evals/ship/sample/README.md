# A scratch root a run would have left, without the run

`clean-run.json` describes the state a clean loop-arm run over the
`docs-and-code` fixture leaves behind: which tasks its state machine recorded as
done, and every trajectory event it wrote, ending in a receipt.

`process-runs.json` is the same idea for the *process* criteria: several named
trajectories a loop might leave, each declaring the status the walker in
`evals/ship/trajectory.mjs` must reach on it — a completed run missing its
verify judgement, a completed run missing its receipt, an invented `action`, a
unit-red judgement closed with `run-complete` and the same one closed with
`run-halt`, and an honest halt before verification. Every one of them passes
`interlock run-log check`, deliberately: a process fixture that failed
reconstructability would prove nothing about the process criteria, because the
existing criterion would already have caught it. The unknown-`type` direction is
absent from the file because `appendRunLogEvent` refuses to write one — that
case is a hand-built record list in the test.

## Why it exists

The graders are the part of the outcome eval that must be right before a single
metered call is made, and they are the part hardest to exercise — reaching them
the ordinary way costs a model, a credential and several minutes. So the sample
is the model-free stand-in: `test/spine/ship-graders.test.mjs` lays a fixture's
starting state into a scratch root, applies the fixture's reference
implementation, ticks what the sample says the run recorded, writes these events
through `lib/run-log.mjs`'s own writer, commits, and then runs the real graders
against it. Every criterion resolves from the exit code of a command the CLI
already ships.

It also lets the failing direction be tested cheaply. Untick a task the sample
records as done and the tick criterion fails; delete a test file and the
weakened-suite check fails; drop the commit and the commit criterion fails. None
of that needs a model either.

## Why it is data rather than a committed `.jsonl`

The events are laid down through `appendRunLogEvent`, not copied onto disk as a
finished trajectory file. A committed `.jsonl` would carry a `schema`, a `seq`
and a field set frozen at the moment someone pasted it, and would keep passing
`run-log check` for months after the writer had moved on — a fixture for a shape
nothing writes any more. Going through the writer means the sample cannot drift
from what a real run produces: if the writer changes, this changes with it or
the test fails.

`<HEAD>` in the receipt's `commit` field is replaced with the scratch
repository's head commit by whoever lays the sample down. A committed sha would
be a sha for a commit that does not exist.

## Not a fixture

This directory holds no `fixture.json`, so `evals/ship/fixtures.mjs` does not
discover it and no eval run copies it anywhere. It is test input, and the only
thing that reads it is the grader test.
