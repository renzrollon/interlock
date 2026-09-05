// The text a wave implementer is handed is a contract, not a convenience.
//
// It used to live inline in `workflows/ship.js`, marked so a test could eval it
// out of the script's source, because the Workflow runtime rejects a script that
// loads modules at all. Now the CLI assembles every briefing and the script only
// carries the path and the hash of the file it wrote (design D2), so this text
// can live where every other piece of policy lives: in `lib/`, imported, read by
// one party.
//
// The fixtures under `test/fixtures/prompts/` are the contract. Changing the
// assembled text has to be a deliberate act that updates a file, not a side
// effect of editing nearby control flow.

export function assembleImplementerPrompt({ change, lane, task, previousHandoffs, isolateWaves, solo }) {
  // A lane is the unit now; a bare `task` is still accepted and means a lane of
  // one. That is not politeness to old callers — a one-task lane MUST assemble
  // byte-identically to the pre-lane prompt, and sharing one code path is the
  // only way that stays true as this text is edited.
  const tasks = (Array.isArray(lane) && lane.length ? lane : [task]).filter(
    t => t && typeof t === 'object'
  )
  const first = tasks[0] || { id: '(unknown)', description: '', tier: 1 }
  // The lane runs on its hardest task's ladder: one agent must be briefed for
  // everything it is about to do, and a tier is a floor, not an average.
  //
  // A solo lane is the whole change, so it is briefed at the full-read ladder
  // however cheap its hardest task looks: the agent has no other wave to inherit
  // context from and no sibling to compare notes with. This raises the BRIEFING
  // only — the tasks keep the tiers the classifier gave them, because tier is
  // what effort and the promotion report are read from and rewriting it here
  // would misreport both (design D7).
  const soloLane = solo === true
  const laneTier =
    tasks.reduce((m, t) => (Number.isInteger(t.tier) && t.tier > m ? t.tier : m), 0) || 1
  const tier = soloLane ? Math.max(laneTier, 4) : laneTier

  const packets = (Array.isArray(previousHandoffs) ? previousHandoffs : []).filter(
    h => h && typeof h === 'object'
  )

  // Empty renders nothing at all, so a first wave's prompt is byte-identical to
  // what it was before handoffs existed and its snapshot stays stable.
  const previous = packets.length
    ? `\nPREVIOUS WAVE (schema-validated; do not re-derive from git):\n` +
      packets
        .map(
          h =>
            `- [${h.taskId} ${h.status}] ${h.summary}\n` +
            `  evidence: ${(Array.isArray(h.evidence) ? h.evidence : []).join(', ')}\n` +
            `  next: ${h.next}` +
            (h.blocker ? `\n  blocker: ${h.blocker}` : '')
        )
        .join('\n') +
      `\n`
    : ''

  // A lane of one renders exactly the text it rendered before lanes existed —
  // the single-task fixtures are the pin that keeps that honest.
  const single = tasks.length === 1

  const list =
    tasks.map((t, i) => `TASK ${i + 1}/${tasks.length} — ${t.id}: ${t.description}`).join('\n') +
    `\n\n`

  // The multi-task heading used to say the tasks "edit the same files". That was
  // true when a lane could only be a path-collision component; a cohesion lane
  // packs path-DISJOINT tasks, so the sentence became a false statement handed
  // to every implementer. What replaced it is true of every lane there is: one
  // agent owns it, and nothing else is writing what it claims.
  const heading = single
    ? `Implement exactly one task from OpenSpec change "${change}".\n\n` +
      `TASK ${first.id}: ${first.description}\n\n`
    : soloLane
      ? `Implement OpenSpec change "${change}" end to end — all ${tasks.length} of its tasks, IN ` +
        `THIS ORDER. You are the only implementer on this change: you own every task listed below, ` +
        `including its test tasks, and no other agent is touching this repository while you work.\n\n` +
        list
      : `Implement ${tasks.length} tasks from OpenSpec change "${change}", IN THIS ORDER. They are ` +
        `one lane run by you alone — no other agent touches the files they claim while you ` +
        `work.\n\n` +
        list

  const scope = single
    ? `- Implement ONLY this task. Do not modify files outside its scope.\n`
    : `- Implement ONLY these tasks, in the order listed. Do not modify files outside their scope.\n` +
      `- Finish a task before starting the next one. Do not skip ahead, and do not do a later ` +
      `task's work under an earlier task's name.\n` +
      `- STOP at the first task you cannot complete. Report it as failed and report every task ` +
      `after it as not-attempted — do not continue past a failure.\n`

  const handoff = single
    ? `\nHANDOFF — the next wave reads your packet instead of reconstructing your work ` +
      `from git, so every result MUST carry one:\n` +
      `  { "schema": "interlock.wave-handoff/1", "taskId": "${first.id}", ` +
      `"status": "ok" | "blocked" | "partial",\n` +
      `    "summary": "...", "evidence": ["path:12-40"], "next": "...", "blocker": null }\n`
    : `\nHANDOFF — the next wave reads your packets instead of reconstructing your work ` +
      `from git. Report an outcome for EVERY task you were given:\n` +
      `  { "tasks": [ { "id": "<task id>", "outcome": "ok" | "failed" | "not-attempted",\n` +
      `      "handoff": { "schema": "interlock.wave-handoff/1", "taskId": "<same id>", ` +
      `"status": "ok" | "blocked" | "partial",\n` +
      `        "summary": "...", "evidence": ["path:12-40"], "next": "...", "blocker": null } } ] }\n` +
      `- One packet per task you ATTEMPTED, keyed by its own id. One packet cannot stand in for ` +
      `several tasks.\n` +
      `- A "not-attempted" task carries no packet. That absence is expected, not an error.\n` +
      `- A result that omits a task you were given fails every task in this lane, so report all ` +
      `${tasks.length}.\n` +
      `- Do not pass a packet between your own tasks — you already know what you just did.\n`

  // Rendered only under --isolate-waves. Absent, this function must produce
  // the exact prompt it produced before worktree isolation existed — that
  // byte-identity is what the implementer-prompt fixtures pin.
  const isolation = isolateWaves
    ? `\nISOLATION — you are running in your own git worktree, not the shared tree. Before you ` +
      `report your result, run \`pwd\` and report its output as "worktreePath" in your result, ` +
      `exactly as printed. The orchestrator has no other way to find your worktree, and folds your ` +
      `writes back into the shared tree using that path, so it must be the real one, not a guess.\n`
    : ''

  return (
    heading +
    `CONTEXT — read only what your tier needs:\n` +
    `  tier 1: the task description alone\n` +
    `  tier 2+: the relevant section of openspec/changes/${change}/design.md\n` +
    `  tier 3+: the relevant file under openspec/changes/${change}/specs/\n` +
    `  tier 4+: design.md and the specs in full\n` +
    `Your tier is ${tier}.\n\n` +
    `RULES:\n` +
    scope +
    `- Do not fix unrelated problems you notice; report them instead.\n` +
    `- Run typecheck and lint on what you changed.\n` +
    `- Do not commit, and do not edit tasks.md — the orchestrator owns both.\n` +
    `- If .claude/graph/graph.json exists, interlock-graph query / consumers before grep.\n` +
    `- Locate (graph or grep) then Read spans. Do not re-read a file unless it changed.\n` +
    `- Return the schema only. No narrative.\n` +
    (tier <= 2
      ? `- If your tier is 1 or 2: after typecheck/lint pass, stop. Do not refactor or polish.\n`
      : '') +
    previous +
    isolation +
    handoff +
    `- status "ok" means blocker is null; "blocked" and "partial" need a non-empty blocker.\n` +
    `- evidence is at most 8 locators (path, path:line, path:start-end) — never file bodies.\n` +
    `- Keep it terse. A packet over the character cap \`interlock limits\` publishes fails the ` +
    `task, and it is never truncated for you.\n\n` +
    (single
      ? `Report ok:false if you could not complete the task, with what blocked you.`
      : `Report outcome "failed" for the task that blocked you, with what blocked you.`)
  )
}
