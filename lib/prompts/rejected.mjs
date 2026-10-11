// One rejected handoff report, as a line of a briefing.
//
// Shared by the two briefings that name such a task — the next wave's
// implementers and the review — so the line cannot drift between them. It
// carries the task id, the short reason and the paths the task said it touched,
// and nothing of the rejected packet itself.

/**
 * @param {{taskId: string, reason: string, paths?: string[], pathsOmitted?: number}} report
 * @returns {string} `- [<id>] rejected: <reason> — <what it reported touching>`
 */
export function renderRejectedReport(report) {
  const paths = Array.isArray(report.paths) ? report.paths : []
  // The step lists only the paths that fit the handoff cap and counts the rest,
  // so a rejected report cannot hand on more than a valid one may.
  const omitted =
    Number.isInteger(report.pathsOmitted) && report.pathsOmitted > 0 ? report.pathsOmitted : 0
  const touched = paths.length
    ? `reported touching: ${paths.join(', ')}` + (omitted ? ` (+${omitted} more not listed)` : '')
    : omitted
      ? `reported ${omitted} path(s), none listed`
      : `reported no paths`
  return `- [${report.taskId}] rejected: ${report.reason} — ${touched}`
}
