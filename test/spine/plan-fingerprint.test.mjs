// Plan reuse, against a real change directory on disk.
//
// Two properties carry this module, and both are about failing in the right
// direction:
//
//   1. Ticking a checkbox must NOT invalidate the plan — without that, the first
//      `interlock tasks tick` kills reuse and it never fires after wave 1 — while
//      adding, removing, reordering or rewording a task must.
//
//   2. No failure may ever surface as a match. Every way of not being able to
//      prove reuse resolves to a NAMED no-reuse outcome, because the run summary
//      has to say why it re-planned and a caller must not be able to confuse
//      "we could not tell" with "it matches".
//
// Deliberately Node-only: temp directories, no model, no network.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  PLAN_FORMAT,
  PLAN_PATH,
  FINGERPRINT_PATH,
  REUSE_MATCH,
  REUSE_MISMATCH,
  REUSE_NO_PLAN,
  REUSE_NO_FINGERPRINT,
  REUSE_UNREADABLE_PLAN,
  REUSE_UNREADABLE_FINGERPRINT,
  REUSE_FORMAT_VERSION,
  REUSE_ERROR,
  computeFingerprint,
  writeFingerprint,
  checkPlanReuse,
  narrowPlan,
  resolvePlanReuse,
  formatPlanReuse
} from '../../lib/plan-fingerprint.mjs'
import { planWaves } from '../../lib/waves.mjs'

const CHANGE = 'add-widget'

const TASKS = `## 1. First

- [ ] 1.1 add the flag
- [ ] 1.2 wire the flag

## 2. Second

- [ ] 2.1 document it
- [ ] 2.2 document it twice
`

/** A change directory with the four artifact kinds a plan is derived from. */
function makeRepo(over = {}) {
  const root = mkdtempSync(join(tmpdir(), 'interlock-plan-'))
  const dir = join(root, 'openspec', 'changes', CHANGE)
  mkdirSync(join(dir, 'specs', 'widgets'), { recursive: true })
  writeFileSync(join(dir, 'proposal.md'), over.proposal ?? '## Why\n\nbecause.\n')
  writeFileSync(join(dir, 'design.md'), over.design ?? '## Decisions\n\nD1 — do it.\n')
  writeFileSync(join(dir, 'tasks.md'), over.tasks ?? TASKS)
  writeFileSync(join(dir, 'specs', 'widgets', 'spec.md'), over.spec ?? '## ADDED\n\nwidgets.\n')
  return { root, dir }
}

const artifact = (dir, name, text) => writeFileSync(join(dir, name), text)

/**
 * A lane-shaped plan covering the four tasks in TASKS: group 1 is a two-task
 * lane (they claim one file), group 2 is two disjoint lanes in one batch. Two
 * tasks per group on purpose — a 1-task group folds onto the previous wave, and
 * a fixture that collapsed to one wave could not show a wave being dropped.
 */
function storedPlan() {
  const t = (id, group, tier, model, path) => ({
    id,
    group,
    description: `task ${id}`,
    tier,
    model,
    isTestTask: false,
    paths: [path]
  })
  return planWaves({
    tasks: [
      t('1.1', 1, 2, 'sonnet', 'src/a.ts'),
      t('1.2', 1, 2, 'sonnet', 'src/a.ts'),
      t('2.1', 2, 1, 'haiku', 'docs/a.md'),
      t('2.2', 2, 1, 'haiku', 'docs/b.md')
    ]
  })
}

/** batches → lanes → ids, per wave. */
const shapeOf = plan => plan.waves.map(w => w.batches.map(b => b.map(l => l.map(t => t.id))))

function writePlan(root, plan = storedPlan()) {
  const dest = join(root, ...PLAN_PATH.split('/'))
  mkdirSync(join(root, '.claude', 'ship'), { recursive: true })
  writeFileSync(dest, JSON.stringify(plan, null, 2))
  return plan
}

/** A repo with a stored plan AND a fingerprint of the current artifacts. */
function shipped(over = {}) {
  const { root, dir } = makeRepo(over)
  const plan = writePlan(root)
  const written = writeFingerprint(root, computeFingerprint(root, CHANGE))
  assert.equal(written.written, true)
  return { root, dir, plan }
}

const clean = root => rmSync(root, { recursive: true, force: true })

// --- the fingerprint ------------------------------------------------------

test('the fingerprint covers every artifact a plan is derived from', () => {
  const { root, dir } = makeRepo()
  const fp = computeFingerprint(root, CHANGE)
  assert.equal(fp.ok, true)
  assert.equal(fp.planFormat, PLAN_FORMAT)
  assert.deepEqual(
    fp.inputs.map(i => i.path),
    ['proposal.md', 'design.md', 'tasks.md', 'specs/widgets/spec.md'],
    'a delta spec left out of the hash is a spec that can change without re-planning'
  )
  assert.ok(fp.inputs.every(i => typeof i.sha256 === 'string'))
  assert.equal(fp.hash, computeFingerprint(root, CHANGE).hash, 'and it is deterministic')
  clean(root)
  assert.ok(dir)
})

test('ticking a task does not change the fingerprint', () => {
  const { root, dir } = makeRepo()
  const before = computeFingerprint(root, CHANGE).hash
  artifact(dir, 'tasks.md', TASKS.replace('- [ ] 1.1', '- [x] 1.1').replace('- [ ] 1.2', '- [X] 1.2'))
  assert.equal(
    computeFingerprint(root, CHANGE).hash,
    before,
    'progress is not a change of plan — if it were, reuse would never fire after wave 1'
  )
  clean(root)
})

const TASK_EDITS = [
  ['a task is added', TASKS + '- [ ] 2.2 and another\n'],
  ['a task is removed', TASKS.replace('- [ ] 1.2 wire the flag\n', '')],
  [
    'two tasks are reordered',
    TASKS.replace(
      '- [ ] 1.1 add the flag\n- [ ] 1.2 wire the flag',
      '- [ ] 1.2 wire the flag\n- [ ] 1.1 add the flag'
    )
  ],
  ['a task is reworded', TASKS.replace('add the flag', 'add the flag and migrate callers')]
]

for (const [name, tasks] of TASK_EDITS) {
  test(`the fingerprint changes when ${name}`, () => {
    const { root, dir } = makeRepo()
    const before = computeFingerprint(root, CHANGE).hash
    artifact(dir, 'tasks.md', tasks)
    assert.notEqual(
      computeFingerprint(root, CHANGE).hash,
      before,
      `${name} changes what the plan is a plan for; only the checkbox MARKER is normalized`
    )
    clean(root)
  })
}

test('editing any other artifact changes the fingerprint too', () => {
  for (const [name, over] of [
    ['proposal', { proposal: '## Why\n\nbecause, differently.\n' }],
    ['design', { design: '## Decisions\n\nD1 — do it another way.\n' }],
    ['a delta spec', { spec: '## ADDED\n\nwidgets, plural.\n' }]
  ]) {
    const base = makeRepo()
    const before = computeFingerprint(base.root, CHANGE).hash
    clean(base.root)
    const edited = makeRepo(over)
    assert.notEqual(computeFingerprint(edited.root, CHANGE).hash, before, `${name} must invalidate`)
    clean(edited.root)
  }
})

test('the caps in force are part of the fingerprint', () => {
  const { root } = makeRepo()
  const eight = computeFingerprint(root, CHANGE, { maxParallel: 8 })
  const two = computeFingerprint(root, CHANGE, { maxParallel: 2 })
  assert.notEqual(
    eight.hash,
    two.hash,
    'a plan built 8 wide does not describe the same schedule as one built 2 wide'
  )
  clean(root)
})

test('an unfingerprintable change reports why instead of throwing', () => {
  const missing = computeFingerprint(mkdtempSync(join(tmpdir(), 'interlock-none-')), CHANGE)
  assert.equal(missing.ok, false)
  assert.equal(missing.hash, null)
  assert.match(missing.problems.join(' '), /does not exist/)
  assert.equal(computeFingerprint('.', undefined).ok, false, 'and a nameless change is refused')
})

// --- the check ------------------------------------------------------------

test('an unchanged change matches', () => {
  const { root } = shipped()
  const result = checkPlanReuse(root, CHANGE)
  assert.equal(result.reuse, true)
  assert.equal(result.status, REUSE_MATCH)
  assert.ok(result.plan, 'the matched plan comes back with the verdict')
  assert.match(formatPlanReuse(result), /^PLAN REUSED/)
  clean(root)
})

test('ticking tasks between runs still matches', () => {
  const { root, dir } = shipped()
  artifact(dir, 'tasks.md', TASKS.replace(/- \[ \] 1\./g, '- [x] 1.'))
  assert.equal(checkPlanReuse(root, CHANGE).status, REUSE_MATCH)
  clean(root)
})

test('an edited artifact does not match, and says the inputs changed', () => {
  const { root, dir } = shipped()
  artifact(dir, 'design.md', '## Decisions\n\nD1 — actually, do it differently.\n')
  const result = checkPlanReuse(root, CHANGE)
  assert.equal(result.reuse, false)
  assert.equal(result.status, REUSE_MISMATCH)
  assert.match(result.reason, /edited since the plan was built/)
  assert.match(formatPlanReuse(result), /^PLAN REBUILT \(inputs-changed\)/)
  clean(root)
})

test('a differing format version does not reuse even when the content matches', () => {
  const { root } = shipped()
  const fpPath = join(root, ...FINGERPRINT_PATH.split('/'))
  const stored = JSON.parse(readFileSync(fpPath, 'utf8'))
  writeFileSync(fpPath, JSON.stringify({ ...stored, planFormat: 'interlock.ship-plan/1' }))
  const result = checkPlanReuse(root, CHANGE)
  assert.equal(result.status, REUSE_FORMAT_VERSION)
  assert.match(result.reason, /interlock\.ship-plan\/1/)
  assert.match(result.reason, new RegExp(PLAN_FORMAT.replace('/', '\\/')))
  clean(root)
})

test('a pre-lane plan is refused as unreadable rather than laned by accident', () => {
  // Format /1 held tasks where /2 holds lanes. Dispatching one would hand the
  // executor a task object where it expects a lane.
  const { root } = shipped()
  const plan = storedPlan()
  plan.waves[0].batches = plan.waves[0].batches.map(b => b.flat())
  writePlan(root, plan)
  assert.equal(checkPlanReuse(root, CHANGE).status, REUSE_UNREADABLE_PLAN)
  clean(root)
})

const ABSENCES = [
  [
    'no plan at all',
    root => rmSync(join(root, ...PLAN_PATH.split('/'))),
    REUSE_NO_PLAN,
    /no stored plan/
  ],
  [
    'a plan with no fingerprint',
    root => rmSync(join(root, ...FINGERPRINT_PATH.split('/'))),
    REUSE_NO_FINGERPRINT,
    /provenance is unknown/
  ],
  [
    'an unparseable plan',
    root => writeFileSync(join(root, ...PLAN_PATH.split('/')), '{ not json'),
    REUSE_UNREADABLE_PLAN,
    /could not be read/
  ],
  [
    'an unparseable fingerprint',
    root => writeFileSync(join(root, ...FINGERPRINT_PATH.split('/')), 'nonsense'),
    REUSE_UNREADABLE_FINGERPRINT,
    /could not be read/
  ],
  [
    'a fingerprint with no hash',
    root => writeFileSync(join(root, ...FINGERPRINT_PATH.split('/')), '{"planFormat":"x"}'),
    REUSE_UNREADABLE_FINGERPRINT,
    /carries no hash/
  ]
]

for (const [name, break_, status, reason] of ABSENCES) {
  test(`${name} re-plans, with its own named reason`, () => {
    const { root } = shipped()
    break_(root)
    const result = checkPlanReuse(root, CHANGE)
    assert.equal(result.reuse, false, `${name} must never read as a match`)
    assert.equal(result.status, status)
    assert.match(result.reason, reason)
    clean(root)
  })
}

test('every no-reuse outcome is distinguishable from every other', () => {
  // The point of naming them: the run summary reports WHY it re-planned, and a
  // bare boolean would collapse "first run" into "the plan went stale".
  const seen = new Set()
  const { root } = shipped()
  for (const [, break_] of ABSENCES) {
    const fresh = shipped()
    break_(fresh.root)
    seen.add(checkPlanReuse(fresh.root, CHANGE).status)
    clean(fresh.root)
  }
  assert.deepEqual(
    [...seen].sort(),
    [
      REUSE_NO_FINGERPRINT,
      REUSE_NO_PLAN,
      REUSE_UNREADABLE_FINGERPRINT,
      REUSE_UNREADABLE_PLAN
    ].sort(),
    'four distinct absences, four distinct answers'
  )
  clean(root)
})

test('a check that raises reports an error outcome, never a match', () => {
  // The plan path is a DIRECTORY, so reading it throws rather than returning
  // text. The one thing this may not do is look like a match.
  const { root } = shipped()
  rmSync(join(root, ...PLAN_PATH.split('/')))
  mkdirSync(join(root, ...PLAN_PATH.split('/')))
  const result = checkPlanReuse(root, CHANGE)
  assert.equal(result.reuse, false)
  assert.ok(
    [REUSE_UNREADABLE_PLAN, REUSE_ERROR].includes(result.status),
    `an unreadable plan must be named, got ${result.status}`
  )
  clean(root)
})

test('a fingerprint built for another change does not match this one', () => {
  const { root } = shipped()
  const fpPath = join(root, ...FINGERPRINT_PATH.split('/'))
  const stored = JSON.parse(readFileSync(fpPath, 'utf8'))
  writeFileSync(fpPath, JSON.stringify({ ...stored, change: 'some-other-change' }))
  assert.equal(checkPlanReuse(root, CHANGE).status, REUSE_MISMATCH)
  clean(root)
})

// --- narrowing ------------------------------------------------------------

test('narrowing drops completed tasks and preserves the order of the rest', () => {
  const plan = storedPlan()
  const narrowed = narrowPlan(plan, id => id === '1.1')
  assert.deepEqual(
    shapeOf(narrowed.plan),
    [[[['1.2']]], [[['2.1'], ['2.2']]]],
    '1.2 keeps its position in the lane 1.1 was removed from'
  )
  assert.deepEqual(narrowed.dropped, ['1.1'])
  assert.equal(narrowed.taskCount, 3)
  assert.equal(narrowed.noRemainingWork, false)
})

test('a lane emptied by narrowing is dropped, not dispatched', () => {
  const plan = storedPlan()
  const narrowed = narrowPlan(plan, id => id.startsWith('1.'))
  assert.equal(narrowed.waveCount, 1, 'wave 1 held only completed tasks and is gone')
  assert.deepEqual(shapeOf(narrowed.plan), [[[['2.1'], ['2.2']]]])
  for (const wave of narrowed.plan.waves) {
    for (const batch of wave.batches) {
      assert.ok(batch.length, 'no empty batch survives')
      for (const lane of batch) assert.ok(lane.length, 'and no empty lane')
    }
  }
})

test('narrowing recounts what is left rather than reporting the original totals', () => {
  const narrowed = narrowPlan(storedPlan(), id => id === '1.1')
  assert.equal(narrowed.plan.totalTasks, 3)
  assert.equal(narrowed.plan.waveCount, narrowed.plan.waves.length)
  assert.equal(narrowed.plan.laneCount, narrowed.laneCount)
})

test('a plan whose every task is complete reports no remaining work', () => {
  const narrowed = narrowPlan(storedPlan(), () => true)
  assert.equal(narrowed.noRemainingWork, true)
  assert.equal(narrowed.taskCount, 0)
  assert.deepEqual(narrowed.plan.waves, [], 'zero waves, and the caller is told not to dispatch it')
})

test('narrowing a test wave follows the same rules', () => {
  const plan = planWaves({
    tasks: [
      { id: '1.1', group: 1, description: 'a', tier: 2, model: 'sonnet', isTestTask: false },
      { id: '1.2', group: 1, description: 'b', tier: 2, model: 'sonnet', isTestTask: false },
      { id: 't.1', group: 9, description: 'test', tier: 2, model: 'sonnet', isTestTask: true }
    ]
  })
  assert.ok(plan.testWave)
  const narrowed = narrowPlan(plan, id => id === 't.1')
  assert.equal(narrowed.plan.testWave, null, 'an emptied test wave is dropped like any other')
  assert.equal(narrowed.taskCount, 2)
})

// --- check plus narrow, which is what ship calls ---------------------------

test('resolvePlanReuse reads completion from tasks.md, by the same matcher tick uses', () => {
  const { root, dir } = shipped()
  artifact(dir, 'tasks.md', TASKS.replace('- [ ] 1.1 add the flag', '- [x] 1.1 add the flag'))
  const result = resolvePlanReuse(root, CHANGE)
  assert.equal(result.reuse, true, 'a tick does not invalidate')
  assert.deepEqual(result.droppedTaskIds, ['1.1'])
  assert.equal(result.taskCount, 3)
  assert.equal(result.noRemainingWork, false)
  assert.match(formatPlanReuse(result), /already complete, dropped: 1\.1/)
  clean(root)
})

test('resolvePlanReuse reports no remaining work when every task is ticked', () => {
  const { root, dir } = shipped()
  artifact(dir, 'tasks.md', TASKS.replace(/- \[ \]/g, '- [x]'))
  const result = resolvePlanReuse(root, CHANGE)
  assert.equal(result.reuse, true)
  assert.equal(result.noRemainingWork, true)
  assert.equal(result.taskCount, 0)
  assert.match(formatPlanReuse(result), /NO REMAINING WORK/)
  clean(root)
})

test('resolvePlanReuse narrows nothing when it did not reuse', () => {
  const { root } = shipped()
  rmSync(join(root, ...PLAN_PATH.split('/')))
  const result = resolvePlanReuse(root, CHANGE)
  assert.equal(result.reuse, false)
  assert.equal(result.narrowed, null)
  assert.equal(result.noRemainingWork, false, 'no plan is not "no work"')
  clean(root)
})

// --- the dependency edge set (design D9) -----------------------------------
//
// `dependsOn` is an ordering signal the artifact digests cannot see: two
// classifications of one unedited tasks.md can differ only in their edges and
// schedule different work in different batches. So the edge set is part of plan
// identity — and only when there is one, or every fingerprint ever written for
// an edge-free change would invalidate for a signal it does not use.

const classified = (over = {}) => ({
  tasks: [
    { id: '1.1', group: 1, description: 'a', tier: 2, model: 'sonnet', isTestTask: false },
    { id: '1.2', group: 1, description: 'b', tier: 2, model: 'sonnet', isTestTask: false, ...over }
  ]
})

test('an added dependency edge changes the fingerprint', () => {
  const { root } = makeRepo()
  const bare = computeFingerprint(root, CHANGE, { tasks: classified() })
  const edged = computeFingerprint(root, CHANGE, { tasks: classified({ dependsOn: ['1.1'] }) })
  assert.notEqual(edged.hash, bare.hash, 'a plan that gained an edge is a different plan')
  assert.equal(edged.edges, 'depends-on 1.2<-1.1', 'and the fingerprint says which edge')
  clean(root)
})

test('a changed dependency edge changes the fingerprint', () => {
  const { root } = makeRepo()
  const one = computeFingerprint(root, CHANGE, { tasks: classified({ dependsOn: ['1.1'] }) })
  const other = computeFingerprint(root, CHANGE, {
    tasks: {
      tasks: [
        ...classified().tasks,
        { id: '1.3', group: 1, description: 'c', tier: 2, model: 'sonnet', isTestTask: false }
      ]
    }
  })
  assert.notEqual(one.hash, other.hash)
  clean(root)
})

test('an absent or empty edge set leaves the fingerprint exactly as it was', () => {
  const { root } = makeRepo()
  const none = computeFingerprint(root, CHANGE).hash
  assert.equal(
    computeFingerprint(root, CHANGE, { tasks: classified() }).hash,
    none,
    'a task list with no dependsOn anywhere contributes nothing to the hash'
  )
  assert.equal(
    computeFingerprint(root, CHANGE, { tasks: classified({ dependsOn: [] }) }).hash,
    none,
    'and an empty edge list is not an edge'
  )
  assert.equal(computeFingerprint(root, CHANGE).edges, null)
  clean(root)
})

test('the edge set is hashed as a set, not in the order the classifier emitted it', () => {
  const { root } = makeRepo()
  const forward = computeFingerprint(root, CHANGE, {
    tasks: classified({ dependsOn: ['1.1', '1.3'] })
  })
  const reversed = computeFingerprint(root, CHANGE, {
    tasks: classified({ dependsOn: ['1.3', '1.1', '1.1'] })
  })
  assert.equal(forward.hash, reversed.hash, 'reordering or repeating an edge is not a new plan')
  clean(root)
})
