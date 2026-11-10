// One fixture answer per step of a real ship run, shared by every fake host.
//
// Four fixture CLIs (`fake-claude`, `fake-codex`, `fake-qwen` and the ACP
// `agent.mjs`) drive the same run program, so they need the same answers. Four
// copies of "what does an implementer lane return" is four chances for one host
// to look green against a shape the others stopped producing — the same drift
// the run program itself exists to remove one layer up.
//
// Which step this is comes off the BRIEFING, because that is all a headless
// vendor CLI ever receives: there is no label on the wire. The review is a
// fan-out, so there are two answers to it: a dimension briefing (its own
// `# Dimension: <name>` heading) WRITES that dimension's ledger to the file the
// briefing names, and a skeptic briefing (its published opening sentence as a
// whole line) WRITES the verdicts for the findings it lists to the file it
// names. The CLI folds and adjudicates those files, since the strict tail is
// driven by them and never by a count the agent reports about itself — a
// fixture that only returned numbers would exercise nothing.
//
// The planner's answer WRITES the classification too, from the seed the test
// left at FIXTURE_CLASSIFIED_PATH: `run start` removes any classified.json that
// exists before the planner has run, so a repository seeded with the real file
// would start every run with no classification at all.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Write a file relative to the agent's own working directory (its lane worktree). */
export function write(rel, value) {
  const dest = join(process.cwd(), rel)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, typeof value === 'string' ? `${value}\n` : JSON.stringify(value, null, 2) + '\n')
}

/**
 * Where a test repository leaves the classification its planner "writes".
 *
 * Outside `.claude/ship/`, so no run clears it. The real planner reads the
 * change and writes `.claude/ship/classified.json`; the fixture planner reads
 * this file and writes the same path, when — and only when — it is briefed.
 */
export const FIXTURE_CLASSIFIED_PATH = '.interlock-fixture/classified.json'

/** The planner's answer: write the classification the test seeded, as a real planner writes one. */
function plannerAnswer() {
  let seed
  try {
    seed = JSON.parse(readFileSync(join(process.cwd(), FIXTURE_CLASSIFIED_PATH), 'utf8'))
  } catch (err) {
    // Spoken, never silent: the run then halts on "no readable classified.json",
    // and this line says why instead of leaving the test to guess.
    process.stderr.write(
      `fixture planner: no classification seed at ${FIXTURE_CLASSIFIED_PATH} (${(err && err.code) || err}) — wrote nothing\n`
    )
    return { ok: true, taskCount: 0 }
  }
  write('.claude/ship/classified.json', seed)
  return { ok: true, taskCount: Array.isArray(seed.tasks) ? seed.tasks.length : 0 }
}

/** The answer file a review or skeptic briefing names, or null when it names none. */
function answerPathIn(text) {
  const m = /\.claude\/ship\/review\/(?:dimensions|skeptics)\/[A-Za-z0-9._-]+\.json/.exec(text)
  return m ? m[0] : null
}

/**
 * A reviewer's answer: the ledger of the one dimension its briefing names, with
 * the fixture's findings under `language` and nothing under any other.
 */
function dimensionAnswer(text) {
  const path = answerPathIn(text)
  if (!path) return { ok: false, detail: 'the briefing names no answer file' }
  const dimension = path.replace(/^.*\//, '').replace(/\.json$/, '')
  write(path, { dimension, findings: dimension === 'language' ? reviewFiles().findings[0].findings : [] })
  return { ok: true }
}

/**
 * A skeptic's answer: a verdict for every finding its briefing lists, read off
 * the `### F-… — severity — file:line` heading and the `Title:` line beneath
 * it, voting real for every finding but the one the fixture refutes.
 */
function skepticAnswer(text) {
  const path = answerPathIn(text)
  if (!path) return { ok: false, detail: 'the briefing names no answer file' }
  const verdicts = [
    ...text.matchAll(/^### (F-[0-9a-f]{8}) — (\w+) — ([^\n]+?)(?::\d+)?\nDimension: [^\n]*\nTitle: ([^\n]+)/gm)
  ].map(([, findingId, severity, file, title]) => {
    const isReal = title !== 'a refuted warning'
    return {
      findingId,
      findingTitle: title,
      file,
      isReal,
      confidence: 0.9,
      reasoning: 'skeptic',
      evidence: `${file}:1`,
      refinedSeverity: isReal ? severity : 'dismiss',
      qualityScore: 4,
      severityScore: isReal ? 4 : 1
    }
  })
  write(path, verdicts)
  return { ok: true }
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
 * @param {boolean|string} [opts.perLane] derive the path from the lane's own task ids
 *   (`docs/lane-<id>.md`); a string names a source directory instead
 *   (`<dir>/lane-<id>.mjs`), for a test whose wave must not read as docs-only.
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
  // A skeptic's opening sentence is a whole line of its briefing, and a
  // dimension's heading is the first line of its rubric. The remediation
  // briefing quotes rubrics too, so it is told apart first.
  if (/^You are (a skeptical code reviewer|an independent reviewer giving a second opinion)\.$/m.test(text)) {
    return skepticAnswer(text)
  }
  if (/^Remediation /m.test(text)) return { ok: true }
  if (/^# Dimension: \S+$/m.test(text) && answerPathIn(text)) return dimensionAnswer(text)
  if (/Produce the handoff artifacts/.test(text)) {
    return { ok: true, manualTestPlan: false, skipReason: 'backend only', scenariosChecked: 0 }
  }
  if (/^Commit change /m.test(text)) return { ok: true, sha: 'fixture' }
  if (/classified\.json/.test(text)) return plannerAnswer()
  if (requires('results')) {
    // A test that needs a fix attempt names a marker file: the first verify
    // answer that finds it absent creates it and reports a red unit suite, so
    // the run emits a fix attempt; every later answer is green.
    const redOnce = process.env.INTERLOCK_FIXTURE_RED_VERIFY_ONCE
    if (redOnce && !existsSync(redOnce)) {
      writeFileSync(redOnce, 'red\n')
      return { results: [{ kind: 'unit', exitCode: 1, total: 1, passed: 0, failed: 1, failures: ['fixture red'] }] }
    }
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
  if (perLane) {
    const lane = (ids[0] || 'lane').replace(/[^\w.-]+/g, '-')
    writePath = typeof perLane === 'string' ? `${perLane}/lane-${lane}.mjs` : `docs/lane-${lane}.md`
  }
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
