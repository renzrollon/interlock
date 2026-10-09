// The vendor CLI adapters, driven against fixture binaries (design D12).
//
// Every adapter is a transport: an argv, a prompt on stdin, an envelope back.
// So the properties worth asserting are the bytes, and they are asserted against
// a fixture CLI that REFUSES a wrong invocation rather than against a mock that
// records one — a mock would happily accept the day the adapter stopped passing
// `--json-schema`, and the run would look green while nothing enforced a schema.
//
// The argv is pinned exactly. Vendor flags drift, that drift is the risk this
// change's design names first, and a pinned argv turns it into a failing test
// instead of a run that silently ran unattended without a sandbox.
//
// Live runs against the installed CLIs are opt-in through INTERLOCK_LIVE_HOSTS:
// they cost money and need credentials, and a suite that spent either by default
// would be a suite nobody runs.

import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  claudeArgs,
  createClaudeHost,
  probeClaudeEffort,
  probeClaudeVersion,
  probeHelpFlags,
  readClaudeEnvelope,
  readLaneTranscript
} from '../../lib/host/claude-cli.mjs'
import { codexArgs, createCodexHost, onChatGptPlan, readCodexUsage } from '../../lib/host/codex.mjs'
import { createQwenHost, qwenArgs, readQwenEnvelope } from '../../lib/host/qwen.mjs'
import { HOSTS, createHost } from '../../lib/host/registry.mjs'
import { MODEL_MAP_ENV, modelMatches, parseModelMap, resolveModel } from '../../lib/host/model-map.mjs'
import { MAX_AGENT_ERRORS, MAX_TEXT } from '../../lib/run-log.mjs'
import { modelSubstitution } from '../../lib/run.mjs'
import { projectSlug } from '../../lib/project-slug.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FIXTURES = join(ROOT, 'test', 'fixtures', 'hosts')

const SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }

/** A spawn request shaped like the ones `interlock run` emits. */
function request(extra = {}) {
  return {
    label: '1.1',
    prompt: 'do the thing',
    schema: SCHEMA,
    type: 'interlock:worker',
    tools: ['Read', 'Write'],
    ...extra
  }
}

/** Each adapter, with the fixture CLI that answers for it and its echo mode. */
const ADAPTERS = [
  {
    id: 'claude',
    create: opts => createClaudeHost(opts),
    fixture: join(FIXTURES, 'fake-claude.mjs'),
    // Claude's own CLI accepts the planner's slugs, so an unmapped spawn is
    // still routed — the one host where that is true.
    passesSlugThrough: true,
    usageByDefault: true,
    // The only adapter whose vendor envelope decomposes usage into cache reads
    // and per-tier cache writes — the registry declares it, and this is where
    // the wire half of that declaration is checked.
    cacheAccounting: true
  },
  {
    id: 'codex',
    create: opts => createCodexHost(opts),
    fixture: join(FIXTURES, 'fake-codex.mjs'),
    passesSlugThrough: false,
    usageByDefault: true
  },
  {
    id: 'qwen',
    create: opts => createQwenHost(opts),
    fixture: join(FIXTURES, 'fake-qwen.mjs'),
    passesSlugThrough: false,
    // Qwen's envelope carries no accounting unless the fixture is asked for it,
    // which is why the host declares `usage: false`.
    usageByDefault: false
  }
]

/** A host wired to its fixture, with the extra fixture flags appended. */
function hosted(adapter, { fixtureFlags = [], env = {}, cwd = ROOT, onEvent } = {}) {
  return adapter.create({
    command: [process.execPath, adapter.fixture, ...fixtureFlags].join(' '),
    cwd,
    env,
    onEvent
  })
}

// --- the argv, pinned ---------------------------------------------------------

test('the claude adapter sends the verified argv', () => {
  assert.deepEqual(
    claudeArgs(request({ model: 'haiku' }), {
      model: 'haiku',
      permissionMode: 'bypassPermissions',
      plugin: '/plugin'
    }),
    [
      '-p',
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(SCHEMA),
      '--plugin-dir',
      '/plugin',
      '--agent',
      'interlock:worker',
      '--model',
      'haiku',
      '--permission-mode',
      'bypassPermissions',
      '--allowedTools',
      'Read,Write'
    ]
  )
})

test('the claude adapter passes no --agent when the plugin is not resolvable', () => {
  // An `--agent` naming a type the session cannot resolve is an invocation
  // error, and an invocation error reads as a model that failed rather than as
  // a host that was misconfigured.
  const args = claudeArgs(request(), { model: null, permissionMode: 'bypassPermissions', plugin: null })
  assert.ok(!args.includes('--agent'))
  assert.ok(!args.includes('--plugin-dir'))
  assert.ok(!args.includes('--model'), 'and no --model when nothing resolved')
})

test('the codex adapter sends the verified argv and no --ask-for-approval', () => {
  // `codex exec --help` (0.145.0) rejects `--ask-for-approval` outright: exec is
  // the non-interactive mode and never prompts. The design named that flag; the
  // installed CLI does not have it.
  const args = codexArgs({ cwd: '/lane', schemaPath: '/tmp/s.json', outputPath: '/tmp/o.json', model: 'gpt-5' })
  assert.deepEqual(args, [
    'exec',
    '--json',
    '--output-schema',
    '/tmp/s.json',
    '-o',
    '/tmp/o.json',
    '-C',
    '/lane',
    '--sandbox',
    'workspace-write',
    '--model',
    'gpt-5'
  ])
  assert.ok(!args.includes('--ask-for-approval'))
  assert.ok(
    !args.includes('--dangerously-bypass-approvals-and-sandbox'),
    'and never the flag that removes the sandbox'
  )
})

test('the qwen adapter sends the verified argv, with -m as the model flag', () => {
  assert.deepEqual(qwenArgs(request(), { model: 'qwen3-max' }), [
    '-p',
    '-',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(SCHEMA),
    '--yolo',
    '-m',
    'qwen3-max'
  ])
  assert.ok(!qwenArgs(request(), { model: null }).includes('-m'), 'and no model flag when unmapped')
})

// --- the wire ----------------------------------------------------------------

for (const adapter of ADAPTERS) {
  test(`${adapter.id}: the prompt arrives on stdin, a schema is passed, and the result is the payload`, async () => {
    // The fixture exits 64 if the prompt was not on stdin or no schema was
    // passed, so a null here IS the assertion failing.
    const host = hosted(adapter, { fixtureFlags: ['--fixture-echo'] })
    const result = await host.spawn(request())
    assert.ok(result, `${adapter.id}: the fixture refused the invocation`)
    assert.equal(result.promptOnStdin, true)
    assert.ok(result.argv.includes('--json-schema') || result.schemaPath, 'a schema must be passed')
  })

  test(`${adapter.id}: a non-zero exit is a null spawn, not a throw`, async () => {
    const events = []
    const host = hosted(adapter, { fixtureFlags: ['--fixture-fail'], onEvent: e => events.push(e) })
    assert.equal(await host.spawn(request()), null)
    const failure = events.find(e => e.type === 'spawn-failed')
    assert.ok(failure, 'the adapter must say the spawn failed')
    assert.match(failure.error, /refusing on purpose/, 'and carry the stderr tail as the diagnostic')
  })

  test(`${adapter.id}: an envelope with no payload is a null spawn`, async () => {
    const host = hosted(adapter, { fixtureFlags: ['--fixture-no-output'] })
    assert.equal(await host.spawn(request()), null)
  })

  test(`${adapter.id}: usage is attached when the CLI reports it, and absent otherwise`, async () => {
    const withUsage = hosted(adapter, {
      fixtureFlags: [adapter.usageByDefault ? '--fixture-echo' : '--fixture-usage', '--fixture-echo']
    })
    const reported = await withUsage.spawn(request())
    assert.equal(reported.usage.inputTokens, 11)
    assert.equal(reported.usage.outputTokens, 23)
    // Cache figures ride the same envelope on the one adapter that decomposes
    // it, and are simply not there on the adapters that do not — absent, never
    // a zero standing in for a measurement nobody made. The fake-claude
    // envelope reports a MEASURED zero read, which survives as a zero.
    if (adapter.cacheAccounting) {
      assert.equal(reported.usage.cacheReadInputTokens, 0, 'a measured zero is kept as a zero')
    } else {
      assert.ok(!('cacheReadInputTokens' in reported.usage))
      assert.ok(!('cacheCreationInputTokens' in reported.usage))
    }

    const without = hosted(adapter, {
      fixtureFlags: adapter.usageByDefault ? ['--fixture-no-usage', '--fixture-echo'] : ['--fixture-echo']
    })
    const silent = await without.spawn(request())
    assert.equal(silent.usage, undefined, 'an unreported usage stays absent, never zero')
  })

  test(`${adapter.id}: a malformed ${MODEL_MAP_ENV} fails host creation, not a wave three deep`, () => {
    assert.throws(
      () => hosted(adapter, { env: { [MODEL_MAP_ENV]: '{not json' } }),
      new RegExp(MODEL_MAP_ENV)
    )
    assert.throws(() => hosted(adapter, { env: { [MODEL_MAP_ENV]: '{"codex":"gpt"}' } }), /JSON object/)
  })
}

test('an unmapped codex spawn reports applied:false with the slug in the reason', async () => {
  const events = []
  const host = hosted(ADAPTERS[1], { fixtureFlags: ['--fixture-echo'], onEvent: e => events.push(e) })
  const result = await host.spawn(request({ model: 'sonnet' }))
  const routing = events.find(e => e.type === 'model-routing')
  assert.equal(routing.applied, false)
  assert.equal(routing.reason, 'no mapping for sonnet')
  assert.equal(result.model, null, 'and no model flag reached the CLI')
})

test('an unmapped qwen spawn reports applied:false and passes no model flag', async () => {
  const events = []
  const host = hosted(ADAPTERS[2], { fixtureFlags: ['--fixture-echo'], onEvent: e => events.push(e) })
  const result = await host.spawn(request({ model: 'opus' }))
  assert.equal(events.find(e => e.type === 'model-routing').reason, 'no mapping for opus')
  assert.equal(result.model, null)
})

test('a mapped codex spawn applies the mapped model', async () => {
  const events = []
  const host = hosted(ADAPTERS[1], {
    fixtureFlags: ['--fixture-echo'],
    env: { [MODEL_MAP_ENV]: '{"codex":{"sonnet":"gpt-5-codex"}}' },
    onEvent: e => events.push(e)
  })
  const result = await host.spawn(request({ model: 'sonnet' }))
  assert.equal(result.model, 'gpt-5-codex')
  assert.equal(events.find(e => e.type === 'model-routing').applied, true)
})

test('claude passes the planner slug through unmapped, and prefers a mapping when there is one', async () => {
  const plain = await hosted(ADAPTERS[0], { fixtureFlags: ['--fixture-echo'] }).spawn(
    request({ model: 'haiku' })
  )
  assert.equal(plain.model, 'haiku')

  const mapped = await hosted(ADAPTERS[0], {
    fixtureFlags: ['--fixture-echo'],
    env: { [MODEL_MAP_ENV]: '{"claude":{"haiku":"claude-haiku-4-5"}}' }
  }).spawn(request({ model: 'haiku' }))
  assert.equal(mapped.model, 'claude-haiku-4-5')
})

test('a spawn runs in the cwd the step named, not in the repo root', async () => {
  // The isolation contract on the runner: the lane's writes must land in its
  // worktree, not in the shared tree its siblings are also writing to.
  // realpath: mkdtemp hands back a symlinked path on macOS, and a child's own
  // process.cwd() is the resolved one.
  const lane = realpathSync(mkdtempSync(join(tmpdir(), 'interlock-lane-')))
  try {
    for (const adapter of ADAPTERS) {
      const result = await hosted(adapter, { fixtureFlags: ['--fixture-echo'] }).spawn(
        request({ cwd: lane })
      )
      assert.equal(result.cwd, lane, `${adapter.id} ignored the spawn's cwd`)
    }
  } finally {
    rmSync(lane, { recursive: true, force: true })
  }
})

// --- the map -----------------------------------------------------------------

test('the published map is keyed by host, and the ACP variable is folded in as its acp entry', () => {
  assert.deepEqual(parseModelMap({}), {})
  assert.deepEqual(
    parseModelMap({ [MODEL_MAP_ENV]: '{"codex":{"sonnet":"gpt-5-codex"},"qwen":{"opus":"qwen3-max"}}' }),
    { codex: { sonnet: 'gpt-5-codex' }, qwen: { opus: 'qwen3-max' } }
  )
  assert.deepEqual(parseModelMap({ INTERLOCK_ACP_MODEL_MAP: '{"sonnet":"x-large"}' }), {
    acp: { sonnet: 'x-large' }
  })
  // Both set: the newer variable's `acp` entry wins per slug, and the alias
  // supplies what it did not mention. Discarding either silently is the
  // confusing half of any order.
  assert.deepEqual(
    parseModelMap({
      [MODEL_MAP_ENV]: '{"acp":{"sonnet":"new"}}',
      INTERLOCK_ACP_MODEL_MAP: '{"sonnet":"old","haiku":"kept"}'
    }),
    { acp: { sonnet: 'new', haiku: 'kept' } }
  )
})

test('resolveModel never guesses a nearest model and always carries a reason', () => {
  const map = { codex: { sonnet: 'gpt-5-codex' } }
  assert.deepEqual(resolveModel('codex', 'sonnet', map, { modelSelect: 'map-only' }), {
    value: 'gpt-5-codex',
    applied: true,
    reason: null
  })
  assert.deepEqual(resolveModel('codex', 'opus', map, { modelSelect: 'map-only' }), {
    value: null,
    applied: false,
    reason: 'no mapping for opus'
  })
  assert.deepEqual(resolveModel('claude', 'opus', {}, { modelSelect: 'flag' }), {
    value: 'opus',
    applied: true,
    reason: null
  })
  assert.equal(resolveModel('acp', 'opus', {}, { modelSelect: 'negotiated' }).applied, false)
  assert.equal(resolveModel('codex', '', map, { modelSelect: 'map-only' }).reason, 'no model requested')
})

// --- the envelope readers ------------------------------------------------------

test('the envelope readers recover a payload and refuse a broken one', () => {
  // The result and the usage halves exactly as before the host record existed
  // (design D7): the record rides beside them, it does not reshape them.
  const read = readClaudeEnvelope('{"structured_output":{"ok":true},"usage":{"output_tokens":5}}')
  assert.deepEqual(read.result, { ok: true })
  assert.deepEqual(read.usage, { inputTokens: undefined, outputTokens: 5 })
  assert.deepEqual(Object.keys(read).sort(), ['host', 'result', 'usage'])
  const broken = readClaudeEnvelope('not json')
  assert.equal(broken.result, null)
  assert.equal(broken.usage, null)
  assert.equal(readClaudeEnvelope('{"result":"prose only"}').result, null, 'prose is not a payload')

  assert.equal(readQwenEnvelope('{"response":{"ok":true}}').result.ok, true)
  assert.equal(readQwenEnvelope('{"response":"{\\"ok\\":true}"}').result.ok, true, 'a quoted payload too')
  assert.equal(readQwenEnvelope('nope').result, null)

  assert.deepEqual(
    readCodexUsage('{"msg":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1,"output_tokens":2}}}}'),
    { inputTokens: 1, outputTokens: 2 }
  )
  assert.equal(readCodexUsage('{"msg":{"type":"task_started"}}\nnot json\n'), null, 'unknown is null, not zero')
})

test('the ChatGPT plan condition is the ABSENCE of both keys', () => {
  assert.equal(onChatGptPlan({}), true)
  assert.equal(onChatGptPlan({ CODEX_API_KEY: 'k' }), false)
  assert.equal(onChatGptPlan({ OPENAI_API_KEY: 'k' }), false)
  assert.equal(onChatGptPlan({ OPENAI_API_KEY: '  ' }), true, 'a blank key is not a key')
})

// --- the host record (design D7; spec: run-host-adapters — the whole envelope) -
//
// What the host observed about a spawn, read off the WHOLE envelope whatever the
// exit code, and carried beside the result rather than inside it. Every field is
// copied by name, and a field the envelope omits is absent — null — never a zero,
// a false or an empty list standing in for a measurement nobody made.

const ENVELOPES = join(FIXTURES, 'claude-envelopes')
const envelopeText = name => readFileSync(join(ENVELOPES, name), 'utf8')
const CAPTURED_SESSION = '00000000-0000-4000-8000-000000000000'

/** Every key the host record carries, in D7's order. */
const HOST_RECORD_KEYS = [
  'parsed',
  'subtype',
  'isError',
  'terminalReason',
  'errors',
  'permissionDenials',
  'sessionId',
  'numTurns',
  'sessionModels',
  'hostCostUsd',
  'exitCode',
  'timedOut',
  'resultMissing'
]

test('readClaudeEnvelope: the captured success envelope yields every host field, and the result and usage as before', () => {
  const read = readClaudeEnvelope(envelopeText('success.json'), { exitCode: 0 })
  assert.deepEqual(read.result, { ok: true })
  assert.deepEqual(read.usage, {
    inputTokens: 2,
    outputTokens: 345,
    cacheReadInputTokens: 44547,
    cacheCreationInputTokens: { ephemeral_5m: 983, ephemeral_1h: 0 }
  })
  assert.deepEqual(read.host, {
    parsed: true,
    subtype: 'success',
    isError: false,
    terminalReason: 'completed',
    // The capture carries no `errors` key: absent, not an empty list.
    errors: null,
    // The capture carries `permission_denials: []`: a measured none.
    permissionDenials: { count: 0, tools: [] },
    sessionId: CAPTURED_SESSION,
    numTurns: 1,
    // Session-scoped: the host's internal haiku call sits beside the session's
    // own model on a one-turn run, so these keys are not the lane's model.
    sessionModels: ['bedrock.claude-haiku-4-5', 'bedrock.claude-sonnet-5'],
    hostCostUsd: 0.14365309999999998,
    exitCode: 0,
    timedOut: false,
    resultMissing: false
  })
  assert.deepEqual(Object.keys(read.host), HOST_RECORD_KEYS)
})

test('readClaudeEnvelope: success with exit 0 and no structured_output is a missing result', () => {
  const read = readClaudeEnvelope(envelopeText('no-structured-output.json'), { exitCode: 0 })
  assert.equal(read.result, null)
  assert.equal(read.host.resultMissing, true)
  assert.equal(read.host.subtype, 'success')
  assert.deepEqual(read.host.sessionModels, ['bedrock.claude-haiku-4-5', 'bedrock.claude-sonnet-5'])
  assert.equal(read.usage.outputTokens, 345, 'the usage half is read exactly as before')
  // An exit the caller did not know is not a non-zero exit: still missing.
  assert.equal(readClaudeEnvelope(envelopeText('no-structured-output.json')).host.resultMissing, true)
  // A non-zero exit is a stopped lane, not a missing result.
  assert.equal(readClaudeEnvelope(envelopeText('no-structured-output.json'), { exitCode: 1 }).host.resultMissing, false)
  // And a structured result that is not an object is no result either.
  const scalar = JSON.parse(envelopeText('no-structured-output.json'))
  scalar.structured_output = 'ok'
  assert.equal(readClaudeEnvelope(JSON.stringify(scalar), { exitCode: 0 }).host.resultMissing, true)
})

test('readClaudeEnvelope: an error envelope on a non-zero exit carries its subtype, errors and exit code', () => {
  const read = readClaudeEnvelope(envelopeText('error-subtype.json'), { exitCode: 1 })
  assert.equal(read.result, null)
  assert.deepEqual(read.host, {
    parsed: true,
    subtype: 'error_max_turns',
    isError: true,
    terminalReason: 'max_turns',
    errors: ['Reached maximum number of turns (1)'],
    permissionDenials: { count: 0, tools: [] },
    sessionId: CAPTURED_SESSION,
    numTurns: 2,
    sessionModels: ['bedrock.claude-sonnet-5'],
    hostCostUsd: 0.0123,
    exitCode: 1,
    timedOut: false,
    resultMissing: false
  })
})

test('readClaudeEnvelope: a field the envelope omits is absent, never zero, false or empty', () => {
  const bare = readClaudeEnvelope('{"type":"result"}', { exitCode: 0 })
  assert.deepEqual(bare.host, {
    parsed: true,
    subtype: null,
    isError: null,
    terminalReason: null,
    errors: null,
    permissionDenials: null,
    sessionId: null,
    numTurns: null,
    sessionModels: null,
    hostCostUsd: null,
    exitCode: 0,
    timedOut: false,
    resultMissing: false
  })
  // An omitted per-model breakdown is session models unknown, not "none ran".
  const noBreakdown = JSON.parse(envelopeText('success.json'))
  delete noBreakdown.modelUsage
  assert.equal(readClaudeEnvelope(JSON.stringify(noBreakdown)).host.sessionModels, null)
  // Wrong-typed fields are absent too, not coerced.
  const wrong = readClaudeEnvelope(
    JSON.stringify({ subtype: 7, is_error: 'yes', num_turns: -1, total_cost_usd: 'free', session_id: '', modelUsage: [] })
  )
  for (const key of ['subtype', 'isError', 'numTurns', 'hostCostUsd', 'sessionId', 'sessionModels']) {
    assert.equal(wrong.host[key], null, `${key} must be absent when the envelope's value is unusable`)
  }
})

test('readClaudeEnvelope: unparseable stdout is a record that says so, carrying the exit and nothing invented', () => {
  for (const stdout of ['not json', '', '[1,2]', '42', undefined]) {
    const read = readClaudeEnvelope(stdout, { exitCode: 2, timedOut: true })
    assert.equal(read.result, null)
    assert.equal(read.usage, null)
    assert.deepEqual(
      read.host,
      Object.fromEntries(
        HOST_RECORD_KEYS.map(key => [key, key === 'parsed' ? false : key === 'exitCode' ? 2 : key === 'timedOut' ? true : null])
      ),
      `stdout ${JSON.stringify(stdout)}`
    )
  }
  assert.deepEqual(readClaudeEnvelope('not json').host.exitCode, null, 'an exit nobody reported is unknown')
  assert.equal(readClaudeEnvelope('not json').host.timedOut, false)
})

test('readClaudeEnvelope: errors are bounded in count and length, and denials name each tool once', () => {
  const long = 'x'.repeat(MAX_TEXT * 2)
  const read = readClaudeEnvelope(
    JSON.stringify({
      subtype: 'error_during_execution',
      is_error: true,
      errors: Array.from({ length: MAX_AGENT_ERRORS + 5 }, () => long),
      permission_denials: [
        { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'rm -rf /' } },
        { tool_name: 'Bash', tool_use_id: 't2', tool_input: {} },
        { tool_name: 'Edit', tool_use_id: 't3', tool_input: {} }
      ]
    }),
    { exitCode: 1 }
  )
  assert.equal(read.host.errors.length, MAX_AGENT_ERRORS)
  for (const error of read.host.errors) assert.equal(error.length, MAX_TEXT)
  // The count is every denial; the tools are the distinct names, and the
  // tool input — a command line, a file body — never travels.
  assert.deepEqual(read.host.permissionDenials, { count: 3, tools: ['Bash', 'Edit'] })
  assert.ok(!JSON.stringify(read.host).includes('rm -rf'), 'a denial\'s tool input is never copied')
})

// --- the lane transcript (design D7) -------------------------------------------

const WORKER_TRANSCRIPT = join(ROOT, 'test', 'fixtures', 'transcripts', 'worker-agent.jsonl')

/** Plant a session transcript where the host writes one for a session run in `cwd`. */
function plantTranscript(configDir, cwd, sessionId, text) {
  const dir = join(configDir, 'projects', projectSlug(realpathSync(cwd)))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${sessionId}.jsonl`), text)
}

/** A scratch config dir and a lane directory, removed when `fn` returns. */
async function withScratch(fn) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'interlock-transcript-')))
  const config = join(scratch, 'config')
  const lane = join(scratch, 'lane')
  mkdirSync(config)
  mkdirSync(lane)
  try {
    return await fn({ scratch, config, lane })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

test('readLaneTranscript finds the session transcript under CLAUDE_CONFIG_DIR and reads its turn-scoped models', () =>
  withScratch(({ config, lane }) => {
    plantTranscript(config, lane, 'sess-a', readFileSync(WORKER_TRANSCRIPT, 'utf8'))
    assert.deepEqual(readLaneTranscript({ cwd: lane, sessionId: 'sess-a', env: { CLAUDE_CONFIG_DIR: config } }), {
      servedModels: ['bedrock.claude-haiku-4-5'],
      reason: null
    })
  }))

test('readLaneTranscript falls back to $HOME/.claude when CLAUDE_CONFIG_DIR is unset', () =>
  withScratch(({ scratch, lane }) => {
    plantTranscript(join(scratch, '.claude'), lane, 'sess-h', readFileSync(WORKER_TRANSCRIPT, 'utf8'))
    const read = readLaneTranscript({ cwd: lane, sessionId: 'sess-h', env: { HOME: scratch } })
    assert.deepEqual(read.servedModels, ['bedrock.claude-haiku-4-5'])
  }))

test('readLaneTranscript reports absent with a reason, never throwing, when it cannot read a served model', () =>
  withScratch(({ config, lane }) => {
    const env = { CLAUDE_CONFIG_DIR: config }
    const cases = [
      ['a missing file', { cwd: lane, sessionId: 'sess-none', env }],
      ['an unsafe session id', { cwd: lane, sessionId: '../escape', env }],
      ['no session id', { cwd: lane, sessionId: null, env }],
      ['a missing cwd', { cwd: join(lane, 'no-such-dir'), sessionId: 'sess-a', env }],
      ['no arguments', undefined]
    ]
    plantTranscript(config, lane, 'sess-user-only', '{"type":"user","message":{"role":"user","content":"hi"}}\n')
    cases.push(['a transcript with no assistant turn', { cwd: lane, sessionId: 'sess-user-only', env }])
    for (const [what, args] of cases) {
      let read
      assert.doesNotThrow(() => {
        read = readLaneTranscript(args)
      }, what)
      assert.equal(read.servedModels, null, what)
      assert.equal(typeof read.reason, 'string', `${what}: the absence carries its reason`)
      assert.ok(read.reason.length > 0, what)
    }
  }))

// --- the host record through the real adapter ------------------------------------

test('claude: a non-zero exit with an error envelope returns null and spawn-failed carries the host record', () =>
  withScratch(async ({ config, lane }) => {
    const events = []
    const host = hosted(ADAPTERS[0], {
      fixtureFlags: ['--fixture-error-subtype=error_max_turns'],
      env: { CLAUDE_CONFIG_DIR: config },
      onEvent: e => events.push(e)
    })
    assert.equal(await host.spawn(request({ model: 'sonnet', cwd: lane })), null, 'a stopped lane still has no result')
    const failed = events.filter(e => e.type === 'spawn-failed')
    assert.equal(failed.length, 1)
    assert.equal(events.filter(e => e.type === 'spawn-done').length, 0)
    const record = failed[0].host
    assert.ok(record, 'spawn-failed must carry the host record')
    assert.equal(record.parsed, true, 'the envelope on stdout was read despite the exit')
    assert.equal(record.subtype, 'error_max_turns')
    assert.equal(record.isError, true)
    assert.equal(record.exitCode, 1)
    assert.equal(record.timedOut, false)
    assert.equal(record.resultMissing, false)
    assert.ok(Array.isArray(record.errors) && record.errors.length > 0, 'the envelope\'s errors')
    assert.equal(typeof record.sessionId, 'string')
    assert.equal(record.modelRouted, 'sonnet')
    assert.equal(typeof failed[0].error, 'string', 'and the stderr-tail diagnostic is kept')
  }))

test('claude: a lane transcript gives spawn-done turn-scoped served models beside the session-scoped ones', () =>
  withScratch(async ({ config, lane }) => {
    const events = []
    const host = hosted(ADAPTERS[0], {
      fixtureFlags: ['--fixture-echo', '--fixture-transcript=claude-opus-5-5', '--fixture-session=sess-t1'],
      env: { CLAUDE_CONFIG_DIR: config },
      onEvent: e => events.push(e)
    })
    const result = await host.spawn(request({ model: 'sonnet', cwd: lane }))
    assert.ok(result, 'the spawn returned its result')
    const done = events.filter(e => e.type === 'spawn-done')
    assert.equal(done.length, 1)
    const record = done[0].host
    assert.deepEqual(record.servedModels, ['claude-opus-5-5'])
    assert.equal(record.transcriptReason, null)
    assert.equal(record.sessionId, 'sess-t1')
    assert.deepEqual(record.sessionModels, ['sonnet'])
    assert.equal(record.modelRouted, 'sonnet', 'the value the adapter sent, after the map')
    assert.deepEqual(record.usage, result.usage, 'the record carries the same usage the result does')
    assert.ok(!('host' in result), 'the result itself carries no host field')
  }))

test('claude: with no lane transcript, served models are absent with a reason and session models remain', () =>
  withScratch(async ({ config, lane }) => {
    const events = []
    const host = hosted(ADAPTERS[0], {
      fixtureFlags: [
        '--fixture-echo',
        '--fixture-served-model=claude-opus-5-5',
        '--fixture-denials=Bash,Edit',
        '--fixture-session=sess-lane-1'
      ],
      env: { CLAUDE_CONFIG_DIR: config, [MODEL_MAP_ENV]: '{"claude":{"sonnet":"claude-sonnet-5-5"}}' },
      onEvent: e => events.push(e)
    })
    await host.spawn(request({ model: 'sonnet', cwd: lane }))
    const record = events.find(e => e.type === 'spawn-done').host
    assert.equal(record.servedModels, null)
    assert.equal(typeof record.transcriptReason, 'string')
    assert.deepEqual(record.sessionModels, ['claude-sonnet-5-5', 'claude-opus-5-5'])
    assert.equal(record.modelRouted, 'claude-sonnet-5-5', 'the mapped value, which is what the host was sent')
    assert.equal(record.sessionId, 'sess-lane-1')
    assert.deepEqual(record.permissionDenials, { count: 2, tools: ['Bash', 'Edit'] })
    assert.equal(record.numTurns > 0, true)
    assert.equal(typeof record.hostCostUsd, 'number')
  }))

test('claude: a spawn with no model records modelRouted as absent', async () => {
  const events = []
  const host = hosted(ADAPTERS[0], { fixtureFlags: ['--fixture-echo'], onEvent: e => events.push(e) })
  await host.spawn(request())
  assert.equal(events.find(e => e.type === 'spawn-done').host.modelRouted, null)
})

test('fake-claude refuses --no-session-persistence and unknown flags, so the fixture fails an adapter that sends one', () => {
  const fixture = ADAPTERS[0].fixture
  const base = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA), '--permission-mode', 'bypassPermissions']
  const persisted = spawnSync(process.execPath, [fixture, ...base, '--no-session-persistence'], {
    input: 'hi',
    encoding: 'utf8'
  })
  assert.equal(persisted.status, 64)
  assert.match(persisted.stderr, /no-session-persistence/)
  const unknown = spawnSync(process.execPath, [fixture, ...base, '--made-up-flag'], { input: 'hi', encoding: 'utf8' })
  assert.equal(unknown.status, 64)
  assert.match(unknown.stderr, /made-up-flag/)
  const ok = spawnSync(process.execPath, [fixture, ...base], { input: 'hi', encoding: 'utf8' })
  assert.equal(ok.status, 0, ok.stderr)
})

// --- the flags behind the probe, and the two pins (design D10) -----------------

const fixtureCommand = flags => [ADAPTERS[0].fixture, ...flags]
const PROMPTS_BANNER =
  'PERMISSION PROMPTS NOT SUPPRESSED (claude): the installed CLI does not list --permission-prompts, so a lane that needs a person waits'

test('probeHelpFlags answers effort and permission prompts from one --help run', () => {
  const probe = flags => probeHelpFlags(process.execPath, fixtureCommand(flags), { cwd: ROOT, env: {}, timeoutMs: 10000 })
  assert.deepEqual(probe([]), { effort: { capability: 'flag', reason: null }, permissionPrompts: 'flag' })
  assert.deepEqual(probe(['--fixture-no-permission-prompts-flag']), {
    effort: { capability: 'flag', reason: null },
    permissionPrompts: 'unsupported'
  })
  assert.deepEqual(probe(['--fixture-no-effort-flag']), {
    effort: { capability: 'unsupported', reason: NO_FLAG_REASON },
    permissionPrompts: 'flag'
  })
  // A probe that cannot answer establishes neither flag.
  assert.deepEqual(probe(['--fixture-help-fails']), {
    effort: { capability: 'unsupported', reason: PROBE_FAILED_REASON },
    permissionPrompts: 'unsupported'
  })
  // probeClaudeEffort keeps its exported answer: the effort half alone.
  const command = flags => [process.execPath, ...fixtureCommand(flags)].join(' ')
  assert.deepEqual(probeClaudeEffort({ INTERLOCK_CLAUDE_COMMAND: command([]) }), { capability: 'flag', reason: null })
  assert.deepEqual(probeClaudeEffort({ INTERLOCK_CLAUDE_COMMAND: command(['--fixture-no-effort-flag']) }), {
    capability: 'unsupported',
    reason: NO_FLAG_REASON
  })
})

test('claudeArgs passes --permission-prompts none only outside bypass mode on a CLI that lists it', () => {
  const build = (permissionMode, permissionPrompts) =>
    claudeArgs(request({ model: 'haiku' }), { model: 'haiku', permissionMode, plugin: '/plugin', permissionPrompts })
  const accept = build('acceptEdits', 'flag')
  const at = accept.indexOf('--permission-mode')
  assert.deepEqual(accept.slice(at, at + 4), ['--permission-mode', 'acceptEdits', '--permission-prompts', 'none'])
  assert.equal(accept.filter(a => a === '--permission-prompts').length, 1)
  for (const [mode, prompts] of [
    ['bypassPermissions', 'flag'],
    [undefined, 'flag'],
    ['acceptEdits', 'unsupported'],
    ['acceptEdits', undefined],
    ['default', null]
  ]) {
    assert.ok(!build(mode, prompts).includes('--permission-prompts'), `${mode} / ${prompts}`)
  }
  // The default mode's argv is the argv every unattended run already sends.
  assert.deepEqual(build(undefined, 'flag'), build('bypassPermissions', 'unsupported'))
})

test('claudeArgs never passes --no-session-persistence, and names the plugin dir whenever it resolves', () => {
  const requests = [
    request(),
    request({ model: 'opus', effort: 'high' }),
    request({ type: '', tools: [] }),
    request({ type: 'interlock:ping', tools: ['Bash'], schema: null }),
    {},
    null
  ]
  let built = 0
  for (const req of requests) {
    for (const permissionMode of [undefined, 'bypassPermissions', 'acceptEdits', 'default', 'plan', 'dontAsk']) {
      for (const permissionPrompts of [undefined, 'flag', 'unsupported']) {
        for (const plugin of [null, '/plugin', '/other plugin']) {
          for (const [model, effort] of [[null, null], ['sonnet', 'low']]) {
            const args = claudeArgs(req, { model, effort, permissionMode, plugin, permissionPrompts })
            built++
            assert.ok(!args.includes('--no-session-persistence'), JSON.stringify(args))
            assert.ok(!args.some(a => /no-session-persistence/.test(a)), JSON.stringify(args))
            if (plugin) {
              const at = args.indexOf('--plugin-dir')
              assert.ok(at !== -1, `--plugin-dir must be passed whenever the plugin resolves: ${JSON.stringify(args)}`)
              assert.equal(args[at + 1], plugin)
            } else {
              assert.ok(!args.includes('--plugin-dir'))
            }
          }
        }
      }
    }
  }
  assert.ok(built > 300, `the matrix built ${built} argvs`)
})

test('the claude adapter source never names --no-session-persistence as an argument', () => {
  // Session persistence is what makes a lane's transcript readable and its
  // session resumable; a flag that disabled it would silently empty both.
  const code = readFileSync(join(ROOT, 'lib', 'host', 'claude-cli.mjs'), 'utf8')
    .split('\n')
    .filter(line => !/^\s*(\/\/|\/?\*)/.test(line))
    .join('\n')
  assert.doesNotMatch(code, /no-session-persistence/)
})

test('claude: outside bypass mode, a CLI without --permission-prompts is bannered once and never sent the flag', async () => {
  const env = { INTERLOCK_CLAUDE_PERMISSION_MODE: 'acceptEdits' }
  const host = hosted(ADAPTERS[0], { fixtureFlags: ['--fixture-no-permission-prompts-flag', '--fixture-echo'], env })
  assert.deepEqual(host.banners, [PROMPTS_BANNER])
  // The fixture rejects the flag on this mode, so a result IS the assertion.
  const first = await host.spawn(request())
  const second = await host.spawn(request())
  assert.ok(first && second, 'the spawns ran without the flag the CLI would have rejected')
  assert.ok(!first.argv.includes('--permission-prompts'))
  assert.equal(host.banners.filter(b => b === PROMPTS_BANNER).length, 1, 'once per host, not once per spawn')

  // Through the registry too: the runner reads the banner off the host it created.
  const viaRegistry = createHost('claude', {
    command: [process.execPath, ADAPTERS[0].fixture, '--fixture-no-permission-prompts-flag'].join(' '),
    cwd: ROOT,
    env
  })
  assert.deepEqual(viaRegistry.banners, [PROMPTS_BANNER])
})

test('claude: a CLI that lists the flag gets it outside bypass mode, and the default mode is not bannered', async () => {
  const accepting = hosted(ADAPTERS[0], {
    fixtureFlags: ['--fixture-echo'],
    env: { INTERLOCK_CLAUDE_PERMISSION_MODE: 'acceptEdits' }
  })
  assert.deepEqual(accepting.banners, [])
  const sent = await accepting.spawn(request())
  assert.equal(sent.permissionPrompts, 'none')
  assert.ok(sent.argv.includes('--plugin-dir'), 'the checkout is the plugin, so it is named')

  const unattended = hosted(ADAPTERS[0], { fixtureFlags: ['--fixture-no-permission-prompts-flag', '--fixture-echo'] })
  assert.deepEqual(unattended.banners, [], 'bypass mode needs no prompt suppression, so nothing degraded')
  const plain = await unattended.spawn(request())
  assert.ok(!plain.argv.includes('--permission-prompts'))
  assert.ok(!plain.argv.includes('--no-session-persistence'))
})

// --- one model matcher, one verdict (design D6; spec: ship/agent-results) -------

test('modelMatches: an alias matches its full id; a prefix and a date stamp are ignored; anything else is exact', () => {
  const table = [
    ['sonnet', 'bedrock.claude-sonnet-5-5', true],
    ['sonnet', 'claude-sonnet-4-5-20250929', true],
    ['claude-sonnet-5-5', 'claude-sonnet-5-5-20261001', true],
    ['claude-sonnet-5-5', 'bedrock.claude-sonnet-5-5', true],
    ['claude-sonnet-5', 'claude-sonnet-5-5', false],
    ['sonnet', 'claude-opus-5-5', false],
    ['Sonnet', 'CLAUDE-SONNET-5-5', true],
    ['haiku', 'bedrock.claude-haiku-4-5', true],
    ['opus', 'claude-opus-5-5', true],
    ['sonnet', '', null],
    ['', 'claude-sonnet-5-5', null],
    [null, 'claude-sonnet-5-5', null],
    ['sonnet', undefined, null]
  ]
  for (const [routed, served, expected] of table) {
    assert.equal(modelMatches(routed, served), expected, `${routed} ⇄ ${served}`)
  }
})

test('modelSubstitution: any unmatched turn substitutes; on the session scope only none-matched does', () => {
  // Turn scope: a fallback that served one turn is a model the plan did not choose.
  assert.deepEqual(
    modelSubstitution('claude-sonnet-5-5', { servedModels: ['claude-sonnet-5-5-20261001', 'claude-sonnet-5'] }),
    { substituted: true, scope: 'turns', ran: ['claude-sonnet-5-5-20261001', 'claude-sonnet-5'] }
  )
  assert.equal(modelSubstitution('Sonnet', { servedModels: ['CLAUDE-SONNET-5-5'] }).substituted, false)
  // Session scope: the host-internal haiku beside the routed model raises nothing.
  const internal = modelSubstitution('sonnet', {
    servedModels: null,
    sessionModels: ['bedrock.claude-sonnet-5', 'bedrock.claude-haiku-4-5']
  })
  assert.equal(internal.substituted, false)
  assert.equal(internal.scope, 'session')
  assert.deepEqual(internal.ran, ['bedrock.claude-sonnet-5', 'bedrock.claude-haiku-4-5'])
  const never = modelSubstitution('sonnet', { sessionModels: ['bedrock.claude-opus-5-5', 'bedrock.claude-haiku-4-5'] })
  assert.equal(never.substituted, true)
  assert.equal(never.scope, 'session')
  // The turn scope wins when both are present, in both directions.
  const turnsClean = modelSubstitution('sonnet', {
    servedModels: ['claude-sonnet-5-5'],
    sessionModels: ['bedrock.claude-opus-5-5']
  })
  assert.equal(turnsClean.substituted, false)
  assert.equal(turnsClean.scope, 'turns')
  const turnsDirty = modelSubstitution('sonnet', {
    servedModels: ['claude-opus-5-5'],
    sessionModels: ['bedrock.claude-sonnet-5']
  })
  assert.equal(turnsDirty.substituted, true)
  assert.equal(turnsDirty.scope, 'turns')
  // Neither observation, or no routed model: nothing is decided.
  for (const [routed, observed] of [
    ['sonnet', {}],
    ['sonnet', { servedModels: null, sessionModels: null }],
    ['sonnet', { servedModels: [], sessionModels: [] }],
    [null, { servedModels: ['claude-opus-5-5'] }],
    ['', { sessionModels: ['bedrock.claude-opus-5-5'] }]
  ]) {
    const verdict = modelSubstitution(routed, observed)
    assert.equal(verdict.substituted, null, JSON.stringify([routed, observed]))
    assert.equal(verdict.scope, null, JSON.stringify([routed, observed]))
  }
})

/** Every executable source under `lib/` and `bin/`: the `.mjs` files and the extensionless `bin/*` executables. */
function sweptSources() {
  const out = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.mjs')) out.push(path)
    }
  }
  walk(join(ROOT, 'lib'))
  for (const entry of readdirSync(join(ROOT, 'bin'), { withFileTypes: true })) {
    if (entry.isFile() && (entry.name.endsWith('.mjs') || !entry.name.includes('.'))) out.push(join(ROOT, 'bin', entry.name))
  }
  return out
}

/** A source with its comment lines removed: a comment that cites the matcher is not a call of it. */
const codeOf = path =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter(line => !/^\s*(\/\/|\/?\*)/.test(line))
    .join('\n')

const countOf = (text, pattern) => (text.match(pattern) || []).length

test('the sweep: modelMatches is called only from modelSubstitution, and modelSubstitution only from its two sites', () => {
  // Design D6: one comparison, one verdict, two readers. A second comparison
  // anywhere in lib/ or bin/ is a second copy of the rule.
  const MATCHES = /\bmodelMatches\s*\(/g
  const SUBSTITUTION = /\bmodelSubstitution\s*\(/g
  const MODEL_MAP = join(ROOT, 'lib', 'host', 'model-map.mjs')
  const RUN = join(ROOT, 'lib', 'run.mjs')
  const sources = sweptSources()
  assert.ok(sources.includes(join(ROOT, 'bin', 'interlock-run')), 'the sweep reads the extensionless executables')

  for (const path of sources) {
    const code = codeOf(path)
    const where = relative(ROOT, path)
    if (path === MODEL_MAP) {
      assert.equal(countOf(code, MATCHES), 1, `${where}: modelMatches appears once — its definition`)
      assert.match(code, /export function modelMatches\(/)
    } else if (path !== RUN) {
      assert.equal(countOf(code, MATCHES), 0, `${where} compares models outside modelSubstitution`)
    }
    if (path !== RUN) assert.equal(countOf(code, SUBSTITUTION), 0, `${where} calls modelSubstitution`)
  }

  const run = codeOf(RUN)
  const start = run.indexOf('export function modelSubstitution(')
  assert.notEqual(start, -1, 'lib/run.mjs defines modelSubstitution')
  const end = run.indexOf('\n}\n', start)
  const body = run.slice(start, end)
  const inside = countOf(body, MATCHES)
  assert.ok(inside >= 1, 'modelSubstitution calls modelMatches')
  assert.equal(countOf(run, MATCHES), inside, 'lib/run.mjs calls modelMatches only inside modelSubstitution')
  // The definition plus exactly two call sites: the runner's record path and
  // the Workflow close's join.
  const calls = countOf(run, SUBSTITUTION) - 1
  assert.equal(calls, 2, `modelSubstitution must have exactly two call sites in lib/run.mjs (found ${calls})`)
})

// --- effort (design D3, D4, D11, D24, D27, D29, D30) --------------------------

const NO_FLAG_REASON = 'this claude CLI has no --effort flag'
const PROBE_FAILED_REASON = 'could not establish whether this claude CLI accepts --effort'
const CODEX_REASON = 'effort is not routed on this host'
const NO_CONTROL_REASON = 'host has no effort control'

/** The argv a fixture echoed, with the per-spawn temp paths blanked so two spawns compare. */
const stableArgv = argv =>
  argv.map((a, i) => (['--output-schema', '-o'].includes(argv[i - 1]) ? '<tmp>' : a))

const effortEvents = events => events.filter(e => e.type === 'effort-routing')

test('claudeArgs pushes --effort directly after the --model pair when given one', () => {
  const args = claudeArgs(request({ model: 'haiku', effort: 'low' }), {
    model: 'haiku',
    effort: 'low',
    permissionMode: 'bypassPermissions',
    plugin: '/plugin'
  })
  const at = args.indexOf('--model')
  assert.deepEqual(args.slice(at, at + 4), ['--model', 'haiku', '--effort', 'low'])
  assert.equal(args.filter(a => a === '--effort').length, 1)
})

test('claudeArgs pushes --effort even when no model resolved, and only that flag changes', () => {
  const base = { model: null, permissionMode: 'bypassPermissions', plugin: null }
  const plain = claudeArgs(request(), base)
  const withEffort = claudeArgs(request({ effort: 'medium' }), { ...base, effort: 'medium' })
  assert.deepEqual(
    withEffort.filter(a => a !== '--effort' && a !== 'medium'),
    plain
  )
  assert.ok(withEffort.includes('--effort'))
})

test('claudeArgs pushes no --effort when given none', () => {
  const args = claudeArgs(request({ model: 'haiku' }), {
    model: 'haiku',
    permissionMode: 'bypassPermissions',
    plugin: '/plugin'
  })
  assert.ok(!args.includes('--effort'))
})

test('claude: a named effort reaches the CLI as the flag and is reported as applied', async () => {
  const events = []
  const host = hosted(ADAPTERS[0], { fixtureFlags: ['--fixture-echo'], onEvent: e => events.push(e) })
  const result = await host.spawn(request({ model: 'haiku', effort: 'low' }))
  assert.equal(result.effort, 'low', 'the CLI received the level unchanged')
  const routed = effortEvents(events)
  assert.equal(routed.length, 1, 'exactly one effort-routing event')
  assert.equal(routed[0].type, 'effort-routing')
  assert.equal(routed[0].label, '1.1')
  assert.equal(routed[0].applied, true)
  assert.equal(routed[0].via, 'flag')
  assert.equal(routed[0].requested, 'low')
  assert.equal(routed[0].value, 'low')
})

test('claude: a level is passed through unvalidated', async () => {
  const host = hosted(ADAPTERS[0], { fixtureFlags: ['--fixture-echo'] })
  const result = await host.spawn(request({ effort: 'whatever-the-table-says' }))
  assert.equal(result.effort, 'whatever-the-table-says')
})

test('claude: the help probe verdict is the host-reported effort capability', () => {
  const flagged = hosted(ADAPTERS[0])
  assert.equal(flagged.capabilities.effort, 'flag')

  const noFlag = hosted(ADAPTERS[0], { fixtureFlags: ['--fixture-no-effort-flag'] })
  assert.equal(noFlag.capabilities.effort, 'unsupported')
})

test('claude: help that only mentions --effort in prose is not a CLI that accepts it', async () => {
  // A substring match would pass the flag, and the CLI would reject every spawn.
  const events = []
  const host = hosted(ADAPTERS[0], {
    fixtureFlags: ['--fixture-effort-in-prose', '--fixture-echo'],
    onEvent: e => events.push(e)
  })
  assert.equal(host.capabilities.effort, 'unsupported')
  const result = await host.spawn(request({ effort: 'low' }))
  assert.ok(result, 'the spawn ran, without the flag the CLI would have rejected')
  assert.ok(!result.argv.includes('--effort'))
  const routed = effortEvents(events)
  assert.equal(routed.length, 1)
  assert.equal(routed[0].applied, false)
  assert.equal(routed[0].reason, NO_FLAG_REASON)
})

test('claude: a CLI without --effort degrades, runs the spawn, and says why', async () => {
  const events = []
  const host = hosted(ADAPTERS[0], {
    fixtureFlags: ['--fixture-no-effort-flag', '--fixture-echo'],
    onEvent: e => events.push(e)
  })
  const result = await host.spawn(request({ effort: 'low' }))
  assert.ok(result, 'the CLI would have rejected --effort; the spawn must not have passed it')
  assert.ok(!result.argv.includes('--effort'))
  assert.equal(result.effort, null)
  const routed = effortEvents(events)
  assert.equal(routed.length, 1)
  assert.equal(routed[0].applied, false)
  assert.equal(routed[0].requested, 'low')
  assert.equal(routed[0].reason, NO_FLAG_REASON)
})

test('claude: a help probe that fails is unsupported, with its own reason, and creation does not throw', async () => {
  const events = []
  let host
  assert.doesNotThrow(() => {
    host = hosted(ADAPTERS[0], {
      fixtureFlags: ['--fixture-help-fails', '--fixture-echo'],
      onEvent: e => events.push(e)
    })
  })
  assert.equal(host.capabilities.effort, 'unsupported')
  const result = await host.spawn(request({ effort: 'low' }))
  assert.ok(result)
  assert.ok(!result.argv.includes('--effort'))
  const routed = effortEvents(events)
  assert.equal(routed.length, 1)
  assert.equal(routed[0].applied, false)
  assert.equal(routed[0].reason, PROBE_FAILED_REASON)
})

test('claude: a help probe that hangs times out to unsupported without throwing', async () => {
  const events = []
  let host
  assert.doesNotThrow(() => {
    host = adaptersCreateWithProbeTimeout(300, ['--fixture-help-hangs', '--fixture-echo'], events)
  })
  assert.equal(host.capabilities.effort, 'unsupported')
  const result = await host.spawn(request({ effort: 'low' }))
  assert.ok(result, 'the spawn itself still runs')
  assert.ok(!result.argv.includes('--effort'))
  const routed = effortEvents(events)
  assert.equal(routed.length, 1)
  assert.equal(routed[0].reason, PROBE_FAILED_REASON)
})

/** A Claude host whose help probe gives up after `ms`. */
function adaptersCreateWithProbeTimeout(ms, fixtureFlags, events) {
  return createClaudeHost({
    command: [process.execPath, ADAPTERS[0].fixture, ...fixtureFlags].join(' '),
    cwd: ROOT,
    env: {},
    probeTimeoutMs: ms,
    onEvent: e => events.push(e)
  })
}

test('createHost("claude") reports the probe verdicts as its effective capability', () => {
  const command = fixtureFlags => [process.execPath, ADAPTERS[0].fixture, ...fixtureFlags].join(' ')
  const make = (fixtureFlags, extra = {}) =>
    createHost('claude', { command: command(fixtureFlags), cwd: ROOT, env: {}, ...extra })
  assert.equal(make([]).capabilities.effort, 'flag')
  assert.equal(make(['--fixture-no-effort-flag']).capabilities.effort, 'unsupported')
  assert.equal(make(['--fixture-help-fails']).capabilities.effort, 'unsupported')
  assert.equal(
    make(['--fixture-help-hangs'], { probeTimeoutMs: 300 }).capabilities.effort,
    'unsupported'
  )
})

test('codex: a named effort leaves argv untouched and emits the not-routed event', async () => {
  const events = []
  const host = hosted(ADAPTERS[1], { fixtureFlags: ['--fixture-echo'], onEvent: e => events.push(e) })
  const named = await host.spawn(request({ effort: 'low' }))
  const routed = effortEvents(events)
  assert.equal(routed.length, 1)
  assert.equal(routed[0].type, 'effort-routing')
  assert.equal(routed[0].label, '1.1')
  assert.equal(routed[0].requested, 'low')
  assert.equal(routed[0].applied, false)
  assert.equal(routed[0].reason, CODEX_REASON)
  assert.notEqual(routed[0].reason, NO_CONTROL_REASON)

  const unnamed = await hosted(ADAPTERS[1], { fixtureFlags: ['--fixture-echo'] }).spawn(request())
  assert.deepEqual(stableArgv(named.argv), stableArgv(unnamed.argv))
})

test('qwen: a named effort leaves argv untouched and emits the no-control event', async () => {
  const events = []
  const host = hosted(ADAPTERS[2], { fixtureFlags: ['--fixture-echo'], onEvent: e => events.push(e) })
  const named = await host.spawn(request({ effort: 'low' }))
  const routed = effortEvents(events)
  assert.equal(routed.length, 1)
  assert.equal(routed[0].requested, 'low')
  assert.equal(routed[0].applied, false)
  assert.equal(routed[0].reason, NO_CONTROL_REASON)

  const unnamed = await hosted(ADAPTERS[2], { fixtureFlags: ['--fixture-echo'] }).spawn(request())
  assert.deepEqual(stableArgv(named.argv), stableArgv(unnamed.argv))
})

for (const adapter of ADAPTERS) {
  test(`${adapter.id}: a spawn naming no effort emits no effort-routing event`, async () => {
    const events = []
    const host = hosted(adapter, { fixtureFlags: ['--fixture-echo'], onEvent: e => events.push(e) })
    await host.spawn(request())
    await host.spawn(request({ effort: null }))
    assert.deepEqual(effortEvents(events), [])
  })

  test(`${adapter.id}: a spawn that never starts is a failed spawn, not a routed effort`, async () => {
    // A lane cwd that does not exist: the process is never created. Counting it
    // as applied (or as unapplied) would put a spawn that did not run into the
    // effort tally.
    const events = []
    const host = hosted(adapter, { fixtureFlags: ['--fixture-echo'], onEvent: e => events.push(e) })
    const missing = join(tmpdir(), `interlock-no-such-lane-${process.pid}-${adapter.id}`)
    const result = await host.spawn(request({ effort: 'low', cwd: missing }))
    assert.equal(result, null)
    assert.deepEqual(effortEvents(events), [])
    assert.equal(events.filter(e => e.type === 'spawn-failed').length, 1, 'it is reported as a failed spawn')
  })

  test(`${adapter.id}: its effort-routing event agrees with its registry declaration`, async () => {
    const events = []
    const host = hosted(adapter, { fixtureFlags: ['--fixture-echo'], onEvent: e => events.push(e) })
    await host.spawn(request({ effort: 'low' }))
    const routed = effortEvents(events)
    assert.equal(routed.length, 1)
    assert.equal(
      routed[0].applied,
      HOSTS[adapter.id].capabilities.effort === 'flag',
      `${adapter.id}: applied must be true exactly where the registry declares flag`
    )
  })
}

// --- opt-in: the installed CLIs ------------------------------------------------

const LIVE = (process.env.INTERLOCK_LIVE_HOSTS || '')
  .split(/[,\s]+/)
  .map(s => s.trim())
  .filter(Boolean)

for (const adapter of ADAPTERS) {
  test(
    `live: the installed ${adapter.id} CLI answers the adapter's argv`,
    { skip: LIVE.includes(adapter.id) ? false : `set INTERLOCK_LIVE_HOSTS=${adapter.id} to run this` },
    async () => {
      const scratch = mkdtempSync(join(tmpdir(), `interlock-live-${adapter.id}-`))
      writeFileSync(join(scratch, 'README.md'), 'hello\n')
      try {
        const host = adapter.create({ cwd: scratch, env: process.env })
        const result = await host.spawn(
          request({
            prompt: 'Reply with ok set to true. Do not use any tools.',
            schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }
          })
        )
        assert.ok(result, `${adapter.id}: the installed CLI returned no structured result`)
        assert.equal(typeof result.ok, 'boolean')
      } finally {
        rmSync(scratch, { recursive: true, force: true })
      }
    }
  )
}

// --- the version probe run start reads (spec: ship/run-program) -------------

test('probeClaudeVersion reads the installed CLI\'s version, and a failed or hung probe is null with a reason', () => {
  const command = flags => [process.execPath, ADAPTERS[0].fixture, ...flags].join(' ')
  const read = probeClaudeVersion({ INTERLOCK_CLAUDE_COMMAND: command(['--fixture-version=2.1.288']) })
  assert.deepEqual(read, { version: '2.1.288', reason: null })

  const failed = probeClaudeVersion({ INTERLOCK_CLAUDE_COMMAND: command(['--fixture-version-fails']) })
  assert.equal(failed.version, null)
  assert.match(failed.reason, /exited|failed/)

  // A CLI that never answers: the probe's own timeout ends it, and it never throws.
  const dir = mkdtempSync(join(tmpdir(), 'interlock-version-hang-'))
  try {
    const hang = join(dir, 'hang.mjs')
    writeFileSync(hang, 'setInterval(() => {}, 1 << 30)\n')
    const hung = probeClaudeVersion({ INTERLOCK_CLAUDE_COMMAND: `${process.execPath} ${hang}` }, { probeTimeoutMs: 300 })
    assert.equal(hung.version, null)
    assert.ok(hung.reason)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  const missing = probeClaudeVersion({ INTERLOCK_CLAUDE_COMMAND: join(ROOT, 'no-such-claude-binary') })
  assert.equal(missing.version, null)
  assert.ok(missing.reason)
})

// --- the runner closes on SIGINT and SIGTERM (spec: run-host-adapters) -------
//
// The real `bin/interlock-run` against the fake CLI, which holds every envelope
// for `--fixture-delay` so a lane is in flight when the signal lands. What is
// read back is what a killed run must leave behind: a `run-halt` that names the
// signal, a resume card, and a non-zero exit.

const RUNNER = join(ROOT, 'bin', 'interlock-run')

/** A temp repo with two path-disjoint tier-4 tasks: one batch of two lanes. */
function signalRepo() {
  const root = mkdtempSync(join(tmpdir(), 'interlock-signal-'))
  const change = 'add-thing'
  const put = (rel, body) => {
    const dest = join(root, rel)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n')
  }
  put(`openspec/changes/${change}/proposal.md`, '# Add thing\n\nWhy: because.\n')
  put(`openspec/changes/${change}/design.md`, '# Design\n\nD1: keep it small.\n')
  put(`openspec/changes/${change}/tasks.md`, '# Tasks\n\n- [ ] 1.1 Write docs/a.md\n- [ ] 1.2 Write docs/b.md\n')
  put('README.md', 'hello\n')
  put('.claude/ship/classified.json', {
    tasks: ['a', 'b'].map((name, i) => ({
      id: `1.${i + 1}`,
      group: 1,
      description: `Write docs/${name}.md`,
      tier: 4,
      model: 'sonnet',
      isTestTask: false,
      paths: [`docs/${name}.md`]
    }))
  })
  for (const args of [['init', '-q', '.'], ['config', 'user.email', 't@example.com'], ['config', 'user.name', 't'], ['add', '-A'], ['commit', '-qm', 'init']]) {
    execFileSync('git', args, { cwd: root })
  }
  return { root, change }
}

/** Start the runner in the background; resolve `exited` with its code and everything it printed. */
function startRunner(root, change, command) {
  const child = spawn(process.execPath, [RUNNER, change, '--host', 'claude', '--no-commit', '--root', '.'], {
    cwd: root,
    env: { ...process.env, CLAUDE_CODE_EFFORT_LEVEL: undefined, INTERLOCK_CLAUDE_COMMAND: command },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    stdout += chunk
  })
  child.stderr.resume()
  const exited = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal, stdout })))
  /** Resolve once stdout matches, or reject after `ms`. */
  const waitFor = (pattern, ms = 60000) =>
    new Promise((resolve, reject) => {
      const started = Date.now()
      const timer = setInterval(() => {
        if (pattern.test(stdout)) {
          clearInterval(timer)
          resolve()
        } else if (Date.now() - started > ms) {
          clearInterval(timer)
          reject(new Error(`runner never printed ${pattern}:\n${stdout}`))
        }
      }, 20)
    })
  return { child, exited, waitFor }
}

/** Every trajectory event the run wrote. */
function eventsOf(root) {
  const dir = join(root, '.claude', 'ship', 'runs')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.jsonl'))
    .flatMap(f => readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)))
}

const shipCommand = flags => [process.execPath, ADAPTERS[0].fixture, '--fixture-ship', ...flags].join(' ')

test('SIGTERM while a lane is in flight closes the run: a run-halt naming it, a resume card, non-zero', async () => {
  const { root, change } = signalRepo()
  try {
    const runner = startRunner(root, change, shipCommand(['--fixture-delay=4000']))
    await runner.waitFor(/run-batch: tasks? 1\.\d/)
    runner.child.kill('SIGTERM')
    const { code, stdout } = await runner.exited
    assert.notEqual(code, 0, `a killed run is not a clean one:\n${stdout}`)
    const halts = eventsOf(root).filter(e => e.type === 'run-halt')
    assert.equal(halts.length, 1, JSON.stringify(halts))
    assert.match(halts[0].reason, /interlock-run received SIGTERM/)
    const cards = existsSync(join(root, '.claude', 'handoff')) ? readdirSync(join(root, '.claude', 'handoff')) : []
    assert.ok(cards.length, `no resume card was written:\n${stdout}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a second signal during the close starts no second close', async () => {
  const { root, change } = signalRepo()
  try {
    const runner = startRunner(root, change, shipCommand(['--fixture-delay=4000']))
    await runner.waitFor(/run-batch: tasks? 1\.\d/)
    runner.child.kill('SIGINT')
    runner.child.kill('SIGTERM')
    const { code, stdout } = await runner.exited
    assert.notEqual(code, 0)
    const halts = eventsOf(root).filter(e => e.type === 'run-halt')
    assert.equal(halts.length, 1, `exactly one close:\n${JSON.stringify(halts)}\n${stdout}`)
    assert.match(halts[0].reason, /interlock-run received SIGINT/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a signal before run start has answered still closes, truthfully, with no manifest', async () => {
  // The window is the adapter's one-time `--help` probe, which runs before
  // `run start` is called: a CLI whose help is slow holds the runner there, and
  // the signal it receives meanwhile is handled at the runner's first await —
  // which is the wait on `run start`. The change resolves to nothing, so `run
  // start` writes no manifest whichever process finishes first.
  const { root } = signalRepo()
  try {
    const ready = join(root, 'help-probed')
    const slowHelp = join(root, 'slow-help.mjs')
    writeFileSync(
      slowHelp,
      `import { writeFileSync } from 'node:fs'\n` +
        `if (process.argv.includes('--help')) {\n` +
        `  writeFileSync(${JSON.stringify(ready)}, 'x')\n` +
        `  setTimeout(() => { process.stdout.write('Usage: claude [options]\\n'); process.exit(0) }, 1500)\n` +
        `} else process.exit(64)\n`
    )
    const runner = startRunner(root, 'no-such-change', `${process.execPath} ${slowHelp}`)
    await new Promise((resolve, reject) => {
      const started = Date.now()
      const timer = setInterval(() => {
        if (existsSync(ready)) {
          clearInterval(timer)
          resolve()
        } else if (Date.now() - started > 30000) {
          clearInterval(timer)
          reject(new Error('the help probe never ran'))
        }
      }, 10)
    })
    runner.child.kill('SIGTERM')
    const { code, signal, stdout } = await runner.exited
    assert.equal(signal, null, 'the runner handled the signal rather than dying of it')
    assert.notEqual(code, 0)
    assert.match(stdout, /SHIP HALTED — interlock-run received SIGTERM/)
    assert.match(stdout, /There is no run manifest/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// --- the host-record channel, end to end (design D7, D9; spec: run-host-adapters) -
//
// The real `bin/interlock-run` over the fake CLI. What the runner sends the CLI
// is observed from inside each `bin/interlock` process it starts: a `--require`
// preload records that process's argv and the two files it was handed, so the
// assertions read the channel itself rather than a copy of the driver's logic.

/** The env a runner child is started with: this process's, minus the knobs a developer may have exported. */
function runnerEnv(extra) {
  const env = {
    ...process.env,
    CLAUDE_CODE_EFFORT_LEVEL: undefined,
    INTERLOCK_CLAUDE_PERMISSION_MODE: undefined,
    [MODEL_MAP_ENV]: undefined,
    ...extra
  }
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined))
}

/**
 * Run the runner to its close in a fresh two-lane repo, with every CLI call it
 * makes recorded. Returns the repo, stdout, and one `{argv, hostRecords,
 * results}` per `bin/interlock` call, in order.
 */
function observedRun({ fixtureFlags, env = {} }) {
  const { root, change } = signalRepo()
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'interlock-host-records-')))
  const preload = join(scratch, 'record-cli-argv.cjs')
  const log = join(scratch, 'cli-calls.jsonl')
  const config = join(scratch, 'claude-config')
  mkdirSync(config)
  writeFileSync(
    preload,
    [
      "const fs = require('node:fs')",
      "const path = require('node:path')",
      "if (/[\\\\/]bin[\\\\/]interlock$/.test(process.argv[1] || '') && process.env.INTERLOCK_TEST_CLI_LOG) {",
      '  const argv = process.argv.slice(2)',
      '  const file = flag => {',
      '    const at = argv.indexOf(flag)',
      '    if (at === -1 || argv[at + 1] === undefined) return null',
      "    try { return JSON.parse(fs.readFileSync(path.resolve(argv[at + 1]), 'utf8')) } catch { return 'unreadable' }",
      '  }',
      "  fs.appendFileSync(process.env.INTERLOCK_TEST_CLI_LOG, JSON.stringify({ argv, hostRecords: file('--host-records'), results: file('--results') }) + '\\n')",
      '}',
      ''
    ].join('\n')
  )
  const ran = spawnSync(process.execPath, [RUNNER, change, '--host', 'claude', '--no-commit', '--root', '.'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180000,
    env: runnerEnv({
      INTERLOCK_CLAUDE_COMMAND: shipCommand(fixtureFlags),
      CLAUDE_CONFIG_DIR: config,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--require', preload].filter(Boolean).join(' '),
      INTERLOCK_TEST_CLI_LOG: log,
      ...env
    })
  })
  const calls = existsSync(log)
    ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
    : []
  return {
    root,
    stdout: ran.stdout || '',
    stderr: ran.stderr || '',
    status: ran.status,
    calls,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true })
      rmSync(scratch, { recursive: true, force: true })
    }
  }
}

let recordsRun = null
/** One runner run shared by the channel tests below, made on first use. */
function hostRecordsRun() {
  if (!recordsRun) {
    recordsRun = observedRun({
      fixtureFlags: ['--fixture-served-model=claude-opus-5-5', '--fixture-denials=Bash,Edit', '--fixture-session=sess-lane-1']
    })
  }
  return recordsRun
}
after(() => {
  if (recordsRun) recordsRun.cleanup()
})

/** Every call that continued a step: everything but `run start` and a halt's own close. */
const continuations = calls => calls.filter(c => c.argv[0] === 'run' && c.argv[1] !== 'start' && !c.argv.includes('--halt'))

test('interlock-run writes the host records beside results.json and passes --host-records on every continuation', () => {
  const run = hostRecordsRun()
  const diagnostic = `\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`
  assert.match(run.stdout, /SHIP COMPLETE|SHIP COMPLETE WITH LEFTOVERS/, `the run must reach its close:${diagnostic}`)
  const steps = continuations(run.calls)
  assert.ok(steps.length >= 3, `the run continued at least three steps: ${JSON.stringify(run.calls.map(c => c.argv.slice(0, 2)))}`)
  for (const call of steps) {
    const at = call.argv.indexOf('--host-records')
    assert.notEqual(at, -1, `a continuation without --host-records: ${call.argv.join(' ')}`)
    assert.equal(call.argv[at + 1], '.claude/ship/host-records.json', 'under the work dir, beside results.json')
    assert.ok(call.argv.includes('--results'), 'beside --results, never instead of it')
    assert.ok(Array.isArray(call.hostRecords), `the records file must be a JSON array: ${JSON.stringify(call.hostRecords)}`)
  }
  assert.ok(existsSync(join(run.root, '.claude', 'ship', 'host-records.json')))

  // The lane batch: one record per lane, carrying the label and the host's fields.
  const batch = steps.find(c => c.argv[1] === 'record-batch')
  assert.ok(batch, `the run recorded a lane batch: ${JSON.stringify(steps.map(c => c.argv.slice(0, 2)))}`)
  assert.equal(batch.hostRecords.length, batch.results.length, 'one host record per spawn')
  assert.equal(batch.hostRecords.length, 2)
  for (const record of batch.hostRecords) {
    assert.match(record.label, /^1\.[12]$/)
    assert.equal(record.parsed, true)
    assert.equal(record.exitCode, 0)
    assert.equal(record.sessionId, 'sess-lane-1')
    assert.deepEqual(record.permissionDenials, { count: 2, tools: ['Bash', 'Edit'] })
    assert.ok(record.sessionModels.includes('claude-opus-5-5'), JSON.stringify(record.sessionModels))
    assert.equal(record.modelRouted, 'sonnet')
    assert.equal(record.servedModels, null, 'no transcript was planted')
    assert.equal(typeof record.transcriptReason, 'string')
  }
})

test('interlock-run keeps the host records out of results.json', () => {
  const run = hostRecordsRun()
  const HOST_ONLY = ['host', 'sessionId', 'permissionDenials', 'sessionModels', 'servedModels', 'modelRouted', 'resultMissing']
  for (const call of continuations(run.calls)) {
    for (const result of Array.isArray(call.results) ? call.results : []) {
      if (!result || typeof result !== 'object') continue
      for (const key of HOST_ONLY) assert.ok(!(key in result), `results.json carries the host field ${key}`)
    }
  }
  const onDisk = JSON.parse(readFileSync(join(run.root, '.claude', 'ship', 'results.json'), 'utf8'))
  assert.ok(!JSON.stringify(onDisk).includes('"host"'))
})

test('the CLI raises the lane banners and agent-result events from the runner\'s host records', () => {
  // The other half of the channel: `bin/interlock` reads --host-records and the
  // record path raises the banner and appends one agent-result per lane.
  const run = hostRecordsRun()
  assert.match(run.stdout, /TOOLS DENIED IN LANE: 1\.[12] 2 \(Bash, Edit\)/, run.stdout)
  const results = eventsOf(run.root).filter(e => e.type === 'agent-result' && e.sessionId === 'sess-lane-1')
  assert.ok(results.length >= 2, `one agent-result per lane: ${JSON.stringify(results)}`)
})

test('interlock-run folds the adapter\'s permission-prompts banner into the close exactly once', () => {
  const run = observedRun({
    fixtureFlags: ['--fixture-no-permission-prompts-flag'],
    env: { INTERLOCK_CLAUDE_PERMISSION_MODE: 'acceptEdits' }
  })
  try {
    assert.match(run.stdout, /SHIP COMPLETE|SHIP COMPLETE WITH LEFTOVERS/, `${run.stdout}\n${run.stderr}`)
    assert.equal(run.stdout.split(PROMPTS_BANNER).length - 1, 1, run.stdout)
    const banners = JSON.parse(readFileSync(join(run.root, '.claude', 'ship', 'host-banners.json'), 'utf8'))
    assert.equal(banners.filter(b => b === PROMPTS_BANNER).length, 1)
  } finally {
    run.cleanup()
  }
})

// --- the driver decides nothing from a host record (spec: run-host-adapters) -----

test('the runner states no lane banner and compares no model: the CLI decides both', () => {
  // The no-policy sweep's lane-banner half (test/workflows.test.mjs holds the
  // rest). Comment lines are not swept: citing where a rule lives is not
  // stating it.
  const driver = readFileSync(RUNNER, 'utf8').replace(/^\s*\/\/.*$/gm, '')
  for (const [what, token] of [
    ['the lane-stopped banner', /LANE STOPPED BY HOST/],
    ['the schema-result banner', /SCHEMA RESULT MISSING/],
    ['the tools-denied banner', /TOOLS DENIED IN LANE/],
    ['the substitution banner', /MODEL SUBSTITUTED/],
    ['the model matcher', /\bmodelMatches\s*\(/],
    ['the substitution verdict', /\bmodelSubstitution\s*\(/],
    ['a host record field read as a verdict', /servedModels|sessionModels|resultMissing|permissionDenials/]
  ]) {
    assert.doesNotMatch(driver, token, `bin/interlock-run states ${what} (${token}) — it belongs in lib/run.mjs`)
  }
})
