// The halt resume card, called rather than grepped.
//
// The card is the one artifact a halted run leaves for a reader who was not
// watching, so the properties under test are the ones that make it safe to
// leave lying around: it never throws, it never invents a verdict about a future
// run, it never silently truncates a list, and its filename cannot escape the
// handoff directory.

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIMITS } from '../../lib/limits.mjs'
import {
  HANDOFF_DIR,
  NO_RUN_ID,
  RESUME_CARD_SCHEMA,
  formatResumeCard,
  resumeCardPath,
  writeResumeCard
} from '../../lib/resume-card.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Every file under `dir` with one of these extensions, recursively. */
function sourcesUnder(dir, exts) {
  const out = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourcesUnder(abs, exts))
    else if (exts.some(e => entry.name.endsWith(e))) out.push(abs)
  }
  return out
}

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
  assert.match(text, /interlock tasks tick add-widget --ids /)
  assert.match(text, /\/interlock:ship add-widget/)
  assert.match(text, /wave 1 \(implement\): 2 ok, 1 failed/)
  assert.match(text, /NO TEST PROFILE: inferred/)
})

test('the tick command is never paste-ready over the whole leftover list', () => {
  // `interlock tasks tick` is mechanical — it flips a marker by id and verifies
  // nothing. Most leftover ids on a halt were never dispatched, so a command
  // carrying all of them would tick unimplemented work and delete the only
  // on-disk record of what remains. That is the exact outcome the halt which
  // writes this card exists to prevent.
  const text = formatResumeCard(HALTED)
  assert.doesNotMatch(
    text,
    /--ids\s+1\.2,1\.4/,
    'the leftover ids must not be interpolated into a runnable tick command'
  )
  assert.match(text, /--ids <the ids above you verified are done>/, 'a placeholder the reader must fill')
  assert.match(text, /only\*\* the ones you have checked are implemented/i)
})

test('nothing reads the card back, so a hand-edited one cannot change a later run', () => {
  // spec: ship/halt-resume-card — "Failure — a hand-edited card does not change
  // a later run". design.md calls this "the whole hazard", and it was the one
  // property with no test: every existing case would still pass the day someone
  // adds a "resume from the card" convenience to dispatch.
  //
  // Asserted structurally rather than behaviourally, because the claim is an
  // ABSENCE — there is no call to observe. Two halves: the writer has exactly
  // one importer, and no other source reads the directory without the
  // `explore-` prefix that separates briefs from halt cards.
  const sources = [
    ...sourcesUnder(join(ROOT, 'lib'), ['.mjs']),
    ...sourcesUnder(join(ROOT, 'bin'), ['']).filter(f => /interlock/.test(f)),
    ...sourcesUnder(join(ROOT, 'workflows'), ['.js', '.mjs']),
    ...sourcesUnder(join(ROOT, 'hooks'), ['.mjs'])
  ]
  assert.ok(sources.length >= 20, `expected to sweep the source tree, found ${sources.length} files`)

  const importers = sources.filter(
    abs => abs !== join(ROOT, 'lib', 'resume-card.mjs') && /from ['"].*resume-card\.mjs['"]/.test(readFileSync(abs, 'utf8'))
  )
  assert.deepEqual(
    importers.map(f => f.slice(ROOT.length + 1)),
    ['lib/run.mjs'],
    'only the close may import the card writer — a second importer is a consumer'
  )
  assert.match(
    readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8'),
    /import \{ writeResumeCard \} from '\.\/resume-card\.mjs'/,
    'and it imports the WRITER only, never a reader'
  )
  assert.doesNotMatch(
    readFileSync(join(ROOT, 'lib', 'resume-card.mjs'), 'utf8'),
    /readFileSync|readdirSync/,
    'the module itself must not grow a read path'
  )

  // The prose half: any handoff pointer that would match `ship-*` would hand a
  // model a halt card as session context. `skills/` and `shared/` are swept by
  // test/skills.test.mjs; this covers the executable surfaces.
  const offenders = []
  for (const abs of sources) {
    for (const [, glob] of readFileSync(abs, 'utf8').matchAll(/\.claude\/handoff\/([^\s`)"'*]*)/g)) {
      if (glob && !glob.startsWith('explore-') && !glob.startsWith('ship-')) {
        offenders.push(`${abs.slice(ROOT.length + 1)}: .claude/handoff/${glob}`)
      }
    }
  }
  assert.deepEqual(offenders, [], `unscoped handoff reads: ${offenders.join(', ')}`)
})

test('the card states that mid-run state is NOT resumed', () => {
  // spec: ship/halt-resume-card — "Edge case — the card states that mid-run
  // state is not resumed". Required by the spec and by tasks.md 1.2, and until
  // now asserted nowhere: exactly the shape CLAUDE.md warns about, where a
  // prose instruction nobody pins silently stops running. Tokens, not the
  // sentence — `state.json` and the fact it is replaced are what carry it.
  const text = formatResumeCard(HALTED)
  assert.match(text, /state\.json/, 'the file whose replacement loses the cursor')
  assert.match(text, /replaced at wave 0/, 'and when it is replaced')
  assert.match(text, /not\*{0,2} resumed|\*\*not\*\* resumed/, 'stated as a negation, not left to inference')
  assert.match(
    text,
    /dispatched again/,
    'and the consequence a reader must act on — unticked work runs a second time'
  )
})

test('a change name that reduces to nothing still yields a card inside the handoff dir', () => {
  // spec: ship/halt-resume-card — "Edge case — a name that reduces to nothing
  // still yields a card". The traversal test covers `../../etc/passwd`; this
  // covers the inputs that sanitize to an EMPTY string, where the risk is not
  // escape but a path ending in a bare separator or a dotfile.
  for (const change of ['', '..', '///', '.', '---', '   ']) {
    const path = resumeCardPath({ change, runId: 'run-1' })
    assert.equal(path, join(HANDOFF_DIR, 'ship-unnamed-run-1.md'), `bad card path for ${JSON.stringify(change)}`)
  }
  // And it is writable, not merely well-named.
  const written = writeResumeCard(tmp, { ...HALTED, change: '..' })
  assert.equal(written.written, true)
  assert.equal(written.path, join(HANDOFF_DIR, 'ship-unnamed-run-20260918-abc.md'))
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
  //
  // A regular file where the handoff DIRECTORY goes, rather than a chmod: mode
  // bits do not stop uid 0, so a chmod fixture makes this assertion FAIL — not
  // skip — when the suite runs as root, which a CI container routinely does.
  // This fixture fails the write for every uid.
  const blocked = join(tmp, 'blocked')
  mkdirSync(join(blocked, '.claude'), { recursive: true })
  writeFileSync(join(blocked, HANDOFF_DIR), 'not a directory\n')

  const written = writeResumeCard(blocked, HALTED)
  assert.equal(written.written, false)
  assert.equal(written.path, null)
  assert.equal(typeof written.reason, 'string')
  assert.ok(written.reason.length > 0)
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
