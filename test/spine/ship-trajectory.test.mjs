// The outcome eval's process walker (spec: evals/outcome-run).
//
// Offline throughout: no live ship, no network, no model, no credential. Every
// trajectory here is planted through `lib/run-log.mjs`'s own writer, exactly as
// `evals/ship/sample/clean-run.json` is, so a planted log cannot drift from the
// shape a real run produces — if the writer changes, these change with it or the
// test fails.
//
// The load-bearing assertion is the SPLIT: every planted run below passes
// `interlock run-log check`, so a process failure recorded here is a process
// failure and never reconstructability wearing a different hat. A walker that
// only ever failed logs the reconstructability gate already rejected would be
// measuring nothing new.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACTIONS } from '../../lib/run.mjs'
import { RUN_LOG_TYPES, appendRunLogEvent, readRunLog } from '../../lib/run-log.mjs'
import { STATUS } from '../../evals/ship/graders.mjs'
import {
  COMPLETED_REQUIRED_TYPES,
  HALTING_UNIT_STATUSES,
  PROCESS_CRITERIA,
  PROCESS_STATUSES,
  walkTrajectory
} from '../../evals/ship/trajectory.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(ROOT, 'bin', 'interlock')
const SAMPLE = JSON.parse(
  readFileSync(join(ROOT, 'evals', 'ship', 'sample', 'process-runs.json'), 'utf8')
)

/** The status of one finding out of a walked set. */
function statusOf(findings, id) {
  const found = findings.find(f => f.id === id)
  return found ? found.status : `(no ${id} finding)`
}

/**
 * Lay one named sample run down in a throwaway root and read it back through
 * the same reader the grader uses.
 *
 * Returns the records AND the reconstructability exit code, because the two
 * together are what the split is asserted on.
 */
function plant(name) {
  const runs = SAMPLE.runs
  assert.ok(runs[name], `evals/ship/sample/process-runs.json has no run named "${name}"`)
  const root = mkdtempSync(join(tmpdir(), 'interlock-process-'))
  try {
    for (const event of runs[name].events) {
      const written = appendRunLogEvent(root, { runId: name, change: 'sample-change', ...event })
      assert.equal(written.written, true, `planting ${name}: ${event.type} not written — ${written.reason}`)
    }
    const checked = spawnSync(
      process.execPath,
      [BIN, 'run-log', 'check', '--run-id', name, '--root', root, '--json'],
      { cwd: ROOT, encoding: 'utf8' }
    )
    return {
      records: readRunLog(root, name).records,
      checkExit: checked.status,
      checkOut: checked.stdout,
      expect: runs[name].expect
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('the walker reports the same statuses the disk graders use', () => {
  // The one thing a literal in `trajectory.mjs` could get wrong. It spells its
  // statuses rather than importing them (importing `graders.mjs` from a module
  // `graders.mjs` imports would be a cycle), so the two are pinned together
  // here instead.
  for (const status of PROCESS_STATUSES) {
    assert.ok(
      Object.values(STATUS).includes(status),
      `the walker reports "${status}", which is not a status the graders know`
    )
  }
  // And `n/a` is NOT among them: not-applicable is the arm's property, applied
  // by the grader on the control arm, never a verdict the walker can reach.
  assert.equal(PROCESS_STATUSES.includes(STATUS.NOT_APPLICABLE), false)
})

test('the allowed sets are the ones their own modules own, not copies', () => {
  // The whole point of D2. A copied list would drift the first time the run
  // program gained a tail step, and the drift would surface as the eval failing
  // runs that were correct.
  for (const type of COMPLETED_REQUIRED_TYPES) {
    assert.ok(RUN_LOG_TYPES.includes(type), `${type} is required of a completed run but the writer would refuse it`)
  }
  // The two types reconstructability already requires are deliberately NOT
  // re-asserted here — one defect must not be reported as two.
  for (const type of ['run-start', 'run-halt', 'run-complete']) {
    assert.equal(
      COMPLETED_REQUIRED_TYPES.includes(type),
      false,
      `${type} is checked by run-log check and must not be re-asserted as a process criterion`
    )
  }
  assert.ok(ACTIONS.includes('run-batch'), 'the action vocabulary was not imported from the run program')
  assert.equal(ACTIONS.includes('report'), false, '"report" must remain an invented action for this eval to mean anything')
})

test('every planted process trajectory is reconstructable, so the two checks stay distinct', () => {
  for (const name of Object.keys(SAMPLE.runs)) {
    const { checkExit, checkOut } = plant(name)
    assert.equal(
      checkExit,
      0,
      `the planted run "${name}" does not pass run-log check (${checkOut}) — a process fixture that ` +
        `fails reconstructability proves nothing about the process criteria`
    )
  }
})

test('each planted trajectory walks to the statuses it declares', () => {
  for (const [name, run] of Object.entries(SAMPLE.runs)) {
    const { records, expect } = plant(name)
    const findings = walkTrajectory(records)
    assert.equal(findings.length, 3, `${name}: the walker must decide all three process criteria`)
    for (const [id, wanted] of Object.entries(expect)) {
      assert.equal(
        statusOf(findings, id),
        wanted,
        `${name}: ${id} — ${run.note}\n  ${findings.find(f => f.id === id)?.detail}`
      )
    }
  }
})

test('a completed run missing a required type fails required-types and names it', () => {
  const { records } = plant('complete-missing-verify')
  const required = walkTrajectory(records).find(f => f.id === PROCESS_CRITERIA.REQUIRED_TYPES)
  assert.equal(required.status, STATUS.FAIL)
  assert.deepEqual(required.missingTypes, ['verify-judgement'])
  assert.equal(required.close, 'run-complete')
})

test('a halted run is not failed for the types only a completed ship emits', () => {
  const { records } = plant('halt-before-verify')
  const findings = walkTrajectory(records)
  const required = findings.find(f => f.id === PROCESS_CRITERIA.REQUIRED_TYPES)
  assert.equal(required.status, STATUS.PASS)
  assert.deepEqual(required.missingTypes, [], 'a run-halt close is held to no completed-ship types')
  // And the halt criterion passes on its own terms: there was no unit-red
  // decision to honour, which is a different fact from having honoured one.
  const halt = findings.find(f => f.id === PROCESS_CRITERIA.HALT_ON_UNIT_RED)
  assert.equal(halt.status, STATUS.PASS)
  assert.equal(halt.haltingJudgements, 0)
})

test('an unknown event type fails required-types', () => {
  // Hand-built rather than planted: `appendRunLogEvent` REFUSES a type it does
  // not accept, so this line could only reach a trajectory by a hand edit or a
  // corrupted file — which is exactly the case the criterion exists for.
  const records = [
    { seq: 1, type: 'run-start', mode: 'continue' },
    { seq: 2, type: 'wave-summary', action: 'run-batch' },
    { seq: 3, type: 'run-halt', reason: 'stopped' }
  ]
  const required = walkTrajectory(records).find(f => f.id === PROCESS_CRITERIA.REQUIRED_TYPES)
  assert.equal(required.status, STATUS.FAIL)
  assert.deepEqual(required.unknownTypes, ['wave-summary'])
})

test('an invented action fails known-actions and names the event that carried it', () => {
  const { records } = plant('unknown-action')
  const findings = walkTrajectory(records)
  const known = findings.find(f => f.id === PROCESS_CRITERIA.KNOWN_ACTIONS)
  assert.equal(known.status, STATUS.FAIL)
  assert.equal(known.unknownActions.length, 1)
  assert.equal(known.unknownActions[0].action, 'report')
  assert.equal(known.unknownActions[0].type, 'wave-action')
  assert.match(known.detail, /report/)

  // The other two are unmoved: an invented action is one defect, not three.
  assert.equal(statusOf(findings, PROCESS_CRITERIA.REQUIRED_TYPES), STATUS.PASS)
  assert.equal(statusOf(findings, PROCESS_CRITERIA.HALT_ON_UNIT_RED), STATUS.PASS)
})

test('an action recorded as absent is unknown, never allowed through as nothing-said', () => {
  // `lib/run-log.mjs` writes `action: null` when its caller supplied none. The
  // writer's callers always have a step action, so a null here means something
  // upstream lost it — and an absent value read as allowed would be the one
  // shape an invented action could hide behind.
  const records = [
    { seq: 1, type: 'run-start' },
    { seq: 2, type: 'wave-action', action: null },
    { seq: 3, type: 'run-halt', reason: 'stopped' }
  ]
  const known = walkTrajectory(records).find(f => f.id === PROCESS_CRITERIA.KNOWN_ACTIONS)
  assert.equal(known.status, STATUS.FAIL)
  assert.equal(known.unknownActions[0].action, null)
})

test('every halting unit status the CLI records forbids a run-complete close', () => {
  // All three, not just `red`: `error` and `weakened` halt the loop too, and a
  // walker that only knew `red` would pass a run that shipped past a weakened
  // suite.
  for (const unitStatus of HALTING_UNIT_STATUSES) {
    const records = [
      { seq: 1, type: 'run-start' },
      { seq: 2, type: 'verify-judgement', halt: true, unitStatus },
      { seq: 3, type: 'run-complete', leftoverTaskIds: [] }
    ]
    const halt = walkTrajectory(records).find(f => f.id === PROCESS_CRITERIA.HALT_ON_UNIT_RED)
    assert.equal(halt.status, STATUS.FAIL, `a ${unitStatus} judgement closed with run-complete must fail`)
    assert.match(halt.detail, new RegExp(unitStatus))
  }

  // And the statuses that do NOT halt are not read as red. A suite that was
  // already red before the run touched it is not a run that ignored a verdict.
  for (const unitStatus of ['green', 'red-pre-existing']) {
    const records = [
      { seq: 1, type: 'run-start' },
      { seq: 2, type: 'verify-judgement', halt: false, unitStatus },
      { seq: 3, type: 'run-complete', leftoverTaskIds: [] }
    ]
    const halt = walkTrajectory(records).find(f => f.id === PROCESS_CRITERIA.HALT_ON_UNIT_RED)
    assert.equal(halt.status, STATUS.PASS, `${unitStatus} is not a halting unit status`)
  }
})

test('the walker never re-judges redness — it reads the status the CLI recorded', () => {
  // A judgement whose recorded status is green is green here, however the rest
  // of the event reads. Deciding otherwise would make the eval a second judge of
  // a question the loop already answered, which is the one thing D4 forbids.
  const records = [
    { seq: 1, type: 'run-start' },
    { seq: 2, type: 'verify-judgement', halt: true, unitStatus: 'green', reason: 'halted for a review blocker' },
    { seq: 3, type: 'run-complete', leftoverTaskIds: [] }
  ]
  const halt = walkTrajectory(records).find(f => f.id === PROCESS_CRITERIA.HALT_ON_UNIT_RED)
  assert.equal(halt.status, STATUS.PASS)
  assert.equal(halt.haltingJudgements, 0)
})

test('implementer tool order is not a criterion', () => {
  // Same required types, same allowed actions, different order of the spawns
  // between them. The walker checks presence; a golden sequence would fail
  // honest runs that replanned.
  const shape = spawns => [
    { seq: 1, type: 'run-start' },
    { seq: 2, type: 'wave-action', action: 'run-batch' },
    { seq: 3, type: 'cli-exit', command: 'wave-state create', exitCode: 0 },
    ...spawns.map((label, i) => ({ seq: 4 + i, type: 'agent-spawn', label, kind: 'implementer' })),
    { seq: 6, type: 'verify-judgement', halt: false, unitStatus: 'green' },
    { seq: 7, type: 'cli-exit', command: 'verify judge', exitCode: 0 },
    { seq: 8, type: 'run-complete', leftoverTaskIds: [] },
    { seq: 9, type: 'run-receipt', waves: [] }
  ]
  const forwards = walkTrajectory(shape(['impl 1.1', 'impl 1.2'])).map(f => f.status)
  const backwards = walkTrajectory(shape(['impl 1.2', 'impl 1.1'])).map(f => f.status)
  assert.deepEqual(forwards, backwards)
  assert.deepEqual(forwards, [STATUS.PASS, STATUS.PASS, STATUS.PASS])
})

test('a missing trajectory leaves all three unobserved, never passing', () => {
  for (const records of [[], null, undefined, ['not an object']]) {
    const findings = walkTrajectory(records)
    assert.equal(findings.length, 3)
    for (const f of findings) {
      assert.equal(f.status, STATUS.UNOBSERVED, `${f.id} must be unobserved when there are no events`)
      assert.match(f.detail, /unobserved, not clean/)
    }
  }
})
