// The `claude` host adapter (design D3).
//
// Interlock's default host is the Claude Code Workflow runtime, reached through
// `/interlock:ship`. This adapter is the other way to reach the same model: the
// installed `claude` binary in headless print mode, one process per spawn.
//
// The contract, verified against Claude Code's own `--help` and one live probe
// on 2026-09-05:
//
//   claude -p --output-format json --json-schema <schema>   envelope on stdout
//   envelope.structured_output   the schema-validated object (schemaEnforced)
//   envelope.usage               { input_tokens, output_tokens, ... }
//   --agent <id> --model <slug> --permission-mode <mode> --allowedTools <list>
//   prompt on stdin
//
// Two things are worth stating because they are not obvious:
//
//   1. `--permission-mode bypassPermissions` does NOT disarm this repository's
//      guards. A live probe (a PreToolUse hook returning `permissionDecision:
//      "deny"` under that mode) confirmed the tool call was blocked and recorded
//      in `permission_denials`. So the unattended default stays
//      `bypassPermissions` and `hooks` stays declared `true`; the fallback D3
//      named — `dontAsk` plus `--allowedTools` — was not needed. The finding is
//      recorded in the change's design.md.
//
//   2. The plugin's agents (`interlock:worker`, `interlock:ping`) and its hooks
//      only exist in a session that loaded the plugin. A headless `claude` in a
//      lane worktree has loaded nothing, so the adapter passes `--plugin-dir`
//      naming this checkout. That is what makes `--agent` resolvable and `hooks:
//      true` an honest declaration rather than an assumption about the operator's
//      installation. If the checkout does not look like the plugin, no `--agent`
//      is passed and the host declares `hooks: false` — spoken, never silent.
//
// Billing: this is `claude -p`, which is the programmatic path Anthropic flagged
// for separate metered credit. The runner banners it (design D8); the adapter
// only declares which path it is on.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertWorkflowHost, execCapture, mapPipeline, runCli } from '../host.mjs'
import { parseModelMap, resolveModel } from './model-map.mjs'

/** Override the binary, for a wrapper or a fixture. */
export const CLAUDE_COMMAND_ENV = 'INTERLOCK_CLAUDE_COMMAND'

/** Override the unattended permission mode. */
export const CLAUDE_PERMISSION_MODE_ENV = 'INTERLOCK_CLAUDE_PERMISSION_MODE'

/** Optional per-spawn wall clock, in ms. 0 disables it. */
export const CLAUDE_TIMEOUT_ENV = 'INTERLOCK_CLAUDE_TIMEOUT_MS'

/**
 * A transport timeout, not a loop cap — the same distinction the ACP adapter
 * draws. Every number the LOOP obeys is published by `interlock limits`.
 */
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

/**
 * The unattended default, kept on the strength of the live probe above: a
 * PreToolUse `deny` still blocks under it, so the guards this repository ships
 * are in force and the run does not stall on a prompt nobody can answer.
 */
export const DEFAULT_PERMISSION_MODE = 'bypassPermissions'

/** This checkout, if it is the Interlock plugin — the directory `--plugin-dir` names. */
export function pluginRoot() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  return existsSync(join(root, '.claude-plugin', 'plugin.json')) && existsSync(join(root, 'agents'))
    ? root
    : null
}

/**
 * The exact argv one spawn sends. One function, so a drifted vendor flag is one
 * edit and one pinned test rather than a scattered rewrite.
 *
 * @param {object} req                      the step's spawn request
 * @param {object} opts
 * @param {string|null} opts.model          the resolved model id, or null
 * @param {string} opts.permissionMode
 * @param {string|null} opts.plugin         `--plugin-dir` target, or null
 * @returns {string[]}
 */
export function claudeArgs(req, { model, permissionMode, plugin } = {}) {
  const request = req && typeof req === 'object' ? req : {}
  const args = ['-p', '--output-format', 'json']
  if (request.schema) args.push('--json-schema', JSON.stringify(request.schema))
  if (plugin) args.push('--plugin-dir', plugin)
  // Only with the plugin loaded: an `--agent` naming a type the session cannot
  // resolve is an invocation error, and an invocation error reads as a model
  // that failed rather than as a host that was misconfigured.
  if (plugin && typeof request.type === 'string' && request.type.trim()) {
    args.push('--agent', request.type.trim())
  }
  if (typeof model === 'string' && model) args.push('--model', model)
  args.push('--permission-mode', permissionMode || DEFAULT_PERMISSION_MODE)
  if (Array.isArray(request.tools) && request.tools.length) {
    args.push('--allowedTools', request.tools.join(','))
  }
  return args
}

/**
 * The prompt-cache lifetime tiers the vendor's usage envelope reports cache
 * creation under, and the envelope field each one arrives in.
 *
 * Facts about the host's wire format, not Interlock thresholds, so they are
 * named constants in the module that reads them — the convention every
 * `INTERLOCK_*` reader above already follows.
 *
 * They are kept APART, never summed (design D7). A prefix written for five
 * minutes and one written for an hour are different prices; a single total
 * cannot be priced and the flattening cannot be undone by any later reader.
 */
export const CACHE_TIER_FIELDS = Object.freeze({
  ephemeral_5m: 'ephemeral_5m_input_tokens',
  ephemeral_1h: 'ephemeral_1h_input_tokens'
})

/** A finite non-negative count from the envelope, or `undefined` for a field it omitted. */
function envelopeCount(value) {
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * The cache half of a usage envelope, or `null` where it carries none.
 *
 * `undefined` for an omitted field, NEVER `0`: a host that did not report a
 * figure and a host that measured none are different facts, and substituting a
 * zero would make the second out of the first everywhere downstream. A tier the
 * envelope omits is absent; a tier it reports as zero is a measured zero.
 */
function readCacheUsage(usage) {
  const read = envelopeCount(usage.cache_read_input_tokens)
  const creation =
    usage.cache_creation && typeof usage.cache_creation === 'object' ? usage.cache_creation : null
  const write = {}
  for (const [tier, field] of Object.entries(CACHE_TIER_FIELDS)) {
    const value = creation ? envelopeCount(creation[field]) : undefined
    if (value !== undefined) write[tier] = value
  }
  const hasWrite = Object.keys(write).length > 0
  if (read === undefined && !hasWrite) return null
  return {
    ...(read === undefined ? {} : { cacheReadInputTokens: read }),
    ...(hasWrite ? { cacheCreationInputTokens: write } : {})
  }
}

/**
 * The result and the usage out of the CLI's JSON envelope.
 *
 * `structured_output` is the whole result: the CLI validated it against the
 * schema, so there is nothing to recover from prose the way the ACP adapter has
 * to. An envelope without it is a spawn that produced no result — `null`, and
 * the CLI decides what a null costs.
 *
 * An envelope that is PRESENT AND UNPARSEABLE is a host that did not report,
 * not a host that reported nothing: both halves come back `null` and every
 * downstream figure is absent rather than zero.
 *
 * @param {string} stdout
 * @returns {{result: object|null, usage: object|null}}
 */
export function readClaudeEnvelope(stdout) {
  let envelope
  try {
    envelope = JSON.parse(typeof stdout === 'string' ? stdout : '')
  } catch {
    return { result: null, usage: null }
  }
  if (!envelope || typeof envelope !== 'object') return { result: null, usage: null }
  const structured = envelope.structured_output
  const result =
    structured && typeof structured === 'object' && !Array.isArray(structured) ? structured : null
  const usage = envelope.usage && typeof envelope.usage === 'object' ? envelope.usage : null
  if (!usage) return { result, usage: null }
  const cache = readCacheUsage(usage)
  return {
    result,
    usage: {
      inputTokens: envelopeCount(usage.input_tokens),
      outputTokens: envelopeCount(usage.output_tokens),
      // Spread, so an envelope with no cache fields carries no cache keys at all
      // — absent, which is what "this spawn was not measured for cache" means.
      ...(cache || {})
    }
  }
}

/**
 * Build a {@link import('../host.mjs').WorkflowHost} backed by `claude -p`.
 *
 * @param {object} [opts]
 * @param {string} [opts.command]  defaults to `$INTERLOCK_CLAUDE_COMMAND` or `claude`
 * @param {string} [opts.cwd]      repo root; a spawn's own `cwd` overrides it per lane
 * @param {object} [opts.env]
 * @param {number} [opts.timeoutMs]
 * @param {(event: object) => void} [opts.onEvent]
 */
export function createClaudeHost({ command, cwd = process.cwd(), env = process.env, timeoutMs, onEvent } = {}) {
  const source = env && typeof env === 'object' ? env : {}
  const raw = (typeof command === 'string' && command.trim()) || source[CLAUDE_COMMAND_ENV] || 'claude'
  const argv = String(raw).trim().split(/\s+/)
  const bin = argv[0]
  const fixedArgs = argv.slice(1)
  const permissionMode = source[CLAUDE_PERMISSION_MODE_ENV] || DEFAULT_PERMISSION_MODE
  const budget = Number.isInteger(timeoutMs)
    ? timeoutMs
    : Number.parseInt(source[CLAUDE_TIMEOUT_ENV] || '', 10) || DEFAULT_TIMEOUT_MS
  // Parsed once, here: a malformed map fails host creation rather than a wave.
  const modelMap = parseModelMap(source)
  const plugin = pluginRoot()

  const host = {
    command: [bin, ...fixedArgs].join(' '),
    // The only capability this adapter can observe about itself. Everything else
    // is the registry's static declaration.
    capabilities: plugin ? {} : { hooks: false },

    async spawn(req) {
      const request = req && typeof req === 'object' ? req : {}
      const label = typeof request.label === 'string' ? request.label : 'agent'
      const started = Date.now()
      const routed = resolveModel('claude', request.model, modelMap, { modelSelect: 'flag' })
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
      if (!plugin && onEvent) {
        onEvent({ type: 'agent-prefix-skipped', label, reason: 'this checkout is not the interlock plugin' })
      }

      const { code, stdout, stderr, timedOut } = await execCapture(
        bin,
        [...fixedArgs, ...claudeArgs(request, { model: routed.value, permissionMode, plugin })],
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
            error: stderr.trim().slice(-500) || `claude exited ${code}`
          })
        }
        return null
      }

      const { result, usage } = readClaudeEnvelope(stdout)
      if (onEvent) {
        onEvent({ type: 'spawn-done', label, ms: Date.now() - started, parsed: Boolean(result), usage })
      }
      if (!result) return null
      // Usage rides beside the result rather than inside it: the result's shape
      // is the step's schema, and an extra field there would fail a strict
      // consumer. `run close` reads this key by name (design D9).
      return usage ? { ...result, usage } : result
    },

    mapPipeline,

    runCli(argv2, opts = {}) {
      return runCli(argv2, { cwd, env: source, ...opts })
    }
  }

  return assertWorkflowHost(host, 'claude host')
}
