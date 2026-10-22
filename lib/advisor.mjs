// The checkpoint advisor's draft check, renderer and kill-criterion tally.
//
// The model drafts; this module decides what of the draft survives, by code.
// Ids are positional (`Q<n>`, `R<n>`) and any id the model wrote is ignored, so
// a duplicated id cannot collide a pane key or blur the `## Dropped` table. A
// cite must resolve to a heading that exists in a citable file. A draft is
// validated first and capped second, so a bad cite inside the first ten never
// hides an eleventh good question behind `over cap`. Nothing the model wrote
// disappears without a row in `## Dropped` saying why.
//
// Nothing here reads a clock: the stamp and the brief's path are the caller's,
// so the same inputs give the same bytes. The only I/O is `headingIndex` (reads
// a change folder) and `verdictFromLabels` (reads the labels tree).
//
// See add-checkpoint-advisor design.md D5, D8, D12, D21, D26, D27.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LIMITS } from './limits.mjs'
import { readLabels } from './evals-calibrate.mjs'
import { table, didNotRunStanza, keepThenCap } from './advisor-kit.mjs'

/**
 * The closed list of risk kinds, lifted from what `docs/02-the-checkpoint.md`
 * tells a human to look for. The brief prints it; the check drops anything else.
 */
export const RISK_KINDS = Object.freeze([
  'scope-expansion',
  'unstated-assumption',
  'reuse-missed',
  'unpinned-dependency',
  'error-path-missing',
  'single-caller-abstraction',
  'decision-without-rationale',
  'deferred-work',
  'vague-task',
  'sibling-left',
  'same-file-split',
  'untestable-spec',
  'function-named-scenario',
  'no-failure-path'
])

const fold = s => String(s).trim().replace(/\s+/g, ' ').toLowerCase()

/** The `##`, `###` and `####` headings of a markdown text, folded; fenced code skipped. */
function headingsOf(text) {
  const out = []
  let fence = null
  for (const line of String(text).split(/\r?\n/)) {
    const f = /^\s*(```+|~~~+)/.exec(line)
    if (f) {
      if (fence === null) fence = f[1][0]
      else if (f[1][0] === fence) fence = null
      continue
    }
    if (fence !== null) continue
    const m = /^(#{2,4})\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) out.push(fold(m[2]))
  }
  return out
}

function specFiles(dir, rel = 'specs') {
  const out = []
  let entries
  try {
    entries = readdirSync(join(dir, rel), { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = `${rel}/${e.name}`
    if (e.isDirectory()) out.push(...specFiles(dir, path))
    else if (e.name === 'spec.md') out.push(path)
  }
  return out
}

/**
 * The citable files of a change and the folded headings each holds:
 * `proposal.md`, `design.md`, `tasks.md` and every `specs/**\/spec.md`, those
 * that exist. The ledger and `advisor.md` are not citable.
 *
 * @param {string} changeDir
 * @returns {Record<string, string[]>}
 */
export function headingIndex(changeDir) {
  const index = {}
  for (const file of ['proposal.md', 'design.md', 'tasks.md', ...specFiles(changeDir)]) {
    const path = join(changeDir, file)
    if (!existsSync(path)) continue
    try {
      index[file] = headingsOf(readFileSync(path, 'utf8'))
    } catch {
      // An unreadable artifact is not citable; a cite into it will not resolve.
    }
  }
  return index
}

function citeResolves(cite, index) {
  if (typeof cite !== 'string') return false
  const at = cite.indexOf('#')
  if (at < 0) return false
  const file = cite.slice(0, at).trim()
  const heading = fold(cite.slice(at + 1))
  if (!heading || !Object.prototype.hasOwnProperty.call(index ?? {}, file)) return false
  return index[file].includes(heading)
}

function taskIds(tasksText) {
  const ids = new Set()
  for (const line of String(tasksText ?? '').split(/\r?\n/)) {
    const m = /^\s*[-*]\s+\[[ xX]\]\s+(\S+)/.exec(line)
    if (m) ids.add(m[1].replace(/\.$/, ''))
  }
  return ids
}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = v => (typeof v === 'string' ? v.trim() : '')

const didNotRunResult = reason => ({ status: 'did-not-run', reason, questions: [], risks: [], dropped: [] })

/**
 * Validate a draft by code.
 *
 * @param {unknown} draft  the parsed reply
 * @param {Record<string,string[]>} index  `headingIndex` of the change
 * @param {string} tasksText  the change's tasks.md
 * @param {{ maxAdvisorQuestions: number }} limits
 * @returns {{ status: 'drafted'|'did-not-run', reason?: string,
 *             questions: Array<{id,question,why,cite}>,
 *             risks: Array<{id,where,kind,note}>,
 *             dropped: Array<{id,reason}> }}
 */
export function checkDraft(draft, index, tasksText, limits = LIMITS) {
  if (!isObject(draft)) return didNotRunResult('draft is not a JSON object')
  const rawQuestions = draft.questions === undefined ? [] : draft.questions
  const rawRisks = draft.risks === undefined ? [] : draft.risks
  if (!Array.isArray(rawQuestions)) return didNotRunResult('questions is not an array')
  if (!Array.isArray(rawRisks)) return didNotRunResult('risks is not an array')

  const cap = limits.maxAdvisorQuestions ?? LIMITS.maxAdvisorQuestions
  const { kept: questions, dropped: droppedQuestions } = keepThenCap(
    rawQuestions,
    q => {
      if (!isObject(q) || !text(q.question) || !text(q.cite)) return 'missing field'
      if (!citeResolves(q.cite, index)) return 'cite does not resolve'
      return { question: text(q.question), why: text(q.why), cite: text(q.cite) }
    },
    cap,
    { prefix: 'Q' }
  )

  const tasks = taskIds(tasksText)
  const { kept: risks, dropped: droppedRisks } = keepThenCap(
    rawRisks,
    r => {
      if (!isObject(r) || !text(r.kind) || !text(r.note) || (!text(r.task) && !text(r.cite))) return 'missing field'
      if (!RISK_KINDS.includes(text(r.kind))) return 'unknown kind'
      let where
      if (text(r.task)) {
        const task = text(r.task)
        if (!tasks.has(task)) return 'no such task'
        where = `task ${task}`
      } else {
        if (!citeResolves(r.cite, index)) return 'cite does not resolve'
        where = text(r.cite)
      }
      return { where, kind: text(r.kind), note: text(r.note) }
    },
    Infinity,
    { prefix: 'R' }
  )
  const dropped = [...droppedQuestions, ...droppedRisks]

  return { status: 'drafted', questions, risks, dropped }
}

const CLOSING =
  'This file is advisory: `interlock ready`, `interlock ledger` and `interlock validate` do not read it, ' +
  'and a question becomes a decision only when a person writes it into `decisions.md`.'

const title = change => (change ? `# Checkpoint advisor — ${change}` : '# Checkpoint advisor')

/**
 * The stanza for a consult that did not run: heading, the reason, the closing
 * line, and no tables.
 */
export function didNotRun(reason, { change, stamp } = {}) {
  return didNotRunStanza(reason, { title: title(change), closing: CLOSING, stamp })
}

/**
 * Render `advisor.md`. A result that did not run renders as the did-not-run
 * stanza.
 *
 * @param {ReturnType<typeof checkDraft>} result
 * @param {{ change?: string, stamp?: string, briefPath?: string }} opts
 */
export function renderAdvisor(result, { change, stamp, briefPath } = {}) {
  if (result.status !== 'drafted') return didNotRun(result.reason, { change, stamp, briefPath })
  const status = `drafted ${stamp ?? ''}${briefPath ? ` from ${briefPath}` : ''}`.replace(/\s+$/, '')
  return [
    title(change),
    '',
    status,
    '',
    '## Questions for the human',
    '',
    table(['id', 'question', 'why', 'cites'], result.questions.map(q => [q.id, q.question, q.why, q.cite])),
    '',
    '## Risks',
    '',
    table(['id', 'where', 'kind', 'note'], result.risks.map(r => [r.id, r.where, r.kind, r.note])),
    '',
    '## Dropped',
    '',
    table(['id', 'reason'], result.dropped.map(d => [d.id, d.reason])),
    '',
    '## Not a gate',
    '',
    CLOSING,
    ''
  ].join('\n')
}

// --- the kill criterion ----------------------------------------------------

const GRADERS = ['matches-label', 'answered-already']
const escapeRe = v => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The majority of a case's labels on one grader: 'pass', 'fail', or null on a tie. */
function majority(labels) {
  const pass = labels.filter(l => l === 'pass').length
  const fail = labels.length - pass
  return pass > fail ? 'pass' : fail > pass ? 'fail' : null
}

/**
 * Tally a range's human labels against the caps. By default, the Spec Range
 * cases: reads, through the reader `interlock evals calibrate` uses, only
 * `spec-range-*` cases and only the `matches-label` and `answered-already`
 * graders. A case is labelled when both graders carry at least one well-formed
 * label; its label on a grader is the majority of that grader's files, a tie
 * counting as neither. A statement for a person, never a gate.
 *
 * `options` re-aims the tally at another range, each defaulting to the Spec
 * Range's value: `prefix` the case-name prefix, `graders` the two grader names
 * (the first must pass for a match, the second failing counts as a repeat),
 * `minLabels`, `keepMin` and `repeatMax` the caps.
 *
 * @param {string} evalsDir
 * @param {object} limits
 * @param {{ prefix?: string, graders?: string[], minLabels?: number,
 *           keepMin?: number, repeatMax?: number }} [options]
 */
export function verdictFromLabels(evalsDir, limits = LIMITS, options = {}) {
  const { prefix = 'spec-range-', graders = GRADERS } = options
  const [matchGrader, repeatGrader] = graders
  const caps = {
    minLabels: options.minLabels ?? limits.advisorVerdictMinLabels ?? LIMITS.advisorVerdictMinLabels,
    keepMinMatches: options.keepMin ?? limits.advisorKeepMinMatches ?? LIMITS.advisorKeepMinMatches,
    repeatMaxPercent: options.repeatMax ?? limits.advisorRepeatMaxPercent ?? LIMITS.advisorRepeatMaxPercent
  }
  const { labels, problems: allProblems } = readLabels(evalsDir)

  const byCase = new Map()
  for (const l of labels) {
    if (!l.case.startsWith(prefix) || !graders.includes(l.grader)) continue
    if (!byCase.has(l.case)) byCase.set(l.case, { [matchGrader]: [], [repeatGrader]: [] })
    byCase.get(l.case)[l.grader].push(l.label)
  }

  const ours = new RegExp(`^${escapeRe(prefix)}[^\\\\/]*[\\\\/]calibration[\\\\/](${graders.map(escapeRe).join('|')})[\\\\/]`)
  const problems = allProblems.filter(p => {
    if (p.startsWith(`${evalsDir}: no such directory`)) return true
    const rest = p.startsWith(evalsDir) ? p.slice(evalsDir.length).replace(/^[\\/]+/, '') : p
    return ours.test(rest)
  })

  let labelled = 0
  let matches = 0
  let repeats = 0
  for (const g of byCase.values()) {
    if (g[matchGrader].length === 0 || g[repeatGrader].length === 0) continue
    labelled++
    if (majority(g[matchGrader]) === 'pass') matches++
    if (majority(g[repeatGrader]) === 'fail') repeats++
  }

  const reasons = []
  let verdict
  if (labelled < caps.minLabels) {
    verdict = `INSUFFICIENT LABELS (${labelled} of ${caps.minLabels})`
  } else {
    if (matches < caps.keepMinMatches) reasons.push(`matches ${matches} < keepMinMatches ${caps.keepMinMatches}`)
    if (repeats * 100 > caps.repeatMaxPercent * labelled) {
      reasons.push(`repeats ${repeats} of ${labelled} > repeatMaxPercent ${caps.repeatMaxPercent}%`)
    }
    verdict = reasons.length === 0 ? 'KEEP' : 'KILL'
  }
  return { step: 'verdict', verdict, labelled, matches, repeats, caps, reasons, problems }
}
