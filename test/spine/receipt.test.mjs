// The receipt module, called rather than grepped.
//
// `lib/receipt.mjs` was the only substantial non-graph module in `lib/` with no
// test of its own: what covered it was regex assertions against its SOURCE TEXT
// in `test/workflows.test.mjs` and `test/spine/prompt-integrity.test.mjs`. A
// source grep cannot catch a regression in any of the behaviours below, and
// every one of them silently converts "unknown" into a number the outcome
// corpus will then treat as measured — which is the one error this module's own
// header says it exists to prevent.
//
// So each case calls the function and reads the value back. The four most
// delicate behaviours have a case per branch: the `surviving - blockers` guard,
// the three-way `committed` tri-state, the two reason ladders, and the dedup in
// `degradationLines`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildReceipt,
  capExhaustedSkipReason,
  closingFromWaveState,
  degradationLines,
  formatRunSummary,
  summaryHeadline,
  tailFromManifest
} from '../../lib/receipt.mjs'

// --- closingFromWaveState ---------------------------------------------------

test('closingFromWaveState reads the three conditions off a wave state', () => {
  const closing = closingFromWaveState({
    skippedVerifications: [
      { reason: capExhaustedSkipReason() },
      { reason: 'docs-only-wave' },
      { reason: capExhaustedSkipReason() }
    ],
    unresolved: [{ id: '1.1' }]
  })
  assert.deepEqual(closing.skippedVerificationReasons, [
    capExhaustedSkipReason(),
    'docs-only-wave',
    capExhaustedSkipReason()
  ])
  assert.equal(closing.capExhaustedVerifications, 2)
  assert.equal(closing.unresolvedErrors, 1)
})

test('a state with no skip list is no closing at all, not an empty one', () => {
  // `null` and `{skipped: []}` are different facts: one run never found out, the
  // other found out that nothing was skipped. `degradationLines` prints an
  // explicit banner for the first and silence for the second.
  assert.equal(closingFromWaveState(null), null)
  assert.equal(closingFromWaveState({}), null)
  const empty = closingFromWaveState({ skippedVerifications: [] })
  assert.deepEqual(empty.skippedVerificationReasons, [])
  assert.equal(empty.capExhaustedVerifications, 0)
  assert.equal(empty.unresolvedErrors, undefined, 'an unread unresolved list is unknown, never zero')
})

// --- tailFromManifest -------------------------------------------------------

test('tailFromManifest flattens the review counts out of their nesting', () => {
  const tail = tailFromManifest({
    review: { counts: { raised: 7, dismissed: 2, droppedByQuality: 1, surviving: 4, blockers: 1 } },
    remediation: { fixed: 1, deferred: 0 },
    fixRoundsRun: 2,
    handoff: { manualTestPlan: true },
    autonomy: { level: 3 }
  })
  assert.deepEqual(tail.review, {
    raised: 7,
    dismissed: 2,
    droppedByQuality: 1,
    surviving: 4,
    blockers: 1
  })
  assert.equal(tail.remediationRounds, 2)
  assert.deepEqual(tail.remediation, { fixed: 1, deferred: 0 })
  assert.deepEqual(tail.autonomy, { level: 3 })
})

test('remediationRounds is unobserved without a review and zero with one', () => {
  // A lean run never reviewed, so it never ran a round — "no rounds" and "we
  // never found out" are the distinction the corpus's control group rests on.
  assert.equal(tailFromManifest({}).remediationRounds, undefined)
  assert.equal(tailFromManifest(null).remediationRounds, undefined)
  assert.equal(tailFromManifest({ review: { counts: {} } }).remediationRounds, 0)
  assert.equal(tailFromManifest({ review: { counts: {} }, fixRoundsRun: 3 }).remediationRounds, 3)
})

// --- buildReceipt: the warnings guard ---------------------------------------

const withReview = review => buildReceipt({ change: 'add-thing', summary: { review } })

test('reviewWarnings is the difference only when both halves were observed', () => {
  assert.equal(withReview({ surviving: 5, blockers: 2 }).reviewWarnings, 3)
  assert.equal(withReview({ surviving: 2, blockers: 2 }).reviewWarnings, 0)
})

test('reviewWarnings is unknown when either half is absent', () => {
  assert.equal(withReview({ surviving: 5 }).reviewWarnings, undefined)
  assert.equal(withReview({ blockers: 2 }).reviewWarnings, undefined)
  assert.equal(withReview({}).reviewWarnings, undefined)
  assert.equal(buildReceipt({ summary: {} }).reviewWarnings, undefined)
})

test('a negative difference is unknown, never a number nobody measured', () => {
  // surviving counts blockers and warnings together, so surviving < blockers
  // means the two counts disagree. Reporting -1 warnings would put a value into
  // an indicator that was never measured.
  assert.equal(withReview({ surviving: 1, blockers: 4 }).reviewWarnings, undefined)
})

// --- buildReceipt: the committed tri-state ----------------------------------

test('committed is true, false and unknown for three different facts', () => {
  assert.equal(buildReceipt({ summary: { commit: { ok: true, sha: 'abc1234' } } }).committed, true)
  assert.equal(buildReceipt({ summary: { commit: { ok: false } } }).committed, false)
  assert.equal(buildReceipt({ summary: { commitSkipped: true } }).committed, false)
  assert.equal(
    buildReceipt({ summary: {} }).committed,
    undefined,
    'a run that halted before it reached a commit step never found out'
  )
})

test('the sha is carried only on a commit that succeeded', () => {
  assert.equal(buildReceipt({ summary: { commit: { ok: true, sha: 'abc1234' } } }).commit, 'abc1234')
  assert.equal(buildReceipt({ summary: { commit: { ok: false, sha: 'abc1234' } } }).commit, undefined)
})

// --- buildReceipt: the two reason ladders -----------------------------------

const reasonFor = summary => buildReceipt({ summary }).touchedPathsReason

test('touchedPathsReason: an observed set takes no reason', () => {
  const receipt = buildReceipt({ summary: { paths: { touchedPaths: ['README.md'] } } })
  assert.deepEqual(receipt.touchedPaths, ['README.md'])
  assert.equal(receipt.touchedPathsReason, undefined)
})

test('touchedPathsReason: a reason the reader supplied wins over every inference', () => {
  assert.equal(
    reasonFor({ paths: { touchedPathsReason: 'git was unreadable' }, commitSkipped: true }),
    'git was unreadable'
  )
})

test('touchedPathsReason: a failed commit, a skipped commit and a missing sha are three reasons', () => {
  assert.match(reasonFor({ paths: {}, commit: { ok: false } }), /the commit step reported failure/)
  assert.match(reasonFor({ paths: {}, commitSkipped: true }), /does not commit/)
  assert.match(reasonFor({ paths: {} }), /recorded no commit identifier/)
})

test('touchedPathsReason: no close at all is its own reason', () => {
  assert.match(reasonFor({}), /did not reach its close/)
})

test('predictedPathsReason: only a COMPLETE set takes no reason', () => {
  const complete = buildReceipt({
    summary: { paths: { predictedPaths: ['a.ts'], predictedPathsComplete: true } }
  })
  assert.equal(complete.predictedPathsComplete, true)
  assert.equal(complete.predictedPathsReason, undefined)

  // A set that was read but is known partial still owes the reader a reason:
  // this set is an indicator's denominator, and a partial one read as whole is
  // a silent, systematic error.
  const partial = buildReceipt({
    summary: { paths: { predictedPaths: ['a.ts'], predictedPathsComplete: false } }
  })
  assert.equal(partial.predictedPathsComplete, false)
  assert.match(partial.predictedPathsReason, /could not be read back at close/)
})

test('predictedPathsReason: a supplied reason wins, and no close is its own reason', () => {
  assert.equal(
    buildReceipt({ summary: { paths: { predictedPathsReason: 'the plan file was gone' } } })
      .predictedPathsReason,
    'the plan file was gone'
  )
  assert.match(buildReceipt({ summary: {} }).predictedPathsReason, /never read/)
})

// --- buildReceipt: passthrough ----------------------------------------------

test('the plan fingerprint passes through untouched', () => {
  assert.equal(buildReceipt({ planFingerprint: 'deadbeef' }).planFingerprint, 'deadbeef')
  assert.equal(buildReceipt({}).planFingerprint, undefined)
})

test('the closing counts are unknown without a closing, never zero', () => {
  const blind = buildReceipt({ summary: {} })
  assert.equal(blind.skippedVerifications, undefined)
  assert.equal(blind.capExhaustedVerifications, undefined)
  assert.equal(blind.unresolvedErrors, undefined)

  const seen = buildReceipt({
    summary: { closing: { skippedVerificationReasons: ['a', 'b'], capExhaustedVerifications: 1, unresolvedErrors: 0 } }
  })
  assert.equal(seen.skippedVerifications, 2)
  assert.equal(seen.capExhaustedVerifications, 1)
  assert.equal(seen.unresolvedErrors, 0)
})

// --- degradationLines -------------------------------------------------------

test('an absent closing is itself reported', () => {
  const lines = degradationLines({ closing: null })
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^CLOSING STEP OUTCOME UNKNOWN:/)
})

test('cap exhaustion and unresolved errors are printed with their counts', () => {
  const lines = degradationLines({
    closing: {
      skippedVerificationReasons: [capExhaustedSkipReason()],
      capExhaustedVerifications: 2,
      unresolvedErrors: 3
    }
  })
  assert.ok(lines.some(l => l === `VERIFICATION SKIPPED: reason=${capExhaustedSkipReason()}`))
  assert.ok(lines.some(l => /^VERIFY CAP EXHAUSTED: 2 /.test(l)))
  assert.ok(lines.some(l => /^UNRESOLVED ERRORS CARRIED PAST A WAVE: 3 /.test(l)))
})

test('a zero count prints nothing — a clean run must not read as a degraded one', () => {
  const lines = degradationLines({
    closing: { skippedVerificationReasons: [], capExhaustedVerifications: 0, unresolvedErrors: 0 }
  })
  assert.deepEqual(lines, [])
})

test('a banner pushed as it happened and read back at the close is printed once', () => {
  const reason = `VERIFICATION SKIPPED: reason=${capExhaustedSkipReason()}`
  const lines = degradationLines({
    banners: [reason, 'NO TEST PROFILE: run /interlock:fix-tests --reconfigure once'],
    closing: { skippedVerificationReasons: [capExhaustedSkipReason()], capExhaustedVerifications: 0 }
  })
  assert.equal(lines.filter(l => l === reason).length, 1, 'printing it twice reads as two skips')
  assert.equal(lines.length, 2)
})

test('host banners join the run\'s own, in that order', () => {
  const lines = degradationLines({
    banners: ['A'],
    hostBanners: ['B'],
    closing: { skippedVerificationReasons: [] }
  })
  assert.deepEqual(lines, ['A', 'B'])
})

// --- summaryHeadline --------------------------------------------------------

test('the headline has three forms and a halt beats a leftover', () => {
  assert.equal(summaryHeadline({ change: 'add-thing' }), 'SHIP COMPLETE — add-thing')
  assert.equal(
    summaryHeadline({ change: 'add-thing', leftoverTaskIds: ['2.1'] }),
    'SHIP COMPLETE WITH LEFTOVERS — add-thing'
  )
  assert.equal(
    summaryHeadline({ change: 'add-thing', halted: 'the suite was red', leftoverTaskIds: ['2.1'] }),
    'SHIP HALTED — the suite was red'
  )
  // Callable with nothing at all: the close's push uses this before a change
  // name is necessarily resolved, and a throw there would cost the notification.
  assert.match(summaryHeadline(), /^SHIP COMPLETE — /)
})

// --- formatRunSummary -------------------------------------------------------

test('a lean run says which sections it skipped', () => {
  const text = formatRunSummary({ change: 'add-thing', summary: { plan: null }, flags: {} })
  assert.match(text, /^LEAN SHIP: skipped review, handoff, conformance/m)
  assert.match(text, /pass --review \/ --handoff \/ --strict to enable/)
})

test('a strict run prints no lean line', () => {
  const text = formatRunSummary({
    change: 'add-thing',
    flags: { review: true, handoff: true, conformance: true }
  })
  assert.doesNotMatch(text, /LEAN SHIP/)
})

test('a run with no banners says so rather than printing nothing', () => {
  // Silence and cleanliness must not look the same: an empty banner section is
  // indistinguishable from a run that degraded and hid it.
  const text = formatRunSummary({ change: 'add-thing', degradations: [] })
  assert.match(text, /^No degradation banners —/m)
})

test('a run with banners prints them and drops the clean sentence', () => {
  const text = formatRunSummary({ change: 'add-thing', degradations: ['PUSH FAILED: HTTP 403'] })
  assert.match(text, /^PUSH FAILED: HTTP 403$/m)
  assert.doesNotMatch(text, /No degradation banners/)
})

test('an unobserved plan is reported as unknown, not omitted', () => {
  assert.match(formatRunSummary({ change: 'x' }), /^ {2}PLAN UNKNOWN:/m)
  assert.match(
    formatRunSummary({ change: 'x', summary: { plan: { reused: true, status: 'match', reason: 'same' } } }),
    /^ {2}PLAN REUSED \(match\): same$/m
  )
  assert.match(
    formatRunSummary({ change: 'x', summary: { plan: { reused: false, status: 'edited', reason: 'specs changed' } } }),
    /^ {2}PLAN REBUILT \(edited\): specs changed$/m
  )
})

test('a run with no id says why rather than printing a blank row', () => {
  assert.match(formatRunSummary({ change: 'x' }), /^ {2}run: none — the run halted before a plan was adopted$/m)
  assert.match(formatRunSummary({ change: 'x', runId: 'run-9' }), /^ {2}run: run-9$/m)
})

test('the archive reminder appears only on a clean, leftover-free close', () => {
  const clean = formatRunSummary({
    change: 'add-thing',
    unarchived: { thisChange: true, others: 2 }
  })
  assert.match(clean, /^ARCHIVE PENDING — add-thing: after merge, run openspec archive add-thing$/m)
  assert.match(clean, /also unarchived: 2 completed change\(s\)/)

  for (const summary of [{ halted: 'stopped' }, {}]) {
    const leftover = summary.halted ? [] : ['2.1']
    const text = formatRunSummary({
      change: 'add-thing',
      summary,
      leftoverTaskIds: leftover,
      unarchived: { thisChange: true, others: 0 }
    })
    assert.doesNotMatch(text, /ARCHIVE PENDING/, 'an incomplete change must not be reported as ready to archive')
  }
})

test('the resume card row prints only when a card was actually written', () => {
  // A row naming a file that is not there is worse than no row: the close that
  // could not write one reports that in the degradation block instead.
  assert.match(
    formatRunSummary({
      change: 'add-thing',
      summary: { halted: 'stopped' },
      resumeCard: '.claude/handoff/ship-add-thing-run-9.md'
    }),
    /^ {2}resume card: \.claude\/handoff\/ship-add-thing-run-9\.md$/m
  )
  assert.doesNotMatch(formatRunSummary({ change: 'add-thing' }), /resume card:/)
  assert.doesNotMatch(
    formatRunSummary({
      change: 'add-thing',
      summary: { halted: 'stopped' },
      degradations: ['RESUME CARD NOT WRITTEN: EACCES']
    }),
    /resume card:/
  )
})

// --- buildReceipt: what the run observed about its agents and its home -------

const OBSERVATION_COUNTS = [
  'lanesStoppedByHost',
  'schemaResultsMissing',
  'toolsDeniedInLanes',
  'modelSubstitutions',
  'permissionPrompts',
  'autoModeDenials'
]

test('the six observation counts are absent when nothing was observed, never zero', () => {
  // A Workflow run with no sidecar and no host record saw no agent at all, and
  // a zero here would file it beside a run that watched every lane and found
  // nothing wrong.
  const blind = buildReceipt({ change: 'add-thing', summary: {} })
  for (const key of OBSERVATION_COUNTS) assert.equal(blind[key], undefined, key)
  assert.equal(blind.surface, undefined)
  assert.equal(blind.stateHome, undefined)
})

test('the six observation counts are carried by name when measured, a zero included', () => {
  const input = {
    change: 'add-thing',
    summary: {},
    lanesStoppedByHost: 1,
    schemaResultsMissing: 0,
    toolsDeniedInLanes: 2,
    modelSubstitutions: 0,
    permissionPrompts: 3,
    autoModeDenials: 0
  }
  const receipt = buildReceipt(input)
  for (const key of OBSERVATION_COUNTS) assert.equal(receipt[key], input[key], key)
})

test('a malformed count is absent rather than a number nobody measured', () => {
  const receipt = buildReceipt({ lanesStoppedByHost: 'two', permissionPrompts: Number.NaN, autoModeDenials: null })
  assert.equal(receipt.lanesStoppedByHost, undefined)
  assert.equal(receipt.permissionPrompts, undefined)
  assert.equal(receipt.autoModeDenials, undefined)
})

test('the surface and the state home are carried by name', () => {
  const receipt = buildReceipt({ change: 'add-thing', surface: 'linked-worktree', stateHome: '/r' })
  assert.equal(receipt.surface, 'linked-worktree')
  assert.equal(receipt.stateHome, '/r')
  const empty = buildReceipt({ surface: '', stateHome: 42 })
  assert.equal(empty.surface, undefined)
  assert.equal(empty.stateHome, undefined)
})

test('the host block carries the observed hook value through', () => {
  const receipt = buildReceipt({ host: { id: 'workflow', cacheAccounting: 'hook' } })
  assert.equal(receipt.host.cacheAccounting, 'hook')
})

// --- formatRunSummary: the state home row ------------------------------------

test('a run whose state home differs from its cwd names it on the row under cwd', () => {
  const text = formatRunSummary({
    change: 'add-thing',
    runId: 'run-9',
    projectSlug: '-r--claude-worktrees-w1',
    root: '/r/.claude/worktrees/w1',
    stateHome: '/r'
  })
  const rows = text.split('\n')
  const cwd = rows.indexOf('  cwd: /r/.claude/worktrees/w1')
  assert.ok(cwd > 0, 'the cwd row is printed')
  assert.equal(rows[cwd + 1], '  state home: /r', 'directly under the cwd row')
})

test('a main-checkout run prints no state home row, so its summary is unchanged', () => {
  const base = { change: 'add-thing', runId: 'run-9', projectSlug: '-r', root: '/r' }
  const before = formatRunSummary(base)
  assert.doesNotMatch(before, /state home:/)
  assert.equal(formatRunSummary({ ...base, stateHome: '/r' }), before, 'equal paths print exactly what an absent one does')
  assert.equal(formatRunSummary({ ...base, stateHome: '/r/' }), before, 'a trailing separator is the same directory')
  assert.equal(formatRunSummary({ ...base, stateHome: '' }), before)
  assert.equal(formatRunSummary({ ...base, stateHome: null }), before)
})
