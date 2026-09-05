// The ACP host adapter (add-interlock-acp-host §3).
//
// This is the second implementation of the three-function port in
// `lib/host.mjs`, and it is an adapter — not a harness. It speaks the Agent
// Client Protocol to a user-configured agent process so that `spawn` can reach
// a model outside Claude Code. It does not own a session store, an event bus, a
// plugin registry or a message history: the loop lives in
// `bin/interlock-ship-acp`, the rules live in `bin/interlock`, and this file's
// entire job is "prompt in, JSON out".
//
// Protocol facts this file depends on, from the ACP v1 schema:
//
//   transport   JSON-RPC 2.0 over stdio, one message per line, no embedded \n
//   handshake   initialize { protocolVersion, clientCapabilities }
//   session     session/new { cwd, mcpServers } -> { sessionId, configOptions? }
//   config      session/set_config_option { sessionId, configId, value }; the
//               legacy session/set_model { sessionId, modelId } is still
//               accepted by agents that predate config options
//   turn        session/prompt { sessionId, prompt: [ContentBlock] } -> { stopReason }
//   output      session/update notification, update.sessionUpdate =
//               "agent_message_chunk", update.content = { type: "text", text }
//   permission  session/request_permission { sessionId, toolCall, options },
//               answered with { outcome: { outcome: "selected", optionId } }
//
// One agent per task means one *process* per task here, not merely one session.
// A fresh subprocess is the cheapest honest way to get a fresh context, and it
// removes any question about whether a given agent implementation tolerates
// concurrent prompt turns across sessions — `mapPipeline` runs a whole batch at
// once, and that width is the planner's decision, not something this adapter
// gets to renegotiate.
//
// Two capabilities are declared false on purpose: `fs` and `terminal`. Routing
// the agent's file reads and shell commands back through this driver would make
// the driver a sandbox host, which is exactly the architecture this change is
// not adopting. The agent uses its own tools in its own working directory.

import { spawn as spawnProcess } from 'node:child_process'
import { basename } from 'node:path'
import { mapPipeline, parseAgentJson, runCli, assertWorkflowHost } from '../host.mjs'
import { ACP_MODEL_MAP_ENV, parseModelMap } from './model-map.mjs'

/** Where the user names their ACP agent, e.g. `claude-code-acp` or `gemini --acp`. */
export const ACP_COMMAND_ENV = 'INTERLOCK_ACP_COMMAND'

/** Optional per-agent wall clock, in ms. 0 disables it. */
export const ACP_TIMEOUT_ENV = 'INTERLOCK_ACP_TIMEOUT_MS'

/**
 * The ACP-only model map, kept as an alias of the runner's published one
 * (`INTERLOCK_MODEL_MAP`'s `acp` entry). Re-exported here because this adapter's
 * own tests and error messages name it, and an operator who set it before the
 * runner existed keeps working (design D6).
 */
export { ACP_MODEL_MAP_ENV }

/** Latest ACP major version this adapter implements. */
export const ACP_PROTOCOL_VERSION = 1

/**
 * A transport timeout, not a loop cap. Every number the *loop* obeys lives in
 * `lib/limits.mjs` and is published by `interlock limits`; this one only decides
 * how long to wait for a subprocess that has stopped talking, and a run that
 * waits forever for a wedged agent is a run nobody can report on.
 */
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

/**
 * Split a shell-ish command string into argv. Handles single and double quotes,
 * which is enough for `npx some-acp-agent --flag "with space"`; anything needing
 * a real shell (pipes, substitution) should be put in a wrapper script rather
 * than parsed here.
 *
 * @param {string} raw
 * @returns {{ command: string, args: string[] }}
 */
export function parseAcpCommand(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) {
    throw new Error(
      `${ACP_COMMAND_ENV} is not set — the ACP host needs a command that speaks ACP on stdio`
    )
  }
  const tokens = []
  let current = ''
  let quote = null
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (quote) throw new Error(`${ACP_COMMAND_ENV} has an unterminated ${quote} quote`)
  if (current) tokens.push(current)
  return { command: tokens[0], args: tokens.slice(1) }
}

/**
 * True when `command` is a Claude Code CLI binary that accepts `--agent`.
 * Wrappers (`npx`, `claude-code-acp`) are other ACP agents and are left alone.
 *
 * @param {string} command
 * @returns {boolean}
 */
export function isClaudeCodeBinary(command) {
  if (typeof command !== 'string' || !command) return false
  const base = basename(command).replace(/\.exe$/i, '')
  return base === 'claude' || base === 'claude-code'
}

/**
 * Prepend `--agent <type>` when the ACP command is Claude Code and the spawn
 * named a plugin agent. Other agents ignore `type`. An existing `--agent` on
 * the configured command wins — the operator's flag is not overridden.
 *
 * @param {{ command?: string, args?: string[] }} parsed
 * @param {string} [type]
 * @returns {string[]}
 */
export function spawnArgsForAgent(parsed, type) {
  const args = Array.isArray(parsed && parsed.args) ? [...parsed.args] : []
  if (typeof type !== 'string' || !type.trim()) return args
  if (!isClaudeCodeBinary(parsed && parsed.command)) return args
  if (args.some(a => a === '--agent' || (typeof a === 'string' && a.startsWith('--agent=')))) {
    return args
  }
  return ['--agent', type.trim(), ...args]
}

/**
 * Restate the result contract in the prompt. The workflow runtime enforces a
 * schema on `agent()`; ACP has no equivalent, so the schema travels as text and
 * `parseAgentJson` does the recovering. This adds nothing to the prompt the
 * caller built — the tier ladder, the tool-economy rules and the handoff
 * contract all belong to the caller — it only says how to answer.
 *
 * @param {{ prompt: string, schema?: object, label?: string }} req
 * @returns {string}
 */
export function formatSpawnPrompt(req) {
  const prompt = req && typeof req.prompt === 'string' ? req.prompt : ''
  if (!req || !req.schema) return prompt
  return (
    `${prompt}\n\n` +
    `RESULT — reply with a single JSON object and nothing else. No prose before or after it, ` +
    `no code fence. It must satisfy this JSON Schema:\n` +
    `${JSON.stringify(req.schema)}\n` +
    `If you could not do the work, still return the object and say so in its fields.`
  )
}

// --- model negotiation ------------------------------------------------------

/**
 * The advertised model option, if the agent advertises one.
 *
 * ACP does not mandate an id, so both the conventional `model` id and the
 * `model` category count. Anything else — the permission `mode` option in
 * particular — is left alone (design D5).
 *
 * @param {unknown} configOptions
 * @returns {object | null}
 */
function findModelOption(configOptions) {
  const list = Array.isArray(configOptions) ? configOptions : []
  return list.find(o => o && typeof o === 'object' && (o.id === 'model' || o.category === 'model')) || null
}

/**
 * Choose which advertised value a planner slug means — exactly, or not at all.
 *
 * The order is the whole decision (design D2): an operator's map, then an exact
 * `value`, then the first option whose `value` or display `name` contains the
 * slug case-insensitively. Never a nearest match and never a default, because a
 * wrong model that ran is invisible in a summary and a banner is not.
 *
 * @param {string} slug                 the planner's model, e.g. `sonnet`
 * @param {object | null} option        the advertised model option
 * @param {Record<string, string>} [map] {@link ACP_MODEL_MAP_ENV}, already parsed
 * @returns {{ value: string | null, reason: string | null }}
 */
export function pickModelValue(slug, option, map = {}) {
  const wanted = typeof slug === 'string' ? slug.trim() : ''
  if (!wanted) return { value: null, reason: 'no model requested' }

  const advertised = Array.isArray(option && option.options)
    ? option.options.filter(o => o && typeof o.value === 'string' && o.value)
    : []
  if (!advertised.length) return { value: null, reason: 'no model option advertised' }

  const mapped = map && typeof map === 'object' ? map[wanted] : undefined
  if (typeof mapped === 'string' && mapped) {
    return advertised.some(o => o.value === mapped)
      ? { value: mapped, reason: null }
      : { value: null, reason: 'mapped value not advertised' }
  }

  const exact = advertised.find(o => o.value === wanted)
  if (exact) return { value: exact.value, reason: null }

  // First advertised wins, deterministically: `sonnet` inside both
  // `claude-sonnet-4` and `claude-sonnet-4-5` is a tie the agent broke by
  // ordering, and an operator who cares sets the map.
  const needle = wanted.toLowerCase()
  const contains = advertised.find(
    o =>
      o.value.toLowerCase().includes(needle) ||
      (typeof o.name === 'string' && o.name.toLowerCase().includes(needle))
  )
  if (contains) return { value: contains.value, reason: null }

  return { value: null, reason: 'slug not among advertised values' }
}

// --- the wire ---------------------------------------------------------------

/**
 * One prompt turn against one freshly spawned agent process.
 *
 * Resolves with the agent's accumulated text and the turn's stop reason. Never
 * rejects for anything the agent *said* — only for a transport failure (the
 * process would not start, the handshake failed, the timeout fired), which the
 * caller turns into a `null` spawn result exactly as the workflow runtime does.
 */
async function promptOnce({ command, args, cwd, env, prompt, meta, model, modelMap, timeoutMs, onEvent }) {
  const child = spawnProcess(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })

  let nextId = 0
  const pending = new Map()
  let buffer = ''
  let text = ''
  let stderr = ''
  let closed = null

  const emit = event => {
    if (typeof onEvent === 'function') {
      try {
        onEvent(event)
      } catch {
        // Telemetry must never fail a run.
      }
    }
  }

  const send = message => {
    if (child.stdin.destroyed) return
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject, method })
      send({ jsonrpc: '2.0', id, method, params })
    })

  const respond = (id, result) => send({ jsonrpc: '2.0', id, result })
  const respondError = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

  const failAll = err => {
    for (const [, entry] of pending) entry.reject(err)
    pending.clear()
  }

  // The agent asks the client for things too. Everything it can ask for is
  // either answered mechanically (permission: yes, this is an unattended ship
  // run the user started) or declined as unsupported (fs, terminal — declared
  // false in the handshake, so a well-behaved agent never asks).
  const handleAgentRequest = message => {
    const { id, method, params } = message
    if (method === 'session/request_permission') {
      const options = Array.isArray(params && params.options) ? params.options : []
      const allow =
        options.find(o => o && o.kind === 'allow_always') ||
        options.find(o => o && o.kind === 'allow_once') ||
        options[0]
      if (!allow) {
        respond(id, { outcome: { outcome: 'cancelled' } })
        return
      }
      emit({ type: 'permission', tool: params && params.toolCall && params.toolCall.title, optionId: allow.optionId })
      respond(id, { outcome: { outcome: 'selected', optionId: allow.optionId } })
      return
    }
    respondError(id, -32601, `interlock ACP host does not implement ${method}`)
  }

  const handleMessage = message => {
    if (!message || typeof message !== 'object') return
    if (message.id !== undefined && message.method === undefined) {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      if (message.error) {
        entry.reject(
          new Error(`ACP ${entry.method} failed: ${message.error.message || JSON.stringify(message.error)}`)
        )
      } else {
        entry.resolve(message.result)
      }
      return
    }
    if (message.method === 'session/update') {
      const update = (message.params && message.params.update) || {}
      if (update.sessionUpdate === 'agent_message_chunk') {
        const content = update.content || {}
        if (content.type === 'text' && typeof content.text === 'string') text += content.text
      }
      return
    }
    if (message.id !== undefined) handleAgentRequest(message)
    // Any other notification (thoughts, tool calls, plans) is log-only.
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      try {
        handleMessage(JSON.parse(line))
      } catch {
        emit({ type: 'unparseable-line', line: line.slice(0, 200) })
      }
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => {
    stderr += chunk
  })

  const exited = new Promise(resolve => {
    child.on('error', err => {
      closed = err
      failAll(err)
      resolve()
    })
    child.on('close', code => {
      if (!closed && pending.size) {
        failAll(new Error(`ACP agent exited (code ${code}) mid-request: ${stderr.slice(-500)}`))
      }
      resolve()
    })
  })

  const budget = Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0
  let timer = null
  const timeout = budget
    ? new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`ACP agent produced no result within ${budget}ms`))
        }, budget)
      })
    : null

  /**
   * Apply the planner's model to this session, or say why it could not be.
   *
   * Order is config option, then `session/set_model`, then not applied (design
   * D3). Never throws: a model that could not be set is a degradation to report,
   * not a reason to lose the turn — the prompt runs either way.
   *
   * @returns {Promise<{ applied: boolean, via: string | null, value: string | null, reason: string | null }>}
   */
  const negotiateModel = async (sessionId, session) => {
    const option = findModelOption(session && session.configOptions)

    // Agents that predate config options advertise nothing and still accept the
    // legacy method, so it is worth one call with the raw slug before giving up.
    if (!option) {
      try {
        await request('session/set_model', { sessionId, modelId: model })
        return { applied: true, via: 'set_model', value: model, reason: null }
      } catch {
        return { applied: false, via: null, value: null, reason: 'no model option advertised' }
      }
    }

    const { value, reason } = pickModelValue(model, option, modelMap)
    if (!value) return { applied: false, via: null, value: null, reason }

    const configId = typeof option.id === 'string' && option.id ? option.id : 'model'
    try {
      await request('session/set_config_option', { sessionId, configId, value })
      return { applied: true, via: 'set_config_option', value, reason: null }
    } catch {
      try {
        await request('session/set_model', { sessionId, modelId: value })
        return { applied: true, via: 'set_model', value, reason: null }
      } catch {
        return {
          applied: false,
          via: null,
          value,
          reason: 'set_config_option and set_model both failed'
        }
      }
    }
  }

  const turn = async () => {
    const initialized = await request('initialize', {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false
      },
      clientInfo: { name: 'interlock', version: '0.1.0' }
    })
    emit({ type: 'initialized', protocolVersion: initialized && initialized.protocolVersion })

    const session = await request('session/new', { cwd, mcpServers: [] })
    const sessionId = session && session.sessionId
    if (!sessionId) throw new Error('ACP session/new returned no sessionId')
    emit({ type: 'session', sessionId })

    if (typeof model === 'string' && model) {
      emit({ type: 'model-routing', requested: model, ...(await negotiateModel(sessionId, session)) })
    }

    const result = await request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: prompt }],
      // `_meta` is ACP's reserved extension slot: agents may read it and MUST
      // NOT assume anything about it. It carries the planner's model slug for
      // an agent that happens to honour it, and changes nothing if none does.
      ...(meta ? { _meta: meta } : {})
    })
    return { stopReason: (result && result.stopReason) || 'end_turn', sessionId }
  }

  try {
    const { stopReason } = timeout ? await Promise.race([turn(), timeout]) : await turn()
    return { text, stopReason, stderr }
  } finally {
    if (timer) clearTimeout(timer)
    if (!child.stdin.destroyed) child.stdin.end()
    child.kill()
    await exited
  }
}

// --- the host ---------------------------------------------------------------

/**
 * Build a {@link import('../host.mjs').WorkflowHost} backed by an ACP agent.
 *
 * @param {object} [opts]
 * @param {string} [opts.command]    defaults to `process.env.INTERLOCK_ACP_COMMAND`
 * @param {string} [opts.cwd]        repo root; also the agent's session cwd
 * @param {object} [opts.env]
 * @param {number} [opts.timeoutMs]
 * @param {(event: object) => void} [opts.onEvent]
 * @returns {import('../host.mjs').WorkflowHost & { modelRouting: 'negotiated', command: string }}
 */
export function createAcpHost({ command, cwd = process.cwd(), env = process.env, timeoutMs, onEvent } = {}) {
  const parsed = parseAcpCommand(command || (env && env[ACP_COMMAND_ENV]))
  const budget = Number.isInteger(timeoutMs)
    ? timeoutMs
    : Number.parseInt((env && env[ACP_TIMEOUT_ENV]) || '', 10) || DEFAULT_TIMEOUT_MS
  // Parsed once, here, so a malformed map fails host creation rather than a wave.
  // The runner's published map is the source; `INTERLOCK_ACP_MODEL_MAP` is its
  // `acp` entry (design D6), so an agent that advertises its own ids resolves
  // through the same table every other host reads.
  const modelMap = parseModelMap(env || {}).acp || {}

  const host = {
    command: [parsed.command, ...parsed.args].join(' '),

    // What this adapter can observe about itself that the registry's static
    // declaration cannot: an ACP command that IS the Claude binary means the
    // plugin's hooks fire and the run is spending a Claude subscription through
    // the programmatic path. Declaring `local`/`false` there would suppress the
    // two banners that matter most on that path (design D8).
    capabilities: isClaudeCodeBinary(parsed.command)
      ? { hooks: true, billing: 'claude-subscription-programmatic' }
      : {},

    // The planner's tier ladder — the haiku pings, the opus clamp — is applied
    // per session where the agent advertises a model option, and per spawn the
    // adapter says which way it went in a `model-routing` event. The driver
    // banners `MODEL ROUTING UNAVAILABLE (ACP host)` from those events, and only
    // for the spawns that could not have a model applied, rather than letting a
    // summary imply a cost profile that was never applied. The slug still
    // travels as `_meta` too, which agents may read and MUST NOT assume.
    modelRouting: 'negotiated',

    async spawn(req) {
      const request = req && typeof req === 'object' ? req : {}
      const label = typeof request.label === 'string' ? request.label : 'agent'
      const started = Date.now()
      try {
        const { text, stopReason } = await promptOnce({
          command: parsed.command,
          args: spawnArgsForAgent(parsed, request.type),
          // The lane's worktree under isolation, the repo root otherwise. The
          // session is created with this as its cwd, so the agent's writes land
          // in the worktree the runner will fold rather than in the shared tree
          // two lanes are sharing (design D7).
          cwd: typeof request.cwd === 'string' && request.cwd ? request.cwd : cwd,
          env,
          prompt: formatSpawnPrompt(request),
          meta: typeof request.model === 'string' && request.model
            ? { 'interlock/model': request.model }
            : undefined,
          model: request.model,
          modelMap,
          timeoutMs: budget,
          onEvent: event => onEvent && onEvent({ label, ...event })
        })
        const result = parseAgentJson(text)
        if (onEvent) {
          onEvent({
            type: 'spawn-done',
            label,
            stopReason,
            ms: Date.now() - started,
            parsed: Boolean(result)
          })
        }
        return result
      } catch (err) {
        // Same contract as the workflow runtime: a spawn that could not produce
        // a result is null, and the CLI decides what a null costs.
        if (onEvent) onEvent({ type: 'spawn-failed', label, error: err && err.message })
        return null
      }
    },

    mapPipeline,

    runCli(argv, opts = {}) {
      return runCli(argv, { cwd, env, ...opts })
    }
  }

  return assertWorkflowHost(host, 'ACP host')
}
