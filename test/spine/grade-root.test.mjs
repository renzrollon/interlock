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
