// Judge calibration — how often a judged grader agreed with a human on the
// same transcript, and out of how many.
//
// A judged grader's verdict is a model's opinion. Every other grader type in the
// suite is decidable from the trace; these two are not, and nothing so far has
// asked whether the opinion is any good. This module answers that, and answers
// nothing else: it reports agreement with its denominator and issues NO verdict.
// There is no floor here, no pass, no fail, and the command exits successfully
// whatever the number says. The floor lives on the limits surface and is applied
// by `interlock evals promote` — one module decides, one measures, and keeping
// them apart is what stops a later edit from turning a measurement into a gate.
//
// Why a command rather than a test, when the calibration *presence* check is a
// test: half the input is not in the repository. The human labels are committed
// (`evals/<case>/calibration/<grader>/`), but the judge's votes are in a results
// file a run produced. A test over repository files structurally cannot see them
// (design D2).
//
// No model and no network: this compares a stored label against a recorded vote.
// Re-judging a transcript would measure the judge against itself.
//
// Exposed as `interlock evals calibrate --results <file> [--labels <dir>]`.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Grader types whose verdict comes from a model judge. */
const JUDGED_TYPES = new Set(['llm', 'baseline', 'judge', 'judged', 'model-judge', 'semantic'])

function isJudged(grader) {
  if (grader && grader.judged === true) return true
  const type = grader && typeof grader.type === 'string' ? grader.type.toLowerCase() : ''
  return JUDGED_TYPES.has(type)
}

function graderName(grader, i) {
  return grader && typeof grader.name === 'string' && grader.name ? grader.name : `grader-${i + 1}`
}

/**
 * The identity that matches a label to a vote. The harness records a
 * `trace_path` per run; a label names the same run in its `transcript:` field.
 * Every fallback is a field the same run object might carry instead — an
 * unidentifiable run is left unnamed rather than given a positional index, so it
 * cannot accidentally match a label meant for a different run.
 */
function runIdentity(run, i) {
  for (const key of ['transcript', 'trace_path', 'trace', 'id', 'run_id']) {
    const v = run && run[key]
    if (typeof v === 'string' && v) return v
  }
  return `run-${i + 1}`
}

/** `pass` / `fail`, normalised. Anything else is not a label. */
function normaliseLabel(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase()
  if (['pass', 'passed', 'true', 'yes', 'ok'].includes(v)) return 'pass'
  if (['fail', 'failed', 'false', 'no'].includes(v)) return 'fail'
  return null
}

const key = (caseName, grader, transcript) => `${caseName}/${grader}/${transcript}`

/**
 * Compare stored human labels against recorded judge votes.
 *
 * Pure: no fs, no network, no model. The same inputs always yield the same
 * report, which is what makes a disagreement worth arguing about.
 *
 * @param {{labels?: Array, results?: any, graders?: string[]}} input
 *   `labels`   — `{ case, grader, transcript, label }` records read from
 *                `evals/<case>/calibration/<grader>/`
 *   `results`  — a parsed results file
 *   `graders`  — optional: judged graders known to exist in the suite. Supplying
 *                it lets a grader with no calibration set AND no vote in this
 *                results file still be reported as unmeasured rather than
 *                vanish, which is the difference between "not measured" and
 *                "not mentioned".
 * @returns {{graders: Array, unmeasured: string[], unmatchedLabels: string[],
 *            unmatchedVotes: string[], counts: {measured: number, unmeasured: number}}}
 */
export function calibrate({ labels = [], results = null, graders = [] } = {}) {
  // --- the judge's recorded votes -----------------------------------------
  const votes = new Map() // key -> boolean passed
  const votedGraders = new Set()
  const r = results && typeof results === 'object' && !Array.isArray(results) ? results : {}
  for (const kase of Array.isArray(r.cases) ? r.cases : []) {
    const caseName = kase && typeof kase.id === 'string' && kase.id ? kase.id : '(unnamed)'
    const runs = Array.isArray(kase && kase.runs) ? kase.runs : []
    runs.forEach((run, i) => {
      const transcript = runIdentity(run, i)
      const graderList = Array.isArray(run && run.graders) ? run.graders : []
      graderList.forEach((g, gi) => {
        if (!isJudged(g)) return
        const name = graderName(g, gi)
        votedGraders.add(`${caseName}/${name}`)
        votes.set(key(caseName, name, transcript), g.passed === true)
      })
    })
  }

  // --- the human labels ----------------------------------------------------
  const byGrader = new Map() // `<case>/<grader>` -> label records
  const labelKeys = new Set()
  for (const raw of Array.isArray(labels) ? labels : []) {
    const caseName = String((raw && raw.case) || '').trim()
    const grader = String((raw && raw.grader) || '').trim()
    const transcript = String((raw && raw.transcript) || '').trim()
    const label = normaliseLabel(raw && raw.label)
    if (!caseName || !grader || !transcript || !label) continue
    const id = `${caseName}/${grader}`
    if (!byGrader.has(id)) byGrader.set(id, [])
    byGrader.get(id).push({ caseName, grader, transcript, label })
    labelKeys.add(key(caseName, grader, transcript))
  }

  // Every judged grader worth reporting on: those the caller named, those the
  // results file voted on, and those a label exists for. The union, so a grader
  // is never dropped for being absent from one of the three.
  const known = new Set([...graders, ...votedGraders, ...byGrader.keys()])

  const report = []
  const unmeasured = []
  const unmatchedLabels = []

  for (const id of [...known].sort()) {
    const records = byGrader.get(id) || []
    if (records.length === 0) {
      // No calibration set at all. Named, never omitted, and never reported as
      // agreeing (calibration spec, "A judged grader with no calibration set is
      // stated, never assumed").
      unmeasured.push(id)
      report.push({
        id,
        status: 'no_calibration_set',
        agreements: null,
        comparisons: 0,
        agreement: null,
        oneSided: null,
        labelled: 0
      })
      continue
    }

    let agreements = 0
    let comparisons = 0
    for (const rec of records) {
      const k = key(rec.caseName, rec.grader, rec.transcript)
      if (!votes.has(k)) {
        // Excluded from the denominator EXPLICITLY. A labelled transcript with
        // no vote is missing evidence, not evidence of agreement.
        unmatchedLabels.push(k)
        continue
      }
      comparisons += 1
      if (votes.get(k) === (rec.label === 'pass')) agreements += 1
    }

    const outcomes = new Set(records.map(rec => rec.label))
    const oneSided = outcomes.size === 1 ? [...outcomes][0] : null

    if (comparisons === 0) {
      // Labels exist but none of them matched a vote. Distinct from having no
      // set at all, and distinct from disagreeing on every one.
      report.push({
        id,
        status: 'no_matches',
        agreements: null,
        comparisons: 0,
        agreement: null,
        oneSided,
        labelled: records.length
      })
      continue
    }

    report.push({
      id,
      status: 'measured',
      agreements,
      comparisons,
      agreement: agreements / comparisons,
      oneSided,
      labelled: records.length
    })
  }

  // A judge vote nobody labelled. Reported for the same reason as the mirror
  // case: the pair of lists is what makes the denominator auditable.
  const unmatchedVotes = [...votes.keys()].filter(k => !labelKeys.has(k)).sort()

  return {
    graders: report,
    unmeasured,
    unmatchedLabels: unmatchedLabels.sort(),
    unmatchedVotes,
    counts: {
      measured: report.filter(g => g.status === 'measured').length,
      unmeasured: report.filter(g => g.status !== 'measured').length
    }
  }
}

/**
 * Read every stored label under `<evalsDir>/<case>/calibration/<grader>/`.
 *
 * Separate from `calibrate` on purpose: the decision stays pure and testable
 * from literals, and the filesystem walk is the part that has to know the
 * layout (`evals/CALIBRATION-LAYOUT.md`).
 *
 * A label file whose frontmatter is unreadable is returned in `problems` rather
 * than skipped — a label nobody could parse must not read as a label that does
 * not exist.
 *
 * @returns {{labels: Array, problems: string[]}}
 */
export function readLabels(evalsDir) {
  const labels = []
  const problems = []
  if (!existsSync(evalsDir) || !statSync(evalsDir).isDirectory()) {
    return { labels, problems: [`${evalsDir}: no such directory — no labels were read`] }
  }
  for (const caseEntry of readdirSync(evalsDir, { withFileTypes: true })) {
    if (!caseEntry.isDirectory()) continue
    const calDir = join(evalsDir, caseEntry.name, 'calibration')
    if (!existsSync(calDir) || !statSync(calDir).isDirectory()) continue
    for (const graderEntry of readdirSync(calDir, { withFileTypes: true })) {
      if (!graderEntry.isDirectory()) continue
      const graderDir = join(calDir, graderEntry.name)
      for (const file of readdirSync(graderDir).filter(f => f.endsWith('.md'))) {
        const path = join(graderDir, file)
        let text
        try {
          text = readFileSync(path, 'utf8')
        } catch (err) {
          problems.push(`${path}: could not be read (${err && err.message})`)
          continue
        }
        const fm = /^---\n([\s\S]*?)\n---/.exec(text)
        if (!fm) {
          problems.push(`${path}: no frontmatter block — not counted as a label`)
          continue
        }
        const field = k => {
          const m = new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(fm[1])
          return m ? m[1].trim().replace(/['"]/g, '') : ''
        }
        const label = normaliseLabel(field('label'))
        const transcript = field('transcript')
        if (!label || !transcript) {
          problems.push(
            `${path}: needs both \`transcript:\` and \`label: pass|fail\` — not counted as a label`
          )
          continue
        }
        labels.push({
          case: caseEntry.name,
          grader: field('grader') || graderEntry.name,
          transcript,
          label
        })
      }
    }
  }
  return { labels, problems }
}

/**
 * Human-readable rendering. There is no verdict here to render — the command
 * exits 0 whatever this says, and the text states that so a reader does not go
 * looking for one.
 */
export function formatCalibration(result, problems = []) {
  const lines = []
  const pct = g => `${g.agreements}/${g.comparisons} (${Math.round(g.agreement * 100)}%)`

  if (result.graders.length === 0) {
    lines.push('no judged grader was found to calibrate')
  }
  for (const g of result.graders) {
    if (g.status === 'measured') {
      lines.push(`  agreement  ${g.id}  ${pct(g)}`)
      if (g.oneSided) {
        // Not a complete measurement, and saying so is the whole point: a judge
        // that answers "pass" to everything agrees perfectly with a set that
        // holds only passes (calibration spec, "One-sided set is reported as
        // such").
        lines.push(
          `             one side only — every stored label is "${g.oneSided}", so this is ` +
            `not a complete measurement`
        )
      }
    } else if (g.status === 'no_matches') {
      lines.push(
        `  unmeasured ${g.id}  agreement could not be measured — ${g.labelled} stored ` +
          `label(s), none matching a judge vote in this results file`
      )
    } else {
      lines.push(`  unmeasured ${g.id}  no calibration set stored`)
    }
  }

  for (const k of result.unmatchedLabels) {
    lines.push(`  unmatched  label ${k} — no judge vote in this results file; excluded from the denominator`)
  }
  for (const k of result.unmatchedVotes) {
    lines.push(`  unmatched  vote ${k} — no stored human label; excluded from the denominator`)
  }
  for (const p of problems) lines.push(`  problem    ${p}`)

  lines.push(
    `  ${result.counts.measured} grader(s) measured, ${result.counts.unmeasured} unmeasured`
  )
  lines.push('this report classifies nothing; the promotion decision applies the floor')
  return lines.join('\n') + '\n'
}
