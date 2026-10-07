// The replan briefing.
//
// The state machine decides WHEN a replan is allowed; this asks a model whether
// anything actually needs revising. The ACP form is the one kept: the agent
// writes the revision file and reports whether it wrote one, and the CLI applies
// it. The Workflow form asked the same agent to run `wave-state replan` itself,
// which made an agent the party that decides whether its own revision was
// accepted.

/**
 * @param {{ change: string, replanPath: string }} input
 * @returns {string}
 */
export function assembleReplanPrompt({ change, replanPath }) {
  return (
    `A completed wave may have invalidated later ones for change "${change}".\n\n` +
    `Revise ONLY groups that have not executed yet — the CLI rejects a revision to an executed ` +
    `group, and that rejection is correct, not an obstacle to work around.\n\n` +
    `If anything needs revising, write [{ "group": <n>, "tasks": [...] }] to ${replanPath} ` +
    `and report revised:true. If nothing does, report revised:false and write nothing. ` +
    `Do not invent groups, and do not run interlock — the orchestrator applies the revision.`
  )
}
