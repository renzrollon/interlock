// What the outcome eval grades, and the commands that decide it.
//
// EVERY CRITERION HERE IS A DECISION THE CLI ALREADY MAKES. `interlock validate`
// reports the tick state of every task, `verify unit` judges a unit result
// including the weakened-suite check, `run-log check` decides reconstructability,
// and the `run-receipt` event carries the tallies. This module invokes those
// against a scratch root and records what came back. It defines no scoring
// function, no threshold and no model-graded criterion — introducing one would
// make the eval's verdict a thing to argue with rather than a thing to read.
//
// It grades the ENVIRONMENT, never the transcript. Nothing here reads what an
// agent said about itself: a run that claimed success while leaving the suite
// red grades red, because the suite was consulted and the claim was not.
//
// Four statuses, and the difference between the last two is the whole point:
//
//   pass          the decision came back clean
//   fail          the decision came back not clean
//   unobserved    the decision could not be made, and the reason is named. NOT a
//                 pass. An unknown that read as clean would flatter exactly the
//                 runs this eval exists to catch.
//   n/a           the arm structurally cannot have this criterion (the control
//                 arm has no state machine, so it has no trajectory and no
//                 receipt). NOT a failure — recording an inapplicable criterion
//                 as a failure would manufacture the result the eval tests for.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readUnitCommand } from './fixtures.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The CLI whose exit codes are the graders. */
export const INTERLOCK_BIN = join(HERE, '..', '..', 'bin', 'interlock')

/** Criterion identifiers. Stable: they are keys in a committed history record. */
export const CRITERIA = Object.freeze({
  TICKS: 'ticks-match-recorded-outcomes',
  COMMIT: 'commit-present',
  UNIT_GREEN: 'unit-suite-green',
  UNIT_NOT_WEAKENED: 'unit-suite-not-weakened',
  TRAJECTORY: 'trajectory-reconstructable',
  RECEIPT: 'receipt-observed'
})

/**
 * The criteria both arms can be graded on.
 *
 * The control arm has no planner, no state machine and no trajectory, so the
 * tick, trajectory and receipt criteria do not apply to it (design D4). The
 * arm-to-arm difference is reported over these three and over every measure —
 * the asymmetry is a property of the comparison and is stated rather than
 * averaged away.
 */
export const SHARED_CRITERIA = Object.freeze([
  CRITERIA.UNIT_GREEN,
  CRITERIA.UNIT_NOT_WEAKENED,
  CRITERIA.COMMIT
])

/** Statuses a criterion may carry. */
export const STATUS = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  UNOBSERVED: 'unobserved',
  NOT_APPLICABLE: 'n/a'
})

/** How many failure names one unit result may carry back. Bounded, like every text set here. */
const MAX_FAILURE_NAMES = 20
const MAX_FAILURE_NAME_CHARS = 120

/**
 * One graded criterion.
 *
 * `met` is the field a reader should branch on: `true` only for a pass, `null`
 * for not-applicable, `false` for everything else. It exists so that neither an
 * unobserved criterion nor an inapplicable one can be mistaken for a clean
 * result by a reader that only looked at the status string.
 */
export function criterion(id, { status, command = null, exitCode = null, detail = null, ...rest }) {
  return {
    id,
    status,
    met: status === STATUS.PASS ? true : status === STATUS.NOT_APPLICABLE ? null : false,
    // The command that decided it and the code it returned, on every criterion,
    // so a graded run can be re-derived by hand from the row alone.
    command,
    exitCode,
    detail,
    ...rest
  }
}

function messageOf(err) {
  return (err && err.message) || String(err)
}

// --- invoking the deciders --------------------------------------------------

/** Run the CLI against a scratch root. Never throws; a failure is a recorded exit. */
export function interlock(args, { cwd } = {}) {
  const argv = [INTERLOCK_BIN, ...args]
  const run = spawnSync(process.execPath, argv, { cwd, encoding: 'utf8' })
  let json = null
  if (run.stdout && run.stdout.trim()) {
    try {
      json = JSON.parse(run.stdout)
    } catch {
      // Unparseable stdout is not a decision. The exit code still is.
      json = null
    }
  }
  return {
    command: `interlock ${args.join(' ')}`,
    exitCode: run.status === null ? null : run.status,
    stdout: run.stdout || '',
    stderr: run.stderr || '',
    json,
    error: run.error ? messageOf(run.error) : null
  }
}

/**
 * Run a shell command in a directory. Used for the fixture's own unit command
 * and for git.
 *
 * `NODE_TEST_CONTEXT` is stripped, always. A `node --test` process exports it,
 * and a nested `node --test` that sees it reports itself as a subtest of the
 * outer run and EXITS ZERO however red it is. Every fixture's unit command is a
 * nested `node --test`, so inheriting that variable would make a red fixture
 * suite grade green whenever the eval was invoked from inside a test — which is
 * exactly how this grader is exercised offline. A grader that reports red as
 * green is worse than no grader.
 */
export function shell(command, { cwd, env } = {}) {
  const run = spawnSync('sh', ['-c', command], {
    cwd,
    encoding: 'utf8',
    env: { ...(env || process.env), NODE_TEST_CONTEXT: undefined },
    maxBuffer: 32 * 1024 * 1024
  })
  return {
    command,
    exitCode: run.status === null ? null : run.status,
    stdout: run.stdout || '',
    stderr: run.stderr || '',
    error: run.error ? messageOf(run.error) : null
  }
}

/**
 * Counts out of a `node:test` run's summary.
 *
 * BOTH REPORTERS, because which one a fixture's suite uses is not this eval's
 * decision and changes between Node versions: the TAP reporter prints
 * `# tests 7`, the spec reporter prints `ℹ tests 7`, and the default for a
 * non-interactive run has been each of them at different times. Reading only one
 * would make the weakened-suite check silently unavailable on half the Node
 * versions this repository supports.
 *
 * Absent when no summary was printed — `null`, never `0`. A zeroed count from an
 * unparsed run would make the weakened-suite check compare a real baseline
 * against a fabricated present, and report every run as having deleted its whole
 * suite.
 */
export function parseNodeTestCounts(output) {
  const text = typeof output === 'string' ? output : ''
  const read = key => {
    const match = text.match(new RegExp(`^[#ℹ] ${key} (\\d+)\\s*$`, 'm'))
    return match ? Number(match[1]) : null
  }
  const failures = []
  for (const line of text.split('\n')) {
    // TAP: `not ok 3 - name`. Spec: `✖ name (1.234ms)`. The spec reporter's
    // `✖ failing tests:` header carries no duration and is not a failure.
    const match = line.match(/^not ok \d+ - (.+)$/) || line.match(/^✖ (.+?) \([\d.]+m?s\)\s*$/)
    if (!match) continue
    if (failures.length >= MAX_FAILURE_NAMES) break
    failures.push(match[1].trim().slice(0, MAX_FAILURE_NAME_CHARS))
  }
  return {
    total: read('tests'),
    passed: read('pass'),
    failed: read('fail'),
    skipped: read('skipped'),
    failures
  }
}

/**
 * Run a fixture's own unit command in `root` and shape the result the way
 * `interlock verify unit` consumes it.
 *
 * The command comes from the fixture's committed testing profile and is never
 * guessed: a fixture with no profile is a defect in the apparatus, and the
 * caller is told so rather than handed `npm test`.
 */
export function runUnitCommand(fixture, root) {
  const unit = readUnitCommand(fixture)
  const started = Date.now()
  const run = shell(unit.command, { cwd: join(root, unit.cwd) })
  const counts = parseNodeTestCounts(`${run.stdout}\n${run.stderr}`)
  return {
    kind: 'unit',
    command: unit.command,
    ran: run.error ? false : true,
    ...(run.error ? { reason: run.error } : {}),
    exitCode: run.exitCode,
    total: counts.total,
    passed: counts.passed,
    failed: counts.failed,
    skipped: counts.skipped,
    failures: counts.failures,
    durationMs: Date.now() - started
  }
}

// --- the graders ------------------------------------------------------------

/**
 * Ticks match what the state machine recorded.
 *
 * Two halves, neither of them a new judgement: `interlock validate --json`
 * reports which boxes are ticked, and the run's own wave state records which
 * tasks it adjudicated as done. The criterion is the comparison — a box ticked
 * for a task the machine never recorded is the failure this exists to catch,
 * and so is a recorded task whose box was never marked.
 */
export function gradeTicks({ root, change, statePath }) {
  const validated = interlock(['validate', change, '--root', root, '--json'])
  if (!validated.json || !validated.json.tasks || !Array.isArray(validated.json.tasks.items)) {
    return criterion(CRITERIA.TICKS, {
      status: STATUS.UNOBSERVED,
      command: validated.command,
      exitCode: validated.exitCode,
      detail: `validate produced no readable task list${validated.stderr ? `: ${validated.stderr.trim().slice(0, 200)}` : ''}`
    })
  }

  const ticked = validated.json.tasks.items.filter(t => t.done).map(t => t.id).sort()

  const state = statePath || join(root, '.claude', 'ship', 'state.json')
  let recorded = null
  let reason = null
  try {
    if (existsSync(state)) {
      const parsed = JSON.parse(readFileSync(state, 'utf8'))
      recorded = Array.isArray(parsed.completed) ? [...parsed.completed].sort() : null
      if (!recorded) reason = 'the run state records no completed list'
    } else {
      reason = `no wave state at ${state} — the run never reached the state machine`
    }
  } catch (err) {
    reason = messageOf(err)
  }

  if (!recorded) {
    return criterion(CRITERIA.TICKS, {
      status: STATUS.UNOBSERVED,
      command: validated.command,
      exitCode: validated.exitCode,
      detail: `the ticked set was read but the recorded set was not: ${reason}`,
      ticked
    })
  }

  const tickedNotRecorded = ticked.filter(id => !recorded.includes(id))
  const recordedNotTicked = recorded.filter(id => !ticked.includes(id))
  const matches = tickedNotRecorded.length === 0 && recordedNotTicked.length === 0
  return criterion(CRITERIA.TICKS, {
    status: matches ? STATUS.PASS : STATUS.FAIL,
    command: validated.command,
    exitCode: validated.exitCode,
    detail: matches
      ? `${ticked.length} task(s) ticked, matching what the run recorded`
      : `ticked but not recorded: ${tickedNotRecorded.join(', ') || 'none'}; ` +
        `recorded but not ticked: ${recordedNotTicked.join(', ') || 'none'}`,
    ticked,
    recorded,
    tickedNotRecorded,
    recordedNotTicked
  })
}

/**
 * A commit exists, cross-checked against the receipt.
 *
 * `expectCommit: false` is the run that was invoked so as to make none — then
 * the absence IS the pass, and a commit is the failure. The two are different
 * questions and the flag is the only thing that tells them apart.
 */
export function gradeCommit({ root, baselineCommit, expectCommit = true, receipt = null }) {
  const log = shell(`git log --format=%H ${baselineCommit ? `${baselineCommit}..HEAD` : 'HEAD'}`, {
    cwd: root
  })
  if (log.exitCode !== 0) {
    return criterion(CRITERIA.COMMIT, {
      status: STATUS.UNOBSERVED,
      command: `git log (in the scratch root)`,
      exitCode: log.exitCode,
      detail: `the scratch repository's log could not be read: ${(log.stderr || log.error || '').trim().slice(0, 200)}`
    })
  }
  const shas = log.stdout.split('\n').map(s => s.trim()).filter(Boolean)
  const head = shas[0] || null

  if (!expectCommit) {
    return criterion(CRITERIA.COMMIT, {
      status: shas.length === 0 ? STATUS.PASS : STATUS.FAIL,
      command: log.command,
      exitCode: log.exitCode,
      detail:
        shas.length === 0
          ? 'the run was invoked so as to make no commit, and none exists'
          : `the run was invoked so as to make no commit, and ${shas.length} exist`,
      commits: shas.length
    })
  }

  if (shas.length === 0) {
    return criterion(CRITERIA.COMMIT, {
      status: STATUS.FAIL,
      command: log.command,
      exitCode: log.exitCode,
      detail: 'no commit exists past the fixture baseline',
      commits: 0
    })
  }

  // The cross-check is reported, never merged into the verdict: a receipt that
  // did not observe a commit sha is a fact about the receipt, and grading the
  // commit's existence on it would let a bookkeeping gap read as missing work.
  const receiptSha = receipt && typeof receipt.commit === 'string' ? receipt.commit : null
  const agrees = receiptSha ? shas.includes(receiptSha) : null
  return criterion(CRITERIA.COMMIT, {
    status: STATUS.PASS,
    command: log.command,
    exitCode: log.exitCode,
    detail:
      `${shas.length} commit(s) past the baseline; ` +
      (receiptSha
        ? agrees
          ? `the receipt names ${receiptSha.slice(0, 12)}, which is one of them`
          : `the receipt names ${receiptSha.slice(0, 12)}, which is NOT among them`
        : 'the receipt recorded no commit identifier to cross-check against'),
    commits: shas.length,
    head,
    receiptCommit: receiptSha,
    receiptAgrees: agrees
  })
}

/**
 * The unit suite, judged by the same decision the loop itself uses.
 *
 * Two criteria come out of one judgement, because the two questions are
 * different: whether the suite is green, and whether it got there by shrinking.
 * `interlock verify unit` decides both — the weakened-suite check is the loop's
 * own, run against the fixture's committed baseline counts, and this eval
 * defines no additional judgement to catch a weakened test.
 */
export function gradeUnit({ root, fixture, baselineCounts, resultPath }) {
  let result
  try {
    result = runUnitCommand(fixture, root)
  } catch (err) {
    const detail = messageOf(err)
    return {
      criteria: [
        criterion(CRITERIA.UNIT_GREEN, {
          status: STATUS.UNOBSERVED,
          detail: `the fixture's unit command could not be run: ${detail}`
        }),
        criterion(CRITERIA.UNIT_NOT_WEAKENED, {
          status: STATUS.UNOBSERVED,
          detail: `the fixture's unit command could not be run: ${detail}`
        })
      ],
      result: null,
      judgement: null
    }
  }

  const dir = resultPath || join(root, '..')
  const resultFile = join(dir, 'unit-result.json')
  const baselineFile = join(dir, 'unit-baseline.json')
  writeFileSync(resultFile, `${JSON.stringify(result)}\n`)
  const hasBaseline = Boolean(baselineCounts)
  if (hasBaseline) writeFileSync(baselineFile, `${JSON.stringify(baselineCounts)}\n`)

  const judged = interlock([
    'verify',
    'unit',
    '--result',
    resultFile,
    ...(hasBaseline ? ['--baseline', baselineFile] : []),
    '--root',
    root,
    '--json'
  ])
  const judgement = judged.json

  const green = criterion(CRITERIA.UNIT_GREEN, {
    status: judged.exitCode === 0 ? STATUS.PASS : STATUS.FAIL,
    command: judged.command,
    exitCode: judged.exitCode,
    detail: judgement
      ? `${judgement.status}: ${judgement.reason}`
      : `verify unit produced no readable judgement${judged.stderr ? `: ${judged.stderr.trim().slice(0, 200)}` : ''}`,
    counts: {
      total: result.total,
      passed: result.passed,
      failed: result.failed,
      skipped: result.skipped
    }
  })

  // Read off the same judgement rather than re-derived: `weakenedCheck` is the
  // loop's own report of whether it could look, and `unavailable` is an
  // unobserved criterion — never a pass.
  const check = judgement ? judgement.weakenedCheck : null
  const weakened = judgement ? judgement.weakened : null
  const notWeakened = criterion(CRITERIA.UNIT_NOT_WEAKENED, {
    status:
      check === 'ok' ? (weakened ? STATUS.FAIL : STATUS.PASS) : STATUS.UNOBSERVED,
    command: judged.command,
    exitCode: judged.exitCode,
    detail:
      check === 'ok'
        ? weakened
          ? `suite was weakened: ${weakened.detail}`
          : 'no test was removed and no test was newly skipped, against the fixture baseline'
        : hasBaseline
          ? 'the weakened-suite check could not run — the suite printed no parseable counts'
          : 'the weakened-suite check could not run — no baseline counts were supplied',
    weakened: weakened || null
  })

  return { criteria: [green, notWeakened], result, judgement }
}

/** The run's trajectory is reconstructable, decided by `interlock run-log check`. */
export function gradeTrajectory({ root, runId }) {
  if (!runId) {
    return criterion(CRITERIA.TRAJECTORY, {
      status: STATUS.UNOBSERVED,
      detail: 'the run wrote no trajectory, so there is no run id to check'
    })
  }
  const checked = interlock(['run-log', 'check', '--run-id', runId, '--root', root, '--json'])
  return criterion(CRITERIA.TRAJECTORY, {
    status: checked.exitCode === 0 ? STATUS.PASS : STATUS.FAIL,
    command: checked.command,
    exitCode: checked.exitCode,
    detail:
      checked.json && Array.isArray(checked.json.problems) && checked.json.problems.length
        ? checked.json.problems.join('; ').slice(0, 300)
        : checked.exitCode === 0
          ? 'the run is reconstructable from its trajectory'
          : `run-log check exited ${checked.exitCode}`,
    runId
  })
}

/**
 * The fields a receipt must carry as observed values for the run to have
 * accounted for itself.
 *
 * Two of them can carry an unknown and two cannot. `lib/run-log.mjs` writes
 * `waves` and `leftoverTaskIds` through array coercions, so an empty array IS
 * the observation "none" and their presence is all this can check. `spend`
 * (`outputTokens`) and `remediationRounds` are written `nullable`, so `null`
 * there means the run never found out — and that is where this criterion bites.
 *
 * On a host with no token accounting `spend` is absent WITH ITS REASON, which is
 * a fact about that host specified in `ship-run`, not a defect in the run. It
 * still fails this criterion, because an unknown that read as clean is the error
 * this whole eval exists to avoid. The criterion names the field, not the run.
 */
export const RECEIPT_FIELDS = Object.freeze([
  { field: 'waves', label: 'wave tallies' },
  { field: 'outputTokens', label: 'spend' },
  { field: 'remediationRounds', label: 'remediation rounds' },
  { field: 'leftoverTaskIds', label: 'leftover task ids' }
])

/** Whether one receipt field was observed. `null`/absent is unobserved; `0` and `[]` are values. */
function observedField(receipt, field) {
  if (!receipt || !Object.prototype.hasOwnProperty.call(receipt, field)) return false
  const value = receipt[field]
  return value !== null && value !== undefined
}

/** The receipt is present and its tallies, spend, rounds and leftovers are observed values. */
export function gradeReceipt({ root, runId }) {
  if (!runId) {
    return {
      criterion: criterion(CRITERIA.RECEIPT, {
        status: STATUS.UNOBSERVED,
        detail: 'the run wrote no trajectory, so it wrote no receipt'
      }),
      receipt: null
    }
  }
  const queried = interlock([
    'run-log',
    'query',
    '--run',
    runId,
    '--type',
    'run-receipt',
    '--root',
    root,
    '--json'
  ])
  const records = queried.json && Array.isArray(queried.json.records) ? queried.json.records : []
  const receipt = records.length ? records[records.length - 1] : null

  if (!receipt) {
    return {
      criterion: criterion(CRITERIA.RECEIPT, {
        status: STATUS.FAIL,
        command: queried.command,
        exitCode: queried.exitCode,
        detail: 'the run recorded no run-receipt event'
      }),
      receipt: null
    }
  }

  const unobserved = RECEIPT_FIELDS.filter(f => !observedField(receipt, f.field))
  return {
    criterion: criterion(CRITERIA.RECEIPT, {
      status: unobserved.length ? STATUS.UNOBSERVED : STATUS.PASS,
      command: queried.command,
      exitCode: queried.exitCode,
      detail: unobserved.length
        ? `the receipt is present but ${unobserved.map(f => f.label).join(', ')} ` +
          `${unobserved.length === 1 ? 'was' : 'were'} never observed — recorded absent, not clean`
        : 'the receipt carries tallies, spend, remediation rounds and leftover ids as observed values',
      unobservedFields: unobserved.map(f => f.field)
    }),
    receipt
  }
}

/**
 * Grade one arm's scratch root.
 *
 * `arm: 'control'` marks the three criteria the control arm structurally cannot
 * have as not-applicable rather than running them: the control has no planner,
 * no state machine and no trajectory, and a criterion recorded as failed for
 * lacking a mechanism it was defined not to have would manufacture exactly the
 * difference the eval is measuring.
 */
export function gradeArm({
  root,
  fixture,
  arm = 'loop',
  runId = null,
  baselineCommit = null,
  baselineCounts = null,
  expectCommit = true,
  workDir = null
}) {
  const criteria = []

  let receipt = null
  if (arm === 'control') {
    for (const [id, why] of [
      [
        CRITERIA.TICKS,
        'the control arm has no state machine, so no recorded outcome set exists to compare the ticks against'
      ],
      [CRITERIA.TRAJECTORY, 'the control arm runs no ship loop, so it writes no trajectory'],
      [CRITERIA.RECEIPT, 'the control arm runs no ship loop, so it writes no receipt']
    ]) {
      criteria.push(criterion(id, { status: STATUS.NOT_APPLICABLE, detail: why }))
    }
  } else {
    criteria.push(gradeTicks({ root, change: fixture.change }))
    criteria.push(gradeTrajectory({ root, runId }))
    const graded = gradeReceipt({ root, runId })
    criteria.push(graded.criterion)
    receipt = graded.receipt
  }

  const unit = gradeUnit({ root, fixture, baselineCounts, resultPath: workDir })
  criteria.push(...unit.criteria)
  criteria.push(gradeCommit({ root, baselineCommit, expectCommit, receipt }))

  // Ordered for a reader, not by when they were computed.
  const order = [
    CRITERIA.TICKS,
    CRITERIA.UNIT_GREEN,
    CRITERIA.UNIT_NOT_WEAKENED,
    CRITERIA.COMMIT,
    CRITERIA.TRAJECTORY,
    CRITERIA.RECEIPT
  ]
  criteria.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))

  // The graded set names its arm. Two arms produce different criteria sets from
  // the same function, and a set that did not say which arm produced it could be
  // read as a loop result with three criteria mysteriously missing.
  return { arm, criteria, receipt, unit: unit.result, judgement: unit.judgement }
}

/** Tally criteria without issuing a verdict: counts and a denominator, nothing else. */
export function tallyCriteria(criteria) {
  const list = Array.isArray(criteria) ? criteria : []
  const applicable = list.filter(c => c.met !== null)
  return {
    met: applicable.filter(c => c.met === true).length,
    applicable: applicable.length,
    notApplicable: list.length - applicable.length,
    unobserved: list.filter(c => c.status === STATUS.UNOBSERVED).length
  }
}
