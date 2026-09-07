// The committed outcome-eval fixture set (spec: evals/outcome-fixtures).
//
// Every assertion here runs offline, with no model and no credential, because
// the failure it catches must cost nothing: a fixture that has rotted — a
// reference implementation that no longer solves it, a change the validator
// stopped accepting, a starting state that is accidentally already green — is a
// defect in the measuring apparatus. Discovering it during a metered scheduled
// run would spend money to learn something `npm test` could have said for free,
// and would read as a loop failure rather than as fixture rot.
//
// The requirements it enforces:
//   - every fixture's change is implementable, decided by the same `interlock
//     validate` the loop uses, run from that fixture's own root
//   - every fixture's starting state is red, and its reference implementation
//     turns it green and leaves no task unticked
//   - the declared per-task artefacts are total over the change's task ids and
//     all exist once the reference is applied
//   - no committed fixture directory holds run state
//   - every fixture's testing profile is tracked, pinning that the repository's
//     root-anchored `.claude/testing/` ignore rule does not reach into one
//
// The scratch roots are made under the system temp directory and the fixture
// directories are never executed in place — the same isolation rule the runner
// obeys, obeyed here so the suite cannot be the thing that pollutes the corpora.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FIXTURES_DIR,
  readFixtures,
  applyStartingState,
  applyReference,
  readUnitCommand,
  walkFixture
} from '../../evals/ship/fixtures.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(ROOT, 'bin', 'interlock')

const fixtures = readFixtures()

/** Lay a fixture's starting state into a fresh scratch root outside this repository. */
function scratch(fixture) {
  const root = mkdtempSync(join(tmpdir(), `interlock-fixture-${fixture.id}-`))
  applyStartingState(fixture, root)
  return root
}

/** The fixture's own unit command, run in `root`. */
function runUnit(fixture, root) {
  const unit = readUnitCommand(fixture)
  return spawnSync('sh', ['-c', unit.command], {
    cwd: join(root, unit.cwd),
    encoding: 'utf8',
    env: { ...process.env, NODE_TEST_CONTEXT: undefined }
  })
}

/** `interlock validate --json` against a root. */
function validate(fixture, root) {
  const r = spawnSync(process.execPath, [BIN, 'validate', fixture.change, '--root', root, '--json'], {
    cwd: ROOT,
    encoding: 'utf8'
  })
  return { status: r.status, report: r.stdout.trim() ? JSON.parse(r.stdout) : null, stderr: r.stderr }
}

test('the fixture set exists and covers more than one shape', () => {
  assert.ok(existsSync(FIXTURES_DIR), 'evals/ship/fixtures/ is missing')
  assert.ok(fixtures.length > 1, `expected more than one fixture, found ${fixtures.length}`)
  const shapes = fixtures.map(f => f.shape)
  assert.equal(
    new Set(shapes).size,
    shapes.length,
    `two fixtures declare the same shape (${shapes.join(' | ')}) — a second copy of one shape ` +
      `adds cost without adding signal`
  )
})

for (const fixture of fixtures) {
  test(`${fixture.id}: its description names the shape and what a failure means`, () => {
    const text = readFileSync(fixture.descriptionPath, 'utf8')
    assert.match(text, /^## Shape$/m, `${fixture.id}/FIXTURE.md has no "## Shape" section`)
    assert.match(
      text,
      /^## What a failure here means$/m,
      `${fixture.id}/FIXTURE.md has no "## What a failure here means" section`
    )
  })

  test(`${fixture.id}: its change is implementable, from its own root`, () => {
    const root = scratch(fixture)
    try {
      const { status, report, stderr } = validate(fixture, root)
      assert.ok(report, `interlock validate printed no JSON: ${stderr}`)
      assert.equal(
        status,
        0,
        `${fixture.id}: validate exited ${status} — problems: ${JSON.stringify(report.problems)}`
      )
      assert.equal(report.ready, true, `${fixture.id}: ${JSON.stringify(report.problems)}`)
      assert.ok(report.tasks.total > 0, `${fixture.id}: the change declares no tasks`)
      assert.equal(report.tasks.done, 0, `${fixture.id}: the starting state ships ticked tasks`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test(`${fixture.id}: the change requires more than one wave`, () => {
    // A change with no task consuming an earlier task's output would never
    // exercise the wave loop the eval exists to measure, so a run that
    // collapsed the plan into one sequential pass would be indistinguishable
    // from one that did not.
    assert.ok(
      fixture.taskDependencies.length > 0,
      `${fixture.id}: fixture.json declares no taskDependencies`
    )
    const root = scratch(fixture)
    try {
      const ids = new Set(validate(fixture, root).report.tasks.items.map(t => t.id))
      for (const { task, dependsOn } of fixture.taskDependencies) {
        assert.ok(ids.has(task), `${fixture.id}: taskDependencies names task ${task}, which does not exist`)
        for (const upstream of dependsOn) {
          assert.ok(
            ids.has(upstream),
            `${fixture.id}: task ${task} declares a dependency on ${upstream}, which does not exist`
          )
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test(`${fixture.id}: the starting state is red and the reference turns it green`, () => {
    const root = scratch(fixture)
    try {
      const before = runUnit(fixture, root)
      assert.notEqual(
        before.status,
        0,
        `${fixture.id}: the starting suite is green, so a run that changed nothing would grade ` +
          `as a success`
      )

      applyReference(fixture, root)

      const after = runUnit(fixture, root)
      assert.equal(
        after.status,
        0,
        `${fixture.id}: the reference implementation leaves the suite red, so this fixture cannot ` +
          `distinguish a loop that failed from a task that was impossible:\n` +
          `${(after.stdout + after.stderr).slice(-3000)}`
      )

      // "Solvable" is both halves: the suite goes green AND no task is left
      // over. A reference that went green while skipping a task would make a
      // loop that skipped the same task look correct.
      const report = validate(fixture, root).report
      assert.equal(
        report.tasks.remaining,
        0,
        `${fixture.id}: the reference leaves ${report.tasks.remaining} task(s) unticked`
      )

      // And the per-task artefacts the fixture declares are all present, so a
      // reference that ticked a box without producing anything fails here.
      const ids = report.tasks.items.map(t => t.id)
      assert.deepEqual(
        ids.filter(id => !(id in fixture.taskArtifacts)),
        [],
        `${fixture.id}: fixture.json's taskArtifacts does not cover every task id`
      )
      for (const [id, paths] of Object.entries(fixture.taskArtifacts)) {
        assert.ok(ids.includes(id), `${fixture.id}: taskArtifacts names task ${id}, which does not exist`)
        for (const path of paths) {
          assert.ok(
            existsSync(join(root, path)),
            `${fixture.id}: task ${id} declares ${path}, which the reference did not produce`
          )
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}

test('no committed fixture directory holds run state', () => {
  // The corpora were purged once already after exactly this kind of pollution.
  // A record written by a fixture is indistinguishable from a record written by
  // a real run, so the only safe amount of run state under a committed fixture
  // is none.
  const RUN_STATE = [
    /(^|\/)\.claude\/ship(\/|$)/,
    /(^|\/)\.claude\/learning(\/|$)/,
    /(^|\/)\.claude\/metrics(\/|$)/,
    /(^|\/)\.claude\/handoff(\/|$)/,
    /(^|\/)\.claude\/graph(\/|$)/,
    /(^|\/)\.claude\/autonomy\.json$/,
    /(^|\/)node_modules(\/|$)/,
    /(^|\/)\.git(\/|$)/
  ]
  const offenders = []
  for (const fixture of fixtures) {
    for (const path of walkFixture(fixture.dir)) {
      if (RUN_STATE.some(re => re.test(path))) offenders.push(`${fixture.id}/${path}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these committed fixture paths are run state, not fixture input:\n  ${offenders.join('\n  ')}\n` +
      `Only a fixture's declared inputs are committed; everything a run produces belongs in the ` +
      `scratch root and is never copied back.`
  )
})

// --- the testing profiles are tracked (spec: evals/outcome-fixtures) --------
//
// `.gitignore` lists `.claude/testing/`. That pattern carries an interior
// slash, so it is anchored at the repository root and does NOT reach into
// `evals/ship/fixtures/<id>/start/.claude/testing/`. Every fixture depends on
// that being true — an untracked profile means the fixture arrives at the
// scratch root with no unit command, and the run then has nothing to verify
// against. The next contributor will assume the opposite, so this asserts it
// rather than leaving it to a comment.

const gitCheck = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, encoding: 'utf8' })
const NOT_A_CHECKOUT =
  gitCheck.error || gitCheck.status !== 0
    ? 'not a git checkout (or git unavailable) — tracking status cannot be determined'
    : false

test("every fixture's testing profile is tracked", { skip: NOT_A_CHECKOUT }, () => {
  const untracked = []
  for (const fixture of fixtures) {
    const rel = `evals/ship/fixtures/${fixture.id}/start/.claude/testing/profile.json`
    assert.ok(existsSync(join(ROOT, rel)), `${fixture.id}: no testing profile at ${rel}`)
    const listed = spawnSync('git', ['ls-files', '--', rel], { cwd: ROOT, encoding: 'utf8' })
    assert.equal(listed.status, 0, `git ls-files exited ${listed.status}: ${listed.stderr}`)
    if (!listed.stdout.trim()) untracked.push(rel)
  }
  assert.deepEqual(
    untracked,
    [],
    `these fixture testing profiles are not tracked:\n  ${untracked.join('\n  ')}\n` +
      `.gitignore lists \`.claude/testing/\`, which is root-anchored and must not reach into a ` +
      `fixture. If git is now ignoring these, the pattern changed — fix the pattern, do not ` +
      `force-add the profiles.`
  )
})
