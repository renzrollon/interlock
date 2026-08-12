import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import {
  assessReadiness,
  formatReadiness,
  STRICTNESS,
  WEASEL_PHRASES,
  ACCEPTANCE_MARKER,
  TEST_PROFILE_PATH
} from '../../lib/ready.mjs'
import { CONTINUITY_ALLOWED_CLASSES } from '../../lib/risk.mjs'

let tmp

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'interlock-ready-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

const CHANGE = 'add-widget'

// A change that passes every implemented check, so each test can break exactly
// one thing and watch that one blocker appear.
const CLEAN = {
  'proposal.md': '# Add widget list\n\nShow the stored widgets on the dashboard page.\n',
  'design.md': '# Design\n\nRender the widget list from the values already held in the dashboard store.\n',
  'tasks.md': [
    '# Tasks',
    '',
    '- [ ] 1.1 Add the widget renderer in lib/widget.mjs',
    '- [ ] 1.2 User opens the widget list',
    ''
  ].join('\n'),
  'specs/widget/spec.md': [
    '## ADDED Requirements',
    '',
    '### Requirement: Widget list',
    '',
    '#### Scenario: User opens the widget list',
    '',
    '- **WHEN** the dashboard page is shown',
    '- **THEN** every stored widget is listed',
    ''
  ].join('\n'),
  'decisions.md': [
    `# Decisions — ${CHANGE}`,
    '',
    '| id | question | class | resolution | evidence |',
    '|----|----|----|----|----|',
    '| D1 | Reuse the dashboard store? | agent_resolved | Reuse the existing store | explore brief §Critical Files |',
    ''
  ].join('\n')
}

// files: overrides merged over CLEAN; a null value deletes that file.
function makeChange(files = {}, { profile = '{"version": 1}' } = {}) {
  const dir = join(tmp, 'openspec', 'changes', CHANGE)
  mkdirSync(dir, { recursive: true })
  const merged = { ...CLEAN, ...files }
  for (const name of Object.keys(merged)) {
    if (merged[name] === null) continue
    const path = join(dir, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, merged[name])
  }
  if (profile !== null) {
    const p = join(tmp, TEST_PROFILE_PATH)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, profile)
  }
  return dir
}

const OPTS = { review: { blockers: 0, warnings: 0 }, changedPaths: ['lib/widget.mjs'] }

const assess = (opts = {}) => assessReadiness(tmp, CHANGE, { ...OPTS, ...opts })

const codes = (r) => r.blockers.map(b => b.code)
const checkFor = (r, id) => r.checks.find(c => c.id === id)

// --- the policy object ---------------------------------------------------

test('STRICTNESS encodes §4.14 balanced and nothing else', () => {
  assert.equal(STRICTNESS.name, 'balanced')
  assert.equal(STRICTNESS.maxArtifactBlockers, 0)
  assert.equal(STRICTNESS.artifactWarningsBlock, false)
  assert.equal(STRICTNESS.maxNeedsHuman, 0)
  assert.equal(STRICTNESS.maxInvalidDecisions, 0)
  assert.equal(STRICTNESS.requireLedger, true)
  assert.equal(STRICTNESS.requireTestProfile, true)
  assert.deepEqual([...STRICTNESS.allowedRiskClasses], ['low', 'medium'])
  // The allowlist is the risk module's, not a second copy that can drift.
  assert.equal(STRICTNESS.allowedRiskClasses, CONTINUITY_ALLOWED_CLASSES)
  assert.throws(() => {
    STRICTNESS.maxNeedsHuman = 3
  })
})

// --- the happy path ------------------------------------------------------

test('a fully clean change is ready, and every implemented check passed', () => {
  makeChange()
  const r = assess()
  assert.equal(r.ready, true, formatReadiness(r))
  assert.deepEqual(r.blockers, [])
  assert.equal(r.continuityAllowed, true)
  assert.equal(r.riskClass, 'medium')
  assert.deepEqual(r.decisions, { needsHuman: 0, agentResolved: 1, invalid: 0, exists: true })
  assert.equal(r.checks.filter(c => c.status === 'fail').length, 0)
  assert.ok(r.scores.checksPassed > 0)
  assert.equal(r.scores.checksTotal, r.checks.length)
})

test('a docs-only change classifies low and is still ready', () => {
  makeChange()
  const r = assess({ changedPaths: ['docs/01-first-hour.md'] })
  assert.equal(r.riskClass, 'low')
  assert.equal(r.ready, true, formatReadiness(r))
})

// --- B: the decision ledger ---------------------------------------------

test('one needs_human row blocks, and the blocker names the row', () => {
  makeChange({
    'decisions.md': [
      `# Decisions — ${CHANGE}`,
      '',
      '| id | question | class | resolution | evidence |',
      '|----|----|----|----|----|',
      '| D1 | Which currency rounding rule? | needs_human | — | — |',
      ''
    ].join('\n')
  })
  const r = assess()
  assert.equal(r.ready, false)
  assert.deepEqual(codes(r), ['DECISIONS_NEED_HUMAN'])
  assert.equal(r.decisions.needsHuman, 1)
  assert.equal(checkFor(r, 'decisions.needs-human').status, 'fail')
  const evidence = r.blockers[0].evidence.join(' ')
  assert.match(evidence, /D1/)
  assert.match(evidence, /currency rounding/)
})

test('an absent ledger blocks — "no ledger" is unknown, not "nothing to decide"', () => {
  makeChange({ 'decisions.md': null })
  const r = assess()
  assert.equal(r.ready, false)
  assert.deepEqual(codes(r), ['LEDGER_MISSING'])
  assert.equal(r.decisions.exists, false)
  // Every ledger check reads as failed, not as quietly passed.
  for (const id of ['decisions.ledger-present', 'decisions.needs-human', 'decisions.rows-valid']) {
    assert.equal(checkFor(r, id).status, 'fail')
  }
  // And the message tells the user what to do rather than leaving them guessing.
  assert.match(r.blockers[0].message, /spec/i)
  assert.match(r.blockers[0].message, /decisions\.md/)
})

test('an agent_resolved row with no evidence is invalid and blocks', () => {
  makeChange({
    'decisions.md': [
      `# Decisions — ${CHANGE}`,
      '',
      '| id | question | class | resolution | evidence |',
      '|----|----|----|----|----|',
      '| D1 | Reuse the dashboard store? | agent_resolved | Reuse it | — |',
      ''
    ].join('\n')
  })
  const r = assess()
  assert.equal(r.ready, false)
  assert.deepEqual(codes(r), ['DECISIONS_INVALID'])
  assert.equal(r.decisions.invalid, 1)
  assert.match(r.blockers[0].evidence.join(' '), /evidence/)
})

// --- C: artifacts and the review that must have run ----------------------

test('incomplete artifacts block', () => {
  makeChange({ 'tasks.md': '# Tasks\n\nnothing checkable here\n' })
  const r = assess()
  assert.equal(r.ready, false)
  assert.ok(codes(r).includes('ARTIFACTS_INCOMPLETE'))
  assert.ok(r.blockers.find(b => b.code === 'ARTIFACTS_INCOMPLETE').evidence.length > 0)
})

test('artifact-review blockers block', () => {
  makeChange()
  const r = assess({ review: { blockers: 2, warnings: 0 } })
  assert.equal(r.ready, false)
  assert.deepEqual(codes(r), ['REVIEW_BLOCKERS'])
})

test('artifact-review warnings alone do NOT block under balanced', () => {
  makeChange()
  const r = assess({ review: { blockers: 0, warnings: 3 } })
  assert.equal(r.ready, true, formatReadiness(r))
  assert.deepEqual(
    r.warnings.map(w => w.code),
    ['REVIEW_WARNINGS']
  )
  assert.equal(checkFor(r, 'artifacts.review-blockers').status, 'pass')
})

test('an omitted review result blocks — it is never read as zero blockers', () => {
  makeChange()
  const r = assessReadiness(tmp, CHANGE, { changedPaths: ['lib/widget.mjs'] })
  assert.equal(r.ready, false, formatReadiness(r))
  assert.deepEqual(codes(r), ['REVIEW_NOT_RUN'])
  assert.equal(checkFor(r, 'artifacts.review-blockers').status, 'fail')
})

test('every shape that is not a usable blocker count counts as "the review did not run"', () => {
  makeChange()
  for (const review of [undefined, null, true, 'clean', {}, [], { warnings: 0 }, { blockers: 'none' }, { blockers: -1 }, { blockers: NaN }]) {
    const r = assess({ review })
    assert.equal(r.ready, false, `review=${JSON.stringify(review)} should not be ready`)
    assert.ok(codes(r).includes('REVIEW_NOT_RUN'), `review=${JSON.stringify(review)}`)
  }
})

test('a review result may report its counts as the arrays it counted', () => {
  makeChange()
  const r = assess({ review: { blockers: [], warnings: [{ title: 'x' }] } })
  assert.equal(r.ready, true, formatReadiness(r))
  assert.deepEqual(r.warnings.map(w => w.code), ['REVIEW_WARNINGS'])
})

// --- C: scenario → task mapping -----------------------------------------

test('a scenario mapped to no task blocks, naming the scenario', () => {
  makeChange({
    'specs/widget/spec.md': [
      '### Requirement: Widget list',
      '',
      '#### Scenario: Stored widget is archived after ninety days',
      '',
      '- **WHEN** the widget ages out',
      ''
    ].join('\n')
  })
  const r = assess()
  assert.equal(r.ready, false)
  assert.deepEqual(codes(r), ['SCENARIO_UNMAPPED'])
  const evidence = r.blockers[0].evidence.join(' ')
  assert.match(evidence, /archived after ninety days/)
  assert.match(evidence, /specs\/widget\/spec\.md/)
})

test('an explicit "covered by task N" maps a scenario no task names', () => {
  makeChange({
    'specs/widget/spec.md': [
      '### Requirement: Widget list',
      '',
      '#### Scenario: Stored widget is archived after ninety days',
      '',
      'Covered by task 1.1.',
      ''
    ].join('\n')
  })
  const r = assess()
  assert.equal(r.ready, true, formatReadiness(r))
  assert.equal(checkFor(r, 'specs.scenarios-mapped').status, 'pass')
})

test('no scenarios at all is a warning, not a blocker', () => {
  makeChange({ 'specs/widget/spec.md': '### Requirement: Widget list\n\nno scenarios here\n' })
  const r = assess()
  assert.equal(r.ready, true, formatReadiness(r))
  assert.deepEqual(r.warnings.map(w => w.code), ['NO_SCENARIOS'])
})

// --- C: weasel-phrase lint ----------------------------------------------

test('every listed weasel phrase blocks, with the offending task line as evidence', () => {
  for (const phrase of WEASEL_PHRASES) {
    makeChange({
      'tasks.md': [
        '# Tasks',
        '',
        '- [ ] 1.1 Add the widget renderer in lib/widget.mjs',
        '- [ ] 1.2 User opens the widget list',
        `- [ ] 1.3 Update the exports ${phrase}`,
        ''
      ].join('\n')
    })
    const r = assess()
    assert.equal(r.ready, false, `"${phrase}" should block`)
    assert.deepEqual(codes(r), ['TASK_UNSPECIFIC'], `"${phrase}"`)
    const evidence = r.blockers[0].evidence.join(' ')
    assert.match(evidence, /tasks\.md:5/, `"${phrase}" should cite the task line`)
    assert.match(evidence, /Update the exports/, `"${phrase}" should quote the task`)
  }
})

test('a vague phrase is allowed when the task states its acceptance', () => {
  makeChange({
    'tasks.md': [
      '# Tasks',
      '',
      '- [ ] 1.1 Add the widget renderer in lib/widget.mjs',
      '- [ ] 1.2 User opens the widget list',
      '- [ ] 1.3 Update the exports as needed — acceptance: `npm test` passes with no new failures',
      ''
    ].join('\n')
  })
  const r = assess()
  assert.equal(r.ready, true, formatReadiness(r))
  assert.ok(ACCEPTANCE_MARKER.test('acceptance: x'))
})

test('the lint does not fire inside a longer word', () => {
  makeChange({
    'tasks.md': [
      '# Tasks',
      '',
      '- [ ] 1.1 Add the widget renderer in lib/widget.mjs',
      '- [ ] 1.2 User opens the widget list',
      '- [ ] 1.3 Record the etcd endpoint and the appropriateness score',
      ''
    ].join('\n')
  })
  const r = assess()
  assert.equal(r.ready, true, formatReadiness(r))
})

// --- D: risk -------------------------------------------------------------

test('a high-risk change is not ready even when everything else is clean', () => {
  makeChange()
  const r = assess({ changedPaths: ['src/auth/session.ts'] })
  assert.equal(r.ready, false)
  assert.equal(r.riskClass, 'high')
  assert.deepEqual(codes(r), ['RISK_CLASS_BLOCKED'])
  assert.equal(r.continuityAllowed, false)
  assert.ok(r.blockers[0].evidence.length > 0)
})

test('a critical change is not ready', () => {
  makeChange()
  const r = assess({ changedPaths: ['src/billing/checkout.ts'] })
  assert.equal(r.riskClass, 'critical')
  assert.equal(r.ready, false)
  assert.deepEqual(codes(r), ['RISK_CLASS_BLOCKED'])
})

// --- E: runtime readiness ------------------------------------------------

test('a missing test profile blocks', () => {
  makeChange({}, { profile: null })
  const r = assess()
  assert.equal(r.ready, false)
  assert.deepEqual(codes(r), ['TEST_PROFILE_MISSING'])
  assert.match(r.blockers[0].message, /fix-tests/)
})

test('an unparseable test profile blocks rather than counting as present', () => {
  makeChange({}, { profile: '{ not json' })
  const r = assess()
  assert.equal(r.ready, false)
  assert.deepEqual(codes(r), ['TEST_PROFILE_UNREADABLE'])
})

test('an empty test profile blocks', () => {
  makeChange({}, { profile: '' })
  const r = assess()
  assert.equal(r.ready, false)
  assert.deepEqual(codes(r), ['TEST_PROFILE_UNREADABLE'])
})

// --- F: deliberately not implemented ------------------------------------

test('the learning gates are reported as skipped, never as passed', () => {
  makeChange()
  const r = assess()
  for (const id of ['learning.failure-streak', 'learning.path-autonomy']) {
    const c = checkFor(r, id)
    assert.equal(c.status, 'skip', `${id} must never be a pass`)
    assert.match(c.detail, /out of scope/i)
    assert.match(c.detail, /4\.15a|F6\.6/)
  }
})

test('the checks this release does not automate all say so', () => {
  makeChange()
  const r = assess()
  for (const id of [
    'intent.lock',
    'tasks.wave-classifiable',
    'invariants.consumers-enumerated',
    'runtime.agent-tool'
  ]) {
    const c = checkFor(r, id)
    assert.equal(c.status, 'skip', `${id} must never be a pass`)
    assert.ok(c.detail.length > 0)
  }
  // No implemented check is ever reported as skipped on a clean change.
  assert.deepEqual(
    r.checks.filter(c => c.status === 'skip').map(c => c.id).sort(),
    [
      'intent.lock',
      'invariants.consumers-enumerated',
      'learning.failure-streak',
      'learning.path-autonomy',
      'runtime.agent-tool',
      'tasks.wave-classifiable'
    ]
  )
})

// --- fail closed on internal error --------------------------------------

test('an error while gathering evidence becomes a blocker, never a pass', () => {
  const dir = makeChange({ 'decisions.md': null })
  // A directory where the ledger file must be: it exists, and reading it throws.
  mkdirSync(join(dir, 'decisions.md'), { recursive: true })
  const r = assess()
  assert.equal(r.ready, false)
  assert.deepEqual(codes(r), ['LEDGER_UNREADABLE'])
  assert.deepEqual(r.decisions, { needsHuman: null, agentResolved: null, invalid: null, exists: null })
  for (const id of ['decisions.ledger-present', 'decisions.needs-human', 'decisions.rows-valid']) {
    assert.equal(checkFor(r, id).status, 'fail')
  }
})

test('unreadable artifacts fail every check that depended on them', () => {
  makeChange()
  // Artifact gathering throws part-way through. However it fails — EISDIR, a
  // permission error, this getter — the answer must be a blocker.
  const hostile = {}
  Object.defineProperty(hostile, 'tasks.md', {
    enumerable: true,
    get() {
      throw new Error('boom')
    }
  })
  const r = assess({ artifacts: hostile })
  assert.equal(r.ready, false)
  assert.ok(codes(r).includes('ARTIFACTS_UNREADABLE'))
  for (const id of [
    'artifacts.implementable',
    'specs.scenarios-mapped',
    'tasks.no-weasel-phrases',
    'risk.class-allowed'
  ]) {
    assert.equal(checkFor(r, id).status, 'fail')
  }
  assert.equal(r.riskClass, null)
  assert.equal(r.continuityAllowed, false)
})

test('several independent failures are all reported, not just the first', () => {
  makeChange({ 'decisions.md': null }, { profile: null })
  const r = assess({ review: undefined, changedPaths: ['src/auth/login.ts'] })
  assert.equal(r.ready, false)
  assert.deepEqual(codes(r).sort(), [
    'LEDGER_MISSING',
    'REVIEW_NOT_RUN',
    'RISK_CLASS_BLOCKED',
    'TEST_PROFILE_MISSING'
  ])
})

// --- argument handling ---------------------------------------------------

test('an unresolvable change is a user-facing error, not a readiness verdict', () => {
  makeChange()
  assert.throws(() => assessReadiness(tmp, 'no-such-change', OPTS), err => {
    assert.equal(err.userFacing, true)
    assert.match(err.message, /not found/)
    return true
  })
  assert.throws(() => assessReadiness('', CHANGE, OPTS), err => err.userFacing === true)
})

test('the change name may be omitted when only one change exists', () => {
  makeChange()
  const r = assessReadiness(tmp, undefined, OPTS)
  assert.equal(r.change, CHANGE)
  assert.equal(r.ready, true, formatReadiness(r))
})

test('caller-supplied artifact text replaces reading the change directory', () => {
  makeChange()
  const r = assess({
    artifacts: {
      'tasks.md': '- [ ] 1.1 Do the thing appropriately\n',
      'specs/x.md': '#### Scenario: Do the thing appropriately\n'
    }
  })
  assert.equal(r.ready, false)
  assert.deepEqual(codes(r), ['TASK_UNSPECIFIC'])
})

// --- formatting ----------------------------------------------------------

test('formatReadiness prints the verdict, every check and every blocker', () => {
  makeChange({ 'decisions.md': null })
  const text = formatReadiness(assess())
  assert.match(text, /^NOT READY — add-widget: 1 blocker\(s\)/)
  assert.match(text, /LEDGER_MISSING/)
  assert.match(text, /\[skip\] learning\.failure-streak/)
  assert.match(text, /\[ok {2}\] runtime\.test-profile/)
})

test('formatReadiness names the risk class and strictness when ready', () => {
  makeChange()
  const text = formatReadiness(assess())
  assert.match(text, /^READY — add-widget may continue \(risk medium, strictness balanced\)/)
})
