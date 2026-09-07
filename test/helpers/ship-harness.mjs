// Run workflows/ship.js against stubbed agents and a real CLI, and capture
// every briefing the run handed out.
//
// Why execute the script rather than grep it. A prompt built by concatenating
// template literals can lose a whole instruction to a stray unary `+`: it
// coerces its operand to `NaN`, drops the instruction out of the assembled
// string, and leaves the source bytes completely intact. So `readFileSync` +
// `assert.match` — the technique every other prompt test in this repo used —
// passes on the broken file. Only the assembled output can see that class of
// defect.
//
// What changed when the loop became a program. The script no longer assembles
// briefings at all: it spawns what a step names and calls the argv the step
// names. So the harness answers two different kinds of agent:
//
//   - A RELAY ping, whose prompt names one `interlock` command. The harness
//     performs the writes that prompt asks for and RUNS THE COMMAND for real,
//     against a temp repository it prepared, returning its stdout as
//     `cliStdout`. The loop is therefore driven by the actual run program, not
//     by a fixture of what it might have said.
//   - A WORKER, whose prompt is the by-reference bootstrap. The harness reads
//     the briefing file the bootstrap names, records it under the spawn's label,
//     and answers from the canned response — including the sha256 the script
//     requires back, since a run whose every worker failed the acknowledgement
//     check would exercise nothing.
//
// The script cannot be imported: the workflow runtime rejects a script
// containing `import()`, so ship.js has no exports and ends in a top-level
// `return`. It is read, stripped of its `export const meta` block, and
// evaluated inside an async function via `new Function`.
//
// Deliberately Node-only: no network, no API key, no model.

import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCli } from '../../lib/host.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SHIP = join(ROOT, 'workflows', 'ship.js')

/** The coercion artifacts JavaScript produces when a concatenation goes wrong. */
export const COERCION_ARTIFACTS = ['NaN', 'undefined', '[object Object]', 'null']

/** Every dimension rubric the run program can inline into a review briefing. */
const RUBRIC_DIR = join(ROOT, 'skills', 'review-code', 'dimensions')
let rubricTexts = null
function inlinedRubrics() {
  if (rubricTexts) return rubricTexts
  let names = []
  try {
    names = readdirSync(RUBRIC_DIR).filter(f => f.endsWith('.md'))
  } catch {
    names = []
  }
  rubricTexts = names
    .map(name => {
      try {
        return readFileSync(join(RUBRIC_DIR, name), 'utf8').trim()
      } catch {
        return ''
      }
    })
    .filter(Boolean)
  return rubricTexts
}

/** A prompt with every verbatim-inlined rubric removed. See `coercionArtifacts`. */
function inlinedFilesRemoved(text) {
  let out = text
  for (const rubric of inlinedRubrics()) out = out.split(rubric).join('')
  return out
}

/**
 * Which coercion artifacts an assembled prompt contains.
 *
 * `NaN`, `undefined` and `[object Object]` are flagged wherever they appear.
 * None of them has a legitimate use in a prompt: each is what JavaScript prints
 * when an interpolation lost its operand.
 *
 * `null` is different, and the difference is stated rather than papered over.
 * These prompts contain the word deliberately, in two shapes:
 *
 *   - a JSON value the agent is shown — `"blocker": null`, `"blocker":null`
 *   - English prose — "status ok means blocker is null", "leave the field null"
 *
 * Flagging those would make the check noise, and a noisy check gets muted. So
 * `null` is flagged only where it cannot be deliberate: quoted as a whole
 * string (`"null"`, which is what `change "${change}"` produces when `change`
 * is null), after an `=`, or glued to adjacent text. THE RESIDUAL IS REAL: a
 * coerced null landing in prose position — "leave the field null" produced by
 * an interpolation rather than typed — is not detectable from the assembled
 * string alone, and this helper does not claim otherwise.
 *
 * TEXT THE CLI INLINED VERBATIM FROM A FILE IS NOT SCANNED. Since
 * `emit-strict-tail-from-cli`, a review briefing carries each dimension's
 * written criteria as bytes read off disk, and `skills/review-code/dimensions/
 * language.md` says "nullability handled by hope" — an ordinary English word
 * that `null[A-Za-z0-9_]` cannot tell from a coerced operand glued to its
 * neighbour. The check is about what CONCATENATION produced, so the inlined
 * regions are removed first: nothing in them came from an interpolation, and
 * leaving them in would make the check fire on prose and get muted.
 *
 * @param {string} prompt an assembled prompt
 * @returns {string[]} the artifacts found
 */
export function coercionArtifacts(prompt) {
  const text = inlinedFilesRemoved(String(prompt))
  const found = []
  for (const artifact of ['NaN', 'undefined', '[object Object]']) {
    if (text.includes(artifact)) found.push(artifact)
  }
  if (/["']null["']|=\s*null\b|[A-Za-z0-9_]null|null[A-Za-z0-9_]/.test(text)) found.push('null')
  return found
}

/**
 * The prompts a ship run puts in front of an agent, by label.
 *
 * This list is the coverage contract: the prompt-integrity suite fails when one
 * of these is never assembled, so adding a step without extending the
 * enumerated runs is a test failure rather than a silent reduction in what is
 * checked. It is short now, and that IS the change: the briefings themselves are
 * enumerated by `lib/prompts/index.mjs`'s registry and checked there, whether or
 * not a driven run happens to reach them.
 */
export const EXPECTED_PROMPT_LABELS = Object.freeze([
  'validate',
  'cli-',
  'plan-waves',
  'verify',
  // The strict tail. It is in the contract rather than left to whichever runs
  // the suite happens to exercise, because a briefing behind an opt-in flag is
  // exactly the one that stops being checked without anyone noticing.
  'review',
  'remediate-',
  'handoff',
  'commit'
])

/** ship.js with its `export const meta` block removed, so it can be evaluated. */
export function shipSource() {
  const text = readFileSync(SHIP, 'utf8')
  const body = text.replace(/^export const meta = \{[\s\S]*?^\}\n/m, '')
  if (body === text) {
    throw new Error('ship.js no longer opens with an `export const meta = {…}` block')
  }
  return body
}

/**
 * A findings/verdicts pair that adjudicates to exactly the counts asked for.
 *
 * The strict tail is driven by FILES now: the review agent writes findings and
 * verdicts, and `interlock run reviewed` adjudicates them with the run's own
 * observed changed paths (`emit-strict-tail-from-cli`, design D2). So a fixture
 * cannot simply state "raised 2, surviving 1" — that number is computed, which
 * is the point. It states the two files, and the CLI's own arithmetic produces
 * the counts.
 *
 * Every verdict cites `file:1-2`, and `file` defaults to the one the stubbed
 * implementer actually writes — a dismissal whose citation is not in the diff
 * is REJECTED by the evidence gate and the finding survives, which is the
 * behaviour the gate exists for and would silently invert a fixture that cited
 * a path nothing touched.
 *
 * @param {{blockers?: number, warnings?: number, dismissed?: number, file?: string}} [shape]
 * @returns {{findings: object, verdicts: object[]}}
 */
export function reviewFiles({ blockers = 0, warnings = 1, dismissed = 1, file = 'lib/a.mjs' } = {}) {
  const raised = []
  const verdicts = []
  const vote = (title, isReal, severity) => {
    for (const i of [1, 2]) {
      verdicts.push({
        findingTitle: title,
        file,
        isReal,
        confidence: 0.9,
        reasoning: `skeptic ${i} ${isReal ? 'agrees' : 'refutes'}`,
        evidence: `${file}:1-2`,
        refinedSeverity: isReal ? severity : 'dismiss',
        // Above `TOLERANCE_BAND.minQualityToReport`, and identical across both
        // skeptics so the drift clause never fires: a fixture whose counts
        // depended on disagreement would be testing the band, not the tail.
        qualityScore: 4,
        severityScore: isReal ? 4 : 1
      })
    }
  }
  const add = (title, severity, isReal) => {
    raised.push({ severity, file, line: 1, title, description: `${title} in ${file}`, suggestion: 'fix it' })
    vote(title, isReal, severity)
  }
  for (let i = 0; i < blockers; i++) add(`blocker ${i + 1}`, 'blocker', true)
  for (let i = 0; i < warnings; i++) add(`warning ${i + 1}`, 'warning', true)
  for (let i = 0; i < dismissed; i++) add(`dismissed ${i + 1}`, 'warning', false)
  return { findings: [{ dimension: 'language', findings: raised }], verdicts }
}

/** A handoff packet the wave state machine would accept. */
export function handoffFor(id) {
  return {
    schema: 'interlock.wave-handoff/1',
    taskId: id,
    status: 'ok',
    summary: `did ${id}`,
    evidence: [`lib/a.mjs:1-2`],
    next: 'nothing',
    blocker: null
  }
}

/**
 * A stand-in for the workflow runtime's `budget`, whose cumulative counter
 * advances by `perRead` on every read.
 *
 * Monotonic and never repeating, so a per-wave delta that landed on the wrong
 * boundary produces a different number rather than the same one — a fixture
 * returning a constant would make every wrong attribution look right.
 *
 * `total` is null on purpose: that is what the runtime reports when no token
 * target was set, and it is the case a guard written against `budget.total`
 * would blank.
 */
export function countingBudget(perRead = 100) {
  let spent = 0
  const reads = []
  return {
    total: null,
    spent() {
      spent += perRead
      reads.push(spent)
      return spent
    },
    reads
  }
}

// --- the repository a run is driven against ---------------------------------

/** The change every harness run ships, unless a test supplies its own. */
export const DEMO_CHANGE = 'demo-change'

const DEMO_CLASSIFIED = {
  tasks: [
    {
      id: '1.1',
      group: 1,
      description: 'task 1.1',
      tier: 2,
      model: 'sonnet',
      isTestTask: false,
      paths: ['lib/a.mjs']
    }
  ]
}

/**
 * A temp repository holding one ready change and an initialised git tree.
 *
 * git is real rather than faked: `record-batch` reads the observed changed-path
 * set from it, and an isolated batch reads its merge base from it. A fake would
 * only prove the fake works.
 */
export function makeRepo(over = {}) {
  // `reuseRoot` continues a previous run's repository rather than making a new
  // one — which is the only way plan reuse can be exercised at all: reuse is a
  // property of what the last run left behind, and a fresh tree has nothing to
  // reuse.
  if (over.reuseRoot) return { root: over.reuseRoot, change: over.change || DEMO_CHANGE }
  const root = mkdtempSync(join(tmpdir(), 'interlock-ship-'))
  const change = over.change || DEMO_CHANGE
  const base = `openspec/changes/${change}`
  const file = (path, body) => {
    const dest = join(root, path)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n')
  }
  // `broken` omits the proposal, so the change resolves by name and fails
  // validation — which is the "halted before the reuse check" case, distinct
  // from a name that resolves to nothing at all.
  if (!over.broken) file(`${base}/proposal.md`, '# Demo\n\nWhy: to have something to ship.\n')
  file(`${base}/design.md`, '# Design\n\nD1: keep it small.\n')
  file(`${base}/tasks.md`, over.tasks ?? '# Tasks\n\n- [ ] 1.1 task 1.1\n')
  file('lib/a.mjs', 'export const a = 1\n')
  if (over.profile) file('.claude/testing/profile.json', over.profile)
  execFileSync('git', ['init', '-q', '.'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: root })
  execFileSync('git', ['add', '-A'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root })
  // A tasks.md nothing can write: the work happens, the checkbox cannot be
  // marked, and the run has to say so rather than let an unchecked box read
  // downstream as a failed task.
  if (over.readOnlyTasks) chmodSync(join(root, `${base}/tasks.md`), 0o444)
  return { root, change }
}

// --- answering the two kinds of agent ---------------------------------------

/**
 * The `interlock …` command a relay prompt names, or null when it names none.
 *
 * Single quotes are honoured, because the real relay is a shell and an argument
 * can hold a whole sentence — a halt reason is one argument and would otherwise
 * arrive as several. A harness that split on whitespace would make the quoting
 * untested and the reason silently truncated.
 */
function commandIn(prompt) {
  const m = /Then run exactly:\n {2}interlock ([^\n]+)/.exec(prompt)
  if (!m) return null
  const out = []
  const rx = /'((?:[^']|'\\'')*)'|(\S+)/g
  let token
  while ((token = rx.exec(m[1].trim()))) {
    out.push(token[1] === undefined ? token[2] : token[1].replace(/'\\''/g, "'"))
  }
  return out
}

/** The writes a relay prompt asks for, in order. */
function writesIn(prompt) {
  const out = []
  const rx = /Write this JSON to (\S+) exactly as given:\n(.+)/g
  let m
  while ((m = rx.exec(prompt))) {
    try {
      out.push({ path: m[1], value: JSON.parse(m[2]) })
    } catch {
      // A relay prompt whose payload is not JSON is a defect in the script, not
      // something the harness should paper over — it is left unwritten so the
      // CLI reports the missing file.
    }
  }
  return out
}

/** The briefing file a bootstrap prompt names, and the sha it must be answered with. */
function bootstrapIn(prompt) {
  const path = /Your briefing for this step is the file (\S+)\./.exec(prompt)
  const sha = /Expected sha256: ([0-9a-f]{64})/.exec(prompt)
  return path && sha ? { path: path[1], sha: sha[1] } : null
}

function lookup(responses, label) {
  if (Object.prototype.hasOwnProperty.call(responses, label)) return responses[label]
  for (const key of Object.keys(responses)) {
    if (key.endsWith('-') && label.startsWith(key)) return responses[key]
  }
  return null
}

/**
 * The default answers. Every key is an agent label (or a label prefix ending in
 * `-`); the value is the result object, or a function of
 * `(label, callIndex, ctx)` where `ctx` is `{ root, write }` — the third
 * argument is how a stubbed tail agent writes the work files the CLI then
 * adjudicates, which is the only way the strict path can be driven at all.
 *
 * There is no entry for a step's continuation: those come from the CLI, run for
 * real. What is canned here is only what a MODEL would have produced.
 */
export function defaultResponses() {
  return {
    validate: { hasGraph: true, hasTestProfile: true, haikuAvailable: true },
    'plan-waves': { ok: true, taskCount: 1 },
    '1.1': { id: '1.1', ok: true, handoff: handoffFor('1.1'), filesChanged: ['lib/a.mjs'] },
    verify: { results: [{ kind: 'unit', exitCode: 0, total: 1, passed: 1, failed: 0 }] },
    // Two findings raised, one refuted by both skeptics with a citation in the
    // diff, one warning surviving — computed by the CLI from these files, not
    // asserted by the agent. The result carries counts nobody reads: `run
    // reviewed` adjudicates the files and never the report.
    review: (label, n, ctx) => {
      const { findings, verdicts } = reviewFiles()
      ctx.write('.claude/ship/findings.json', findings)
      ctx.write('.claude/ship/verdicts.json', verdicts)
      return { ok: true }
    },
    // A fixer that fixes nothing: the files it was asked to rewrite are left as
    // the review wrote them, so the re-adjudication finds the same warning and
    // no blocker, and the run walks to the verdict. A test that wants a fixer
    // which actually clears something cans its own.
    'remediate-': { ok: true },
    handoff: { ok: true, manualTestPlan: false, skipReason: 'backend only' },
    commit: { ok: true, sha: 'deadbee' },
    replan: { revised: false }
  }
}

/**
 * Execute ship.js against stubbed agents and a real `interlock`.
 *
 * @param {{
 *   args?: unknown,
 *   responses?: object,
 *   budget?: {total: number|null, spent: () => number},
 *   repo?: object,
 *   keepRepo?: boolean
 * }} [opts]
 *   `responses` is merged over `defaultResponses()`. A value may be a function
 *   `(label, callIndex) => result` so a label answered twice can answer
 *   differently the second time. `budget` stands in for the workflow runtime's
 *   token accounting; omitted, the script sees no such global at all.
 * @returns {Promise<{prompts: Array<{label: string, prompt: string, model?: string}>,
 *   output: string, calls: string[], root: string, commands: string[][]}>}
 */
export async function runShip(opts = {}) {
  const responses = { ...defaultResponses(), ...(opts.responses || {}) }
  const prompts = []
  const calls = []
  const commands = []
  const seen = new Map()
  const { root, change } = makeRepo(opts.repo || {})
  // The classification the planner spawn is supposed to write. It is placed up
  // front rather than by the stub, because the classify step's continuation
  // reads it and the harness answers agents, not files.
  const classified = opts.classified || DEMO_CLASSIFIED
  mkdirSync(join(root, '.claude', 'ship'), { recursive: true })
  writeFileSync(
    join(root, '.claude', 'ship', 'classified.json'),
    JSON.stringify(classified, null, 2) + '\n'
  )

  /** What a stubbed agent writes into the repository, as an agent would. */
  const write = (rel, value) => {
    const dest = join(root, rel)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n')
    return rel
  }
  const ctx = { root, write }

  /**
   * Make a stubbed implementer's `filesChanged` true.
   *
   * It used to be a claim about files nothing touched, which was harmless while
   * the run only counted it — and stopped being harmless when the strict tail
   * started adjudicating against the run's OBSERVED diff. A dismissal citing
   * `lib/a.mjs` must find `lib/a.mjs` in that diff or the evidence gate rejects
   * it, so the stub does what the agent it stands in for does: it writes.
   */
  const materialize = body => {
    for (const rel of Array.isArray(body && body.filesChanged) ? body.filesChanged : []) {
      if (typeof rel !== 'string' || !rel.trim()) continue
      const dest = join(root, rel)
      mkdirSync(dirname(dest), { recursive: true })
      let existing = ''
      try {
        existing = readFileSync(dest, 'utf8')
      } catch {
        existing = ''
      }
      writeFileSync(dest, `${existing}// touched by the stubbed implementer\n`)
    }
    return body
  }

  const agent = async (prompt, options = {}) => {
    const label = options.label || '(unlabeled)'
    const n = (seen.get(label) || 0) + 1
    seen.set(label, n)
    calls.push(label)
    const text = String(prompt)

    // A relay: perform its writes, run its command for real, hand back stdout.
    const argv = commandIn(text)
    if (argv) {
      prompts.push({ label, prompt: text, model: options.model, relay: true })
      // A relay canned as `null` is a relay the runtime stopped mid-run: nothing
      // is written and nothing runs, and the script sees exactly what agent()
      // returns in that case. It is the only way a fixture can reach the
      // "could not be read" path, since every other relay runs the CLI for real.
      if (Object.prototype.hasOwnProperty.call(responses, label) && responses[label] === null) return null
      for (const w of writesIn(text)) {
        const dest = join(root, w.path)
        mkdirSync(dirname(dest), { recursive: true })
        writeFileSync(dest, JSON.stringify(w.value, null, 2) + '\n')
      }
      commands.push(argv)
      // `commandIn` already captured everything AFTER the binary name, and
      // `runCli` invokes bin/interlock itself — so this is the subcommand and
      // its flags, passed through whole.
      const result = await runCli(argv, { cwd: root })
      return { cliStdout: result.stdout }
    }

    // A worker: record the briefing it was pointed at, and answer with the
    // acknowledgement the script requires plus whatever a model would report.
    const bootstrap = bootstrapIn(text)
    if (bootstrap) {
      let briefing = ''
      try {
        briefing = readFileSync(join(root, bootstrap.path), 'utf8').split('\n').slice(1).join('\n')
      } catch {
        briefing = ''
      }
      prompts.push({ label, prompt: briefing, model: options.model, isolation: options.isolation })
      const canned = lookup(responses, label)
      const body = materialize(typeof canned === 'function' ? canned(label, n, ctx) : canned)
      if (body === null) return null
      // The acknowledgement the script requires back. Supplied by default so an
      // ordinary run exercises the work rather than the guard — and NOT
      // overridden when a fixture states its own, which is how the fail-closed
      // direction is reachable at all.
      return Object.prototype.hasOwnProperty.call(body || {}, 'briefing')
        ? body
        : { ...(body || {}), briefing: bootstrap.sha }
    }

    // Anything else — the environment probe, and the tail's own spawns, which no
    // step names yet.
    prompts.push({ label, prompt: text, model: options.model, isolation: options.isolation })
    const canned = lookup(responses, label)
    return typeof canned === 'function' ? canned(label, n, ctx) : canned
  }

  const pipeline = async (items, ...stages) =>
    Promise.all(
      (Array.isArray(items) ? items : []).map(async (item, i) => {
        let value = item
        for (const stage of stages) value = await stage(value, item, i)
        return value
      })
    )

  const parallel = async thunks => Promise.all((thunks || []).map(t => t()))
  const noop = () => {}

  // `budget` is a workflow-runtime global the script reads for token spend. It
  // is a parameter here rather than a fixture default so BOTH shapes are
  // reachable: a runtime that exposes accounting, and one that does not. Left
  // out, the parameter is `undefined` and `typeof budget === 'undefined'` holds
  // inside the script — which is the degrade path the ACP host actually takes,
  // and the one a bare reference would have thrown on.
  const run = new Function(
    'agent',
    'pipeline',
    'parallel',
    'log',
    'phase',
    'args',
    'budget',
    `return (async () => {\n${shipSource()}\n})()`
  )

  let output
  try {
    output = await run(
      agent,
      pipeline,
      parallel,
      noop,
      noop,
      opts.args === undefined ? change : opts.args,
      opts.budget
    )
  } finally {
    if (!opts.keepRepo) {
      try {
        chmodSync(join(root, 'openspec', 'changes', change, 'tasks.md'), 0o644)
      } catch {
        // Already writable, or already gone. Either way the removal below is
        // what matters.
      }
      rmSync(root, { recursive: true, force: true })
    }
  }
  return { prompts, output: String(output ?? ''), calls, commands, root }
}

/**
 * The receipt a run wrote, read back off its own trajectory.
 *
 * It used to be parsed out of the prompt a closing agent was handed, because
 * that transport was the one step of the receipt's path an agent could see.
 * Nothing is handed to an agent now — the CLI builds the receipt and appends it
 * — so it is read where it is actually stored, which is also where every reader
 * downstream of a run reads it.
 *
 * Requires `keepRepo: true` on the run.
 */
export function receiptFrom(root) {
  return lastEvent(root, 'run-receipt')
}

/** The outcome corpus line a run appended, read back off disk. */
export function outcomeFrom(root) {
  let raw
  try {
    raw = readFileSync(join(root, '.claude', 'learning', 'outcomes.jsonl'), 'utf8')
  } catch {
    return null
  }
  const lines = raw.split('\n').filter(Boolean)
  return lines.length ? JSON.parse(lines[lines.length - 1]) : null
}

/** The last trajectory event of a given type, or null. */
export function lastEvent(root, type) {
  for (const event of trajectory(root).reverse()) {
    if (event.type === type) return event
  }
  return null
}

/** Every trajectory event a run wrote, in order. */
export function trajectory(root) {
  const dir = join(root, '.claude', 'ship', 'runs')
  let files
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.jsonl'))
  } catch {
    return []
  }
  return files.flatMap(f =>
    readFileSync(join(dir, f), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line)
        } catch {
          return {}
        }
      })
  )
}

/** Every prompt an enumerated set of runs assembled, flattened. */
export async function collectPrompts(runs) {
  const all = []
  for (const run of runs) {
    const { prompts } = await runShip(run)
    all.push(...prompts)
  }
  return all
}

/**
 * The runs that between them reach every prompt in `EXPECTED_PROMPT_LABELS`,
 * including the ones only an opt-in flag builds.
 */
export function coverageRuns() {
  return [
    // Lean: probe → classify → one wave → verify → commit.
    {},
    // --strict: the review, remediation, verdict and handoff briefings. They
    // are emitted by the CLI like every other step now, and reached here so the
    // coverage contract does not depend on which flags a suite happens to pass.
    { args: `${DEMO_CHANGE} --strict` },
    // A repo with a test profile, so final verification actually plans a step
    // and the verify briefing is assembled. Without one the CLI skips the
    // verification — correctly, and with the reason said out loud — and that
    // briefing would never be reached by any enumerated run.
    { repo: { profile: { version: 1, unit: { command: 'npm test' } } } },
    // --isolate-waves: the lane briefing gains its isolation paragraph.
    { args: `${DEMO_CHANGE} --isolate-waves` },
    // --solo: the one run that threads a plan-shape override into the planner.
    { args: `${DEMO_CHANGE} --solo` }
  ]
}
