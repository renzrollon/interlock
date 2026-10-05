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

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { claudeArgs, createClaudeHost, probeClaudeVersion, readClaudeEnvelope } from '../../lib/host/claude-cli.mjs'
import { codexArgs, createCodexHost, onChatGptPlan, readCodexUsage } from '../../lib/host/codex.mjs'
import { createQwenHost, qwenArgs, readQwenEnvelope } from '../../lib/host/qwen.mjs'
import { HOSTS, createHost } from '../../lib/host/registry.mjs'
import { MODEL_MAP_ENV, parseModelMap, resolveModel } from '../../lib/host/model-map.mjs'

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
  assert.deepEqual(readClaudeEnvelope('{"structured_output":{"ok":true},"usage":{"output_tokens":5}}'), {
    result: { ok: true },
    usage: { inputTokens: undefined, outputTokens: 5 }
  })
  assert.deepEqual(readClaudeEnvelope('not json'), { result: null, usage: null })
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
    await runner.waitFor(/run-batch: 1\.\d/)
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
    await runner.waitFor(/run-batch: 1\.\d/)
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
