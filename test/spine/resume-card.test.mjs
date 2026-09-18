// The halt resume card, called rather than grepped.
//
// The card is the one artifact a halted run leaves for a reader who was not
// watching, so the properties under test are the ones that make it safe to
// leave lying around: it never throws, it never invents a verdict about a future
// run, it never silently truncates a list, and its filename cannot escape the
// handoff directory.

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LIMITS } from '../../lib/limits.mjs'
import {
  HANDOFF_DIR,
  NO_RUN_ID,
  RESUME_CARD_SCHEMA,
  formatResumeCard,
  resumeCardPath,
  writeResumeCard
} from '../../lib/resume-card.mjs'

let tmp

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'interlock-resume-card-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

const HALTED = {
  change: 'add-widget',
  runId: 'run-20260918-abc',
  halted: 'unresolved blockers after two remediation rounds',
  leftoverTaskIds: ['1.2', '1.4'],
  plan: { reused: true, status: 'match', reason: 'the fingerprint matched' },
  planStored: true,
  waves: [{ wave: 1, kind: 'implement', ok: 2, failed: 1 }],
  degradations: ['NO TEST PROFILE: inferred'],
  projectSlug: '-Users-dev-thing',
  cwd: '/Users/dev/thing'
}

// --- the path ---------------------------------------------------------------

test('the card is named for its change and its run, under the handoff directory', () => {
  assert.equal(
    resumeCardPath({ change: 'add-widget', runId: 'run-1' }),
    join(HANDOFF_DIR, 'ship-add-widget-run-1.md')
  )
})

test('a run that halted before a plan was adopted still gets a named card', () => {
  // There is no run id yet, and that absence is itself the fact. A clock-derived
  // name would accumulate one file per failed invocation instead.
  assert.equal(
    resumeCardPath({ change: 'add-widget' }),
    join(HANDOFF_DIR, `ship-add-widget-${NO_RUN_ID}.md`)
  )
})

test('a change name or run id cannot escape the handoff directory', () => {
  // Both reach the close from a branch, a directory or a model. A `../` here
  // would write the card somewhere other than `.claude/handoff`.
  const path = resumeCardPath({ change: '../../etc/passwd', runId: 'a/b/../c' })
  assert.equal(path.includes('..'), false, path)
  assert.equal(path.startsWith(HANDOFF_DIR), true, path)
})

// --- the body ---------------------------------------------------------------

test('the card names the halt reason, the run, the leftover ids and the next command', () => {
  const text = formatResumeCard(HALTED)
  assert.match(text, new RegExp(RESUME_CARD_SCHEMA.replace('/', '\\/')))
  assert.match(text, /# Ship halted — add-widget/)
  assert.match(text, /unresolved blockers after two remediation rounds/)
  assert.match(text, /run-20260918-abc/)
  assert.match(text, /interlock run-log show run-20260918-abc/)
  assert.match(text, /`1\.2`/)
  assert.match(text, /`1\.4`/)
  assert.match(text, /interlock tasks tick add-widget --ids 1\.2,1\.4/)
  assert.match(text, /\/interlock:ship add-widget/)
  assert.match(text, /wave 1 \(implement\): 2 ok, 1 failed/)
  assert.match(text, /NO TEST PROFILE: inferred/)
})

test('the card says it is a record, not a trigger, and forbids a self-started retry', () => {
  // The whole hazard of a markdown file called a "resume" artifact is that a
  // reader — human or model — assumes something consumes it. Nothing does.
  const text = formatResumeCard(HALTED)
  assert.match(text, /record, not a trigger/)
  assert.match(text, /Do not start another ship run unless the user asks/)
  assert.match(text, /never from this card/)
})

test('the card reports what is stored and never predicts the next reuse verdict', () => {
  // The fingerprint is recomputed at the next `run start`, against artifacts
  // that may change in between. A card that guessed would be wrong exactly when
  // a reader was relying on it.
  const stored = formatResumeCard(HALTED)
  assert.match(stored, /plan-fingerprint\.json/)
  assert.match(stored, /only if a fingerprint recomputed from the current/)
  assert.doesNotMatch(stored, /will be reused|will reuse|guaranteed/i)

  const none = formatResumeCard({ ...HALTED, planStored: false })
  assert.match(none, /No stored plan on disk names this change/)
  assert.doesNotMatch(none, /plan-fingerprint\.json/)
})

test('a plan-reuse verdict this run never reached is reported as unobserved, not as rebuilt', () => {
  const text = formatResumeCard({ ...HALTED, plan: null })
  assert.match(text, /ended before the plan-reuse check reported/)
  assert.doesNotMatch(text, /This run \*\*rebuilt\*\*/)
})

test('an empty run reports each absence rather than printing an empty section', () => {
  const text = formatResumeCard({
    change: 'add-widget',
    halted: 'the change could not be validated',
    leftoverTaskIds: [],
    waves: [],
    degradations: []
  })
  assert.match(text, /Every box in `openspec\/changes\/add-widget\/tasks\.md` is ticked/)
  assert.match(text, /No wave was recorded/)
  assert.match(text, /No degradation banners were raised/)
  assert.match(text, /run: none — the run halted before a plan was adopted/)
  // With no run id there is no trajectory to point at, so it must not print a
  // `run-log show` line naming an id that does not exist.
  assert.doesNotMatch(text, /interlock run-log show/)
})

test('a halt with no recorded reason says so rather than printing a blank', () => {
  const text = formatResumeCard({ change: 'add-widget', halted: null })
  assert.match(text, /halted without recording a reason/)
})

test('every list is capped at the published cap and states what it left out', () => {
  const ids = Array.from({ length: LIMITS.resumeCardListRows + 5 }, (_, i) => `1.${i + 1}`)
  const text = formatResumeCard({ ...HALTED, leftoverTaskIds: ids })
  assert.match(text, /and 5 more/)
  assert.match(text, /tasks\.md/)
  assert.equal(text.includes(`\`${ids[LIMITS.resumeCardListRows - 1]}\``), true, 'the last kept id')
  assert.equal(text.includes(`\`${ids[LIMITS.resumeCardListRows]}\``), false, 'the first dropped id')
})

test('an oversized halt reason is truncated visibly, never silently', () => {
  const text = formatResumeCard({ ...HALTED, halted: 'x'.repeat(4000) })
  assert.match(text, /\(truncated\)/)
  assert.ok(text.length < 4000, 'the reason must not be printed in full')
})

// --- the write --------------------------------------------------------------

test('writing the card creates the handoff directory and returns the repo-relative path', () => {
  const written = writeResumeCard(tmp, HALTED)
  assert.equal(written.written, true)
  assert.equal(written.reason, null)
  assert.equal(written.path, join(HANDOFF_DIR, 'ship-add-widget-run-20260918-abc.md'))
  assert.equal(existsSync(join(tmp, written.path)), true)
  assert.match(readFileSync(join(tmp, written.path), 'utf8'), /# Ship halted — add-widget/)
})

test('a second close of the same run replaces its own card rather than adding one', () => {
  writeResumeCard(tmp, HALTED)
  const again = writeResumeCard(tmp, { ...HALTED, halted: 'the second reason' })
  assert.equal(again.written, true)
  const text = readFileSync(join(tmp, again.path), 'utf8')
  assert.match(text, /the second reason/)
  assert.doesNotMatch(text, /unresolved blockers/)
})

test('an unwritable tree reports a reason and never throws', () => {
  // The run already halted. Losing its card must not change how it halted, so
  // the caller gets a reason it can banner, never an exception.
  const readonly = join(tmp, 'readonly')
  mkdirSync(readonly)
  chmodSync(readonly, 0o500)
  try {
    const written = writeResumeCard(readonly, HALTED)
    assert.equal(written.written, false)
    assert.equal(written.path, null)
    assert.equal(typeof written.reason, 'string')
    assert.ok(written.reason.length > 0)
  } finally {
    chmodSync(readonly, 0o700)
  }
})

test('a missing or empty root is refused by name rather than by exception', () => {
  assert.deepEqual(writeResumeCard('', HALTED), {
    written: false,
    path: null,
    reason: 'no root directory given'
  })
  const gone = join(tmp, 'does-not-exist')
  const written = writeResumeCard(gone, HALTED)
  assert.equal(written.written, false)
  assert.match(written.reason, /root does not exist/)
})
