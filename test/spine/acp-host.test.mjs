// The ACP adapter, on the wire (add-interlock-acp-host §3).
//
// Two layers, deliberately separated:
//
//   default        a fixture agent under test/fixtures/acp/ that speaks the
//                  protocol and nothing else. It proves framing, the handshake,
//                  session-per-spawn, permission answering and null-on-failure
//                  without a model, a network or an API key.
//   opt-in         one test against the user's real agent, gated on
//                  INTERLOCK_ACP_COMMAND. `npm test` skips it, because a
//                  suite that needs a live coding agent is a suite nobody runs.
//
// The fixture is handed to `createAcpHost({ command })` explicitly rather than
// through the environment, so setting INTERLOCK_ACP_COMMAND stays a meaningful
// signal that a real agent is available.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACP_COMMAND_ENV,
  ACP_MODEL_MAP_ENV,
  ACP_PROTOCOL_VERSION,
  createAcpHost,
  formatSpawnPrompt,
  parseAcpCommand,
  pickModelValue,
  isClaudeCodeBinary,
  spawnArgsForAgent
} from '../../lib/host/acp.mjs'
// The map moved to the runner's published one when ACP became one host among
// four (`promote-interlock-run-with-host-adapters`, design D6).
// `INTERLOCK_ACP_MODEL_MAP` is its `acp` entry and still parses, still throws,
// and still names itself in the error.
import { parseModelMap } from '../../lib/host/model-map.mjs'
import { HOST_PORTS } from '../../lib/host.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FIXTURE = join(ROOT, 'test', 'fixtures', 'acp', 'agent.mjs')

const fixtureHost = (flags = '', opts = {}) =>
  createAcpHost({
    command: `${process.execPath} ${FIXTURE}${flags ? ` ${flags}` : ''}`,
    cwd: ROOT,
    timeoutMs: 20000,
    ...opts
  })

test('the ACP host implements the port and negotiates its model per session', () => {
  const host = fixtureHost()
  for (const port of HOST_PORTS) assert.equal(typeof host[port], 'function', `missing ${port}`)
  // It used to say `modelRoutingSupported: false`, whose meaning was "never" —
  // the driver bannered unconditionally off that one boolean. Routing is now a
  // per-session negotiation whose outcome is a per-spawn event, so the flag says
  // which mechanism is in play and the events say what happened.
  assert.equal(host.modelRouting, 'negotiated')
  assert.equal(host.modelRoutingSupported, undefined, 'the boolean is gone, not shadowed')
  assert.equal(ACP_PROTOCOL_VERSION, 1)
})

test('a spawn is one process, one session, one prompt turn', async () => {
  const host = fixtureHost()
  const result = await host.spawn({
    label: '1.1',
    prompt: 'implement task 1.1',
    model: 'sonnet',
    schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } }
  })

  assert.ok(result, 'the fixture agent replied but the host produced no result')
  assert.equal(result.ok, true)
  assert.equal(result.sawSchemaInstruction, true, 'the schema must travel in the prompt text')
  assert.equal(result.sawModelMeta, true, 'the planner model slug rides in _meta')
  assert.equal(result.model, 'sonnet')
  assert.match(result.sessionId, /^sess-/)
})

test('a batch gets a fresh agent process each, not a shared session', async () => {
  // "One agent per task" is the isolation mechanism. A host that reused one
  // session would hand task 3 everything tasks 1 and 2 said.
  const host = fixtureHost()
  const tasks = [{ id: '1.1' }, { id: '1.2' }, { id: '1.3' }]
  const results = await host.mapPipeline(tasks, task =>
    host.spawn({ label: task.id, prompt: `implement ${task.id}`, schema: { type: 'object' } })
  )

  assert.equal(results.length, 3)
  const pids = new Set(results.map(r => r.pid))
  const sessions = new Set(results.map(r => r.sessionId))
  assert.equal(pids.size, 3, 'each spawn must be its own agent process')
  assert.equal(sessions.size, 3, 'each spawn must be its own session')
})

test('a permission request is answered allow_always, not left hanging', async () => {
  // The run is unattended by contract. A driver that stalled on a permission
  // prompt would break the same promise `disallowed-tools: AskUserQuestion`
  // keeps on the Claude Code side.
  const host = fixtureHost('--permission')
  const result = await host.spawn({ label: 'commit', prompt: 'write a file', schema: { type: 'object' } })
  assert.ok(result)
  assert.equal(result.permissionOptionId, 'always')
})

test('prose around the JSON still yields a result', async () => {
  const host = fixtureHost('--prose')
  const result = await host.spawn({ label: '1.1', prompt: 'implement it', schema: { type: 'object' } })
  assert.ok(result, 'a chatty agent must not cost the run a task')
  assert.equal(result.ok, true)
})

test('a refusal and a dead agent both resolve to null, never a throw', async () => {
  const events = []
  const refusing = fixtureHost('--refuse', { onEvent: e => events.push(e) })
  assert.equal(await refusing.spawn({ label: '1.1', prompt: 'do it' }), null)
  assert.ok(
    events.some(e => e.type === 'spawn-done' && e.stopReason === 'refusal'),
    'a refusal must be visible to the caller as an event'
  )

  const dead = fixtureHost('--die')
  assert.equal(await dead.spawn({ label: '1.2', prompt: 'do it' }), null)

  const missing = createAcpHost({ command: 'interlock-no-such-acp-agent-xyz', cwd: ROOT, timeoutMs: 5000 })
  assert.equal(await missing.spawn({ label: '1.3', prompt: 'do it' }), null)
})

test('the ACP host still asks the CLI for policy', async () => {
  // The whole point of the adapter: swapping the spawn does not swap the rules.
  const dir = mkdtempSync(join(tmpdir(), 'interlock-acp-'))
  try {
    const host = fixtureHost('', { cwd: dir })
    const bad = await host.runCli(['wave-state', 'next', '--state', join(dir, 'nope.json'), '--json'])
    assert.equal(bad.code, 1)
    const limits = await host.runCli(['limits', '--json'])
    assert.equal(limits.code, 0, limits.stderr)
    assert.ok(JSON.parse(limits.stdout), 'the host must reach the real policy engine')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('parseAcpCommand handles quotes and refuses an empty command', () => {
  assert.deepEqual(parseAcpCommand('claude-code-acp'), { command: 'claude-code-acp', args: [] })
  assert.deepEqual(parseAcpCommand('  npx  my-agent --acp  '), {
    command: 'npx',
    args: ['my-agent', '--acp']
  })
  assert.deepEqual(parseAcpCommand('agent --flag "two words" \'and more\''), {
    command: 'agent',
    args: ['--flag', 'two words', 'and more']
  })
  assert.throws(() => parseAcpCommand(''), new RegExp(ACP_COMMAND_ENV))
  assert.throws(() => parseAcpCommand(undefined), new RegExp(ACP_COMMAND_ENV))
  assert.throws(() => parseAcpCommand('agent "unterminated'), /unterminated/)
})

test('spawnArgsForAgent forwards --agent only for the Claude Code CLI', () => {
  assert.equal(isClaudeCodeBinary('claude'), true)
  assert.equal(isClaudeCodeBinary('/usr/local/bin/claude-code'), true)
  assert.equal(isClaudeCodeBinary('claude.exe'), true)
  assert.equal(isClaudeCodeBinary('npx'), false)
  assert.equal(isClaudeCodeBinary('claude-code-acp'), false)

  assert.deepEqual(spawnArgsForAgent({ command: 'claude', args: ['--acp'] }, 'interlock:ping'), [
    '--agent',
    'interlock:ping',
    '--acp'
  ])
  assert.deepEqual(spawnArgsForAgent({ command: 'npx', args: ['some-acp-agent', '--acp'] }, 'interlock:worker'), [
    'some-acp-agent',
    '--acp'
  ])
  assert.deepEqual(
    spawnArgsForAgent({ command: 'claude', args: ['--agent', 'other', '--acp'] }, 'interlock:ping'),
    ['--agent', 'other', '--acp']
  )
  assert.deepEqual(spawnArgsForAgent({ command: 'claude', args: ['--acp'] }, ''), ['--acp'])
  assert.deepEqual(spawnArgsForAgent({ command: 'claude', args: ['--acp'] }, undefined), ['--acp'])
})

test('formatSpawnPrompt adds a result contract only when there is a schema', () => {
  assert.equal(formatSpawnPrompt({ prompt: 'just do it' }), 'just do it')
  const withSchema = formatSpawnPrompt({ prompt: 'do it', schema: { type: 'object' } })
  assert.match(withSchema, /^do it/, 'the caller owns the prompt; the host only appends')
  assert.match(withSchema, /reply with a single JSON object/)
  assert.match(withSchema, /"type":"object"/)
})

// --- model routing (spec: workflow-host) ------------------------------------
//
// The tier ladder is most of the cost story, and on this host it is a
// negotiation rather than a parameter: the agent says which models it has, the
// adapter picks one by rule, and every spawn reports which way it went. What is
// asserted below is both halves — the routing EVENT the driver banners from, and
// the `appliedModel` the fixture agent actually received, because an adapter
// that reported `applied: true` without sending anything would pass on the
// event alone.

/** Spawn once against a fixture mode and return the result plus its routing events. */
async function routed(flags, req, opts = {}) {
  const events = []
  const host = fixtureHost(flags, { onEvent: e => events.push(e), ...opts })
  const result = await host.spawn({ prompt: 'do it', schema: { type: 'object' }, ...req })
  return { result, routing: events.filter(e => e.type === 'model-routing') }
}

test('an advertised model option is applied with set_config_option before the prompt', async () => {
  const { result, routing } = await routed('--config-options', { label: '1.1', model: 'sonnet' })

  assert.equal(routing.length, 1, 'one routing event per spawn that carried a model')
  assert.deepEqual(routing[0], {
    type: 'model-routing',
    label: '1.1',
    requested: 'sonnet',
    applied: true,
    via: 'set_config_option',
    value: 'sonnet',
    reason: null
  })
  // What the agent saw, not what the adapter said about itself.
  assert.equal(result.appliedModel, 'sonnet')
  assert.equal(result.appliedVia, 'set_config_option')
  // And the hint keeps travelling for agents that honour it (design D6).
  assert.equal(result.model, 'sonnet', 'the _meta hint is not dropped once the option works')
})

test('a rejected config option falls back to set_model once', async () => {
  const { result, routing } = await routed('--config-error', { label: '2.1', model: 'opus' })

  assert.equal(routing[0].applied, true)
  assert.equal(routing[0].via, 'set_model')
  assert.equal(routing[0].value, 'opus')
  assert.equal(result.appliedModel, 'opus')
  assert.equal(result.appliedVia, 'set_model')
})

test('an agent advertising nothing but accepting set_model is routed by the legacy method', async () => {
  const { result, routing } = await routed('--set-model', { label: '3.1', model: 'haiku' })

  assert.equal(routing[0].applied, true)
  assert.equal(routing[0].via, 'set_model')
  assert.equal(result.appliedModel, 'haiku', 'the raw slug is what a pre-config-options agent gets')
})

test('an agent that advertises nothing and refuses set_model costs the run nothing but a reason', async () => {
  // The delta's failure scenario. The prompt must still run: a model that could
  // not be set is a degradation to report, not a lane to lose.
  const { result, routing } = await routed('', { label: '1.1', model: 'haiku' })

  assert.deepEqual(routing[0], {
    type: 'model-routing',
    label: '1.1',
    requested: 'haiku',
    applied: false,
    via: null,
    value: null,
    reason: 'no model option advertised'
  })
  assert.ok(result, 'the prompt still runs and the spawn returns the agent result')
  assert.equal(result.ok, true)
  assert.equal(result.appliedModel, null)
})

test('a slug no advertised value contains is not applied, and never guessed', async () => {
  // The delta's edge case. The fixture advertises haiku/sonnet/opus/x-large;
  // `nano` matches none of them by value or by display name.
  const { result, routing } = await routed('--config-options', { label: '4.1', model: 'nano' })

  assert.equal(routing[0].applied, false)
  assert.equal(routing[0].reason, 'slug not among advertised values')
  assert.equal(routing[0].value, null)
  assert.equal(result.appliedModel, null, 'a nearest match would have been a silently wrong model')
})

test('INTERLOCK_ACP_MODEL_MAP names a value the slugs could not reach', async () => {
  // `x-large` is advertised by display name only, so no value rule reaches it.
  const { result, routing } = await routed(
    '--config-options',
    { label: '5.1', model: 'sonnet' },
    { env: { ...process.env, [ACP_MODEL_MAP_ENV]: '{"sonnet":"x-large"}' } }
  )

  assert.equal(routing[0].applied, true)
  assert.equal(routing[0].value, 'x-large')
  assert.equal(result.appliedModel, 'x-large', 'the mapped value is what the agent received')
})

test('a map naming a value the agent does not advertise is refused, not sent', async () => {
  const { result, routing } = await routed(
    '--config-options',
    { label: '6.1', model: 'sonnet' },
    { env: { ...process.env, [ACP_MODEL_MAP_ENV]: '{"sonnet":"gpt-b"}' } }
  )

  assert.equal(routing[0].applied, false)
  assert.equal(routing[0].reason, 'mapped value not advertised')
  assert.equal(result.appliedModel, null)
})

test('a spawn with no model negotiates nothing and emits no routing event', async () => {
  const { routing } = await routed('--config-options', { label: '7.1' })
  assert.deepEqual(routing, [], 'the event is per spawn that CARRIED a model')
})

test('a malformed model map fails createAcpHost, not a wave three deep', async () => {
  const bad = raw => () =>
    createAcpHost({ command: 'agent', cwd: ROOT, env: { [ACP_MODEL_MAP_ENV]: raw } })

  assert.throws(bad('{not json'), new RegExp(ACP_MODEL_MAP_ENV))
  assert.throws(bad('["sonnet"]'), /JSON object/)
  assert.throws(bad('"sonnet"'), /JSON object/)
  assert.throws(bad('{"sonnet": 4}'), /non-empty string/)
  assert.throws(bad('{"sonnet": ""}'), /non-empty string/)

  // And the absent / empty cases are not errors: the map is optional.
  assert.deepEqual(parseModelMap({}), {})
  assert.deepEqual(parseModelMap({ [ACP_MODEL_MAP_ENV]: '' }), {})
  assert.deepEqual(parseModelMap({ [ACP_MODEL_MAP_ENV]: '   ' }), {})
  // The legacy variable lands as the `acp` entry of the published map, which is
  // what `createAcpHost` reads — the alias, not a second table.
  assert.deepEqual(parseModelMap({ [ACP_MODEL_MAP_ENV]: '{"sonnet":"x-large"}' }), {
    acp: { sonnet: 'x-large' }
  })
})

test('pickModelValue matches by map, then value, then name — and otherwise not at all', () => {
  const option = {
    id: 'model',
    options: [
      { value: 'claude-sonnet-4', name: 'Sonnet 4' },
      { value: 'claude-sonnet-4-5', name: 'Sonnet 4.5' },
      { value: 'x-large', name: 'Claude OPUS' },
      { value: 'haiku', name: 'Haiku' }
    ]
  }

  // Exact value wins over any substring.
  assert.deepEqual(pickModelValue('haiku', option), { value: 'haiku', reason: null })
  // Substring on the value, first advertised wins deterministically.
  assert.deepEqual(pickModelValue('sonnet', option), { value: 'claude-sonnet-4', reason: null })
  // Substring on the display name, case-insensitively on both sides.
  assert.deepEqual(pickModelValue('opus', option), { value: 'x-large', reason: null })
  assert.deepEqual(pickModelValue('OPUS', option), { value: 'x-large', reason: null })
  assert.deepEqual(pickModelValue('Sonnet', option), { value: 'claude-sonnet-4', reason: null })
  // The map outranks both rules, and is still checked against what is advertised.
  assert.deepEqual(pickModelValue('sonnet', option, { sonnet: 'claude-sonnet-4-5' }), {
    value: 'claude-sonnet-4-5',
    reason: null
  })
  assert.deepEqual(pickModelValue('sonnet', option, { sonnet: 'gpt-b' }), {
    value: null,
    reason: 'mapped value not advertised'
  })
  // A map entry for another slug does not touch this one.
  assert.deepEqual(pickModelValue('haiku', option, { sonnet: 'gpt-b' }), { value: 'haiku', reason: null })
  // No rule matched, and no nearest match exists.
  assert.deepEqual(pickModelValue('nano', option), {
    value: null,
    reason: 'slug not among advertised values'
  })
  // Nothing to pick from at all.
  for (const empty of [null, undefined, {}, { options: [] }, { options: 'nope' }]) {
    assert.deepEqual(pickModelValue('sonnet', empty), {
      value: null,
      reason: 'no model option advertised'
    })
  }
  assert.deepEqual(pickModelValue('', option), { value: null, reason: 'no model requested' })
  assert.deepEqual(pickModelValue(undefined, option), { value: null, reason: 'no model requested' })
})

// --- the driver's solo briefing (spec: solo-mode, implementer-prompts) ------
//
// Both hosts share ONE assembler, loaded out of ship.js source between markers,
// so a solo lane is briefed identically wherever it runs. What each host owns is
// telling the assembler which mode its own loop is running under — and the ACP
// driver forgetting that field would brief a solo agent as an ordinary lane,
// silently, with every fixture still green.

test('the ACP driver takes no shape flag and briefs no lane of its own', () => {
  // Both hosts used to share ONE assembler, loaded out of ship.js source
  // between markers, and each owned telling it which mode its own loop was
  // running under — a driver that forgot the field would brief a solo agent as
  // an ordinary lane, silently, with every fixture still green.
  //
  // Neither host tells the assembler anything now. The CLI reads the mode off
  // the step the state machine emitted, assembles the briefing, and puts it on
  // the spawn. So what is asserted here is that the driver holds none of it.
  const driver = readFileSync(join(ROOT, 'bin', 'interlock-run'), 'utf8')
  assert.doesNotMatch(
    driver,
    /assembleImplementerPrompt|next\.mode|const solo\b/,
    'the driver does not assemble a briefing, so it has no mode to supply'
  )
  assert.doesNotMatch(
    driver,
    /--solo\b|\blaneMode\b/,
    'and it takes no shape flag of its own: the planner decides the mode'
  )
  assert.match(driver, /prompt: s\.prompt,/, 'it sends the briefing the step handed it')
})

// --- opt-in: a live agent ---------------------------------------------------

test(
  'a live ACP agent answers a trivial prompt',
  {
    skip: process.env[ACP_COMMAND_ENV]
      ? false
      : `set ${ACP_COMMAND_ENV} to run this against a real ACP agent`
  },
  async () => {
    const host = createAcpHost({ cwd: ROOT })
    const result = await host.spawn({
      label: 'acp-smoke',
      prompt:
        'Reply with the JSON object {"ok": true} and nothing else. Do not read or write any files.',
      schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } }
    })
    assert.ok(result, `no parseable result from ${host.command}`)
    assert.equal(result.ok, true)
  }
)

// --- the driver, end to end (spec: workflow-host) ---------------------------
//
// Everything above tests the adapter. This drives `bin/interlock-ship-acp`
// itself, against the fixture agent in `--ship` mode and a real temp
// repository, because the property the workflow-host spec states is about the
// DRIVER: it must reach the strict tail's steps and close on the run's own
// verdict rather than refusing a flag. It exited `2` on `--strict` until
// `emit-strict-tail-from-cli`, so an exit code is the assertion.

const ACP_DRIVER_BIN = join(ROOT, 'bin', 'interlock-ship-acp')

function shipRepo() {
  const root = mkdtempSync(join(tmpdir(), 'interlock-acp-ship-'))
  const change = 'add-thing'
  const base = `openspec/changes/${change}`
  const put = (rel, body) => {
    const dest = join(root, rel)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n')
  }
  put(`${base}/proposal.md`, '# Add thing\n\nWhy: because.\n')
  put(`${base}/design.md`, '# Design\n\nD1: keep it small.\n')
  put(`${base}/tasks.md`, '# Tasks\n\n- [ ] 1.1 Note it in README.md\n')
  put('README.md', 'hello\n')
  // The classify step's continuation reads this; the fixture agent answers
  // agents, not files, exactly as the Workflow harness does.
  put('.claude/ship/classified.json', {
    tasks: [
      {
        id: '1.1',
        group: 1,
        description: 'Note it in README.md',
        tier: 2,
        model: 'sonnet',
        isTestTask: false,
        paths: ['README.md']
      }
    ]
  })
  execFileSync('git', ['init', '-q', '.'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: root })
  execFileSync('git', ['add', '-A'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root })
  return { root, change }
}

test('interlock-ship-acp --strict runs the tail and never exits 2', () => {
  const { root, change } = shipRepo()
  try {
    let stdout = ''
    let code = 0
    try {
      stdout = execFileSync(
        process.execPath,
        [ACP_DRIVER_BIN, change, '--strict', '--no-commit', '--root', '.'],
        {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 120000,
          env: {
            ...process.env,
            [ACP_COMMAND_ENV]: `${process.execPath} ${FIXTURE} --ship`
          }
        }
      )
    } catch (err) {
      code = err.status === undefined ? 1 : err.status
      stdout = err.stdout || ''
    }

    assert.notEqual(code, 2, `the driver refused the invocation:\n${stdout}`)
    assert.ok(code === 0 || code === 1, `expected the run's own verdict, got ${code}:\n${stdout}`)

    // The steps it logged. `review` and `handoff` are the ones that used to be
    // unreachable here; `remediate-1` proves the round budget reached this host
    // as a step rather than as a refusal.
    assert.match(stdout, /review: review/, `no review step:\n${stdout}`)
    assert.match(stdout, /handoff: handoff/, `no handoff step:\n${stdout}`)
    assert.match(stdout, /remediate: remediate-1/, `no remediation round:\n${stdout}`)
    // And it closed through the CLI's own summary, which is where a strict run
    // reports what it found.
    assert.match(stdout, /SHIP (COMPLETE|HALTED)/)
    assert.doesNotMatch(stdout, /LEAN SHIP/, 'a strict run must not report skipping the tail')

    // The CLI adjudicated the files the fixture wrote, and recorded the ladder
    // entry itself — no agent was asked for either.
    const manifest = JSON.parse(readFileSync(join(root, '.claude/ship/run.json'), 'utf8'))
    assert.equal(manifest.review.counts.raised, 2)
    assert.ok(manifest.autonomy, 'a strict run records the review-code outcome at close')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
