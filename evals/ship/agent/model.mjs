// The eval agent's tool-use loop against the Messages API.
//
// Raw HTTP over global `fetch`, not the Anthropic SDK — deliberately, and for
// one reason: this repository has no `dependencies` key and CI installs
// nothing, so the eval's own apparatus cannot be the thing that adds the first
// runtime dependency. `fetch` is global on Node >= 18, which is the floor
// `package.json` already declares.
//
// The loop is the standard one: send, and while the model stops on `tool_use`,
// execute every call in the turn and send all the results back in a single user
// message. Splitting tool results across messages teaches the model to stop
// making parallel calls.

/** The Messages API endpoint, overridable for a stub. */
export const DEFAULT_BASE_URL = 'https://api.anthropic.com'

/** The API version header. Pinned, never inferred from a response. */
export const ANTHROPIC_VERSION = '2023-06-01'

/**
 * The model this eval runs unless one is named.
 *
 * Recorded on every result row: a comparison across plugin versions is only
 * meaningful when the model is held constant, and the only way a reader can
 * check that is if each row says which model it was.
 */
export const DEFAULT_MODEL = 'claude-opus-5'

/** Where the model's identity is overridden. */
export const MODEL_ENV = 'INTERLOCK_EVAL_MODEL'

/** Non-streaming ceiling. Kept under the HTTP timeout a single request has. */
const MAX_TOKENS = 16000

/** How many model turns one prompt may take before the loop gives up. */
const DEFAULT_MAX_TURNS = 60

/**
 * A fresh, zeroed usage tally.
 *
 * Every field starts at 0 and is only ever incremented from a response the API
 * actually returned, so a tally of zero means "no request was billed", never
 * "we did not look". Whether a figure was measured at all is the runner's
 * question, answered by whether a usage record exists — not by reading a zero.
 */
export function emptyUsage() {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0
  }
}

/** Add one response's `usage` block into a running tally, field by name. */
export function addUsage(tally, usage) {
  if (!usage || typeof usage !== 'object') return tally
  tally.requests += 1
  tally.inputTokens += Number(usage.input_tokens) || 0
  tally.outputTokens += Number(usage.output_tokens) || 0
  tally.cacheReadInputTokens += Number(usage.cache_read_input_tokens) || 0
  tally.cacheCreationInputTokens += Number(usage.cache_creation_input_tokens) || 0
  return tally
}

/**
 * The cache lifetime the breakpoint asks for. `ephemeral` is the API's default
 * tier and needs no beta header; a longer one is a different price and is not
 * this loop's decision to make.
 */
const CACHE_CONTROL = Object.freeze({ type: 'ephemeral' })

/**
 * Mark the request's stable prefix as cacheable.
 *
 * The provider writes a cache entry ONLY at an explicit breakpoint, so a loop
 * that marks none re-pays full base input on every one of its turns and reports
 * a cache-read tally that is zero for structural reasons — indistinguishable
 * from "caching is unavailable". That was this loop's defect.
 *
 * The prefix is `tools` then `system`: both are byte-identical on every turn of
 * one loop, while `messages` grows by two entries per turn. The breakpoint goes
 * on the LAST block of that prefix, which caches all of it. Marking anything
 * inside `messages` would move the breakpoint every turn and re-write the entry
 * instead of reading it — the opposite of the fix.
 *
 * The caller's `tools` array is never mutated: it is a module-level constant
 * shared across every request in the process.
 */
export function markStablePrefix({ system, tools = [] } = {}) {
  const list = Array.isArray(tools) ? tools : []
  if (system) return { tools: list, system: [{ type: 'text', text: system, cache_control: CACHE_CONTROL }] }
  if (list.length) {
    return { tools: [...list.slice(0, -1), { ...list[list.length - 1], cache_control: CACHE_CONTROL }], system: null }
  }
  // Nothing is stable across turns, so there is no prefix to cache. A breakpoint
  // invented here would mark the growing message list.
  return { tools: list, system: null }
}

/**
 * What a cache tally means — because a zero has four causes and only one of them
 * is a miss.
 *
 * `no-requests` nothing was billed. `unrequested` requests were made with no
 * breakpoint, so the provider was never asked to write; the zero is structural.
 * `unmeasured` a breakpoint was sent and the provider still wrote nothing, which
 * is what a prefix below the minimum cacheable size looks like — a fact about
 * the apparatus, not a finding about the loop. `measured` an entry was written
 * or read, so the figures mean what they say; a prefix written and then not
 * reused reports `measured` with a zero read, which is a real miss and is
 * distinguishable from every case above.
 */
export function cacheStatusOf(usage, breakpointsSent) {
  if (!usage || !usage.requests) return 'no-requests'
  if (!breakpointsSent) return 'unrequested'
  if (!usage.cacheCreationInputTokens && !usage.cacheReadInputTokens) return 'unmeasured'
  return 'measured'
}

/** The text blocks of one assistant message, joined. */
function textOf(content) {
  return (Array.isArray(content) ? content : [])
    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

/**
 * Build a model client that runs one tool-use loop per prompt and accumulates
 * its own token usage across every prompt it serves.
 *
 * The usage lives on the client, not on a turn, because the ACP client opens a
 * session per process and the figure the runner wants is what this process
 * spent — see `reportUsage` in `main.mjs`.
 *
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} [options.model]
 * @param {string} [options.baseUrl]
 * @param {typeof fetch} [options.fetchImpl] injected for tests; no network by default in one
 * @param {number} [options.maxTurns]
 * @returns {{
 *   model: string,
 *   usage: ReturnType<typeof emptyUsage>,
 *   run: (req: {
 *     prompt: string,
 *     system?: string,
 *     tools?: Array<object>,
 *     executeTool: (call: { name: string, input: object }) => { content: string, isError: boolean }
 *   }) => Promise<{ text: string, stopReason: string, turns: number }>
 * }}
 */
export function createModelClient({
  apiKey,
  model = DEFAULT_MODEL,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  maxTurns = DEFAULT_MAX_TURNS
} = {}) {
  if (!apiKey) {
    throw new Error(
      'no model credential: set ANTHROPIC_API_KEY. The eval reports no signal rather than ' +
        'recording a graded failure when it cannot reach a model.'
    )
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('global fetch is unavailable — Node >= 18 is required')
  }

  const usage = emptyUsage()
  let breakpointsSent = 0

  async function send(body) {
    const response = await fetchImpl(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify(body)
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Messages API returned ${response.status}: ${detail.slice(0, 800)}`)
    }
    return response.json()
  }

  async function run({ prompt, system, tools = [], executeTool }) {
    const messages = [{ role: 'user', content: prompt }]
    let lastText = ''
    let turns = 0

    // Marked once, outside the loop: every turn must send the *same* prefix
    // bytes, or the provider writes a new entry instead of reading the old one.
    const prefix = markStablePrefix({ system, tools })
    const marksPrefix = Boolean(prefix.system) || prefix.tools.some(t => t && t.cache_control)

    for (; turns < maxTurns; turns++) {
      const data = await send({
        model,
        max_tokens: MAX_TOKENS,
        ...(prefix.system ? { system: prefix.system } : {}),
        ...(prefix.tools.length ? { tools: prefix.tools } : {}),
        messages
      })
      if (marksPrefix) breakpointsSent += 1
      addUsage(usage, data.usage)

      const content = Array.isArray(data.content) ? data.content : []
      messages.push({ role: 'assistant', content })

      const calls = content.filter(block => block && block.type === 'tool_use')
      if (data.stop_reason !== 'tool_use' || calls.length === 0) {
        // Only the final turn's text is returned. The ACP client scans for the
        // first balanced JSON object in what it receives, so concatenating a
        // mid-loop remark that happened to contain a brace would hand it the
        // wrong object.
        lastText = textOf(content)
        return { text: lastText, stopReason: data.stop_reason || 'end_turn', turns: turns + 1 }
      }

      // Every result from this turn goes back in ONE user message.
      const results = calls.map(call => {
        const outcome = executeTool({ name: call.name, input: call.input })
        return {
          type: 'tool_result',
          tool_use_id: call.id,
          content: outcome.content,
          ...(outcome.isError ? { is_error: true } : {})
        }
      })
      messages.push({ role: 'user', content: results })
    }

    // Spoken, not silent: a loop that ran out of turns says so, and the caller
    // decides. Returning the last text as though the model had finished would
    // report a truncated run as a complete one.
    throw new Error(`the tool loop reached its ceiling of ${maxTurns} model turns without finishing`)
  }

  return { model, usage, run, cacheStatus: () => cacheStatusOf(usage, breakpointsSent) }
}
