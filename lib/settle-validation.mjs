// The validation comment `/interlock:settle --review` posts beside the findings,
// and the three lines the pull request description's testing section carries
// (spec: review/validation-comment; change post-the-proof-beside-the-findings,
// design D1-D28).
//
// Pure: the caller (`lib/settle-cli.mjs`) reads the records and hands them over
// parsed, and this module reads no file, runs nothing and keeps no clock, so the
// same records give the same bytes. It imports no `node:` module itself.
//
//   renderValidation(records) -> { text, json }
//   renderSummary(records, { unposted }) -> the three `--summary` lines
//
// `records` is `{ head, plan, results, verify, exec, pipeline, handoff, review,
// coverage, changed }`. `head` is the sha, `plan` plan.json's object, `results`
// results.json's array, `verify` the judged verdict, `exec` the exec record's
// entries (null when `--exec` was not given), `pipeline`, `handoff`, `review` and
// `coverage` the optional records (null when not given), `changed` the changed
// paths or null. The CLI has already refused a verdict for another head, and a
// head that is not a sha (`isCommitSha`).
//
// What it holds back on purpose: no verdict, score, band or label is read or
// written (D16), no test output is printed (D4), and every text it did not write
// is an inline code span or sits in a fence no line of it can close (D1).
//
// The bound (D15): over `LIMITS.maxValidationCommentChars` rows are dropped last
// first, block by block, least useful block first. A cut block says how many it
// lost and the last line opens `CUT:`. The headings, each section's first line,
// the commands table and the marker lines after it are never cut.

import { LIMITS } from './limits.mjs'
import { inertSpan } from './merge-confidence.mjs'
import { PIPELINE_STATES } from './pipeline.mjs'
import { listsOf, NO_DIFF } from './review-proof.mjs'
import { classifySurface, UI_TESTABLE } from './surface.mjs'

// --- small readers --------------------------------------------------------------

const isObject = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const isText = v => typeof v === 'string' && v.trim() !== ''
const list = v => (Array.isArray(v) ? v : [])
const isCount = v => Number.isInteger(v) && v >= 0

const span = text => inertSpan(text)
const cell = text => inertSpan(text, { inTable: true })
const noun = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** A commit id as git prints one: 7 to 64 hex digits, from an abbreviated sha to a full SHA-256 id. */
export const isCommitSha = v => typeof v === 'string' && /^[0-9a-f]{7,64}$/i.test(v)

/** A kind name in a line that must open with plain text: only what a kind is made of. */
const kindText = kind => String(kind).replace(/[^\w.-]/g, '?')

/** Reviewer prose in a backtick fence longer than any backtick run inside it, so no line can close it early. */
function fenced(text) {
  const runs = String(text).match(/`+/g) || []
  const fence = '`'.repeat(Math.max(3, ...runs.map(r => r.length + 1)))
  return [fence, String(text), fence]
}

/**
 * A duration cut down, never rounded up: `1m 42s` from a minute on (minutes are
 * never folded into hours), `8.3s` under it. Anything that is not a non-negative
 * number is `not recorded`.
 */
export function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return 'not recorded'
  if (ms >= 60000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
  return `${(Math.floor(ms / 100) / 10).toFixed(1)}s`
}

// --- commands -----------------------------------------------------------------------

const COUNT_KEYS = ['total', 'passed', 'failed', 'skipped']

/** The four counts of one kind as the session read them: the verdict's own entry first, then the results entry's. */
function countsOf(kind, verify, result) {
  const verdict = isObject(verify[kind]) && isObject(verify[kind].counts) ? verify[kind].counts : null
  const fromResult = result ? (isObject(result.counts) ? result.counts : result) : null
  for (const source of [verdict, fromResult]) {
    if (!source) continue
    const found = COUNT_KEYS.filter(key => isCount(source[key]))
    if (found.length) return Object.fromEntries(found.map(key => [key, source[key]]))
  }
  return null
}

const countsText = counts => {
  if (!counts) return null
  const parts = []
  if ('total' in counts) parts.push(`${counts.total} total`)
  for (const key of ['passed', 'failed', 'skipped']) if (key in counts) parts.push(`${counts[key]} ${key}`)
  return parts.join(', ')
}

/** The exec record's usable entries; null when `--exec` was not given. */
function execEntries(exec) {
  if (exec === null || exec === undefined) return null
  return list(exec).filter(e => isObject(e) && typeof e.kind === 'string' && typeof e.command === 'string' && Number.isInteger(e.exitCode))
}

/**
 * One row per planned step, in plan order. The exit code is the last exec entry's
 * with the step's kind and command (observed by the CLI), else the results
 * entry's marked `session-recorded`; a step with neither has no result recorded.
 * Both the comment and the summary read this, so they show one code (spec: the
 * summary's exit codes are the comment's).
 */
function commandRows(recs) {
  const plan = isObject(recs.plan) ? recs.plan : {}
  const verify = isObject(recs.verify) ? recs.verify : {}
  const results = list(recs.results).filter(r => isObject(r) && typeof r.kind === 'string')
  const exec = execEntries(recs.exec)
  const steps = list(plan.steps).filter(s => isObject(s) && isText(s.kind))
  return steps.map(step => {
    const command = typeof step.command === 'string' ? step.command : ''
    const result = [...results].reverse().find(r => r.kind === step.kind) ?? null
    const runs = exec ? exec.filter(e => e.kind === step.kind && e.command === command) : []
    const observed = runs.length ? runs[runs.length - 1] : null
    const sessionExit = result && Number.isInteger(result.exitCode) ? result.exitCode : null
    let exit = null
    let sessionRecorded = false
    let durationMs = null
    if (observed) {
      exit = observed.exitCode
      durationMs = observed.durationMs
    } else if (sessionExit !== null) {
      exit = sessionExit
      sessionRecorded = true
    }
    const earlierRed = runs.slice(0, -1).filter(e => e.exitCode !== 0).map(e => e.exitCode)
    return {
      kind: step.kind,
      command,
      exit,
      sessionRecorded,
      noResult: exit === null,
      duration: observed ? formatDuration(durationMs) : 'not recorded',
      runs: runs.length,
      counts: countsOf(step.kind, verify, result),
      disagrees: observed && sessionExit !== null && sessionExit !== observed.exitCode ? { session: sessionExit, observed: observed.exitCode } : null,
      earlierRed,
      locator: result && isText(result.locator) ? result.locator : null
    }
  })
}

const disagreesLine = row =>
  `RESULT DISAGREES: ${kindText(row.kind)}: the session recorded exit ${row.disagrees.session}, verify exec observed exit ${row.disagrees.observed}`
const rerunLine = row => {
  const codes = row.earlierRed
  return codes.length === 1
    ? `RE-RUN: ${kindText(row.kind)}: an earlier run exited ${codes[0]}`
    : `RE-RUN: ${kindText(row.kind)}: ${codes.length} earlier runs exited ${codes.join(', ')}`
}

/** The failing test names the verdict's clusters hold, each once; no failure text is read. */
function failingTests(verify) {
  const names = []
  for (const key of ['unit', 'e2e']) {
    const entry = isObject(verify) ? verify[key] : null
    if (!isObject(entry)) continue
    for (const cluster of list(entry.clusters)) {
      if (!isObject(cluster)) continue
      for (const name of list(cluster.tests)) if (isText(name) && !names.includes(name)) names.push(name)
    }
  }
  return names
}

function commandsModel(recs) {
  const plan = isObject(recs.plan) ? recs.plan : {}
  const verify = isObject(recs.verify) ? recs.verify : {}
  const rows = commandRows(recs)
  const skipped = list(plan.skipped)
    .filter(s => isObject(s) && isText(s.kind))
    .map(s => ({ kind: s.kind, reason: isText(s.reason) ? s.reason : null }))
  return {
    rows,
    skipped,
    noCommand: rows.length === 0,
    halted: verify.halt === true,
    reason: isText(verify.reason) ? verify.reason : null,
    tests: failingTests(verify)
  }
}

// --- platform checks -------------------------------------------------------------------

function checksModel(recs, head) {
  const p = recs.pipeline
  if (!isObject(p)) return { state: 'none' }
  if (p.sha !== head) return { state: 'other', sha: isText(p.sha) ? p.sha : null }
  const checks = list(p.checks)
    .filter(c => isObject(c) && isText(c.name))
    .map(c => ({ name: c.name, state: typeof c.state === 'string' ? c.state : 'unknown', required: c.required === true }))
  const excluded = list(p.excluded).filter(isText)
  const quiet = c => c.state === 'pass' || c.state === 'skipped'
  return {
    state: checks.length ? 'ok' : 'empty',
    checks,
    excluded,
    attention: checks.filter(c => !quiet(c)),
    passing: checks.filter(quiet)
  }
}

function checkCountsLine(m) {
  const count = state => m.checks.filter(c => c.state === state).length
  const other = m.checks.filter(c => !PIPELINE_STATES.includes(c.state)).length
  const parts = [
    [count('pass'), 'passed'],
    [count('fail'), 'failed'],
    [count('pending'), 'pending'],
    [count('skipped'), 'skipped'],
    [other, 'in another state']
  ]
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}`)
  const required = m.checks.filter(c => c.required).length
  return `${noun(m.checks.length, 'check')} on this commit: ${parts.join(', ')}; ${required} required.`
}

/** A known check state as itself; anything else is a hand-edited record's text, so it is quoted inert (M15). */
const stateCell = state => (PIPELINE_STATES.includes(state) ? state : cell(state))

const checkRow = c => `| ${cell(c.name)} | ${stateCell(c.state)} | ${c.required ? 'yes' : 'no'} |`

// --- spec adherence ----------------------------------------------------------------------

function adherenceModel(recs, head) {
  const h = recs.handoff
  if (!isObject(h)) return { state: 'none' }
  if (h.head !== head) return { state: 'other', head: isText(h.head) ? h.head : null }
  if (h.checked !== true) {
    const n = key => (isCount(h[key]) ? h[key] : 'an unrecorded number of')
    return {
      state: 'unchecked',
      text:
        `The worker's own counts, not checked: ${n('scenariosChecked')} scenarios checked, ${n('scenariosUnconfirmed')} unconfirmed; ` +
        `${n('requirementsChecked')} living requirements checked, ${n('requirementsUnconfirmed')} unconfirmed. No citation was verified.`
    }
  }
  const rows = list(h.rows).filter(r => isObject(r) && isText(r.id))
  const of = kind => rows.filter(r => r.kind === kind)
  const done = r => r.status === 'confirmed'
  const living = isObject(h.living) ? h.living : {}
  return {
    state: 'checked',
    scenarios: of('scenario'),
    requirements: of('requirement'),
    confirmed: rows.filter(done),
    unconfirmed: rows.filter(r => !done(r)),
    omitted: isCount(living.omitted) ? living.omitted : 0,
    livingSkipped: isText(living.skipped) ? living.skipped : null,
    livingPartial: isText(living.partial) ? living.partial : null,
    detail: typeof h.detail === 'string' && h.detail.trim() !== '' ? h.detail : ''
  }
}

function adherenceFirstLine(m) {
  const confirmed = rows => rows.filter(r => r.status === 'confirmed').length
  const scenarios = `${confirmed(m.scenarios)} of ${m.scenarios.length} ${m.scenarios.length === 1 ? 'scenario' : 'scenarios'}`
  const showRequirements = m.requirements.length > 0 || m.omitted > 0
  const requirements = showRequirements
    ? ` and ${confirmed(m.requirements)} of ${m.requirements.length} living ${m.requirements.length === 1 ? 'requirement' : 'requirements'}`
    : ''
  const rest = m.unconfirmed.length === 0 ? 'none unconfirmed' : `${m.unconfirmed.length} unconfirmed`
  return `${scenarios}${requirements} confirmed with a citation; ${rest}.`
}

// --- gaps ------------------------------------------------------------------------------------

function reviewGaps(recs, head) {
  const review = recs.review
  if (!isObject(review)) return ['No review record was given, so what the review covered is not shown.']
  if (review.head !== head) {
    return [`The review record describes another commit, ${span(isText(review.head) ? review.head : '(none)')}, so what the review covered is not shown for ${span(head)}.`]
  }
  const gaps = []
  const dims = isObject(review.dimensions) ? review.dimensions : {}
  const named = entry => (isObject(entry) ? entry : { name: entry })
  const reasonOf = entry => (isText(entry.reason) ? `: ${span(entry.reason)}` : '')
  for (const raw of list(dims.skipped)) {
    const e = named(raw)
    if (isText(e.name)) gaps.push(`Dimension ${span(e.name)} was skipped${reasonOf(e)}`)
  }
  for (const raw of list(dims.degraded)) {
    const e = named(raw)
    if (isText(e.name)) gaps.push(`Dimension ${span(e.name)} ran degraded${reasonOf(e)}`)
  }
  for (const raw of list(dims.unavailable)) {
    const e = named(raw)
    if (isText(e.name)) gaps.push(`Dimension ${span(e.name)} was unavailable`)
  }
  if (!isObject(review.proof)) {
    gaps.push('The review record carries no proof of coverage.')
    return gaps
  }
  const { unproven, unread, uncited } = listsOf(review.proof)
  for (const u of unproven) gaps.push(`Dimension ${span(u.dimension)} is unproven${reasonOf(u)}`)
  for (const u of unread) {
    for (const e of u.entries) gaps.push(`Dimension ${span(u.dimension)} left ${span(e.input)} unread${reasonOf(e)}`)
  }
  for (const path of uncited) gaps.push(`${span(path)} is cited by no reviewer.`)
  if (review.proof.reason === NO_DIFF) gaps.push('The review proof was given no diff to check against.')
  return gaps
}

/** Every gap the records hold, in the fixed order of the spec: plan, commands, checks, confirmation, review, coverage, changed paths. */
function gapItems(recs, head, m) {
  const gaps = []
  for (const s of m.commands.skipped) gaps.push(`${span(s.kind)} did not run${s.reason ? `: ${span(s.reason)}` : ''}`)
  for (const row of m.commands.rows) {
    if (row.noResult) gaps.push(`${span(row.kind)} has no result recorded, so no exit code is shown for it.`)
    else if (row.sessionRecorded) gaps.push(`${span(row.kind)}: the exit code is the session's own record, verify exec observed none for this command.`)
    if (row.disagrees) gaps.push(disagreesLine(row))
    if (row.earlierRed.length) gaps.push(rerunLine(row))
  }
  const c = m.checks
  if (c.state === 'none') gaps.push(`No pipeline record was given, so the platform's checks for ${span(head)} are not shown.`)
  else if (c.state === 'other') {
    gaps.push(`The pipeline record describes another commit, ${span(c.sha ?? '(none)')}, so the platform's checks for ${span(head)} are not shown.`)
  } else {
    if (c.state === 'empty') gaps.push(`The platform reported no check for ${span(head)}.`)
    for (const check of c.checks.filter(x => x.state === 'pending')) gaps.push(`${span(check.name)} is pending: the platform has not finished it.`)
    for (const name of c.excluded) gaps.push(`${span(name)} was excluded by the caller and is counted in no figure.`)
  }
  const a = m.adherence
  if (a.state === 'none') gaps.push(`No confirmation was recorded for ${span(head)}, so no spec scenario is shown as checked.`)
  else if (a.state === 'other') {
    gaps.push(`The confirmation describes another commit, ${span(a.head ?? '(none)')}, so no spec scenario is shown as checked for ${span(head)}.`)
  } else if (a.state === 'unchecked') {
    gaps.push("The confirmation's citations were not checked: no handoff check ran on it, so its counts are the worker's own.")
  } else {
    if (a.unconfirmed.length) {
      const scenarios = a.unconfirmed.filter(r => r.kind === 'scenario').length
      const living = a.unconfirmed.filter(r => r.kind === 'requirement').length
      gaps.push(`${noun(a.unconfirmed.length, 'row')} of the confirmation ${a.unconfirmed.length === 1 ? 'is' : 'are'} unconfirmed (${noun(scenarios, 'scenario')}, ${noun(living, 'living requirement')}).`)
    }
    if (a.omitted > 0) gaps.push(`${noun(a.omitted, 'living requirement')} left out by the size bound, so ${a.omitted === 1 ? 'it was' : 'they were'} not confirmed.`)
    if (a.livingSkipped) gaps.push(`The living requirements were not confirmed: ${span(a.livingSkipped)}`)
    if (a.livingPartial) gaps.push(`The living requirements were only partly gathered: ${span(a.livingPartial)}`)
  }
  gaps.push(...reviewGaps(recs, head))
  const unreported = isObject(recs.coverage) ? list(recs.coverage.unreportedFiles).filter(isText) : []
  if (unreported.length) {
    gaps.push(`${noun(unreported.length, 'changed source file')} not listed in the coverage report: ${unreported.map(span).join(', ')}`)
  }
  if (m.visual.noList) gaps.push('No changed-path list was given, so no screen was listed.')
  return gaps
}

// --- visual ----------------------------------------------------------------------------------------

function visualModel(recs) {
  if (recs.changed === null || recs.changed === undefined) return { noList: true, paths: [], count: 0, indirectCount: 0 }
  const surface = classifySurface(list(recs.changed))
  const paths = surface.files.filter(f => f.class === UI_TESTABLE).map(f => f.path)
  return { noList: false, paths, count: paths.length, indirectCount: surface.indirectCount }
}

// --- layout and the bound -------------------------------------------------------------------------------

const BLOCKS = [
  ['confirmed', 'confirmed rows'],
  ['passing', 'passing and skipped checks'],
  ['detail', "the worker's detail"],
  ['tests', 'failing test names'],
  ['visual', 'visual paths'],
  ['unconfirmed', 'unconfirmed rows'],
  ['attention', 'failing and pending checks'],
  ['gaps', 'gap items']
]

/** How many rows each block can lose. */
function sizes(m) {
  const a = m.adherence
  const c = m.checks
  const checked = c.state === 'ok'
  return {
    confirmed: a.state === 'checked' ? a.confirmed.length : 0,
    passing: checked ? c.passing.length : 0,
    detail: a.state === 'checked' && a.detail ? 1 : 0,
    tests: m.commands.tests.length,
    visual: m.visual.paths.length,
    unconfirmed: a.state === 'checked' ? a.unconfirmed.length : 0,
    attention: checked ? c.attention.length : 0,
    gaps: m.gaps.length
  }
}

const keep = (rows, dropped) => rows.slice(0, rows.length - dropped)

/** The whole comment for a set of drops: `{ text, cut }`. */
function layout(m, drop) {
  const out = []
  const cut = []
  const lose = (key, count) => {
    if (count > 0) cut.push({ block: BLOCKS.find(([k]) => k === key)[1], count })
  }
  for (const [key] of BLOCKS) lose(key, drop[key])

  // The CLI refuses a head that is not a sha; from any other caller one renders inert, so its newlines and markup stay text.
  out.push(`## Validation — ${isCommitSha(m.head) ? m.head : span(m.head)}`, '')

  // Commands run
  const cm = m.commands
  out.push('### Commands run', '')
  out.push('| Kind | Command | Exit | Duration | Counts (as the session read them) |', '|---|---|---|---|---|')
  for (const row of cm.rows) {
    const exit = row.noResult ? 'no result recorded' : row.sessionRecorded ? `${row.exit} (session-recorded)` : `${row.exit}`
    const duration = row.runs > 1 ? `${row.duration} (last of ${row.runs} runs)` : row.duration
    out.push(`| ${cell(row.kind)} | ${cell(row.command)} | ${exit} | ${duration} | ${countsText(row.counts) ?? '—'} |`)
  }
  for (const s of cm.skipped) {
    out.push(`| ${cell(s.kind)} | not run${s.reason ? `: ${cell(s.reason)}` : ''} | — | — | — |`)
  }
  out.push('')
  if (cm.noCommand) out.push('No command ran.', '')
  out.push(cm.halted ? `Final verification halted${cm.reason ? `: ${span(cm.reason)}` : ' (no reason recorded)'}.` : 'Final verification: no halt.', '')
  for (const row of cm.rows) if (row.disagrees) out.push(disagreesLine(row), '')
  for (const row of cm.rows) if (row.earlierRed.length) out.push(rerunLine(row), '')
  for (const row of cm.rows) {
    if (row.locator) out.push(`The output of ${span(row.kind)} was spilled to ${span(row.locator)}; none of it is printed here.`, '')
  }
  if (cm.tests.length) {
    out.push('Failing tests:', '')
    for (const name of keep(cm.tests, drop.tests)) out.push(`- ${span(name)}`)
    if (drop.tests > 0) out.push('', `${noun(drop.tests, 'failing test name')} left out.`)
    out.push('')
  }

  // Platform checks
  const c = m.checks
  out.push('### Platform checks', '')
  if (c.state === 'none') out.push('No pipeline record was given.', '')
  else if (c.state === 'other') out.push(`The pipeline record describes another commit, ${span(c.sha ?? '(none)')}; no check is shown.`, '')
  else if (c.state === 'empty') out.push(`The platform reported no check for ${span(m.head)}.`, '')
  if (c.state === 'ok' || c.state === 'empty') {
    if (c.state === 'ok') out.push(checkCountsLine(c), '')
    if (c.excluded.length) out.push(`Excluded by the caller: ${c.excluded.map(span).join(', ')}`, '')
  }
  if (c.state === 'ok') {
    const attention = keep(c.attention, drop.attention)
    if (attention.length) out.push('| Check | State | Required |', '|---|---|---|', ...attention.map(checkRow), '')
    if (drop.attention > 0) out.push(`${noun(drop.attention, 'failing or pending check')} left out.`, '')
    if (c.passing.length) {
      const passing = keep(c.passing, drop.passing)
      out.push('<details>', `<summary>${noun(c.passing.length, 'check')}</summary>`, '')
      if (passing.length) out.push('| Check | State | Required |', '|---|---|---|', ...passing.map(checkRow), '')
      if (drop.passing > 0) out.push(`${noun(drop.passing, 'passing or skipped check')} left out.`, '')
      out.push('</details>', '')
    }
  }

  // Spec adherence
  const a = m.adherence
  out.push('### Spec adherence', '')
  if (a.state === 'none') out.push(`No confirmation was recorded for ${span(m.head)}.`, '')
  else if (a.state === 'other') out.push(`The confirmation describes another commit, ${span(a.head ?? '(none)')}; no row is shown.`, '')
  else if (a.state === 'unchecked') out.push(a.text, '')
  else {
    out.push(adherenceFirstLine(a), '')
    if (a.omitted > 0) out.push(`${noun(a.omitted, 'living requirement')} left out by the size bound; ${a.omitted === 1 ? 'it is' : 'they are'} in neither total.`, '')
    const unconfirmed = keep(a.unconfirmed, drop.unconfirmed)
    if (unconfirmed.length) {
      out.push('| Id | Title | Reason |', '|---|---|---|')
      for (const r of unconfirmed) out.push(`| ${cell(r.id)} | ${cell(r.title ?? '(no title)')} | ${cell(r.reason ?? 'no reason recorded')} |`)
      out.push('')
    }
    if (drop.unconfirmed > 0) out.push(`${noun(drop.unconfirmed, 'unconfirmed row')} left out.`, '')
    const confirmed = keep(a.confirmed, drop.confirmed)
    if (a.confirmed.length || a.detail) {
      out.push('<details>', `<summary>${a.confirmed.length} confirmed</summary>`, '')
      if (confirmed.length) {
        out.push('| Id | Title | Citation |', '|---|---|---|')
        for (const r of confirmed) out.push(`| ${cell(r.id)} | ${cell(r.title ?? '(no title)')} | ${cell(r.cite ?? 'no citation')} |`)
        out.push('')
      }
      if (drop.confirmed > 0) out.push(`${noun(drop.confirmed, 'confirmed row')} left out.`, '')
      if (a.detail && drop.detail === 0) out.push("The worker's account of what it looked at:", '', ...fenced(a.detail), '')
      else if (a.detail) out.push(`The worker's account (${a.detail.length} characters) was cut from this comment.`, '')
      out.push('</details>', '')
    }
  }

  // What these checks would not catch
  out.push('### What these checks would not catch', '')
  const gaps = keep(m.gaps, drop.gaps)
  if (gaps.length) out.push(...gaps.map(g => `- ${g}`), '')
  if (drop.gaps > 0) out.push(`${noun(drop.gaps, 'gap item')} left out.`, '')
  if (m.gaps.length === 0) out.push('No gap is recorded in these records.', '')

  // Visual check owed
  const v = m.visual
  if (v.count > 0) {
    out.push('### Visual check owed', '')
    const indirect = v.indirectCount
    out.push(
      `${noun(v.count, 'changed path')} ${v.count === 1 ? 'is' : 'are'} a screen` +
        (indirect > 0 ? `; ${noun(indirect, 'more changed path')} ${indirect === 1 ? 'reaches' : 'reach'} a screen only indirectly.` : '.'),
      ''
    )
    out.push('No screen was looked at and no image is attached to this comment. A person who has looked can add images to the thread.', '')
    out.push(...keep(v.paths, drop.visual).map(p => `- ${span(p)}`), '')
    if (drop.visual > 0) out.push(`${noun(drop.visual, 'path')} left out.`, '')
  }

  const lines = out
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  if (cut.length) {
    lines.push('', `CUT: ${cut.map(x => (x.block === "the worker's detail" ? x.block : `${x.count} ${x.block}`)).join('; ')}`)
  }
  return { text: `${lines.join('\n')}\n`, cut }
}

/** Drop the least useful rows first until the comment fits the published bound. */
function fit(m) {
  const bound = LIMITS.maxValidationCommentChars
  const size = sizes(m)
  const drop = Object.fromEntries(BLOCKS.map(([key]) => [key, 0]))
  let result = layout(m, drop)
  for (const [key] of BLOCKS) {
    if (result.text.length <= bound) break
    if (!size[key]) continue
    drop[key] = size[key]
    if (layout(m, drop).text.length > bound) {
      result = layout(m, drop)
      continue
    }
    // Smallest drop that fits; `hi` always fits, so the answer does too.
    let lo = 1
    let hi = size[key]
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2)
      drop[key] = mid
      if (layout(m, drop).text.length <= bound) hi = mid
      else lo = mid + 1
    }
    drop[key] = hi
    result = layout(m, drop)
  }
  return result
}

function modelOf(recs) {
  const head = recs.head
  const model = { head, commands: commandsModel(recs), checks: checksModel(recs, head), adherence: adherenceModel(recs, head), visual: visualModel(recs) }
  model.gaps = gapItems(recs, head, model)
  return model
}

/**
 * The comment and the object `--json` prints, for the parsed records.
 * @returns {{ text: string, json: object }}
 */
export function renderValidation(records) {
  const m = modelOf(records)
  const { text, cut } = fit(m)
  const a = m.adherence
  const c = m.checks
  const json = {
    head: m.head,
    commands: {
      rows: m.commands.rows.map(r => ({
        kind: r.kind,
        command: r.command,
        exit: r.exit,
        sessionRecorded: r.sessionRecorded,
        duration: r.duration,
        runs: r.runs,
        counts: r.counts,
        disagrees: r.disagrees,
        earlierRed: r.earlierRed,
        locator: r.locator
      })),
      skipped: m.commands.skipped,
      halted: m.commands.halted,
      reason: m.commands.reason,
      failingTests: m.commands.tests
    },
    checks: c.state === 'ok' ? { state: c.state, checks: c.checks, excluded: c.excluded } : { state: c.state, sha: c.sha ?? null },
    adherence:
      a.state === 'checked'
        ? { state: a.state, confirmed: a.confirmed, unconfirmed: a.unconfirmed, omitted: a.omitted }
        : { state: a.state },
    gaps: m.gaps,
    visual: m.visual.noList ? { paths: [], count: 0, indirectCount: 0 } : { paths: m.visual.paths, count: m.visual.count, indirectCount: m.visual.indirectCount },
    cut
  }
  return { text, json }
}

/**
 * The three lines the description's testing section carries: what ran, what did
 * not, and where the proof is. The exit codes are the comment's, with its marks.
 * @param {object} records
 * @param {{ unposted?: boolean }} [opts]
 * @returns {string}
 */
export function renderSummary(records, { unposted = false } = {}) {
  const m = commandsModel(records)
  const ran = m.noCommand
    ? 'no command ran'
    : m.rows
        .map(row => {
          const exit = row.noResult ? 'no result recorded' : `exit ${row.exit}${row.sessionRecorded ? ' session-recorded' : ''}`
          const counts = row.counts && 'total' in row.counts ? `, ${row.counts.total} tests: ${COUNT_KEYS.slice(1).filter(k => k in row.counts).map(k => `${row.counts[k]} ${k}`).join(', ')}` : ''
          const mark = row.disagrees ? ` ${disagreesLine(row)}` : ''
          return `${kindText(row.kind)} ${span(row.command)} ${exit}${counts}${mark}`
        })
        .join('; ') + (m.halted ? ', halted' : '')
  const notRun = m.skipped.length ? m.skipped.map(s => kindText(s.kind)).join(', ') : 'nothing skipped'
  const proof = unposted
    ? `not posted for ${span(records.head)}`
    : `the latest ${span(`Validation — ${records.head}`)} comment on this pull request`
  return `- Ran: ${ran}\n- Not run: ${notRun}\n- Proof: ${proof}\n`
}
