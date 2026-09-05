// The wave-classification briefing.
//
// This text lived in both drivers, worded differently in each — the one place
// classifier policy demonstrably drifted, since the same task could classify
// differently depending on which host ran it. A cross-driver parity test
// compared the extracted tier boundaries after the fact. There is nothing left
// to compare: the CLI assembles this once and hands it to whichever host is
// running (design D7).
//
// The form is the ACP driver's — the model writes `classified.json` and reports
// whether it did. It never runs the interlock CLI; `interlock run classified`
// does coverage, waves, the plan file and `wave-state create` afterwards. The
// rules themselves are the Workflow driver's fuller wording, verbatim.

/**
 * @param {{ change: string, classifiedPath: string }} input
 * @returns {string}
 */
export function assemblePlannerPrompt({ change, classifiedPath }) {
  return (
    `For OpenSpec change "${change}": read proposal.md, design.md, tasks.md and specs/**/*.md in full — ` +
    `this is the artifact leash and is not subject to bounded retrieval.\n\n` +
    `Classify every UNCHECKED task with: id, group (wave number), description, tier 1-5, model, ` +
    `isTestTask, paths, and dependsOn.\n\n` +
    `GROUPING — four rules, in order:\n` +
    `  1. Default group to the numbered tasks.md section (1.x → group 1, 2.x → group 2).\n` +
    `  2. A shared file is NOT a reason for a new group. Put the predicted edit paths in \`paths\` ` +
    `and let the planner fold colliding tasks into one LANE of the SAME wave — an ordered task ` +
    `list run by a single agent. Inventing a new group to avoid a file clash costs a verification ` +
    `cycle; naming the path costs nothing and saves a spawn.\n` +
    `  3. A dependency on a task editing a DIFFERENT file is a reason for a \`dependsOn\` EDGE, ` +
    `not a reason to increment \`group\`. Incrementing \`group\` to order one cross-file dependency ` +
    `serializes every task in the new group that is independent of it; an edge orders only the ` +
    `dependent task, so its independent siblings keep sharing a batch. Prefer the edge.\n` +
    `  4. Only add a group for a LATER NUMBERED SECTION that needs an earlier section's output ` +
    `to already exist. The next sequential slice of the same file is NOT a new group — it stays ` +
    `in that file's section group and becomes a later batch. Groups run sequentially; tasks in a ` +
    `group are otherwise independent.\n\n` +
    `\`paths\` is your best prediction of the repo-relative files the task will edit. Predict what you ` +
    `can and OMIT the field when you genuinely cannot — an invented path serializes a batch for ` +
    `nothing, while an omitted one only leaves things as they were.\n\n` +
    `\`dependsOn\` is the array of ids of EARLIER tasks whose output this task needs — the file it ` +
    `imports, the type it consumes, the helper it calls. Populate it whenever that is true, and ` +
    `omit it otherwise. Every id must name a task in this same classification, must not point at ` +
    `a later numbered section, and must not point at a test task; the edges must not form a cycle. ` +
    `A dangling id, a backward edge or a cycle FAILS the plan rather than being dropped, so declare ` +
    `only dependencies you can point at.\n\n` +
    `MODE — beside the task array, emit a top-level "recommendedMode" of "solo" or "waves" and a ` +
    `one-line "modeReason" saying why. Solo means one agent implements this whole change by ` +
    `itself, task by task in the planned order, with no parallel waves and no isolation between ` +
    `tasks; waves means the ordinary parallel plan. Recommend solo when the change is small and ` +
    `tightly coupled enough that one agent holding all of it beats several agents each holding a ` +
    `slice, and waves otherwise. Judge the shape only: the planner enforces the published envelope ` +
    `on how large a change may ship solo and will refuse a recommendation above it, so do not ` +
    `reason about the size bound and do not state one.\n\n` +
    // A unary `+` once sat before this operand and coerced it to NaN, so tiers
    // 1-3 and the haiku routing rule never reached the classifier while the
    // sentence stayed intact in the source bytes. test/spine/prompts.test.mjs
    // asserts the ASSEMBLED string for exactly that reason.
    `Tier 1 trivial one-file edit → haiku. Tier 2 single-concern change. Tier 3 new logic in one ` +
    `domain. Tier 4 cross-file work following existing patterns — a mechanical refactor across many ` +
    `files is tier 4 sonnet, because breadth is not depth. Tier 5 only for genuinely novel ` +
    `architecture, and only tier 5 may be opus. When unsure, sonnet.\n\n` +
    `Write the classification as { "tasks": [...] } to ${classifiedPath}. ` +
    `Do NOT run the interlock CLI yourself — the orchestrator runs the planner, the coverage check ` +
    `and the state machine. Report only whether the file was written and how many tasks it holds.\n\n` +
    `The planner is authoritative: it clamps over-eager opus, orders the waves, defers test tasks ` +
    `and splits wide waves into batches. Do not re-derive or override any of it.`
  )
}
