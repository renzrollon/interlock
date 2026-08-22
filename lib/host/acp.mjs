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
//   session     session/new { cwd, mcpServers } -> { sessionId }
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
import { mapPipeline, parseAgentJson, runCli, assertWorkflowHost } from '../host.mjs'

/** Where the user names their ACP agent, e.g. `claude-code-acp` or `gemini --acp`. */
export const ACP_COMMAND_ENV = 'INTERLOCK_ACP_COMMAND'

/** Optional per-agent wall clock, in ms. 0 disables it. */
export const ACP_TIMEOUT_ENV = 'INTERLOCK_ACP_TIMEOUT_MS'

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

// --- the wire ---------------------------------------------------------------

/**
 * One prompt turn against one freshly spawned agent process.
 *
 * Resolves with the agent's accumulated text and the turn's stop reason. Never
 * rejects for anything the agent *said* — only for a transport failure (the
 * process would not start, the handshake failed, the timeout fired), which the
 * caller turns into a `null` spawn result exactly as the workflow runtime does.
 */
async function promptOnce({ command, args, cwd, env, prompt, meta, timeoutMs, onEvent }) {
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
 * @returns {import('../host.mjs').WorkflowHost & { modelRoutingSupported: false, command: string }}
 */
export function createAcpHost({ command, cwd = process.cwd(), env = process.env, timeoutMs, onEvent } = {}) {
  const parsed = parseAcpCommand(command || (env && env[ACP_COMMAND_ENV]))
  const budget = Number.isInteger(timeoutMs)
    ? timeoutMs
    : Number.parseInt((env && env[ACP_TIMEOUT_ENV]) || '', 10) || DEFAULT_TIMEOUT_MS

  const host = {
    command: [parsed.command, ...parsed.args].join(' '),

    // ACP v1 has no per-prompt model selector, so the planner's tier ladder —
    // the haiku pings, the opus clamp — is not in effect on this host. The
    // driver prints a banner saying so rather than letting a summary imply a
    // cost profile that was never applied. The slug still travels as `_meta`,
    // which agents may read and MUST NOT assume.
    modelRoutingSupported: false,

    async spawn(req) {
      const request = req && typeof req === 'object' ? req : {}
      const label = typeof request.label === 'string' ? request.label : 'agent'
      const started = Date.now()
      try {
        const { text, stopReason } = await promptOnce({
          command: parsed.command,
          args: parsed.args,
          cwd,
          env,
          prompt: formatSpawnPrompt(request),
          meta: typeof request.model === 'string' && request.model
            ? { 'interlock/model': request.model }
            : undefined,
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
