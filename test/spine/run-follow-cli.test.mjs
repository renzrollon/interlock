// `interlock run-log follow`: the glue around `followStep`.
//
// ship/run-follow, every scenario. The reader (lib/run-follow-cli.mjs) takes its
// clock and its wait as arguments, so the polling scenarios run without a real
// wait: the fake wait appends to the trajectory, as a run would between reads.
// A few cases spawn the real binary against a finished run, which never waits.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { LIMITS } from '../../lib/limits.mjs'
import { followRun } from '../../lib/run-follow-cli.mjs'
import { RUN_LOG_SCHEMA, runLogDir, runLogPath } from '../../lib/run-log.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(ROOT, 'cli', 'interlock')

let tmp
before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'interlock-run-follow-cli-'))
})
after(() => {
  rmSync(tmp, { recursive: true, force: true })
})

let n = 0
const freshHome = () => mkdtempSync(join(tmp, `home${n++}-`))

const event = (runId, change, seq, type, extra = {}) =>
  JSON.stringify({ schema: RUN_LOG_SCHEMA, seq, ts: `2026-11-07T10:0${seq}:00.000Z`, runId, change, type, ...extra })

/** Write a trajectory; `lines` are raw lines. Returns its path. */
function trajectory(home, runId, lines, mtime) {
  mkdirSync(runLogDir(home), { recursive: true })
  const path = runLogPath(home, runId)
  writeFileSync(path, lines.join('\n') + '\n')
  if (mtime !== undefined) utimesSync(path, mtime / 1000, mtime / 1000)
  return path
}

/** Every file under `dir`, with its size and mtime, so a test can say nothing changed. */
function snapshot(dir) {
  const out = {}
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out[p] = `${statSync(p).size}:${statSync(p).mtimeMs}:${readFileSync(p, 'utf8')}`
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}

/** Run `followRun`; `onWait(ms, i)` runs in place of a sleep. Returns the exit, the lines and the waits. */
async function follow(home, { run, now = () => Date.now(), onWait = () => {} } = {}) {
  const lines = []
  const waits = []
  const code = await followRun({
    home,
    run,
    write: line => lines.push(line),
    now,
    wait: async ms => {
      waits.push(ms)
      onWait(ms, waits.length)
      if (waits.length > 50) throw new Error('the follower never ended')
    }
  })
  return { code, lines, waits }
}

test('a halt appended while following is printed within one period and ends the verb with 0', async () => {
  const home = freshHome()
  const path = trajectory(home, 'r-7', [
    event('r-7', 'add-foo', 1, 'run-start'),
    event('r-7', 'add-foo', 2, 'wave-action')
  ])
  const r = await follow(home, {
    onWait: (ms, i) => {
      if (i === 2) appendFileSync(path, event('r-7', 'add-foo', 3, 'run-halt', { reason: 'unit failures after 2 fix attempts' }) + '\n')
    }
  })
  assert.equal(r.code, 0)
  assert.equal(r.lines.length, 1, 'nothing else on standard output')
  for (const token of ['r-7', 'add-foo', 'halted', 'unit failures after 2 fix attempts']) {
    assert.ok(r.lines[0].includes(token), `the halt line names ${token}: ${r.lines[0]}`)
  }
  assert.deepEqual(r.waits, [LIMITS.meterTickMs, LIMITS.meterTickMs], 'it waited the published period between reads')
})

test('a named run that does not exist prints one line naming it and exits 1', async () => {
  const home = freshHome()
  trajectory(home, 'r-1', [event('r-1', 'a', 1, 'run-start')])
  const r = await follow(home, { run: 'r-404' })
  assert.equal(r.code, 1)
  assert.equal(r.lines.length, 1)
  assert.match(r.lines[0], /r-404/)
  assert.match(r.lines[0], /no trajectory is recorded/i)
  assert.deepEqual(r.waits, [])
})

test('a run already complete is printed at once with --run, among newer ones; no --run follows the newest and stays on it', async () => {
  const home = freshHome()
  const now = Date.now()
  trajectory(home, 'r-8', [event('r-8', 'fix-baz', 1, 'run-start'), event('r-8', 'fix-baz', 2, 'run-complete')], now - 3000)
  const newest = trajectory(home, 'r-9', [event('r-9', 'add-qux', 1, 'run-start')], now - 1000)

  const named = await follow(home, { run: 'r-8' })
  assert.equal(named.code, 0)
  assert.deepEqual(named.waits, [], 'it did not wait')
  for (const token of ['r-8', 'fix-baz', 'complete']) assert.ok(named.lines[0].includes(token), named.lines[0])

  const bare = await follow(home, {
    onWait: (ms, i) => {
      // A newer trajectory appears while it waits; the follower stays on r-9.
      if (i === 1) trajectory(home, 'r-10', [event('r-10', 'other', 1, 'run-start'), event('r-10', 'other', 2, 'run-complete')])
      if (i === 2) appendFileSync(newest, event('r-9', 'add-qux', 2, 'run-halt', { reason: 'baseline red' }) + '\n')
    }
  })
  assert.equal(bare.code, 0)
  assert.equal(bare.lines.length, 1)
  assert.ok(bare.lines[0].includes('r-9') && bare.lines[0].includes('halted'), bare.lines[0])
  assert.ok(!bare.lines[0].includes('r-10'))
})

test('a run at work prints nothing until it ends, whatever the polling periods', async () => {
  const home = freshHome()
  const path = trajectory(home, 'r-5', [
    event('r-5', 'work', 1, 'run-start'),
    event('r-5', 'work', 2, 'agent-spawn')
  ])
  const seen = []
  const r = await follow(home, {
    onWait: (ms, i) => {
      seen.push(i)
      if (i === 3) appendFileSync(path, event('r-5', 'work', 3, 'run-complete') + '\n')
    }
  })
  assert.deepEqual(seen, [1, 2, 3], 'three periods passed with nothing printed')
  assert.equal(r.lines.length, 1)
  assert.match(r.lines[0], /complete/)
  assert.equal(r.code, 0)
})

test('a run with no recorded end is given up on, aloud, once its trajectory is older than the launch-ledger age', async () => {
  const home = freshHome()
  const written = Date.parse('2026-11-05T09:00:00Z')
  trajectory(home, 'r-3', [event('r-3', 'old', 1, 'run-start'), event('r-3', 'old', 2, 'agent-spawn')], written)
  const r = await follow(home, { now: () => written + LIMITS.launchLedgerMaxAgeMs + 1 })
  assert.equal(r.code, 1)
  assert.equal(r.lines.length, 1)
  assert.ok(r.lines[0].includes('r-3'), r.lines[0])
  assert.match(r.lines[0], /2026-11-07T10:02:00\.000Z|2026-11-07T10:0\d/)
  assert.match(r.lines[0], /no recorded end|records no end/)
  assert.deepEqual(r.waits, [])

  // One period short of the bound it is still following.
  const young = await follow(home, {
    now: () => written + LIMITS.launchLedgerMaxAgeMs - 1,
    onWait: () => appendFileSync(runLogPath(home, 'r-3'), event('r-3', 'old', 3, 'run-complete') + '\n')
  })
  assert.equal(young.code, 0)
  assert.equal(young.waits.length, 1)
})

test('following leaves the trajectory as it was, creates nothing, and the halt line says it is a record', async () => {
  const home = freshHome()
  trajectory(home, 'r-2', [event('r-2', 'done', 1, 'run-start'), event('r-2', 'done', 2, 'run-halt', { reason: 'x' })])
  const before = snapshot(home)
  const r = await follow(home)
  assert.equal(r.code, 0)
  assert.deepEqual(snapshot(home), before, 'no file under the state home changed or appeared')
  assert.match(r.lines[0], /record of the halt; it asks for no relaunch\.$/)
})

test('nothing to follow: no runs directory, or an empty one, is one line naming the directory and exit 1', async () => {
  const absent = freshHome()
  const a = await follow(absent)
  assert.equal(a.code, 1)
  assert.equal(a.lines.length, 1)
  assert.match(a.lines[0], /no run is recorded/i)
  assert.ok(a.lines[0].includes(runLogDir(absent)), 'it names the directory it looked in')
  assert.deepEqual(readdirSync(absent), [], 'it created nothing')

  const empty = freshHome()
  mkdirSync(runLogDir(empty), { recursive: true })
  const e = await follow(empty)
  assert.equal(e.code, 1)
  assert.match(e.lines[0], /no run is recorded/i)
  assert.deepEqual(readdirSync(runLogDir(empty)), [])
})

test('unparseable lines are skipped and counted in the complete line', async () => {
  const home = freshHome()
  trajectory(home, 'r-6', [event('r-6', 'torn', 1, 'run-start'), '{not json', 'also not json', event('r-6', 'torn', 4, 'run-complete')])
  const r = await follow(home)
  assert.equal(r.code, 0)
  assert.match(r.lines[0], /complete/)
  assert.match(r.lines[0], /2 unparseable lines were skipped/)
})

test('foreign-schema lines are said to be set aside in the line the verb ends on', async () => {
  const home = freshHome()
  const foreign = JSON.stringify({ schema: 'interlock.ship-run/0', seq: 2, runId: 'r-5', change: 'mixed', type: 'run-complete' })
  trajectory(home, 'r-5', [event('r-5', 'mixed', 1, 'run-start'), foreign, '{torn', event('r-5', 'mixed', 4, 'run-halt', { reason: 'gate red' })])
  const r = await follow(home, { run: 'r-5' })
  assert.equal(r.code, 0)
  assert.equal(r.lines.length, 1)
  assert.match(r.lines[0], /halted: gate red\./)
  assert.match(r.lines[0], /1 unparseable line was skipped; 1 foreign-schema line, written by another release, was set aside\./)
})

test('a trajectory holding an old halt and a later run-start is followed to its new end, not the old halt', async () => {
  const home = freshHome()
  const path = trajectory(home, 'r-4', [
    event('r-4', 'again', 1, 'run-start'),
    event('r-4', 'again', 2, 'run-halt', { reason: 'the first halt' }),
    event('r-4', 'again', 3, 'run-start')
  ])
  const r = await follow(home, {
    run: 'r-4',
    onWait: (ms, i) => {
      if (i === 1) appendFileSync(path, event('r-4', 'again', 4, 'run-complete') + '\n')
    }
  })
  assert.equal(r.code, 0)
  assert.deepEqual(r.waits, [LIMITS.meterTickMs], 'it waited for the new end rather than printing the old halt')
  assert.match(r.lines[0], /r-4 \(again\) complete\./)
  assert.doesNotMatch(r.lines[0], /first halt/)
})

test('the bounds are the limits module\'s: neither file spells a number of milliseconds, and both name the limits', () => {
  for (const file of ['lib/run-follow-cli.mjs', 'lib/run-follow.mjs']) {
    const code = readFileSync(join(ROOT, file), 'utf8')
      .split('\n')
      .filter(line => !/^\s*\/\//.test(line))
      .join('\n')
    assert.doesNotMatch(code, /\b\d[\d_,]*\s*\*\s*\d/, `${file} spells a product of numbers`)
    assert.doesNotMatch(code, /\b\d{3,}\b/, `${file} spells a figure of three digits or more`)
    assert.doesNotMatch(code, /\b\d+\s*ms\b/i, `${file} spells milliseconds`)
  }
  const glue = readFileSync(join(ROOT, 'lib', 'run-follow-cli.mjs'), 'utf8')
  assert.ok(glue.includes('LIMITS.meterTickMs'), 'the period is read from the limits module')
  assert.ok(glue.includes('LIMITS.launchLedgerMaxAgeMs'), 'the age bound is read from the limits module')
  const printed = exec(['limits'], tmp).stdout
  assert.match(printed, /meter tick \(ms\)/)
  assert.match(printed, /launch ledger max age \(ms\)/)
})

// --- the real binary -----------------------------------------------------------

function exec(args, cwd) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', input: '' })
  assert.equal(r.error, undefined)
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

test('the binary: a finished run prints its line, exits 0, and writes nothing', () => {
  const root = mkdtempSync(join(tmp, 'root-'))
  const home = freshHome()
  trajectory(home, 'r-bin', [event('r-bin', 'add-foo', 1, 'run-start'), event('r-bin', 'add-foo', 2, 'run-halt', { reason: 'no luck' })])
  const before = { home: snapshot(home), root: snapshot(root) }
  const r = exec(['run-log', 'follow', '--run', 'r-bin', '--state-home', home], root)
  assert.equal(r.code, 0, r.stderr)
  assert.equal(r.stdout.trim().split('\n').length, 1)
  assert.match(r.stdout, /r-bin \(add-foo\) halted: no luck/)
  assert.deepEqual({ home: snapshot(home), root: snapshot(root) }, before)
})

test('the binary: no run is exit 1, an unknown --run is exit 1, --json is refused, a stray flag is exit 2', () => {
  const root = mkdtempSync(join(tmp, 'root-'))
  const home = freshHome()
  const none = exec(['run-log', 'follow', '--state-home', home], root)
  assert.equal(none.code, 1)
  assert.match(none.stdout, /no run is recorded/i)
  trajectory(home, 'r-x', [event('r-x', 'c', 1, 'run-complete')])
  const unknown = exec(['run-log', 'follow', '--run', 'r-404', '--state-home', home], root)
  assert.equal(unknown.code, 1)
  assert.match(unknown.stdout, /r-404/)
  const json = exec(['run-log', 'follow', '--run', 'r-x', '--json', '--state-home', home], root)
  assert.equal(json.code, 1)
  assert.match(json.stderr, /--json is not read/)
  const stray = exec(['run-log', 'follow', '--bogus'], root)
  assert.equal(stray.code, 2)
})

test('the help says there is no quiet line, why, and names the age bound by its limits label with no figure', () => {
  const help = exec(['run-log', '--help'], tmp)
  assert.equal(help.code, 0)
  const own = help.stdout.slice(help.stdout.indexOf('interlock run-log follow'))
  assert.match(own, /No\s+quiet line/)
  assert.match(own, /records\s+only the CLI's steps/)
  assert.match(own, /launch ledger max age \(ms\)/)
  assert.doesNotMatch(own.slice(0, own.indexOf('interlock tasks') > 0 ? own.indexOf('interlock tasks') : 800), /\b\d{5,}\b/)
  const full = exec(['--help'], tmp).stdout
  const section = full.slice(full.indexOf('  follow [--run <id>]'), full.indexOf('  Session-query'))
  assert.match(section, /launch ledger max age \(ms\)/)
  assert.doesNotMatch(section, /\b\d{3,}\b/)
})

test('the help names the start-time race: no --run resolves the newest trajectory once, the line names the run id', () => {
  const full = exec(['--help'], tmp).stdout
  const section = full.slice(full.indexOf('  follow [--run <id>]'), full.indexOf('  Session-query'))
  assert.match(section, /resolved once,\s+at start/)
  assert.match(section, /follows the previous run/)
  assert.match(section, /names the run id/)
  assert.match(section, /--run <id> to pin/)
  assert.match(section, /last run-halt\/run-complete\s+after the last run-start/)
  assert.match(section, /foreign-schema lines are set aside/)
})
