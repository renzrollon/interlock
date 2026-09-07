// The `qwen` host adapter (design D5).
//
// Qwen Code's non-interactive mode. One `qwen` process per spawn, prompt on
// stdin, a JSON envelope on stdout.
//
// The contract, verified against the installed CLI (qwen-code 0.22.2) on
// 2026-09-05:
//
//   -p, --prompt <text>       "Prompt. Appended to input on stdin (if any)."
//                             The briefing travels on stdin (design D2), so `-`
//                             is the placeholder the flag requires.
//   -o, --output-format json  text | json | stream-json
//   --json-schema <json>      accepted (absent from `--help`, accepted by the
//                             parser — verified by a live argv probe)
//   --yolo                    accepted, same as above; unattended tool approval
//   -m, --model <MODEL>       the model flag, spelled `-m`, verified in `--help`
//
// `--yolo` is the reason this host declares `hooks: false` twice over: Qwen has
// no equivalent of this repository's PreToolUse guards, AND its own approval
// prompt is disabled because there is nobody to answer it. The runner banners
// `HOOKS NOT IN FORCE (qwen)`, and the CLI's unit-suite shrink check stays the
// deterministic backstop.
//
// Providers are configured in Qwen's own `settings.json`, so an unmapped slug is
// not an error — it is a spawn that ran on the operator's default, which the
// runner names in `MODEL ROUTING UNAVAILABLE (qwen)` rather than passing off as
// the tier the planner asked for.

import { assertWorkflowHost, execCapture, mapPipeline, parseAgentJson, runCli } from '../host.mjs'
import { parseModelMap, resolveModel } from './model-map.mjs'

/** Override the binary, for a wrapper or a fixture. */
export const QWEN_COMMAND_ENV = 'INTERLOCK_QWEN_COMMAND'

/** Optional per-spawn wall clock, in ms. 0 disables it. */
export const QWEN_TIMEOUT_ENV = 'INTERLOCK_QWEN_TIMEOUT_MS'

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

/**
 * The exact argv one spawn sends.
 *
 * @param {object} req
 * @param {{model: string|null}} [opts]
 * @returns {string[]}
 */
export function qwenArgs(req, { model } = {}) {
  const request = req && typeof req === 'object' ? req : {}
  const args = ['-p', '-', '--output-format', 'json']
  if (request.schema) args.push('--json-schema', JSON.stringify(request.schema))
  args.push('--yolo')
  if (typeof model === 'string' && model) args.push('-m', model)
  return args
}

/**
 * The validated payload out of Qwen's JSON envelope.
 *
 * The envelope wraps the model's answer in a `response` field, which with
 * `--json-schema` is the validated object. Older shapes put it at the top level.
 * Both are read, and `parseAgentJson` recovers a payload that arrived as a
 * string — the CLI validated it, so recovering it from its own quoting is not
 * the same gamble the ACP adapter takes on free prose.
 *
 * @param {string} stdout
 * @returns {{result: object|null, usage: object|null}}
 */
export function readQwenEnvelope(stdout) {
  let envelope
  try {
    envelope = JSON.parse(typeof stdout === 'string' ? stdout : '')
  } catch {
    return { result: null, usage: null }
  }
  if (!envelope || typeof envelope !== 'object') return { result: null, usage: null }

  const candidate = envelope.response !== undefined ? envelope.response : envelope
  let result = null
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) result = candidate
  else if (typeof candidate === 'string') result = parseAgentJson(candidate)

  const stats = envelope.stats && typeof envelope.stats === 'object' ? envelope.stats : null
  const tokens = stats && stats.tokens && typeof stats.tokens === 'object' ? stats.tokens : null
  const usage =
    tokens && (Number.isFinite(tokens.output) || Number.isFinite(tokens.input))
      ? {
          inputTokens: Number.isFinite(tokens.input) ? tokens.input : undefined,
          outputTokens: Number.isFinite(tokens.output) ? tokens.output : undefined
        }
      : null

  return { result, usage }
}

/**
 * Build a {@link import('../host.mjs').WorkflowHost} backed by `qwen -p`.
 *
 * @param {object} [opts]
 * @param {string} [opts.command]  defaults to `$INTERLOCK_QWEN_COMMAND` or `qwen`
 * @param {string} [opts.cwd]
 * @param {object} [opts.env]
 * @param {number} [opts.timeoutMs]
 * @param {(event: object) => void} [opts.onEvent]
 */
export function createQwenHost({ command, cwd = process.cwd(), env = process.env, timeoutMs, onEvent } = {}) {
  const source = env && typeof env === 'object' ? env : {}
  const raw = (typeof command === 'string' && command.trim()) || source[QWEN_COMMAND_ENV] || 'qwen'
  const argv = String(raw).trim().split(/\s+/)
  const bin = argv[0]
  const fixedArgs = argv.slice(1)
  const budget = Number.isInteger(timeoutMs)
    ? timeoutMs
    : Number.parseInt(source[QWEN_TIMEOUT_ENV] || '', 10) || DEFAULT_TIMEOUT_MS
  const modelMap = parseModelMap(source)

  const host = {
    command: [bin, ...fixedArgs].join(' '),

    async spawn(req) {
      const request = req && typeof req === 'object' ? req : {}
      const label = typeof request.label === 'string' ? request.label : 'agent'
      const started = Date.now()
      const routed = resolveModel('qwen', request.model, modelMap, { modelSelect: 'map-only' })
      if (typeof request.model === 'string' && request.model && onEvent) {
        onEvent({
          type: 'model-routing',
          label,
          requested: request.model,
          applied: routed.applied,
          value: routed.value,
          via: routed.applied ? 'flag' : null,
          reason: routed.reason
        })
      }

      const { code, stdout, stderr, timedOut } = await execCapture(
        bin,
        [...fixedArgs, ...qwenArgs(request, { model: routed.value })],
        {
          cwd: typeof request.cwd === 'string' && request.cwd ? request.cwd : cwd,
          env: source,
          input: request.prompt,
          timeoutMs: budget
        }
      )

      if (code !== 0) {
        if (onEvent) {
          onEvent({
            type: 'spawn-failed',
            label,
            code,
            timedOut,
            error: stderr.trim().slice(-500) || `qwen exited ${code}`
          })
        }
        return null
      }

      const { result, usage } = readQwenEnvelope(stdout)
      if (onEvent) {
        onEvent({ type: 'spawn-done', label, ms: Date.now() - started, parsed: Boolean(result), usage })
      }
      if (!result) return null
      return usage ? { ...result, usage } : result
    },

    mapPipeline,

    runCli(argv2, opts = {}) {
      return runCli(argv2, { cwd, env: source, ...opts })
    }
  }

  return assertWorkflowHost(host, 'qwen host')
}
