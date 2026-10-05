// The agent-usage sidecar (design D2, D3): what the recorder's subagent and
// permission branches write, and the one reader of the host's transcript format.
//
// The transcript cases are pinned against the REAL scrubbed capture of task 1.1
// (test/fixtures/transcripts/worker-agent.jsonl), not only against shapes
// invented here. That capture is where the one-message-many-lines shape was
// found: a reader that summed per line instead of per message would double
// every input figure and still look plausible, so the fixture case asserts the
// naive sum differs.
//
// Every figure a turn omits must read back as `null`, never `0`. A zero is a
// measured cache miss; an absent figure is an unmeasured one, and the close
// reports the two in opposite directions.
//
// The briefing key is the join from an agent to the spawn that briefed it. The
// pattern is pinned against the bootstrap fixture, so a reword of the bootstrap
// sentence fails here instead of silently unjoining every agent of every run.

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_TEXT } from '../../lib/run-log.mjs'
import {
  AGENT_USAGE_DIR,
  AGENT_USAGE_SCHEMA,
  BRIEFING_SHA_PATTERN,
  MODELS_MAX,
  TEXT_MAX,
  WORKFLOW_AGENT_TYPE,
  agentFilePath,
  agentUsageDir,
  isSafeSegment,
  permissionFilePath,
  readAgentUsage,
  summarizeTranscript,
  summarizeTranscriptFile,
  writeAgentStart,
  writeAgentStop,
  writePermissionEvent
} from '../../lib/agent-usage.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TRANSCRIPT = join(ROOT, 'test', 'fixtures', 'transcripts', 'worker-agent.jsonl')
const BOOTSTRAP = readFileSync(join(ROOT, 'test', 'fixtures', 'prompts', 'bootstrap.txt'), 'utf8')
const BOOTSTRAP_SHA = /([0-9a-f]{64})\s*$/.exec(BOOTSTRAP)[1]
const OTHER_SHA = 'f'.repeat(64)
const THIRD_SHA = 'a'.repeat(64)

let tmp

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'interlock-agent-usage-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

// ---------------------------------------------------------------- builders

/** One JSON Lines transcript from objects (and raw strings, for torn lines). */
const jsonl = (...rows) => rows.map(r => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n'

const user = content => ({ type: 'user', message: { role: 'user', content } })

const assistant = ({ id, requestId, model = 'claude-sonnet-5', usage, content = [{ type: 'text', text: 'ok' }] } = {}) => ({
  type: 'assistant',
  ...(requestId ? { requestId } : {}),
  message: { ...(id ? { id } : {}), type: 'message', role: 'assistant', model, content, ...(usage ? { usage } : {}) }
})

/** A usage block carrying the tier split beside the total, as task 1.1 captured it. */
const tiered = (input, output, read, m5, h1) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: m5 + h1,
  cache_creation: { ephemeral_5m_input_tokens: m5, ephemeral_1h_input_tokens: h1 }
})

/** A usage block carrying only the cache-creation total. */
const totalOnly = (input, output, read, total) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: total
})

// ---------------------------------------------------------------- constants

test('the constants: schema, directory, the workflow agent type and the bounds', () => {
  assert.equal(AGENT_USAGE_SCHEMA, 'interlock.agent-usage/1')
  assert.equal(AGENT_USAGE_DIR, join('.claude', 'ship', 'agent-usage'))
  assert.equal(WORKFLOW_AGENT_TYPE, 'workflow-subagent')
  assert.equal(MODELS_MAX, 8)
})

test('TEXT_MAX restates the trajectory text bound and must not drift from it', () => {
  assert.equal(TEXT_MAX, MAX_TEXT, 'lib/agent-usage.mjs restates MAX_TEXT from lib/run-log.mjs; the two must not drift')
})

test('the module loads only stdlib and the stage module: a hook must not load the trajectory writer', () => {
  const src = readFileSync(join(ROOT, 'lib', 'agent-usage.mjs'), 'utf8')
  const specifiers = [...src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1])
  assert.ok(specifiers.length > 0)
  for (const s of specifiers) {
    assert.ok(['node:fs', 'node:path', './ship-stage.mjs'].includes(s), `unexpected import ${s}`)
  }
  assert.doesNotMatch(src, /child_process|spawnSync|execFileSync|execSync/)
})

// ---------------------------------------------------------------- the join key

test('BRIEFING_SHA_PATTERN matches the sha the bootstrap fixture writes', () => {
  const m = BRIEFING_SHA_PATTERN.exec(BOOTSTRAP)
  assert.ok(m, 'the bootstrap text no longer carries the sentence the join key is read from')
  assert.equal(m[1], BOOTSTRAP_SHA)
  assert.equal(BRIEFING_SHA_PATTERN.global, false, 'a shared global pattern would carry lastIndex between callers')
})

test('BRIEFING_SHA_PATTERN fails on the bootstrap text with its sentence reworded', () => {
  const reworded = BOOTSTRAP.replace('Expected sha256:', 'Expected hash:')
  assert.notEqual(reworded, BOOTSTRAP)
  assert.equal(BRIEFING_SHA_PATTERN.exec(reworded), null)
  const summary = summarizeTranscript(jsonl(user(reworded), assistant({ id: 'm1', usage: tiered(1, 1, 1, 1, 0) })))
  assert.equal(summary.briefingSha, null)
})

// ---------------------------------------------------------------- the real capture

test('summarizeTranscript over the captured worker transcript sums once per message, not per line', () => {
  const text = readFileSync(TRANSCRIPT, 'utf8')
  const s = summarizeTranscript(text)
  assert.equal(s.turns, 3)
  assert.equal(s.skipped, 0)
  assert.equal(s.reason, null)
  assert.deepEqual(s.usage, {
    inputTokens: 22,
    outputTokens: 490,
    cacheReadInputTokens: 41895,
    cacheCreationInputTokens: { ephemeral_5m: 21404, ephemeral_1h: 0 }
  })
  assert.deepEqual(s.models, ['bedrock.claude-haiku-4-5'])
  assert.equal(s.briefingSha, BOOTSTRAP_SHA)

  // Why the grouping exists: the host repeats a message's usage on every line
  // it writes for that message, so a per-line sum double-counts every input.
  const lines = text.split('\n').filter(Boolean).map(l => JSON.parse(l))
  const naive = lines
    .filter(l => l.type === 'assistant' && l.message && l.message.usage)
    .reduce((sum, l) => sum + l.message.usage.input_tokens, 0)
  assert.equal(lines.filter(l => l.type === 'assistant').length, 6, 'the capture writes each of 3 messages as 2 lines')
  assert.notEqual(naive, s.usage.inputTokens)
})

test('summarizeTranscriptFile reads the capture and records where it came from', () => {
  const s = summarizeTranscriptFile(TRANSCRIPT)
  assert.equal(s.turns, 3)
  assert.equal(s.usage.inputTokens, 22)
  assert.deepEqual(s.transcript, { path: TRANSCRIPT, parsed: true, reason: null })
})

test('summarizeTranscriptFile on a missing file is unknown, never zero or empty', () => {
  const path = join(tmp, 'nope.jsonl')
  const s = summarizeTranscriptFile(path)
  assert.equal(s.usage, null)
  assert.equal(s.models, null)
  assert.equal(s.turns, null)
  assert.equal(s.briefingSha, null)
  assert.equal(s.transcript.path, path)
  assert.equal(s.transcript.parsed, false)
  assert.equal(typeof s.transcript.reason, 'string')
  assert.ok(s.transcript.reason.length > 0)
  assert.equal(typeof s.reason, 'string')
})

// ---------------------------------------------------------------- hand-built variants

test('a complete tier-split transcript sums all four figures and both tiers', () => {
  const s = summarizeTranscript(
    jsonl(
      user(`${BOOTSTRAP}`),
      assistant({ id: 'm1', usage: tiered(10, 5, 0, 100, 7) }),
      user([{ type: 'tool_result', tool_use_id: 't', content: 'r' }]),
      assistant({ id: 'm2', usage: tiered(3, 9, 100, 4, 1) })
    )
  )
  assert.deepEqual(s.usage, {
    inputTokens: 13,
    outputTokens: 14,
    cacheReadInputTokens: 100,
    cacheCreationInputTokens: { ephemeral_5m: 104, ephemeral_1h: 8 }
  })
  assert.equal(s.turns, 2)
  assert.deepEqual(s.models, ['claude-sonnet-5'])
})

test('a total-only transcript records cache creation as { total } with the tiers unknown', () => {
  const s = summarizeTranscript(
    jsonl(user('go'), assistant({ id: 'm1', usage: totalOnly(1, 2, 3, 40) }), assistant({ id: 'm2', usage: totalOnly(1, 2, 3, 2) }))
  )
  assert.deepEqual(s.usage.cacheCreationInputTokens, { total: 42 })
  assert.equal(s.usage.inputTokens, 2)
})

test('turns mixing the split and a total-only figure record the summed { total }', () => {
  const s = summarizeTranscript(
    jsonl(user('go'), assistant({ id: 'm1', usage: tiered(1, 1, 1, 10, 5) }), assistant({ id: 'm2', usage: totalOnly(1, 1, 1, 3) }))
  )
  assert.deepEqual(s.usage.cacheCreationInputTokens, { total: 18 })
})

test('a turn carrying neither the split nor a total makes cache creation null, never zero', () => {
  const { cache_creation_input_tokens, cache_creation, ...bare } = tiered(1, 1, 1, 0, 0)
  const s = summarizeTranscript(jsonl(user('go'), assistant({ id: 'm1', usage: tiered(1, 1, 1, 10, 5) }), assistant({ id: 'm2', usage: bare })))
  assert.equal(s.usage.cacheCreationInputTokens, null)
  assert.equal(s.usage.inputTokens, 2)
})

test('a turn omitting cache_read_input_tokens makes that figure null for the agent and sums the rest', () => {
  const { cache_read_input_tokens, ...noRead } = tiered(4, 6, 0, 8, 0)
  const s = summarizeTranscript(jsonl(user('go'), assistant({ id: 'm1', usage: tiered(1, 2, 50, 3, 0) }), assistant({ id: 'm2', usage: noRead })))
  assert.equal(s.usage.cacheReadInputTokens, null)
  assert.equal(s.usage.inputTokens, 5)
  assert.equal(s.usage.outputTokens, 8)
  assert.deepEqual(s.usage.cacheCreationInputTokens, { ephemeral_5m: 11, ephemeral_1h: 0 })
})

test('a negative or non-numeric figure counts as omitted, not as a number', () => {
  const s = summarizeTranscript(
    jsonl(user('go'), assistant({ id: 'm1', usage: { ...tiered(1, 1, 1, 1, 0), input_tokens: -1 } }), assistant({ id: 'm2', usage: { ...tiered(1, 1, 1, 1, 0), output_tokens: '7' } }))
  )
  assert.equal(s.usage.inputTokens, null)
  assert.equal(s.usage.outputTokens, null)
  assert.equal(s.usage.cacheReadInputTokens, 2)
})

test('a torn final line is counted skipped and the rest is summed', () => {
  const whole = jsonl(user('go'), assistant({ id: 'm1', usage: tiered(2, 3, 4, 5, 0) }))
  const s = summarizeTranscript(whole + '{"type":"assistant","message":{"id":"m2","usa')
  assert.equal(s.skipped, 1)
  assert.equal(s.turns, 1)
  assert.equal(s.usage.inputTokens, 2)
  assert.equal(s.usage.outputTokens, 3)
})

test('empty lines are ignored, not counted skipped', () => {
  const s = summarizeTranscript('\n\n' + jsonl(user('go'), assistant({ id: 'm1', usage: tiered(1, 1, 1, 1, 0) })) + '\n   \n')
  assert.equal(s.skipped, 0)
  assert.equal(s.turns, 1)
})

test('no assistant turn yields usage null with a reason, never zeros', () => {
  const s = summarizeTranscript(jsonl(user(BOOTSTRAP), { type: 'attachment', attachment: { type: 'date' } }))
  assert.equal(s.usage, null)
  assert.equal(s.turns, 0)
  assert.match(s.reason, /no assistant turn/)
  assert.equal(s.briefingSha, BOOTSTRAP_SHA, 'the key is still read: an agent that never answered is still a briefed spawn')
})

test('an assistant line without a usage object is not a turn', () => {
  const s = summarizeTranscript(jsonl(user('go'), assistant({ id: 'm1' })))
  assert.equal(s.usage, null)
  assert.equal(s.turns, 0)
})

test('summarizeTranscript never throws on input that is not text', () => {
  for (const input of [undefined, null, 42, {}, '']) {
    const s = summarizeTranscript(input)
    assert.equal(s.usage, null)
    assert.equal(typeof s.reason, 'string')
  }
})

test('a ping transcript has no briefing key and its usage is still summed', () => {
  const s = summarizeTranscript(jsonl(user('Run `interlock run next` and report its exit code.'), assistant({ id: 'm1', model: 'claude-haiku-4-5', usage: tiered(3, 4, 5, 6, 0) })))
  assert.equal(s.briefingSha, null)
  assert.equal(s.usage.inputTokens, 3)
  assert.deepEqual(s.models, ['claude-haiku-4-5'])
})

test('the 2.1.289 harness wrapping: the sha is found in the indented computed task of the second user turn', () => {
  const indented = BOOTSTRAP.split('\n').map(l => `  ${l}`).join('\n')
  const s = summarizeTranscript(
    jsonl(
      user('[Workflow harness — user request] /interlock:ship add-foo'),
      user(`[Workflow harness — computed task]\n${indented}`),
      assistant({ id: 'm1', usage: tiered(1, 1, 1, 1, 0) })
    )
  )
  assert.equal(s.briefingSha, BOOTSTRAP_SHA)
})

test('the key is the LAST match before the first assistant line, not the first', () => {
  const s = summarizeTranscript(
    jsonl(
      user(`[Workflow harness — user request] please reuse Expected sha256: ${OTHER_SHA}`),
      user(`[Workflow harness — computed task]\n  ${BOOTSTRAP.split('\n').join('\n  ')}`),
      assistant({ id: 'm1', usage: tiered(1, 1, 1, 1, 0) })
    )
  )
  assert.equal(s.briefingSha, BOOTSTRAP_SHA)
})

test('the key is read from text blocks of an array content and never from a tool_result block', () => {
  const s = summarizeTranscript(
    jsonl(
      user([
        { type: 'text', text: BOOTSTRAP },
        { type: 'tool_result', tool_use_id: 't0', content: `Expected sha256: ${OTHER_SHA}` }
      ]),
      assistant({ id: 'm1', usage: tiered(1, 1, 1, 1, 0) })
    )
  )
  assert.equal(s.briefingSha, BOOTSTRAP_SHA)
})

test('a tool result after the first assistant line carrying another sha does not rejoin the agent', () => {
  const s = summarizeTranscript(
    jsonl(
      user(BOOTSTRAP),
      assistant({ id: 'm1', usage: tiered(1, 1, 1, 1, 0), content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] }),
      user([{ type: 'tool_result', tool_use_id: 't1', content: `Expected sha256: ${OTHER_SHA}` }]),
      user(`Expected sha256: ${THIRD_SHA}`),
      assistant({ id: 'm2', usage: tiered(1, 1, 1, 1, 0) })
    )
  )
  assert.equal(s.briefingSha, BOOTSTRAP_SHA)
})

test('the search stops at the first assistant line even when that line carries no usage', () => {
  const s = summarizeTranscript(jsonl(user('go'), assistant({ id: 'm0' }), user(BOOTSTRAP), assistant({ id: 'm1', usage: tiered(1, 1, 1, 1, 0) })))
  assert.equal(s.briefingSha, null)
})

test('the host <synthetic> placeholder is excluded from models', () => {
  const s = summarizeTranscript(
    jsonl(user('go'), assistant({ id: 'm1', usage: tiered(1, 1, 1, 1, 0) }), assistant({ id: 'm2', model: '<synthetic>', usage: tiered(0, 0, 0, 0, 0) }))
  )
  assert.deepEqual(s.models, ['claude-sonnet-5'])
  assert.equal(s.turns, 2)
})

test('models keep first-seen order and are bounded to MODELS_MAX', () => {
  const rows = [user('go')]
  for (let i = 0; i < 10; i++) rows.push(assistant({ id: `m${i}`, model: `model-${i}`, usage: tiered(1, 1, 1, 1, 0) }))
  rows.push(assistant({ id: 'm-again', model: 'model-0', usage: tiered(1, 1, 1, 1, 0) }))
  const s = summarizeTranscript(jsonl(...rows))
  assert.equal(s.models.length, MODELS_MAX)
  assert.deepEqual(s.models, Array.from({ length: 8 }, (_, i) => `model-${i}`))
  assert.equal(s.turns, 11)
})

test('lines are grouped by requestId when message.id is absent, the last line carrying the turn', () => {
  const s = summarizeTranscript(
    jsonl(
      user('go'),
      assistant({ requestId: 'req_1', usage: tiered(10, 1, 0, 5, 0) }),
      assistant({ requestId: 'req_1', usage: tiered(10, 50, 0, 5, 0) }),
      assistant({ requestId: 'req_2', usage: tiered(2, 3, 15, 0, 0) })
    )
  )
  assert.equal(s.turns, 2)
  assert.equal(s.usage.inputTokens, 12)
  assert.equal(s.usage.outputTokens, 53)
})

test('lines with neither message.id nor requestId are each their own turn', () => {
  const s = summarizeTranscript(jsonl(user('go'), assistant({ usage: tiered(1, 1, 1, 1, 0) }), assistant({ usage: tiered(1, 1, 1, 1, 0) })))
  assert.equal(s.turns, 2)
  assert.equal(s.usage.inputTokens, 2)
})

// ---------------------------------------------------------------- paths

test('isSafeSegment admits the run and agent id shapes and nothing with a separator', () => {
  for (const ok of ['r-1', 'a0000000000000001', 'run.2026-10-05T14_03', 'A']) assert.equal(isSafeSegment(ok), true, ok)
  for (const bad of ['', '../x', 'a/b', 'a\\b', '.hidden', '..', '-x', 'a b', 'x'.repeat(201), 42, null, undefined]) {
    assert.equal(isSafeSegment(bad), false, String(bad))
  }
  assert.equal(isSafeSegment('x'.repeat(200)), true)
})

test('agentFilePath names <root>/.claude/ship/agent-usage/<runId>/<agentId>.json, or null for an unsafe id', () => {
  assert.equal(agentUsageDir('/r', 'r-1'), join('/r', '.claude', 'ship', 'agent-usage', 'r-1'))
  assert.equal(agentFilePath('/r', 'r-1', 'a-1'), join('/r', '.claude', 'ship', 'agent-usage', 'r-1', 'a-1.json'))
  assert.equal(agentFilePath('/r', '../r', 'a-1'), null)
  assert.equal(agentFilePath('/r', 'r-1', '../x'), null)
  assert.equal(agentFilePath('/r', 'r-1', 'a/b'), null)
  assert.equal(agentUsageDir('/r', 'a/b'), null)
})

test('an agent id that would read back as a permission record is refused as a filename', () => {
  assert.equal(agentFilePath('/r', 'r-1', 'permission-denied-1-2-3'), null)
})

test('permissionFilePath names permission-<kind>-<atMs>-<pid>-<seq>.json, or null', () => {
  const at = '2026-10-05T14:03:10.000Z'
  assert.equal(
    permissionFilePath('/r', 'r-1', 'denied', at, 123, 0),
    join('/r', '.claude', 'ship', 'agent-usage', 'r-1', `permission-denied-${Date.parse(at)}-123-0.json`)
  )
  assert.match(permissionFilePath('/r', 'r-1', 'request', Date.parse(at), 9, 4), /permission-request-\d+-9-4\.json$/)
  assert.equal(permissionFilePath('/r', '../r', 'denied', at, 1, 0), null)
  assert.equal(permissionFilePath('/r', 'r-1', 'granted', at, 1, 0), null)
})

// ---------------------------------------------------------------- writers

test('writeAgentStart creates the file once, and a second start leaves it byte-identical', () => {
  const first = writeAgentStart(tmp, { runId: 'r-1', agentId: 'a-1', agentType: WORKFLOW_AGENT_TYPE, at: '2026-10-05T14:03:10.000Z' })
  assert.equal(first.written, true)
  assert.equal(first.path, agentFilePath(tmp, 'r-1', 'a-1'))
  const before = readFileSync(first.path, 'utf8')
  assert.deepEqual(JSON.parse(before), {
    schema: AGENT_USAGE_SCHEMA,
    agentId: 'a-1',
    agentType: 'workflow-subagent',
    startedAt: '2026-10-05T14:03:10.000Z',
    stoppedAt: null,
    briefingSha: null,
    models: null,
    turns: null,
    usage: null,
    transcript: null
  })

  const second = writeAgentStart(tmp, { runId: 'r-1', agentId: 'a-1', agentType: WORKFLOW_AGENT_TYPE, at: '2026-10-05T15:00:00.000Z' })
  assert.deepEqual(second, { written: false, reason: 'already recorded' })
  assert.equal(readFileSync(first.path, 'utf8'), before)
})

test('a start after a stop changes nothing: the stop record stands', () => {
  writeAgentStop(tmp, { runId: 'r-1', agentId: 'a-1', agentType: WORKFLOW_AGENT_TYPE, at: '2026-10-05T14:05:00.000Z', transcriptPath: TRANSCRIPT })
  const path = agentFilePath(tmp, 'r-1', 'a-1')
  const before = readFileSync(path, 'utf8')
  assert.equal(writeAgentStart(tmp, { runId: 'r-1', agentId: 'a-1', agentType: WORKFLOW_AGENT_TYPE }).written, false)
  assert.equal(readFileSync(path, 'utf8'), before)
})

test('start then stop leave exactly one file carrying the start time and the summed usage', () => {
  writeAgentStart(tmp, { runId: 'r-1', agentId: 'a-1', agentType: WORKFLOW_AGENT_TYPE, at: '2026-10-05T14:03:10.000Z' })
  const stop = writeAgentStop(tmp, {
    runId: 'r-1',
    agentId: 'a-1',
    agentType: WORKFLOW_AGENT_TYPE,
    at: '2026-10-05T14:03:40.000Z',
    transcriptPath: TRANSCRIPT
  })
  assert.equal(stop.written, true)
  assert.deepEqual(readdirSync(agentUsageDir(tmp, 'r-1')), ['a-1.json'])
  const record = JSON.parse(readFileSync(stop.path, 'utf8'))
  assert.deepEqual(record, {
    schema: AGENT_USAGE_SCHEMA,
    agentId: 'a-1',
    agentType: 'workflow-subagent',
    startedAt: '2026-10-05T14:03:10.000Z',
    stoppedAt: '2026-10-05T14:03:40.000Z',
    briefingSha: BOOTSTRAP_SHA,
    models: ['bedrock.claude-haiku-4-5'],
    turns: 3,
    usage: {
      inputTokens: 22,
      outputTokens: 490,
      cacheReadInputTokens: 41895,
      cacheCreationInputTokens: { ephemeral_5m: 21404, ephemeral_1h: 0 }
    },
    transcript: { path: TRANSCRIPT, parsed: true, reason: null }
  })
})

test('a stop without a prior start records startedAt null', () => {
  const stop = writeAgentStop(tmp, { runId: 'r-1', agentId: 'a-2', agentType: WORKFLOW_AGENT_TYPE, at: 'x', transcriptPath: TRANSCRIPT })
  assert.equal(JSON.parse(readFileSync(stop.path, 'utf8')).startedAt, null)
})

test('writeAgentStop with a missing transcript writes usage null with a reason and parsed false', () => {
  const missing = join(tmp, 'gone.jsonl')
  const stop = writeAgentStop(tmp, { runId: 'r-1', agentId: 'a-1', agentType: WORKFLOW_AGENT_TYPE, at: '2026-10-05T14:03:40.000Z', transcriptPath: missing })
  assert.equal(stop.written, true)
  const record = JSON.parse(readFileSync(stop.path, 'utf8'))
  assert.equal(record.usage, null)
  assert.equal(record.models, null)
  assert.equal(record.turns, null)
  assert.equal(record.transcript.path, missing)
  assert.equal(record.transcript.parsed, false)
  assert.equal(typeof record.transcript.reason, 'string')
  assert.ok(record.transcript.reason.length > 0)
})

test('writeAgentStop with no transcript path in the event records why', () => {
  const stop = writeAgentStop(tmp, { runId: 'r-1', agentId: 'a-1', agentType: WORKFLOW_AGENT_TYPE })
  const record = JSON.parse(readFileSync(stop.path, 'utf8'))
  assert.equal(record.usage, null)
  assert.equal(record.transcript.path, null)
  assert.equal(record.transcript.parsed, false)
  assert.equal(typeof record.transcript.reason, 'string')
})

test('writeAgentStop over a transcript with no assistant turn records the reason, never zeros', () => {
  const path = join(tmp, 'empty.jsonl')
  writeFileSync(path, jsonl(user(BOOTSTRAP)))
  const stop = writeAgentStop(tmp, { runId: 'r-1', agentId: 'a-1', agentType: WORKFLOW_AGENT_TYPE, transcriptPath: path })
  const record = JSON.parse(readFileSync(stop.path, 'utf8'))
  assert.equal(record.usage, null)
  assert.equal(record.transcript.parsed, true)
  assert.match(record.transcript.reason, /no assistant turn/)
})

test('writeAgentStop over a transcript with a torn line says lines were skipped', () => {
  const path = join(tmp, 'torn.jsonl')
  writeFileSync(path, jsonl(user('go'), assistant({ id: 'm1', usage: tiered(1, 1, 1, 1, 0) })) + '{"torn')
  const stop = writeAgentStop(tmp, { runId: 'r-1', agentId: 'a-1', agentType: WORKFLOW_AGENT_TYPE, transcriptPath: path })
  const record = JSON.parse(readFileSync(stop.path, 'utf8'))
  assert.equal(record.usage.inputTokens, 1)
  assert.match(record.transcript.reason, /1 .*skipped/)
})

test('an agent id or run id with a separator is refused: no file, written false', () => {
  for (const agentId of ['../x', 'a/b']) {
    const start = writeAgentStart(tmp, { runId: 'r-1', agentId, agentType: WORKFLOW_AGENT_TYPE })
    assert.equal(start.written, false)
    assert.equal(typeof start.reason, 'string')
    const stop = writeAgentStop(tmp, { runId: 'r-1', agentId, agentType: WORKFLOW_AGENT_TYPE, transcriptPath: TRANSCRIPT })
    assert.equal(stop.written, false)
  }
  assert.equal(writeAgentStart(tmp, { runId: '../r', agentId: 'a-1' }).written, false)
  assert.equal(existsSync(join(tmp, '.claude')), false, 'a refused id creates no directory')
  assert.equal(existsSync(join(tmp, 'x.json')), false)
})

test('an unwritable root returns written false without throwing', () => {
  const file = join(tmp, 'a-file')
  writeFileSync(file, 'not a directory')
  const root = join(file, 'root')
  const start = writeAgentStart(root, { runId: 'r-1', agentId: 'a-1', agentType: WORKFLOW_AGENT_TYPE })
  assert.equal(start.written, false)
  assert.equal(typeof start.reason, 'string')
  assert.equal(writeAgentStop(root, { runId: 'r-1', agentId: 'a-1', transcriptPath: TRANSCRIPT }).written, false)
  assert.equal(writePermissionEvent(root, { runId: 'r-1', kind: 'denied', tool: 'Bash' }).written, false)
})

test('the writers never throw on missing arguments', () => {
  assert.equal(writeAgentStart(tmp).written, false)
  assert.equal(writeAgentStop(tmp).written, false)
  assert.equal(writePermissionEvent(tmp).written, false)
})

test('writePermissionEvent writes one distinct file per event naming kind and tool, never the tool input', () => {
  const denied = writePermissionEvent(tmp, {
    runId: 'r-1',
    kind: 'denied',
    at: '2026-10-05T14:03:10.000Z',
    agentId: 'a-1',
    tool: 'Bash',
    reason: 'The auto mode classifier denied this action.',
    tool_input: { command: 'SECRET' },
    permission_suggestions: [{ type: 'setMode', mode: 'SECRET' }]
  })
  const request = writePermissionEvent(tmp, {
    runId: 'r-1',
    kind: 'request',
    at: '2026-10-05T14:03:10.000Z',
    agentId: 'a-1',
    tool: 'Edit',
    toolInput: { file_path: 'SECRET' }
  })
  assert.equal(denied.written, true)
  assert.equal(request.written, true)
  assert.notEqual(denied.path, request.path)

  const files = readdirSync(agentUsageDir(tmp, 'r-1')).sort()
  assert.equal(files.length, 2)
  assert.ok(files.every(f => f.startsWith('permission-')))
  for (const f of files) {
    assert.doesNotMatch(readFileSync(join(agentUsageDir(tmp, 'r-1'), f), 'utf8'), /SECRET/)
  }
  assert.deepEqual(JSON.parse(readFileSync(denied.path, 'utf8')), {
    schema: AGENT_USAGE_SCHEMA,
    kind: 'denied',
    at: '2026-10-05T14:03:10.000Z',
    agentId: 'a-1',
    tool: 'Bash',
    reason: 'The auto mode classifier denied this action.'
  })
  const req = JSON.parse(readFileSync(request.path, 'utf8'))
  assert.equal(req.kind, 'request')
  assert.equal(req.tool, 'Edit')
  assert.equal(req.reason, null, 'the captured PermissionRequest carries no reason')
})

test('two permission events of one kind in one process at one instant still get distinct files', () => {
  const at = '2026-10-05T14:03:10.000Z'
  const a = writePermissionEvent(tmp, { runId: 'r-1', kind: 'denied', at, tool: 'Bash' })
  const b = writePermissionEvent(tmp, { runId: 'r-1', kind: 'denied', at, tool: 'Bash' })
  assert.equal(a.written, true)
  assert.equal(b.written, true)
  assert.notEqual(a.path, b.path)
})

test('a permission event with an explicit pid and seq that already exist is not overwritten', () => {
  const ev = { runId: 'r-1', kind: 'denied', at: '2026-10-05T14:03:10.000Z', tool: 'Bash', pid: 7, seq: 0 }
  const a = writePermissionEvent(tmp, ev)
  const before = readFileSync(a.path, 'utf8')
  const b = writePermissionEvent(tmp, { ...ev, tool: 'Edit' })
  assert.equal(b.written, false)
  assert.equal(readFileSync(a.path, 'utf8'), before)
})

test('permission text fields are bounded to TEXT_MAX', () => {
  const w = writePermissionEvent(tmp, { runId: 'r-1', kind: 'denied', tool: 'T'.repeat(TEXT_MAX * 2), reason: 'r'.repeat(TEXT_MAX * 2), agentId: 'a'.repeat(TEXT_MAX * 2) })
  const record = JSON.parse(readFileSync(w.path, 'utf8'))
  assert.equal(record.tool.length, TEXT_MAX)
  assert.equal(record.reason.length, TEXT_MAX)
  assert.equal(record.agentId.length, TEXT_MAX)
  assert.ok(record.reason.endsWith('…'))
})

test('a permission event with a bad kind or an unsafe run id writes nothing', () => {
  assert.equal(writePermissionEvent(tmp, { runId: 'r-1', kind: 'granted', tool: 'Bash' }).written, false)
  assert.equal(writePermissionEvent(tmp, { runId: 'a/b', kind: 'denied', tool: 'Bash' }).written, false)
  assert.equal(existsSync(join(tmp, '.claude')), false)
})

// ---------------------------------------------------------------- reader

test('readAgentUsage on an absent directory is present false: no sidecar, not an empty one', () => {
  assert.deepEqual(readAgentUsage(tmp, 'r-1'), { present: false, agents: [], permissions: [], unreadable: [] })
})

test('readAgentUsage on an existing empty directory is present true with nothing in it', () => {
  mkdirSync(agentUsageDir(tmp, 'r-1'), { recursive: true })
  assert.deepEqual(readAgentUsage(tmp, 'r-1'), { present: true, agents: [], permissions: [], unreadable: [] })
})

test('readAgentUsage returns agents, permissions, and every unreadable file by root-relative name', () => {
  writeAgentStart(tmp, { runId: 'r-1', agentId: 'a-1', agentType: WORKFLOW_AGENT_TYPE })
  writeAgentStop(tmp, { runId: 'r-1', agentId: 'a-2', agentType: WORKFLOW_AGENT_TYPE, transcriptPath: TRANSCRIPT })
  writePermissionEvent(tmp, { runId: 'r-1', kind: 'denied', tool: 'Bash' })
  writePermissionEvent(tmp, { runId: 'r-1', kind: 'request', tool: 'Edit' })
  const dir = agentUsageDir(tmp, 'r-1')
  writeFileSync(join(dir, 'bad.json'), '{ not json')
  writeFileSync(join(dir, 'permission-denied-0-0-0.json'), JSON.stringify({ schema: AGENT_USAGE_SCHEMA, kind: 'nope' }))
  writeFileSync(join(dir, 'shapeless.json'), JSON.stringify([1, 2]))
  writeFileSync(join(dir, 'notes.txt'), 'ignored: not a record')
  // Another run's records are not this run's.
  writeAgentStart(tmp, { runId: 'r-2', agentId: 'a-9', agentType: WORKFLOW_AGENT_TYPE })

  const read = readAgentUsage(tmp, 'r-1')
  assert.equal(read.present, true)
  assert.deepEqual(read.agents.map(a => a.agentId).sort(), ['a-1', 'a-2'])
  assert.equal(read.agents.find(a => a.agentId === 'a-2').usage.inputTokens, 22)
  assert.deepEqual(read.permissions.map(p => `${p.kind}:${p.tool}`).sort(), ['denied:Bash', 'request:Edit'])
  const rel = name => join(AGENT_USAGE_DIR, 'r-1', name)
  assert.deepEqual(read.unreadable.map(u => u.file).sort(), [rel('bad.json'), rel('permission-denied-0-0-0.json'), rel('shapeless.json')].sort())
  for (const u of read.unreadable) assert.ok(typeof u.reason === 'string' && u.reason.length > 0)
  for (const r of [...read.agents, ...read.permissions]) assert.ok(r.file.startsWith(join(AGENT_USAGE_DIR, 'r-1')))
})

test('readAgentUsage never throws on an unsafe run id and says why it read nothing', () => {
  const read = readAgentUsage(tmp, '../x')
  assert.equal(read.present, false)
  assert.deepEqual(read.agents, [])
  assert.deepEqual(read.permissions, [])
  assert.equal(read.unreadable.length, 1)
})
