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
//
// The rule itself lives in `lib/launch-rule.mjs`, which the hooks module
// imports too (guard-ship-relaunch-in-process design D1). The first block below
// pins that there is one rule: the ledger module's rule names are the rule
// module's own objects, and the rule module stays importable where there is
// no Node.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIMITS } from '../../lib/limits.mjs'
import * as rule from '../../lib/launch-rule.mjs'
import * as ledgerModule from '../../lib/launch-ledger.mjs'
import {
  LEDGER_DIR,
  LEDGER_SCHEMA,
  SKILL_QUOTE,
  decideLaunch,
  emptyRecord,
  isAcceptedLaunch,
  isHumanPrompt,
  isShipLaunch,
  ledgerPath,
  readLedger,
  recordLaunch,
  recordPrompt,
  sweepStale,
  withLaunch,
  withPrompt
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
// One rule, two transports (guard-ship-relaunch-in-process design D1)
// ---------------------------------------------------------------------------

const RULE_SOURCE = readFileSync(join(ROOT, 'lib', 'launch-rule.mjs'), 'utf8')

/** Every module specifier a source names: static imports, re-exports, side-effect and dynamic imports. */
const specifiersOf = source => [
  ...new Set(
    [/\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g].flatMap(re =>
      [...source.matchAll(re)].map(m => m[1])
    )
  )
]

test('the rule module names no node: import and imports only ./limits.mjs', () => {
  const specs = specifiersOf(RULE_SOURCE)
  const nodeImports = specs.filter(s => s.startsWith('node:'))
  assert.deepEqual(nodeImports, [], `lib/launch-rule.mjs imports ${nodeImports.join(', ')}; the hooks module cannot load it`)
  assert.deepEqual(specs, ['./limits.mjs'], `lib/launch-rule.mjs imports: ${specs.join(', ')}`)
})

test('every rule name the ledger module exports is the rule module\'s own object', () => {
  const names = Object.keys(rule)
  for (const name of ['decideLaunch', 'denyReason', 'isShipLaunch', 'isAcceptedLaunch', 'isHumanPrompt', 'emptyRecord', 'withLaunch', 'withPrompt', 'SKILL_QUOTE', 'WAKE_MARKER', 'LEDGER_SCHEMA']) {
    assert.ok(names.includes(name), `lib/launch-rule.mjs does not export ${name}`)
  }
  for (const name of names) {
    assert.ok(name in ledgerModule, `lib/launch-ledger.mjs does not re-export ${name}`)
    assert.equal(ledgerModule[name], rule[name], `lib/launch-ledger.mjs's ${name} is not lib/launch-rule.mjs's`)
  }
})

test('emptyRecord is the ledger schema with no launch and no prompt, fresh on every call', () => {
  const record = emptyRecord()
  assert.deepEqual(record, { schema: LEDGER_SCHEMA, launches: [], lastHumanPromptAt: null })
  record.launches.push({ at: iso(T0) })
  assert.deepEqual(emptyRecord().launches, [], 'a caller that mutates one record leaves the next untouched')
})

test('withLaunch appends a launch without touching its input, and drops launches past the published age', () => {
  const launch = at => ({ at: iso(at), runId: `wf_${at}`, workflowName: 'interlock:ship', scriptPath: `/p/${at}.js` })
  const before = { ...emptyRecord(), launches: [launch(T0)], lastHumanPromptAt: iso(T0 + 10) }
  const after = withLaunch(before, launch(T0 + 1000))
  assert.deepEqual(after.launches, [launch(T0), launch(T0 + 1000)])
  assert.equal(after.lastHumanPromptAt, iso(T0 + 10), 'the recorded prompt is kept')
  assert.equal(before.launches.length, 1, 'the record it was given is not mutated')

  const aged = withLaunch({ ...emptyRecord(), launches: [launch(T0), launch(T0 + 5000), { at: 'yesterday' }] }, launch(T0 + MAX + 1000))
  assert.deepEqual(
    aged.launches.map(l => l.at),
    [iso(T0 + 5000), iso(T0 + MAX + 1000)],
    `launches older than LIMITS.launchLedgerMaxAgeMs, and an unreadable time, are dropped`
  )
  assert.equal(withLaunch(emptyRecord(), launch(T0 + MAX), MAX).launches.length, 1)
})

test('withLaunch over anything that is not a record starts from emptyRecord', () => {
  for (const junk of [null, undefined, 'x', [], { launches: 'nope' }]) {
    const record = withLaunch(junk, { at: iso(T0), runId: 'wf_1', workflowName: null, scriptPath: null })
    assert.equal(record.schema, LEDGER_SCHEMA, String(junk))
    assert.equal(record.launches.length, 1, String(junk))
    assert.equal(record.lastHumanPromptAt, null, String(junk))
  }
})

test('withPrompt sets the ISO prompt time and never moves it back', () => {
  const base = withLaunch(emptyRecord(), { at: iso(T0), runId: 'wf_1', workflowName: 'ship', scriptPath: null })
  const prompted = withPrompt(base, iso(T0 + 2000))
  assert.equal(prompted.lastHumanPromptAt, iso(T0 + 2000))
  assert.equal(base.lastHumanPromptAt, null, 'the record it was given is not mutated')
  assert.equal(withPrompt(prompted, iso(T0 + 1000)).lastHumanPromptAt, iso(T0 + 2000), 'an earlier time is not recorded')
  assert.equal(withPrompt(prompted, iso(T0 + 3000)).lastHumanPromptAt, iso(T0 + 3000))
  assert.equal(withPrompt(null, iso(T0)).lastHumanPromptAt, iso(T0), 'over no record it starts from emptyRecord')
})

test('recordLaunch writes the record withLaunch makes of the read file, and recordPrompt the one withPrompt makes', () => {
  const root = tmpRoot()
  try {
    plant(root, 's-1', ledgerOf([T0], T0 + 500))
    const read = readLedger(root, 's-1', { now: T0 + 1000 })
    const entry = {
      at: iso(T0 + 1000),
      taskId: POST.tool_response.taskId,
      runId: POST.tool_response.runId,
      workflowName: POST.tool_response.workflowName,
      scriptPath: POST.tool_response.scriptPath
    }
    recordLaunch(root, 's-1', POST.tool_response, { now: T0 + 1000 })
    const afterLaunch = JSON.parse(readFileSync(join(root, LEDGER_DIR, 's-1.json'), 'utf8'))
    assert.deepEqual(afterLaunch, withLaunch(read, entry))

    recordPrompt(root, 's-1', { now: T0 + 2000 })
    const afterPrompt = JSON.parse(readFileSync(join(root, LEDGER_DIR, 's-1.json'), 'utf8'))
    assert.deepEqual(afterPrompt, withPrompt(afterLaunch, iso(T0 + 2000)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('decideLaunch over a plain record and over the same facts read from a file returns the same verdict', () => {
  const root = tmpRoot()
  try {
    const plain = { launches: [{ at: iso(T0), runId: 'wf_1', workflowName: 'ship', scriptPath: '/x/ship-wf_1.js' }], lastHumanPromptAt: null }
    plant(root, 's-1', { schema: LEDGER_SCHEMA, sessionId: 's-1', ...plain })
    for (const now of [T0 + 1000, T0 + MAX - 1, T0 + MAX + 1]) {
      const fromFile = decideLaunch(readLedger(root, 's-1', { now, maxAgeMs: MAX }), now, MAX)
      const fromMemory = decideLaunch(plain, now, MAX)
      assert.equal(fromMemory.decision, fromFile.decision, `at +${now - T0} ms`)
      assert.equal(fromMemory.reason, fromFile.reason, `at +${now - T0} ms`)
    }
    assert.equal(decideLaunch(plain, T0 + 1000, MAX).decision, 'deny', 'inside the age both deny')
    assert.equal(decideLaunch(plain, T0 + MAX + 1, MAX).decision, 'allow', 'past the age both allow')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
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

test('the wake the hooks module sees carries the marker the settings form reads, and the typed prompt does not', () => {
  // Two captures of one fact (guard-ship-relaunch-in-process task 1.1): the
  // engine stamps `origin.kind`, and the same wake's text is what
  // UserPromptSubmit hands the settings hook. The two forms classify alike.
  const mod = name => JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'mod', name), 'utf8'))
  const wake = mod('prompt-submit-task-notification.json')
  const typed = mod('prompt-submit-composer.json')
  assert.equal(wake.origin.kind, 'task-notification')
  assert.equal(isHumanPrompt(wake.text), false)
  assert.equal(typed.origin.kind, 'composer')
  assert.equal(isHumanPrompt(typed.text), true)
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
