// Spec conformance — does the code actually do what the delta specs say?
//
// The oldest criticism of spec-driven anything: prose specifications are not
// unambiguous, and nothing proves the code conforms to them. Interlock checks
// that tests pass and that the diff survives review, but neither of those asks
// the question the specs were written to answer — *was the described behaviour
// built?* A change can be green, reviewed, shipped, and still not implement the
// scenario its own spec set out.
//
// This module does the deterministic half: enumerate every scenario the change
// promised and pair it with the files the change touched. It renders a
// checklist. It NEVER decides whether a scenario is satisfied — that is a
// judgement about prose against code, which is the model's job, and pretending
// otherwise would be inventing a verdict from a regex.
//
// WHY IT DOES NOT BLOCK. Same reason as lib/drift.mjs, and the reasoning is not
// worth restating twice: a model matching prose scenarios to code produces a
// probabilistic answer, and a gate that halts a run on one would be wrong often
// enough to be switched off. A gate everyone disables protects nothing. So the
// checklist is emitted, an agent fills it in, and a person reads the result.
//
// Exposed to skills as `interlock conformance --change <name>`.

import { inspectChange, isCoverableSource, resolveChange } from './artifacts.mjs'
import { extractScenarios, readArtifactsFromDisk } from './ready.mjs'

/** Delta specs are the behavioural contract. A scenario in prose elsewhere is context. */
const SPEC_ARTIFACT = /^specs\//

/**
 * Build the conformance checklist for a change.
 *
 * @param {string} root
 * @param {string} [requested]  change name; resolved when omitted
 * @param {{changed?: string[]}} [opts]  the run's diff, for pairing
 */
export function buildChecklist(root = '.', requested, opts = {}) {
  // Read path: a change archived in the pull request still resolves, read-only.
  const resolved = resolveChange(root, requested, { archived: true })
  if (resolved.error) {
    return { skipped: true, reason: resolved.error, change: null, scenarios: [], changedFiles: [] }
  }
  const change = resolved.name

  // Present only for an archived read, so an active change's checklist is field
  // for field what it was; a caller prints `CHANGE READ FROM ARCHIVE: <dir>`.
  const fromArchive = resolved.archived ? { archived: true, dir: resolved.dir } : {}
  const inspection = inspectChange(root, change, { dir: resolved.dir, archived: resolved.archived })
  if (!inspection || !inspection.exists) {
    return { skipped: true, reason: `change "${change}" has no artifacts on disk`, change, scenarios: [], changedFiles: [], ...fromArchive }
  }

  const artifacts = readArtifactsFromDisk(inspection)
  const all = extractScenarios(artifacts)
  const fromSpecs = all.filter(s => SPEC_ARTIFACT.test(s.artifact))

  // Scenarios written into proposal.md or design.md are not the contract, but
  // silently dropping them would hide a change that put its only scenarios in
  // the wrong file — which looks identical to a change with no scenarios.
  const outsideSpecs = all.length - fromSpecs.length

  const scenarios = fromSpecs.map((s, i) => ({
    id: `C${i + 1}`,
    artifact: s.artifact,
    line: s.line,
    title: s.title,
    body: s.body.trim()
  }))

  const changedFiles = (Array.isArray(opts.changed) ? opts.changed : []).filter(isCoverableSource)

  return {
    skipped: false,
    reason: null,
    change,
    scenarios,
    outsideSpecs,
    changedFiles,
    // Stated rather than implied: this module produced the questions, not the
    // answers, and a consumer that treats an unanswered checklist as a pass has
    // misread it.
    verdictsRequired: scenarios.length,
    ...fromArchive
  }
}

/**
 * The living list: the requirements already in force for the capabilities the
 * change touches, as questions for the handoff. Pure. It is the domain
 * reviewer's own selection and bounded text (`lib/prompts/domain-context.mjs`)
 * turned into locations, so the reviewer and the handoff can never disagree about
 * which living requirements a change is judged against.
 *
 * Headings and locations only, never a requirement body: whoever answers reads
 * the spec at the cited line, as it reads a scenario's artifact. Identifiers run
 * L1..Ln in capability then spec order, and `requirementsRequired` is the only
 * denominator a reader may use. design D5 of
 * complete-and-record-the-merge-verdict.
 *
 * `skipped` and `partial` come from the selection alone: the assembler also
 * reports a skip when a graph linked nothing, and that is an empty list, not a
 * missing graph.
 *
 * @param {{ selection?: object, assembled?: object }} input
 * @returns {{
 *   skipped: string|null, partial: string|null,
 *   requirements: { id: string, capability: string, artifact: string, line: number, title: string }[],
 *   requirementsRequired: number,
 *   omitted: { capability: string, heading: string }[],
 *   source: string
 * }}
 */
export function buildLivingChecklist({ selection, assembled } = {}) {
  const skipped = typeof selection?.skipped === 'string' && selection.skipped ? selection.skipped : null
  const partial = typeof selection?.partial === 'string' && selection.partial ? selection.partial : null
  const kept = Array.isArray(assembled?.kept) ? assembled.kept : []
  const requirements = kept.map((entry, i) => ({
    id: `L${i + 1}`,
    capability: entry.capability,
    artifact: `openspec/specs/${entry.capability}/spec.md`,
    line: entry.line,
    title: entry.heading
  }))
  return {
    skipped,
    partial,
    requirements,
    requirementsRequired: requirements.length,
    omitted: (Array.isArray(assembled?.omitted) ? assembled.omitted : []).map(o => ({
      capability: o.capability,
      heading: o.heading
    })),
    source: typeof assembled?.source === 'string' ? assembled.source : 'the working tree'
  }
}

/** The living block of a checklist, as lines; empty when none was asked for. */
function livingLines(living) {
  if (!living || typeof living !== 'object') return []
  const lines = ['']
  const n = Array.isArray(living.requirements) ? living.requirements.length : 0
  if (living.skipped) {
    lines.push(`  Living requirements — not built: ${living.skipped}`)
    return lines
  }
  lines.push(`  Living requirements in force — ${n} to confirm (read from ${living.source})`)
  if (living.partial) lines.push(`  Partial: ${living.partial}`)
  for (const r of living.requirements ?? []) {
    lines.push(`  ${r.id}  ${r.title}`)
    lines.push(`      ${r.artifact}:${r.line}`)
  }
  if (Array.isArray(living.omitted) && living.omitted.length) {
    lines.push('')
    lines.push(`  ${living.omitted.length} requirement${living.omitted.length === 1 ? '' : 's'} left out to fit the size bound:`)
    for (const o of living.omitted) lines.push(`    ${o.capability}: ${o.heading}`)
  }
  return lines
}

/** Human-readable checklist. One numbered question per scenario, nothing decided. */
export function formatChecklist(result) {
  const lines = []
  if (result.skipped) {
    lines.push(`CONFORMANCE — not built: ${result.reason}`)
    lines.push('')
    lines.push('Nothing here blocks.')
    return lines.join('\n')
  }

  if (!result.scenarios.length) {
    lines.push(`CONFORMANCE — no scenarios in the delta specs for "${result.change}"`)
    if (result.outsideSpecs) {
      lines.push('')
      lines.push(
        `  ${result.outsideSpecs} scenario heading${result.outsideSpecs === 1 ? '' : 's'} exist outside specs/ ` +
          `(proposal.md or design.md). Those are context, not contract — if they describe`
      )
      lines.push('  behaviour this change promises, they belong in a delta spec.')
    } else {
      lines.push('')
      lines.push('  A change may legitimately carry none. But a change that promised behaviour and')
      lines.push('  wrote no scenario has nothing to conform to, which is worth noticing.')
    }
    lines.push(...livingLines(result.living))
    lines.push('')
    lines.push('Nothing here blocks.')
    return lines.join('\n')
  }

  lines.push(
    `CONFORMANCE — ${result.scenarios.length} scenario${result.scenarios.length === 1 ? '' : 's'} to verify for "${result.change}"`
  )
  lines.push('')
  for (const s of result.scenarios) {
    lines.push(`  ${s.id}  ${s.title}`)
    lines.push(`      ${s.artifact}:${s.line}`)
  }
  lines.push(...livingLines(result.living))

  if (result.changedFiles.length) {
    lines.push('')
    lines.push(`  Changed source files to check against (${result.changedFiles.length}):`)
    for (const f of result.changedFiles) lines.push(`    ${f}`)
  }

  lines.push('')
  lines.push('  These are questions, not results. Each needs an agent to read the implementation')
  lines.push('  and answer with a file:line citation. An unanswered checklist is not a pass.')
  lines.push('')
  lines.push('Nothing here blocks. Conformance is reported so a person can decide.')
  return lines.join('\n')
}
