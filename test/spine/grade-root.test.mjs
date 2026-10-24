// `evals/ship/run.mjs --grade-root` grades an interactive /interlock:ship run in
// place and appends one row that says what produced it. No model, no credential.
// (change harden-release-upgrade-path, design D30; spec evals/local-grading)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runShip, receiptFrom, DEMO_CHANGE } from '../helpers/ship-harness.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const EVAL = join(REPO, 'evals', 'ship', 'run.mjs')
const ROW_FILE = ['evals', 'history', 'ship-outcomes.jsonl']
const VERSION_KEYS = ['cli', 'plugin', 'cliVersion', 'pluginVersion']

function baselineOf(root) {
  return execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
}

/**
 * Run the grade-root form with every agent CLI replaced by a stub that records
 * being called, and no credential in the environment. A stub that was never
 * invoked is the evidence that nothing was spawned.
 */
function gradeRoot(root, history, extra = []) {
  const stubs = mkdtempSync(join(tmpdir(), 'interlock-grade-stubs-'))
  const marker = join(stubs, 'SPAWNED')
  for (const name of ['claude', 'codex', 'qwen', 'gemini']) {
    writeFileSync(join(stubs, name), `#!/bin/sh\necho "${name} $*" >> "${marker}"\nexit 1\n`)
    chmodSync(join(stubs, name), 0o755)
  }
  const env = { ...process.env, PATH: `${stubs}:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin` }
  for (const key of Object.keys(env)) if (/API_KEY|AUTH_TOKEN|OAUTH/i.test(key)) delete env[key]
  const r = spawnSync(
    process.execPath,
    [
      EVAL,
      '--grade-root', root,
      '--change', DEMO_CHANGE,
      '--baseline-commit', baselineOf(root),
      '--fixture-id', 'harness',
      '--history-root', history,
      '--json',
      ...extra
    ],
    { cwd: root, encoding: 'utf8', env }
  )
  assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.message}`)
  const spawned = existsSync(marker) ? readFileSync(marker, 'utf8') : ''
  rmSync(stubs, { recursive: true, force: true })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, spawned }
}

function rows(history) {
  const file = join(history, ...ROW_FILE)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
}

/** The first object anywhere in `value` whose `id` is `id`. */
function findCriterion(value, id) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findCriterion(item, id)
      if (hit) return hit
    }
  } else if (value && typeof value === 'object') {
    if (value.id === id) return value
    for (const item of Object.values(value)) {
      const hit = findCriterion(item, id)
      if (hit) return hit
    }
  }
  return null
}

/** Make a kept root look like one written by a CLI that recorded no version. */
function stripVersions(root) {
  const strip = obj => {
    for (const key of VERSION_KEYS) delete obj[key]
    return obj
  }
  const runs = join(root, '.claude', 'ship', 'runs')
  for (const name of readdirSync(runs).filter(f => f.endsWith('.jsonl'))) {
    const file = join(runs, name)
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    writeFileSync(file, lines.map(line => JSON.stringify(strip(JSON.parse(line)))).join('\n') + '\n')
  }
  for (const rel of ['run.json', 'last-close.json']) {
    const file = join(root, '.claude', 'ship', rel)
    if (!existsSync(file)) continue
    writeFileSync(file, JSON.stringify(strip(JSON.parse(readFileSync(file, 'utf8'))), null, 2) + '\n')
  }
}

test('grade-root appends one interactive-session row keyed on the run\'s recorded version', async () => {
  const { root } = await runShip({ keepRepo: true })
  const history = mkdtempSync(join(tmpdir(), 'interlock-grade-history-'))
  try {
    const receipt = receiptFrom(root)
    const recorded = receipt && (receipt.pluginVersion || receipt.cliVersion)
    assert.ok(
      typeof recorded === 'string' && recorded.length > 0,
      'the run must record the plugin or CLI version on its receipt for a row to be keyed on it'
    )

    const r = gradeRoot(root, history)
    assert.equal(r.code, 0, r.stderr)
    assert.equal(r.spawned, '', 'grade-root must spawn no agent')

    const appended = rows(history)
    assert.equal(appended.length, 1, `expected exactly one row, saw ${appended.length}`)
    assert.equal(appended[0].host, 'workflow')
    assert.equal(appended[0].evalAgent, 'interactive-session')
    assert.equal(appended[0].version, recorded)
    assert.equal(appended[0].fixture, 'harness')
    assert.equal(appended[0].arm, 'loop')
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(history, { recursive: true, force: true })
  }
})

test('without baseline counts the not-weakened criterion is unobserved, with its reason', async () => {
  const { root } = await runShip({ keepRepo: true })
  const history = mkdtempSync(join(tmpdir(), 'interlock-grade-history-'))
  try {
    const r = gradeRoot(root, history)
    assert.equal(r.code, 0, r.stderr)

    const printed = findCriterion(JSON.parse(r.stdout), 'unit-suite-not-weakened')
    assert.ok(printed, 'the printed grade must carry the not-weakened criterion')
    assert.equal(printed.status, 'unobserved')
    assert.notEqual(printed.met, true)
    assert.ok(
      typeof printed.detail === 'string' && printed.detail.length > 0,
      'an unobserved criterion must say why'
    )

    const stored = findCriterion(rows(history), 'unit-suite-not-weakened')
    assert.ok(stored, 'the appended row must carry the criterion')
    assert.equal(stored.status, 'unobserved')
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(history, { recursive: true, force: true })
  }
})

test('a run that recorded no version is refused: nothing appended, non-zero, the reason named', async () => {
  const { root } = await runShip({ keepRepo: true })
  const history = mkdtempSync(join(tmpdir(), 'interlock-grade-history-'))
  try {
    stripVersions(root)

    const r = gradeRoot(root, history)
    assert.notEqual(r.code, 0, 'a versionless run must not be graded into the history')
    assert.deepEqual(rows(history), [])
    assert.match(`${r.stdout}\n${r.stderr}`, /version/i, 'the refusal must say the run carries no version')
    assert.equal(r.spawned, '', 'a refusal must not spawn an agent either')
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(history, { recursive: true, force: true })
  }
})

// --- which run is graded, and which release the row is keyed on ---------------
// (design D30: `--run-id` defaults to the newest run; the version is the plugin's,
// falling back to the CLI's)

const DAY_MS = 24 * 60 * 60 * 1000

/** Every run file in a kept root, parsed, keyed by run id. */
function runFiles(root) {
  const dir = join(root, '.claude', 'ship', 'runs')
  return readdirSync(dir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({
      id: f.slice(0, -'.jsonl'.length),
      file: join(dir, f),
      records: readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
    }))
}

function writeRun(file, records) {
  writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n')
}

/**
 * Copy the kept root's only run under a new id, its timestamps moved by `shiftMs`
 * and `edit(record)` applied to each record. The copy is a second run of the same
 * change in the same trajectory directory, which is the case a maintainer meets
 * after shipping twice.
 */
function cloneRun(root, id, shiftMs, edit = r => r) {
  const [original] = runFiles(root)
  const records = original.records.map(r => {
    const copy = { ...r, runId: id }
    if (typeof copy.ts === 'string') copy.ts = new Date(Date.parse(copy.ts) + shiftMs).toISOString()
    return edit(copy)
  })
  writeRun(join(dirname(original.file), `${id}.jsonl`), records)
  return id
}

/** Rewrite every record of the root's only run. */
function rewriteRun(root, edit) {
  const [only] = runFiles(root)
  writeRun(only.file, only.records.map(r => edit({ ...r })))
  return only.id
}

const withVersions = ({ receipt = {}, start = {} }) => r => {
  if (r.type === 'run-receipt') {
    for (const key of ['cliVersion', 'pluginVersion']) delete r[key]
    Object.assign(r, receipt)
  }
  if (r.type === 'run-start') {
    delete r.cli
    delete r.plugin
    Object.assign(r, start)
  }
  return r
}

async function withRoot(fn) {
  const { root } = await runShip({ keepRepo: true })
  const history = mkdtempSync(join(tmpdir(), 'interlock-grade-history-'))
  try {
    return await fn(root, history)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(history, { recursive: true, force: true })
  }
}

test('with no --run-id the newest run by recorded start time is graded, whatever the file order', async () => {
  await withRoot(async (root, history) => {
    const real = runFiles(root)[0].id
    // 'aaaa-…' sorts first and 'zzzz-…' last by name; the start times say the
    // opposite order, so a pick by directory order would be wrong either way.
    const older = cloneRun(root, 'zzzz-older', -DAY_MS, withVersions({ receipt: { pluginVersion: '0.0.1-older' } }))
    const newer = cloneRun(root, 'aaaa-newer', DAY_MS, withVersions({ receipt: { pluginVersion: '9.9.9-newer' } }))

    const r = gradeRoot(root, history)
    assert.equal(r.code, 0, r.stderr)
    const report = JSON.parse(r.stdout)
    assert.equal(report.runId, newer, `graded ${report.runId}; ${real} and ${older} are both older`)
    assert.equal(report.runPick, 'newest')
    assert.equal(report.version, '9.9.9-newer')
    assert.equal(rows(history).length, 1)
    assert.equal(rows(history)[0].version, '9.9.9-newer')
  })
})

test('--run-id grades the named run, even when it is not the newest', async () => {
  await withRoot(async (root, history) => {
    const older = cloneRun(root, 'zzzz-older', -DAY_MS, withVersions({ receipt: { pluginVersion: '0.0.1-older' } }))

    const r = gradeRoot(root, history, ['--run-id', older])
    assert.equal(r.code, 0, r.stderr)
    const report = JSON.parse(r.stdout)
    assert.equal(report.runId, older)
    assert.equal(report.runPick, 'flag')
    assert.equal(report.version, '0.0.1-older')
    assert.equal(rows(history)[0].version, '0.0.1-older')
  })
})

test('an unknown --run-id is refused with the id named, and nothing is appended', async () => {
  await withRoot(async (root, history) => {
    const r = gradeRoot(root, history, ['--run-id', 'no-such-run'])
    assert.notEqual(r.code, 0)
    assert.deepEqual(rows(history), [])
    assert.equal(JSON.parse(r.stdout).graded, false)
    assert.match(`${r.stdout}\n${r.stderr}`, /no-such-run.*no trajectory/s)
    assert.equal(r.spawned, '')
  })
})

test('runs that share the newest start time are tie-broken by id, and the output says so', async () => {
  await withRoot(async (root, history) => {
    cloneRun(root, 'tie-a', DAY_MS)
    cloneRun(root, 'tie-b', DAY_MS)

    const r = gradeRoot(root, history)
    assert.equal(r.code, 0, r.stderr)
    assert.equal(JSON.parse(r.stdout).runId, 'tie-b', 'the tie-break is the later run id, every time')
    assert.match(r.stderr, /share the newest start time/)
    assert.match(r.stderr, /tie-a/)
    assert.match(r.stderr, /--run-id/)
  })
})

test('the plugin version is the row\'s version when both are recorded', async () => {
  await withRoot(async (root, history) => {
    rewriteRun(
      root,
      withVersions({
        receipt: { pluginVersion: '2.0.0-plugin', cliVersion: '1.0.0-cli' },
        start: { plugin: { version: '2.0.0-plugin', root: '/p' }, cli: { version: '1.0.0-cli', path: '/c' } }
      })
    )
    const r = gradeRoot(root, history)
    assert.equal(r.code, 0, r.stderr)
    const report = JSON.parse(r.stdout)
    assert.equal(report.version, '2.0.0-plugin')
    assert.equal(report.versionSource, 'plugin')
    assert.equal(rows(history)[0].version, '2.0.0-plugin')
  })
})

test('the CLI version is used only when no plugin version is recorded, and the output says so', async () => {
  await withRoot(async (root, history) => {
    rewriteRun(root, withVersions({ receipt: { cliVersion: '1.0.0-cli' } }))
    const r = gradeRoot(root, history)
    assert.equal(r.code, 0, r.stderr)
    const report = JSON.parse(r.stdout)
    assert.equal(report.version, '1.0.0-cli')
    assert.equal(report.versionSource, 'cli')
    assert.equal(rows(history)[0].version, '1.0.0-cli')

    const prose = gradeRoot(root, history, ['--no-history']).stdout
    assert.ok(prose.includes('1.0.0-cli'))
  })
})

test('a receipt without versions falls back to the keys run-start actually writes (plugin.version, cli.version)', async () => {
  await withRoot(async (root, history) => {
    // Receipt carries no version; the start event records the nested blocks only.
    rewriteRun(
      root,
      withVersions({ start: { plugin: { version: '3.0.0-start-plugin', root: '/p' }, cli: { version: '1.0.0-start-cli', path: '/c' } } })
    )
    let report = JSON.parse(gradeRoot(root, history, ['--no-history']).stdout)
    assert.equal(report.version, '3.0.0-start-plugin')
    assert.equal(report.versionSource, 'plugin')

    // A run started with no plugin root records `plugin: null`: the CLI's block is then the answer.
    rewriteRun(root, withVersions({ start: { plugin: null, cli: { version: '1.0.0-start-cli', path: '/c' } } }))
    report = JSON.parse(gradeRoot(root, history, ['--no-history']).stdout)
    assert.equal(report.version, '1.0.0-start-cli')
    assert.equal(report.versionSource, 'cli')

    // Flat keys on the start event are not something run-start writes: they recover nothing.
    rewriteRun(root, withVersions({ start: { pluginVersion: '7.7.7-nowhere', cliVersion: '7.7.7-nowhere' } }))
    const r = gradeRoot(root, history)
    assert.notEqual(r.code, 0, 'a version no event records must not be conjured from keys nothing writes')
    assert.match(`${r.stdout}\n${r.stderr}`, /version/i)
    assert.deepEqual(rows(history), [])
  })
})
