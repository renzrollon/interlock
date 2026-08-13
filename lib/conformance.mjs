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
  const resolved = resolveChange(root, requested)
  if (resolved.error) {
    return { skipped: true, reason: resolved.error, change: null, scenarios: [], changedFiles: [] }
  }
  const change = resolved.name

  const inspection = inspectChange(root, change)
  if (!inspection || !inspection.exists) {
    return { skipped: true, reason: `change "${change}" has no artifacts on disk`, change, scenarios: [], changedFiles: [] }
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
    verdictsRequired: scenarios.length
  }
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
