// The launch ledger's own tests: the rule `hooks/guard-relaunch.mjs` is plumbing
// over (spec: hooks/launch-guard).
//
// The two failure directions are asserted head-on, as the stage marker's are. A
// ledger read back as "launched, no prompt since" when it should be absent is a
// false deny that costs a typed message; a relaunch read as allowed is the
// twenty-agent run the guard exists to stop. Every unknown — a missing file,
// malformed JSON, a wrong schema, an unsafe session id, a stale ledger — must
// read as no ledger, because no ledger allows.
//
// `isShipLaunch` is pinned against the payloads captured from the host
// (test/fixtures/hooks/), not only against shapes invented here: a field the
// host renames fails these cases rather than silently stopping the guard.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIMITS } from '../../lib/limits.mjs'
import {
  LEDGER_DIR,
  LEDGER_SCHEMA,
  SKILL_QUOTE,
  decideLaunch,
  isAcceptedLaunch,
  isHumanPrompt,
  isShipLaunch,
  ledgerPath,
  readLedger,
  recordLaunch,
  recordPrompt,
  sweepStale
} from '../../lib/launch-ledger.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixture = name => JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'hooks', name), 'utf8'))
const PRE = fixture('workflow-pretooluse.json')
const POST = fixture('workflow-posttooluse.json')
const WAKE = fixture('completion-wake.json')
const TYPED = fixture('userpromptsubmit.json')

const MAX = LIMITS.launchLedgerMaxAgeMs
const T0 = Date.parse('2026-10-05T06:35:01.000Z')
const iso = ms => new Date(ms).toISOString()

function tmpRoot() {
  return mkdtempSync(join(tmpdir(), 'interlock-ledger-'))
}

/** A ledger on disk, written by hand so a test controls every field. */
function plant(root, sessionId, ledger) {
  mkdirSync(join(root, LEDGER_DIR), { recursive: true })
  const path = join(root, LEDGER_DIR, `${sessionId}.json`)
  writeFileSync(path, typeof ledger === 'string' ? ledger : JSON.stringify(ledger))
  return path
}

const ledgerOf = (launches, lastHumanPromptAt = null, sessionId = 's-1') => ({
  schema: LEDGER_SCHEMA,
  sessionId,
  launches: launches.map(at => ({ at: iso(at), taskId: 't', runId: 'wf_1', workflowName: 'ship', scriptPath: '/x/ship-wf_1.js' })),
  lastHumanPromptAt: lastHumanPromptAt === null ? null : iso(lastHumanPromptAt)
})

// ---------------------------------------------------------------------------
// isShipLaunch — what counts as a ship launch (design D1)
// ---------------------------------------------------------------------------

test('isShipLaunch accepts the captured tool_input, before and after the engine adds the script', () => {
  assert.equal(isShipLaunch(PRE.tool_input), true, 'the PreToolUse shape: { name, args }')
  assert.equal(isShipLaunch(POST.tool_input), true, 'the PostToolUse shape carries the resolved script too')
})

test('isShipLaunch accepts a scriptPath ending in workflows/ship.js under either separator', () => {
  assert.equal(isShipLaunch({ scriptPath: '/home/user/.claude/plugins/interlock/workflows/ship.js', args: 'add-foo' }), true)
  assert.equal(isShipLaunch({ scriptPath: 'C:\\Users\\u\\plugins\\interlock\\workflows\\ship.js' }), true)
})

test('isShipLaunch accepts the plugin command name, bare and marketplace-prefixed', () => {
  assert.equal(isShipLaunch({ name: 'interlock:ship' }), true)
  assert.equal(isShipLaunch({ name: 'acme-interlock:ship' }), true)
})

test('isShipLaunch counts a call carrying resumeFromRunId as a launch', () => {
  assert.equal(isShipLaunch({ name: 'interlock:ship', resumeFromRunId: 'wf_1' }), true)
  assert.equal(isShipLaunch({ scriptPath: '/p/workflows/ship.js', resumeFromRunId: 'wf_1' }), true)
})

test('isShipLaunch accepts the resume the completion wake suggests, by the ledger it recorded', () => {
  // The wake's diagnostics name a persisted script, not workflows/ship.js, and
  // no `name` — recognisable only against the run this session recorded.
  const ledger = {
    ...ledgerOf([T0]),
    launches: [{ at: iso(T0), taskId: POST.tool_response.taskId, runId: POST.tool_response.runId, workflowName: 'ship', scriptPath: POST.tool_response.scriptPath }]
  }
  const resume = { scriptPath: POST.tool_response.scriptPath, resumeFromRunId: POST.tool_response.runId, args: 'no-such-change' }
  assert.equal(isShipLaunch(resume), false, 'without the ledger the persisted path is not recognisable')
  assert.equal(isShipLaunch(resume, ledger), true)
  assert.equal(isShipLaunch({ resumeFromRunId: POST.tool_response.runId }, ledger), true, 'the run id alone matches')
  assert.equal(isShipLaunch({ scriptPath: POST.tool_response.scriptPath }, ledger), true, 'the persisted path alone matches')
  assert.equal(isShipLaunch({ scriptPath: '/elsewhere/ship-wf_9.js', resumeFromRunId: 'wf_9' }, ledger), false, 'another run is not this ship run')
})

test('isShipLaunch refuses another plugin\'s :ship, a different script and a non-object input', () => {
  assert.equal(isShipLaunch({ name: 'other:ship' }), false)
  assert.equal(isShipLaunch({ name: 'ship' }), false)
  assert.equal(isShipLaunch({ name: 'interlock:ship-report' }), false)
  assert.equal(isShipLaunch({ name: 'deep-research' }), false)
  assert.equal(isShipLaunch({ scriptPath: '/p/workflows/review.js' }), false)
  assert.equal(isShipLaunch({ scriptPath: '/p/workflows/not-ship.js' }), false)
  assert.equal(isShipLaunch({ script: "export const meta = { name: 'ship' }" }), false, 'an inline script is not the plugin\'s')
  for (const junk of [null, undefined, 'interlock:ship', 42, []]) assert.equal(isShipLaunch(junk), false, String(junk))
})

// ---------------------------------------------------------------------------
// isAcceptedLaunch and isHumanPrompt — what the recorder branches may count
// ---------------------------------------------------------------------------

test('isAcceptedLaunch accepts the captured response and refuses an error or a non-launch', () => {
  assert.equal(isAcceptedLaunch(POST.tool_response), true)
  assert.equal(isAcceptedLaunch({ ...POST.tool_response, status: 'remote_launched' }), true)
  assert.equal(isAcceptedLaunch({ ...POST.tool_response, is_error: true }), false)
  assert.equal(isAcceptedLaunch({ ...POST.tool_response, isError: true }), false)
  assert.equal(isAcceptedLaunch({ ...POST.tool_response, error: 'boom' }), false)
  assert.equal(isAcceptedLaunch({ status: 'failed' }), false)
  assert.equal(isAcceptedLaunch('Error: Workflow "interlock:x" not found.'), false, 'the engine\'s refusal is a string')
  for (const junk of [null, undefined, 42, []]) assert.equal(isAcceptedLaunch(junk), false, String(junk))
})

test('isHumanPrompt refuses the captured completion wake and accepts a typed prompt', () => {
  assert.equal(isHumanPrompt(TYPED.prompt), true)
  assert.equal(isHumanPrompt('ship the leftovers'), true)
  assert.equal(isHumanPrompt(WAKE.prompt), false)
  assert.equal(isHumanPrompt(`\n  ${WAKE.prompt}`), false, 'leading whitespace does not hide the marker')
  // A prompt event with no prompt text is still a prompt the host sent: allow-direction.
  assert.equal(isHumanPrompt(undefined), true)
})

// ---------------------------------------------------------------------------
// decideLaunch — the rule (design D3)
// ---------------------------------------------------------------------------

test('decideLaunch allows with no ledger', () => {
  assert.equal(decideLaunch(null, T0, MAX).decision, 'allow')
})

test('decideLaunch allows when the last human prompt is later than every launch', () => {
  const d = decideLaunch(ledgerOf([T0, T0 + 1000], T0 + 2000), T0 + 3000, MAX)
  assert.equal(d.decision, 'allow')
})

test('decideLaunch denies when a launch is later than the last prompt, and quotes the skill', () => {
  const d = decideLaunch(ledgerOf([T0, T0 + 2000], T0 + 1000), T0 + 3000, MAX)
  assert.equal(d.decision, 'deny')
  assert.equal(d.lastLaunchAt, iso(T0 + 2000))
  assert.equal(d.lastHumanPromptAt, iso(T0 + 1000))
  assert.match(d.reason, /^guard-relaunch: /)
  assert.ok(d.reason.includes(iso(T0 + 2000)), 'the reason names when the last launch was')
  assert.ok(d.reason.includes(SKILL_QUOTE), 'the reason quotes the skill sentence verbatim')
  for (const token of ['Leftover', 'not authorization', 'new message', '/interlock:ship']) {
    assert.ok(d.reason.includes(token), `reason lacks ${token}`)
  }
})

test('decideLaunch denies when launches exist and no prompt was ever recorded', () => {
  const d = decideLaunch(ledgerOf([T0]), T0 + 1000, MAX)
  assert.equal(d.decision, 'deny')
  assert.equal(d.lastHumanPromptAt, null)
})

test('decideLaunch allows when the newest launch is older than the published age', () => {
  assert.equal(decideLaunch(ledgerOf([T0]), T0 + MAX + 1, MAX).decision, 'allow')
  assert.equal(decideLaunch(ledgerOf([T0]), T0 + MAX - 1, MAX).decision, 'deny', 'inside the bound it still denies')
})

test('decideLaunch reads the published cap when none is passed', () => {
  assert.equal(decideLaunch(ledgerOf([T0]), T0 + MAX + 1).decision, 'allow')
})

test('decideLaunch allows a ledger it cannot read a launch time from', () => {
  for (const bad of [{ ...ledgerOf([]) }, { ...ledgerOf([T0]), launches: [{ at: 'yesterday' }] }, { launches: 'x' }]) {
    assert.equal(decideLaunch(bad, T0, MAX).decision, 'allow', JSON.stringify(bad))
  }
})

// ---------------------------------------------------------------------------
// ledgerPath and readLedger — every failure reads as no ledger (design D2, D6)
// ---------------------------------------------------------------------------

test('ledgerPath names the session under .claude/ship/launch-ledger, and refuses an unsafe id', () => {
  const root = '/r'
  assert.equal(ledgerPath(root, 's-1'), join(root, '.claude', 'ship', 'launch-ledger', 's-1.json'))
  assert.equal(ledgerPath(root, PRE.session_id), join(root, LEDGER_DIR, `${PRE.session_id}.json`), 'the host\'s UUID is safe')
  for (const bad of ['../x', '', 'a/b', 'a\\b', '..', 'x'.repeat(129), null, undefined, 42]) {
    assert.equal(ledgerPath(root, bad), null, String(bad))
  }
})

test('readLedger returns null for a missing file, malformed JSON, a wrong schema and an unsafe id', () => {
  const root = tmpRoot()
  try {
    assert.equal(readLedger(root, 's-1', { now: T0 }), null, 'missing')
    plant(root, 's-2', '{not json')
    assert.equal(readLedger(root, 's-2', { now: T0 }), null, 'malformed')
    plant(root, 's-3', { ...ledgerOf([T0]), schema: 'interlock.other/1' })
    assert.equal(readLedger(root, 's-3', { now: T0 }), null, 'wrong schema')
    plant(root, 's-4', { ...ledgerOf([T0]), launches: 'nope' })
    assert.equal(readLedger(root, 's-4', { now: T0 }), null, 'launches not a list')
    assert.equal(readLedger(root, '../x', { now: T0 }), null, 'unsafe id')
    assert.equal(readLedger(root, '', { now: T0 }), null, 'empty id')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('readLedger names an unreadable ledger to onProblem, and stays silent for an absent one', () => {
  const root = tmpRoot()
  try {
    const problems = []
    const onProblem = message => problems.push(message)
    readLedger(root, 's-1', { now: T0, onProblem })
    assert.deepEqual(problems, [], 'an absent ledger is not a problem')
    plant(root, 's-2', '{not json')
    readLedger(root, 's-2', { now: T0, onProblem })
    plant(root, 's-3', { ...ledgerOf([T0]), schema: 'interlock.other/1' })
    readLedger(root, 's-3', { now: T0, onProblem })
    assert.equal(problems.length, 2)
    assert.match(problems[0], /s-2\.json/)
    assert.match(problems[1], /s-3\.json/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('readLedger round-trips a valid ledger and reads a stale one as absent', () => {
  const root = tmpRoot()
  try {
    plant(root, 's-1', ledgerOf([T0], T0 - 1000))
    const ledger = readLedger(root, 's-1', { now: T0 + 1000, maxAgeMs: MAX })
    assert.equal(ledger.schema, LEDGER_SCHEMA)
    assert.equal(ledger.launches.length, 1)
    assert.equal(readLedger(root, 's-1', { now: T0 + MAX + 1, maxAgeMs: MAX }), null, 'stale under the cap')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// recordLaunch, recordPrompt, sweepStale — the writers
// ---------------------------------------------------------------------------

test('recordLaunch creates the directory and file, and appends on a second call', () => {
  const root = tmpRoot()
  try {
    assert.ok(!existsSync(join(root, '.claude')))
    const first = recordLaunch(root, 's-1', POST.tool_response, { now: T0 })
    assert.equal(first.written, true)
    const ledger = JSON.parse(readFileSync(join(root, LEDGER_DIR, 's-1.json'), 'utf8'))
    assert.equal(ledger.schema, LEDGER_SCHEMA)
    assert.equal(ledger.sessionId, 's-1')
    assert.equal(ledger.lastHumanPromptAt, null)
    assert.deepEqual(ledger.launches, [
      {
        at: iso(T0),
        taskId: POST.tool_response.taskId,
        runId: POST.tool_response.runId,
        workflowName: POST.tool_response.workflowName,
        scriptPath: POST.tool_response.scriptPath
      }
    ])
    recordLaunch(root, 's-1', { status: 'async_launched', taskId: 't2' }, { now: T0 + 1000 })
    const again = JSON.parse(readFileSync(join(root, LEDGER_DIR, 's-1.json'), 'utf8'))
    assert.equal(again.launches.length, 2)
    assert.equal(again.launches[1].taskId, 't2')
    assert.equal(again.launches[1].runId, null, 'an identity the response lacks is null, not invented')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('recordLaunch keeps the recorded prompt, starts fresh over a stale or malformed ledger, and refuses an unsafe id', () => {
  const root = tmpRoot()
  try {
    plant(root, 's-1', ledgerOf([T0], T0 + 500))
    recordLaunch(root, 's-1', POST.tool_response, { now: T0 + 1000 })
    const kept = JSON.parse(readFileSync(join(root, LEDGER_DIR, 's-1.json'), 'utf8'))
    assert.equal(kept.launches.length, 2)
    assert.equal(kept.lastHumanPromptAt, iso(T0 + 500))

    plant(root, 's-2', ledgerOf([T0], T0 + 500, 's-2'))
    recordLaunch(root, 's-2', POST.tool_response, { now: T0 + MAX + 10 })
    const fresh = JSON.parse(readFileSync(join(root, LEDGER_DIR, 's-2.json'), 'utf8'))
    assert.equal(fresh.launches.length, 1, 'a stale ledger is not appended to')
    assert.equal(fresh.lastHumanPromptAt, null)

    plant(root, 's-3', '{torn')
    assert.equal(recordLaunch(root, 's-3', POST.tool_response, { now: T0 }).written, true)
    assert.equal(JSON.parse(readFileSync(join(root, LEDGER_DIR, 's-3.json'), 'utf8')).launches.length, 1)

    const unsafe = recordLaunch(root, '../x', POST.tool_response, { now: T0 })
    assert.equal(unsafe.written, false)
    assert.ok(!existsSync(join(root, '.claude', 'ship', 'x.json')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('recordLaunch reports a failed write as a value, never a throw', () => {
  const root = tmpRoot()
  try {
    mkdirSync(join(root, '.claude', 'ship'), { recursive: true })
    writeFileSync(join(root, LEDGER_DIR), 'a file where the directory should be')
    const r = recordLaunch(root, 's-1', POST.tool_response, { now: T0 })
    assert.equal(r.written, false)
    assert.equal(typeof r.reason, 'string')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('recordPrompt writes only when the ledger exists, and creates no directory otherwise', () => {
  const root = tmpRoot()
  try {
    const r = recordPrompt(root, 's-1', { now: T0 })
    assert.equal(r.written, false)
    assert.ok(!existsSync(join(root, '.claude')), 'a prompt with no ledger creates nothing')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('recordPrompt keeps the later of two timestamps', () => {
  const root = tmpRoot()
  try {
    plant(root, 's-1', ledgerOf([T0]))
    assert.equal(recordPrompt(root, 's-1', { now: T0 + 2000 }).written, true)
    assert.equal(JSON.parse(readFileSync(join(root, LEDGER_DIR, 's-1.json'), 'utf8')).lastHumanPromptAt, iso(T0 + 2000))
    recordPrompt(root, 's-1', { now: T0 + 1000 })
    assert.equal(
      JSON.parse(readFileSync(join(root, LEDGER_DIR, 's-1.json'), 'utf8')).lastHumanPromptAt,
      iso(T0 + 2000),
      'an earlier clock never moves the prompt back'
    )
    recordPrompt(root, 's-1', { now: T0 + 3000 })
    assert.equal(JSON.parse(readFileSync(join(root, LEDGER_DIR, 's-1.json'), 'utf8')).lastHumanPromptAt, iso(T0 + 3000))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('recordPrompt leaves a malformed or stale ledger alone', () => {
  const root = tmpRoot()
  try {
    plant(root, 's-1', '{torn')
    assert.equal(recordPrompt(root, 's-1', { now: T0 }).written, false)
    assert.equal(readFileSync(join(root, LEDGER_DIR, 's-1.json'), 'utf8'), '{torn')
    plant(root, 's-2', ledgerOf([T0], null, 's-2'))
    assert.equal(recordPrompt(root, 's-2', { now: T0 + MAX + 1 }).written, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('sweepStale removes sibling ledgers older than the cap and leaves younger ones', () => {
  const root = tmpRoot()
  try {
    const now = Date.now()
    const old = plant(root, 's-old', ledgerOf([now - MAX - 60_000], null, 's-old'))
    const young = plant(root, 's-young', ledgerOf([now], null, 's-young'))
    const kept = plant(root, 's-self', ledgerOf([now - MAX - 60_000], null, 's-self'))
    const notALedger = join(root, LEDGER_DIR, 'README')
    writeFileSync(notALedger, 'not a ledger')
    const past = (now - MAX - 60_000) / 1000
    for (const path of [old, kept, notALedger]) utimesSync(path, past, past)

    const r = sweepStale(root, { now, maxAgeMs: MAX, keep: 's-self' })
    assert.deepEqual(r.removed, ['s-old.json'])
    assert.ok(!existsSync(old))
    assert.ok(existsSync(young))
    assert.ok(existsSync(kept), 'the ledger just written is never swept')
    assert.ok(existsSync(notALedger), 'only ledger files are swept')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('sweepStale is a no-op, not a throw, when the directory is absent', () => {
  const root = tmpRoot()
  try {
    assert.deepEqual(sweepStale(root, { now: T0, maxAgeMs: MAX }).removed, [])
    assert.deepEqual(readdirSync(root), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
