// The post-install smoke, run against the working tree's own binaries.
//
// scripts/postinstall-smoke.mjs is what CI runs against the installed tarball:
// it calls every subcommand a skill, the ship driver, the run program's steps or
// a hook calls, and asserts the exit code and the JSON keys the caller reads.
// Run here against `bin/`, the same inventory fails `npm test` the day a command
// a shipped surface calls stops working, instead of failing only in a pipeline
// that most contributors never wait for.
//
// spec: distribution/release-gates — "The installed tarball SHALL run every
// command the shipped surfaces call"; design D21.
//
// About 4 seconds. In the sandbox the notify entries use an empty topic and stay
// offline, so nothing here needs a port or a host.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN_DIR = join(REPO, 'bin')
const SCRIPT = join(REPO, 'scripts', 'postinstall-smoke.mjs')

let scratch

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'interlock-smoke-'))
})

after(() => {
  rmSync(scratch, { recursive: true, force: true })
})

/** The exit codes an entry accepts, as an array whichever way the entry spells them. */
const codesOf = entry => [].concat(entry.codes === undefined ? [] : entry.codes)

/** An entry's argv joined for a message and for pattern matching. */
const line = entry => `${entry.bin} ${entry.argv.join(' ')}`

async function inventory() {
  assert.ok(existsSync(SCRIPT), 'scripts/postinstall-smoke.mjs does not exist')
  const mod = await import('../../scripts/postinstall-smoke.mjs')
  assert.ok(Array.isArray(mod.INVENTORY), 'scripts/postinstall-smoke.mjs must export INVENTORY, an array')
  assert.ok(mod.INVENTORY.length > 0, 'INVENTORY is empty')
  return mod.INVENTORY
}

// --- the run -------------------------------------------------------------------------

test('the smoke runs clean against the repository bin and exits 0', () => {
  assert.ok(existsSync(SCRIPT), 'scripts/postinstall-smoke.mjs does not exist')
  const r = spawnSync(process.execPath, [SCRIPT, BIN_DIR, REPO, scratch], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 180_000,
    env: {
      ...process.env,
      // Led by the repository's bin/, so a bare `interlock` in the script — and
      // the doctor's cli-version row — resolves to this tree and not to whatever
      // the developer installed globally.
      PATH: `${BIN_DIR}${delimiter}${process.env.PATH || ''}`,
      // Offline: a notify entry with a topic would make a request.
      INTERLOCK_NTFY_TOPIC: '',
      CLAUDE_ENV_FILE: ''
    }
  })
  assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.message}`)
  assert.equal(r.status, 0, `the smoke failed (exit ${r.status}):\n${r.stdout}\n${r.stderr}`)
  const rows = r.stdout.split('\n').filter(l => /^\s*(PASS|FAIL)\b/.test(l))
  assert.ok(rows.length >= 10, `expected one PASS or FAIL row per inventory command, found ${rows.length}:\n${r.stdout}`)
  assert.deepEqual(rows.filter(l => /^\s*FAIL\b/.test(l)), [], 'no row fails')
  assert.match(r.stdout, /--version/, 'the version command has a row')
  assert.match(r.stdout, /tasks tick/, 'the recovery command has a row')
  assert.match(r.stdout, /doctor/, 'the doctor has a row')
})

test('the smoke exits 1 when the binary directory holds no interlock', () => {
  assert.ok(existsSync(SCRIPT), 'scripts/postinstall-smoke.mjs does not exist')
  const empty = mkdtempSync(join(tmpdir(), 'interlock-smoke-empty-'))
  try {
    const r = spawnSync(process.execPath, [SCRIPT, empty, REPO, scratch], {
      cwd: REPO,
      encoding: 'utf8',
      timeout: 180_000,
      env: { ...process.env, PATH: `${empty}${delimiter}${dirname(process.execPath)}`, INTERLOCK_NTFY_TOPIC: '' }
    })
    assert.equal(r.error, undefined)
    assert.equal(r.status, 1, `a prefix with no binaries is a failure, not a pass:\n${r.stdout}\n${r.stderr}`)
    assert.match(r.stdout, /FAIL/)
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

// --- the inventory ----------------------------------------------------------------------

test('every inventory entry names a binary, an argv, the exit codes it accepts and the keys it reads', async () => {
  for (const entry of await inventory()) {
    assert.ok(['interlock', 'interlock-graph', 'interlock-run'].includes(entry.bin), `unknown bin in ${JSON.stringify(entry)}`)
    assert.ok(Array.isArray(entry.argv) && entry.argv.every(a => typeof a === 'string'), `argv of ${entry.bin}`)
    const codes = codesOf(entry)
    assert.ok(codes.length > 0 && codes.every(Number.isInteger), `${line(entry)} must declare the exit codes it accepts`)
    if (entry.keys !== undefined) assert.ok(Array.isArray(entry.keys), `keys of ${line(entry)} is a list`)
    if (entry.check !== undefined) assert.equal(typeof entry.check, 'function', `check of ${line(entry)}`)
  }
})

test('the inventory holds --version', async () => {
  const entries = await inventory()
  const version = entries.find(e => e.bin === 'interlock' && e.argv.length === 1 && e.argv[0] === '--version')
  assert.ok(version, 'no entry runs `interlock --version`')
  assert.ok(codesOf(version).includes(0))
})

test('the inventory holds the recovery line: tasks tick <change>', async () => {
  const entries = await inventory()
  const tick = entries.find(e => e.bin === 'interlock' && e.argv[0] === 'tasks' && e.argv[1] === 'tick')
  assert.ok(tick, 'no entry runs `interlock tasks tick`')
  // The positional form the halt card prints, not --change: that is the form that
  // was broken, and the form a smoke that used --change would never have caught.
  assert.ok(
    typeof tick.argv[2] === 'string' && !tick.argv[2].startsWith('-'),
    `tasks tick must name the change positionally: ${line(tick)}`
  )
  assert.ok(tick.argv.includes('--ids'))
  assert.deepEqual(codesOf(tick), [0])
})

test('the inventory holds an unknown-flag refusal that expects exit 2', async () => {
  const entries = await inventory()
  const refusal = entries.find(e => e.bin === 'interlock' && codesOf(e).includes(2) && e.argv.some(a => a.startsWith('--')))
  assert.ok(refusal, 'no entry expects exit 2 for a flag the CLI does not declare')
  assert.ok(!codesOf(refusal).includes(0), `a refusal that also accepts 0 would pass against the permissive CLI: ${line(refusal)}`)
})

test('the inventory holds -h after a subcommand', async () => {
  const entries = await inventory()
  const help = entries.find(e => e.bin === 'interlock' && e.argv.length >= 2 && !e.argv[0].startsWith('-') && e.argv.slice(1).some(a => a === '-h' || a === '--help'))
  assert.ok(help, 'no entry runs `interlock <subcommand> -h`')
  assert.ok(codesOf(help).includes(0))
})

test('the inventory holds doctor --json and reads the cli-version and plugin rows', async () => {
  const entries = await inventory()
  const doctor = entries.find(e => e.bin === 'interlock' && e.argv[0] === 'doctor' && e.argv.includes('--json'))
  assert.ok(doctor, 'no entry runs `interlock doctor --json`')
  assert.equal(typeof doctor.check, 'function', 'the doctor entry carries a check for the two rows')
  assert.ok(Array.isArray(doctor.keys) && doctor.keys.includes('checks'), 'the preflight hook reads `checks`')
})

test('the inventory holds the record-batch -> judge -> strict review chain, in that order', async () => {
  const entries = await inventory()
  const at = pattern => entries.findIndex(e => pattern.test(line(e)))
  const batch = at(/\brun record-batch\b/)
  const judge = at(/\brun judge\b/)
  const strict = entries.findIndex(e => e.argv.includes('--strict') && /\b(run|review)\b/.test(line(e)))
  assert.ok(batch >= 0, 'no entry runs `run record-batch`')
  assert.ok(judge >= 0, 'no entry runs `run judge`')
  assert.ok(strict >= 0, 'no entry runs a --strict review step')
  assert.ok(batch < judge && judge < strict, `the chain is out of order: record-batch ${batch}, judge ${judge}, strict ${strict}`)
})

test('every notify entry carries an empty topic, so the smoke never makes a request', async () => {
  const entries = await inventory()
  for (const entry of entries.filter(e => e.argv[0] === 'notify')) {
    const env = entry.env || {}
    assert.equal(env.INTERLOCK_NTFY_TOPIC ?? '', '', `${line(entry)} must run with an empty topic`)
  }
})
