# docs-and-code

## Shape

A change that mixes documentation work with code work, and whose later tasks
consume what the earlier ones produced: two formatter tasks, a task that
composes both formatters into a summary, and a documentation task that must name
all three exports in `README.md`.

This puts the planner's classification under load — a documentation task and a
code task carry different verification, and the plan has to keep the composing
task behind the two it composes — and it puts the wave state machine under load,
because the dependency chain is two levels deep.

## What a failure here means

The loop cannot carry a mixed change: either it classified the documentation
task as code (or the reverse) and verified it against the wrong thing, or it
flattened the dependency chain and ran the composing task against exports that
did not exist yet. A failure here alongside passes elsewhere points at
classification and ordering, not at implementation ability — every individual
task in this fixture is small.
