// The ACP stdio subset the eval's agent speaks.
//
// This is apparatus, not product. `lib/host/acp.mjs` is the client half — it
// spawns an agent process, handshakes, opens a session and sends one prompt
// turn. This is the smallest agent half that satisfies it: `initialize`,
// `session/new`, `session/prompt`, a streamed `agent_message_chunk`, and
// `end_turn`. Nothing else, because nothing else is exercised.
//
// The transport is deliberately injected rather than bound to stdio. What makes
// a wire implementation testable is being able to drive it with a stub that
// sends recorded lines and records what comes back — no subprocess, no network,
// no model. `main.mjs` is the only file that touches `process.stdin`.
//
// Protocol facts, from the ACP v1 schema and the client this answers:
//   transport   JSON-RPC 2.0 over stdio, one message per line, no embedded \n
//   initialize  { protocolVersion, clientCapabilities } -> { protocolVersion, ... }
//   session/new { cwd, mcpServers } -> { sessionId }
//   session/prompt { sessionId, prompt: [ContentBlock] } -> { stopReason }
//   output      session/update notification, update.sessionUpdate =
//               "agent_message_chunk", update.content = { type: "text", text }

/** Latest ACP major version this agent implements. */
export const ACP_PROTOCOL_VERSION = 1

/** JSON-RPC's "method not found". */
const METHOD_NOT_FOUND = -32601

/** JSON-RPC's "internal error" — what a turn that could not run answers with. */
const INTERNAL_ERROR = -32603

/**
 * Extract the text of a prompt's content blocks. Non-text blocks are dropped
 * rather than rendered: this agent declares no capability to read an image or a
 * resource, so pretending to have seen one would be the quiet degradation the
 * repository forbids.
 *
 * @param {Array<object>} blocks
 * @returns {string}
 */
export function promptText(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

/**
 * Build the agent's message handler over an injected transport.
 *
 * @param {object} options
 * @param {(message: object) => void} options.send        writes one JSON-RPC message
 * @param {(turn: {
 *   sessionId: string,
 *   cwd: string,
 *   text: string,
 *   meta: object|undefined,
 *   emit: (text: string) => void
 * }) => Promise<{ stopReason?: string }|void>} options.onPrompt
 * @param {string} [options.defaultCwd] session cwd when the client names none
 * @returns {{ handle: (message: object) => Promise<void>, sessions: Map<string, {cwd: string}> }}
 */
export function createAgent({ send, onPrompt, defaultCwd = process.cwd() }) {
  const sessions = new Map()
  let counter = 0

  const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
  const replyError = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

  /** Stream one chunk of assistant text to the client. */
  const emitFor = sessionId => text => {
    if (typeof text !== 'string' || text.length === 0) return
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text }
        }
      }
    })
  }

  async function handle(message) {
    if (!message || typeof message !== 'object') return

    // A response to something this agent asked the client. It asks for nothing,
    // so there is nothing to correlate — dropped rather than answered, which
    // would put an error on the wire for a message the client is entitled to
    // send.
    if (message.method === undefined) return

    const { id, method, params = {} } = message

    if (method === 'initialize') {
      reply(id, {
        protocolVersion: params.protocolVersion || ACP_PROTOCOL_VERSION,
        agentCapabilities: {},
        authMethods: []
      })
      return
    }

    if (method === 'session/new') {
      const sessionId = `interlock-eval-${process.pid}-${++counter}`
      sessions.set(sessionId, { cwd: params.cwd || defaultCwd })
      reply(id, { sessionId })
      return
    }

    if (method === 'session/prompt') {
      const session = sessions.get(params.sessionId)
      if (!session) {
        replyError(id, INTERNAL_ERROR, `no such session: ${params.sessionId}`)
        return
      }
      try {
        const outcome = await onPrompt({
          sessionId: params.sessionId,
          cwd: session.cwd,
          text: promptText(params.prompt),
          meta: params._meta,
          emit: emitFor(params.sessionId)
        })
        reply(id, { stopReason: (outcome && outcome.stopReason) || 'end_turn' })
      } catch (err) {
        // A turn that could not run answers with an error, not with an empty
        // `end_turn`. The client turns a rejected request into a null spawn
        // result and the CLI decides what that costs — which is the honest
        // path. An empty success would read as an agent that had nothing to
        // say.
        replyError(id, INTERNAL_ERROR, (err && err.message) || String(err))
      }
      return
    }

    if (id !== undefined) {
      replyError(id, METHOD_NOT_FOUND, `interlock eval agent does not implement ${method}`)
    }
  }

  return { handle, sessions }
}

/**
 * Feed newline-delimited JSON into a handler.
 *
 * Returned as a stateful function rather than woven into `createAgent` so the
 * framing can be driven directly by a test, and so `main.mjs` holds no parsing
 * of its own.
 *
 * @param {(message: object) => Promise<void>|void} handle
 * @param {(line: string, err: Error) => void} [onUnparseable]
 * @returns {(chunk: string) => Promise<void>}
 */
export function createLineReader(handle, onUnparseable) {
  let buffer = ''
  return async function feed(chunk) {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch (err) {
        if (onUnparseable) onUnparseable(line, err)
        continue
      }
      await handle(message)
    }
  }
}
