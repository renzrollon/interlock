<!-- interlock briefing v1 label=plan-waves sha256=2bb023bcfadb023149f01f54517f869ab0452e864ddd82614983985c8a05a0f0 -->
For OpenSpec change "fixture-change": read proposal.md, design.md, tasks.md and specs/**/*.md in full — this is the artifact leash and is not subject to bounded retrieval.

Classify every UNCHECKED task with: id, group (wave number), description, tier 1-5, model, isTestTask, paths, and dependsOn.

GROUPING — four rules, in order:
  1. Default group to the numbered tasks.md section (1.x → group 1, 2.x → group 2).
  2. A shared file is NOT a reason for a new group. Put the predicted edit paths in `paths` and let the planner fold colliding tasks into one LANE of the SAME wave — an ordered task list run by a single agent. Inventing a new group to avoid a file clash costs a verification cycle; naming the path costs nothing and saves a spawn.
  3. A dependency on a task editing a DIFFERENT file is a reason for a `dependsOn` EDGE, not a reason to increment `group`. Incrementing `group` to order one cross-file dependency serializes every task in the new group that is independent of it; an edge orders only the dependent task, so its independent siblings keep sharing a batch. Prefer the edge.
  4. Only add a group for a LATER NUMBERED SECTION that needs an earlier section's output to already exist. The next sequential slice of the same file is NOT a new group — it stays in that file's section group and becomes a later batch. Groups run sequentially; tasks in a group are otherwise independent.

`paths` is your best prediction of the repo-relative files the task will edit. Predict what you can and OMIT the field when you genuinely cannot — an invented path serializes a batch for nothing, while an omitted one only leaves things as they were.

`dependsOn` is the array of ids of EARLIER tasks whose output this task needs — the file it imports, the type it consumes, the helper it calls. Populate it whenever that is true, and omit it otherwise. Every id must name a task in this same classification, must not point at a later numbered section, and must not point at a test task; the edges must not form a cycle. A dangling id, a backward edge or a cycle FAILS the plan rather than being dropped, so declare only dependencies you can point at.

MODE — beside the task array, emit a top-level "recommendedMode" of "solo" or "waves" and a one-line "modeReason" saying why. Solo means one agent implements this whole change by itself, task by task in the planned order, with no parallel waves and no isolation between tasks; waves means the ordinary parallel plan. Recommend solo when the change is small and tightly coupled enough that one agent holding all of it beats several agents each holding a slice, and waves otherwise. Judge the shape only: the planner enforces the published envelope on how large a change may ship solo and will refuse a recommendation above it, so do not reason about the size bound and do not state one.

Tier 1 trivial one-file edit → haiku. Tier 2 single-concern change. Tier 3 new logic in one domain. Tier 4 cross-file work following existing patterns — a mechanical refactor across many files is tier 4 sonnet, because breadth is not depth. Tier 5 only for genuinely novel architecture, and only tier 5 may be opus. When unsure, sonnet.

Write the classification as { "tasks": [...] } to .claude/ship/classified.json. Do NOT run the interlock CLI yourself — the orchestrator runs the planner, the coverage check and the state machine. Report only whether the file was written and how many tasks it holds.

The planner is authoritative: it clamps over-eager opus, orders the waves, defers test tasks and splits wide waves into batches. Do not re-derive or override any of it.

You are one step of an automated ship run. Do not ask questions — there is no one listening. If something is undecidable, put it in the result fields rather than guessing at product intent.