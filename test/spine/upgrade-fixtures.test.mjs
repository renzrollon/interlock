// Run state written by an earlier release, fed to the current CLI.
//
// Nothing used to install release N-1, write a run, and resume it under N. The
// one committed older run (halted-run-6e9d0b02) was drawn by four tests and never
// handed to `run start`, so whether an upgrade resumed a run or silently threw
// its provenance away was a question no test asked. These two requirements ask
// it against committed snapshots rather than by assertion.
//
// spec: distribution/upgrade-compatibility (first two requirements); design D24.
//
// The snapshots are cut by scripts/cut-release-fixture.mjs, which drives the
// extracted old CLI, and carry the token ${ROOT} wherever the cutting machine's
// scratch path was. This file puts each one into a fresh root, substitutes the
// token, and requires two things of the current CLI: `run start` names whether
// the plan was reused or rebuilt, and the run continues through a recorded batch
// to a closing receipt. No model, no network.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
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
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRunLog } from '../../lib/run-log.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(REPO, 'cli', 'interlock')
const FIXTURES = join(REPO, 'test', 'fixtures', 'ship')
const VERSION = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version

const TOKEN = '${ROOT}'

// --- plumbing -----------------------------------------------------------------

/** Every regular file under `dir`, as absolute paths. */
function filesUnder(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...filesUnder(abs))
    else if (entry.isFile()) out.push(abs)
  }
  return out
}

/** `[major, minor, patch]`, compared numerically so 1.10.0 is above 1.9.0. */
const triple = v => String(v).split('.').map(n => Number.parseInt(n, 10) || 0)
function below(a, b) {
  const [x, y] = [triple(a), triple(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]
  return false
}

/** The `release-<version>` fixture directories, by version. */
function releaseFixtures() {
  if (!existsSync(FIXTURES)) return []
  return readdirSync(FIXTURES)
    .map(name => /^release-(\d+\.\d+\.\d+)$/.exec(name))
    .filter(Boolean)
    .map(m => ({ version: m[1], name: m[0], dir: join(FIXTURES, m[0]) }))
}

/**
 * Where a machine path would show: a scratch directory, a macOS temp directory,
 * or a home directory. The cutting user's home is the test runner's only when
 * the same person cut and runs it, so the generic `/Users/<name>` and
 * `/home/<name>` shapes are matched as well.
 */
function machinePathsIn(text) {
  const found = new Set()
  const patterns = [/\/tmp\//g, /\/private\//g, /\/var\/folders\//g, /\/Users\/[A-Za-z0-9._-]+/g, /\/home\/[A-Za-z0-9._-]+/g]
  for (const re of patterns) for (const m of text.matchAll(re)) found.add(m[0])
  const home = homedir()
  if (home && home !== '/' && text.includes(home)) found.add(home)
  return [...found]
}

/** Replace the ${ROOT} token in every text file under `dir`. */
function substituteRoot(dir, root) {
  for (const file of filesUnder(dir)) {
    const text = readFileSync(file, 'utf8')
    if (text.includes(TOKEN)) writeFileSync(file, text.split(TOKEN).join(root))
  }
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** A fresh, realpath'd temp root that is a git work tree. */
function freshRoot(label) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `interlock-upgrade-${label}-`)))
  git(root, 'init', '-q', '.')
  git(root, 'config', 'user.email', 'test@example.com')
  git(root, 'config', 'user.name', 'test')
  return root
}

function commitAll(root) {
  git(root, 'add', '-A')
  git(root, 'commit', '-qm', 'snapshot', '--allow-empty')
}

function file(root, path, body) {
  const dest = join(root, path)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n')
  return dest
}

/** Run the current CLI in `root`. Never throws: the exit code is part of the answer. */
function cli(root, args, { results } = {}) {
  const full = [...args]
  if (results !== undefined) {
    file(root, '.claude/ship/results.json', results)
    full.push('--results', '.claude/ship/results.json')
  }
  const r = spawnSync(process.execPath, [BIN, ...full], { cwd: root, encoding: 'utf8', env: { ...process.env, INTERLOCK_NTFY_TOPIC: '' } })
  assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.message}`)
  let json = null
  try {
    json = r.stdout.trim() ? JSON.parse(r.stdout) : null
  } catch {
    json = null
  }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json }
}

const manifestOf = root => JSON.parse(readFileSync(join(root, '.claude', 'ship', 'run.json'), 'utf8'))

/** The unchecked and checked task ids of a change's tasks.md. */
function taskIds(root, change) {
  const text = readFileSync(join(root, 'openspec', 'changes', change, 'tasks.md'), 'utf8')
  return [...text.matchAll(/^\s*- \[( |x)\]\s+(\d+(?:\.\d+)*)\b/gm)].map(m => ({ done: m[1] === 'x', id: m[2] }))
}

const handoffOk = id => ({
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
})

/**
 * Follow the steps the CLI names, answering each the way a host would with every
 * agent succeeding, until a step names no continuation. Returns the last step.
 *
 * A host interprets; it decides nothing. This is the smallest interpreter that
 * can carry a run from `run start` to its close without a model, and it reads
 * only `action`, `lanes`, `spawns` and `then.argv` — the fields the relay passes.
 */
function drive(root, change, first) {
  let step = first
  for (let hops = 0; hops < 25; hops++) {
    if (!step || !step.then || !Array.isArray(step.then.argv)) return step
    const argv = step.then.argv
    let results
    if (step.action === 'classify') {
      const open = taskIds(root, change).filter(t => !t.done)
      file(root, '.claude/ship/classified.json', {
        tasks: open.map(t => ({
          id: t.id,
          group: Number.parseInt(t.id, 10),
          description: `task ${t.id}`,
          tier: 2,
          model: 'sonnet',
          isTestTask: false,
          paths: ['README.md']
        }))
      })
    } else if (step.action === 'run-batch') {
      results = (step.spawns || []).map((_, i) => ({ tasks: (step.lanes[i] || []).map(t => handoffOk(t.id)) }))
    } else if (step.action === 'commit') {
      results = [{ ok: true, sha: 'abc1234' }]
    }
    const next = cli(root, [...argv, '--json'], results === undefined ? {} : { results })
    assert.ok(next.json, `interlock ${argv.join(' ')} printed no step (exit ${next.code})\nstderr: ${next.stderr}`)
    step = next.json
  }
  assert.fail('the run did not reach a terminal step within 25 hops')
}

/** The trajectory events of the manifest's current run, read from the root. */
function trajectoryOf(root) {
  const runId = manifestOf(root).runId
  assert.ok(runId, 'the run never adopted a plan, so it has no run id')
  return readRunLog(root, runId).records
}

// --- the snapshots themselves ---------------------------------------------------

test('at least one release snapshot exists, cut from a release below the current version', () => {
  const fixtures = releaseFixtures()
  assert.ok(
    fixtures.length > 0,
    `test/fixtures/ship/release-<version>/ holds no snapshot — cut one with scripts/cut-release-fixture.mjs v<previous release>`
  )
  assert.ok(
    fixtures.some(f => below(f.version, VERSION)),
    `no snapshot is below package.json's ${VERSION}: ${fixtures.map(f => f.name).join(', ')}. ` +
      `A snapshot cut from the current version proves nothing about an upgrade.`
  )
})

test('the machine-path scan flags a scratch path, a macOS temp path and a home directory', () => {
  assert.deepEqual(machinePathsIn('{"cwd":"${ROOT}/x","a":"relative/path"}'), [])
  assert.ok(machinePathsIn('/tmp/scratch-1/.claude').includes('/tmp/'))
  assert.ok(machinePathsIn('/private/var/folders/ab/T/x').length >= 2)
  assert.ok(machinePathsIn('/Users/someone/IdeaProjects/x').some(p => p.startsWith('/Users/someone')))
  assert.ok(machinePathsIn('/home/runner/work/x').some(p => p.startsWith('/home/runner')))
})

for (const fixture of releaseFixtures()) {
  test(`${fixture.name}: no file holds a path from the machine that cut it`, () => {
    const offenders = []
    for (const abs of filesUnder(fixture.dir)) {
      const hits = machinePathsIn(readFileSync(abs, 'utf8'))
      if (hits.length) offenders.push(`${relative(REPO, abs)}: ${hits.join(', ')}`)
    }
    assert.deepEqual(offenders, [], `a snapshot must carry ${TOKEN}, never a machine path:\n  ${offenders.join('\n  ')}`)
  })

  test(`${fixture.name}: it carries the run state the old CLI wrote, and the change it ran`, () => {
    const manifestPath = join(fixture.dir, '.claude', 'ship', 'run.json')
    assert.ok(existsSync(manifestPath), `${fixture.name} holds no .claude/ship/run.json`)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    assert.equal(manifest.schema, 'interlock.run/1')
    assert.equal(typeof manifest.change, 'string')
    assert.ok(
      existsSync(join(fixture.dir, 'openspec', 'changes', manifest.change, 'tasks.md')),
      `${fixture.name} must hold openspec/changes/${manifest.change}/ — run start reads the change, and a snapshot without it cannot be resumed`
    )
  })

  test(`${fixture.name}: under the current CLI, run start names reuse or a rebuild, and the run reaches a receipt`, () => {
    const root = freshRoot('release')
    try {
      cpSync(fixture.dir, root, { recursive: true })
      substituteRoot(root, root)
      assert.deepEqual(
        filesUnder(root).filter(f => readFileSync(f, 'utf8').includes(TOKEN)),
        [],
        'the token is substituted everywhere'
      )
      const old = manifestOf(root)
      const change = old.change
      commitAll(root)

      const started = cli(root, ['run', 'start', '--change', change, '--json'])
      assert.equal(started.code, 0, `run start exited ${started.code}\nstdout: ${started.stdout}\nstderr: ${started.stderr}`)
      assert.ok(started.json, 'run start printed a step')
      assert.notEqual(started.json.action, 'halt', `run start halted: ${started.json.reason || started.stdout}`)

      // Named, not inferred: the manifest says which path was taken and why, and
      // a rebuilt plan is a banner on the start step the host reports.
      const plan = manifestOf(root).plan
      assert.ok(plan && typeof plan.status === 'string' && plan.status, `the manifest names no plan status: ${JSON.stringify(plan)}`)
      assert.equal(typeof plan.reused, 'boolean')
      assert.ok(typeof plan.reason === 'string' && plan.reason, 'and says why')
      if (plan.reused) {
        assert.equal(plan.status, 'match')
      } else {
        assert.notEqual(plan.status, 'no-plan', 'the snapshot holds a stored plan, so a rebuild is never "no plan"')
        const banners = (started.json.banners || []).join('\n')
        assert.match(banners, new RegExp(`PLAN REBUILT \\(${plan.status}\\)`), `the start step must carry the rebuild banner:\n${banners}`)
      }

      // Through a recorded batch to the close.
      const last = drive(root, change, started.json)
      assert.ok(last, 'the run ended with a step')
      assert.equal(last.then, null, `the run did not terminate: ${JSON.stringify(last).slice(0, 300)}`)
      assert.equal(last.action, 'complete', `the run did not close clean: ${last.reason || last.summary || last.action}`)
      const receipts = trajectoryOf(root).filter(r => r.type === 'run-receipt')
      assert.equal(receipts.length, 1, 'the closed run wrote exactly one receipt')
      assert.ok(existsSync(join(root, '.claude', 'ship', 'last-close.json')), 'and kept its close')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test(`${fixture.name}: following a refusal of the halted run to its close keeps the original halt and close`, () => {
    const root = freshRoot('replay')
    try {
      cpSync(fixture.dir, root, { recursive: true })
      substituteRoot(root, root)
      commitAll(root)
      const before = manifestOf(root)
      assert.ok(before.halted, `${fixture.name} is a halted run`)
      assert.equal(before.closedAt, undefined, 'the old release recorded no close time')
      const lastClosePath = join(root, '.claude', 'ship', 'last-close.json')
      const lastClose = readFileSync(lastClosePath, 'utf8')
      const trajectory = readFileSync(join(root, '.claude', 'ship', 'runs', `${before.runId}.jsonl`), 'utf8')

      const refused = cli(root, ['run', 'next', '--json'])
      assert.equal(refused.json && refused.json.action, 'halt', refused.stdout)
      assert.deepEqual(refused.json.then.argv.slice(0, 3), ['run', 'close', '--halt'])

      const followed = cli(root, [...refused.json.then.argv, '--json'])
      assert.ok(followed.json, `the close printed no step: ${followed.stderr}`)
      assert.equal(followed.json.summary, JSON.parse(lastClose).summary, 'the close on record is what comes back')
      assert.equal(followed.code, JSON.parse(lastClose).exitCode, 'with its original exit code')

      const after = manifestOf(root)
      assert.equal(after.halted, before.halted, 'the original halt reason is kept')
      assert.equal(after.seq, before.seq, 'the replay was not numbered')
      assert.equal(after.closedAt, undefined, 'nothing was recorded on the manifest')
      assert.equal(readFileSync(lastClosePath, 'utf8'), lastClose, 'last-close.json is byte-identical')
      assert.equal(
        readFileSync(join(root, '.claude', 'ship', 'runs', `${before.runId}.jsonl`), 'utf8'),
        trajectory,
        'no event was appended to the trajectory'
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}

// --- the oldest committed run ------------------------------------------------------

const OLD_RUN = join(FIXTURES, 'halted-run-6e9d0b02')
const OLD_RUN_ID = '6e9d0b02-c70b-4d7a-9865-fa892722cecb'
const OLD_CHANGE = 'harden-unattended-ship-runs'

/** The halted pre-1.0 run placed under a repository that holds its change. */
function oldRunRoot() {
  const root = freshRoot('6e9d0b02')
  const plan = JSON.parse(readFileSync(join(OLD_RUN, 'plan.json'), 'utf8'))
  const state = JSON.parse(readFileSync(join(OLD_RUN, 'state.json'), 'utf8'))

  // The change the run was shipping, as a ready change: its tasks are the ids
  // the stored plan names, the ones the run finished already ticked.
  const ids = new Set()
  const walk = node => {
    if (Array.isArray(node)) node.forEach(walk)
    else if (node && typeof node === 'object') {
      if (typeof node.id === 'string' && /^\d+(\.\d+)+$/.test(node.id)) ids.add(node.id)
      Object.values(node).forEach(walk)
    }
  }
  walk(plan.waves)
  const done = new Set(Array.isArray(state.completed) ? state.completed : [])
  const lines = [...ids]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(id => `- [${done.has(id) ? 'x' : ' '}] ${id} task ${id}`)
  const base = `openspec/changes/${OLD_CHANGE}`
  file(root, `${base}/proposal.md`, '# Harden unattended ship runs\n\nWhy: a run nobody watches must say what it did.\n')
  file(root, `${base}/design.md`, '# Design\n\nD1: record every step.\n')
  file(root, `${base}/tasks.md`, `# Tasks\n\n${lines.join('\n')}\n`)
  file(root, 'README.md', 'hello\n')

  // The stored plan and state, where a run of that release left them. No
  // fingerprint: that file did not exist yet.
  cpSync(join(OLD_RUN, 'plan.json'), join(root, '.claude', 'ship', 'plan.json'))
  cpSync(join(OLD_RUN, 'state.json'), join(root, '.claude', 'ship', 'state.json'))
  mkdirSync(join(root, '.claude', 'ship', 'runs'), { recursive: true })
  cpSync(join(OLD_RUN, 'trajectory.jsonl'), join(root, '.claude', 'ship', 'runs', `${OLD_RUN_ID}.jsonl`))
  commitAll(root)
  return root
}

test('halted-run-6e9d0b02: run start rebuilds the plan, naming the missing fingerprint', () => {
  const root = oldRunRoot()
  try {
    assert.equal(existsSync(join(root, '.claude', 'ship', 'plan-fingerprint.json')), false, 'the 6e9d0b02 run predates fingerprints')
    const started = cli(root, ['run', 'start', '--change', OLD_CHANGE, '--json'])
    assert.equal(started.code, 0, `stdout: ${started.stdout}\nstderr: ${started.stderr}`)
    assert.equal(started.json.action, 'classify', 'a plan with no provenance is not trusted, so the run plans again')
    const banners = (started.json.banners || []).join('\n')
    assert.match(banners, /PLAN REBUILT \(no-fingerprint\)/, banners)
    const plan = manifestOf(root).plan
    assert.equal(plan.reused, false)
    assert.equal(plan.status, 'no-fingerprint')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('halted-run-6e9d0b02: wave-state next halts it for task failures', () => {
  const root = oldRunRoot()
  try {
    const next = cli(root, ['wave-state', 'next', '--state', '.claude/ship/state.json', '--json'])
    assert.equal(next.code, 1, 'a halted run exits 1 from wave-state next')
    assert.ok(next.json, `wave-state next printed no JSON: ${next.stdout}`)
    assert.equal(next.json.action, 'halt')
    assert.equal(next.json.kind, 'task-failures')
    assert.match(next.json.reason, /task failures/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('halted-run-6e9d0b02: run-log check still finds its trajectory reconstructable, before and after the CLI reads it', () => {
  const root = oldRunRoot()
  try {
    const before = cli(root, ['run-log', 'check', '--run-id', OLD_RUN_ID, '--json'])
    assert.equal(before.code, 0, `stdout: ${before.stdout}\nstderr: ${before.stderr}`)
    assert.equal(before.json.ok, true, JSON.stringify(before.json.problems))
    assert.deepEqual(before.json.problems, [])

    cli(root, ['wave-state', 'next', '--state', '.claude/ship/state.json', '--json'])
    cli(root, ['run', 'start', '--change', OLD_CHANGE, '--json'])

    const after = cli(root, ['run-log', 'check', '--run-id', OLD_RUN_ID, '--json'])
    assert.equal(after.code, 0, `stdout: ${after.stdout}\nstderr: ${after.stderr}`)
    assert.equal(after.json.ok, true, JSON.stringify(after.json.problems))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
