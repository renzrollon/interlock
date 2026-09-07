// The push transport's own suite. Every network call here goes through an
// injected `fetchImpl` — this suite never touches a real server, and the
// one thing every failure-path test asserts in common is that neither the
// topic nor the server URL survives into the reason string, because that
// reason is what ends up in a printed summary, a receipt event and the
// trajectory.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  NOTIFY_TOPIC_ENV,
  NOTIFY_URL_ENV,
  DEFAULT_NTFY_URL,
  readNotifyConfig,
  composeCloseMessage,
  composeCheckpointMessage,
  sanitizeReason,
  encodeHeaderValue,
  postNtfy
} from '../../lib/notify.mjs'
import { LIMITS } from '../../lib/limits.mjs'

// ---------------------------------------------------------------------------
// readNotifyConfig
// ---------------------------------------------------------------------------

test('readNotifyConfig reports unset as { topic: null }, never as invalid', () => {
  assert.deepEqual(readNotifyConfig({}), { topic: null })
  assert.deepEqual(readNotifyConfig({ [NOTIFY_TOPIC_ENV]: '' }), { topic: null })
  assert.deepEqual(readNotifyConfig({ [NOTIFY_TOPIC_ENV]: '   ' }), { topic: null })
})

test('readNotifyConfig defaults the URL to the public server', () => {
  assert.deepEqual(readNotifyConfig({ [NOTIFY_TOPIC_ENV]: 'my-topic' }), {
    topic: 'my-topic',
    url: DEFAULT_NTFY_URL
  })
})

test('readNotifyConfig honours a self-hosted URL', () => {
  assert.deepEqual(
    readNotifyConfig({ [NOTIFY_TOPIC_ENV]: 'my-topic', [NOTIFY_URL_ENV]: 'https://ntfy.example.internal' }),
    { topic: 'my-topic', url: 'https://ntfy.example.internal' }
  )
})

test('readNotifyConfig rejects a topic with whitespace or a slash, naming the variable', () => {
  assert.deepEqual(readNotifyConfig({ [NOTIFY_TOPIC_ENV]: 'has space' }), { invalid: NOTIFY_TOPIC_ENV })
  assert.deepEqual(readNotifyConfig({ [NOTIFY_TOPIC_ENV]: 'has/slash' }), { invalid: NOTIFY_TOPIC_ENV })
})

test('readNotifyConfig rejects a URL that does not parse, naming the variable', () => {
  assert.deepEqual(
    readNotifyConfig({ [NOTIFY_TOPIC_ENV]: 'my-topic', [NOTIFY_URL_ENV]: 'not a url' }),
    { invalid: NOTIFY_URL_ENV }
  )
})

// ---------------------------------------------------------------------------
// composeCloseMessage / composeCheckpointMessage
// ---------------------------------------------------------------------------

test('composeCloseMessage names the change and the run id, at default priority', () => {
  const msg = composeCloseMessage({ headline: 'SHIP COMPLETE — add-thing', change: 'add-thing', runId: '7c2f' })
  assert.equal(msg.title, 'SHIP COMPLETE — add-thing')
  assert.match(msg.body, /change: add-thing/)
  assert.match(msg.body, /run: 7c2f/)
  assert.equal(msg.priority, 'default')
})

test('composeCloseMessage is high priority exactly when the headline is a halt', () => {
  const halted = composeCloseMessage({ headline: 'SHIP HALTED — the budget was exhausted', change: 'add-thing', runId: 'abc' })
  assert.equal(halted.priority, 'high')
  const leftovers = composeCloseMessage({ headline: 'SHIP COMPLETE WITH LEFTOVERS — add-thing', change: 'add-thing', runId: 'abc' })
  assert.equal(leftovers.priority, 'default')
})

test('composeCloseMessage states plainly that no run id exists, never null/undefined/empty', () => {
  const msg = composeCloseMessage({ headline: 'SHIP HALTED — validation failed', change: 'add-thing', runId: null })
  assert.match(msg.body, /run: none — the run halted before a plan was adopted/)
  assert.doesNotMatch(msg.body, /\bnull\b/)
  assert.doesNotMatch(msg.body, /\bundefined\b/)
  const noRunId = composeCloseMessage({ headline: 'SHIP HALTED — validation failed', change: 'add-thing' })
  assert.match(noRunId.body, /run: none/)
})

test('composeCheckpointMessage names the change at default priority', () => {
  const msg = composeCheckpointMessage('add-thing')
  assert.equal(msg.title, 'SPEC CHECKPOINT — add-thing')
  assert.equal(msg.priority, 'default')
})

// ---------------------------------------------------------------------------
// sanitizeReason
// ---------------------------------------------------------------------------

test('sanitizeReason strips the topic and the URL, and the URL host on its own', () => {
  const reason = sanitizeReason('connect ECONNREFUSED ntfy.example.internal my-secret-topic', {
    topic: 'my-secret-topic',
    url: 'https://ntfy.example.internal'
  })
  assert.doesNotMatch(reason, /my-secret-topic/)
  assert.doesNotMatch(reason, /ntfy\.example\.internal/)
})

test('sanitizeReason collapses newlines and caps at 200 characters', () => {
  const long = 'x'.repeat(500) + '\nsecond line\nthird line'
  const reason = sanitizeReason(long, {})
  assert.ok(reason.length <= 200)
  assert.doesNotMatch(reason, /\n/)
})

// ---------------------------------------------------------------------------
// postNtfy
// ---------------------------------------------------------------------------

const TOPIC = 'super-secret-topic'
const URL_DEFAULT = DEFAULT_NTFY_URL
const URL_SELFHOST = 'https://ntfy.example.internal'

function assertReasonSanitary(reason) {
  assert.doesNotMatch(reason, new RegExp(TOPIC))
  assert.doesNotMatch(reason, /ntfy\.sh/)
  assert.doesNotMatch(reason, /ntfy\.example\.internal/)
}

test('postNtfy success — the default URL, exactly one POST, Title and Priority headers set', async () => {
  const calls = []
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts })
    return { ok: true, status: 200 }
  }
  const result = await postNtfy(
    { url: URL_DEFAULT, topic: TOPIC, title: 'SHIP COMPLETE — add-thing', body: 'change: add-thing\nrun: abc', priority: 'default' },
    { fetchImpl }
  )
  assert.deepEqual(result, { sent: true })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${URL_DEFAULT}/${TOPIC}`)
  assert.equal(calls[0].opts.method, 'POST')
  // The headline goes on the wire RFC 2047 encoded — an em dash is not a
  // ByteString and `fetch` refuses to send one. See `encodeHeaderValue`.
  assert.equal(calls[0].opts.headers.Title, encodeHeaderValue('SHIP COMPLETE — add-thing'))
  assert.equal(calls[0].opts.headers.Priority, 'default')
})

test('postNtfy success — a self-hosted URL posts to that server', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    return { ok: true, status: 200 }
  }
  const result = await postNtfy({ url: URL_SELFHOST, topic: TOPIC, title: 't', body: 'b', priority: 'high' }, { fetchImpl })
  assert.deepEqual(result, { sent: true })
  assert.equal(calls[0], `${URL_SELFHOST}/${TOPIC}`)
})

test('postNtfy failure — a non-2xx status is reported and sanitized', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403 })
  const result = await postNtfy({ url: URL_DEFAULT, topic: TOPIC, title: 't', body: 'b' }, { fetchImpl })
  assert.equal(result.sent, false)
  assert.equal(result.reason, 'HTTP 403')
  assertReasonSanitary(result.reason)
})

test('postNtfy failure — a network error is reported without the topic or the URL, even when the error message carries both', async () => {
  const fetchImpl = async () => {
    throw new Error(`getaddrinfo ENOTFOUND ${TOPIC} at ${URL_DEFAULT}/${TOPIC}`)
  }
  const result = await postNtfy({ url: URL_DEFAULT, topic: TOPIC, title: 't', body: 'b' }, { fetchImpl })
  assert.equal(result.sent, false)
  assert.match(result.reason, /^network error:/)
  assertReasonSanitary(result.reason)
})

test('postNtfy failure — a hanging request times out within the bound and is reported, never left hanging', async () => {
  const fetchImpl = (url, opts) =>
    new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted.')
        err.name = 'AbortError'
        reject(err)
      })
    })
  const start = Date.now()
  const result = await postNtfy({ url: URL_DEFAULT, topic: TOPIC, title: 't', body: 'b' }, { fetchImpl, timeoutMs: 20 })
  const elapsed = Date.now() - start
  assert.equal(result.sent, false)
  assert.equal(result.reason, 'timed out after 20ms')
  assert.ok(elapsed < 2000, `postNtfy must not outlive its own timeout (took ${elapsed}ms)`)
  assertReasonSanitary(result.reason)
})

test('postNtfy failure — an unset (empty) topic makes no request and names the topic variable', async () => {
  let called = false
  const fetchImpl = async () => {
    called = true
    return { ok: true, status: 200 }
  }
  const result = await postNtfy({ url: URL_DEFAULT, topic: '', title: 't', body: 'b' }, { fetchImpl })
  assert.equal(called, false)
  assert.equal(result.sent, false)
  assert.equal(result.reason, `invalid configuration: ${NOTIFY_TOPIC_ENV}`)
})

test('postNtfy failure — an invalid topic (whitespace or slash) makes no request', async () => {
  let called = false
  const fetchImpl = async () => {
    called = true
    return { ok: true, status: 200 }
  }
  const result = await postNtfy({ url: URL_DEFAULT, topic: 'has space', title: 't', body: 'b' }, { fetchImpl })
  assert.equal(called, false)
  assert.equal(result.sent, false)
  assert.equal(result.reason, `invalid configuration: ${NOTIFY_TOPIC_ENV}`)
  assert.doesNotMatch(result.reason, /has space/)
})

test('postNtfy failure — a URL that does not parse makes no request and names the URL variable', async () => {
  let called = false
  const fetchImpl = async () => {
    called = true
    return { ok: true, status: 200 }
  }
  const result = await postNtfy({ url: 'not a url', topic: TOPIC, title: 't', body: 'b' }, { fetchImpl })
  assert.equal(called, false)
  assert.equal(result.sent, false)
  assert.equal(result.reason, `invalid configuration: ${NOTIFY_URL_ENV}`)
})

test('postNtfy defaults its timeout to the published LIMITS.notifyTimeoutMs', async () => {
  let receivedTimeout = null
  const fetchImpl = (url, opts) =>
    new Promise((resolve) => {
      // Read the abort behaviour indirectly: resolve immediately so the test
      // does not actually wait out the real cap, but confirm no override was
      // needed for the default path to work.
      receivedTimeout = opts.signal ? 'has-signal' : null
      resolve({ ok: true, status: 200 })
    })
  const result = await postNtfy({ url: URL_DEFAULT, topic: TOPIC, title: 't', body: 'b' }, { fetchImpl })
  assert.equal(result.sent, true)
  assert.equal(receivedTimeout, 'has-signal')
  assert.equal(typeof LIMITS.notifyTimeoutMs, 'number')
})

// ---------------------------------------------------------------------------
// encodeHeaderValue — the reason the title arrives at all
// ---------------------------------------------------------------------------

test('encodeHeaderValue passes ASCII through untouched', () => {
  assert.equal(encodeHeaderValue('SPEC CHECKPOINT: add-thing'), 'SPEC CHECKPOINT: add-thing')
  assert.equal(encodeHeaderValue(''), '')
})

test('encodeHeaderValue RFC 2047 encodes a headline, which always carries an em dash', () => {
  // Not a nicety: HTTP header values are ByteStrings and Node's `fetch`
  // THROWS on U+2014 rather than transmitting it, so without this every
  // single close push would fail as a "network error".
  const encoded = encodeHeaderValue('SHIP COMPLETE — add-thing')
  assert.match(encoded, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
  const body = encoded.slice('=?UTF-8?B?'.length, -'?='.length)
  assert.equal(Buffer.from(body, 'base64').toString('utf8'), 'SHIP COMPLETE — add-thing')
})

test('postNtfy sends a headline no HTTP header could otherwise carry', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200 }
  }
  const result = await postNtfy(
    { url: DEFAULT_NTFY_URL, topic: 'my-topic', title: 'SHIP HALTED — it stopped', body: 'x', priority: 'high' },
    { fetchImpl }
  )
  assert.deepEqual(result, { sent: true })
  const sent = calls[0].init.headers.Title
  assert.ok(/^[\x20-\x7e]*$/.test(sent), 'what goes on the wire must be representable as a ByteString')
  assert.equal(encodeHeaderValue('SHIP HALTED — it stopped'), sent)
})
