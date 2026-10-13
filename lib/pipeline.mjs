// The pipeline input: a platform's own check output, turned into what the merge
// verdict reads.
//
// `interlock merge-confidence --pipeline` reads `{ sha, checks: [{ name, state,
// required }], excluded }`, and the state of a check decides whether the verdict
// can read MERGE. That file used to have no producer: the `mr` skill was to
// write it, and a skill is prose a model follows, so the mapping from a
// platform's `SUCCESS`, `NEUTRAL`, `TIMED_OUT` and the rest to four states
// would have been re-derived on every run. This module is the mapping, as
// frozen data and three readers, so a test can hold it (design D2 to D7 of
// label-and-harden-the-merge-verdict).
//
// Three rules shape every reader:
//
//   - A RESULT THE PLATFORM DID NOT GIVE IS `pending`. Cancelled, stale and
//     unknown values read `pending`, which the verdict reads as unobserved.
//     `fail` would report a defect nobody found; `skipped` would grant green on
//     a check that never finished (design D5).
//   - THE COMMIT IS THE PLATFORM'S. The `sha` is the head commit the document
//     itself states, never one the caller holds. A GitLab merged-result pipeline
//     runs on a commit GitLab made, so the head travels from the merge request
//     document to the pipeline document in a pending record, typed by nobody
//     (design D4).
//   - A DOCUMENT THE READER DOES NOT RECOGNISE IS REFUSED. An absent check list
//     is not the platform saying there are no checks.
//
// `validatePipelineInput` is the one statement of what a well-formed input is,
// as `validateBaseline` is for the coverage baseline. The command applies it to
// the `--pipeline` file before assessing; `lib/merge-confidence.mjs` imports
// the four states.
//
// The GitLab readers are written from GitLab's and glab's documentation and
// source, with fixtures built to match them. Nobody ran them against a live
// project, and docs/15-merge-confidence.md says so.
//
// Pure: no fs, no git, no network, no clock. `interlock pipeline` owns the I/O.

/** The four states an entry of the pipeline input may carry. */
export const PIPELINE_STATES = Object.freeze(['pass', 'fail', 'pending', 'skipped'])

/**
 * GitHub (design D3). A check run that is not completed is `pending` whatever
 * its conclusion; a completed one reads its conclusion here, and a commit status
 * reads its state. Anything a table does not name reads `otherwise`.
 */
export const GITHUB_STATE_TABLE = Object.freeze({
  checkRun: Object.freeze({
    notCompleted: 'pending',
    conclusions: Object.freeze({
      SUCCESS: 'pass',
      NEUTRAL: 'skipped',
      SKIPPED: 'skipped',
      FAILURE: 'fail',
      TIMED_OUT: 'fail',
      ACTION_REQUIRED: 'fail',
      STARTUP_FAILURE: 'fail',
      CANCELLED: 'pending',
      STALE: 'pending'
    }),
    otherwise: 'pending'
  }),
  commitStatus: Object.freeze({
    states: Object.freeze({
      SUCCESS: 'pass',
      FAILURE: 'fail',
      ERROR: 'fail',
      PENDING: 'pending',
      EXPECTED: 'pending'
    }),
    otherwise: 'pending'
  })
})

/**
 * GitLab (design D4). A job reads its status here; a manual job reads by whether
 * it is allowed to fail. Anything the table does not name reads `otherwise`.
 */
export const GITLAB_STATE_TABLE = Object.freeze({
  statuses: Object.freeze({
    success: 'pass',
    failed: 'fail',
    skipped: 'skipped',
    created: 'pending',
    pending: 'pending',
    preparing: 'pending',
    running: 'pending',
    scheduled: 'pending',
    waiting_for_resource: 'pending',
    waiting_for_callback: 'pending',
    canceled: 'pending',
    canceling: 'pending'
  }),
  manual: Object.freeze({ allowedToFail: 'skipped', notAllowedToFail: 'pending' }),
  otherwise: 'pending'
})

/** The one check-run status whose conclusion is a result; any other is still running or queued. */
const GITHUB_COMPLETED = 'COMPLETED'

/** A merged-result or merge-train pipeline's reference: its own commit is one GitLab made. */
const MERGED_RESULT_REF = /^refs\/merge-requests\/[^/]+\/(?:merge|train)$/

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value)
// A table is read by its own keys only: a value such as "constructor" names no
// row, and must not read whatever the object happens to inherit.
const lookup = (table, key, otherwise) => (typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : otherwise)
const isName = value => typeof value === 'string' && value.length > 0
const names = value => (Array.isArray(value) ? value.filter(isName) : [])
const refuse = reason => ({ ok: false, reason })
const quoted = value => JSON.stringify(value ?? null)
const typeOf = value => (value === null ? 'null' : Array.isArray(value) ? 'a list' : `a ${typeof value}`)

// --- GitHub ----------------------------------------------------------------------

/** The name and state of one `statusCheckRollup` entry, or null when it has no name. */
function githubEntry(entry) {
  // A commit status is named by its context and carries a state; a check run is
  // named by its name and carries a status and a conclusion.
  const isStatus = entry.__typename === 'StatusContext' || (!isName(entry.name) && isName(entry.context))
  if (isStatus) {
    if (!isName(entry.context)) return null
    const { states, otherwise } = GITHUB_STATE_TABLE.commitStatus
    return { kind: 'status', name: entry.context, group: '', state: lookup(states, entry.state, otherwise), startedAt: entry.startedAt }
  }
  if (!isName(entry.name)) return null
  const { notCompleted, conclusions, otherwise } = GITHUB_STATE_TABLE.checkRun
  const state = entry.status !== GITHUB_COMPLETED ? notCompleted : lookup(conclusions, entry.conclusion, otherwise)
  return {
    kind: 'run',
    name: entry.name,
    group: isName(entry.workflowName) ? entry.workflowName : '',
    state,
    startedAt: entry.startedAt
  }
}

/**
 * When a run started, or null when the entry does not say. A platform's zero
 * time (`0001-01-01T00:00:00Z`, what a run that has not started carries) parses
 * as a date and is no start time.
 */
function startOf(entry) {
  const at = Date.parse(entry.startedAt)
  return Number.isNaN(at) || at <= 0 ? null : at
}

// Worse is earlier. Read only when several reports of one check cannot be put
// in order, where the less favourable one is the one that stands.
const LEAST_FAVOURABLE_FIRST = Object.freeze(['fail', 'pending', 'skipped', 'pass'])

/**
 * The one entry read for a check the platform reported more than once: the run
 * that started last, the later entry on a tie. A run with no start time cannot
 * be placed before or after any other, so with one among them there is no last
 * run to read: the least favourable state stands, among the last timed run and
 * every untimed one. Listing order is not evidence of which ran last, and a
 * pass listed after a failure must not hide it for want of a time. `unordered`
 * is set when that rule chose between different states, so the caller says so.
 */
function latestRun(runs) {
  let last = null
  const untimed = []
  for (const run of runs) {
    if (startOf(run) === null) untimed.push(run)
    else if (!last || startOf(run) >= startOf(last)) last = run
  }
  if (!untimed.length) return { entry: last, unordered: false }
  const candidates = last ? [last, ...untimed] : untimed
  const entry = candidates.reduce((worst, run) =>
    LEAST_FAVOURABLE_FIRST.indexOf(run.state) < LEAST_FAVOURABLE_FIRST.indexOf(worst.state) ? run : worst
  )
  return { entry, unordered: new Set(candidates.map(run => run.state)).size > 1 }
}

/**
 * Apply the caller's required names and exclusions to the reported checks.
 * Exclusion is exact, by name; it also removes a required name that matched no
 * reported check, so a gate job that has not reported does not come back as a
 * pending required entry (design D6).
 */
function applyCallerNames(reported, { required, exclude, requiredFromCaller }) {
  const requiredNames = [...new Set(names(required))]
  const excludeNames = [...new Set(names(exclude))]
  const reportedNames = new Set(reported.map(c => c.name))
  const notes = []

  const excluded = []
  for (const name of excludeNames) {
    if (reportedNames.has(name) || requiredNames.includes(name)) excluded.push(name)
    else {
      notes.push(
        `the excluded name ${quoted(name)} matched no check${requiredFromCaller ? ' and no required name' : ''}, ` +
          `so nothing was left out for it (an exclusion is an exact name, never a pattern)`
      )
    }
  }

  const checks = reported
    .filter(c => !excluded.includes(c.name))
    .map(c => ({ name: c.name, state: c.state, required: requiredFromCaller ? requiredNames.includes(c.name) : c.required === true }))
  if (requiredFromCaller) {
    // A required check that has not reported at all is in no document, so it is
    // visible only when it is named: it becomes a pending required entry.
    for (const name of requiredNames) {
      if (!reportedNames.has(name) && !excluded.includes(name)) checks.push({ name, state: 'pending', required: true })
    }
    if (!requiredNames.length) {
      notes.push('the required set was not given, so every check reads as not required: a failed check reads amber, never red')
    }
  }
  return { checks, excluded, notes }
}

/**
 * The pipeline input from the document `gh pr view <n> --json
 * headRefOid,statusCheckRollup` prints (design D3). Never throws.
 *
 * @param {unknown} doc
 * @param {{ required?: string[], exclude?: string[] }} [opts]
 * @returns {{ ok: true, input: { sha: string, checks: Array, excluded: string[] }, notes: string[] } | { ok: false, reason: string }}
 */
export function pipelineFromGithub(doc, { required, exclude } = {}) {
  const hasSha = isObject(doc) && isName(doc.headRefOid)
  const hasList = isObject(doc) && Array.isArray(doc.statusCheckRollup)
  if (!hasSha || !hasList) {
    const lacking = [
      ...(hasSha ? [] : ['no head commit (headRefOid)']),
      ...(hasList ? [] : ['no check list (statusCheckRollup)'])
    ]
    return refuse(
      `the document carries ${lacking.join(' and ')}: it is not what "gh pr view <n> --json headRefOid,statusCheckRollup" prints`
    )
  }

  // One entry per check; a re-run (the same name under the same workflow) is
  // read from the run that started last.
  const byKey = new Map()
  for (let i = 0; i < doc.statusCheckRollup.length; i++) {
    const raw = doc.statusCheckRollup[i]
    const entry = isObject(raw) ? githubEntry(raw) : null
    if (!entry) return refuse(`statusCheckRollup[${i}] is not a check run or a commit status with a name`)
    const key = `${entry.kind}\u0000${entry.group}\u0000${entry.name}`
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(entry)
  }
  const reported = []
  const unordered = []
  const leftOut = names(exclude)
  for (const runs of byKey.values()) {
    const read = latestRun(runs)
    reported.push(read.entry)
    if (read.unordered && !leftOut.includes(read.entry.name)) {
      unordered.push(
        `the check ${quoted(read.entry.name)} was reported ${runs.length} times and a start time among them could not be read, ` +
          `so no run can be called the last: it reads ${read.entry.state}, the least favourable state among them`
      )
    }
  }

  const { checks, excluded, notes } = applyCallerNames(reported, { required, exclude, requiredFromCaller: true })
  return { ok: true, input: { sha: doc.headRefOid, checks, excluded }, notes: [...unordered, ...notes] }
}

// --- GitLab ----------------------------------------------------------------------

/**
 * The first GitLab step, from the document `glab mr view <iid> --output json`
 * prints (design D4): a complete input with no checks when the merge request has
 * no head pipeline, or a pending record carrying the head commit and the
 * pipeline's identifier when it has one. The record has no check list, so it is
 * not a well-formed pipeline input and the verdict refuses it if the second step
 * never runs. Never throws.
 *
 * @param {unknown} doc
 * @returns {{ ok: true, input: object } | { ok: true, pending: { sha: string, headPipeline: number|string } } | { ok: false, reason: string }}
 */
export function pendingFromGitlabMr(doc) {
  if (!isObject(doc)) return refuse('the document is not a JSON object: it is not what "glab mr view <iid> --output json" prints')
  if (!isName(doc.sha)) return refuse('the merge request document carries no head commit (sha)')
  // An absent key is not the platform saying there is no pipeline.
  if (!Object.prototype.hasOwnProperty.call(doc, 'head_pipeline')) {
    return refuse('the merge request document carries no head_pipeline key, so it does not say whether a pipeline exists')
  }
  if (doc.head_pipeline === null) return { ok: true, input: { sha: doc.sha, checks: [], excluded: [] } }
  const id = isObject(doc.head_pipeline) ? doc.head_pipeline.id : undefined
  if (!(Number.isInteger(id) || isName(id))) {
    return refuse('the merge request document carries a head_pipeline with no id, so its pipeline cannot be named')
  }
  return { ok: true, pending: { sha: doc.sha, headPipeline: id } }
}

/** The state of one GitLab job. */
function gitlabState(job) {
  if (job.status === 'manual') {
    return job.allow_failure === true ? GITLAB_STATE_TABLE.manual.allowedToFail : GITLAB_STATE_TABLE.manual.notAllowedToFail
  }
  return lookup(GITLAB_STATE_TABLE.statuses, job.status, GITLAB_STATE_TABLE.otherwise)
}

/**
 * The second GitLab step, from the document `glab ci get --merge-request <iid>
 * --output json` prints and the pending record the first step wrote (design
 * D4). The input's `sha` is the record's head commit. A job is required when it
 * is not allowed to fail. Never throws.
 *
 * @param {unknown} doc
 * @param {unknown} pending  `{ sha, headPipeline }`
 * @param {{ exclude?: string[] }} [opts]
 * @returns {{ ok: true, input: { sha: string, checks: Array, excluded: string[] }, notes: string[] } | { ok: false, reason: string }}
 */
export function pipelineFromGitlab(doc, pending, { exclude } = {}) {
  if (!isObject(pending) || !isName(pending.sha) || !(Number.isInteger(pending.headPipeline) || isName(pending.headPipeline))) {
    return refuse(
      'the record does not carry a head commit (sha) and a head pipeline (headPipeline): it is not what "interlock pipeline --gitlab-mr" writes for a merge request that has a pipeline'
    )
  }
  if (!isObject(doc) || !Array.isArray(doc.jobs) || !(Number.isInteger(doc.id) || isName(doc.id))) {
    return refuse('the document carries no pipeline id and no jobs list: it is not what "glab ci get --merge-request <iid> --output json" prints')
  }
  if (String(doc.id) !== String(pending.headPipeline)) {
    return refuse(`the document describes pipeline ${doc.id}, not the merge request's head pipeline ${pending.headPipeline}`)
  }
  // A merged-result or merge-train pipeline's own commit is never the head; for
  // any other reference the pipeline must be for the commit the record carries.
  const mergedResult = typeof doc.ref === 'string' && MERGED_RESULT_REF.test(doc.ref)
  if (!mergedResult && doc.sha !== pending.sha) {
    return refuse(
      `the pipeline ran on commit ${quoted(doc.sha)}, not the merge request's head ${pending.sha}, and its reference (${quoted(doc.ref)}) is not a merged-result one`
    )
  }

  const reported = []
  for (let i = 0; i < doc.jobs.length; i++) {
    const job = doc.jobs[i]
    if (!isObject(job) || !isName(job.name)) return refuse(`jobs[${i}] is not a job with a name`)
    reported.push({ name: job.name, state: gitlabState(job), required: job.allow_failure === false })
  }
  const { checks, excluded, notes } = applyCallerNames(reported, { exclude, requiredFromCaller: false })
  return { ok: true, input: { sha: pending.sha, checks, excluded }, notes }
}

// --- the one rule ------------------------------------------------------------------

/**
 * Whether a value is a well-formed pipeline input (design D7): an object
 * carrying a string `sha` and a list `checks` in which every entry is an object
 * with a non-empty string `name`, a `state` that is one of the four, and a
 * boolean `required`; an `excluded` list of names may be present. The reason
 * names the first fault. Never throws.
 *
 * @param {unknown} value
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validatePipelineInput(value) {
  if (!isObject(value)) return refuse(`it does not hold a JSON object (found ${typeOf(value)})`)
  if (!Object.prototype.hasOwnProperty.call(value, 'checks')) {
    // An absent or misspelt list and an empty list are different statements.
    const record = Object.prototype.hasOwnProperty.call(value, 'headPipeline')
      ? ` — it is the pending record of a GitLab merge request (head pipeline ${value.headPipeline}): run "interlock pipeline --gitlab" to complete it`
      : ''
    return refuse(`it carries no "checks" list${record}`)
  }
  if (!Array.isArray(value.checks)) return refuse(`its "checks" is not a list (found ${typeOf(value.checks)})`)
  if (!isName(value.sha)) return refuse('it carries no "sha": a string naming the commit the checks belong to')
  for (let i = 0; i < value.checks.length; i++) {
    const check = value.checks[i]
    if (!isObject(check)) return refuse(`checks[${i}] is not an object (found ${typeOf(check)})`)
    if (!isName(check.name)) return refuse(`checks[${i}] carries no name: a non-empty string`)
    if (!PIPELINE_STATES.includes(check.state)) {
      return refuse(`checks[${i}] (${quoted(check.name)}) has the state ${quoted(check.state)}, which is not one of ${PIPELINE_STATES.join(' | ')}`)
    }
    if (typeof check.required !== 'boolean') {
      return refuse(`checks[${i}] (${quoted(check.name)}) has a "required" that is not true or false`)
    }
  }
  if (value.excluded !== undefined && !(Array.isArray(value.excluded) && value.excluded.every(isName))) {
    return refuse('its "excluded" is not a list of check names')
  }
  return { ok: true }
}
