// The outcome eval's graders (spec: evals/outcome-run).
//
// Every assertion here runs offline, with no model and no credential. The
// graders are the part of the eval that must be right before a single metered
// call is made — a grader that reported a red suite green would make the whole
// apparatus worse than nothing — and exercising them the ordinary way costs a
// model and several minutes per case.
//
// So a scratch root that a run WOULD have left is built from committed data:
// the fixture's starting state, its reference implementation, the ticks the
// sample says the run's state machine recorded, and the trajectory it wrote,
// laid down through `lib/run-log.mjs`'s own writer so it cannot drift from what
// a real run produces. Then the real graders run against it, and every
// criterion resolves from the exit code of a command the CLI already ships.
//
// The failing direction is tested by breaking the sample root, one property at a
// time — an untick, a deleted test, a missing commit — because a grader that
// only ever sees a clean root has not been shown to be able to fail.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendRunLogEvent } from '../../lib/run-log.mjs'
import { applyReference, readFixture } from '../../evals/ship/fixtures.mjs'
import { prepareScratchRoot, removeScratchRoot } from '../../evals/ship/run.mjs'
import { PROCESS_CRITERIA } from '../../evals/ship/trajectory.mjs'
import {
  CRITERIA,
  SHARED_CRITERIA,
  STATUS,
  gradeArm,
  gradeCommit,
  gradeProcess,
  gradeTicks,
  gradeUnit,
  parseNodeTestCounts,
  runUnitCommand,
  tallyCriteria
} from '../../evals/ship/graders.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(ROOT, 'bin', 'interlock')
const SAMPLE = JSON.parse(
  readFileSync(join(ROOT, 'evals', 'ship', 'sample', 'clean-run.json'), 'utf8')
)

const fixture = readFixture(SAMPLE.fixture)

/** The status of one criterion out of a graded set. */
function statusOf(criteria, id) {
  const found = criteria.find(c => c.id === id)
  return found ? found.status : `(no ${id} criterion)`
}

/**
 * Lay down the scratch root a clean run would have left.
 *
 * Model-free throughout: the reference implementation stands in for what the
 * agents would have written, `interlock tasks tick` for what the loop would have
 * ticked, and `appendRunLogEvent` for what the loop would have recorded.
 */
function sampleRoot({ tick = true, commit = true, reference = true } = {}) {
  const prepared = prepareScratchRoot(fixture, { tmpBase: tmpdir() })
  const { root } = prepared

  // The committed baseline the weakened-suite check is measured against:
  // measured off the starting state, exactly as the runner measures it, rather
  // than pinned to a literal that would rot the first time a fixture gained a
  // test.
  const before = runUnitCommand(fixture, root)
  const baselineCounts = {
    kind: 'unit',
    command: before.command,
    exitCode: before.exitCode,
    total: before.total,
    passed: before.passed,
    failed: before.failed,
    skipped: before.skipped
  }
  assert.notEqual(before.exitCode, 0, 'the fixture starting state must be red for any of this to mean anything')
  assert.ok(Number.isInteger(before.total), 'the fixture suite printed no parseable counts')

  if (reference) applyReference(fixture, root)

  if (tick) {
    const ticked = spawnSync(
      process.execPath,
      // `--change`, not a positional: `interlock tasks tick` reads positional[1]
      // as the change name, and positional[1] here is the subcommand.
      [BIN, 'tasks', 'tick', '--change', fixture.change, '--ids', SAMPLE.completed.join(','), '--root', root, '--json'],
      { cwd: ROOT, encoding: 'utf8' }
    )
    assert.equal(ticked.status, 0, `laying down the sample: tasks tick failed — ${ticked.stderr}`)
  }

  // What the state machine recorded, where the state machine records it.
  mkdirSync(join(root, '.claude', 'ship'), { recursive: true })
  writeFileSync(
    join(root, '.claude', 'ship', 'state.json'),
    `${JSON.stringify({ completed: tick ? SAMPLE.completed : [], failures: [] })}\n`
  )

  let head = prepared.commit
  if (commit) {
    spawnSync('git', ['add', '-A'], { cwd: root, encoding: 'utf8' })
    const made = spawnSync(
      'git',
      [
        '-c',
        'user.name=Interlock Outcome Eval',
        '-c',
        'user.email=eval@interlock.invalid',
        'commit',
        '-q',
        '-m',
        'sample: the run under grade'
      ],
      { cwd: root, encoding: 'utf8' }
    )
    assert.equal(made.status, 0, `laying down the sample: commit failed — ${made.stderr}`)
    head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
  }

  for (const event of SAMPLE.events) {
    const resolved = JSON.parse(JSON.stringify(event).split('"<HEAD>"').join(JSON.stringify(head)))
    const written = appendRunLogEvent(root, {
      runId: SAMPLE.runId,
      change: fixture.change,
      ...resolved
    })
    assert.equal(written.written, true, `laying down the sample: ${event.type} not written — ${written.reason}`)
  }

  return { root, baselineCommit: prepared.commit, head, baselineCounts }
}

test('parseNodeTestCounts reads a run and records an unparsed one as absent, never zero', () => {
  const counts = parseNodeTestCounts(
    ['not ok 1 - formats bytes', '# tests 7', '# pass 5', '# fail 2', '# skipped 0'].join('\n')
  )
  assert.deepEqual(
    { total: counts.total, passed: counts.passed, failed: counts.failed, skipped: counts.skipped },
    { total: 7, passed: 5, failed: 2, skipped: 0 }
  )
  assert.deepEqual(counts.failures, ['formats bytes'])

  // The other reporter, which is the default on some Node versions and not on
  // others. Reading only one of the two would make the weakened-suite check
  // silently unavailable on half the versions this repository supports.
  const spec = parseNodeTestCounts(
    ['✖ formats bytes (0.6ms)', 'ℹ tests 7', 'ℹ pass 5', 'ℹ fail 2', 'ℹ skipped 0'].join('\n')
  )
  assert.deepEqual(
    { total: spec.total, passed: spec.passed, failed: spec.failed, skipped: spec.skipped },
    { total: 7, passed: 5, failed: 2, skipped: 0 }
  )
  assert.deepEqual(spec.failures, ['formats bytes'])

  // FORCE_COLOR wraps the spec reporter in CSI sequences. A parser that only
  // read the uncolored form would make the weakened-suite check silently
  // unavailable whenever the eval ran under a color-forcing parent.
  const colored = parseNodeTestCounts(
    [
      '\x1b[31m✖ formats bytes \x1b[90m(0.6ms)\x1b[39m\x1b[39m',
      '\x1b[34mℹ tests 7\x1b[39m',
      '\x1b[34mℹ pass 5\x1b[39m',
      '\x1b[34mℹ fail 2\x1b[39m',
      '\x1b[34mℹ skipped 0\x1b[39m'
    ].join('\n')
  )
  assert.deepEqual(
    { total: colored.total, passed: colored.passed, failed: colored.failed, skipped: colored.skipped },
    { total: 7, passed: 5, failed: 2, skipped: 0 }
  )
  assert.deepEqual(colored.failures, ['formats bytes'])

  // The absence that matters: a run whose summary never printed. A zeroed count
  // here would make the weakened-suite check compare a real baseline against a
  // fabricated present and report every run as having deleted its whole suite.
  const nothing = parseNodeTestCounts('the runner crashed before printing a summary')
  assert.deepEqual(
    { total: nothing.total, passed: nothing.passed, failed: nothing.failed, skipped: nothing.skipped },
    { total: null, passed: null, failed: null, skipped: null }
  )
})

test('a clean sample root grades every loop-arm criterion, each from a command exit code', () => {
  const { root, baselineCommit, baselineCounts } = sampleRoot()
  try {
    const graded = gradeArm({
      root,
      fixture,
      arm: 'loop',
      runId: SAMPLE.runId,
      baselineCommit,
      baselineCounts
    })

    for (const c of graded.criteria) {
      assert.equal(
        c.status,
        STATUS.PASS,
        `${c.id} did not pass on a clean sample root: ${c.detail}`
      )
      // Every criterion names the command that decided it and the code that
      // command returned — the property that makes a recorded row re-derivable
      // by hand.
      assert.ok(c.command, `${c.id} names no deciding command`)
      assert.equal(typeof c.exitCode, 'number', `${c.id} records no exit code`)
    }

    const tally = tallyCriteria(graded.criteria)
    assert.deepEqual(tally, { met: 9, applicable: 9, notApplicable: 0, unobserved: 0 })
    assert.equal(graded.receipt.outputTokens, 8190)

    // The three process criteria are among them, and they are decided over the
    // run's own events rather than over anything an agent said.
    for (const id of Object.values(PROCESS_CRITERIA)) {
      assert.equal(statusOf(graded.criteria, id), STATUS.PASS, `${id} must be graded on the loop arm`)
    }
  } finally {
    removeScratchRoot(root)
  }
})

test('a box ticked for a task the machine never recorded fails the tick criterion', () => {
  const { root } = sampleRoot()
  try {
    // The machine recorded three of the four. The fourth box is still ticked,
    // which is exactly how unimplemented work ships behind an "[x]".
    writeFileSync(
      join(root, '.claude', 'ship', 'state.json'),
      `${JSON.stringify({ completed: SAMPLE.completed.slice(0, 3), failures: [] })}\n`
    )
    const graded = gradeTicks({ root, change: fixture.change })
    assert.equal(graded.status, STATUS.FAIL)
    assert.deepEqual(graded.tickedNotRecorded, [SAMPLE.completed[3]])
    assert.equal(graded.met, false)
  } finally {
    removeScratchRoot(root)
  }
})

test('an absent wave state leaves the tick criterion unobserved, never passing', () => {
  const { root } = sampleRoot()
  try {
    rmSync(join(root, '.claude', 'ship', 'state.json'))
    const graded = gradeTicks({ root, change: fixture.change })
    assert.equal(graded.status, STATUS.UNOBSERVED)
    assert.equal(graded.met, false, 'an unobserved criterion must never read as met')
    assert.match(graded.detail, /recorded set was not/)
  } finally {
    removeScratchRoot(root)
  }
})

test('a run that claimed success while leaving the suite red does not grade green', () => {
  // The claim is never consulted: the sample's receipt says the run completed
  // cleanly and its trajectory records a green verify judgement. The suite is
  // what decides.
  const { root, baselineCommit, baselineCounts } = sampleRoot({ reference: false })
  try {
    const graded = gradeArm({
      root,
      fixture,
      arm: 'loop',
      runId: SAMPLE.runId,
      baselineCommit,
      baselineCounts
    })
    assert.equal(statusOf(graded.criteria, CRITERIA.UNIT_GREEN), STATUS.FAIL)
    // And the receipt still reads clean, which is the point: the two are
    // different questions and only one of them was asked of the disk.
    assert.equal(statusOf(graded.criteria, CRITERIA.RECEIPT), STATUS.PASS)
  } finally {
    removeScratchRoot(root)
  }
})

test('a suite that went green by deleting a test fails the loop own weakened-suite check', () => {
  const { root, baselineCounts } = sampleRoot()
  try {
    // Taking the suite green by shrinking: the reference implementation made
    // every test pass, and then two of the three test files are removed, which
    // drops the count below the committed baseline. No new judgement catches
    // this — `interlock verify unit` does, against the fixture's own baseline
    // counts.
    rmSync(join(root, 'test', 'docs.test.mjs'))
    rmSync(join(root, 'test', 'format.test.mjs'))
    const graded = gradeUnit({ root, fixture, baselineCounts, resultPath: root })
    assert.equal(statusOf(graded.criteria, CRITERIA.UNIT_NOT_WEAKENED), STATUS.FAIL)
    assert.match(statusOf(graded.criteria, CRITERIA.UNIT_GREEN), /pass|fail/)
    const weakened = graded.criteria.find(c => c.id === CRITERIA.UNIT_NOT_WEAKENED)
    assert.match(weakened.detail, /weakened/)
  } finally {
    removeScratchRoot(root)
  }
})

test('with no baseline the weakened-suite check is unobserved rather than passed', () => {
  const { root } = sampleRoot()
  try {
    const graded = gradeUnit({ root, fixture, baselineCounts: null, resultPath: root })
    const weakened = graded.criteria.find(c => c.id === CRITERIA.UNIT_NOT_WEAKENED)
    assert.equal(weakened.status, STATUS.UNOBSERVED)
    assert.equal(weakened.met, false)
  } finally {
    removeScratchRoot(root)
  }
})

test('no commit fails the commit criterion; a run invoked to make none passes on its absence', () => {
  const { root, baselineCommit } = sampleRoot({ commit: false })
  try {
    const wanted = gradeCommit({ root, baselineCommit, expectCommit: true })
    assert.equal(wanted.status, STATUS.FAIL)
    assert.equal(wanted.commits, 0)

    // The other question, and the reason the flag exists: a run invoked so as to
    // make no commit is graded on the absence, not against it.
    const notWanted = gradeCommit({ root, baselineCommit, expectCommit: false })
    assert.equal(notWanted.status, STATUS.PASS)
  } finally {
    removeScratchRoot(root)
  }
})

test('a receipt carrying an unknown records the field unobserved, not clean', () => {
  const { root, baselineCommit, baselineCounts } = sampleRoot()
  try {
    // A second run on the same root, whose receipt is the one this host actually
    // writes: no token accounting, so spend is absent with its reason.
    const runId = 'sample-unaccounted-run'
    for (const event of [
      { type: 'run-start', mode: 'continue', strict: false },
      { type: 'run-complete', leftoverTaskIds: [] },
      { type: 'run-receipt', waves: [], remediationRounds: 0, outputTokens: null, leftoverTaskIds: [] }
    ]) {
      appendRunLogEvent(root, { runId, change: fixture.change, ...event })
    }

    const graded = gradeArm({
      root,
      fixture,
      arm: 'loop',
      runId,
      baselineCommit,
      baselineCounts
    })
    const receipt = graded.criteria.find(c => c.id === CRITERIA.RECEIPT)
    assert.equal(receipt.status, STATUS.UNOBSERVED)
    assert.equal(receipt.met, false)
    assert.deepEqual(receipt.unobservedFields, ['outputTokens'])
    assert.match(receipt.detail, /spend/)
  } finally {
    removeScratchRoot(root)
  }
})

test('a control arm names its arm and records three criteria not-applicable, never failed', () => {
  const { root, baselineCommit, baselineCounts } = sampleRoot()
  try {
    const graded = gradeArm({
      root,
      fixture,
      arm: 'control',
      runId: null,
      baselineCommit,
      baselineCounts
    })

    // The result names its arm. A criteria set that did not say which arm
    // produced it could be read as a loop result with three criteria missing.
    assert.equal(graded.arm, 'control')

    for (const id of [
      CRITERIA.TICKS,
      CRITERIA.TRAJECTORY,
      CRITERIA.RECEIPT,
      ...Object.values(PROCESS_CRITERIA)
    ]) {
      const c = graded.criteria.find(x => x.id === id)
      assert.equal(c.status, STATUS.NOT_APPLICABLE, `${id} must be not-applicable on the control arm`)
      // The load-bearing half: `met: null` is neither met nor failed. Recording
      // an inapplicable criterion as a failure would manufacture exactly the
      // difference the eval exists to measure.
      assert.equal(c.met, null, `${id} must not read as a failure on the control arm`)
      assert.ok(c.detail, `${id} must say why it does not apply`)
    }

    // And the criteria both arms can be graded on are graded.
    for (const id of SHARED_CRITERIA) {
      assert.equal(statusOf(graded.criteria, id), STATUS.PASS, `${id} must still be graded`)
    }
    const tally = tallyCriteria(graded.criteria)
    assert.deepEqual(tally, { met: 3, applicable: 3, notApplicable: 6, unobserved: 0 })

    // And the process ids stay out of the set the arms are differenced over.
    // Counting a control-arm `n/a` into that comparison would score the arm
    // down for lacking a mechanism it was defined not to have.
    for (const id of Object.values(PROCESS_CRITERIA)) {
      assert.equal(SHARED_CRITERIA.includes(id), false, `${id} must not join the arm-difference set`)
    }
  } finally {
    removeScratchRoot(root)
  }
})

test('an invented action fails process while the run stays reconstructable', () => {
  // The split the whole change rests on: `interlock run-log check` is an in-run
  // gate and must not learn to reject an invented action, so a log carrying one
  // passes reconstructability and fails known-actions. If these two ever moved
  // together, an eval-only check would have been folded into a consumer's gate.
  const { root } = sampleRoot()
  try {
    const runId = 'sample-invented-action'
    for (const event of [
      { type: 'run-start', mode: 'continue', strict: false },
      { type: 'wave-action', action: 'report', wave: '1', waveIndex: 0, batchIndex: 0, source: 'create' },
      { type: 'cli-exit', command: 'wave-state create', exitCode: 0 },
      { type: 'verify-judgement', context: 'final', halt: false, reason: 'green', unitStatus: 'green' },
      { type: 'cli-exit', command: 'verify judge', exitCode: 0 },
      { type: 'run-complete', leftoverTaskIds: [] },
      { type: 'run-receipt', waves: [], remediationRounds: 0, outputTokens: 1, leftoverTaskIds: [] }
    ]) {
      const written = appendRunLogEvent(root, { runId, change: fixture.change, ...event })
      assert.equal(written.written, true, `planting: ${event.type} — ${written.reason}`)
    }

    const reconstructable = spawnSync(
      process.execPath,
      [BIN, 'run-log', 'check', '--run-id', runId, '--root', root, '--json'],
      { cwd: ROOT, encoding: 'utf8' }
    )
    assert.equal(
      reconstructable.status,
      0,
      `run-log check must still pass on a log carrying an invented action: ${reconstructable.stdout}`
    )

    const process_ = gradeProcess({ root, runId })
    assert.equal(statusOf(process_, PROCESS_CRITERIA.KNOWN_ACTIONS), STATUS.FAIL)
    assert.equal(statusOf(process_, PROCESS_CRITERIA.REQUIRED_TYPES), STATUS.PASS)
    assert.equal(statusOf(process_, PROCESS_CRITERIA.HALT_ON_UNIT_RED), STATUS.PASS)

    // Every process criterion names the invocation that supplied its events.
    for (const c of process_) {
      assert.match(c.command, /run-log show/, `${c.id} names no source for the events it read`)
      assert.equal(c.runId, runId)
    }

    // And the reconstructability criterion, graded through the same root, is
    // unmoved.
    const graded = gradeArm({ root, fixture, arm: 'loop', runId, baselineCommit: null, baselineCounts: null })
    assert.equal(statusOf(graded.criteria, CRITERIA.TRAJECTORY), STATUS.PASS)
    assert.equal(statusOf(graded.criteria, PROCESS_CRITERIA.KNOWN_ACTIONS), STATUS.FAIL)
  } finally {
    removeScratchRoot(root)
  }
})

test('a loop arm with no trajectory records the process criteria unobserved, never passing', () => {
  const { root } = sampleRoot()
  try {
    for (const c of gradeProcess({ root, runId: null })) {
      assert.equal(c.status, STATUS.UNOBSERVED)
      assert.equal(c.met, false, 'an unobserved process criterion must never read as met')
    }
    // A run id that names no file is the same answer: `run-log show` exits 0
    // with no events, and no events is not a clean process record.
    for (const c of gradeProcess({ root, runId: 'no-such-run' })) {
      assert.equal(c.status, STATUS.UNOBSERVED)
      assert.equal(c.met, false)
    }
  } finally {
    removeScratchRoot(root)
  }
})
