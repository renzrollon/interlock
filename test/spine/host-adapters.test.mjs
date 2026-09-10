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
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { claudeArgs, createClaudeHost, readClaudeEnvelope } from '../../lib/host/claude-cli.mjs'
import { codexArgs, createCodexHost, onChatGptPlan, readCodexUsage } from '../../lib/host/codex.mjs'
import { createQwenHost, qwenArgs, readQwenEnvelope } from '../../lib/host/qwen.mjs'
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
