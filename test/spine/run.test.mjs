// The run program, driven end to end against a real temp repository.
//
// This is the test the two-driver arrangement never had. Loop policy used to
// live in `workflows/ship.js` and `bin/interlock-ship-acp`, and what covered it
// was a harness that stubbed every agent and a parity test that compared the two
// drivers' prompts after the fact — so a branch either driver took wrong was
// caught only if someone had thought to pin that exact sentence.
//
// The loop is a program now, and a program can be run. Every assertion below
// drives `interlock run` with canned agent results and checks what came back:
// which step, which spawns, which briefing, which continuation. No model, no
// network, no host.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIMITS } from '../../lib/limits.mjs'
import { assembleImplementerPrompt } from '../../lib/prompts/implementer.mjs'
import { BRIEFING_HEADER, briefingHash, runRemediated, runReviewed } from '../../lib/run.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(ROOT, 'bin', 'interlock')

// --- a repository to run against --------------------------------------------

function file(root, path, body) {
  const dest = join(root, path)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n')
  return dest
}

/**
 * A temp repo holding one ready change and an initialised git tree.
 *
 * git is real rather than faked: `record-batch` reads the observed changed-path
 * set from it to audit handoff evidence, and the merge base for an isolated
 * batch is `git rev-parse HEAD`. A fake would only prove the fake works.
 */
function repo(name = 'add-thing', over = {}) {
  const root = mkdtempSync(join(tmpdir(), 'interlock-run-'))
  const base = `openspec/changes/${name}`
  file(root, `${base}/proposal.md`, '# Add thing\n\nWhy: because.\n')
  file(root, `${base}/design.md`, '# Design\n\nD1: use the existing helper.\n')
  file(
    root,
    `${base}/tasks.md`,
    over.tasks ?? '# Tasks\n\n- [ ] 1.1 Add the thing to docs/guide.md\n- [ ] 1.2 Note it in README.md\n'
  )
  file(root, 'README.md', 'hello\n')
  execFileSync('git', ['init', '-q', '.'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: root })
  execFileSync('git', ['add', '-A'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root })
  return { root, change: name }
}

/** Run one `interlock` command in the repo and return its parsed step. */
function run(root, argv, { results, expectExit = 0, env } = {}) {
  const full = [...argv]
  if (results !== undefined) {
    file(root, '.claude/ship/results.json', results)
    full.push('--results', '.claude/ship/results.json')
  }
  full.push('--json')
  let stdout = ''
  let code = 0
  try {
    stdout = execFileSync(process.execPath, [BIN, ...full], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // Push configuration reaches the close the same way it reaches a real
      // run: through the child's environment, never through a file in the tree.
      env: env ? { ...process.env, ...env } : process.env
    })
  } catch (err) {
    code = err.status === undefined ? 1 : err.status
    stdout = err.stdout || ''
    if (expectExit === 0) {
      throw new Error(
        `interlock ${full.join(' ')} exited ${code}\nstdout: ${stdout}\nstderr: ${err.stderr || ''}`
      )
    }
  }
  assert.equal(code, expectExit, `interlock ${full.join(' ')} exit code`)
  return { step: stdout.trim() ? JSON.parse(stdout) : null, code }
}

const CLASSIFIED = {
  tasks: [
    {
      id: '1.1',
      group: 1,
      description: 'Add the thing to docs/guide.md',
      tier: 2,
      model: 'sonnet',
      isTestTask: false,
      paths: ['docs/guide.md']
    },
    {
      id: '1.2',
      group: 1,
      description: 'Note it in README.md',
      tier: 2,
      model: 'sonnet',
      isTestTask: false,
      paths: ['README.md']
    }
  ]
}

/** The result an implementer lane reports when every task in it went fine. */
function laneOk(ids) {
  return {
    tasks: ids.map(id => ({
      id,
      outcome: 'ok',
      filesChanged: ['README.md'],
      handoff: {
        schema: 'interlock.wave-handoff/1',
        taskId: id,
        status: 'ok',
        summary: 'done',
        evidence: ['README.md:1'],
        next: 'nothing',
        blocker: null
      }
    }))
  }
}

/** Drive start → classify → classified and return the first dispatchable step. */
function toFirstBatch(root, change, startFlags = []) {
  const started = run(root, ['run', 'start', '--change', change, ...startFlags]).step
  assert.equal(started.action, 'classify')
  file(root, '.claude/ship/classified.json', CLASSIFIED)
  return run(root, [...started.then.argv]).step
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true })
}

// --- the whole lean loop ----------------------------------------------------

test('a lean run walks start → classify → batch → verify → commit → close', () => {
  const { root, change } = repo()
  try {
    const started = run(root, ['run', 'start', '--change', change]).step
    assert.equal(started.action, 'classify')
    assert.equal(started.spawns.length, 1, 'classification is one agent')
    assert.equal(started.spawns[0].label, 'plan-waves')
    assert.deepEqual(started.then.argv, ['run', 'classified', '--classified', '.claude/ship/classified.json'])

    file(root, '.claude/ship/classified.json', CLASSIFIED)
    const batch = run(root, [...started.then.argv]).step
    assert.equal(batch.action, 'run-batch')
    assert.ok(batch.spawns.length >= 1, 'a batch dispatches at least one lane')
    assert.deepEqual(batch.then.argv, ['run', 'record-batch'])

    const ids = batch.lanes.flat().map(t => t.id)
    const recorded = run(root, [...batch.then.argv], {
      results: batch.spawns.map((_, i) =>
        laneOk(batch.lanes[i].map(t => t.id))
      )
    }).step

    // Both tasks recorded ok, so both boxes are ticked — from what the run
    // recorded, never from what the agent claimed.
    const tasks = readFileSync(join(root, `openspec/changes/${change}/tasks.md`), 'utf8')
    for (const id of ids) {
      assert.match(tasks, new RegExp(`- \\[x\\] ${id.replace('.', '\\.')}`), `${id} was not ticked`)
    }

    // No test profile in this repo, so the final verification has no detectable
    // command and skips — with the reason said out loud rather than passed over.
    assert.equal(recorded.action, 'verify-final')
    assert.equal(recorded.skipped, true)
    assert.ok(
      (recorded.banners || []).some(b => b.startsWith('VERIFICATION SKIPPED:')),
      'a skipped verification is a banner, never silence'
    )

    const judged = run(root, [...recorded.then.argv]).step
    assert.equal(judged.action, 'commit')
    assert.equal(judged.spawns.length, 1)
    assert.deepEqual(judged.then.argv, ['run', 'close'])

    const closed = run(root, [...judged.then.argv], { results: [{ ok: true, sha: 'abc1234' }] }).step
    assert.equal(closed.action, 'complete')
    assert.equal(closed.exitCode, 0)
    assert.equal(closed.then, null, 'a terminal step names no continuation')
    assert.match(closed.summary, /SHIP COMPLETE — add-thing/)
    assert.match(closed.summary, /commit: abc1234/)
  } finally {
    cleanup(root)
  }
})

// --- every continuation names a real subcommand -----------------------------

test('every then.argv a run emits names a subcommand bin/interlock dispatches', () => {
  // Read the dispatch table the way test/workflows.test.mjs reads it: from the
  // source, so a step naming an argv nobody implements fails here rather than
  // at 2am inside an unattended run.
  const source = readFileSync(BIN, 'utf8')
  const subcommands = new Set(
    [...source.matchAll(/sub === '([a-z-]+)'/g)].map(m => m[1])
  )
  assert.ok(subcommands.size > 5, 'the dispatch table could not be read')

  const { root, change } = repo()
  try {
    const emitted = []
    const started = run(root, ['run', 'start', '--change', change]).step
    emitted.push(started.then.argv)
    file(root, '.claude/ship/classified.json', CLASSIFIED)
    const batch = run(root, [...started.then.argv]).step
    emitted.push(batch.then.argv)
    const recorded = run(root, [...batch.then.argv], {
      results: batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id)))
    }).step
    emitted.push(recorded.then.argv)
    const judged = run(root, [...recorded.then.argv]).step
    emitted.push(judged.then.argv)

    for (const argv of emitted) {
      assert.equal(argv[0], 'run', `a continuation left the run family: ${argv.join(' ')}`)
      assert.ok(
        subcommands.has(argv[1]),
        `the program emitted \`interlock ${argv.join(' ')}\`, and bin/interlock dispatches no ` +
          `"${argv[1]}" subcommand`
      )
    }
  } finally {
    cleanup(root)
  }
})

// --- briefings (design D2) --------------------------------------------------

test('every spawn carries a briefing file whose first-line hash matches its text', () => {
  const { root, change } = repo()
  try {
    const started = run(root, ['run', 'start', '--change', change]).step
    file(root, '.claude/ship/classified.json', CLASSIFIED)
    const batch = run(root, [...started.then.argv]).step

    for (const step of [started, batch]) {
      for (const s of step.spawns) {
        const body = readFileSync(join(root, s.promptPath), 'utf8')
        const [header, ...rest] = body.split('\n')
        assert.equal(
          header,
          BRIEFING_HEADER(s.label, s.promptSha256),
          `${s.label}'s briefing does not declare its own label and hash on line one`
        )
        const text = rest.join('\n')
        assert.equal(text, s.prompt, `${s.label}'s file and its step disagree about the briefing`)
        assert.equal(
          briefingHash(text),
          s.promptSha256,
          `${s.label}'s declared hash is not the hash of its text — a host that verified it ` +
            `would fail every task closed`
        )
      }
    }
  } finally {
    cleanup(root)
  }
})

test('an implementer briefing is the assembled implementer prompt for its lane', () => {
  const { root, change } = repo()
  try {
    const started = run(root, ['run', 'start', '--change', change]).step
    file(root, '.claude/ship/classified.json', CLASSIFIED)
    const batch = run(root, [...started.then.argv]).step
    const lane = batch.lanes[0]
    const tasks = CLASSIFIED.tasks.filter(t => lane.some(l => l.id === t.id))
    const expected = assembleImplementerPrompt({
      change,
      lane: tasks,
      previousHandoffs: [],
      isolateWaves: false,
      solo: batch.mode === 'solo'
    })
    assert.ok(
      batch.spawns[0].prompt.includes(expected),
      'the lane briefing is not the assembled implementer prompt — the CLI is wording its own'
    )
  } finally {
    cleanup(root)
  }
})

test('a lane spawn declares the worker agent, its tools, and its lane model and effort', () => {
  const { root, change } = repo()
  try {
    const started = run(root, ['run', 'start', '--change', change]).step
    file(root, '.claude/ship/classified.json', CLASSIFIED)
    const batch = run(root, [...started.then.argv]).step
    const s = batch.spawns[0]
    assert.equal(s.type, 'interlock:worker')
    assert.deepEqual(s.tools, ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'])
    assert.equal(s.model, 'sonnet', 'the lane runs on its hardest task\'s model')
    assert.equal(s.effort, 'low', 'and at its hardest task\'s tier effort')
    assert.equal(s.schema.type, 'object', 'a spawn always names the schema its result must satisfy')
  } finally {
    cleanup(root)
  }
})

// --- the flags, decided by the CLI ------------------------------------------

test('--apply-only closes at done rather than verifying or committing', () => {
  const { root, change } = repo()
  try {
    const batch = toFirstBatch(root, change, ['--apply-only'])
    const recorded = run(root, [...batch.then.argv], {
      results: batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id)))
    }).step
    assert.equal(recorded.action, 'close')
    assert.deepEqual(recorded.then.argv, ['run', 'close'])
    assert.equal(recorded.spawns.length, 0, 'apply-only spawns nothing after the waves')

    const closed = run(root, ['run', 'close']).step
    assert.match(closed.summary, /--apply-only: stopped after the waves/)
  } finally {
    cleanup(root)
  }
})

test('--no-commit closes after the final judge instead of spawning a committer', () => {
  const { root, change } = repo()
  try {
    const batch = toFirstBatch(root, change, ['--no-commit'])
    const recorded = run(root, [...batch.then.argv], {
      results: batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id)))
    }).step
    const judged = run(root, [...recorded.then.argv]).step
    assert.equal(judged.action, 'close')
    assert.equal(judged.spawns.length, 0)
    const closed = run(root, [...judged.then.argv]).step
    assert.match(closed.summary, /--no-commit: everything ran, the commit is yours/)
  } finally {
    cleanup(root)
  }
})

// --- the strict tail (emit-strict-tail-from-cli) ----------------------------
//
// Every assertion below drives the real program: the review "agent" is this
// file writing findings.json and verdicts.json, and every count, round and
// halt comes back from `interlock run` adjudicating those files. Nothing here
// asserts a number an agent reported about itself, because the program never
// reads one.

/**
 * A findings/verdicts pair the CLI adjudicates to the shape asked for.
 *
 * Evidence cites `README.md:1`, which the lane result reports as changed and
 * which the repo's own git status therefore carries: a dismissal whose
 * citation is NOT in the observed diff is rejected by the evidence gate and
 * the finding survives — so a fixture citing a path nothing touched would
 * silently invert every count below.
 */
function reviewFiles({ blockers = 0, warnings = 0, dismissed = 0, dimension = 'language' } = {}) {
  const raised = []
  const verdicts = []
  const add = (title, severity, isReal) => {
    raised.push({ severity, file: 'README.md', line: 1, title, description: `${title} here`, suggestion: 'fix it' })
    for (const i of [1, 2]) {
      verdicts.push({
        findingTitle: title,
        file: 'README.md',
        isReal,
        confidence: 0.9,
        reasoning: `skeptic ${i}`,
        evidence: 'README.md:1',
        refinedSeverity: isReal ? severity : 'dismiss',
        qualityScore: 4,
        severityScore: isReal ? 4 : 1
      })
    }
  }
  for (let i = 0; i < blockers; i++) add(`blocker ${i + 1}`, 'blocker', true)
  for (let i = 0; i < warnings; i++) add(`warning ${i + 1}`, 'warning', true)
  for (let i = 0; i < dismissed; i++) add(`dismissed ${i + 1}`, 'warning', false)
  return { findings: [{ dimension, findings: raised }], verdicts }
}

/** Write what a review or fixing round would have written. */
function writeReview(root, shape) {
  const { findings, verdicts } = reviewFiles(shape)
  file(root, '.claude/ship/findings.json', findings)
  file(root, '.claude/ship/verdicts.json', verdicts)
}

/**
 * Drive start → classify → batch → record-batch under the given flags.
 *
 * The lane result claims `README.md` was changed, so the stub writes it. The
 * claim used to be free — nothing read it — and it stopped being free when the
 * tail started adjudicating against the run's OBSERVED diff: a dismissal citing
 * `README.md:1` is REJECTED unless git actually reports that path, and the
 * finding survives. An implementer that implements nothing is not the fixture
 * these assertions need.
 */
function toTail(root, change, startFlags) {
  const batch = toFirstBatch(root, change, startFlags)
  writeFileSync(join(root, 'README.md'), 'hello\nand the thing\n')
  return run(root, [...batch.then.argv], {
    results: batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id)))
  }).step
}

test('a strict run emits review, remediation, the verdict, verification, handoff, commit, close', () => {
  const { root, change } = repo()
  try {
    const review = toTail(root, change, ['--strict'])
    assert.equal(review.action, 'review')
    assert.equal(review.spawns.length, 1, 'one worker fans out the dimensions in its own context')
    assert.equal(review.spawns[0].label, 'review')
    assert.deepEqual(review.then.argv, ['run', 'reviewed'])

    // One blocker raised and upheld: round one has something to fix.
    writeReview(root, { blockers: 1 })
    const round1 = run(root, [...review.then.argv], { results: [{ ok: true }] }).step
    assert.equal(round1.action, 'remediate')
    assert.equal(round1.round, 1)
    assert.deepEqual(round1.then.argv, ['run', 'remediated', '--round', '1'])

    // The fixer cleared it. Nothing is left to spend the rest of the budget on,
    // so the next step is the verdict rather than another fixing round.
    writeReview(root, {})
    const verdict = run(root, [...round1.then.argv], { results: [{ ok: true }] }).step
    assert.equal(verdict.action, 'verdict')
    assert.equal(verdict.round, LIMITS.remediationRounds + 1)

    const verified = run(root, [...verdict.then.argv], { results: [{ ok: true }] }).step
    assert.equal(verified.action, 'verify-final')

    const handoff = run(root, [...verified.then.argv]).step
    assert.equal(handoff.action, 'handoff')
    assert.equal(handoff.spawns.length, 1)
    assert.deepEqual(handoff.then.argv, ['run', 'commit'])

    const commit = run(root, [...handoff.then.argv], {
      results: [{ ok: true, manualTestPlan: false, skipReason: 'backend only', scenariosChecked: 0 }]
    }).step
    assert.equal(commit.action, 'commit')
    assert.deepEqual(commit.then.argv, ['run', 'close'])

    const closed = run(root, [...commit.then.argv], { results: [{ ok: true, sha: 'abc1234' }] }).step
    assert.equal(closed.action, 'complete')
    assert.equal(closed.exitCode, 0)
    assert.doesNotMatch(closed.summary, /LEAN SHIP/, 'a strict run skipped nothing')
    assert.match(closed.summary, /review: 1 raised/)
    assert.match(closed.summary, /remediation:/)
  } finally {
    cleanup(root)
  }
})

test('the review briefing inlines every selected dimension\'s criteria and the policy prose', () => {
  const { root, change } = repo()
  try {
    file(
      root,
      'REVIEW.md',
      '# Review policy\n\n## What "Important" means\n\nIn this repo, a naming nit is a suggestion.\n'
    )
    const review = toTail(root, change, ['--review'])
    const briefing = readFileSync(join(root, review.spawns[0].promptPath), 'utf8')
    for (const name of ['language', 'architecture', 'qa', 'technical-lead']) {
      assert.match(briefing, new RegExp(`## ${name}\\n`), `${name}'s heading is missing`)
    }
    // The criteria themselves, not just the heading: a heading with nothing
    // under it is exactly the failure inlining exists to remove.
    const rubric = readFileSync(
      join(ROOT, 'skills', 'review-code', 'dimensions', 'qa.md'),
      'utf8'
    ).trim()
    assert.ok(briefing.includes(rubric), 'the qa criteria were not inlined')
    assert.match(briefing, /In this repo, a naming nit is a suggestion\./)
    assert.match(briefing, /REPOSITORY REVIEW POLICY/)
    // And the agent is not asked to run the command that used to adjudicate it.
    assert.doesNotMatch(briefing, /interlock (review|remediate|surface|conformance)\b/)
  } finally {
    cleanup(root)
  }
})

test('a dimension whose criteria cannot be read is named in the briefing and bannered', () => {
  // The rubrics are the PLUGIN's files, not the target repo's, so the only way
  // to reach the unreadable case is to make one unreadable. Done against a COPY
  // of the plugin rather than by deleting the shipped file: `node --test` runs
  // test files in parallel, and a rubric that vanishes for 300ms would be a
  // race every other suite could lose.
  const { root, change } = repo()
  const plugin = mkdtempSync(join(tmpdir(), 'interlock-plugin-'))
  try {
    cpSync(join(ROOT, 'package.json'), join(plugin, 'package.json'))
    for (const dir of ['bin', 'lib']) cpSync(join(ROOT, dir), join(plugin, dir), { recursive: true })
    cpSync(
      join(ROOT, 'skills', 'review-code', 'dimensions'),
      join(plugin, 'skills', 'review-code', 'dimensions'),
      { recursive: true, filter: src => !src.endsWith(`${sep}qa.md`) }
    )

    const batch = toFirstBatch(root, change, ['--review'])
    writeFileSync(join(root, 'README.md'), 'hello\nand the thing\n')
    file(
      root,
      '.claude/ship/results.json',
      batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id)))
    )
    const step = JSON.parse(
      execFileSync(
        process.execPath,
        [join(plugin, 'bin', 'interlock'), 'run', 'record-batch', '--results', '.claude/ship/results.json', '--json'],
        { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      )
    )

    assert.equal(step.action, 'review')
    const briefing = readFileSync(join(root, step.spawns[0].promptPath), 'utf8')
    assert.match(
      briefing,
      /No criteria could be read for "qa" — this reviewer works from the dimension name alone\./
    )
    assert.ok(
      (step.banners || []).some(b => b.startsWith('REVIEW RUBRIC UNAVAILABLE: qa')),
      `no REVIEW RUBRIC UNAVAILABLE banner for qa: ${JSON.stringify(step.banners)}`
    )
    // The other reviewers are unaffected: one unreadable file degrades one of them.
    assert.doesNotMatch(briefing, /No criteria could be read for "language"/)
    assert.match(briefing, /## language\n# Dimension: language/)
  } finally {
    rmSync(plugin, { recursive: true, force: true })
    cleanup(root)
  }
})

test('blockers surviving the verdict halt the run, and no commit is ever emitted', () => {
  const { root, change } = repo()
  try {
    const review = toTail(root, change, ['--strict'])
    writeReview(root, { blockers: 1 })
    let step = run(root, [...review.then.argv], { results: [{ ok: true }] }).step

    // Every fixing round leaves the blocker standing, so the budget runs out.
    const actions = []
    while (step.action === 'remediate' || step.action === 'verdict') {
      actions.push(step.action)
      writeReview(root, { blockers: 1 })
      step = run(root, [...step.then.argv], { results: [{ ok: true }] }).step
    }
    assert.deepEqual(
      actions,
      [...Array(LIMITS.remediationRounds).fill('remediate'), 'verdict'],
      'rounds 1..cap fix, and the round after the cap is the verdict'
    )
    assert.equal(step.action, 'halt')
    assert.match(
      step.reason,
      /1 unresolved blocker/,
      `the halt must name the surviving count: ${step.reason}`
    )
    assert.deepEqual(step.then.argv, ['run', 'close', '--halt', step.reason])

    const closed = run(root, [...step.then.argv], { expectExit: 1 }).step
    assert.equal(closed.action, 'halt')
    assert.match(closed.summary, /SHIP HALTED/)
  } finally {
    cleanup(root)
  }
})

test('raising the remediation cap buys one more fixing round, with no driver change', () => {
  // The property a literal silently breaks. Driven IN-PROCESS with the cap
  // raised on the live `LIMITS` object: patching lib/limits.mjs on disk would
  // be visible to every other test file `node --test` is running in parallel,
  // and a cap that flickers under other suites is a worse defect than the one
  // being tested for. Each test file is its own process, so a mutation here is
  // seen by this file alone and restored in `finally`.
  const { root, change } = repo()
  const cap = LIMITS.remediationRounds
  const ctx = {
    root,
    warn: () => {},
    // The only dep the tail path reaches for. Stubbed to the set the lane
    // actually wrote, which is what git would report.
    deps: { observedChangedPaths: () => ['README.md'] }
  }
  try {
    // Reach the review step through the CLI, so the manifest, the wave state
    // and the trajectory are the real ones.
    const review = toTail(root, change, ['--review'])
    assert.equal(review.action, 'review')

    LIMITS.remediationRounds = cap + 1
    writeReview(root, { blockers: 1 })
    let step = runReviewed(ctx, { results: [{ ok: true }] })
    let fixRounds = 0
    while (step.action === 'remediate') {
      fixRounds += 1
      writeReview(root, { blockers: 1 })
      step = runRemediated(ctx, { round: step.round, results: [{ ok: true }] })
    }
    assert.equal(fixRounds, cap + 1, 'one more fixing round than the unraised cap allows')
    assert.equal(step.action, 'verdict')
    assert.equal(step.round, cap + 2, 'and the verdict round moved with the cap')
  } finally {
    LIMITS.remediationRounds = cap
    cleanup(root)
  }
})

test('a clean review skips remediation entirely and goes straight to final verification', () => {
  const { root, change } = repo()
  try {
    const review = toTail(root, change, ['--review'])
    writeReview(root, { dismissed: 1 })
    const next = run(root, [...review.then.argv], { results: [{ ok: true }] }).step
    assert.equal(next.action, 'verify-final', 'nothing survived, so no round is worth spending')
  } finally {
    cleanup(root)
  }
})

test('--handoff alone emits the handoff step and never a review', () => {
  const { root, change } = repo()
  try {
    const step = toTail(root, change, ['--handoff'])
    assert.equal(step.action, 'verify-final', 'nothing to review, so the waves go straight to verification')

    const handoff = run(root, [...step.then.argv]).step
    assert.equal(handoff.action, 'handoff')
    const briefing = readFileSync(join(root, handoff.spawns[0].promptPath), 'utf8')
    assert.match(briefing, /manual test plan/i)
    // Conformance is off, so no scenario checklist is asked for.
    assert.doesNotMatch(briefing, /Spec conformance/)
    assert.equal(handoff.scenarios, null)
  } finally {
    cleanup(root)
  }
})

test('a dimension the reviewer added is adjudicated and recorded on the manifest', () => {
  const { root, change } = repo()
  try {
    const review = toTail(root, change, ['--review'])
    assert.deepEqual(
      review.spawns[0].label,
      'review',
      'the selection travels on the manifest, not on the spawn label'
    )
    // Findings under a dimension the CLI did not select.
    writeReview(root, { warnings: 1, dimension: 'security' })
    const next = run(root, [...review.then.argv], {
      results: [{ ok: true, addedDimensions: [{ name: 'security', reason: 'the diff touches a token path' }] }]
    }).step
    assert.ok(['remediate', 'verify-final'].includes(next.action))

    const manifest = JSON.parse(readFileSync(join(root, '.claude/ship/run.json'), 'utf8'))
    assert.deepEqual(manifest.reviewDimensions.added, [
      { name: 'security', reason: 'the diff touches a token path' }
    ])
    assert.ok(!manifest.reviewDimensions.selected.includes('security'), 'a docs+README diff selects neither optional dimension')
    assert.equal(manifest.review.counts.raised, 1, 'the added dimension\'s finding was adjudicated like any other')
  } finally {
    cleanup(root)
  }
})

test('run close records the autonomy outcome for a strict run and nothing for a lean one', () => {
  const ladder = root => JSON.parse(readFileSync(join(root, '.claude', 'autonomy.json'), 'utf8'))

  // Clean strict run: zero blockers.
  const clean = repo()
  try {
    const review = toTail(clean.root, clean.change, ['--strict'])
    writeReview(clean.root, { dismissed: 1 })
    run(clean.root, [...review.then.argv], { results: [{ ok: true }] })
    run(clean.root, ['run', 'close'], { results: [{ ok: true, sha: 'abc1234' }] })
    const entry = ladder(clean.root)['review-code']
    assert.equal(entry.runs, 1)
    assert.equal(entry.blockers_caught, 0)
  } finally {
    cleanup(clean.root)
  }

  // Halted strict run: what was adjudicated is still recorded.
  const halted = repo()
  try {
    const review = toTail(halted.root, halted.change, ['--strict'])
    writeReview(halted.root, { blockers: 1 })
    run(halted.root, [...review.then.argv], { results: [{ ok: true }] })
    run(halted.root, ['run', 'close', '--halt', 'unresolved blockers'], { expectExit: 1 })
    assert.equal(ladder(halted.root)['review-code'].blockers_caught, 1)
  } finally {
    cleanup(halted.root)
  }

  // Lean run: nothing at all.
  const lean = repo()
  try {
    toTail(lean.root, lean.change, [])
    run(lean.root, ['run', 'close'])
    assert.throws(() => ladder(lean.root), 'a lean run reviewed nothing and must write no ladder entry')
  } finally {
    cleanup(lean.root)
  }
})

test('the commit briefing of a strict run carries no autonomy instruction', () => {
  const { root, change } = repo()
  try {
    const review = toTail(root, change, ['--strict'])
    writeReview(root, { dismissed: 1 })
    const verified = run(root, [...review.then.argv], { results: [{ ok: true }] }).step
    const handoff = run(root, [...verified.then.argv]).step
    const commit = run(root, [...handoff.then.argv], { results: [{ ok: true }] }).step
    assert.equal(commit.action, 'commit')
    const briefing = readFileSync(join(root, commit.spawns[0].promptPath), 'utf8')
    assert.doesNotMatch(briefing, /autonomy|ladder|blockers/i)
  } finally {
    cleanup(root)
  }
})

test('a tail continuation called out of sequence is refused like any other', () => {
  const { root, change } = repo()
  try {
    const review = toTail(root, change, ['--review'])
    assert.deepEqual(review.then.argv, ['run', 'reviewed'])
    // The verdict's continuation, called while the program is waiting for the
    // review's. Skipping ahead would adjudicate a round that never ran.
    const { code } = run(root, ['run', 'remediated', '--round', '1'], { expectExit: 1 })
    assert.equal(code, 1)
  } finally {
    cleanup(root)
  }
})

test('a lean run reports what it skipped, so it cannot be mistaken for --strict', () => {
  const { root, change } = repo()
  try {
    toFirstBatch(root, change)
    const closed = run(root, ['run', 'close', '--halt', 'stopped for the test'], { expectExit: 1 }).step
    assert.match(closed.summary, /LEAN SHIP: skipped review, handoff, conformance/)
  } finally {
    cleanup(root)
  }
})

// --- the run-step cap (design D9) -------------------------------------------

test('the run-step cap halts the program and names maxRunSteps', () => {
  const { root, change } = repo()
  try {
    toFirstBatch(root, change)
    // Push the counter to the cap rather than taking 200 real steps: the budget
    // is a manifest field, and what is under test is that exceeding it halts and
    // says which cap it was.
    const manifestPath = join(root, '.claude/ship/run.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.steps = LIMITS.maxRunSteps
    manifest.lastThen = null
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

    const halted = run(root, ['run', 'next']).step
    assert.equal(halted.action, 'halt')
    assert.match(halted.reason, /maxRunSteps/)
    assert.match(halted.reason, new RegExp(String(LIMITS.maxRunSteps)))
    assert.deepEqual(
      halted.then.argv.slice(0, 3),
      ['run', 'close', '--halt'],
      'a halt still closes — a run that stopped without a receipt explains nothing'
    )
  } finally {
    cleanup(root)
  }
})

// --- the sequence guard -----------------------------------------------------

test('a run subcommand called out of sequence is refused and names the expected call', () => {
  const { root, change } = repo()
  try {
    run(root, ['run', 'start', '--change', change])
    // The program asked for `run classified`; calling `run record-batch` would
    // record a batch against a run state that does not exist yet.
    let stderr = ''
    try {
      execFileSync(process.execPath, [BIN, 'run', 'record-batch', '--json'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      })
      assert.fail('an out-of-sequence run subcommand must be refused')
    } catch (err) {
      stderr = err.stderr || ''
      assert.equal(err.status, 1)
    }
    assert.match(stderr, /out of sequence/)
    assert.match(stderr, /run classified/, 'the refusal names the call the program expected')
  } finally {
    cleanup(root)
  }
})

// --- record-batch: what it ticks, folds and says out loud (design D5) -------

test('record-batch neither ticks nor counts a failed lane, and says a lane stopped early', () => {
  const { root, change } = repo('add-thing', {
    tasks: '# Tasks\n\n- [ ] 1.1 First\n- [ ] 1.2 Second\n'
  })
  try {
    const batch = toFirstBatch(root, change)
    const lane = batch.lanes[0].map(t => t.id)
    // The first task failed and the rest of the lane was never attempted — the
    // one outcome that is neither a success nor a charge against the budget.
    const results = [
      {
        tasks: [
          { id: lane[0], outcome: 'failed', error: 'could not build' },
          ...lane.slice(1).map(id => ({ id, outcome: 'not-attempted' }))
        ]
      }
    ]
    const recorded = run(root, [...batch.then.argv], { results }).step

    const tasks = readFileSync(join(root, `openspec/changes/${change}/tasks.md`), 'utf8')
    assert.doesNotMatch(tasks, /- \[x\]/, 'nothing in a failed lane may be ticked')
    if (lane.length > 1) {
      assert.ok(
        (recorded.banners || []).some(b => b.startsWith('LANE STOPPED EARLY:')),
        'an unattempted task is reported, never silently dropped'
      )
    }
  } finally {
    cleanup(root)
  }
})

test('a tick that cannot mark a checkbox is reported rather than swallowed', () => {
  const { root, change } = repo()
  try {
    const batch = toFirstBatch(root, change)
    // A read-only tasks.md: the work was done, the checkbox cannot be written.
    // Downstream, an unchecked box is indistinguishable from a failed task, so
    // the run has to say so.
    const tasksPath = join(root, `openspec/changes/${change}/tasks.md`)
    chmodSync(tasksPath, 0o444)
    const recorded = run(root, [...batch.then.argv], {
      results: batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id)))
    }).step
    chmodSync(tasksPath, 0o644)
    assert.ok(
      (recorded.banners || []).some(b => b.startsWith('TASK TICK FAILED:')),
      `a failed tick must be a banner; got ${JSON.stringify(recorded.banners)}`
    )
  } finally {
    cleanup(root)
  }
})

// --- close (design D10) -----------------------------------------------------

test('close exits 1 with a run-halt event on --halt, and 0 with run-complete otherwise', () => {
  for (const halt of [true, false]) {
    const { root, change } = repo()
    try {
      const batch = toFirstBatch(root, change)
      run(root, [...batch.then.argv], {
        results: batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id)))
      })
      const runId = JSON.parse(readFileSync(join(root, '.claude/ship/run.json'), 'utf8')).runId
      assert.ok(runId, 'the run manifest must carry the run id the trajectory is keyed by')

      const { step } = halt
        ? run(root, ['run', 'close', '--halt', 'the test halted it'], { expectExit: 1 })
        : run(root, ['run', 'close'])
      assert.equal(step.action, halt ? 'halt' : 'complete')
      assert.equal(step.exitCode, halt ? 1 : 0)

      const trajectory = readFileSync(
        join(root, '.claude', 'ship', 'runs', `${runId}.jsonl`),
        'utf8'
      )
      const types = trajectory
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line).type)
      assert.ok(types.includes('run-start'), 'a run records its start')
      assert.ok(types.includes('run-receipt'), 'and its receipt, on both paths')
      assert.ok(
        types.includes(halt ? 'run-halt' : 'run-complete'),
        `a ${halt ? 'halted' : 'completed'} run must write its terminal event`
      )
      if (halt) assert.match(step.summary, /SHIP HALTED — the test halted it/)
    } finally {
      cleanup(root)
    }
  }
})

test('close folds host-only banners into the summary so "no degradation" stays truthful', () => {
  const { root, change } = repo()
  try {
    toFirstBatch(root, change)
    file(root, '.claude/ship/host-banners.json', ['HOST NOTE: the transport degraded'])
    const { step } = run(root, [
      'run',
      'close',
      '--host-banners',
      '.claude/ship/host-banners.json'
    ])
    assert.match(step.summary, /HOST NOTE: the transport degraded/)
    assert.doesNotMatch(
      step.summary,
      /No degradation banners/,
      'a run with a host banner is not a clean run'
    )
  } finally {
    cleanup(root)
  }
})

test('a run with nothing to report says so rather than staying silent', () => {
  const { root, change } = repo()
  try {
    const batch = toFirstBatch(root, change)
    run(root, [...batch.then.argv], {
      results: batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id)))
    })
    // The skipped final verification is itself a banner, so this run has one.
    // What is asserted is the shape: the block is always printed, and silence is
    // never how a clean run and a degraded one look the same.
    const { step } = run(root, ['run', 'close'])
    assert.ok(
      /No degradation banners/.test(step.summary) || (step.banners || []).length > 0,
      'the summary must either name its degradations or state that there were none'
    )
  } finally {
    cleanup(root)
  }
})

// --- isolation --------------------------------------------------------------

test('an isolated batch declares worktree isolation and captures a merge base', () => {
  const { root, change } = repo()
  try {
    const batch = toFirstBatch(root, change, ['--isolate-waves'])
    assert.equal(batch.spawns[0].isolation, 'worktree')
    assert.match(batch.mergeBase, /^[0-9a-f]{7,40}$/, 'the shared tree\'s HEAD, read before the fork')
    assert.match(
      batch.spawns[0].prompt,
      /ISOLATION — you are running in your own git worktree/,
      'and the lane is told to report its own worktree path'
    )
  } finally {
    cleanup(root)
  }
})

test('an unisolated batch is byte-for-byte what it was before isolation existed', () => {
  const { root, change } = repo()
  try {
    const batch = toFirstBatch(root, change)
    assert.equal(batch.spawns[0].isolation, null)
    assert.equal(batch.mergeBase, null)
    assert.doesNotMatch(batch.spawns[0].prompt, /ISOLATION —/)
  } finally {
    cleanup(root)
  }
})

// --- isolation by host capability (spec: run-host-adapters) -----------------
//
// Who creates a lane's worktree is a capability the host declares, not a branch
// on its id. The Workflow runtime creates its own from `isolation: 'worktree'`;
// a runner host has no runtime to ask, so the step names the directory and the
// driver runs `git worktree add`. Getting this backwards on either host is a
// batch of lanes silently sharing one tree, which is exactly what isolation
// exists to prevent.

/** Start a run declaring a host's capabilities, the way `interlock-run` does. */
function startWithHost(root, change, host, capabilities, flags = []) {
  const started = run(root, [
    'run',
    'start',
    '--change',
    change,
    ...flags,
    '--host',
    host,
    '--host-capabilities',
    JSON.stringify(capabilities)
  ]).step
  assert.equal(started.action, 'classify')
  file(root, '.claude/ship/classified.json', CLASSIFIED)
  return run(root, [...started.then.argv]).step
}

function manifestOf(root) {
  return JSON.parse(readFileSync(join(root, '.claude/ship/run.json'), 'utf8'))
}

test('run start records the host id and its declared capabilities on the manifest', () => {
  const { root, change } = repo()
  try {
    startWithHost(root, change, 'codex', {
      schemaEnforced: true,
      modelSelect: 'map-only',
      worktree: 'driver',
      hooks: false,
      usage: true,
      billing: 'chatgpt-plan-or-api'
    })
    const manifest = manifestOf(root)
    assert.equal(manifest.host.id, 'codex')
    assert.equal(manifest.host.schemaEnforced, true)
    assert.equal(manifest.host.modelSelect, 'map-only')
    assert.equal(manifest.host.worktree, 'driver')
    assert.equal(manifest.host.hooks, false)
  } finally {
    cleanup(root)
  }
})

test('a driver-worktree host gets a path per lane instead of the runtime isolation flag', () => {
  const { root, change } = repo()
  try {
    const batch = startWithHost(root, change, 'qwen', { worktree: 'driver' }, ['--isolate-waves'])
    assert.match(batch.mergeBase, /^[0-9a-f]{7,40}$/, 'the base every lane is forked from')
    for (const spawn of batch.spawns) {
      assert.equal(spawn.isolation, null, 'there is no runtime to honour an isolation flag')
      assert.ok(spawn.worktree && spawn.worktree.path, `${spawn.label} was given no worktree path`)
      assert.match(spawn.worktree.path, /\.claude[/\\]ship[/\\]worktrees[/\\]/)
    }
    const paths = batch.spawns.map(s => s.worktree.path)
    assert.equal(new Set(paths).size, paths.length, 'two lanes must never share a directory')
  } finally {
    cleanup(root)
  }
})

test('a runtime-worktree host is unchanged, and neither host gets both', () => {
  const { root, change } = repo()
  try {
    const batch = startWithHost(root, change, 'workflow', { worktree: 'runtime' }, ['--isolate-waves'])
    assert.equal(batch.spawns[0].isolation, 'worktree')
    assert.equal(batch.spawns[0].worktree, null, 'the runtime picks the directory, so nothing predicts it')
  } finally {
    cleanup(root)
  }
})

test('a host that declared nothing is the Workflow host, so old manifests do not degrade', () => {
  const { root, change } = repo()
  try {
    const batch = toFirstBatch(root, change, ['--isolate-waves'])
    assert.equal(batch.spawns[0].isolation, 'worktree')
    assert.equal(manifestOf(root).host, null)
  } finally {
    cleanup(root)
  }
})

// --- usage (spec: run-host-adapters — usage is recorded or unknown) ---------

/** A lane result carrying what a host reported about its own token spend. */
function laneWithUsage(ids, outputTokens) {
  const result = laneOk(ids)
  return outputTokens === null ? result : { ...result, usage: { inputTokens: 5, outputTokens } }
}

test('close sums per-spawn usage into per-wave and per-run output tokens', () => {
  const { root, change } = repo()
  try {
    const batch = startWithHost(root, change, 'claude', { worktree: 'driver', usage: true })
    const after = run(root, [...batch.then.argv], {
      results: batch.spawns.map(s =>
        laneWithUsage(s.label.split('+').map(id => id.trim()), 100)
      )
    }).step
    // Walk to the close through whatever the run asked for next.
    let step = after
    while (step.then) {
      step = run(root, [...step.then.argv], { results: step.spawns.map(() => ({ ok: true })) }).step
      if (step.action === 'complete' || step.action === 'halt') break
    }
    const manifest = manifestOf(root)
    assert.ok(Array.isArray(manifest.usage) && manifest.usage.length, 'usage must be accumulated as it arrives')
    const waveEntry = manifest.usage.find(u => Number.isInteger(u.wave))
    assert.equal(waveEntry.outputTokens, 100 * batch.spawns.length)
  } finally {
    cleanup(root)
  }
})

test('one spawn without usage makes its wave and the run unknown, never smaller', async () => {
  const { summarizeUsage, recordUsage } = await import('../../lib/run.mjs')
  const manifest = { usage: [] }
  recordUsage(manifest, [{ usage: { outputTokens: 10 } }, { usage: { outputTokens: 20 } }], 1)
  recordUsage(manifest, [{ usage: { outputTokens: 5 } }, { ok: true }], 2)
  const summary = summarizeUsage(manifest)
  assert.deepEqual(summary.spend, [
    { wave: 1, outputTokens: 30 },
    { wave: 2, outputTokens: null }
  ])
  assert.equal(summary.outputTokens, null, 'and the run total is unknown, not 35')
})

test('a wave split across batches sums, and a run with no entries reports nothing', async () => {
  const { summarizeUsage, recordUsage } = await import('../../lib/run.mjs')
  const manifest = { usage: [] }
  recordUsage(manifest, [{ usage: { outputTokens: 10 } }], 1)
  recordUsage(manifest, [{ usage: { outputTokens: 7 } }], 1)
  recordUsage(manifest, [{ usage: { outputTokens: 3 } }], null)
  const summary = summarizeUsage(manifest)
  assert.deepEqual(summary.spend, [{ wave: 1, outputTokens: 17 }])
  assert.equal(summary.outputTokens, 20, 'the run total counts steps outside the waves too')
  assert.deepEqual(summarizeUsage({ usage: [] }), { spend: [], outputTokens: undefined })
})

// --- the receipt's host block (spec: run-host-adapters — name the path) -----

test('the receipt records the host id, its billing path and its hook availability', () => {
  const { root, change } = repo()
  try {
    startWithHost(root, change, 'codex', {
      worktree: 'driver',
      hooks: false,
      usage: true,
      billing: 'chatgpt-plan-or-api'
    })
    const closed = run(root, ['run', 'close', '--halt', 'stopped for the test'], { expectExit: 1 }).step
    assert.equal(closed.action, 'halt')
    const trajectory = readFileSync(
      join(root, '.claude/ship/runs', `${manifestOf(root).runId}.jsonl`),
      'utf8'
    )
    const receipt = trajectory
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .find(event => event.type === 'run-receipt')
    assert.equal(receipt.host.id, 'codex')
    assert.equal(receipt.host.billing, 'chatgpt-plan-or-api')
    assert.equal(receipt.host.hooks, false)
    assert.equal(receipt.host.usage, true)
  } finally {
    cleanup(root)
  }
})

test('a host that reports no usage says so once, rather than leaving empty figures', () => {
  const { root, change } = repo()
  try {
    startWithHost(root, change, 'qwen', { worktree: 'driver', usage: false })
    const closed = run(root, ['run', 'close', '--halt', 'stopped for the test'], { expectExit: 1 }).step
    assert.match(closed.summary, /TOKEN USAGE NOT REPORTED/)
    assert.match(closed.summary, /recorded as unknown/)
  } finally {
    cleanup(root)
  }
})

// --- the close's identity rows, archive reminder and push (design D5/D7/D9) --
//
// Everything below drives the REAL close through the CLI, because that is the
// only party that reads the environment, calls `detectUnarchived` and awaits
// the one outbound request this codebase makes. The relay is a loopback
// `http.createServer`: the suite never touches the network, and a test that
// stubbed `fetch` would prove only that the stub works — not that the child
// process the drivers actually spawn posts anything at all.

/**
 * Read back a `Title` header. Every headline contains an em dash, which is not
 * a ByteString, so it travels RFC 2047 encoded (`lib/notify.mjs`).
 */
function decodeHeader(value) {
  const match = /^=\?UTF-8\?B\?(.*)\?=$/.exec(value || '')
  return match ? Buffer.from(match[1], 'base64').toString('utf8') : value
}

/**
 * A ntfy stand-in on loopback, in a process of its OWN.
 *
 * It cannot live in this one. Every command here goes through `execFileSync`,
 * which blocks this process's event loop for the whole child run — an
 * in-process server would never accept the connection, and the close would
 * report a five-second timeout that says nothing about the code under test.
 * So the relay is a separate node process and it records what it received to
 * a file this process reads after the close has returned.
 */
async function relay(status = 200) {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-relay-'))
  const log = join(dir, 'requests.jsonl')
  const script = `
    const { createServer } = require('node:http')
    const { appendFileSync } = require('node:fs')
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        appendFileSync(${JSON.stringify(log)},
          JSON.stringify({ url: req.url, method: req.method, headers: req.headers, body }) + '\\n')
        res.writeHead(${status})
        res.end('x')
      })
    })
    server.listen(0, '127.0.0.1', () => process.stdout.write(server.address().port + '\\n'))
  `
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] })
  const port = await new Promise((resolve, reject) => {
    child.stdout.once('data', d => resolve(Number(String(d).trim())))
    child.once('error', reject)
  })
  return {
    url: `http://127.0.0.1:${port}`,
    requests: () =>
      existsSync(log)
        ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
        : [],
    close: () => {
      child.kill()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

/** A sibling change in the same tree, with every box ticked or none. */
function siblingChange(root, name, { complete = true } = {}) {
  file(root, `openspec/changes/${name}/proposal.md`, `# ${name}\n\nWhy: because.\n`)
  file(root, `openspec/changes/${name}/tasks.md`, `# Tasks\n\n- [${complete ? 'x' : ' '}] 1.1 Do it\n`)
}

/** Drive a repo all the way to a clean, leftover-free close and return it. */
function toCleanClose(root, change, closeArgs = [], opts = {}) {
  const verified = toTail(root, change, [])
  const commit = run(root, [...verified.then.argv]).step
  assert.equal(commit.action, 'commit')
  return run(root, [...commit.then.argv, ...closeArgs], {
    results: [{ ok: true, sha: 'abc1234' }],
    ...opts
  }).step
}

test('a clean close prints the run id, the project slug, the cwd and the archive reminder', () => {
  const { root, change } = repo()
  try {
    const closed = toCleanClose(root, change)
    const manifest = JSON.parse(readFileSync(join(root, '.claude/ship/run.json'), 'utf8'))
    assert.ok(manifest.runId, 'a run that adopted a plan has a run id')
    assert.match(closed.summary, new RegExp(`^  run: ${manifest.runId}$`, 'm'))
    assert.match(closed.summary, /^ {2}project: -/m, 'the slug is the absolute cwd with every non-alphanumeric hyphenated')
    assert.match(closed.summary, new RegExp(`^ {2}cwd: `, 'm'))
    assert.match(closed.summary, new RegExp(`^ARCHIVE PENDING — ${change}: after merge, run openspec archive ${change}$`, 'm'))
    assert.equal(closed.exitCode, 0, 'the reminder is unmissable, never a gate — every clean ship would halt forever')
    assert.doesNotMatch(closed.summary, /also unarchived/, 'no sibling change is complete in this fixture')
  } finally {
    cleanup(root)
  }
})

test('another completed change is counted beside the reminder, never conflated with it', () => {
  const { root, change } = repo()
  try {
    siblingChange(root, 'earlier-thing', { complete: true })
    siblingChange(root, 'unfinished-thing', { complete: false })
    const closed = toCleanClose(root, change)
    assert.match(closed.summary, new RegExp(`^ARCHIVE PENDING — ${change}`, 'm'))
    assert.match(closed.summary, /^ {2}also unarchived: 1 completed change\(s\) — run interlock drift$/m)
  } finally {
    cleanup(root)
  }
})

test('an unreadable sibling change skips the archive check and never fails the close', () => {
  const { root, change } = repo()
  try {
    // A directory where `tasks.md` should be: `inspectChange` reads it
    // unguarded, so this is the shape that turns the whole sweep into a throw.
    mkdirSync(join(root, 'openspec/changes/broken-thing/tasks.md'), { recursive: true })
    file(root, 'openspec/changes/broken-thing/proposal.md', '# broken\n')
    const closed = toCleanClose(root, change)
    assert.equal(closed.exitCode, 0, 'one unreadable sibling must not turn a clean close into exit 1')
    assert.doesNotMatch(closed.summary, /ARCHIVE PENDING/, 'a check that did not run must not claim a result')
    assert.match(closed.summary, /^ {2}archive check skipped: /m, 'and the degradation is spoken, never swallowed')
  } finally {
    cleanup(root)
  }
})

test('a halted close prints no archive reminder — the change is not complete', () => {
  const { root, change } = repo()
  try {
    toTail(root, change, [])
    const closed = run(root, ['run', 'close', '--halt', 'stopped for the test'], { expectExit: 1 }).step
    assert.match(closed.summary, /^SHIP HALTED — stopped for the test$/m)
    assert.doesNotMatch(closed.summary, /ARCHIVE PENDING/)
    assert.match(closed.summary, /^ {2}run: /m, 'the identity rows print on a halt too — that is when they matter most')
  } finally {
    cleanup(root)
  }
})

test('a close without --notify makes no request, even with a topic configured', async () => {
  const stub = await relay()
  const { root, change } = repo()
  try {
    const closed = toCleanClose(root, change, [], {
      env: { INTERLOCK_NTFY_TOPIC: 'secret-topic-abc', INTERLOCK_NTFY_URL: stub.url }
    })
    assert.equal(stub.requests().length, 0, 'the driver requests the push; a configured topic alone never does')
    assert.doesNotMatch(closed.summary, /push:/)
  } finally {
    cleanup(root)
    await stub.close()
  }
})

test('a close with --notify posts the summary\'s own first line, at high priority on a halt', async () => {
  const stub = await relay()
  const { root, change } = repo()
  try {
    toTail(root, change, [])
    const closed = run(root, ['run', 'close', '--halt', 'stopped for the test', '--notify'], {
      expectExit: 1,
      env: { INTERLOCK_NTFY_TOPIC: 'secret-topic-abc', INTERLOCK_NTFY_URL: stub.url }
    }).step

    const posted = stub.requests()
    assert.equal(posted.length, 1, 'exactly one push per close')
    const [request] = posted
    assert.equal(request.method, 'POST')
    assert.equal(request.url, '/secret-topic-abc')
    assert.equal(
      decodeHeader(request.headers.title),
      closed.summary.split('\n')[0],
      'the push and the print carry ONE headline, so they cannot disagree'
    )
    assert.equal(request.headers.priority, 'high', 'a halt is what the reader who walked away needs loudest')
    assert.match(request.body, new RegExp(`^change: ${change}$`, 'm'))
    assert.match(request.body, /^run: /m)
    assert.match(closed.summary, /^ {2}push: sent \(ntfy\)$/m)
  } finally {
    cleanup(root)
    await stub.close()
  }
})

test('a rejected push is a banner and a row, and never the exit code', async () => {
  const forbidden = await relay(403)
  const { root, change } = repo()
  try {
    const closed = toCleanClose(root, change, ['--notify'], {
      env: { INTERLOCK_NTFY_TOPIC: 'secret-topic-abc', INTERLOCK_NTFY_URL: forbidden.url }
    })
    assert.match(closed.summary, /^ {2}push: failed — HTTP 403$/m)
    assert.ok(closed.banners.includes('PUSH FAILED: HTTP 403'), 'the failure is a degradation banner, not only a row')
    assert.doesNotMatch(closed.summary, /No degradation banners/, 'a run with a banner must not claim it had none')
    assert.equal(closed.exitCode, 0, 'the run happened; a relay that would not take the news did not unhappen it')
  } finally {
    cleanup(root)
    await forbidden.close()
  }
})

test('the topic reaches the relay and nothing else — not the summary, not the trajectory', async () => {
  const forbidden = await relay(403)
  const { root, change } = repo()
  const topic = 'secret-topic-abc'
  try {
    const closed = toCleanClose(root, change, ['--notify'], {
      env: { INTERLOCK_NTFY_TOPIC: topic, INTERLOCK_NTFY_URL: forbidden.url }
    })
    assert.ok(!closed.summary.includes(topic), 'the topic is the relay\'s only auth — it is a capability, not a label')
    const manifest = JSON.parse(readFileSync(join(root, '.claude/ship/run.json'), 'utf8'))
    const trajectory = readFileSync(join(root, '.claude/ship/runs', `${manifest.runId}.jsonl`), 'utf8')
    assert.ok(!trajectory.includes(topic), 'nor may it reach the corpus the trajectory writes for later readers')
  } finally {
    cleanup(root)
    await forbidden.close()
  }
})
