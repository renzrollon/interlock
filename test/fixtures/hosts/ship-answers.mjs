// One fixture answer per step of a real ship run, shared by every fake host.
//
// Four fixture CLIs (`fake-claude`, `fake-codex`, `fake-qwen` and the ACP
// `agent.mjs`) drive the same run program, so they need the same answers. Four
// copies of "what does an implementer lane return" is four chances for one host
// to look green against a shape the others stopped producing — the same drift
// the run program itself exists to remove one layer up.
//
// Which step this is comes off the BRIEFING, because that is all a headless
// vendor CLI ever receives: there is no label on the wire. The review answer
// WRITES the findings and verdicts the CLI then adjudicates, since the strict
// tail is driven by those files and never by a count the agent reports about
// itself — a fixture that only returned numbers would exercise nothing.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Write a file relative to the agent's own working directory (its lane worktree). */
export function write(rel, value) {
  const dest = join(process.cwd(), rel)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, typeof value === 'string' ? `${value}\n` : JSON.stringify(value, null, 2) + '\n')
}

/** Findings and verdicts that adjudicate to one surviving warning, no blocker. */
export function reviewFiles() {
  const file = 'README.md'
  const findings = []
  const verdicts = []
  for (const [title, isReal] of [['a real warning', true], ['a refuted warning', false]]) {
    findings.push({ severity: 'warning', file, line: 1, title, description: `${title} here`, suggestion: 'fix it' })
    for (const i of [1, 2]) {
      verdicts.push({
        findingTitle: title,
        file,
        isReal,
        confidence: 0.9,
        reasoning: `skeptic ${i}`,
        evidence: `${file}:1`,
        refinedSeverity: isReal ? 'warning' : 'dismiss',
        qualityScore: 4,
        severityScore: isReal ? 4 : 1
      })
    }
  }
  return { findings: [{ dimension: 'language', findings }], verdicts }
}

/**
 * The result one step's briefing asks for.
 *
 * @param {string} text the assembled briefing this spawn received
 * @param {object} [opts]
 * @param {string} [opts.writePath] the file an implementer lane writes; a test
 *   that needs two lanes to collide points them at the same one.
 * @param {boolean} [opts.perLane] derive the path from the lane's own task ids
 *   instead, so a batch of disjoint lanes really is disjoint on the filesystem.
 * @param {object} [opts.schema] the result schema this spawn was given. The ACP
 *   adapter appends it to the prompt (there is no schema channel on that wire),
 *   but every vendor CLI takes it as a flag — so a fixture that only read the
 *   prompt would answer a one-task lane with the many-task shape and every lane
 *   would fail for a reason that has nothing to do with the code under test.
 * @returns {object}
 */
export function shipAnswer(text, { writePath = 'README.md', perLane = false, schema = null } = {}) {
  const requires = key =>
    schema && Array.isArray(schema.required)
      ? schema.required.includes(key)
      : new RegExp(`"required":\\[[^\\]]*"${key}"`).test(text)
  if (/Adversarially review the diff/.test(text)) {
    const { findings, verdicts } = reviewFiles()
    write('.claude/ship/findings.json', findings)
    write('.claude/ship/verdicts.json', verdicts)
    return { ok: true }
  }
  if (/^Remediation /m.test(text)) return { ok: true }
  if (/Produce the handoff artifacts/.test(text)) {
    return { ok: true, manualTestPlan: false, skipReason: 'backend only', scenariosChecked: 0 }
  }
  if (/^Commit change /m.test(text)) return { ok: true, sha: 'fixture' }
  if (/classified\.json/.test(text)) return { ok: true, taskCount: 1 }
  if (requires('results')) {
    return { results: [{ kind: 'unit', exitCode: 0, total: 1, passed: 1, failed: 0 }] }
  }
  if (requires('revised')) return { revised: false }

  // An implementer lane. The ids are read off the briefing rather than guessed:
  // a lane result that omits an outcome for any task in it fails all of them,
  // which is the run's own fail-closed rule and not something to work around.
  // Both briefing shapes: `TASK 1/2 — 1.1: …` for a lane of several, and
  // `TASK 1.1: …` for a lane of one. Matching only the first silently yielded an
  // empty id list, and every lane then wrote the same fallback path — which
  // looked exactly like a real collision.
  const ids = [...text.matchAll(/^TASK (?:\d+\/\d+ — )?([^:\n]+):/gm)].map(m => m[1].trim())
  const one = requires('handoff') && requires('id')
  if (perLane) writePath = `docs/lane-${(ids[0] || 'lane').replace(/[^\w.-]+/g, '-')}.md`
  const handoff = id => ({
    schema: 'interlock.wave-handoff/1',
    taskId: id,
    status: 'ok',
    summary: `did ${id}`,
    evidence: [`${writePath}:1`],
    next: 'nothing',
    blocker: null
  })
  // Actually write the file the result claims: the review's evidence has to
  // cite a path in the run's OBSERVED diff or the gate rejects the dismissal,
  // and an implementer that implements nothing would make that fixture lie.
  write(writePath, `touched by the fixture agent (${ids.join(', ') || 'lane'})`)
  if (one) {
    const id = ids[0] || '1.1'
    return { id, ok: true, filesChanged: [writePath], handoff: handoff(id) }
  }
  return {
    tasks: ids.map(id => ({ id, outcome: 'ok', filesChanged: [writePath], handoff: handoff(id) }))
  }
}
