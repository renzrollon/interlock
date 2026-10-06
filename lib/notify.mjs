// The one network call this CLI ever makes: a push to the configured server
// (the public default, or a server the operator named) so a ship run that
// stops while nobody is watching can still reach someone.
//
// Three properties are load-bearing, and every one of them exists because
// this module is the CLI's only exception to "no network":
//
//   1. PURE TRANSPORT. Nothing here reads a file or the tree. Configuration
//      is two environment variables and nothing else (design D2) — a typo in
//      `.claude/settings.local.json` must never masquerade as a push failure,
//      so there is no settings file this module could misread in the first
//      place.
//
//   2. THE TOPIC NEVER LEAVES. The topic is the only auth the public server
//      has; it is a capability, not a label. `readNotifyConfig`
//      never echoes it, `sanitizeReason` strips it (and the server URL) from
//      every failure reason before that reason reaches a summary line, a
//      receipt event or the trajectory, because a `fetch` failure's own
//      `cause` can carry the request host and a malformed-URL error can carry
//      the whole URL.
//
//   3. BOUNDED AND NEVER THE REASON A CLOSE HANGS. `postNtfy` awaits `fetch`
//      under an `AbortController` timing out at `LIMITS.notifyTimeoutMs`, and
//      every failure mode — a non-2xx status, a network error, the timeout,
//      invalid configuration — resolves to `{ sent: false, reason }` rather
//      than throwing. Nothing here changes an exit code; the caller decides
//      what a failed push means for the run.
//
// design D1, D2, D4, D5, D14 (add-harden-unattended-ship-runs).

import { LIMITS } from './limits.mjs'
import { DEFAULT_NTFY_URL } from './notify-defaults.mjs'

export { DEFAULT_NTFY_URL }

/** Where the topic is read from. Chosen by the operator, never by the repo. */
export const NOTIFY_TOPIC_ENV = 'INTERLOCK_NTFY_TOPIC'

/** Where a self-hosted server is read from. Absent means the public default. */
export const NOTIFY_URL_ENV = 'INTERLOCK_NTFY_URL'

/**
 * Plugin options the host injects into a hook process, from `userConfig`
 * `ntfy_topic` and `ntfy_url`. Preferred over the shell variables when present,
 * so a value the operator typed into the plugin is the one that is shared.
 */
export const NOTIFY_TOPIC_OPTION = 'CLAUDE_PLUGIN_OPTION_NTFY_TOPIC'
export const NOTIFY_URL_OPTION = 'CLAUDE_PLUGIN_OPTION_NTFY_URL'

function messageOf(err) {
  return (err && err.message) || String(err)
}

/** A topic containing whitespace or a slash cannot be a single ntfy path segment. */
function topicShapeInvalid(topic) {
  return typeof topic !== 'string' || !topic || /\s/.test(topic) || topic.includes('/')
}

/** Does `url` parse as an absolute URL `fetch` could target? */
function urlShapeInvalid(url) {
  if (typeof url !== 'string' || !url) return true
  try {
    // eslint-disable-next-line no-new
    new URL(url)
    return false
  } catch {
    return true
  }
}

function trimmed(source, name) {
  if (!source || typeof source[name] !== 'string') return ''
  return source[name].trim()
}

/**
 * Read push configuration. Never the tree. A plugin option the host injected
 * wins over the shell variable of the same meaning, and an absent topic is
 * unconfigured rather than an error (design D2). The shell variables remain
 * the channel for a terminal, CI, and any host that does not inject options.
 *
 * @param {object} source  values to read (injected in tests; the process values at call sites)
 * @returns {{topic: string, url: string} | {topic: null} | {invalid: string}}
 *   `{ topic: null }` when push is simply unconfigured — not an error, the
 *   default and by far the common case. `{ invalid: '<VAR>' }` names the
 *   offending variable and never its value.
 */
export function readNotifyConfig(source) {
  const optionTopic = trimmed(source, NOTIFY_TOPIC_OPTION)
  const shellTopic = trimmed(source, NOTIFY_TOPIC_ENV)
  const rawTopic = optionTopic || shellTopic
  if (!rawTopic) return { topic: null }
  if (topicShapeInvalid(rawTopic)) return { invalid: optionTopic ? NOTIFY_TOPIC_OPTION : NOTIFY_TOPIC_ENV }

  const optionUrl = trimmed(source, NOTIFY_URL_OPTION)
  const shellUrl = trimmed(source, NOTIFY_URL_ENV)
  const rawUrl = optionUrl || shellUrl || DEFAULT_NTFY_URL
  if (urlShapeInvalid(rawUrl)) return { invalid: optionUrl ? NOTIFY_URL_OPTION : NOTIFY_URL_ENV }

  return { topic: rawTopic, url: rawUrl }
}

/**
 * The message for a ship run's terminal close — the summary's own first line
 * as the title, so the push and the printed line can never disagree, and a
 * body that names the change and the run id or says plainly that none was
 * ever minted (design D4).
 *
 * @param {object} input
 * @param {string} input.headline  the summary's first line, verbatim
 * @param {string} input.change    the change name
 * @param {string|null} [input.runId]  minted at `adoptPlan`; null before one was
 * @returns {{title: string, body: string, priority: 'high'|'default'}}
 */
export function composeCloseMessage({ headline, change, runId } = {}) {
  const runLine = runId ? `run: ${runId}` : 'run: none — the run halted before a plan was adopted'
  return {
    title: headline,
    body: `change: ${change}\n${runLine}`,
    priority: typeof headline === 'string' && headline.startsWith('SHIP HALTED') ? 'high' : 'default'
  }
}

/**
 * The message for `/interlock:spec`'s human checkpoint (design D6) — pushed
 * the same way a halt is, so a checkpoint reached while nobody is watching
 * still reaches someone.
 *
 * @param {string} change
 * @returns {{title: string, body: string, priority: 'default'}}
 */
export function composeCheckpointMessage(change) {
  return {
    title: `SPEC CHECKPOINT — ${change}`,
    body: `change: ${change}`,
    priority: 'default'
  }
}

/**
 * Strip anything the message could otherwise carry that identifies the
 * server or the topic out of a failure reason, before that reason can reach
 * a summary line, a receipt event or the trajectory. Two more precautions
 * beyond the exact strings: the URL's bare host, because a network error's
 * own `cause` often carries only the host and not the scheme, and a hard cap
 * so one hostile or malformed message cannot blow up a printed report.
 *
 * @param {string} reason
 * @param {{topic?: string, url?: string}} [config]
 * @returns {string}
 */
export function sanitizeReason(reason, { topic, url } = {}) {
  let text = typeof reason === 'string' ? reason : String(reason)
  if (topic) text = text.split(topic).join('<topic>')
  if (url) {
    text = text.split(url).join('<url>')
    try {
      const host = new URL(url).host
      if (host) text = text.split(host).join('<host>')
    } catch {
      // url did not parse; nothing further to strip on its account.
    }
  }
  text = text.replace(/\r?\n+/g, ' ').trim()
  return text.length > 200 ? text.slice(0, 200) : text
}

/**
 * Encode a header value that may carry non-ASCII text.
 *
 * This is not defensive tidying, it is the only way the title can travel at
 * all: EVERY headline this module sends contains an em dash (`SHIP COMPLETE —
 * <change>`), HTTP header values are ByteStrings, and Node's `fetch` throws
 * `Cannot convert argument to a ByteString` rather than transmitting one. So
 * a non-ASCII value is sent as an RFC 2047 base64 encoded-word, which the
 * server's publish documentation names as the supported encoding for exactly
 * this case ("UTF-8 in HTTP headers" is not accepted by every client,
 * checked 2026-09-07).
 *
 * A pure-ASCII value is passed through untouched, so the common `interlock
 * notify --title` case stays readable on the wire.
 *
 * @param {string} value
 * @returns {string}
 */
export function encodeHeaderValue(value) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(text)) return text
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`
}

/**
 * Post one message. Never throws: every failure mode — invalid
 * configuration, a non-2xx status, a network error, the timeout — resolves
 * to `{ sent: false, reason }`, sanitized, so the caller can always print
 * something and never has to catch anything.
 *
 * @param {object} input
 * @param {string} input.url
 * @param {string} input.topic
 * @param {string} input.title
 * @param {string} input.body
 * @param {'high'|'default'} [input.priority]
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]  injected for tests; no network in the suite
 * @param {number} [opts.timeoutMs]  defaults to the published `LIMITS.notifyTimeoutMs`
 * @returns {Promise<{sent: true} | {sent: false, reason: string}>}
 */
export async function postNtfy(
  { url, topic, title, body, priority } = {},
  { fetchImpl = globalThis.fetch, timeoutMs = LIMITS.notifyTimeoutMs } = {}
) {
  const invalidVar = topicShapeInvalid(topic) ? NOTIFY_TOPIC_ENV : urlShapeInvalid(url) ? NOTIFY_URL_ENV : null
  if (invalidVar) {
    return { sent: false, reason: sanitizeReason(`invalid configuration: ${invalidVar}`, { topic, url }) }
  }

  const target = `${url.replace(/\/+$/, '')}/${topic}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(target, {
      method: 'POST',
      headers: {
        Title: encodeHeaderValue(title || ''),
        Priority: priority || 'default'
      },
      body: body || '',
      signal: controller.signal
    })
    if (!response || !response.ok) {
      const status = response ? response.status : 'unknown'
      return { sent: false, reason: sanitizeReason(`HTTP ${status}`, { topic, url }) }
    }
    return { sent: true }
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return { sent: false, reason: sanitizeReason(`timed out after ${timeoutMs}ms`, { topic, url }) }
    }
    return { sent: false, reason: sanitizeReason(`network error: ${messageOf(err)}`, { topic, url }) }
  } finally {
    clearTimeout(timer)
  }
}
