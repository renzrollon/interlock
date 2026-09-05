# dependent-export

## Shape

A change whose second task consumes an export the first task creates: task 1.1
adds a token table, task 1.2 adds a resolver that imports it. Nothing else in
the change is interesting — the whole fixture is one edge in the dependency
graph, held as narrowly as it can be held.

This puts the planner's dependency detection under load in isolation. Both tasks
are trivially small, so a run that fails here failed at ordering, not at writing
either file.

## What a failure here means

The loop dispatched the consumer before the producer — batching two tasks into
one wave when one of them imports the other's file, so the consumer's implementer
saw a module that did not exist yet and either invented the export, stubbed it,
or reported the task blocked. A failure here alongside a `docs-and-code` pass
narrows the fault to the ordering decision itself rather than to classification.
