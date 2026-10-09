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
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { join, dirname, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { EFFORT, LIMITS } from '../../lib/limits.mjs'
import { RED_SECTION_MARKER } from '../../lib/artifacts.mjs'
import { SKIP_VERIFY_RED } from '../../lib/waves.mjs'
import { assembleImplementerPrompt } from '../../lib/prompts/implementer.mjs'
import {
  BRIEFING_HEADER,
  LAST_STEP_PATH,
  RELAY_STEP_FIELDS,
  decideHostEnvironment,
  VERIFY_TIMINGS_PATH,
  briefingHash,
  laneOutcomes,
  relayStep,
  runClassified,
  runRecordBatch,
  runRemediated,
  runReviewed
} from '../../lib/run.mjs'
import { stagePath, writeStage } from '../../lib/ship-stage.mjs'
import {
  SUBAGENT_MODEL_DEFAULT_ONLY_MIN_VERSION,
  SUBAGENT_MODEL_FORCE_MIN_VERSION,
  observeClaudeEnv
} from '../../lib/host/claude-env.mjs'
import { nextStep } from '../../lib/waves.mjs'

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

/**
 * Like `run`, but keeps stderr — which is where a `ctx.warn` lands, and the
 * only place a degradation that is deliberately NOT an exit code can be read.
 */
function runCapturing(root, argv, { results, expectExit = 0 } = {}) {
  const full = [...argv]
  if (results !== undefined) {
    file(root, '.claude/ship/results.json', results)
    full.push('--results', '.claude/ship/results.json')
  }
  full.push('--json')
  const r = spawnSync(process.execPath, [BIN, ...full], { cwd: root, encoding: 'utf8' })
  assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.message}`)
  assert.equal(r.status, expectExit, `interlock ${full.join(' ')} exit code\nstderr: ${r.stderr}`)
  return {
    step: r.stdout.trim() ? JSON.parse(r.stdout) : null,
    code: r.status,
    stderr: r.stderr || ''
  }
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
    assert.equal(s.model, 'sonnet', 'a two-task cohesion lane below the opus floor dispatches on sonnet')
    assert.equal(s.effort, 'low', 'and at its hardest task\'s tier effort')
    assert.equal(s.schema.type, 'object', 'a spawn always names the schema its result must satisfy')
  } finally {
    cleanup(root)
  }
})

test('a single-task lane still requests its clamped model', () => {
  const { root, change } = repo('add-thing', {
    tasks: '# Tasks\n\n- [ ] 1.1 A\n- [ ] 1.2 B\n'
  })
  try {
    const started = run(root, ['run', 'start', '--change', change]).step
    file(root, '.claude/ship/classified.json', {
      tasks: [
        { id: '1.1', group: 1, description: 'A', tier: 4, model: 'sonnet', isTestTask: false, paths: ['src/a.ts'] },
        { id: '1.2', group: 1, description: 'B', tier: 1, model: 'haiku', isTestTask: false, paths: ['src/b.ts'] }
      ]
    })
    const batch = run(root, [...started.then.argv]).step
    const byLabel = Object.fromEntries(batch.spawns.map(s => [s.label, s.model]))
    assert.equal(byLabel['1.1'], 'sonnet')
    assert.equal(byLabel['1.2'], 'haiku')
  } finally {
    cleanup(root)
  }
})

test('a lane spawn is shown under a title but keyed, briefed and recorded by its label', () => {
  const { root, change } = repo('add-thing', {
    tasks: '# Tasks\n\n- [ ] 1.1 A\n- [ ] 1.2 B\n'
  })
  try {
    const started = run(root, ['run', 'start', '--change', change]).step
    file(root, '.claude/ship/classified.json', {
      tasks: [
        { id: '1.1', group: 1, description: 'Add the relaunch guard', tier: 4, model: 'sonnet', isTestTask: false, paths: ['src/a.ts'] },
        { id: '1.2', group: 1, description: 'B', tier: 1, model: 'haiku', isTestTask: false, paths: ['src/b.ts'] }
      ]
    })
    const batch = run(root, [...started.then.argv]).step
    const lane = batch.spawns.find(s => s.label === '1.1')
    assert.equal(lane.title, 'task 1.1 · Add the relaunch guard')
    assert.ok(lane.promptPath.endsWith('/1.1.md'), `the briefing file is named by the label, not the title: ${lane.promptPath}`)
    const header = readFileSync(join(root, lane.promptPath), 'utf8').split('\n')[0]
    assert.equal(header, BRIEFING_HEADER('1.1', lane.promptSha256))
  } finally {
    cleanup(root)
  }
})

test('a four-task lane with no result costs one failure and ticks nothing', () => {
  const ids = ['1.1', '1.2', '1.3', '1.4']
  const lane = ids.map(id => ({
    id,
    group: 1,
    description: id,
    tier: 2,
    model: 'sonnet',
    isTestTask: false,
    paths: [`src/${id}.ts`]
  }))
  const outcomes = laneOutcomes(lane, null)
  assert.equal(outcomes[0].outcome, 'failed')
  assert.equal(outcomes[0].error, 'agent returned no result')
  assert.deepEqual(
    outcomes.slice(1).map(o => o.outcome),
    ['not-attempted', 'not-attempted', 'not-attempted']
  )

  const { root, change } = repo('add-thing', {
    tasks: `# Tasks\n\n${ids.map(id => `- [ ] ${id} Do ${id}`).join('\n')}\n`
  })
  try {
    const started = run(root, ['run', 'start', '--change', change]).step
    file(root, '.claude/ship/classified.json', { tasks: lane })
    const batch = run(root, [...started.then.argv]).step
    assert.equal(batch.lanes[0].length, 4)
    run(root, [...batch.then.argv], { results: [null] })
    const state = JSON.parse(readFileSync(join(root, '.claude/ship/state.json'), 'utf8'))
    assert.equal(state.failures.length, 1)
    assert.equal(state.failures[0].error, 'agent returned no result')
    assert.deepEqual(state.completed, [])
    assert.equal(state.halt, null, 'one lost agent is under the halt threshold')
    const tasks = readFileSync(join(root, `openspec/changes/${change}/tasks.md`), 'utf8')
    assert.doesNotMatch(tasks, /- \[x\]/)
  } finally {
    cleanup(root)
  }
})

test('a lane result that omits an outcome still fails every task', () => {
  const lane = [
    { id: '1.1', tier: 2, model: 'sonnet' },
    { id: '1.2', tier: 2, model: 'sonnet' }
  ]
  const outcomes = laneOutcomes(lane, { tasks: [{ id: '1.1', outcome: 'ok' }] })
  assert.ok(outcomes.every(o => o.outcome === 'failed'))
  assert.equal(outcomes.length, 2)
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

const runs = root => join(root, '.claude', 'ship', 'runs')

// --- the trajectory is fatal, the outcome corpus is not (spec: ship-run) ----
//
// `.claude/ship/runs` is `fatal: true` in lib/doctor.mjs's STATE_DIRS, and
// `wave-state` in bin/interlock has always exited 1 when its append did not
// land. The live `interlock run` path used to warn and walk on — into the tick
// and into the commit — so a run nobody could reconstruct still ticked boxes
// and shipped. These tests are the difference, and the last of them is the
// other half of the rule: the learning corpus stays non-fatal on purpose.

test('a failed record-batch trajectory append halts before the tick and the commit', () => {
  const { root, change } = repo()
  try {
    const batch = toFirstBatch(root, change)
    const results = batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id)))

    // In-process, so the write failure is injected exactly where the run reads
    // it, and so `ctx.warn` can be observed rather than inferred.
    const warnings = []
    const ctx = {
      root,
      warn: message => warnings.push(message),
      deps: {
        headCommit: () => null,
        observedChangedPaths: () => ['README.md'],
        runMergeLanes: () => ({ status: 'clean', cleanupWarnings: [] }),
        logWaveMutation: (_r, { state }) => ({ step: nextStep(state), ok: false }),
        logAgentSpawns: () => {}
      }
    }
    const step = runRecordBatch(ctx, { results })

    assert.equal(step.action, 'halt', 'a warning is not a gate')
    assert.match(step.reason, /trajectory append failed/)
    assert.match(step.reason, /record-batch/, 'the reason names the site, so the gap can be found')
    assert.deepEqual(step.then.argv, ['run', 'close', '--halt', step.reason], 'a halt still closes')
    assert.ok(warnings.length, 'the failure is still spoken — the halt is the part that is new')

    const tasks = readFileSync(join(root, `openspec/changes/${change}/tasks.md`), 'utf8')
    assert.doesNotMatch(tasks, /- \[x\]/, 'no box is ticked on a run nobody can reconstruct')
  } finally {
    cleanup(root)
  }
})

// The implementer lanes are the majority of every trajectory's agent-spawn
// rows, and they are the one set `logSpawns` deliberately does NOT write — they
// are logged here, through the same writer `wave-state next` uses. `bin/
// interlock` has always exited 1 on this boolean; these two pin that the live
// run path now owes the trajectory the same fatality, at both sites that dispatch.

test('a failed implementer agent-spawn append halts instead of dispatching an unrecorded wave', () => {
  const { root, change } = repo()
  try {
    const started = run(root, ['run', 'start', '--change', change]).step
    assert.equal(started.action, 'classify')
    file(root, '.claude/ship/classified.json', CLASSIFIED)

    const warnings = []
    const ctx = {
      root,
      warn: message => warnings.push(message),
      deps: {
        headCommit: () => null,
        observedChangedPaths: () => [],
        runMergeLanes: () => ({ status: 'clean', cleanupWarnings: [] }),
        logWaveMutation: (_r, { state }) => ({ step: nextStep(state), ok: true }),
        logAgentSpawns: () => false
      }
    }
    const step = runClassified(ctx, { classifiedPath: '.claude/ship/classified.json' })

    assert.equal(step.action, 'halt', 'a wave whose agents nobody recorded must not dispatch')
    assert.match(step.reason, /trajectory append failed: agent-spawn/)
    assert.equal(step.spawns.length, 0, 'and it dispatches nothing')
    assert.ok(warnings.length, 'the failure is spoken as well as fatal')
  } finally {
    cleanup(root)
  }
})

test('a failed implementer agent-spawn append at record-batch halts before the tick', () => {
  const { root, change } = repo()
  try {
    const batch = toFirstBatch(root, change)
    const results = batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id)))

    const warnings = []
    const ctx = {
      root,
      warn: message => warnings.push(message),
      deps: {
        headCommit: () => null,
        observedChangedPaths: () => ['README.md'],
        runMergeLanes: () => ({ status: 'clean', cleanupWarnings: [] }),
        // The wave-action lands; only the lane spawns for the NEXT batch do not.
        logWaveMutation: (_r, { state }) => ({ step: nextStep(state), ok: true }),
        logAgentSpawns: () => false
      }
    }
    const step = runRecordBatch(ctx, { results })

    assert.equal(step.action, 'halt')
    assert.match(step.reason, /trajectory append failed: agent-spawn/)
    const tasks = readFileSync(join(root, `openspec/changes/${change}/tasks.md`), 'utf8')
    assert.doesNotMatch(tasks, /- \[x\]/, 'the tick is downstream of the halt, and must not have run')
    assert.ok(warnings.length)
  } finally {
    cleanup(root)
  }
})

test('a stubbed logAgentSpawns that reports nothing is not read as a failure', () => {
  // `=== false` and not a truthiness check: the dep is injected as `() => {}` in
  // half this file, and an undefined return is "said nothing", not "failed".
  const { root, change } = repo()
  try {
    const batch = toFirstBatch(root, change)
    const step = runRecordBatch(
      {
        root,
        warn: () => {},
        deps: {
          headCommit: () => null,
          observedChangedPaths: () => ['README.md'],
          runMergeLanes: () => ({ status: 'clean', cleanupWarnings: [] }),
          logWaveMutation: (_r, { state }) => ({ step: nextStep(state), ok: true }),
          logAgentSpawns: () => {}
        }
      },
      { results: batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id))) }
    )
    assert.notEqual(step.action, 'halt', 'a dep that returns nothing must not halt the run')
  } finally {
    cleanup(root)
  }
})

test('a failed close trajectory append is a banner and moves the exit code', () => {
  const { root, change } = repo()
  try {
    const batch = toFirstBatch(root, change)
    run(root, [...batch.then.argv], {
      results: batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id)))
    })

    // A regular file where the trajectory directory goes: every append fails,
    // whatever the uid running the suite — no chmod, so this holds under root.
    rmSync(runs(root), { recursive: true, force: true })
    writeFileSync(runs(root), 'not a directory\n')

    const closed = runCapturing(root, ['run', 'close'], {
      results: [{ ok: true, sha: 'abc1234' }],
      expectExit: 1
    })
    assert.ok(
      (closed.step.banners || []).some(b => b.startsWith('TRAJECTORY APPEND FAILED: run-receipt')),
      `the lost receipt is named; got ${JSON.stringify(closed.step.banners)}`
    )
    assert.ok(
      (closed.step.banners || []).some(b => b.startsWith('TRAJECTORY APPEND FAILED: run-complete')),
      'and so is the lost terminal event'
    )
  } finally {
    cleanup(root)
  }
})

test('an outcome-write failure is reported and never halts the close', () => {
  const { root, change } = repo()
  try {
    const batch = toFirstBatch(root, change)
    run(root, [...batch.then.argv], {
      results: batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id)))
    })
    const runId = JSON.parse(readFileSync(join(root, '.claude/ship/run.json'), 'utf8')).runId

    // A directory where the corpus line goes: the append throws, `appendOutcome`
    // reports `written: false`, and the run's exit code is unaffected.
    mkdirSync(join(root, '.claude', 'learning', 'outcomes.jsonl'), { recursive: true })

    const closed = runCapturing(root, ['run', 'close'], { results: [{ ok: true, sha: 'abc1234' }] })
    assert.equal(closed.code, 0, 'losing a corpus line must not fail the run that produced it')
    assert.equal(closed.step.action, 'complete')
    assert.match(closed.stderr, /outcome not recorded/, 'reported rather than silent')

    const types = readFileSync(join(runs(root), `${runId}.jsonl`), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line).type)
    assert.ok(types.includes('run-complete'), 'the fatal corpus is untouched by the non-fatal one')
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

test('a halt writes a resume card the summary names, and a clean close writes none', () => {
  for (const halt of [true, false]) {
    const { root, change } = repo()
    try {
      const batch = toFirstBatch(root, change)
      run(root, [...batch.then.argv], {
        results: batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id)))
      })
      const runId = JSON.parse(readFileSync(join(root, '.claude/ship/run.json'), 'utf8')).runId

      const { step } = halt
        ? run(root, ['run', 'close', '--halt', 'the test halted it'], { expectExit: 1 })
        : run(root, ['run', 'close'])

      const card = join(root, '.claude', 'handoff', `ship-${change}-${runId}.md`)
      if (!halt) {
        // A clean close has nothing to resume, and its summary ends in the
        // archive reminder instead.
        assert.equal(existsSync(card), false, 'a completed run must not leave a resume card')
        assert.doesNotMatch(step.summary, /resume card:/)
        continue
      }

      assert.equal(existsSync(card), true, 'a halted run must leave one')
      assert.match(step.summary, new RegExp(`resume card: \\.claude/handoff/ship-${change}-${runId}\\.md`))

      // The card is the handoff, so it has to carry what a reader with none of
      // this session's context needs: why it stopped, which run to read, and
      // that nothing consumes the file itself.
      const text = readFileSync(card, 'utf8')
      assert.match(text, /# Ship halted — add-thing/)
      assert.match(text, /the test halted it/)
      assert.match(text, new RegExp(`interlock run-log show ${runId}`))
      assert.match(text, /\/interlock:ship add-thing/)
      assert.match(text, /record, not a trigger/)
      assert.match(text, /Do not start another ship run unless the user asks/)
    } finally {
      cleanup(root)
    }
  }
})

test('a resume card that cannot be written is bannered and never moves the exit code', () => {
  // The run already halted; the card is a pointer to records that were written
  // either way. Losing it is the outcome-corpus class of this repository's
  // deliberately different corpus-loss semantics, not the trajectory's.
  const { root, change } = repo()
  try {
    const batch = toFirstBatch(root, change)
    run(root, [...batch.then.argv], {
      results: batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id)))
    })
    // A file where the directory has to go: the only way to make one write fail
    // without making the whole `.claude/` tree unwritable and taking the
    // trajectory down with it.
    writeFileSync(join(root, '.claude', 'handoff'), 'not a directory\n')

    const { step } = run(root, ['run', 'close', '--halt', 'the test halted it'], { expectExit: 1 })
    assert.equal(step.exitCode, 1, 'the halt exit code, not a second failure')
    assert.ok(
      step.banners.some(b => b.startsWith('RESUME CARD NOT WRITTEN: ')),
      `the close must say the card was lost: ${JSON.stringify(step.banners)}`
    )
    assert.match(step.summary, /RESUME CARD NOT WRITTEN: /)
    assert.doesNotMatch(step.summary, /resume card: \./)
  } finally {
    cleanup(root)
  }
})

// --- the host session identifier on run-start (D11) -------------------------

/** The `run-start` record of a run, read back off its trajectory. */
function runStartEvent(root) {
  const runId = JSON.parse(readFileSync(join(root, '.claude/ship/run.json'), 'utf8')).runId
  const lines = readFileSync(join(root, '.claude', 'ship', 'runs', `${runId}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
  return lines.find(r => r.type === 'run-start')
}

test('a run on the Workflow host records the session it ran under', () => {
  const { root, change } = repo()
  try {
    // Read from the CLI's own environment, never carried by a driver: the run
    // command is invoked with no session argument at all.
    run(root, ['run', 'start', '--change', change, '--host', 'workflow'], {
      env: { CLAUDE_CODE_SESSION_ID: 'sess-abc-123' }
    })
    file(root, '.claude/ship/classified.json', CLASSIFIED)
    run(root, ['run', 'classified', '--classified', '.claude/ship/classified.json'], {
      env: { CLAUDE_CODE_SESSION_ID: 'sess-abc-123' }
    })
    assert.equal(runStartEvent(root).sessionId, 'sess-abc-123')
  } finally {
    cleanup(root)
  }
})

test('an absent session identifier is recorded absent, never fabricated, and changes nothing', () => {
  for (const env of [{ CLAUDE_CODE_SESSION_ID: '' }, { CLAUDE_CODE_SESSION_ID: '   ' }]) {
    const { root, change } = repo()
    try {
      run(root, ['run', 'start', '--change', change, '--host', 'workflow'], { env })
      file(root, '.claude/ship/classified.json', CLASSIFIED)
      run(root, ['run', 'classified', '--classified', '.claude/ship/classified.json'], { env })

      const start = runStartEvent(root)
      const manifest = JSON.parse(readFileSync(join(root, '.claude/ship/run.json'), 'utf8'))
      assert.equal(start.sessionId, null, 'absent, not an empty string and not a placeholder')
      // No substitute is synthesised from anything else on the record.
      for (const substitute of [manifest.runId, String(process.pid), start.ts]) {
        assert.notEqual(start.sessionId, substitute)
      }

      // And the absence alone leaves the run reconstructable, at exit 0: a
      // closed run with no session identifier still checks clean.
      run(root, ['run', 'close'])
      const check = run(root, ['run-log', 'check', '--run-id', manifest.runId])
      assert.equal(check.code, 0)
    } finally {
      cleanup(root)
    }
  }
})

test('the runner records no session identifier: its agents are processes, not a session', () => {
  const { root, change } = repo()
  try {
    // A `claude` runner host launched from a shell that happens to be inside a
    // Claude Code session. Recording that session would join the trajectory to a
    // transcript that does not contain the run — the D11 hazard from the other
    // direction.
    run(root, ['run', 'start', '--change', change, '--host', 'claude'], {
      env: { CLAUDE_CODE_SESSION_ID: 'the-shell-that-launched-the-runner' }
    })
    file(root, '.claude/ship/classified.json', CLASSIFIED)
    run(root, ['run', 'classified', '--classified', '.claude/ship/classified.json'], {
      env: { CLAUDE_CODE_SESSION_ID: 'the-shell-that-launched-the-runner' }
    })
    assert.equal(runStartEvent(root).sessionId, null)
  } finally {
    cleanup(root)
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
    assert.match(batch.mergeBase, /^[0-9a-f]{7,40}$/, 'a snapshot of the shared tree, captured before the fork')
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
function startWithHost(root, change, host, capabilities, flags = [], classified = CLASSIFIED, { env } = {}) {
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
  ], { env }).step
  assert.equal(started.action, 'classify')
  file(root, '.claude/ship/classified.json', classified)
  return run(root, [...started.then.argv], { env }).step
}

function manifestOf(root) {
  return JSON.parse(readFileSync(join(root, '.claude/ship/run.json'), 'utf8'))
}

/** The `run-receipt` this run wrote, read back off its own trajectory. */
function receiptOf(root) {
  return readFileSync(join(root, '.claude/ship/runs', `${manifestOf(root).runId}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .find(event => event.type === 'run-receipt')
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
    { wave: 1, outputTokens: 30, cacheReadInputTokens: null, cacheCreationInputTokens: null },
    { wave: 2, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null }
  ])
  assert.equal(summary.outputTokens, null, 'and the run total is unknown, not 35')
  // These spawns reported no cache fields at all, so the cache figures are
  // unknown throughout — never the zero a host with no accounting would imply.
  assert.equal(summary.cacheReadInputTokens, null)
  assert.equal(summary.cacheCreationInputTokens, null)
})

test('cache figures fold per wave and per run under the same unknown-not-zero rule', async () => {
  const { summarizeUsage, recordUsage } = await import('../../lib/run.mjs')
  const cached = (out, read, creation) => ({
    usage: { outputTokens: out, cacheReadInputTokens: read, cacheCreationInputTokens: creation }
  })
  const manifest = { usage: [] }
  // Wave 1: both spawns measured, both tiers reported. Sums, tiers kept apart.
  recordUsage(
    manifest,
    [
      cached(10, 1000, { ephemeral_5m: 400, ephemeral_1h: 2 }),
      cached(20, 500, { ephemeral_5m: 100, ephemeral_1h: 3 })
    ],
    1
  )
  // Wave 2: one spawn's host reported cache fields and the other's did not.
  // The wave is unknown rather than the lower bound of what one spawn said.
  recordUsage(manifest, [cached(5, 900, { ephemeral_5m: 50 }), { usage: { outputTokens: 5 } }], 2)

  const summary = summarizeUsage(manifest)
  assert.deepEqual(summary.spend[0], {
    wave: 1,
    outputTokens: 30,
    cacheReadInputTokens: 1500,
    cacheCreationInputTokens: { ephemeral_5m: 500, ephemeral_1h: 5 }
  })
  assert.deepEqual(summary.spend[1], {
    wave: 2,
    outputTokens: 10,
    cacheReadInputTokens: null,
    cacheCreationInputTokens: { ephemeral_5m: null }
  })
  // The run total inherits the same contagion: one unmeasured spawn anywhere
  // makes the run's cache read unknown, not 2400.
  assert.equal(summary.cacheReadInputTokens, null)
  assert.equal(summary.cacheCreationInputTokens.ephemeral_5m, null)
  // A wave that read entirely from cache records the MEASURED zero for creation,
  // which is distinguishable from the absence above.
  const warm = { usage: [] }
  recordUsage(warm, [cached(4, 8000, { ephemeral_5m: 0, ephemeral_1h: 0 })], 1)
  assert.deepEqual(summarizeUsage(warm).cacheCreationInputTokens, { ephemeral_5m: 0, ephemeral_1h: 0 })
})

test('a wave split across batches sums, and a run with no entries reports nothing', async () => {
  const { summarizeUsage, recordUsage } = await import('../../lib/run.mjs')
  const manifest = { usage: [] }
  recordUsage(manifest, [{ usage: { outputTokens: 10 } }], 1)
  recordUsage(manifest, [{ usage: { outputTokens: 7 } }], 1)
  recordUsage(manifest, [{ usage: { outputTokens: 3 } }], null)
  const summary = summarizeUsage(manifest)
  assert.deepEqual(summary.spend, [
    { wave: 1, outputTokens: 17, cacheReadInputTokens: null, cacheCreationInputTokens: null }
  ])
  assert.equal(summary.outputTokens, 20, 'the run total counts steps outside the waves too')
  assert.deepEqual(summarizeUsage({ usage: [] }), {
    spend: [],
    outputTokens: undefined,
    cacheReadInputTokens: undefined,
    cacheCreationInputTokens: undefined
  })
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

test('a host without cache accounting is bannered, and one with it is not', () => {
  // Codex reports token usage and no cache decomposition — so the usage banner
  // must stay quiet while the cache banner fires. Nothing here branches on the
  // host's name: both rows come off the declared capability.
  const noCache = repo()
  try {
    startWithHost(noCache.root, noCache.change, 'codex', {
      worktree: 'driver',
      usage: true,
      cacheAccounting: false
    })
    const closed = run(noCache.root, ['run', 'close', '--halt', 'stopped for the test'], {
      expectExit: 1
    }).step
    assert.match(closed.summary, /CACHE ACCOUNTING NOT REPORTED/)
    assert.match(closed.summary, /rather than as a measured zero/)
    assert.doesNotMatch(closed.summary, /TOKEN USAGE NOT REPORTED/)

    const receipt = receiptOf(noCache.root)
    assert.equal(receipt.host.cacheAccounting, false, 'the declaration is recorded, so a reader can partition')
    assert.equal(receipt.cacheReadInputTokens, null)
    assert.equal(receipt.cacheCreationInputTokens, null)
  } finally {
    cleanup(noCache.root)
  }

  const withCache = repo()
  try {
    startWithHost(withCache.root, withCache.change, 'claude', {
      worktree: 'driver',
      usage: true,
      cacheAccounting: true
    })
    const closed = run(withCache.root, ['run', 'close', '--halt', 'stopped for the test'], {
      expectExit: 1
    }).step
    assert.doesNotMatch(closed.summary, /CACHE ACCOUNTING NOT REPORTED/)
    assert.equal(receiptOf(withCache.root).host.cacheAccounting, true)
  } finally {
    cleanup(withCache.root)
  }
})

test('a host reporting cache fields for some spawns and not others degrades, never fails', () => {
  const { root, change } = repo('add-thing', {
    tasks:
      '# Tasks\n\n- [ ] 1.1 Add the thing to src/a.ts\n- [ ] 1.2 Note it in src/b.ts\n\n' +
      '- [ ] 2.1 Note it in README.md\n'
  })
  try {
    const started = run(root, [
      'run',
      'start',
      '--change',
      change,
      '--host',
      'claude',
      '--host-capabilities',
      JSON.stringify({ worktree: 'driver', usage: true, cacheAccounting: true })
    ]).step
    // One wave, two dispatches. The first batch holds two tier-4 lanes, so chain
    // fusion will not absorb the folded singleton behind it. Both dispatches
    // land in the same wave: the first reports cache fields and the second
    // omits them, which is the mixed span this test exists for.
    file(root, '.claude/ship/classified.json', {
      tasks: [
        { id: '1.1', group: 1, description: 'a', tier: 4, model: 'sonnet', isTestTask: false, paths: ['src/a.ts'] },
        { id: '1.2', group: 1, description: 'b', tier: 4, model: 'sonnet', isTestTask: false, paths: ['src/b.ts'] },
        { id: '2.1', group: 2, description: 'c', tier: 2, model: 'sonnet', isTestTask: false, paths: ['README.md'] }
      ]
    })

    let step = run(root, [...started.then.argv]).step
    const usages = [
      { outputTokens: 10, cacheReadInputTokens: 900, cacheCreationInputTokens: { ephemeral_5m: 4 } },
      { outputTokens: 10 }
    ]
    let batches = 0
    while (step.then) {
      if (step.action === 'run-batch') {
        const usage = usages[Math.min(batches++, usages.length - 1)]
        step = run(root, [...step.then.argv], {
          results: step.spawns.map((_, i) => {
            const lane = step.lanes[i]
            // A single-task lane is read off the result's own ok and handoff.
            // A multi-task lane is read off per-task outcomes. Both have to
            // succeed here: this test is about a mixed cache span, and a
            // failed task would spend the halt budget instead.
            if (lane.length === 1) {
              const [task] = laneOk([lane[0].id]).tasks
              return { ok: true, id: task.id, filesChanged: task.filesChanged, handoff: task.handoff, usage }
            }
            return { ...laneOk(lane.map(t => t.id)), usage }
          })
        }).step
      } else {
        step = run(root, [...step.then.argv]).step
      }
      // A missing measurement is never a reason to stop.
      assert.notEqual(step.action, 'halt', 'a run must not halt over an unmeasured cache figure')
    }
    assert.equal(batches, 2, 'two dispatches, so the mixed case is real')
    assert.equal(step.exitCode, 0, 'and the exit code is untouched by the missing measurement')

    // The span that mixes a reported spawn with an unreported one records
    // ABSENT — never the 900 the one measured spawn reported, which would be a
    // lower bound wearing the shape of a total.
    const receipt = receiptOf(root)
    assert.ok(receipt.spend.length, 'the run recorded spend rows to be judged')
    for (const entry of receipt.spend) {
      assert.equal(entry.cacheReadInputTokens, null, `wave ${entry.wave} must be absent, not partial`)
      assert.deepEqual(entry.cacheCreationInputTokens, { ephemeral_5m: null })
    }
    assert.equal(receipt.cacheReadInputTokens, null)
    assert.equal(receipt.cacheCreationInputTokens.ephemeral_5m, null)
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
  // Three ways this can end, and only one of them used to settle the promise: a
  // spawn error, a child that exits before printing a port (a sandbox that
  // cannot bind loopback), and a child that neither prints nor exits. Without
  // the latter two the whole suite wedges instead of failing.
  const port = await new Promise((resolve, reject) => {
    let timer = null
    const settle = (fn, value) => {
      clearTimeout(timer)
      fn(value)
    }
    timer = setTimeout(() => settle(reject, new Error('relay did not report a port within 5s')), 5000)
    child.stdout.once('data', d => settle(resolve, Number(String(d).trim())))
    child.once('error', err => settle(reject, err))
    child.once('exit', code => settle(reject, new Error(`relay exited (${code}) before reporting a port`)))
  }).catch(err => {
    child.kill()
    rmSync(dir, { recursive: true, force: true })
    throw err
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

// --- the close's terminal housekeeping --------------------------------------
//
// Three fields that existed at one end and dangled at the other: the stage
// marker had `clearStage` and no caller, the receipt had a `planFingerprint`
// field and no producer, and both read exactly like a mechanism that ran and
// found nothing.

test('a clean close clears the stage marker it left on disk', () => {
  const { root, change } = repo()
  try {
    // The marker a run's own commit step publishes, with a pid that is alive —
    // so `readStage` would keep returning it as current for the rest of the
    // session, and the edit guards would keep denying on it.
    writeStage(change, 'commit', { root, pid: process.pid })
    assert.ok(existsSync(stagePath(change, root)), 'the marker must exist for the clear to mean anything')
    toCleanClose(root, change)
    assert.equal(
      existsSync(stagePath(change, root)),
      false,
      'a marker nobody clears keeps the PreToolUse guards armed after the run is over'
    )
  } finally {
    cleanup(root)
  }
})

test('a halted close clears the marker too — a halt is a terminal path like any other', () => {
  const { root, change } = repo()
  try {
    const batch = toFirstBatch(root, change)
    writeStage(change, 'remediation', { root, pid: process.pid })
    const closed = run(root, ['run', 'close', '--halt', 'stopped on purpose'], { expectExit: 1 }).step
    assert.equal(closed.action, 'halt')
    assert.ok(batch.spawns.length, 'the run got as far as dispatching work')
    assert.equal(
      existsSync(stagePath(change, root)),
      false,
      'a `remediation` marker left behind denies every test-file edit for the rest of the session'
    )
  } finally {
    cleanup(root)
  }
})

test('the receipt carries the plan fingerprint the run actually adopted', () => {
  const { root, change } = repo()
  try {
    const closed = toCleanClose(root, change)
    const stored = JSON.parse(readFileSync(join(root, '.claude/ship/plan-fingerprint.json'), 'utf8'))
    assert.equal(typeof stored.hash, 'string')

    const manifest = manifestOf(root)
    const events = readFileSync(join(root, '.claude/ship/runs', `${manifest.runId}.jsonl`), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l))
    const receipt = events.find(e => e.type === 'run-receipt')
    assert.equal(receipt.planFingerprint, stored.hash)
    assert.ok(closed.exitCode === 0)

    // And it reaches the reader: `fingerprint —` on every real run was the whole
    // symptom, because the plan-reuse story cannot be checked from a trajectory
    // that never recorded which plan ran.
    const shown = execFileSync(process.execPath, [BIN, 'run-log', 'show', manifest.runId], {
      cwd: root,
      encoding: 'utf8'
    })
    assert.ok(shown.includes(`fingerprint ${stored.hash}`), shown)
  } finally {
    cleanup(root)
  }
})

test('a fingerprint left by a different change is not attributed to this run', () => {
  const { root, change } = repo()
  try {
    const batch = toFirstBatch(root, change)
    // A stale file from another change's run, planted after this run wrote its
    // own. A wrong hash is worse than an absent one: the field exists so a
    // reader can CHECK the plan-reuse story.
    file(root, '.claude/ship/plan-fingerprint.json', { change: 'some-other-change', hash: 'deadbeef' })
    writeFileSync(join(root, 'README.md'), 'hello\nand the thing\n')
    const verified = run(root, [...batch.then.argv], {
      results: batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id)))
    }).step
    const commit = run(root, [...verified.then.argv]).step
    const manifest = manifestOf(root)
    run(root, [...commit.then.argv], { results: [{ ok: true, sha: 'abc1234' }] })
    const events = readFileSync(join(root, '.claude/ship/runs', `${manifest.runId}.jsonl`), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l))
    const receipt = events.filter(e => e.type === 'run-receipt').pop()
    assert.equal(receipt.planFingerprint, null, 'an unattributable hash is unobserved, never borrowed')
  } finally {
    cleanup(root)
  }
})

// --- the merge base survives the driver round trip (finding #5) -------------

test('an isolated batch persists its merge base on the manifest, not only on the step', () => {
  const { root, change } = repo()
  try {
    const batch = startWithHost(root, change, 'qwen', { worktree: 'driver' }, ['--isolate-waves'])
    assert.match(batch.mergeBase, /^[0-9a-f]{7,40}$/)
    assert.equal(
      manifestOf(root).mergeBase,
      batch.mergeBase,
      'the step goes to the driver and the driver returns only results — without this the fold ' +
        'has nowhere to read the base back from'
    )
  } finally {
    cleanup(root)
  }
})

test('the fold uses the base captured at dispatch, never the post-batch HEAD', () => {
  const { root, change } = repo()
  try {
    const batch = startWithHost(root, change, 'qwen', { worktree: 'driver' }, ['--isolate-waves'])
    const captured = batch.mergeBase
    assert.match(captured, /^[0-9a-f]{7,40}$/)
    file(root, '.claude/ship/results.json', batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id))))

    // In-process, so the fold's own input can be observed. `headCommit` returns
    // a sentinel: under isolation, anything that landed on the shared tree while
    // the batch ran makes the post-batch HEAD a DIFFERENT commit, and taking
    // every lane's diff against it reports the wrong write set.
    let foldedAgainst = null
    const results = JSON.parse(readFileSync(join(root, '.claude/ship/results.json'), 'utf8'))
    const ctx = {
      root,
      warn: () => {},
      deps: {
        headCommit: () => 'ffffffffffffffffffffffffffffffffffffffff',
        // Every lane forked from the captured base, as the runner forks them —
        // so the lane-base check passes and the fold's own input is what is read.
        worktreeHead: () => captured,
        observedChangedPaths: () => ['README.md'],
        runMergeLanes: (_root, _candidates, base) => {
          foldedAgainst = base
          return { status: 'clean', cleanupWarnings: [] }
        },
        logWaveMutation: (_r, { state }) => ({ step: nextStep(state), ok: true }),
        logAgentSpawns: () => {}
      }
    }
    runRecordBatch(ctx, { results })
    assert.equal(foldedAgainst, captured, 'the fold read the post-batch HEAD instead of the captured base')
    assert.equal(manifestOf(root).mergeBase, null, 'a spent base must not carry into the next batch')
  } finally {
    cleanup(root)
  }
})

// --- the isolated base is a snapshot of the shared tree (spec: lanes, waves) --
//
// HEAD does not move during a run — the ship commit is its last step — so a
// lane forked from HEAD after an earlier batch folded edits a copy that lacks
// the fold, and the whole-file fold then overwrites the earlier edit with exit
// 0. These fixtures play the runner exactly as `createWorktrees` does (`git
// worktree add --detach --force <spawn.worktree.path> <step.mergeBase>`)
// through the real binary and real git, because the defect lived between them.

function git(root, args, opts = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts
  }).trim()
}

/** A tier-4 task on one path: tier 4 is above the cohesion ceiling, so each is its own lane. */
function isolatedTask(id, group, path) {
  return { id, group, description: `Edit ${path}`, tier: 4, model: 'sonnet', isTestTask: false, paths: [path] }
}

const A_BODY = 'export const a = 1\nexport const two = 2\n'
const A_APPENDED = A_BODY + 'export const appended = true\n'

// Batch 0 holds lanes 1.1 and 1.2; 2.1 is a one-task group, so it folds into the
// same wave as batch 1 — the later batch that edits the file batch 0 changed.
// Two lanes in batch 0 is what keeps chain fusion from joining 1.1 and 2.1.
const DEFERRED_BATCH = {
  tasks: [isolatedTask('1.1', 1, 'lib/a.mjs'), isolatedTask('1.2', 1, 'lib/b.mjs'), isolatedTask('2.1', 2, 'lib/a.mjs')]
}

// Two sections of two tasks each: two waves, with an inter-wave checkpoint between.
const TWO_ISOLATED_WAVES = {
  tasks: [
    isolatedTask('1.1', 1, 'lib/new.mjs'),
    isolatedTask('1.2', 1, 'lib/b.mjs'),
    isolatedTask('2.1', 2, 'lib/c.mjs'),
    isolatedTask('2.2', 2, 'lib/d.mjs')
  ]
}

// One batch of two lanes.
const TWO_ISOLATED_LANES = { tasks: [isolatedTask('1.1', 1, 'lib/a.mjs'), isolatedTask('1.2', 1, 'lib/b.mjs')] }

/** A repo whose tasks.md lists `classified`, with `lib/` committed. */
function isolatedRepo(classified) {
  const { root, change } = repo('add-thing', {
    tasks: `# Tasks\n\n${classified.tasks.map(t => `- [ ] ${t.id} ${t.description}`).join('\n')}\n`
  })
  file(root, 'lib/a.mjs', A_BODY)
  for (const name of ['b', 'c', 'd']) file(root, `lib/${name}.mjs`, `export const ${name} = 1\n`)
  git(root, ['add', '-A'])
  git(root, ['commit', '-qm', 'lib'])
  return { root, change, head: git(root, ['rev-parse', 'HEAD']) }
}

/** Play the runner: fork every lane the step names, from the step's base unless told otherwise. */
function forkLanes(root, step, bases = {}) {
  for (const s of step.spawns) {
    git(root, ['worktree', 'add', '--detach', '--force', s.worktree.path, bases[s.label] ?? step.mergeBase])
  }
}

/** A single-task lane's result (`SINGLE_TASK_SCHEMA`), reporting `files` as its writes. */
function taskWrote(id, files, extra = {}) {
  return {
    ...extra,
    id,
    ok: true,
    filesChanged: files,
    handoff: {
      schema: 'interlock.wave-handoff/1',
      taskId: id,
      status: 'ok',
      summary: 'done',
      evidence: files.length ? files.map(f => `${f}:1`) : ['nothing to change'],
      next: 'nothing',
      blocker: null
    }
  }
}

const read = (root, path) => readFileSync(join(root, path), 'utf8')

/** Start an isolated qwen run and stop before `run classified`, so the capture can be observed. */
function startUnclassified(root, change, classified, env) {
  const started = run(
    root,
    ['run', 'start', '--change', change, '--isolate-waves', '--host', 'qwen', '--host-capabilities', '{"worktree":"driver"}'],
    { env }
  ).step
  assert.equal(started.action, 'classify')
  file(root, '.claude/ship/classified.json', classified)
  return started
}

test('a dirty tree forks its lanes from a snapshot that holds the edit and the untracked file', () => {
  const { root, change, head } = isolatedRepo(TWO_ISOLATED_LANES)
  try {
    file(root, 'lib/a.mjs', 'export const a = "uncommitted"\n')
    file(root, 'lib/new.mjs', 'export const fresh = true\n')
    const batch = startWithHost(root, change, 'qwen', { worktree: 'driver' }, ['--isolate-waves'], TWO_ISOLATED_LANES)
    assert.equal(batch.action, 'run-batch')
    assert.notEqual(batch.mergeBase, head, 'HEAD lacks both changes, so it cannot be the base')
    const listed = git(root, ['ls-tree', '-r', '--name-only', batch.mergeBase]).split('\n')
    assert.ok(listed.includes('lib/new.mjs'), 'the untracked, non-ignored file is in the snapshot')
    assert.equal(git(root, ['show', `${batch.mergeBase}:lib/a.mjs`]), 'export const a = "uncommitted"')
    forkLanes(root, batch)
    for (const s of batch.spawns) {
      assert.equal(read(root, `${s.worktree.path}/lib/a.mjs`), 'export const a = "uncommitted"\n')
      assert.ok(existsSync(join(root, s.worktree.path, 'lib/new.mjs')), `${s.label} sees the untracked file`)
    }
  } finally {
    cleanup(root)
  }
})

test('a clean tree resolves the base to HEAD and writes no object', () => {
  const { root, change, head } = isolatedRepo(TWO_ISOLATED_LANES)
  try {
    const started = startUnclassified(root, change, TWO_ISOLATED_LANES)
    const objects = git(root, ['count-objects', '-v'])
    const batch = run(root, [...started.then.argv]).step
    assert.equal(batch.mergeBase, head, 'nothing to snapshot — the run state under .claude/ship is excluded')
    assert.equal(git(root, ['count-objects', '-v']), objects, 'a clean capture creates no commit')
  } finally {
    cleanup(root)
  }
})

test('capturing the snapshot leaves HEAD, refs, the index and the working tree as it found them', () => {
  const { root, change, head } = isolatedRepo(TWO_ISOLATED_LANES)
  try {
    git(root, ['tag', 'v0'])
    git(root, ['branch', 'side'])
    file(root, 'lib/a.mjs', 'export const a = "unstaged"\n')
    file(root, 'lib/b.mjs', 'export const b = "staged"\n')
    git(root, ['add', 'lib/b.mjs'])
    file(root, 'lib/new.mjs', 'export const fresh = true\n')
    const started = startUnclassified(root, change, TWO_ISOLATED_LANES)

    const readings = () => ({
      head: git(root, ['rev-parse', 'HEAD']),
      refs: git(root, ['for-each-ref']),
      reflog: git(root, ['reflog']),
      staged: git(root, ['diff', '--cached']),
      status: git(root, ['status', '--porcelain'])
    })
    const before = readings()
    const batch = run(root, [...started.then.argv]).step
    assert.deepEqual(readings(), before, 'the capture moved a ref, the index or the working tree')

    assert.notEqual(batch.mergeBase, head, 'a dirty tree is snapshotted, not read as HEAD')
    assert.equal(git(root, ['show', `${batch.mergeBase}:lib/b.mjs`]), 'export const b = "staged"')
    assert.equal(git(root, ['for-each-ref', '--points-at', batch.mergeBase]), '', 'no ref names the snapshot')
    forkLanes(root, batch)
    for (const s of batch.spawns) {
      assert.equal(
        git(join(root, s.worktree.path), ['rev-parse', 'HEAD']),
        batch.mergeBase,
        `the snapshot is reachable from ${s.label}'s worktree HEAD`
      )
    }
  } finally {
    cleanup(root)
  }
})

test('a repository with no git identity still snapshots, and none is written to its config', () => {
  const { root, change, head } = isolatedRepo(TWO_ISOLATED_LANES)
  try {
    git(root, ['config', '--unset', 'user.name'])
    git(root, ['config', '--unset', 'user.email'])
    // Refuse git's own hostname guess, so the capture cannot pass on one.
    git(root, ['config', 'user.useConfigOnly', 'true'])
    file(root, 'lib/new.mjs', 'export const fresh = true\n')
    const env = {
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: undefined,
      GIT_AUTHOR_EMAIL: undefined,
      GIT_COMMITTER_NAME: undefined,
      GIT_COMMITTER_EMAIL: undefined,
      EMAIL: undefined
    }
    const started = startUnclassified(root, change, TWO_ISOLATED_LANES, env)
    const batch = run(root, [...started.then.argv], { env }).step
    assert.equal(batch.action, 'run-batch', `the capture halted: ${batch.reason}`)
    assert.notEqual(batch.mergeBase, head)
    const config = readFileSync(join(root, '.git', 'config'), 'utf8')
    assert.doesNotMatch(config, /^\s*(name|email)\s*=/m, 'an identity was written to the repository config')
  } finally {
    cleanup(root)
  }
})

test('the run state and a linked worktree inside the root stay out of the snapshot', () => {
  const { root, change, head } = isolatedRepo(TWO_ISOLATED_LANES)
  try {
    // A preserved lane from a failed batch, and a worktree the Workflow runtime
    // put under .claude/worktrees/ — neither directory is ignored here.
    git(root, ['worktree', 'add', '--detach', '.claude/ship/worktrees/wave-0/old', 'HEAD'])
    git(root, ['worktree', 'add', '--detach', '.claude/worktrees/planted', 'HEAD'])
    file(root, 'lib/new.mjs', 'export const fresh = true\n')
    const batch = startWithHost(root, change, 'qwen', { worktree: 'driver' }, ['--isolate-waves'], TWO_ISOLATED_LANES)
    assert.notEqual(batch.mergeBase, head, 'the untracked file makes a snapshot')
    const dirs = git(root, ['ls-tree', '-r', '-d', '--name-only', batch.mergeBase]).split('\n')
    assert.ok(!dirs.some(d => d.startsWith('.claude/ship')), `run state leaked into the snapshot: ${dirs}`)
    assert.ok(!dirs.some(d => d.startsWith('.claude/worktrees')), `a linked worktree leaked: ${dirs}`)
    assert.doesNotMatch(
      git(root, ['ls-tree', '-r', batch.mergeBase]),
      /^160000 /m,
      'an embedded-repository entry would check out as an empty directory the fold reads as a deletion'
    )
  } finally {
    cleanup(root)
  }
})

/** Drive the two-batch fixture through batch 0's fold and return batch 1's step. */
function foldBatchZero(root, change) {
  const batch0 = startWithHost(root, change, 'qwen', { worktree: 'driver' }, ['--isolate-waves'], DEFERRED_BATCH)
  assert.deepEqual(batch0.lanes, [[{ id: '1.1' }], [{ id: '1.2' }]], 'batch 0 holds two lanes')
  forkLanes(root, batch0)
  const lane = label => batch0.spawns.find(s => s.label === label).worktree.path
  file(root, `${lane('1.1')}/lib/a.mjs`, A_APPENDED)
  file(root, `${lane('1.2')}/lib/b.mjs`, 'export const b = 2\n')
  const batch1 = run(root, [...batch0.then.argv], {
    results: [taskWrote('1.1', ['lib/a.mjs']), taskWrote('1.2', ['lib/b.mjs'])]
  }).step
  assert.equal(batch1.action, 'run-batch', `batch 0 did not fold: ${batch1.reason}`)
  assert.deepEqual(batch1.lanes, [[{ id: '2.1' }]], 'batch 1 is the deferred lane on lib/a.mjs')
  assert.equal(read(root, 'lib/a.mjs'), A_APPENDED, "batch 0's edit is in the shared tree")
  return batch1
}

test('a deferred batch forks from the folded tree, so both edits survive', () => {
  const { root, change, head } = isolatedRepo(DEFERRED_BATCH)
  try {
    const batch1 = foldBatchZero(root, change)
    assert.notEqual(batch1.mergeBase, head, 'HEAD has not moved, and it lacks the fold')
    forkLanes(root, batch1)
    const wt = batch1.spawns[0].worktree.path
    assert.equal(read(root, `${wt}/lib/a.mjs`), A_APPENDED, 'the lane starts from the folded file')
    file(root, `${wt}/lib/a.mjs`, read(root, `${wt}/lib/a.mjs`).replace('export const a = 1', 'export const a = 2'))
    const next = run(root, [...batch1.then.argv], { results: [taskWrote('2.1', ['lib/a.mjs'])] }).step
    assert.notEqual(next.action, 'halt', next.reason)
    assert.equal(
      read(root, 'lib/a.mjs'),
      'export const a = 2\nexport const two = 2\nexport const appended = true\n',
      "the whole-file fold carries batch 1's edit and batch 0's appended line"
    )
  } finally {
    cleanup(root)
  }
})

test('a wave-2 lane finds the file a wave-1 lane created', () => {
  const { root, change } = isolatedRepo(TWO_ISOLATED_WAVES)
  try {
    const wave1 = startWithHost(root, change, 'qwen', { worktree: 'driver' }, ['--isolate-waves'], TWO_ISOLATED_WAVES)
    forkLanes(root, wave1)
    const lane = label => wave1.spawns.find(s => s.label === label).worktree.path
    file(root, `${lane('1.1')}/lib/new.mjs`, 'export const created = 1\n')
    file(root, `${lane('1.2')}/lib/b.mjs`, 'export const b = 2\n')
    let step = run(root, [...wave1.then.argv], {
      results: [taskWrote('1.1', ['lib/new.mjs']), taskWrote('1.2', ['lib/b.mjs'])]
    }).step
    // The inter-wave checkpoint: no test profile here, so it is skipped and judged empty.
    for (let guard = 0; step.action !== 'run-batch' && guard < 3; guard++) {
      assert.notEqual(step.action, 'halt', step.reason)
      step = run(root, [...step.then.argv], { results: [] }).step
    }
    assert.equal(step.action, 'run-batch')
    assert.equal(step.wave, wave1.wave + 1, 'this is the second wave')
    const listed = git(root, ['ls-tree', '-r', '--name-only', step.mergeBase]).split('\n')
    assert.ok(listed.includes('lib/new.mjs'), "the wave-2 base lists wave 1's new file")
    forkLanes(root, step)
    for (const s of step.spawns) {
      assert.equal(read(root, `${s.worktree.path}/lib/new.mjs`), 'export const created = 1\n')
    }
  } finally {
    cleanup(root)
  }
})

test('a deferred lane forked from HEAD halts with LANE BASE MISMATCH and folds nothing', () => {
  const { root, change, head } = isolatedRepo(DEFERRED_BATCH)
  try {
    const batch1 = foldBatchZero(root, change)
    forkLanes(root, batch1, { '2.1': head })
    const wt = batch1.spawns[0].worktree.path
    file(root, `${wt}/lib/a.mjs`, read(root, `${wt}/lib/a.mjs`).replace('export const a = 1', 'export const a = 2'))
    const step = run(root, [...batch1.then.argv], { results: [taskWrote('2.1', ['lib/a.mjs'])] }).step
    assert.equal(step.action, 'halt')
    assert.ok(
      step.reason.includes(`LANE BASE MISMATCH: 2.1 forked from ${head}, expected ${batch1.mergeBase}`),
      step.reason
    )
    assert.equal(read(root, 'lib/a.mjs'), A_APPENDED, "batch 0's edit survives, untouched by batch 1")
    assert.ok(existsSync(join(root, wt)), 'the lane worktree stays on disk')
    assert.ok(step.reason.includes(wt), 'and is named in the halt')
  } finally {
    cleanup(root)
  }
})

test('one lane off the wrong base halts the whole batch, and every worktree is named', () => {
  const { root, change, head } = isolatedRepo(TWO_ISOLATED_LANES)
  try {
    file(root, 'lib/pending.mjs', 'export const pending = true\n')
    const batch = startWithHost(root, change, 'qwen', { worktree: 'driver' }, ['--isolate-waves'], TWO_ISOLATED_LANES)
    forkLanes(root, batch, { '1.2': head })
    const lane = label => batch.spawns.find(s => s.label === label).worktree.path
    file(root, `${lane('1.1')}/lib/a.mjs`, 'export const a = "lane"\n')
    file(root, `${lane('1.2')}/lib/b.mjs`, 'export const b = "lane"\n')
    const step = run(root, [...batch.then.argv], {
      results: [taskWrote('1.1', ['lib/a.mjs']), taskWrote('1.2', ['lib/b.mjs'])]
    }).step
    assert.equal(step.action, 'halt')
    assert.match(step.reason, new RegExp(`LANE BASE MISMATCH: 1\\.2 forked from ${head}, expected ${batch.mergeBase}`))
    assert.doesNotMatch(step.reason, /1\.1 forked from/, 'the lane on the right base is not accused')
    assert.equal(read(root, 'lib/a.mjs'), A_BODY, 'the lane on the right base is not folded either')
    assert.equal(read(root, 'lib/b.mjs'), 'export const b = 1\n')
    for (const label of ['1.1', '1.2']) {
      assert.ok(existsSync(join(root, lane(label))), `${label}'s worktree stays on disk`)
      assert.ok(step.reason.includes(lane(label)), `${label}'s worktree is named in the halt`)
    }
  } finally {
    cleanup(root)
  }
})

test('an empty-write lane whose worktree is gone is not a base mismatch', () => {
  const { root, change } = isolatedRepo(TWO_ISOLATED_LANES)
  try {
    file(root, 'lib/pending.mjs', 'export const pending = true\n')
    const batch = startWithHost(root, change, 'qwen', { worktree: 'driver' }, ['--isolate-waves'], TWO_ISOLATED_LANES)
    const only11 = { ...batch, spawns: batch.spawns.filter(s => s.label === '1.1') }
    forkLanes(root, only11)
    file(root, `${only11.spawns[0].worktree.path}/lib/a.mjs`, 'export const a = "lane"\n')
    const step = run(root, [...batch.then.argv], {
      results: [taskWrote('1.1', ['lib/a.mjs']), taskWrote('1.2', [])]
    }).step
    assert.notEqual(step.action, 'halt', step.reason)
    assert.equal(read(root, 'lib/a.mjs'), 'export const a = "lane"\n', 'the other lane folds normally')
  } finally {
    cleanup(root)
  }
})

test('--isolate-waves on a runtime-worktree host is bannered, and its mismatch names worktree.baseRef', () => {
  const { root, change, head } = isolatedRepo(TWO_ISOLATED_LANES)
  try {
    file(root, 'lib/pending.mjs', 'export const pending = true\n')
    const batch = startWithHost(root, change, 'workflow', { worktree: 'runtime' }, ['--isolate-waves'], TWO_ISOLATED_LANES)
    assert.ok(
      manifestOf(root).banners.some(b => /^ISOLATION BASE NOT CONTROLLED \(workflow\)/.test(b)),
      `no isolation-base banner: ${JSON.stringify(manifestOf(root).banners)}`
    )
    const base = manifestOf(root).mergeBase
    assert.notEqual(base, head)
    // The runtime forks from worktree.baseRef, which here resolved to HEAD.
    const results = batch.spawns.map(s => {
      const wt = join(root, '.claude', 'worktrees', `agent-${s.label}`)
      git(root, ['worktree', 'add', '--detach', wt, head])
      const path = s.label === '1.1' ? 'lib/a.mjs' : 'lib/b.mjs'
      file(wt, path, 'export const lane = true\n')
      return taskWrote(s.label, [path], { worktreePath: wt })
    })
    const step = run(root, [...batch.then.argv], { results }).step
    assert.equal(step.action, 'halt')
    assert.match(step.reason, new RegExp(`LANE BASE MISMATCH: 1\\.1 forked from ${head}, expected ${base}`))
    assert.match(step.reason, /worktree\.baseRef/, 'the halt names the setting that chose the base')
    assert.match(step.reason, /follow-up change/)
  } finally {
    cleanup(root)
  }
})

test('a driver-host batch without --isolate-waves carries no base, no worktree and no isolation banner', () => {
  const { root, change } = isolatedRepo(TWO_ISOLATED_LANES)
  try {
    file(root, 'lib/pending.mjs', 'export const pending = true\n')
    const batch = startWithHost(root, change, 'qwen', { worktree: 'driver' }, [], TWO_ISOLATED_LANES)
    assert.equal(batch.mergeBase, null)
    for (const s of batch.spawns) {
      assert.equal(s.worktree, null)
      assert.doesNotMatch(s.prompt, /ISOLATION —/)
    }
    assert.ok(!manifestOf(root).banners.some(b => /ISOLATION BASE/.test(b)))
  } finally {
    cleanup(root)
  }
})

// --- the inter-wave checkpoint's two inert halves (findings #6, #9) ---------
//
// A retry was briefed byte-identically to the first attempt, and the published
// inter-wave verify budget compared `0 >= budget` on every run. Both are driven
// here through a real multi-group repo, because both live in the round trip
// between `run record-batch`, the step, and `run judge`.

// Two tasks per group, because `foldSingletonWaves` folds a one-task wave into
// the previous one — three singleton groups would plan as a single wave with no
// inter-wave boundary at all. Source paths, so nothing is docs-skipped.
const THREE_GROUPS = {
  tasks: [1, 2, 3].flatMap(g =>
    [1, 2].map(n => ({
      id: `${g}.${n}`,
      group: g,
      description: `Edit src/mod${g}${n}.ts`,
      tier: 2,
      model: 'sonnet',
      isTestTask: false,
      paths: [`src/mod${g}${n}.ts`]
    }))
  )
}

const srcOf = id => `src/mod${id.replace('.', '')}.ts`

/** A repo whose profile names a unit command, so verification actually plans. */
function verifiableRepo(classified = THREE_GROUPS) {
  const ids = classified.tasks.map(t => t.id)
  const { root, change } = repo('add-thing', {
    tasks: `# Tasks\n\n${ids.map(id => `- [ ] ${id} Edit ${srcOf(id)}`).join('\n')}\n`
  })
  file(root, '.claude/testing/profile.json', {
    version: 1,
    unit: { command: 'node --test', cwd: '.', single_file: 'node --test <path>' }
  })
  const started = run(root, ['run', 'start', '--change', change, '--mode', 'waves']).step
  file(root, '.claude/ship/classified.json', classified)
  return { root, change, batch: run(root, [...started.then.argv]).step }
}

/** Report every lane in `batch` as ok, having really touched a source file. */
function completeBatch(root, batch) {
  assert.equal(batch.action, 'run-batch', 'completeBatch was handed something that dispatches no lanes')
  for (const task of batch.lanes.flat()) {
    file(root, srcOf(task.id), `export const v = '${task.id}'\n`)
  }
  return run(root, [...batch.then.argv], {
    results: batch.spawns.map((_, i) => ({
      tasks: batch.lanes[i].map(t => ({
        id: t.id,
        outcome: 'ok',
        filesChanged: [srcOf(t.id)],
        handoff: {
          schema: 'interlock.wave-handoff/1',
          taskId: t.id,
          status: 'ok',
          summary: 'done',
          evidence: [`${srcOf(t.id)}:1`],
          next: 'nothing',
          blocker: null
        }
      }))
    }))
  }).step
}

test('a red inter-wave check briefs its retry with the attempt number and what failed', () => {
  const { root, batch } = verifiableRepo()
  try {
    const verify = completeBatch(root, batch)
    assert.equal(verify.action, 'verify')
    assert.equal(verify.context, 'inter-wave')
    assert.equal(verify.skipped, false, 'the profile names a unit command, so there is something to run')
    assert.ok(!/fix attempt/.test(verify.spawns[0].prompt), 'the first attempt is not a retry')

    const retry = run(root, [...verify.then.argv], {
      results: [{ results: [{ kind: 'unit', exitCode: 1, total: 3, passed: 2, failed: 1, failures: ['boom'] }] }]
    }).step

    assert.equal(retry.action, 'verify')
    assert.equal(retry.fixAttempt, 1, 'a red check buys a targeted fix attempt')
    const prompt = retry.spawns[0].prompt
    assert.match(prompt, /fix attempt 1 of/, 'the retry must know it is one')
    // The halt message the judge produced, quoted back — without it the second
    // agent re-runs the same commands with no statement of what was red.
    assert.match(prompt, /unit suite is red/)
    assert.doesNotMatch(prompt, /first failure/, 'the do-not-repair clause is exactly wrong on a retry')
  } finally {
    cleanup(root)
  }
})

test('the inter-wave verify budget is measured across the round trip and then bounds the next check', () => {
  const { root, batch } = verifiableRepo()
  try {
    const verify = completeBatch(root, batch)
    assert.equal(verify.action, 'verify')
    const dispatched = manifestOf(root)
    assert.ok(dispatched.verifyStartedAt, 'the step must mark when it dispatched, or nothing can time it')

    // Backdate the mark: this process runs BETWEEN agent turns and never sees
    // the interval itself, which is the whole reason the clock lives on the
    // manifest rather than in one invocation.
    const manifest = { ...dispatched, verifyStartedAt: new Date(Date.now() - LIMITS.interWaveVerifyBudgetMs * 2).toISOString() }
    file(root, '.claude/ship/run.json', manifest)

    const next = run(root, [...verify.then.argv], {
      results: [{ results: [{ kind: 'unit', exitCode: 0, total: 3, passed: 3, failed: 0 }] }]
    }).step

    const folded = manifestOf(root)
    assert.ok(
      folded.verifyElapsedMs >= LIMITS.interWaveVerifyBudgetMs,
      `the elapsed interval was not folded in (${folded.verifyElapsedMs}ms)`
    )
    assert.equal(folded.verifyStartedAt, null, 'a mark left set would be counted twice')

    // Group 2 runs, and its checkpoint now sees a spent budget.
    const second = completeBatch(root, next)
    assert.equal(second.action, 'verify')
    const plan = JSON.parse(readFileSync(join(root, '.claude/ship/vplan-inter-wave.json'), 'utf8'))
    assert.equal(plan.budgetExceeded, true, 'the published cap must actually bound something')
    assert.deepEqual(
      plan.steps.map(s => s.kind).filter(k => k !== 'typecheck'),
      [],
      'past the budget, drop to typecheck only rather than letting the checks outweigh the work'
    )
    if (second.skipped) {
      assert.equal(second.reason, 'verify-budget-exceeded', 'the reason is the budget, not typecheck’s missing command')
      assert.ok(
        (second.banners || []).some(b => b.includes('verify-budget-exceeded')),
        'a degraded path is spoken, never silent'
      )
    }
  } finally {
    cleanup(root)
  }
})

// ---------------------------------------------------------------------------
// The TDD task shape, end to end through the real binary.
//
// `resolveRedWave` reads the shape off tasks.md; the planner honours or refuses
// it; the run skips exactly one inter-wave check. These tests drive the CLI
// rather than the module so the flag plumbing — ship.js → `run start` → the
// manifest → `run classified` → the planner — is covered too. A flag that is
// parsed and dropped is the failure mode this whole file exists for.
// ---------------------------------------------------------------------------

const TDD_TASKS =
  '# Tasks\n\n' +
  `## 1. ${RED_SECTION_MARKER}\n\n` +
  '- [ ] 1.1 Cover the transform boundary in test/thing.test.mjs\n\n' +
  '## 2. Make §1 green\n\n' +
  '- [ ] 2.1 Add the thing to docs/guide.md\n' +
  '- [ ] 2.2 Note it in README.md\n'

const TDD_CLASSIFIED = {
  tasks: [
    {
      id: '1.1',
      group: 1,
      description: 'Cover the transform boundary in test/thing.test.mjs',
      tier: 2,
      model: 'sonnet',
      isTestTask: true,
      paths: ['test/thing.test.mjs']
    },
    {
      id: '2.1',
      group: 2,
      description: 'Add the thing to docs/guide.md',
      tier: 2,
      model: 'sonnet',
      isTestTask: false,
      paths: ['docs/guide.md']
    },
    {
      id: '2.2',
      group: 2,
      description: 'Note it in README.md',
      tier: 2,
      model: 'sonnet',
      isTestTask: false,
      paths: ['README.md']
    }
  ]
}

/** start → classify → classified, with a TDD-shaped tasks.md. */
function toTddPlan(root, change, startFlags = []) {
  const started = run(root, ['run', 'start', '--change', change, ...startFlags]).step
  assert.equal(started.action, 'classify')
  file(root, '.claude/ship/classified.json', TDD_CLASSIFIED)
  const step = run(root, [...started.then.argv]).step
  const plan = JSON.parse(readFileSync(join(root, '.claude/ship/plan.json'), 'utf8'))
  const manifest = JSON.parse(readFileSync(join(root, '.claude/ship/run.json'), 'utf8'))
  return { step, plan, manifest }
}

test('the tasks.md heading alone makes a run red-first — no flag needed', () => {
  const { root, change } = repo('tdd-thing', { tasks: TDD_TASKS })
  try {
    const { plan, step } = toTddPlan(root, change)
    assert.equal(plan.redWave, 1, 'the shape came from the file')
    assert.equal(plan.testWave, null, 'so the suite does not also defer')
    assert.equal(plan.waves[0].red, true)
    // And the first thing dispatched is the failing suite — read off the
    // spawns, which is what the host actually acts on.
    assert.equal(step.action, 'run-batch')
    assert.equal(step.wave, 1)
    assert.deepEqual(step.spawns.map(s => s.label), ['1.1'])
  } finally {
    cleanup(root)
  }
})

test('--no-tdd overrides the heading, and says that it did', () => {
  const { root, change } = repo('tdd-thing', { tasks: TDD_TASKS })
  try {
    const { plan, manifest } = toTddPlan(root, change, ['--no-tdd'])
    assert.equal(manifest.flags.tddMode, 'no-tdd', 'the flag reached the manifest')
    assert.equal(plan.redWave, null)
    assert.ok(plan.testWave, 'the suite defers like any other test task')
    assert.ok(
      manifest.banners.some(b => /TDD SHAPE REFUSED/.test(b)),
      `expected a refusal banner, got: ${manifest.banners.join(' | ')}`
    )
    // Said once, not once per step that re-resolved it.
    assert.equal(manifest.banners.filter(b => /TDD SHAPE REFUSED/.test(b)).length, 1)
  } finally {
    cleanup(root)
  }
})

test('an ordinary change is untouched by any of this, flag or no flag', () => {
  // The constraint the whole feature was built under. A change with no marker
  // plans identically whether or not the shape machinery exists — and --tdd on
  // one is refused out loud rather than guessing at a section.
  const { root, change } = repo()
  try {
    const plain = toFirstBatch(root, change)
    assert.equal(plain.action, 'run-batch')
    const plan = JSON.parse(readFileSync(join(root, '.claude/ship/plan.json'), 'utf8'))
    assert.equal(plan.redWave, null)
    for (const wave of plan.waves) assert.equal(wave.red, undefined)
    const manifest = JSON.parse(readFileSync(join(root, '.claude/ship/run.json'), 'utf8'))
    assert.deepEqual(
      manifest.banners.filter(b => /TDD/.test(b)),
      [],
      'nothing about task shape is said on a change that has none'
    )
  } finally {
    cleanup(root)
  }

  const forced = repo()
  try {
    const started = run(forced.root, ['run', 'start', '--change', forced.change, '--tdd']).step
    file(forced.root, '.claude/ship/classified.json', CLASSIFIED)
    run(forced.root, [...started.then.argv])
    const plan = JSON.parse(readFileSync(join(forced.root, '.claude/ship/plan.json'), 'utf8'))
    assert.equal(plan.redWave, null, '--tdd cannot invent a failing suite that is not there')
    const manifest = JSON.parse(readFileSync(join(forced.root, '.claude/ship/run.json'), 'utf8'))
    assert.ok(
      manifest.banners.some(b => /TDD SHAPE UNAVAILABLE/.test(b)),
      `expected an unavailable banner, got: ${manifest.banners.join(' | ')}`
    )
  } finally {
    cleanup(forced.root)
  }
})

test('--tdd infers the shape from an all-test first section when the heading is absent', () => {
  // The flag's own job: a change written test-first without the exact heading.
  const { root, change } = repo('tdd-thing', {
    tasks:
      '# Tasks\n\n## 1. Tests\n\n- [ ] 1.1 Cover the transform boundary in test/thing.test.mjs\n\n' +
      '## 2. Implement\n\n- [ ] 2.1 Add the thing to docs/guide.md\n- [ ] 2.2 Note it in README.md\n'
  })
  try {
    const { plan, manifest } = toTddPlan(root, change, ['--tdd'])
    assert.equal(plan.redWave, 1)
    assert.ok(
      manifest.banners.some(b => /TDD SHAPE INFERRED/.test(b)),
      `an inferred shape must be spoken: ${manifest.banners.join(' | ')}`
    )
  } finally {
    cleanup(root)
  }
})

test('a red-first run skips exactly one inter-wave check, and the green wave still gates', () => {
  // The behavioural payoff, and the thing that would otherwise halt the run:
  // the red suite's own check is skipped, the implementation wave's is not.
  const { root, change } = repo('tdd-thing', { tasks: TDD_TASKS })
  try {
    const { step } = toTddPlan(root, change)

    // Wave 1 (red) → its check is skipped, so the next step is wave 2's batch.
    const afterRed = run(root, [...step.then.argv], { results: laneOk(['1.1']) }).step
    assert.equal(afterRed.action, 'run-batch', 'no verify step between red and green')
    assert.equal(afterRed.wave, 2)

    const state = JSON.parse(readFileSync(join(root, '.claude/ship/state.json'), 'utf8'))
    assert.deepEqual(
      state.skippedVerifications.map(s => ({ wave: s.wave, reason: s.reason })),
      [{ wave: 1, reason: SKIP_VERIFY_RED }]
    )
    assert.equal(state.verificationsUsed || 0, 0, 'and no checkpoint was spent on it')

    // Wave 2 is the last wave, so it goes to final verification rather than an
    // inter-wave one — either way the suite is checked after the code exists.
    const afterGreen = run(root, [...afterRed.then.argv], { results: laneOk(['2.1', '2.2']) }).step
    assert.notEqual(afterGreen.action, 'done', 'the green wave is not waved through unverified')
  } finally {
    cleanup(root)
  }
})

test('a marker on a later section is refused by the planner and bannered by the run', () => {
  // The bridge between the two adjudicators: `resolveRedWave` reports what the
  // file says, the PLANNER refuses a claim the classification contradicts, and
  // the run has to surface that refusal as a banner rather than leaving it as
  // one line in plan.json. A failing-test section that runs after
  // implementation is not a red wave, and promoting it would move tests earlier
  // than the author put them.
  const { root, change } = repo('late-marker', {
    tasks:
      '# Tasks\n\n## 1. Scaffold\n\n- [ ] 1.1 Add the thing to docs/guide.md\n- [ ] 1.2 Note it in README.md\n\n' +
      `## 2. ${RED_SECTION_MARKER}\n\n- [ ] 2.1 Cover it in test/thing.test.mjs\n`
  })
  try {
    const started = run(root, ['run', 'start', '--change', change]).step
    file(root, '.claude/ship/classified.json', {
      tasks: [
        ...CLASSIFIED.tasks,
        {
          id: '2.1',
          group: 2,
          description: 'Cover it in test/thing.test.mjs',
          tier: 2,
          model: 'sonnet',
          isTestTask: true,
          paths: ['test/thing.test.mjs']
        }
      ]
    })
    run(root, [...started.then.argv])

    const plan = JSON.parse(readFileSync(join(root, '.claude/ship/plan.json'), 'utf8'))
    assert.equal(plan.redWave, null, 'the claim is refused, not honoured')
    assert.ok(plan.testWave, 'so the suite defers as it always would')

    const manifest = JSON.parse(readFileSync(join(root, '.claude/ship/run.json'), 'utf8'))
    const refusal = manifest.banners.find(b => /TDD SHAPE REFUSED/.test(b))
    assert.ok(refusal, `the refusal must reach the banners: ${manifest.banners.join(' | ')}`)
    assert.match(refusal, /not the first section/, 'and say which rule it broke')
    // Readable, not a shouted sentence: only the label is capitalised.
    assert.doesNotMatch(refusal, /IS NOT THE FIRST SECTION/)
  } finally {
    cleanup(root)
  }
})

// --- the jumphour findings: relay size, spawn trajectory, verify clock -------
//
// A healthy run halted at wave 6 because a haiku relay retyped a 23 KB step and
// dropped two brackets. The same run's trajectory held a spawn event for an
// agent that never ran and none for four that did, and its inter-wave budget
// was spent by relay and agent overhead on the first checkpoint. Each is driven
// here through the real CLI.

/** Run one `interlock` command and return its stdout exactly as printed. */
function rawRun(root, argv) {
  return execFileSync(process.execPath, [BIN, ...argv, '--json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

/** The implementer agent-spawn events this run's trajectory holds, by anchor task. */
function laneSpawnsLogged(root) {
  const runId = manifestOf(root).runId
  return readFileSync(join(root, '.claude/ship/runs', `${runId}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(e => e.type === 'agent-spawn' && e.kind === 'implementer')
    .map(e => e.taskId)
}

test('relayStep hands the Workflow host only the fields its interpreter reads', () => {
  const step = {
    schema: 'interlock.run-step/1',
    action: 'run-batch',
    then: { argv: ['run', 'record-batch'] },
    wave: 3,
    change: 'add-thing',
    banners: ['SOMETHING DEGRADED: why'],
    remainingBatches: [[[{ id: '6.1', description: 'x'.repeat(4000) }]]],
    previousHandoffs: [{ taskId: '5.1', summary: 'y'.repeat(6000) }],
    changed: ['src/a.ts'],
    lanes: [[{ id: '6.1' }]],
    mergeBase: null,
    // The six fields the relay carries for the ship meter's board
    // (draw-the-wave-board-in-the-meter-pane design D1).
    waveIndex: 4,
    batchIndex: 1,
    batchCount: 2,
    skipped: false,
    recorded: { ok: ['5.1'], failed: ['5.2'], notAttempted: ['5.3'] },
    plan: { waves: [], testWave: null, deferred: [] },
    spawns: [
      {
        label: '6.1+1',
        kind: 'implementer',
        model: 'sonnet',
        effort: null,
        type: 'interlock:worker',
        tools: ['Read'],
        schema: { type: 'object' },
        isolation: null,
        worktree: null,
        promptPath: '.claude/ship/briefings/6.1+1.md',
        promptSha256: 'a'.repeat(64),
        prompt: 'z'.repeat(9000)
      }
    ]
  }

  const slim = relayStep({ host: { id: 'workflow' } }, step)
  for (const key of Object.keys(slim)) {
    assert.ok(RELAY_STEP_FIELDS.includes(key), `${key} reached the relay`)
  }
  for (const gone of ['remainingBatches', 'previousHandoffs', 'changed', 'lanes', 'mergeBase']) {
    assert.equal(gone in slim, false, `${gone} is carried state the next call reads from state.json`)
  }
  assert.deepEqual(slim.then, step.then)
  assert.equal(slim.action, 'run-batch')
  assert.equal(slim.wave, 3)
  assert.equal(slim.change, 'add-thing')
  assert.deepEqual(slim.banners, step.banners)
  for (const kept of ['waveIndex', 'batchIndex', 'batchCount', 'skipped', 'recorded', 'plan']) {
    assert.deepEqual(slim[kept], step[kept], `${kept} is a stated relay field for the meter`)
  }
  assert.deepEqual(RELAY_STEP_FIELDS, [
    'schema',
    'action',
    'then',
    'spawns',
    'banners',
    'change',
    'wave',
    'reason',
    'pingModel',
    'waveIndex',
    'batchIndex',
    'batchCount',
    'skipped',
    'recorded',
    'plan'
  ])
  assert.equal('prompt' in slim.spawns[0], false, 'the worker is handed a path and a hash, never the text')
  const { prompt, ...kept } = step.spawns[0]
  assert.deepEqual(slim.spawns[0], kept, 'everything else a spawn names reaches the interpreter')
  assert.equal(step.spawns[0].prompt.length, 9000, 'the step itself is not mutated')

  // Every other host reads stdout as a process and sends `prompt` inline.
  for (const manifest of [{ host: { id: 'claude' } }, { host: { id: 'acp' } }, { host: null }, null]) {
    assert.equal(relayStep(manifest, step), step)
  }
})

test('on the Workflow host a run step is printed slim, and its exact bytes are kept on disk', () => {
  const { root, change } = repo()
  try {
    const started = JSON.parse(rawRun(root, ['run', 'start', '--change', change, '--host', 'workflow']))
    assert.equal(started.action, 'classify')
    file(root, '.claude/ship/classified.json', CLASSIFIED)
    const stdout = rawRun(root, [...started.then.argv])
    const step = JSON.parse(stdout)

    assert.equal(step.action, 'run-batch')
    for (const gone of ['remainingBatches', 'previousHandoffs', 'changed']) {
      assert.equal(gone in step, false, `${gone} rode the relay`)
    }
    assert.ok(step.spawns.length >= 1)
    for (const s of step.spawns) {
      assert.equal('prompt' in s, false, `${s.label}'s briefing rode the relay inline`)
      assert.match(s.promptSha256, /^[0-9a-f]{64}$/)
      // The briefing is still there, by reference, and still hashes to what the
      // step names — the worker loses nothing the relay no longer carries.
      const body = readFileSync(join(root, s.promptPath), 'utf8').split('\n').slice(1).join('\n')
      assert.equal(briefingHash(body), s.promptSha256)
    }
    assert.equal(
      readFileSync(join(root, LAST_STEP_PATH), 'utf8'),
      stdout,
      'the CLI keeps the exact bytes it printed, for when a relay copy does not parse'
    )
  } finally {
    cleanup(root)
  }
})

// --- the step stream is the meter's board source (spec: ship/run-program) ----
//
// draw-the-wave-board-in-the-meter-pane: the adoption and replan steps carry a
// summary of the waves that will run, the step `run record-batch` returns
// carries the ids it recorded, and every other step grows by the three integer
// positions alone. The summary module is loaded lazily so a missing module fails
// these cases and nothing else in this file.

const RUN_STEP_SCHEMA = 'interlock.run-step/1'
const RELAYED_TODAY = ['schema', 'action', 'then', 'spawns', 'banners', 'change', 'wave', 'reason', 'pingModel']
const summaryModule = () => import('../../lib/plan-summary.mjs')
const stateOf = root => JSON.parse(readFileSync(join(root, '.claude/ship/state.json'), 'utf8'))
const planOf = root => JSON.parse(readFileSync(join(root, '.claude/ship/plan.json'), 'utf8'))

// 1.2 depends on 1.1, so the planner defers it and the plan keeps a record.
const DEPENDENT = {
  tasks: [
    { id: '1.1', group: 1, description: 'Edit src/mod11.ts', tier: 2, model: 'sonnet', isTestTask: false, paths: ['src/mod11.ts'] },
    {
      id: '1.2',
      group: 1,
      description: 'Edit src/mod12.ts',
      tier: 3,
      model: 'sonnet',
      isTestTask: false,
      paths: ['src/mod12.ts'],
      dependsOn: ['1.1']
    },
    { id: '2.1', group: 2, description: 'Edit src/mod21.ts', tier: 2, model: 'haiku', isTestTask: false, paths: ['src/mod21.ts'] }
  ]
}

test('the adoption step carries the summary of the state that will run, and no task paths', async () => {
  const { summarizePlan } = await summaryModule()
  const { root, batch: first } = verifiableRepo(DEPENDENT)
  try {
    assert.equal(first.schema, RUN_STEP_SCHEMA)
    assert.equal(first.action, 'run-batch')
    const plan = planOf(root)
    assert.ok(plan.deferred.length > 0, 'the fixture must defer a task, or the edges prove nothing')
    assert.deepEqual(first.plan, summarizePlan(stateOf(root), { deferred: plan.deferred }))
    assert.ok(!JSON.stringify(first.plan).includes('"paths"'), 'a task path rode the summary')
    assert.deepEqual(first.plan.deferred.find(r => r.id === '1.2').after, ['1.1'])
  } finally {
    cleanup(root)
  }
})

test('the relayed adoption step places itself and carries the plan; a re-read batch carries only the positions', () => {
  const { root, change } = repo()
  try {
    const started = JSON.parse(rawRun(root, ['run', 'start', '--change', change, '--host', 'workflow']))
    assert.equal(started.schema, RUN_STEP_SCHEMA)
    file(root, '.claude/ship/classified.json', CLASSIFIED)
    const first = JSON.parse(rawRun(root, [...started.then.argv]))
    assert.equal(first.schema, RUN_STEP_SCHEMA)
    assert.equal(first.waveIndex, 0)
    assert.equal(first.batchIndex, 0)
    assert.ok(Number.isInteger(first.batchCount) && first.batchCount >= 1, `batchCount ${first.batchCount}`)
    assert.ok(first.plan && Array.isArray(first.plan.waves), 'the adoption step relayed no plan')
    for (const gone of ['remainingBatches', 'previousHandoffs', 'changed', 'lanes', 'mergeBase']) {
      assert.equal(gone in first, false, `${gone} rode the relay`)
    }
    for (const s of first.spawns) assert.equal('prompt' in s, false)

    // A resumed driver re-reads the step with `run next`, which the sequence
    // guard admits once the manifest names no continuation.
    const manifestPath = join(root, '.claude/ship/run.json')
    writeFileSync(manifestPath, JSON.stringify({ ...manifestOf(root), lastThen: null }, null, 2) + '\n')
    const again = JSON.parse(rawRun(root, ['run', 'next']))
    assert.equal(again.schema, RUN_STEP_SCHEMA)
    assert.equal(again.action, 'run-batch')
    assert.equal('plan' in again, false, 'run next re-reads a batch; it does not re-send the summary')
    assert.deepEqual(
      Object.keys(again).filter(k => !RELAYED_TODAY.includes(k)).sort(),
      ['batchCount', 'batchIndex', 'waveIndex'],
      'a batch step that is not the adoption step grows by the three positions and nothing else'
    )
  } finally {
    cleanup(root)
  }
})

test('record-batch carries the ids it recorded, and no plan', () => {
  const { root, change } = repo('add-thing', {
    tasks: '# Tasks\n\n- [ ] 1.1 First\n- [ ] 1.2 Second\n'
  })
  try {
    const batch = toFirstBatch(root, change)
    assert.ok(batch.plan, 'the adoption step carries the summary')
    const lanes = batch.lanes.map(lane => lane.map(t => t.id))
    // The first lane fails its first task and never attempts the rest; any other
    // lane goes fine.
    const results = lanes.map((ids, i) =>
      i === 0
        ? { tasks: [{ id: ids[0], outcome: 'failed', error: 'could not build' }, ...ids.slice(1).map(id => ({ id, outcome: 'not-attempted' }))] }
        : laneOk(ids)
    )
    const recorded = run(root, [...batch.then.argv], { results }).step
    assert.equal(recorded.schema, RUN_STEP_SCHEMA)
    assert.equal('plan' in recorded, false, 'the summary rides only on the adoption and replan steps')
    assert.deepEqual(recorded.recorded, {
      ok: lanes.slice(1).flat(),
      failed: [lanes[0][0]],
      notAttempted: lanes[0].slice(1)
    })
    const tally = manifestOf(root).waves.at(-1)
    assert.deepEqual(tally.notAttempted, recorded.recorded.notAttempted, 'the tally and the field are one expression')
    assert.deepEqual(tally.failedIds, recorded.recorded.failed)
  } finally {
    cleanup(root)
  }
})

test('a record-batch that halts before its verdict carries no recorded ids', () => {
  // The trajectory halt.
  {
    const { root, change } = repo()
    try {
      const batch = toFirstBatch(root, change)
      const results = batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id)))
      const ctx = {
        root,
        warn: () => {},
        deps: {
          headCommit: () => null,
          observedChangedPaths: () => ['README.md'],
          runMergeLanes: () => ({ status: 'clean', cleanupWarnings: [] }),
          logWaveMutation: (_r, { state }) => ({ step: nextStep(state), ok: false }),
          logAgentSpawns: () => {}
        }
      }
      const step = runRecordBatch(ctx, { results })
      assert.equal(step.action, 'halt')
      assert.equal('recorded' in step, false, 'a trajectory halt recorded nothing a reader may count')
      assert.equal('plan' in step, false)
    } finally {
      cleanup(root)
    }
  }
  // The merge halt.
  {
    const { root, change } = repo()
    try {
      const batch = startWithHost(root, change, 'qwen', { worktree: 'driver' }, ['--isolate-waves'])
      const captured = batch.mergeBase
      const results = batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id)))
      const ctx = {
        root,
        warn: () => {},
        deps: {
          headCommit: () => captured,
          worktreeHead: () => captured,
          observedChangedPaths: () => ['README.md'],
          runMergeLanes: () => ({ status: 'collision', collisions: ['README.md'], cleanupWarnings: [] }),
          logWaveMutation: (_r, { state }) => ({ step: nextStep(state), ok: true }),
          logAgentSpawns: () => {}
        }
      }
      const step = runRecordBatch(ctx, { results })
      assert.equal(step.action, 'halt')
      assert.match(step.reason, /merge-lanes halted/)
      assert.equal('recorded' in step, false, 'a merge halt recorded nothing a reader may count')
    } finally {
      cleanup(root)
    }
  }
})

test('a revised replan re-sends the summary from the revised state; a declined one sends none', async () => {
  const { summarizePlan } = await summaryModule()
  for (const revised of [true, false]) {
    const { root, batch } = verifiableRepo()
    try {
      const verify = completeBatch(root, batch)
      assert.equal(verify.action, 'verify')
      assert.equal('plan' in verify, false)
      const statePath = join(root, '.claude/ship/state.json')
      file(root, '.claude/ship/state.json', { ...JSON.parse(readFileSync(statePath, 'utf8')), replanPending: true })
      const offer = run(root, [...verify.then.argv], {
        results: [{ results: [{ kind: 'unit', exitCode: 0, total: 3, passed: 3, failed: 0 }] }]
      }).step
      assert.equal(offer.action, 'replan')
      assert.equal('plan' in offer, false)

      file(root, '.claude/ship/replan.json', [
        { group: 2, tasks: THREE_GROUPS.tasks.filter(t => t.group === 2) }
      ])
      const after = run(root, [...offer.then.argv], { results: [{ revised }] }).step
      assert.equal(after.schema, RUN_STEP_SCHEMA)
      if (revised) {
        assert.equal(after.action, 'run-batch')
        assert.deepEqual(after.plan, summarizePlan(stateOf(root)))
      } else assert.equal('plan' in after, false, 'a declined replan rewrote no waves')
    } finally {
      cleanup(root)
    }
  }
})

// Three path-disjoint tier-4 tasks at --max-parallel 2: a two-lane batch, then
// a one-lane batch, in ONE wave — the shape that gave the jumphour trajectory a
// spawn event for a lane the halted run never dispatched.
const TWO_BATCHES = {
  tasks: [
    { id: '1.1', group: 1, description: 'auth a', tier: 4, model: 'sonnet', isTestTask: false, paths: ['src/a.ts'] },
    { id: '1.2', group: 1, description: 'auth b', tier: 4, model: 'haiku', isTestTask: false, paths: ['src/b.ts'] },
    { id: '1.3', group: 1, description: 'auth c', tier: 4, model: 'sonnet', isTestTask: false, paths: ['src/c.ts'] }
  ]
}

test('a batch logs its own lanes when it is emitted, never a later batch of its wave', () => {
  const { root, change } = repo('add-thing', {
    tasks: '# Tasks\n\n- [ ] 1.1 auth a\n- [ ] 1.2 auth b\n- [ ] 1.3 auth c\n'
  })
  try {
    const started = run(root, ['run', 'start', '--change', change, '--max-parallel', '2']).step
    file(root, '.claude/ship/classified.json', TWO_BATCHES)
    const first = run(root, [...started.then.argv]).step
    assert.equal(first.action, 'run-batch')
    assert.deepEqual(first.lanes.map(l => l.map(t => t.id)), [['1.1'], ['1.2']])
    assert.deepEqual(
      laneSpawnsLogged(root),
      ['1.1', '1.2'],
      'the second batch is not dispatched yet, and a run that halts here never dispatches it'
    )

    const second = completeBatch(root, first)
    assert.equal(second.action, 'run-batch')
    assert.deepEqual(second.lanes.map(l => l.map(t => t.id)), [['1.3']])
    assert.deepEqual(laneSpawnsLogged(root), ['1.1', '1.2', '1.3'], 'and it is logged once it is')
  } finally {
    cleanup(root)
  }
})

test('a wave entered through the inter-wave judge logs the lanes it dispatches', () => {
  const { root, batch } = verifiableRepo()
  try {
    const firstWave = batch.lanes.map(l => l[0].id)
    assert.deepEqual(laneSpawnsLogged(root), firstWave)

    const verify = completeBatch(root, batch)
    assert.equal(verify.action, 'verify')
    const next = run(root, [...verify.then.argv], {
      results: [{ results: [{ kind: 'unit', exitCode: 0, total: 3, passed: 3, failed: 0 }] }]
    }).step
    assert.equal(next.action, 'run-batch')
    assert.deepEqual(
      laneSpawnsLogged(root),
      [...firstWave, ...next.lanes.map(l => l[0].id)],
      'record-verify names the next wave, so it owes the trajectory its spawns'
    )
  } finally {
    cleanup(root)
  }
})

test('a wave entered through a replan logs the lanes it dispatches', () => {
  const { root, batch } = verifiableRepo()
  try {
    const verify = completeBatch(root, batch)
    assert.equal(verify.action, 'verify')
    // Nothing in the run path raises a replan today, so the state is set to one
    // directly: what is under test is what `run replan` owes the trajectory once
    // a replan is taken, not what triggers it.
    const statePath = join(root, '.claude/ship/state.json')
    file(root, '.claude/ship/state.json', { ...JSON.parse(readFileSync(statePath, 'utf8')), replanPending: true })
    const offer = run(root, [...verify.then.argv], {
      results: [{ results: [{ kind: 'unit', exitCode: 0, total: 3, passed: 3, failed: 0 }] }]
    }).step
    assert.equal(offer.action, 'replan')
    const before = laneSpawnsLogged(root)

    file(root, '.claude/ship/replan.json', [
      { group: 2, tasks: THREE_GROUPS.tasks.filter(t => t.group === 2) }
    ])
    const replanned = run(root, [...offer.then.argv], { results: [{ revised: true }] }).step
    assert.equal(replanned.action, 'run-batch')
    assert.deepEqual(laneSpawnsLogged(root), [...before, ...replanned.lanes.map(l => l[0].id)])
  } finally {
    cleanup(root)
  }
})

test('the inter-wave budget is charged the checks\' own time when verify exec timed them', () => {
  const { root, batch } = verifiableRepo()
  try {
    // A timing left over from somewhere else is not this checkpoint's.
    file(root, VERIFY_TIMINGS_PATH, JSON.stringify({ kind: 'unit', exitCode: 0, durationMs: 999999 }) + '\n')
    const verify = completeBatch(root, batch)
    assert.equal(verify.action, 'verify')
    assert.equal(existsSync(join(root, VERIFY_TIMINGS_PATH)), false, 'the slate is cleared where the checks are named')

    // The round trip is backdated far past the budget: were it charged, the next
    // checkpoint would drop to typecheck only.
    const dispatched = manifestOf(root)
    file(root, '.claude/ship/run.json', {
      ...dispatched,
      verifyStartedAt: new Date(Date.now() - LIMITS.interWaveVerifyBudgetMs * 2).toISOString()
    })
    // What `interlock verify exec` records: a unit run, a re-run after a repair,
    // and a kind the plan never named.
    file(
      root,
      VERIFY_TIMINGS_PATH,
      [
        { kind: 'unit', exitCode: 1, durationMs: 1200 },
        { kind: 'unit', exitCode: 0, durationMs: 800 },
        { kind: 'e2e', exitCode: 0, durationMs: 50000 }
      ]
        .map(t => JSON.stringify(t))
        .join('\n') + '\n'
    )

    const next = run(root, [...verify.then.argv], {
      results: [{ results: [{ kind: 'unit', exitCode: 0, total: 3, passed: 3, failed: 0 }] }]
    }).step
    const folded = manifestOf(root)
    assert.equal(folded.verifyElapsedMs, 2000, 'both runs of the planned check, and nothing else')
    assert.equal(folded.verifyStartedAt, null)
    assert.ok(!(folded.banners || []).some(b => b.startsWith('VERIFY BUDGET CLOCKED BY ROUND TRIP')))
    assert.equal(existsSync(join(root, VERIFY_TIMINGS_PATH)), false, 'a timing is never charged twice')

    // So the next checkpoint still runs the suite.
    const second = completeBatch(root, next)
    assert.equal(second.action, 'verify')
    const plan = JSON.parse(readFileSync(join(root, '.claude/ship/vplan-inter-wave.json'), 'utf8'))
    assert.equal(plan.budgetExceeded, false)
    assert.ok(plan.steps.some(s => s.kind === 'unit'))
  } finally {
    cleanup(root)
  }
})

test('a checkpoint with no verify exec timing is charged the round trip, and says so', () => {
  const { root, batch } = verifiableRepo()
  try {
    const verify = completeBatch(root, batch)
    const dispatched = manifestOf(root)
    file(root, '.claude/ship/run.json', {
      ...dispatched,
      verifyStartedAt: new Date(Date.now() - 5000).toISOString()
    })
    run(root, [...verify.then.argv], {
      results: [{ results: [{ kind: 'unit', exitCode: 0, total: 3, passed: 3, failed: 0 }] }]
    })
    const folded = manifestOf(root)
    assert.ok(folded.verifyElapsedMs >= 5000, `the round trip was not charged (${folded.verifyElapsedMs}ms)`)
    const banner = (folded.banners || []).find(b => b.startsWith('VERIFY BUDGET CLOCKED BY ROUND TRIP:'))
    assert.ok(banner, 'a degraded clock is spoken, never silent')
    assert.match(banner, /interlock verify exec/)
    assert.match(banner, /\bunit\b/, 'and it names the check that went untimed')
  } finally {
    cleanup(root)
  }
})

// --- every spawn's effort (dispatch-published-effort) ------------------------
//
// Every effort `interlock limits` publishes has a reader, and every spawn the
// program can emit either reads one or inherits the host's on purpose. Each
// value below is read from `lib/limits.mjs`, never written as a level here, so
// a retune of the table moves these assertions with it.

/** The spawn a verify step carries, asserted to exist so a skip cannot pass. */
function verifySpawnOf(step) {
  assert.equal(step.skipped, false, `${step.action} skipped, so it emitted no verify spawn to check`)
  assert.equal(step.spawns.length, 1, `${step.action} emits one verify spawn`)
  return step.spawns[0]
}

test('an inter-wave verify spawn carries the published verify effort', () => {
  const { root, batch } = verifiableRepo()
  try {
    const verify = completeBatch(root, batch)
    assert.equal(verify.action, 'verify')
    assert.equal(verify.context, 'inter-wave')
    const s = verifySpawnOf(verify)
    assert.equal(s.kind, 'verify')
    assert.equal(s.effort, EFFORT.verify, `${s.label} must carry EFFORT.verify, not the host default`)
    assert.equal(s.model, null, 'the verify spawn\'s model stays the session model')
  } finally {
    cleanup(root)
  }
})

test('an inter-wave retry after a red judge carries the same verify effort', () => {
  const { root, batch } = verifiableRepo()
  try {
    const verify = completeBatch(root, batch)
    assert.equal(verify.action, 'verify')
    const retry = run(root, [...verify.then.argv], {
      results: [{ results: [{ kind: 'unit', exitCode: 1, total: 3, passed: 2, failed: 1, failures: ['boom'] }] }]
    }).step
    assert.equal(retry.action, 'verify')
    assert.equal(retry.fixAttempt, 1)
    const s = verifySpawnOf(retry)
    assert.equal(s.effort, EFFORT.verify, `${s.label} (fix attempt 1) must carry EFFORT.verify`)
  } finally {
    cleanup(root)
  }
})

test('the final verify spawn carries the published verify effort', () => {
  const { root, batch } = verifiableRepo({ tasks: THREE_GROUPS.tasks.filter(t => t.group === 1) })
  try {
    const final = completeBatch(root, batch)
    assert.equal(final.action, 'verify-final')
    assert.equal(final.context, 'final')
    const s = verifySpawnOf(final)
    assert.equal(s.kind, 'verify')
    assert.equal(s.effort, EFFORT.verify, `${s.label} must carry EFFORT.verify, not the host default`)
  } finally {
    cleanup(root)
  }
})

test('the review and both remediation spawns carry the published skeptic effort', () => {
  const { root, change } = repo()
  try {
    const review = toTail(root, change, ['--strict'])
    assert.equal(review.action, 'review')
    assert.equal(review.spawns[0].kind, 'review')
    assert.equal(review.spawns[0].effort, EFFORT.skeptic, 'the review spawn')

    writeReview(root, { blockers: 1 })
    const round1 = run(root, [...review.then.argv], { results: [{ ok: true }] }).step
    assert.equal(round1.action, 'remediate')
    assert.equal(round1.spawns[0].kind, 'remediate')
    assert.equal(round1.spawns[0].effort, EFFORT.skeptic, 'the fixing-round remediation spawn')

    writeReview(root, {})
    const verdict = run(root, [...round1.then.argv], { results: [{ ok: true }] }).step
    assert.equal(verdict.action, 'verdict')
    assert.equal(verdict.spawns[0].kind, 'remediate')
    assert.equal(verdict.spawns[0].effort, EFFORT.skeptic, 'the verdict-round remediation spawn')
  } finally {
    cleanup(root)
  }
})

test('the planner, handoff and commit spawns inherit the host effort', () => {
  const { root, change } = repo()
  try {
    const started = run(root, ['run', 'start', '--change', change, '--strict']).step
    assert.equal(started.spawns[0].kind, 'planner')
    assert.equal(started.spawns[0].effort, null, 'the plan-waves planner inherits')

    file(root, '.claude/ship/classified.json', CLASSIFIED)
    const batch = run(root, [...started.then.argv]).step
    writeFileSync(join(root, 'README.md'), 'hello\nand the thing\n')
    const review = run(root, [...batch.then.argv], {
      results: batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id)))
    }).step
    writeReview(root, { dismissed: 1 })
    const verified = run(root, [...review.then.argv], { results: [{ ok: true }] }).step
    assert.equal(verified.action, 'verify-final')

    const handoff = run(root, [...verified.then.argv]).step
    assert.equal(handoff.action, 'handoff')
    assert.equal(handoff.spawns[0].kind, 'handoff')
    assert.equal(handoff.spawns[0].effort, null, 'the handoff spawn inherits')

    const commit = run(root, [...handoff.then.argv], {
      results: [{ ok: true, manualTestPlan: false, skipReason: 'backend only', scenariosChecked: 0 }]
    }).step
    assert.equal(commit.action, 'commit')
    assert.equal(commit.spawns[0].kind, 'commit')
    assert.equal(commit.spawns[0].effort, null, 'the commit spawn inherits')
  } finally {
    cleanup(root)
  }
})

test('the replan ping inherits the host effort', () => {
  const { root, batch } = verifiableRepo()
  try {
    const verify = completeBatch(root, batch)
    assert.equal(verify.action, 'verify')
    const statePath = join(root, '.claude/ship/state.json')
    file(root, '.claude/ship/state.json', { ...JSON.parse(readFileSync(statePath, 'utf8')), replanPending: true })
    const offer = run(root, [...verify.then.argv], {
      results: [{ results: [{ kind: 'unit', exitCode: 0, total: 3, passed: 3, failed: 0 }] }]
    }).step
    assert.equal(offer.action, 'replan')
    assert.equal(offer.spawns[0].kind, 'ping')
    assert.equal(offer.spawns[0].effort, null, 'the replan ping inherits')
  } finally {
    cleanup(root)
  }
})

// The two sets the effort-routing spec names. A kind in neither is a spawn that
// would ship at an unstated default, so it fails here naming itself.
const PUBLISHED_EFFORT_KINDS = ['implementer', 'verify', 'review', 'remediate']
const INHERITING_KINDS = ['ping', 'planner', 'handoff', 'commit']

/** The argument text of every `spawn(` call in `source` — the definition excluded. */
function spawnCallArgs(source) {
  const out = []
  const re = /\bspawn\(/g
  let m
  while ((m = re.exec(source))) {
    if (/function\s+$/.test(source.slice(Math.max(0, m.index - 10), m.index))) continue
    let depth = 0
    let i = m.index + m[0].length - 1
    for (; i < source.length; i++) {
      if (source[i] === '(') depth += 1
      else if (source[i] === ')' && --depth === 0) break
    }
    out.push(source.slice(m.index + m[0].length, i))
  }
  return out
}

test('every spawn kind the run program emits is in the published-effort or the inheriting set', () => {
  const source = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  const calls = spawnCallArgs(source)
  assert.ok(calls.length >= PUBLISHED_EFFORT_KINDS.length + INHERITING_KINDS.length, 'no spawn( calls were found')
  const seen = new Set()
  for (const args of calls) {
    const kind = /\bkind:\s*'([^']+)'/.exec(args)
    assert.ok(kind, `a spawn( call names no literal kind:\n${args.trim().slice(0, 200)}`)
    assert.ok(
      PUBLISHED_EFFORT_KINDS.includes(kind[1]) || INHERITING_KINDS.includes(kind[1]),
      `spawn kind "${kind[1]}" is in neither the published-effort set nor the inheriting set`
    )
    seen.add(kind[1])
  }
  for (const kind of [...PUBLISHED_EFFORT_KINDS, ...INHERITING_KINDS]) {
    assert.ok(seen.has(kind), `no spawn( call emits kind "${kind}" — the set names a spawn that no longer exists`)
  }
})

// --- the effort capability on the manifest and the receipt -------------------

test('a workflow run records the effort its claude help probe found, not an assumed flag', () => {
  const fixture = join(ROOT, 'test', 'fixtures', 'hosts', 'fake-claude.mjs')
  const { root, change } = repo()
  try {
    const started = run(root, ['run', 'start', '--change', change, '--host', 'workflow'], {
      env: { INTERLOCK_CLAUDE_COMMAND: `node ${fixture}` }
    }).step
    assert.equal(started.action, 'classify')
    assert.equal(manifestOf(root).host.effort, 'flag')
    assert.ok(
      !(started.banners || []).some(b => String(b).startsWith('EFFORT ROUTING UNAVAILABLE')),
      'a CLI whose help lists the flag is not bannered unavailable'
    )
  } finally {
    cleanup(root)
  }
})

test('a workflow run whose claude help has no effort flag records unsupported and says so', () => {
  const fixture = join(ROOT, 'test', 'fixtures', 'hosts', 'fake-claude.mjs')
  const { root, change } = repo()
  try {
    const started = run(root, ['run', 'start', '--change', change, '--host', 'workflow'], {
      env: { INTERLOCK_CLAUDE_COMMAND: `node ${fixture} --fixture-no-effort-flag` }
    }).step
    assert.equal(manifestOf(root).host.effort, 'unsupported')
    const banner = 'EFFORT ROUTING UNAVAILABLE (workflow): this claude CLI has no --effort flag'
    assert.ok((started.banners || []).includes(banner), JSON.stringify(started.banners))
    const closed = run(root, ['run', 'close', '--halt', 'stopped for the test'], { expectExit: 1 }).step
    assert.match(closed.summary, /EFFORT ROUTING UNAVAILABLE \(workflow\): this claude CLI has no --effort flag/)
  } finally {
    cleanup(root)
  }
})

test('a workflow run that already named its effort capability keeps that declaration', () => {
  // The no-flag fixture would record unsupported if the probe ran. A caller
  // that already declared the capability is the runner, and the probe must not
  // overwrite it.
  const fixture = join(ROOT, 'test', 'fixtures', 'hosts', 'fake-claude.mjs')
  const { root, change } = repo()
  try {
    run(root, [
      'run', 'start', '--change', change, '--host', 'workflow',
      '--host-capabilities', JSON.stringify({ effort: 'flag' })
    ], {
      env: { INTERLOCK_CLAUDE_COMMAND: `node ${fixture} --fixture-no-effort-flag` }
    })
    assert.equal(manifestOf(root).host.effort, 'flag')
  } finally {
    cleanup(root)
  }
})

test('a declared effort capability is recorded on the manifest unchanged', () => {
  const { root, change } = repo()
  try {
    startWithHost(root, change, 'codex', { worktree: 'driver', effort: 'unsupported' })
    assert.equal(manifestOf(root).host.effort, 'unsupported')
  } finally {
    cleanup(root)
  }
})

test('the receipt records the effort capability the host declared', () => {
  for (const [host, effort] of [
    ['qwen', 'unsupported'],
    ['claude', 'flag']
  ]) {
    const { root, change } = repo()
    try {
      startWithHost(root, change, host, { worktree: 'driver', effort })
      const closed = run(root, ['run', 'close', '--halt', 'stopped for the test'], { expectExit: 1 }).step
      assert.equal(closed.action, 'halt')
      assert.equal(receiptOf(root).host.effort, effort, `${host} declared effort: ${effort}`)
    } finally {
      cleanup(root)
    }
  }
})

test('a manifest with no effort capability closes with a null receipt effort, never the assumed flag', () => {
  const { root, change } = repo()
  try {
    startWithHost(root, change, 'claude', { worktree: 'driver' })
    // A manifest written before the key existed.
    const manifest = manifestOf(root)
    delete manifest.host.effort
    file(root, '.claude/ship/run.json', manifest)
    run(root, ['run', 'close', '--halt', 'stopped for the test'], { expectExit: 1 })
    const receipt = receiptOf(root)
    assert.ok(receipt.host && 'effort' in receipt.host, 'the receipt host block carries an effort key')
    assert.equal(receipt.host.effort, null, 'not recorded, never the assumed flag')
  } finally {
    cleanup(root)
  }
})

// --- the Workflow host's environment, read by the CLI (spec: ship/run-program) ---
//
// The model-override policy used to live in `workflows/ship.js`: its validate
// ping ran `printenv CLAUDE_CODE_SUBAGENT_MODEL` and the driver decided the
// banner and the ping model. Since Claude Code 2.1.251 the plain variable sets
// only the DEFAULT subagent model, so on a current host that banner was false.
// `run start --host workflow` now reads the variables from its own environment
// and the host version from `claude --version`, and decides once.

const FAKE_CLAUDE = join(ROOT, 'test', 'fixtures', 'hosts', 'fake-claude.mjs')

/** Every routing variable, unset, so a developer's own export cannot change a result. */
const ROUTING_UNSET = Object.freeze({
  CLAUDE_CODE_SUBAGENT_MODEL: undefined,
  CLAUDE_CODE_SUBAGENT_MODEL_FORCE: undefined,
  CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS: undefined,
  CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: undefined,
  CLAUDE_CODE_USE_BEDROCK: undefined,
  AWS_BEDROCK: undefined
})

/** The child env for a workflow run against the fixture CLI at one version. */
function workflowEnv({ version = '2.1.288', fails = false, env = {} } = {}) {
  const mode = fails ? '--fixture-version-fails' : `--fixture-version=${version}`
  return { ...ROUTING_UNSET, INTERLOCK_CLAUDE_COMMAND: `node ${FAKE_CLAUDE} ${mode}`, ...env }
}

/** `run start --host workflow`, the way the Workflow driver calls it, and its relayed step. */
function startWorkflow(root, change, opts = {}) {
  return run(root, ['run', 'start', '--change', change, '--host', 'workflow'], { env: workflowEnv(opts) }).step
}

const overridden = banners => (banners || []).filter(b => String(b).startsWith('MODEL ROUTING OVERRIDDEN'))

test('a current host keeps haiku pings and raises no override banner for the plain subagent variable', () => {
  const { root, change } = repo()
  try {
    const step = startWorkflow(root, change, { env: { CLAUDE_CODE_SUBAGENT_MODEL: 'opus' } })
    assert.equal(step.action, 'classify')
    const manifest = manifestOf(root)
    assert.deepEqual(overridden(step.banners), [], 'the variable sets only the default on this host')
    assert.deepEqual(overridden(manifest.banners), [])
    assert.equal(step.pingModel, 'haiku')
    assert.equal(manifest.pingModel, 'haiku')
    assert.ok(
      manifest.notes.some(n =>
        /CLAUDE_CODE_SUBAGENT_MODEL=opus sets only the default subagent model on Claude Code 2\.1\.288/.test(n)
      ),
      `no default-only note: ${JSON.stringify(manifest.notes)}`
    )
  } finally {
    cleanup(root)
  }
})

test('an older host is bannered for the plain subagent variable and its pings carry no model', () => {
  const { root, change } = repo()
  try {
    const step = startWorkflow(root, change, { version: '2.1.250', env: { CLAUDE_CODE_SUBAGENT_MODEL: 'opus' } })
    const banner =
      'MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL=opus — every agent runs on that model, ' +
      'so the per-tier assignment in the plan is not in effect'
    assert.ok((step.banners || []).includes(banner), JSON.stringify(step.banners))
    assert.ok(manifestOf(root).banners.includes(banner), JSON.stringify(manifestOf(root).banners))
    assert.equal(step.pingModel ?? null, null, 'no ping model on an overridden host')
  } finally {
    cleanup(root)
  }
})

test('FORCE is bannered by name and refines the observed model selection to forced', () => {
  const { root, change } = repo()
  try {
    const step = startWorkflow(root, change, { env: { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' } })
    assert.ok(
      (step.banners || []).some(b =>
        b.startsWith('MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1 — every agent runs on one model')
      ),
      JSON.stringify(step.banners)
    )
    assert.equal(manifestOf(root).host.modelSelect, 'forced')
    assert.equal(step.pingModel ?? null, null)
  } finally {
    cleanup(root)
  }
})

test('an unreadable host version falls back to the override banner, says so, and does not halt', () => {
  const { root, change } = repo()
  try {
    const step = startWorkflow(root, change, { fails: true, env: { CLAUDE_CODE_SUBAGENT_MODEL: 'opus' } })
    assert.equal(step.action, 'classify', 'an ordinary first step, not a halt')
    const banner = overridden(step.banners)
    assert.equal(banner.length, 1, JSON.stringify(step.banners))
    assert.match(banner[0], /^MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL=opus/)
    assert.match(banner[0], /\(host version unknown\)/)
    assert.equal(manifestOf(root).hostEnv.version, null)
  } finally {
    cleanup(root)
  }
})

test('a Bedrock variable withholds the ping model, says so, and raises no override banner', () => {
  const { root, change } = repo()
  try {
    const step = startWorkflow(root, change, { env: { CLAUDE_CODE_USE_BEDROCK: '1' } })
    assert.equal(step.pingModel ?? null, null)
    assert.deepEqual(overridden(step.banners), [])
    assert.ok(
      manifestOf(root).notes.some(n => n.startsWith('PING MODEL INHERITED')),
      JSON.stringify(manifestOf(root).notes)
    )
  } finally {
    cleanup(root)
  }
})

test('the ping model rides the relay to the Workflow driver, and nowhere else is it decided', () => {
  assert.ok(RELAY_STEP_FIELDS.includes('pingModel'), 'the relay would drop the decided ping model')
  const { root, change } = repo()
  try {
    // `run` prints the relayed shape on the Workflow host; last-step.json holds the same bytes.
    const step = startWorkflow(root, change)
    assert.equal(step.pingModel, 'haiku')
    const onDisk = JSON.parse(readFileSync(join(root, LAST_STEP_PATH), 'utf8'))
    assert.equal(onDisk.pingModel, 'haiku')
    // A runner host gets the whole step and has no ping to set a model on.
    const runner = repo()
    try {
      const started = run(runner.root, [
        'run', 'start', '--change', runner.change, '--host', 'claude',
        '--host-capabilities', JSON.stringify({ worktree: 'driver' })
      ], { env: workflowEnv() }).step
      assert.equal(started.pingModel, undefined, 'the observation is the Workflow host\'s alone')
      assert.equal(manifestOf(runner.root).hostEnv, undefined)
    } finally {
      cleanup(runner.root)
    }
  } finally {
    cleanup(root)
  }
})

test('the runtime slot count is observed: the env override, the vendor default with CPUs, or invalid', () => {
  const cases = [
    [{ CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS: '4' }, { observed: 4, source: 'env' }],
    [{}, { observed: null, source: 'vendor-default', cpuCount: cpus().length }],
    [{ CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS: 'lots' }, { observed: null, source: 'vendor-default', invalid: 'lots' }]
  ]
  for (const [env, expected] of cases) {
    const { root, change } = repo()
    try {
      const step = startWorkflow(root, change, { env })
      assert.equal(step.action, 'classify', 'an invalid override is ignored, never a halt')
      const slots = manifestOf(root).runtimeSlots
      for (const [key, value] of Object.entries(expected)) {
        assert.deepEqual(slots[key], value, `${JSON.stringify(env)}: runtimeSlots.${key} in ${JSON.stringify(slots)}`)
      }
      assert.equal(slots.vendorDefault, 16)
      if (expected.invalid) {
        assert.ok(
          manifestOf(root).notes.some(n => n.includes('CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=lots')),
          'an ignored value is said out loud'
        )
      }
    } finally {
      cleanup(root)
    }
  }
})

test('a batch wider than an observed slot override is bannered and never resized', () => {
  const THREE_LANES = {
    tasks: [isolatedTask('1.1', 1, 'lib/a.mjs'), isolatedTask('1.2', 1, 'lib/b.mjs'), isolatedTask('1.3', 1, 'lib/c.mjs')]
  }
  const banner =
    'WAVE WIDER THAN RUNTIME SLOTS: the widest batch has 3 lanes and ' +
    'CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=2 — 1 lane queues for a slot; the plan is not resized'
  const narrow = isolatedRepo(THREE_LANES)
  try {
    const batch = startWithHost(narrow.root, narrow.change, 'workflow', { worktree: 'runtime' }, [], THREE_LANES, {
      env: workflowEnv({ env: { CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS: '2' } })
    })
    assert.ok((batch.banners || []).includes(banner), JSON.stringify(batch.banners))
    assert.ok(manifestOf(narrow.root).banners.includes(banner))
    assert.equal(batch.spawns.length, 3, 'every lane is still dispatched')
    const state = JSON.parse(readFileSync(join(narrow.root, '.claude/ship/state.json'), 'utf8'))
    const widest = Math.max(...state.waves.flatMap(w => w.batches.map(b => b.length)))
    assert.equal(widest, 3, 'the plan is not resized to the observed slots')
  } finally {
    cleanup(narrow.root)
  }
  const wide = isolatedRepo(THREE_LANES)
  try {
    const batch = startWithHost(wide.root, wide.change, 'workflow', { worktree: 'runtime' }, [], THREE_LANES, {
      env: workflowEnv({ env: { CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS: '4' } })
    })
    assert.ok(!(batch.banners || []).some(b => b.startsWith('WAVE WIDER THAN RUNTIME SLOTS')))
    assert.ok(!manifestOf(wide.root).banners.some(b => b.startsWith('WAVE WIDER THAN RUNTIME SLOTS')))
  } finally {
    cleanup(wide.root)
  }
})

test('the manifest records the session the run started under, on the Workflow host only', () => {
  const workflow = repo()
  try {
    startWithHost(workflow.root, workflow.change, 'workflow', { worktree: 'runtime' }, [], CLASSIFIED, {
      env: workflowEnv({ env: { CLAUDE_CODE_SESSION_ID: 'sess-abc-123' } })
    })
    assert.equal(manifestOf(workflow.root).sessionId, 'sess-abc-123')
    assert.equal(runStartEvent(workflow.root).sessionId, 'sess-abc-123', 'the same value the trajectory holds')
  } finally {
    cleanup(workflow.root)
  }
  const runner = repo()
  try {
    startWithHost(runner.root, runner.change, 'claude', { worktree: 'driver' }, [], CLASSIFIED, {
      env: { CLAUDE_CODE_SESSION_ID: 'the-shell-that-launched-the-runner' }
    })
    assert.equal(manifestOf(runner.root).sessionId, undefined)
  } finally {
    cleanup(runner.root)
  }
})

// --- interrupted-run notes (spec: ship/run-program — run start speaks them) ---

function plantNote(root, name, fields) {
  return file(root, `.claude/ship/interrupted/${name}`, {
    schema: 'interlock.interrupted/1',
    sessionId: 'sess-9',
    reason: 'other',
    at: '2026-10-05T00:00:00.000Z',
    spokenAt: null,
    ...fields
  })
}

const noteBanner = (change, runId, stage) =>
  `PREVIOUS RUN INTERRUPTED: ${change} run ${runId} ended at stage ${stage} — ` +
  `no resume card was written; interlock run-log show ${runId}`

test('run start speaks an unspoken interrupted-run note once and marks it spoken', () => {
  const { root, change } = repo()
  try {
    const path = plantNote(root, 'r-1.json', { runId: 'r-1', change: 'add-foo', stage: 'remediation' })
    const step = run(root, ['run', 'start', '--change', change]).step
    const banner = noteBanner('add-foo', 'r-1', 'remediation')
    assert.ok((step.banners || []).includes(banner), JSON.stringify(step.banners))
    assert.ok(manifestOf(root).banners.includes(banner))
    assert.equal(typeof JSON.parse(readFileSync(path, 'utf8')).spokenAt, 'string', 'the note is marked spoken')

    // Spoken once: the next start is silent about it.
    const again = run(root, ['run', 'start', '--change', change]).step
    assert.ok(!(again.banners || []).some(b => b.startsWith('PREVIOUS RUN INTERRUPTED')))
  } finally {
    cleanup(root)
  }
})

test('a spoken note is silent and two unspoken notes are two banners', () => {
  const { root, change } = repo()
  try {
    plantNote(root, 'r-0.json', { runId: 'r-0', change: 'add-foo', stage: 'verify', spokenAt: '2026-10-04T00:00:00.000Z' })
    plantNote(root, 'r-1.json', { runId: 'r-1', change: 'add-foo', stage: 'implement' })
    plantNote(root, 'r-2.json', { runId: 'r-2', change: 'add-bar', stage: 'review' })
    const step = run(root, ['run', 'start', '--change', change]).step
    const spoken = (step.banners || []).filter(b => b.startsWith('PREVIOUS RUN INTERRUPTED'))
    assert.deepEqual(spoken.sort(), [noteBanner('add-bar', 'r-2', 'review'), noteBanner('add-foo', 'r-1', 'implement')].sort())
  } finally {
    cleanup(root)
  }
})

test('an unreadable note becomes a manifest note and the run proceeds', () => {
  const { root, change } = repo()
  try {
    file(root, '.claude/ship/interrupted/bad.json', '{ not json')
    const step = run(root, ['run', 'start', '--change', change]).step
    assert.equal(step.action, 'classify', 'an ordinary first step, not a halt')
    assert.ok(
      manifestOf(root).notes.some(n => /^INTERRUPTED NOTE UNREADABLE: .*bad\.json: /.test(n)),
      JSON.stringify(manifestOf(root).notes)
    )
  } finally {
    cleanup(root)
  }
})

// --- D1's table, asserted on the pure decision ---------------------------------

test('decideHostEnvironment reads every row of the version-aware table', () => {
  const decide = (env, version) => decideHostEnvironment(observeClaudeEnv(env, { version, cpuCount: 8 }))
  const forceBanner = d => d.banners.find(b => b.startsWith('MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL_FORCE='))
  const plainBanner = d => d.banners.find(b => b.startsWith('MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL='))

  // The floors are named constants, and the table turns on them.
  assert.equal(SUBAGENT_MODEL_DEFAULT_ONLY_MIN_VERSION, '2.1.251')
  assert.equal(SUBAGENT_MODEL_FORCE_MIN_VERSION, '2.1.257')

  // Row 1: plain set, at or above the default-only floor — no banner, haiku, a note.
  for (const version of ['2.1.251', '2.1.288']) {
    const d = decide({ CLAUDE_CODE_SUBAGENT_MODEL: 'opus' }, version)
    assert.deepEqual(d.banners, [], version)
    assert.equal(d.pingModel, 'haiku')
    assert.ok(d.notes.some(n => n.startsWith('MODEL ROUTING NOTE: CLAUDE_CODE_SUBAGENT_MODEL=opus sets only the default')))
    assert.notEqual(d.modelSelect, 'forced')
  }

  // Row 2: plain set, below the floor or unreadable — today's banner, no ping model.
  const older = decide({ CLAUDE_CODE_SUBAGENT_MODEL: 'opus' }, '2.1.250')
  assert.ok(plainBanner(older))
  assert.doesNotMatch(plainBanner(older), /host version unknown/)
  assert.equal(older.pingModel, null)
  const unknown = decide({ CLAUDE_CODE_SUBAGENT_MODEL: 'opus' }, null)
  assert.match(plainBanner(unknown), /\(host version unknown\)/)
  assert.equal(unknown.pingModel, null)

  // Row 3: FORCE set, at or above its floor or unreadable — the FORCE banner, forced.
  for (const version of ['2.1.257', '2.1.288', null]) {
    const d = decide({ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' }, version)
    assert.match(forceBanner(d), /every agent runs on one model \(the host's default\)/)
    assert.equal(d.modelSelect, 'forced', String(version))
    assert.equal(d.pingModel, null)
    assert.equal(plainBanner(d), undefined)
  }
  assert.match(forceBanner(decide({ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' }, null)), /host version unknown/)
  const forcedOpus = decide({ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1', CLAUDE_CODE_SUBAGENT_MODEL: 'opus' }, '2.1.288')
  assert.match(forceBanner(forcedOpus), /every agent runs on one model \(opus\)/)
  assert.equal(forcedOpus.banners.length, 1, 'one banner for one override')

  // Row 4: FORCE below its floor is inert, and the plain-variable row applies.
  const inertNew = decide({ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1', CLAUDE_CODE_SUBAGENT_MODEL: 'opus' }, '2.1.255')
  assert.equal(forceBanner(inertNew), undefined)
  assert.notEqual(inertNew.modelSelect, 'forced')
  assert.equal(inertNew.pingModel, 'haiku', '2.1.255 is above the default-only floor')
  assert.ok(inertNew.notes.some(n => /CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1 has no effect on Claude Code 2\.1\.255/.test(n)))
  const inertOld = decide({ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1', CLAUDE_CODE_SUBAGENT_MODEL: 'opus' }, '2.1.250')
  assert.ok(plainBanner(inertOld))
  assert.equal(inertOld.pingModel, null)

  // Row 5: nothing set — nothing said, haiku.
  const clean = decide({}, '2.1.288')
  assert.deepEqual(clean.banners, [])
  assert.deepEqual(clean.notes, [])
  assert.equal(clean.pingModel, 'haiku')

  // Bedrock: the ping inherits, said as a note; the teams variable raises nothing.
  for (const value of ['1', 'true']) {
    const bedrock = decide({ CLAUDE_CODE_USE_BEDROCK: value }, '2.1.288')
    assert.equal(bedrock.pingModel, null)
    assert.ok(bedrock.notes.some(n => n.startsWith('PING MODEL INHERITED')))
  }
  for (const value of ['0', 'false', '']) {
    assert.equal(decide({ AWS_BEDROCK: value }, '2.1.288').pingModel, 'haiku', `AWS_BEDROCK=${value}`)
  }
  const teams = decide({ CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' }, '2.1.288')
  assert.deepEqual(teams.banners, [])
  assert.equal(teams.pingModel, 'haiku')
})

// ============================================================================
// What the host observed about each agent, and where a run's records go
// (observe-agents-and-resolve-state-home, task 1.8).
//
// Every case below drives the REAL binary in a temporary root, because the two
// things under test — the close's join of the recorder's sidecar to the spawns
// this program dispatched, and the state home `run start` records once and every
// later subcommand reads back — both live in the hand-off between separate
// `interlock run` processes. An in-process call would hold the manifest in
// memory across steps and prove nothing about what the next process reads.
// ============================================================================

/** Any `interlock` command; the exit code is returned rather than asserted. */
function cli(cwd, argv, { results, hostRecords, env = {}, json = true } = {}) {
  const full = [...argv]
  if (results !== undefined) {
    file(cwd, '.claude/ship/results.json', results)
    full.push('--results', '.claude/ship/results.json')
  }
  if (hostRecords !== undefined) {
    file(cwd, '.claude/ship/host-records.json', hostRecords)
    full.push('--host-records', '.claude/ship/host-records.json')
  }
  if (json) full.push('--json')
  const r = spawnSync(process.execPath, [BIN, ...full], {
    cwd,
    encoding: 'utf8',
    // A developer's own export must not move a test's corpora somewhere else.
    env: { ...process.env, INTERLOCK_STATE_HOME: undefined, ...env }
  })
  assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.message}`)
  const stdout = r.stdout || ''
  return { step: json && stdout.trim() ? JSON.parse(stdout) : null, code: r.status, stdout, stderr: r.stderr || '' }
}

/** `cli`, asserting a zero exit — every `run` step but a halted close exits 0. */
function step0(cwd, argv, opts) {
  const r = cli(cwd, argv, opts)
  assert.equal(r.code, 0, `interlock ${argv.join(' ')} exited ${r.code}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`)
  return r.step
}

/** One trajectory's events, read under the home it was written to. */
function eventsAt(home, runId) {
  return readFileSync(join(home, '.claude', 'ship', 'runs', `${runId}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
}

const receiptAt = (home, runId) => eventsAt(home, runId).find(e => e.type === 'run-receipt')
const anyStartsWith = (list, prefix) => (list || []).some(b => String(b).startsWith(prefix))
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0
const OBSERVATION_COUNTS = [
  'lanesStoppedByHost',
  'schemaResultsMissing',
  'toolsDeniedInLanes',
  'modelSubstitutions',
  'permissionPrompts',
  'autoModeDenials'
]

/** The lanes of the batch the run state says is pending — what the CLI aligns `results[i]` with. */
function pendingLanes(root) {
  const pending = nextStep(JSON.parse(readFileSync(join(root, '.claude/ship/state.json'), 'utf8')))
  const batches =
    Array.isArray(pending.remainingBatches) && pending.remainingBatches.length
      ? pending.remainingBatches
      : [Array.isArray(pending.tasks) ? pending.tasks : []]
  return batches[0] || []
}

/** A lane's result: the single-task shape, or per-task outcomes for a fused lane. */
function laneResult(lane, usage) {
  const ids = lane.map(t => t.id)
  const extra = usage ? { usage } : {}
  if (ids.length === 1) {
    const [task] = laneOk(ids).tasks
    return { ok: true, id: task.id, filesChanged: task.filesChanged, handoff: task.handoff, ...extra }
  }
  return { ...laneOk(ids), ...extra }
}

// --- the Workflow host's join (ship/agent-results) ---------------------------

const JOIN_TASKS =
  '# Tasks\n\n- [ ] 1.1 Edit src/a.ts\n- [ ] 1.2 Edit src/b.ts\n\n- [ ] 2.1 Edit src/c.ts\n- [ ] 2.2 Edit src/d.ts\n'

// Two tier-4 lanes in wave 1 and one chain-fused lane in wave 2: three briefed
// spawns, the shape the agent-results scenarios name. Wave 2 carries two tasks
// because a one-task wave is folded into the wave before it.
const JOIN_CLASSIFIED = {
  tasks: [
    { id: '1.1', group: 1, description: 'a', tier: 4, model: 'sonnet', isTestTask: false, paths: ['src/a.ts'] },
    { id: '1.2', group: 1, description: 'b', tier: 4, model: 'sonnet', isTestTask: false, paths: ['src/b.ts'] },
    { id: '2.1', group: 2, description: 'c', tier: 2, model: 'sonnet', isTestTask: false, paths: ['src/c.ts'] },
    { id: '2.2', group: 2, description: 'd', tier: 2, model: 'sonnet', isTestTask: false, paths: ['src/d.ts'] }
  ]
}

/** What each briefed spawn's transcript summed to, by dispatch order. */
const USAGE_BY_SPAWN = [
  { inputTokens: 11, outputTokens: 101, cacheReadInputTokens: 1000, cacheCreationInputTokens: { ephemeral_5m: 400, ephemeral_1h: 2 } },
  { inputTokens: 12, outputTokens: 102, cacheReadInputTokens: 500, cacheCreationInputTokens: { ephemeral_5m: 100, ephemeral_1h: 3 } },
  { inputTokens: 13, outputTokens: 103, cacheReadInputTokens: 250, cacheCreationInputTokens: { ephemeral_5m: 50, ephemeral_1h: 1 } }
]

/**
 * A Workflow-host run walked through both waves to the final verification, with
 * the dispatched spawns it recorded. Each lane result carries seven output
 * tokens, so the output figures the join must leave alone are known.
 */
function workflowThroughWaves() {
  const { root, change } = repo('add-thing', { tasks: JOIN_TASKS })
  const env = workflowEnv()
  let step = startWithHost(root, change, 'workflow', { worktree: 'runtime' }, [], JOIN_CLASSIFIED, { env })
  for (let guard = 0; step.action !== 'verify-final'; guard++) {
    assert.ok(guard < 12, 'the walk did not reach the final verification')
    assert.notEqual(step.action, 'halt', `the walk halted: ${step.reason}`)
    step =
      step.action === 'run-batch'
        ? step0(root, step.then.argv, {
            results: pendingLanes(root).map(lane => laneResult(lane, { outputTokens: 7 })),
            env
          })
        : step0(root, step.then.argv, { env })
  }
  const manifest = manifestOf(root)
  const briefed = manifest.dispatched.filter(d => typeof d.sha === 'string' && d.sha)
  assert.deepEqual(
    briefed.map(d => [d.wave, d.kind]),
    [[1, 'implementer'], [1, 'implementer'], [2, 'implementer']],
    'the fixture is two briefed lanes in wave 1 and one in wave 2'
  )
  return { root, change, env, runId: manifest.runId, briefed }
}

/** One agent file, in the shape the SubagentStop recorder writes (lib/agent-usage.mjs). */
function plantAgent(root, runId, agentId, { sha = null, models = ['claude-sonnet-5-5'], usage = null, turns = 3 } = {}) {
  return file(root, `.claude/ship/agent-usage/${runId}/${agentId}.json`, {
    schema: 'interlock.agent-usage/1',
    agentId,
    agentType: 'workflow-subagent',
    startedAt: '2026-10-05T09:00:00.000Z',
    stoppedAt: '2026-10-05T09:05:00.000Z',
    briefingSha: sha,
    models,
    turns,
    usage,
    transcript: { path: `/home/user/.claude/projects/-home-user-repo/agent-${agentId}.jsonl`, parsed: true, reason: null }
  })
}

/** One agent file per briefed spawn, keyed by its sha, except the dispatch indices in `skip`. */
function plantJoined(run, { skip = [], models = () => ['claude-sonnet-5-5'], usage = i => USAGE_BY_SPAWN[i] } = {}) {
  run.briefed.forEach((spawned, i) => {
    if (skip.includes(i)) return
    plantAgent(run.root, run.runId, `agent-${i}`, { sha: spawned.sha, models: models(spawned, i), usage: usage(i) })
  })
}

/** One permission file, in the shape the permission recorder writes. */
function plantPermission(root, runId, kind, seq, { tool = 'Bash', reason = null } = {}) {
  const at = '2026-10-05T09:01:00.000Z'
  return file(root, `.claude/ship/agent-usage/${runId}/permission-${kind}-${Date.parse(at)}-4242-${seq}.json`, {
    schema: 'interlock.agent-usage/1',
    kind,
    at,
    agentId: 'agent-0',
    tool,
    reason
  })
}

const closeWorkflow = (run, extra = []) => cli(run.root, ['run', 'close', ...extra], { env: run.env })

test('a complete join records per-wave cache figures, observes cache accounting as hook, and one agent-result per agent', () => {
  const r = workflowThroughWaves()
  try {
    plantJoined(r)
    const closed = closeWorkflow(r)
    assert.equal(closed.code, 0, closed.stderr)
    assert.doesNotMatch(closed.step.summary, /CACHE ACCOUNTING NOT REPORTED/)
    assert.doesNotMatch(closed.step.summary, /CACHE ACCOUNTING PARTIAL/)

    // Observed only, never declared: the manifest and the receipt both say hook.
    assert.equal(manifestOf(r.root).host.cacheAccounting, 'hook')
    const receipt = receiptOf(r.root)
    assert.equal(receipt.host.cacheAccounting, 'hook')

    // Per wave and for the run, tiers kept apart. Output tokens are the results'
    // own figures (7 per lane) — the agents' 101/102/103 never replace them.
    assert.deepEqual(receipt.spend, [
      { wave: '1', outputTokens: 14, cacheReadInputTokens: 1500, cacheCreationInputTokens: { ephemeral_5m: 500, ephemeral_1h: 5 } },
      { wave: '2', outputTokens: 7, cacheReadInputTokens: 250, cacheCreationInputTokens: { ephemeral_5m: 50, ephemeral_1h: 1 } }
    ])
    assert.equal(receipt.outputTokens, 21, 'the join leaves output tokens as the results reported them')
    assert.equal(receipt.cacheReadInputTokens, 1750)
    assert.deepEqual(receipt.cacheCreationInputTokens, { ephemeral_5m: 550, ephemeral_1h: 6 })

    // One agent-result per joined agent, from the transcript, before the receipt.
    const events = eventsAt(r.root, r.runId)
    const results = events.filter(e => e.type === 'agent-result')
    assert.equal(results.length, 3)
    r.briefed.forEach((spawned, i) => {
      const event = results.find(e => e.agentId === `agent-${i}`)
      assert.ok(event, `no agent-result for agent-${i}`)
      assert.equal(event.source, 'transcript')
      assert.equal(event.label, spawned.label)
      assert.equal(event.kind, 'implementer')
      assert.equal(event.modelRouted, spawned.model)
      assert.deepEqual(event.servedModels, ['claude-sonnet-5-5'])
      assert.equal(event.modelScope, 'turns')
      assert.equal(event.substituted, false)
      assert.equal(event.numTurns, 3)
      assert.deepEqual(event.usage, USAGE_BY_SPAWN[i])
    })
    const lastResult = events.map(e => e.type).lastIndexOf('agent-result')
    assert.ok(lastResult < events.findIndex(e => e.type === 'run-receipt'), 'agent-results precede the receipt')

    // A sidecar with agent files and no permission file: no permission banner,
    // and the counts are measured zeros, not absent.
    assert.ok(!anyStartsWith(closed.step.banners, 'PERMISSION PROMPTS DURING RUN'))
    assert.ok(!anyStartsWith(closed.step.banners, 'AUTO MODE DENIED'))
    for (const key of OBSERVATION_COUNTS) assert.equal(receipt[key], 0, `${key} is a measured zero`)
  } finally {
    cleanup(r.root)
  }
})

test('one unjoined lane leaves its wave absent, names the count, and keeps the declared false', () => {
  const r = workflowThroughWaves()
  try {
    plantJoined(r, { skip: [1] })
    const closed = closeWorkflow(r)
    assert.equal(closed.code, 0, 'a partial recording never moves the exit code')
    assert.ok(
      closed.step.banners.includes('CACHE ACCOUNTING PARTIAL: 1 of 3 agents unrecorded'),
      JSON.stringify(closed.step.banners)
    )
    assert.match(closed.step.summary, /CACHE ACCOUNTING PARTIAL: 1 of 3 agents unrecorded/)

    const receipt = receiptOf(r.root)
    assert.deepEqual(receipt.spend[0], { wave: '1', outputTokens: 14, cacheReadInputTokens: null, cacheCreationInputTokens: null })
    assert.deepEqual(receipt.spend[1], {
      wave: '2',
      outputTokens: 7,
      cacheReadInputTokens: 250,
      cacheCreationInputTokens: { ephemeral_5m: 50, ephemeral_1h: 1 }
    })
    assert.equal(receipt.cacheReadInputTokens, null, 'one unrecorded agent makes the run total unknown')
    assert.equal(receipt.cacheCreationInputTokens, null)

    assert.equal(manifestOf(r.root).host.cacheAccounting, false, 'a partial join keeps the declared value')
    assert.equal(receipt.host.cacheAccounting, false)
    assert.equal(eventsAt(r.root, r.runId).filter(e => e.type === 'agent-result').length, 2)
  } finally {
    cleanup(r.root)
  }
})

test('a recorded agent no spawn dispatched is counted apart, split by why, and joins no wave', () => {
  const r = workflowThroughWaves()
  try {
    plantJoined(r)
    // A relay ping carries no bootstrap and so no key; a stray carries a key
    // nothing here dispatched. Both carry figures that would show in any sum.
    const huge = { inputTokens: 9, outputTokens: 9, cacheReadInputTokens: 900000, cacheCreationInputTokens: { ephemeral_5m: 90000, ephemeral_1h: 9000 } }
    plantAgent(r.root, r.runId, 'ping-agent', { sha: null, usage: huge, models: ['claude-haiku-4-5'] })
    plantAgent(r.root, r.runId, 'stray-agent', { sha: 'f'.repeat(64), usage: huge, models: ['claude-haiku-4-5'] })

    const closed = closeWorkflow(r)
    assert.equal(closed.code, 0)
    const note =
      'AGENT USAGE UNJOINED: 2 recorded agents matched no dispatched spawn ' +
      '(1 without a briefing key, 1 with a key no spawn dispatched)'
    assert.ok(manifestOf(r.root).notes.includes(note), JSON.stringify(manifestOf(r.root).notes))
    assert.ok(closed.step.summary.includes(note))

    const receipt = receiptOf(r.root)
    assert.deepEqual(
      receipt.spend.map(s => [s.wave, s.cacheReadInputTokens]),
      [['1', 1500], ['2', 250]],
      'the unjoined agents contribute to no wave'
    )
    assert.equal(receipt.cacheReadInputTokens, 1750, 'nor to the run')
    assert.equal(manifestOf(r.root).host.cacheAccounting, 'hook', 'the briefed spawns all joined')
    const results = eventsAt(r.root, r.runId).filter(e => e.type === 'agent-result')
    assert.equal(results.length, 3)
    assert.ok(!results.some(e => e.agentId === 'ping-agent' || e.agentId === 'stray-agent'))
    assert.ok(!anyStartsWith(closed.step.banners, 'MODEL SUBSTITUTED'), 'an unjoined agent is compared against nothing')
  } finally {
    cleanup(r.root)
  }
})

test('a total-only cache-creation tier makes its wave\'s tiers unknown and records no zero', () => {
  const r = workflowThroughWaves()
  try {
    plantJoined(r, {
      usage: i => (i === 1 ? { ...USAGE_BY_SPAWN[1], cacheCreationInputTokens: { total: 103 } } : USAGE_BY_SPAWN[i])
    })
    const closed = closeWorkflow(r)
    assert.equal(closed.code, 0)
    const receipt = receiptOf(r.root)
    // 402 from the split agent plus 103 from the total-only one: the total is
    // known, the split is not — and no tier is filled in as zero.
    assert.deepEqual(receipt.spend[0], { wave: '1', outputTokens: 14, cacheReadInputTokens: 1500, cacheCreationInputTokens: { total: 505 } })
    assert.deepEqual(receipt.spend[1].cacheCreationInputTokens, { ephemeral_5m: 50, ephemeral_1h: 1 })
    assert.deepEqual(receipt.cacheCreationInputTokens, { total: 556 })
    assert.doesNotMatch(closed.step.summary, /CACHE ACCOUNTING PARTIAL/)
  } finally {
    cleanup(r.root)
  }
})

test('a Workflow run with no agent-usage directory is not reported, and its six counts are absent', () => {
  const r = workflowThroughWaves()
  try {
    const closed = closeWorkflow(r)
    assert.equal(closed.code, 0)
    assert.match(closed.step.summary, /CACHE ACCOUNTING NOT REPORTED/)
    assert.doesNotMatch(closed.step.summary, /CACHE ACCOUNTING PARTIAL/)
    assert.doesNotMatch(closed.step.summary, /AGENT USAGE UNJOINED/)
    assert.equal(manifestOf(r.root).host.cacheAccounting, false)
    const receipt = receiptOf(r.root)
    assert.equal(receipt.host.cacheAccounting, false)
    for (const key of OBSERVATION_COUNTS) assert.equal(receipt[key], null, `${key} is absent, not zero`)
    assert.equal(eventsAt(r.root, r.runId).filter(e => e.type === 'agent-result').length, 0)
  } finally {
    cleanup(r.root)
  }
})

test('a joined agent another model served is bannered; one its own alias served is not', () => {
  const r = workflowThroughWaves()
  try {
    plantJoined(r, {
      models: (_, i) => (i === 0 ? ['claude-opus-5-5'] : i === 1 ? ['claude-sonnet-5-5'] : ['claude-sonnet-5-5-20261001'])
    })
    const closed = closeWorkflow(r)
    assert.equal(closed.code, 0, 'a substitution is a banner, never an exit code')
    const [first] = r.briefed
    assert.equal(first.model, 'sonnet')
    const expected = `MODEL SUBSTITUTED: ${first.label} routed sonnet, ran claude-opus-5-5`
    const substituted = closed.step.banners.filter(b => b.startsWith('MODEL SUBSTITUTED'))
    assert.deepEqual(substituted, [expected])
    assert.ok(closed.step.summary.includes(expected))

    const results = eventsAt(r.root, r.runId).filter(e => e.type === 'agent-result')
    const byAgent = id => results.find(e => e.agentId === id)
    assert.equal(byAgent('agent-0').substituted, true)
    assert.equal(byAgent('agent-0').modelScope, 'turns')
    assert.deepEqual(byAgent('agent-0').servedModels, ['claude-opus-5-5'])
    assert.equal(byAgent('agent-1').substituted, false)
    assert.equal(byAgent('agent-2').substituted, false, 'a date stamp is not a different model')
    assert.equal(receiptOf(r.root).modelSubstitutions, 1)
  } finally {
    cleanup(r.root)
  }
})

test('permission files are counted and bannered, and an unreadable one is named while the rest still count', () => {
  const r = workflowThroughWaves()
  try {
    plantJoined(r)
    plantPermission(r.root, r.runId, 'request', 1, { tool: 'Write' })
    plantPermission(r.root, r.runId, 'denied', 2, { tool: 'Bash', reason: 'auto mode classifier' })
    plantPermission(r.root, r.runId, 'denied', 3, { tool: 'Bash', reason: 'auto mode classifier' })
    const bad = `.claude/ship/agent-usage/${r.runId}/permission-denied-${Date.parse('2026-10-05T09:02:00.000Z')}-4242-9.json`
    file(r.root, bad, '{ not json')

    const closed = closeWorkflow(r)
    assert.equal(closed.code, 0, 'the exit code is the run outcome alone')
    assert.ok(closed.step.banners.includes('PERMISSION PROMPTS DURING RUN: 1'), JSON.stringify(closed.step.banners))
    assert.ok(closed.step.banners.includes('AUTO MODE DENIED 2 TOOL CALLS (Bash)'), JSON.stringify(closed.step.banners))
    const receipt = receiptOf(r.root)
    assert.equal(receipt.permissionPrompts, 1)
    assert.equal(receipt.autoModeDenials, 2)

    const named = manifestOf(r.root).notes.filter(n => n.startsWith(`AGENT USAGE UNREADABLE: ${bad}: `))
    assert.equal(named.length, 1, `the unreadable file is noted by name: ${JSON.stringify(manifestOf(r.root).notes)}`)
    assert.ok(closed.step.summary.includes(`AGENT USAGE UNREADABLE: ${bad}: `))
  } finally {
    cleanup(r.root)
  }
})

test('an agent-result the close cannot append exits 1 and leaves the run unreconstructable', { skip: IS_ROOT && 'chmod does not bind root' }, () => {
  const r = workflowThroughWaves()
  const dir = join(r.root, '.claude', 'ship', 'runs')
  const trajectory = join(dir, `${r.runId}.jsonl`)
  try {
    plantJoined(r)
    chmodSync(trajectory, 0o444)
    chmodSync(dir, 0o555)
    let closed
    try {
      closed = closeWorkflow(r)
    } finally {
      chmodSync(dir, 0o755)
      chmodSync(trajectory, 0o644)
    }
    assert.equal(closed.code, 1, 'the agent-result is the trajectory\'s fatal class')
    assert.equal(closed.step.exitCode, 1)
    assert.ok(
      anyStartsWith(closed.step.banners, `TRAJECTORY APPEND FAILED: agent-result ${r.briefed[0].label}: `),
      JSON.stringify(closed.step.banners)
    )
    assert.ok(anyStartsWith(closed.step.banners, 'RUN NOT RECONSTRUCTABLE'), JSON.stringify(closed.step.banners))
    assert.equal(eventsAt(r.root, r.runId).filter(e => e.type === 'agent-result').length, 0)
  } finally {
    cleanup(r.root)
  }
})

// --- the runner's host records (ship/agent-results) --------------------------

const FOUR_TASKS =
  '# Tasks\n\n- [ ] 1.1 Edit src/a.ts\n- [ ] 1.2 Edit src/b.ts\n- [ ] 1.3 Edit src/c.ts\n- [ ] 1.4 Edit src/d.ts\n'

const FOUR_LANES = {
  tasks: ['a', 'b', 'c', 'd'].map((x, i) => ({
    id: `1.${i + 1}`,
    group: 1,
    description: x,
    tier: 4,
    model: 'sonnet',
    isTestTask: false,
    paths: [`src/${x}.ts`]
  }))
}

/** A host record as `bin/interlock-run` forwards it: `{ label, ...host }` (design D7). */
function hostRecord(label, over = {}) {
  return {
    label,
    parsed: true,
    subtype: 'success',
    isError: false,
    terminalReason: 'completed',
    errors: [],
    permissionDenials: { count: 0, tools: [] },
    sessionId: `sess-lane-${label.replace(/\W/g, '-')}`,
    numTurns: 4,
    sessionModels: ['bedrock.claude-sonnet-5'],
    servedModels: ['claude-sonnet-5-5'],
    modelRouted: 'sonnet',
    resultMissing: false,
    usage: {
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadInputTokens: 9000,
      cacheCreationInputTokens: { ephemeral_5m: 700, ephemeral_1h: 0 }
    },
    hostCostUsd: 0.0421,
    exitCode: 0,
    timedOut: false,
    ...over
  }
}

const RUNNER_CAPS = { worktree: 'driver', usage: true, cacheAccounting: true }

test('runner host records reach the CLI on their own channel, and the CLI names each lane', () => {
  const { root, change } = repo('add-thing', { tasks: FOUR_TASKS })
  try {
    const batch = startWithHost(root, change, 'claude', RUNNER_CAPS, [], FOUR_LANES)
    assert.deepEqual(batch.spawns.map(s => s.label), ['1.1', '1.2', '1.3', '1.4'])
    const runId = manifestOf(root).runId
    const before = eventsAt(root, runId).length

    const records = [
      hostRecord('1.1', {
        subtype: 'error_max_turns',
        isError: true,
        terminalReason: 'max_turns',
        errors: ['Reached maximum number of turns (8)'],
        exitCode: 1
      }),
      hostRecord('1.2', { resultMissing: true }),
      // The transcript could not be read, so only the session scope is known —
      // and the host's own haiku call beside the routed sonnet is not a
      // substitution (design D6).
      hostRecord('1.3', {
        permissionDenials: { count: 2, tools: ['Bash', 'Edit'] },
        servedModels: null,
        sessionModels: ['bedrock.claude-sonnet-5', 'bedrock.claude-haiku-4-5'],
        // Whatever else a host hands over is not copied: fields go by name.
        toolInput: { command: 'rm -rf build' }
      }),
      hostRecord('1.4', { servedModels: ['claude-opus-5-5'] })
    ]
    // The stopped lane and the schema-less one return no result to the driver.
    const results = batch.lanes.map(lane => (['1.1', '1.2'].includes(lane[0].id) ? null : laneResult(lane)))
    step0(root, batch.then.argv, { results, hostRecords: records })

    const expected = [
      'LANE STOPPED BY HOST: 1.1 error_max_turns',
      'SCHEMA RESULT MISSING (claude): 1.2 — success without structured_output (anthropics/claude-code#82258)',
      'TOOLS DENIED IN LANE: 1.3 2 (Bash, Edit)',
      'MODEL SUBSTITUTED: 1.4 routed sonnet, ran claude-opus-5-5'
    ]
    const manifest = manifestOf(root)
    for (const banner of expected) assert.ok(manifest.banners.includes(banner), `missing ${banner}: ${JSON.stringify(manifest.banners)}`)
    assert.deepEqual(
      manifest.banners.filter(b => b.startsWith('MODEL SUBSTITUTED')),
      [expected[3]],
      'a session-scope breakdown the routed model served raises nothing'
    )
    assert.deepEqual(
      manifest.laneSessions.map(s => [s.label, s.sessionId]),
      [['1.1', 'sess-lane-1-1'], ['1.2', 'sess-lane-1-2'], ['1.3', 'sess-lane-1-3'], ['1.4', 'sess-lane-1-4']]
    )
    assert.match(manifest.laneSessions[0].outcome, /error_max_turns/)

    // The schema-less success is a failed lane; the denied and substituted ones returned.
    const tasks = readFileSync(join(root, `openspec/changes/${change}/tasks.md`), 'utf8')
    assert.match(tasks, /- \[ \] 1\.1 /)
    assert.match(tasks, /- \[ \] 1\.2 /)
    assert.match(tasks, /- \[x\] 1\.3 /)

    // One agent-result per record, from the envelope, appended before anything
    // else this record path wrote — the tick's own wave-action included.
    const appended = eventsAt(root, runId).slice(before)
    assert.deepEqual(
      appended.slice(0, 4).map(e => [e.type, e.label, e.source]),
      records.map(rec => ['agent-result', rec.label, 'envelope'])
    )
    assert.ok(appended.slice(4).some(e => e.type === 'wave-action'), 'the record path\'s own wave-action follows them')
    assert.ok(!appended.slice(4).some(e => e.type === 'agent-result'))
    const [stopped, missing, denied, swapped] = appended
    assert.equal(stopped.kind, 'implementer')
    assert.equal(stopped.subtype, 'error_max_turns')
    assert.equal(stopped.isError, true)
    assert.equal(stopped.terminalReason, 'max_turns')
    assert.deepEqual(stopped.errors, ['Reached maximum number of turns (8)'])
    assert.equal(stopped.sessionId, 'sess-lane-1-1')
    assert.equal(stopped.numTurns, 4)
    assert.equal(missing.resultMissing, true)
    assert.deepEqual(denied.permissionDenials, { count: 2, tools: ['Bash', 'Edit'] })
    assert.equal(denied.modelScope, 'session')
    assert.equal(denied.substituted, false)
    assert.equal(denied.servedModels, null)
    assert.deepEqual(denied.sessionModels, ['bedrock.claude-sonnet-5', 'bedrock.claude-haiku-4-5'])
    assert.equal('toolInput' in denied, false, 'a field not named in the event type is never copied')
    assert.doesNotMatch(JSON.stringify(appended), /rm -rf build/)
    assert.equal(swapped.modelRouted, 'sonnet')
    assert.equal(swapped.modelScope, 'turns')
    assert.equal(swapped.substituted, true)
    assert.deepEqual(swapped.servedModels, ['claude-opus-5-5'])
    assert.deepEqual(swapped.usage, {
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadInputTokens: 9000,
      cacheCreationInputTokens: { ephemeral_5m: 700, ephemeral_1h: 0 }
    })
    assert.equal(swapped.hostCostUsd, 0.0421)

    // Carried to the close and printed on a halt; the receipt counts them.
    const closed = cli(root, ['run', 'close', '--halt', 'stopped for the test'])
    assert.equal(closed.code, 1)
    for (const banner of expected) assert.ok(closed.step.summary.includes(banner), `the halt summary lost ${banner}`)
    const receipt = receiptOf(root)
    assert.deepEqual(
      Object.fromEntries(OBSERVATION_COUNTS.map(k => [k, receipt[k]])),
      {
        lanesStoppedByHost: 1,
        schemaResultsMissing: 1,
        toolsDeniedInLanes: 1,
        modelSubstitutions: 1,
        permissionPrompts: 0,
        autoModeDenials: 0
      }
    )

    // The resume card lists each lane with a recorded session and how to fork it.
    const card = readFileSync(join(root, '.claude', 'handoff', `ship-${change}-${runId}.md`), 'utf8')
    assert.match(card, /claude --resume sess-lane-1-1 --fork-session/)
    assert.match(card, /claude --resume sess-lane-1-2 --fork-session/)
  } finally {
    cleanup(root)
  }
})

test('a runner batch with no host records raises nothing and its receipt counts stay absent', () => {
  const { root, change } = repo('add-thing', { tasks: FOUR_TASKS })
  try {
    const batch = startWithHost(root, change, 'claude', RUNNER_CAPS, [], FOUR_LANES)
    step0(root, batch.then.argv, { results: batch.lanes.map(lane => laneResult(lane)) })
    const manifest = manifestOf(root)
    for (const prefix of ['LANE STOPPED BY HOST', 'SCHEMA RESULT MISSING', 'TOOLS DENIED IN LANE', 'MODEL SUBSTITUTED']) {
      assert.ok(!anyStartsWith(manifest.banners, prefix), `${prefix} raised with no host record`)
    }
    assert.deepEqual(manifest.laneSessions, [])
    assert.equal(eventsAt(root, manifest.runId).filter(e => e.type === 'agent-result').length, 0)

    const closed = cli(root, ['run', 'close', '--halt', 'stopped for the test'])
    assert.equal(closed.code, 1)
    const receipt = receiptOf(root)
    for (const key of OBSERVATION_COUNTS) assert.equal(receipt[key], null, `${key} is absent, not zero`)
  } finally {
    cleanup(root)
  }
})

test('on a host that declares cache accounting, a permission-only sidecar counts the prompt and joins no cache', () => {
  const { root, change } = repo('add-thing', { tasks: FOUR_TASKS })
  try {
    const batch = startWithHost(root, change, 'claude', RUNNER_CAPS, [], FOUR_LANES)
    // The runner's own envelopes carried cache figures; the hooks recorded no agent.
    const usage = { outputTokens: 10, cacheReadInputTokens: 900, cacheCreationInputTokens: { ephemeral_5m: 4, ephemeral_1h: 0 } }
    step0(root, batch.then.argv, { results: batch.lanes.map(lane => laneResult(lane, usage)) })
    const { runId } = manifestOf(root)
    plantPermission(root, runId, 'request', 1, { tool: 'Write' })

    const closed = cli(root, ['run', 'close', '--halt', 'stopped for the test'])
    assert.equal(closed.code, 1)
    assert.ok(closed.step.banners.includes('PERMISSION PROMPTS DURING RUN: 1'), JSON.stringify(closed.step.banners))
    assert.match(closed.step.summary, /PERMISSION PROMPTS DURING RUN: 1/)
    assert.doesNotMatch(closed.step.summary, /CACHE ACCOUNTING PARTIAL/, 'no runner spawn is "unrecorded" by a hook')
    assert.doesNotMatch(closed.step.summary, /AGENT USAGE UNJOINED/)

    const receipt = receiptOf(root)
    assert.equal(receipt.permissionPrompts, 1)
    assert.equal(receipt.autoModeDenials, 0)
    assert.equal(receipt.host.cacheAccounting, true, 'the declared value stands, never hook')
    assert.equal(manifestOf(root).host.cacheAccounting, true)
    // The runner's own counted figures are not overwritten by an empty join.
    assert.equal(receipt.spend[0].cacheReadInputTokens, 900 * batch.spawns.length)
    assert.deepEqual(receipt.spend[0].cacheCreationInputTokens, { ephemeral_5m: 4 * batch.spawns.length, ephemeral_1h: 0 })
    assert.equal(eventsAt(root, runId).filter(e => e.type === 'agent-result').length, 0)
  } finally {
    cleanup(root)
  }
})

test('an agent-result the record path cannot append halts the batch before any tick', { skip: IS_ROOT && 'chmod does not bind root' }, () => {
  const { root, change } = repo('add-thing', { tasks: FOUR_TASKS })
  try {
    const batch = startWithHost(root, change, 'claude', RUNNER_CAPS, [], FOUR_LANES)
    const { runId } = manifestOf(root)
    const dir = join(root, '.claude', 'ship', 'runs')
    const trajectory = join(dir, `${runId}.jsonl`)
    chmodSync(trajectory, 0o444)
    chmodSync(dir, 0o555)
    let halted
    try {
      halted = step0(root, batch.then.argv, {
        results: batch.lanes.map(lane => laneResult(lane)),
        hostRecords: batch.spawns.map(s => hostRecord(s.label))
      })
    } finally {
      chmodSync(dir, 0o755)
      chmodSync(trajectory, 0o644)
    }
    assert.equal(halted.action, 'halt')
    assert.match(halted.reason, /^trajectory append failed: agent-result: 1\.1: /)
    assert.deepEqual(halted.then.argv, ['run', 'close', '--halt', halted.reason], 'a halt still closes')
    const tasks = readFileSync(join(root, `openspec/changes/${change}/tasks.md`), 'utf8')
    assert.doesNotMatch(tasks, /- \[x\]/, 'no task is ticked past an unrecorded agent-result')
  } finally {
    cleanup(root)
  }
})

test('a fallback that served one turn is bannered with every turn-scoped id, and casing is ignored', () => {
  const { root, change } = repo('add-thing', { tasks: JOIN_TASKS })
  try {
    const batch = startWithHost(root, change, 'claude', RUNNER_CAPS, [], JOIN_CLASSIFIED)
    assert.deepEqual(batch.spawns.map(s => s.label), ['1.1', '1.2'])
    step0(root, batch.then.argv, {
      results: batch.lanes.map(lane => laneResult(lane)),
      hostRecords: [
        hostRecord('1.1', {
          modelRouted: 'claude-sonnet-5-5',
          servedModels: ['claude-sonnet-5-5-20261001', 'claude-sonnet-5']
        }),
        hostRecord('1.2', { modelRouted: 'Sonnet', servedModels: ['CLAUDE-SONNET-5-5'] })
      ]
    })
    assert.deepEqual(
      manifestOf(root).banners.filter(b => b.startsWith('MODEL SUBSTITUTED')),
      ['MODEL SUBSTITUTED: 1.1 routed claude-sonnet-5-5, ran claude-sonnet-5-5-20261001, claude-sonnet-5']
    )
  } finally {
    cleanup(root)
  }
})

test('the model-substitution banner is byte-identical on the Workflow host and the runner', () => {
  const wf = workflowThroughWaves()
  let fromWorkflow
  try {
    plantJoined(wf, { models: (_, i) => (i === 0 ? ['claude-opus-5-5'] : ['claude-sonnet-5-5']) })
    const closed = closeWorkflow(wf)
    assert.equal(closed.code, 0)
    fromWorkflow = closed.step.banners.filter(b => b.startsWith('MODEL SUBSTITUTED'))
  } finally {
    cleanup(wf.root)
  }

  const runner = repo('add-thing', { tasks: JOIN_TASKS })
  let fromRunner
  try {
    const batch = startWithHost(runner.root, runner.change, 'claude', RUNNER_CAPS, [], JOIN_CLASSIFIED)
    assert.deepEqual(batch.spawns.map(s => s.label), ['1.1', '1.2'])
    step0(runner.root, batch.then.argv, {
      results: batch.lanes.map(lane => laneResult(lane)),
      hostRecords: [hostRecord('1.1', { servedModels: ['claude-opus-5-5'] }), hostRecord('1.2')]
    })
    fromRunner = manifestOf(runner.root).banners.filter(b => b.startsWith('MODEL SUBSTITUTED'))
  } finally {
    cleanup(runner.root)
  }

  assert.deepEqual(fromWorkflow, ['MODEL SUBSTITUTED: 1.1 routed sonnet, ran claude-opus-5-5'])
  assert.deepEqual(fromRunner, fromWorkflow, 'one wording, whichever host observed the model')
})

// --- the state home (ship/state-home, ship/run-program) ----------------------

/** git with no global or system config, and discovery fenced at the temp directory. */
function gitFence() {
  return { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_CEILING_DIRECTORIES: realpathSync(tmpdir()) }
}

function gitIn(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...gitFence() } })
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}

/** The same ready change `repo()` writes, without the git around it. */
function writeChange(root, name, tasks) {
  const base = `openspec/changes/${name}`
  file(root, `${base}/proposal.md`, '# Add thing\n\nWhy: because.\n')
  file(root, `${base}/design.md`, '# Design\n\nD1: use the existing helper.\n')
  file(root, `${base}/tasks.md`, tasks ?? '# Tasks\n\n- [ ] 1.1 Add the thing to docs/guide.md\n- [ ] 1.2 Note it in README.md\n')
  file(root, 'README.md', 'hello\n')
}

/**
 * A main checkout holding one ready change, and a real linked worktree of it
 * where a Desktop worktree session lives (`<main>/.claude/worktrees/w1`). Both
 * paths come back real, because that is what the resolver records. `env` is
 * what every CLI call in these cases runs under: the fixture's git, fenced.
 */
function linkedWorktree(name = 'add-thing') {
  const tmp = mkdtempSync(join(tmpdir(), 'interlock-wt-'))
  const main = join(tmp, 'main')
  mkdirSync(main)
  writeChange(main, name)
  gitIn(main, ['init', '-q', '-b', 'main'])
  gitIn(main, ['config', 'user.email', 'test@example.com'])
  gitIn(main, ['config', 'user.name', 'test'])
  gitIn(main, ['add', '-A'])
  gitIn(main, ['commit', '-qm', 'init'])
  const worktree = join(main, '.claude', 'worktrees', 'w1')
  gitIn(main, ['worktree', 'add', '-q', worktree, '-b', 'w1'])
  return { tmp, main: realpathSync(main), worktree: realpathSync(worktree), change: name, env: gitFence() }
}

const PROFILE_PATH = join('.claude', 'testing', 'profile.json')
const GRAPH_PATH = join('.claude', 'graph', 'graph.json')
const NO_PROFILE_LINE = 'NO TEST PROFILE: run /interlock:fix-tests --reconfigure once'
const NO_GRAPH_LINE = 'GRAPH UNAVAILABLE: never built — implementer and reviewer agents fall back to grep and will be slower'
const INPUT_BANNERS = ['TEST PROFILE FROM MAIN CHECKOUT', 'GRAPH FROM MAIN CHECKOUT', 'NO TEST PROFILE', 'GRAPH UNAVAILABLE']

/** A profile whose unit command names where it was read from. */
const profileNaming = where => ({
  version: 1,
  unit: { command: `node --test test/${where}`, cwd: '.', single_file: 'node --test <path>' }
})

test('run start in a root holding a profile and a graph records both from the root and says nothing', () => {
  const { root, change } = repo()
  try {
    file(root, PROFILE_PATH, profileNaming('root'))
    file(root, GRAPH_PATH, { nodes: [], edges: [] })
    const started = step0(root, ['run', 'start', '--change', change])
    const real = realpathSync(root)
    const manifest = manifestOf(root)
    assert.equal(manifest.testProfilePath, join(real, PROFILE_PATH))
    assert.equal(manifest.testProfileSource, 'root')
    assert.equal(manifest.graphPath, join(real, GRAPH_PATH))
    assert.equal(manifest.graphSource, 'root')
    for (const prefix of INPUT_BANNERS) assert.ok(!anyStartsWith(started.banners, prefix), `${prefix} raised`)
  } finally {
    cleanup(root)
  }
})

test('a worktree without a profile or a graph reads the main checkout\'s, says so, and verifies from it', () => {
  const w = linkedWorktree()
  try {
    // Written after the worktree exists and never committed: what the
    // gitignored `.claude/testing` and `.claude/graph` look like in a real one.
    const profile = file(w.main, PROFILE_PATH, profileNaming('from-main-checkout'))
    file(w.main, GRAPH_PATH, { nodes: [], edges: [] })
    const profileBytes = readFileSync(profile, 'utf8')

    const started = step0(w.worktree, ['run', 'start', '--change', w.change], { env: w.env })
    assert.ok(
      started.banners.includes(`TEST PROFILE FROM MAIN CHECKOUT: ${join(w.main, PROFILE_PATH)}`),
      JSON.stringify(started.banners)
    )
    assert.ok(
      started.banners.includes(
        `GRAPH FROM MAIN CHECKOUT: ${join(w.main, GRAPH_PATH)} — it may be stale for this worktree; ` +
          'a lane without a graph falls back to grep'
      ),
      JSON.stringify(started.banners)
    )
    assert.ok(!anyStartsWith(started.banners, 'NO TEST PROFILE'))
    assert.ok(!anyStartsWith(started.banners, 'GRAPH UNAVAILABLE'))
    const manifest = manifestOf(w.worktree)
    assert.equal(manifest.testProfilePath, join(w.main, PROFILE_PATH))
    assert.equal(manifest.testProfileSource, 'state-home')
    assert.equal(manifest.graphPath, join(w.main, GRAPH_PATH))
    assert.equal(manifest.graphSource, 'state-home')

    // The verify step builds its plan from the recorded path.
    file(w.worktree, '.claude/ship/classified.json', CLASSIFIED)
    const batch = step0(w.worktree, started.then.argv, { env: w.env })
    const verify = step0(w.worktree, batch.then.argv, {
      results: batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id))),
      env: w.env
    })
    assert.equal(verify.action, 'verify-final')
    assert.equal(verify.skipped, false, 'the main checkout\'s profile names a unit command')
    assert.match(readFileSync(join(w.worktree, '.claude/ship/vplan-final.json'), 'utf8'), /test\/from-main-checkout/)

    // Read through, never copied, never rewritten.
    assert.equal(readFileSync(profile, 'utf8'), profileBytes)
    assert.equal(existsSync(join(w.worktree, PROFILE_PATH)), false)
    assert.equal(existsSync(join(w.worktree, '.claude', 'graph')), false)
  } finally {
    cleanup(w.tmp)
  }
})

test('with no profile and no graph anywhere, run start raises both missing-input lines itself', () => {
  const w = linkedWorktree()
  try {
    const started = step0(w.worktree, ['run', 'start', '--change', w.change], { env: w.env })
    assert.ok(started.banners.includes(NO_PROFILE_LINE), JSON.stringify(started.banners))
    assert.ok(started.banners.includes(NO_GRAPH_LINE), JSON.stringify(started.banners))
    assert.ok(!anyStartsWith(started.banners, 'TEST PROFILE FROM MAIN CHECKOUT'))
    assert.ok(!anyStartsWith(started.banners, 'GRAPH FROM MAIN CHECKOUT'))
    const manifest = manifestOf(w.worktree)
    assert.equal(manifest.testProfilePath, null)
    assert.equal(manifest.testProfileSource, 'none')
    assert.equal(manifest.graphPath, null)
    assert.equal(manifest.graphSource, 'none')
    assert.equal(existsSync(join(w.main, '.claude', 'testing')), false, 'nothing is written into the main checkout')
    assert.equal(existsSync(join(w.main, '.claude', 'graph')), false)
  } finally {
    cleanup(w.tmp)
  }
})

test('a worktree with its own profile and graph uses them over the main checkout\'s', () => {
  const w = linkedWorktree()
  try {
    file(w.main, PROFILE_PATH, profileNaming('older-main'))
    file(w.main, GRAPH_PATH, { nodes: [], edges: [] })
    file(w.worktree, PROFILE_PATH, profileNaming('own'))
    file(w.worktree, GRAPH_PATH, { nodes: [], edges: [] })
    const started = step0(w.worktree, ['run', 'start', '--change', w.change], { env: w.env })
    for (const prefix of INPUT_BANNERS) assert.ok(!anyStartsWith(started.banners, prefix), `${prefix} raised`)
    const manifest = manifestOf(w.worktree)
    assert.equal(manifest.testProfilePath, join(w.worktree, PROFILE_PATH))
    assert.equal(manifest.testProfileSource, 'root')
    assert.equal(manifest.graphPath, join(w.worktree, GRAPH_PATH))
    assert.equal(manifest.graphSource, 'root')
  } finally {
    cleanup(w.tmp)
  }
})

test('a linked-worktree run writes its corpora to the main checkout and keeps its working state in the worktree', () => {
  const w = linkedWorktree()
  try {
    const { env } = w
    // Strict, so the run writes review metrics as well as a trajectory, an
    // outcome line and — on the halt — a resume card.
    const started = step0(w.worktree, ['run', 'start', '--change', w.change, '--strict'], { env })
    assert.ok(
      anyStartsWith(started.banners, 'NO TEST PROFILE'),
      'the start step is ordinary apart from where its records go'
    )
    file(w.worktree, '.claude/ship/classified.json', CLASSIFIED)
    const batch = step0(w.worktree, started.then.argv, { env })
    writeFileSync(join(w.worktree, 'README.md'), 'hello\nand the thing\n')
    const review = step0(w.worktree, batch.then.argv, {
      results: batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id))),
      env
    })
    assert.equal(review.action, 'review')
    writeReview(w.worktree, {})
    step0(w.worktree, review.then.argv, { results: [{ ok: true }], env })

    // The stage marker an agent publishes from its own working directory.
    writeStage(w.change, 'review', { root: w.worktree })
    assert.ok(existsSync(stagePath(w.change, w.worktree)))

    const manifest = manifestOf(w.worktree)
    const { runId } = manifest
    assert.equal(manifest.surface, 'linked-worktree')
    assert.equal(manifest.stateHome, w.main)
    const corporaNote = manifest.notes.find(n => n.startsWith(`CORPORA IN MAIN CHECKOUT: ${w.main}`))
    assert.ok(corporaNote, JSON.stringify(manifest.notes))

    const closed = cli(w.worktree, ['run', 'close', '--halt', 'stopped for the test'], { env })
    assert.equal(closed.code, 1)

    // Corpora: under the main checkout, and not under the worktree.
    const at = (root, ...parts) => join(root, '.claude', ...parts)
    assert.ok(existsSync(at(w.main, 'ship', 'runs', `${runId}.jsonl`)), 'the trajectory is in the main checkout')
    const outcomes = readFileSync(at(w.main, 'learning', 'outcomes.jsonl'), 'utf8').split('\n').filter(Boolean)
    assert.ok(outcomes.some(line => JSON.parse(line).change === w.change), 'and the outcome line')
    assert.ok(
      readdirSync(at(w.main, 'metrics')).some(n => n.startsWith(`review-${w.change}-`)),
      'and the review metrics'
    )
    assert.ok(existsSync(at(w.main, 'handoff', `ship-${w.change}-${runId}.md`)), 'and the resume card')
    for (const corpus of [['ship', 'runs'], ['learning'], ['metrics'], ['handoff']]) {
      assert.equal(existsSync(at(w.worktree, ...corpus)), false, `.claude/${corpus.join('/')} was written in the worktree`)
    }

    // Working state: in the worktree, and not in the main checkout.
    for (const name of ['run.json', 'state.json']) {
      assert.ok(existsSync(at(w.worktree, 'ship', name)), `${name} is not in the worktree`)
      assert.equal(existsSync(at(w.main, 'ship', name)), false, `${name} leaked into the main checkout`)
    }
    assert.equal(existsSync(stagePath(w.change, w.worktree)), false, 'the close cleared the worktree\'s own marker')
    assert.equal(existsSync(stagePath(w.change, w.main)), false)

    // Recorded on the manifest, the opening event and the receipt.
    const start = eventsAt(w.main, runId).find(e => e.type === 'run-start')
    assert.equal(start.surface, 'linked-worktree')
    assert.equal(start.stateHome, w.main)
    assert.equal(start.cwd, w.worktree)
    const receipt = receiptAt(w.main, runId)
    assert.equal(receipt.surface, 'linked-worktree')
    assert.equal(receipt.stateHome, w.main)

    // The summary names both directories, the home directly under cwd.
    const lines = closed.step.summary.split('\n')
    const cwdRow = lines.indexOf(`  cwd: ${w.worktree}`)
    assert.ok(cwdRow >= 0, closed.step.summary)
    assert.equal(lines[cwdRow + 1], `  state home: ${w.main}`)
    assert.ok(closed.step.summary.includes(corporaNote), 'the corpora note is among the summary\'s notes')
    assert.match(closed.step.summary, new RegExp(`resume card: \\.claude/handoff/ship-${w.change}-${runId}\\.md`))

    // The card names the home beside the directory the close ran in, and a run
    // with no runner lanes says it has no session to resume.
    const card = readFileSync(at(w.main, 'handoff', `ship-${w.change}-${runId}.md`), 'utf8')
    assert.ok(card.includes(w.main), 'the card names the state home')
    assert.ok(card.includes(w.worktree), 'and the directory the close ran in')
    assert.match(card, /No lane recorded a host session/)
    assert.doesNotMatch(card, /--fork-session/)
  } finally {
    cleanup(w.tmp)
  }
})

test('two worktree runs of one repository share only the main checkout\'s append-only corpora', () => {
  const w = linkedWorktree()
  try {
    const second = join(w.main, '.claude', 'worktrees', 'w2')
    gitIn(w.main, ['worktree', 'add', '-q', second, '-b', 'w2'])
    const w2 = realpathSync(second)
    const runIds = []
    for (const root of [w.worktree, w2]) {
      file(root, '.claude/ship/classified.json', CLASSIFIED)
      const started = step0(root, ['run', 'start', '--change', w.change], { env: w.env })
      const batch = step0(root, started.then.argv, { env: w.env })
      step0(root, batch.then.argv, {
        results: batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id))),
        env: w.env
      })
      assert.equal(cli(root, ['run', 'close', '--halt', 'stopped for the test'], { env: w.env }).code, 1)
      runIds.push(manifestOf(root).runId)
    }
    assert.notEqual(runIds[0], runIds[1], 'each worktree holds its own manifest')
    for (const runId of runIds) assert.ok(eventsAt(w.main, runId).some(e => e.type === 'run-halt'))
    const outcomes = readFileSync(join(w.main, '.claude', 'learning', 'outcomes.jsonl'), 'utf8').split('\n').filter(Boolean)
    assert.equal(outcomes.length, 2, 'one intact line per run')
    for (const line of outcomes) assert.equal(JSON.parse(line).change, w.change)
    assert.equal(existsSync(join(w.main, '.claude', 'ship', 'run.json')), false)
  } finally {
    cleanup(w.tmp)
  }
})

test('a main-checkout run prints no state home row and writes where it always wrote', () => {
  const { root, change } = repo()
  try {
    const real = realpathSync(root)
    const batch = toFirstBatch(root, change)
    run(root, [...batch.then.argv], { results: batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id))) })
    const closed = cli(root, ['run', 'close', '--halt', 'stopped for the test'])
    assert.equal(closed.code, 1)

    const manifest = manifestOf(root)
    assert.equal(manifest.surface, 'main')
    assert.equal(manifest.stateHome, real)
    assert.doesNotMatch(closed.step.summary, /state home:/)
    for (const said of ['CORPORA IN', 'STATE HOME UNRESOLVED', 'TEST PROFILE FROM MAIN CHECKOUT', 'GRAPH FROM MAIN CHECKOUT']) {
      assert.ok(!closed.step.summary.includes(said), `a main-checkout run said ${said}`)
    }
    assert.ok(existsSync(join(root, '.claude', 'ship', 'runs', `${manifest.runId}.jsonl`)))
    assert.ok(existsSync(join(root, '.claude', 'learning', 'outcomes.jsonl')))
    assert.ok(existsSync(join(root, '.claude', 'handoff', `ship-${change}-${manifest.runId}.md`)))
    const start = runStartEvent(root)
    assert.deepEqual([start.surface, start.stateHome, start.cwd], ['main', real, real])
    const receipt = receiptOf(root)
    assert.deepEqual([receipt.surface, receipt.stateHome], ['main', real])
  } finally {
    cleanup(root)
  }
})

test('an explicit state home, by flag or by environment, receives every append of the run', () => {
  for (const via of ['flag', 'env']) {
    const { root, change } = repo()
    const home = mkdtempSync(join(tmpdir(), 'interlock-home-'))
    try {
      const realHome = realpathSync(home)
      const started = step0(
        root,
        ['run', 'start', '--change', change, ...(via === 'flag' ? ['--state-home', home] : [])],
        { env: via === 'env' ? { INTERLOCK_STATE_HOME: home } : {} }
      )
      const manifest = manifestOf(root)
      assert.equal(manifest.stateHome, realHome, via)
      assert.equal(manifest.surface, 'main', 'the surface still describes the root')
      assert.ok(anyStartsWith(manifest.notes, `CORPORA IN STATE HOME: ${realHome}`), JSON.stringify(manifest.notes))

      // Every later subcommand without the flag or the variable: the manifest decides.
      file(root, '.claude/ship/classified.json', CLASSIFIED)
      const batch = step0(root, started.then.argv)
      step0(root, batch.then.argv, { results: batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id))) })
      const closed = cli(root, ['run', 'close', '--halt', 'stopped for the test'])
      assert.equal(closed.code, 1)

      const { runId } = manifestOf(root)
      assert.ok(runId, 'the plan was adopted, so the run has an id')
      const types = eventsAt(realHome, runId).map(e => e.type)
      for (const type of ['run-start', 'wave-action', 'agent-spawn', 'run-receipt', 'run-halt']) {
        assert.ok(types.includes(type), `${via}: ${type} did not land in the explicit home`)
      }
      assert.equal(existsSync(join(root, '.claude', 'ship', 'runs')), false, `${via}: an append landed in the root`)
      assert.ok(existsSync(join(realHome, '.claude', 'learning', 'outcomes.jsonl')))
      assert.equal(existsSync(join(root, '.claude', 'learning')), false)
      assert.ok(existsSync(join(realHome, '.claude', 'handoff', `ship-${change}-${runId}.md`)))
      assert.ok(closed.step.summary.includes(`  state home: ${realHome}`))
    } finally {
      cleanup(root)
      cleanup(home)
    }
  }
})

test('a manifest without a recorded home appends under the working root, as before', () => {
  const w = linkedWorktree()
  try {
    file(w.worktree, '.claude/ship/classified.json', CLASSIFIED)
    const started = step0(w.worktree, ['run', 'start', '--change', w.change], { env: w.env })
    const batch = step0(w.worktree, started.then.argv, { env: w.env })
    const { runId } = manifestOf(w.worktree)
    const inHome = eventsAt(w.main, runId).length

    // A manifest as the previous version wrote it.
    const manifest = manifestOf(w.worktree)
    for (const key of ['stateHome', 'surface', 'stateHomeReason', 'stateHomeFrom']) delete manifest[key]
    file(w.worktree, '.claude/ship/run.json', manifest)

    step0(w.worktree, batch.then.argv, {
      results: batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id))),
      env: w.env
    })
    assert.ok(eventsAt(w.worktree, runId).some(e => e.type === 'wave-action'), 'the append went under the root')
    assert.equal(eventsAt(w.main, runId).length, inHome, 'and nothing more under the main checkout')
  } finally {
    cleanup(w.tmp)
  }
})

test('a root git cannot read banners STATE HOME UNRESOLVED and records surface unknown', () => {
  const root = mkdtempSync(join(tmpdir(), 'interlock-nogit-'))
  try {
    writeChange(root, 'add-thing')
    const env = gitFence()
    const real = realpathSync(root)
    const started = step0(root, ['run', 'start', '--change', 'add-thing'], { env })
    const unresolved = started.banners.find(b => b.startsWith('STATE HOME UNRESOLVED: '))
    assert.ok(unresolved && unresolved.length > 'STATE HOME UNRESOLVED: '.length, JSON.stringify(started.banners))
    const manifest = manifestOf(root)
    assert.equal(manifest.surface, 'unknown')
    assert.equal(manifest.stateHome, real)
    assert.ok(manifest.stateHomeReason)

    file(root, '.claude/ship/classified.json', CLASSIFIED)
    step0(root, started.then.argv, { env })
    const start = runStartEvent(root)
    assert.deepEqual([start.surface, start.stateHome, start.cwd], ['unknown', real, real])

    const closed = cli(root, ['run', 'close', '--halt', 'stopped for the test'], { env })
    assert.equal(closed.code, 1)
    const receipt = receiptOf(root)
    assert.deepEqual([receipt.surface, receipt.stateHome], ['unknown', real])
    assert.ok(closed.step.banners.includes(unresolved), 'the fallback is among the degradations')
    assert.doesNotMatch(closed.step.summary, /state home:/)
  } finally {
    cleanup(root)
  }
})

test('a run subcommand in a worktree with no manifest names the main checkout\'s, and only when one exists', () => {
  const w = linkedWorktree()
  const bare = mkdtempSync(join(tmpdir(), 'interlock-nogit-'))
  try {
    step0(w.main, ['run', 'start', '--change', w.change], { env: w.env })
    const here = join(w.worktree, '.claude', 'ship', 'run.json')
    const there = join(w.main, '.claude', 'ship', 'run.json')

    const moved = step0(w.worktree, ['run', 'record-batch'], { results: [], env: w.env })
    assert.equal(moved.action, 'halt')
    assert.equal(
      moved.reason,
      `no run manifest at ${here} — one exists at ${there}; if this session moved into a worktree after ` +
        'run start, the run continues from there'
    )

    // The close with no manifest says where a record would have gone.
    const closed = cli(w.worktree, ['run', 'close', '--halt', 'no manifest here'], { env: w.env })
    assert.equal(closed.code, 1)
    const lines = closed.step.summary.split('\n')
    const cwdRow = lines.indexOf(`  cwd: ${w.worktree}`)
    assert.ok(cwdRow >= 0, closed.step.summary)
    assert.equal(lines[cwdRow + 1], `  state home: ${w.main}`)
    assert.ok(closed.step.summary.includes(there))

    // No manifest anywhere: today's message, the root's path alone.
    rmSync(there)
    const nowhere = step0(w.worktree, ['run', 'record-batch'], { results: [], env: w.env })
    assert.equal(nowhere.action, 'halt')
    assert.match(nowhere.reason, /^no run manifest at \.claude\/ship\/run\.json — /)
    assert.ok(!nowhere.reason.includes(w.main))

    // A home that cannot be resolved: the same.
    writeChange(bare, 'add-thing')
    const unresolved = step0(bare, ['run', 'record-batch'], { results: [], env: gitFence() })
    assert.equal(unresolved.action, 'halt')
    assert.match(unresolved.reason, /^no run manifest at \.claude\/ship\/run\.json — /)
  } finally {
    cleanup(w.tmp)
    cleanup(bare)
  }
})

test('a read-only runs directory in the main checkout halts the worktree run\'s record path', { skip: IS_ROOT && 'chmod does not bind root' }, () => {
  const w = linkedWorktree()
  try {
    file(w.worktree, '.claude/ship/classified.json', CLASSIFIED)
    const started = step0(w.worktree, ['run', 'start', '--change', w.change], { env: w.env })
    const batch = step0(w.worktree, started.then.argv, { env: w.env })
    const { runId } = manifestOf(w.worktree)
    const dir = join(w.main, '.claude', 'ship', 'runs')
    const trajectory = join(dir, `${runId}.jsonl`)
    chmodSync(trajectory, 0o444)
    chmodSync(dir, 0o555)
    let halted
    try {
      halted = step0(w.worktree, batch.then.argv, {
        results: batch.spawns.map((_, i) => laneOk(batch.lanes[i].map(t => t.id))),
        env: w.env
      })
    } finally {
      chmodSync(dir, 0o755)
      chmodSync(trajectory, 0o644)
    }
    assert.equal(halted.action, 'halt')
    assert.match(halted.reason, /^trajectory append failed: /)
    const tasks = readFileSync(join(w.worktree, `openspec/changes/${w.change}/tasks.md`), 'utf8')
    assert.doesNotMatch(tasks, /- \[x\]/, 'nothing is ticked on a run nobody can reconstruct')
    assert.equal(existsSync(join(w.worktree, '.claude', 'ship', 'runs')), false, 'and it did not fall back to the root')
  } finally {
    cleanup(w.tmp)
  }
})

test('a learning directory the main checkout cannot create only reports, and the close exits 0', () => {
  const w = linkedWorktree()
  try {
    // A file where the directory must go: the mkdir fails whatever the uid.
    writeFileSync(join(w.main, '.claude', 'learning'), 'not a directory\n')
    file(w.worktree, '.claude/ship/classified.json', CLASSIFIED)
    let step = step0(w.worktree, ['run', 'start', '--change', w.change], { env: w.env })
    step = step0(w.worktree, step.then.argv, { env: w.env })
    step = step0(w.worktree, step.then.argv, {
      results: step.spawns.map((_, i) => laneOk(step.lanes[i].map(t => t.id))),
      env: w.env
    })
    assert.equal(step.action, 'verify-final')
    step = step0(w.worktree, step.then.argv, { env: w.env })
    assert.equal(step.action, 'commit')
    const closed = cli(w.worktree, step.then.argv, { results: [{ ok: true, sha: 'abc1234' }], env: w.env })
    assert.equal(closed.code, 0, `losing the outcome line must not fail the run\n${closed.stderr}`)
    assert.equal(closed.step.action, 'complete')
    assert.match(closed.stderr, /outcome not recorded/)
    const { runId } = manifestOf(w.worktree)
    assert.ok(eventsAt(w.main, runId).some(e => e.type === 'run-complete'), 'the trajectory is untouched by it')
  } finally {
    cleanup(w.tmp)
  }
})

test('six processes appending outcome lines into one home at once leave every line intact', async () => {
  const home = mkdtempSync(join(tmpdir(), 'interlock-home-'))
  try {
    const WORKERS = 6
    const PER = 40
    const url = pathToFileURL(join(ROOT, 'lib', 'outcomes.mjs')).href
    // Every worker spins to one shared instant, so the appends overlap rather
    // than queue behind each process's start-up.
    const startAt = Date.now() + 750
    const script =
      `import { appendOutcome } from ${JSON.stringify(url)}\n` +
      'const [home, worker, per, at] = process.argv.slice(1)\n' +
      'while (Date.now() < Number(at)) {}\n' +
      'let failed = 0\n' +
      'for (let i = 0; i < Number(per); i++) {\n' +
      "  if (!appendOutcome(home, { change: `w${worker}-${i}`, mode: 'checkpoint' }).written) failed++\n" +
      '}\n' +
      'process.exit(failed ? 1 : 0)\n'
    const exits = await Promise.all(
      Array.from({ length: WORKERS }, (_, k) =>
        new Promise((resolve, reject) => {
          const child = spawn(
            process.execPath,
            ['--input-type=module', '-e', script, home, String(k), String(PER), String(startAt)],
            { stdio: ['ignore', 'ignore', 'pipe'] }
          )
          let stderr = ''
          child.stderr.on('data', chunk => (stderr += chunk))
          child.on('error', reject)
          child.on('exit', code => resolve({ code, stderr }))
        })
      )
    )
    for (const { code, stderr } of exits) assert.equal(code, 0, stderr)

    const text = readFileSync(join(home, '.claude', 'learning', 'outcomes.jsonl'), 'utf8')
    assert.ok(text.endsWith('\n'), 'no torn final line')
    const lines = text.split('\n').filter(Boolean)
    assert.equal(lines.length, WORKERS * PER)
    const changes = new Set(lines.map(line => JSON.parse(line).change))
    for (let k = 0; k < WORKERS; k++) {
      for (let i = 0; i < PER; i++) assert.ok(changes.has(`w${k}-${i}`), `w${k}-${i} is missing`)
    }
  } finally {
    cleanup(home)
  }
})

// Written verbatim as the trajectory writer wrote it before `agent-result`,
// `surface`, `stateHome`, `cwd` and the six counts existed — the fixture
// `test/spine/run-log.test.mjs` pins in full. This is the binary's view of it.
const PRE_CHANGE_TRAJECTORY = [
  '{"schema":"interlock.ship-run/1","ts":"2026-09-01T10:00:00.000Z","runId":"run-pre","change":"add-widget","seq":1,"type":"run-start","mode":"continue","strict":false,"sessionId":"sess-1"}',
  '{"schema":"interlock.ship-run/1","ts":"2026-09-01T10:00:01.000Z","runId":"run-pre","change":"add-widget","seq":2,"type":"wave-action","action":"run-batch","wave":"1","waveIndex":0,"batchIndex":0,"phase":"implement","source":"next"}',
  '{"schema":"interlock.ship-run/1","ts":"2026-09-01T10:00:02.000Z","runId":"run-pre","change":"add-widget","seq":3,"type":"cli-exit","command":"wave-state next","exitCode":0,"durationMs":3}',
  '{"schema":"interlock.ship-run/1","ts":"2026-09-01T10:00:03.000Z","runId":"run-pre","change":"add-widget","seq":4,"type":"agent-spawn","label":"1.1","model":"sonnet","kind":"implementer","taskId":"1.1"}',
  '{"schema":"interlock.ship-run/1","ts":"2026-09-01T10:00:04.000Z","runId":"run-pre","change":"add-widget","seq":5,"type":"verify-judgement","context":"final","halt":false,"reason":"green","unitStatus":"green","spill":[]}',
  '{"schema":"interlock.ship-run/1","ts":"2026-09-01T10:00:05.000Z","runId":"run-pre","change":"add-widget","seq":6,"type":"cli-exit","command":"verify judge","exitCode":0,"durationMs":null}',
  '{"schema":"interlock.ship-run/1","ts":"2026-09-01T10:00:06.000Z","runId":"run-pre","change":"add-widget","seq":7,"type":"run-receipt","host":{"id":"claude","billing":"x","hooks":true,"usage":true,"cacheAccounting":false,"effort":"flag"},"waves":[{"wave":"1","ok":1,"failed":0,"notAttempted":0}],"planReused":null,"planStatus":null,"planReason":null,"planFingerprint":null,"reviewRaised":null,"reviewSurviving":null,"reviewBlockers":null,"reviewWarnings":null,"remediationRounds":null,"skippedVerifications":null,"capExhaustedVerifications":null,"unresolvedErrors":null,"leftoverTaskIds":[],"spend":[{"wave":"1","outputTokens":10,"cacheReadInputTokens":null,"cacheCreationInputTokens":null}],"outputTokens":12,"cacheReadInputTokens":null,"cacheCreationInputTokens":null,"halted":false,"haltReason":null,"committed":true,"commit":"abc1234","touchedPaths":["a.mjs"],"touchedPathsTruncated":false,"touchedPathsReason":null,"predictedPaths":["a.mjs"],"predictedPathsTruncated":false,"predictedPathsComplete":true,"predictedPathsReason":null,"degradations":[]}',
  '{"schema":"interlock.ship-run/1","ts":"2026-09-01T10:00:07.000Z","runId":"run-pre","change":"add-widget","seq":8,"type":"run-complete","leftoverTaskIds":[]}'
]

test('a pre-change trajectory still lists, checks and renders through the binary', () => {
  const { root } = repo()
  try {
    file(root, '.claude/ship/runs/run-pre.jsonl', PRE_CHANGE_TRAJECTORY.join('\n') + '\n')
    const check = cli(root, ['run-log', 'check', '--run-id', 'run-pre'])
    assert.equal(check.code, 0)
    assert.deepEqual(check.step, { ok: true, runId: 'run-pre', problems: [], events: 8 })

    const list = cli(root, ['run-log', 'list'], { json: false })
    assert.equal(list.code, 0)
    assert.equal(list.stdout, 'run-pre\tchange=add-widget\tcomplete\tcommit=abc1234\tevents=8\n')

    const show = cli(root, ['run-log', 'show', 'run-pre'], { json: false })
    assert.equal(show.code, 0)
    assert.match(show.stdout, /^RUN LOG — 8 event\(s\)\n/)
    assert.match(show.stdout, /#1\trun-start\tmode="continue" strict=false sessionId="sess-1"\n/)
    assert.doesNotMatch(show.stdout, /agent-result|surface|stateHome|cwd=/, 'no absent field is rendered as if recorded')
  } finally {
    cleanup(root)
  }
})

// ============================================================================
// The banners a second reader displays (draw-the-ship-run-live, ship/run-program)
//
// The ship meter reads every step off the ping's Bash result and toasts the
// `banners` it carries; it recognises no banner by its wording. So a banner the
// CLI raised must reach a step as a field, never only the close summary's prose,
// and the close's JSON record must carry its banners beside its summary.
// ============================================================================

test('run start in a root with no graph carries the GRAPH UNAVAILABLE text on the step', () => {
  const { root, change } = repo()
  try {
    file(root, PROFILE_PATH, profileNaming('root'))
    const started = step0(root, ['run', 'start', '--change', change])
    assert.ok(Array.isArray(started.banners) && started.banners.includes(NO_GRAPH_LINE), JSON.stringify(started.banners))
  } finally {
    cleanup(root)
  }
})

test('a banner raised from host records at record-batch rides the step that call returns', () => {
  const { root, change } = repo('add-thing', { tasks: FOUR_TASKS })
  try {
    const batch = startWithHost(root, change, 'claude', RUNNER_CAPS, [], FOUR_LANES)
    const records = [
      hostRecord('1.1', { subtype: 'error_max_turns', isError: true, terminalReason: 'max_turns', exitCode: 1 }),
      hostRecord('1.2'),
      hostRecord('1.3'),
      hostRecord('1.4')
    ]
    const results = batch.lanes.map(lane => (lane[0].id === '1.1' ? null : laneResult(lane)))
    const recorded = step0(root, batch.then.argv, { results, hostRecords: records })
    assert.ok(manifestOf(root).banners.includes('LANE STOPPED BY HOST: 1.1 error_max_turns'))
    assert.ok(
      (recorded.banners || []).includes('LANE STOPPED BY HOST: 1.1 error_max_turns'),
      `the banner reached the summary only: step banners ${JSON.stringify(recorded.banners)}`
    )
  } finally {
    cleanup(root)
  }
})

test('a step that raised nothing carries no banner it did not raise', () => {
  const { root, change } = repo('add-thing', { tasks: FOUR_TASKS })
  try {
    const batch = startWithHost(root, change, 'claude', RUNNER_CAPS, [], FOUR_LANES)
    const records = batch.spawns.map(s => hostRecord(s.label))
    const recorded = step0(root, batch.then.argv, { results: batch.lanes.map(laneResult), hostRecords: records })
    assert.ok(!anyStartsWith(recorded.banners, 'GRAPH UNAVAILABLE'), 'the start step\'s banner is not raised again')
    assert.ok(!anyStartsWith(recorded.banners, 'LANE STOPPED'), JSON.stringify(recorded.banners))
  } finally {
    cleanup(root)
  }
})

/** The per-run identity rows of a close summary (run id, slug, cwd, state home), which differ between two runs and nothing else does. */
const IDENTITY_ROW = /^\s*(run|project|cwd|state home): .*$/gm
const withoutIdentity = text => text.replace(IDENTITY_ROW, '<identity>')

test('run close --json carries every banner the summary lists, in its order, and the same summary bytes', () => {
  // Two independent, identical lean runs: one closes with --json, one without.
  // A copied root would share the first run's state home and trajectory.
  const a = repo()
  const b = repo()
  try {
    toTail(a.root, a.change, [])
    toTail(b.root, b.change, [])
    const closed = run(a.root, ['run', 'close']).step
    const plain = cli(b.root, ['run', 'close'], { json: false })
    assert.equal(plain.code, 0, `${plain.stdout}\n${plain.stderr}`)
    assert.ok(Array.isArray(closed.banners), 'the close record has no banners array')
    assert.ok(closed.banners.includes(NO_GRAPH_LINE), JSON.stringify(closed.banners))
    const at = closed.banners.map(banner => closed.summary.indexOf(banner))
    assert.ok(at.every(i => i >= 0), `a banner the record carries is not in the summary: ${JSON.stringify(closed.banners)}`)
    assert.deepEqual(at, [...at].sort((x, y) => x - y), 'the record\'s banners are not in the summary\'s order')
    assert.equal(withoutIdentity(closed.summary + '\n'), withoutIdentity(plain.stdout), 'the --json summary differs from the bytes run close prints')
  } finally {
    cleanup(a.root)
    cleanup(b.root)
  }
})

test('run close --halt --json carries action halt, exit 1 and its banners', () => {
  const { root, change } = repo()
  try {
    toTail(root, change, [])
    const closed = run(root, ['run', 'close', '--halt', 'unresolved blockers'], { expectExit: 1 }).step
    assert.equal(closed.action, 'halt')
    assert.equal(closed.exitCode, 1)
    assert.ok(Array.isArray(closed.banners) && closed.banners.includes(NO_GRAPH_LINE), JSON.stringify(closed.banners))
  } finally {
    cleanup(root)
  }
})

test('a clean close carries an empty banners array, present and not absent', () => {
  const { root, change } = repo()
  try {
    file(root, PROFILE_PATH, profileNaming('root'))
    file(root, GRAPH_PATH, { nodes: [], edges: [] })
    toTail(root, change, [])
    const closed = run(root, ['run', 'close']).step
    assert.ok(Array.isArray(closed.banners), 'banners is absent')
    assert.deepEqual(closed.banners, [], `a clean run raised: ${JSON.stringify(closed.banners)}`)
  } finally {
    cleanup(root)
  }
})
