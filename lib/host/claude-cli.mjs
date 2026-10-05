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
//   --permission-prompts none    only outside bypass, only when --help lists it
//   prompt on stdin
//
// Beside the result, every spawn reports a HOST RECORD (design D7): what the
// envelope said about the spawn whatever the exit code, plus the models the
// lane session's own transcript names. The runner forwards it to the CLI on
// `--host-records`; the CLI decides every banner from it.
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

import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isSafeSegment, summarizeTranscriptFile } from '../agent-usage.mjs'
import { assertWorkflowHost, execCapture, mapPipeline, runCli } from '../host.mjs'
import { projectSlug } from '../project-slug.mjs'
import { MAX_AGENT_ERRORS, MAX_TEXT } from '../run-log.mjs'
import { CLAUDE_COMMAND_ENV, claudeCommandArgv, parseClaudeVersion } from './claude-env.mjs'
import { EFFORT_REASONS, effortRoutingEvent, resolveEffort } from './effort.mjs'
import { parseModelMap, resolveModel } from './model-map.mjs'

/**
 * Override the binary, for a wrapper or a fixture. Defined in `./claude-env.mjs`
 * — the doctor resolves the binary too, and may not load this adapter to do it.
 */
export { CLAUDE_COMMAND_ENV }

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
 * How long the one-time `--help` probe may take before it is given up as
 * failed (design D30). A transport timeout, not a loop cap.
 */
const DEFAULT_PROBE_TIMEOUT_MS = 10 * 1000

/**
 * The unattended default, kept on the strength of the live probe above: a
 * PreToolUse `deny` still blocks under it, so the guards this repository ships
 * are in force and the run does not stall on a prompt nobody can answer.
 */
export const DEFAULT_PERMISSION_MODE = 'bypassPermissions'

/** The mode that never prompts, so there is no prompt to suppress under it. */
const BYPASS_PERMISSION_MODE = 'bypassPermissions'

/**
 * The run's banner when prompts cannot be suppressed (design D10). The adapter
 * raises it; the runner forwards it to the close through `--host-banners`.
 */
export const PERMISSION_PROMPTS_BANNER =
  'PERMISSION PROMPTS NOT SUPPRESSED (claude): the installed CLI does not list --permission-prompts, ' +
  'so a lane that needs a person waits'

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
 * @param {string|null} [opts.effort]       the effort level to pass, or null; only ever set on a verified-flag host
 * @param {string} opts.permissionMode
 * @param {string|null} opts.plugin         `--plugin-dir` target, or null
 * @param {'flag'|'unsupported'} [opts.permissionPrompts]  the help probe's verdict on
 *   `--permission-prompts`; only `flag` ever passes it (design D10)
 * @returns {string[]}
 */
export function claudeArgs(req, { model, effort, permissionMode, plugin, permissionPrompts } = {}) {
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
  // Directly after --model, and only when the caller verified the flag exists:
  // a CLI that does not know it rejects the whole invocation (design D30).
  if (typeof effort === 'string' && effort) args.push('--effort', effort)
  const mode = permissionMode || DEFAULT_PERMISSION_MODE
  args.push('--permission-mode', mode)
  // Directly after the mode it qualifies, only on a CLI whose help lists it (a
  // CLI that does not know it rejects the whole invocation), and never under
  // bypass, which asks nobody anything, so the default unattended argv is
  // unchanged (design D10). Session persistence is deliberately left ON: the
  // lane's transcript is where its served models are read, and a persisted
  // session is one an operator can resume.
  if (permissionPrompts === 'flag' && mode !== BYPASS_PERMISSION_MODE) {
    args.push('--permission-prompts', 'none')
  }
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

/** A plain object, not an array and not null. */
function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** A non-empty string from the envelope, or `null` for a field it omitted or could not have meant. */
function envelopeText(value) {
  return typeof value === 'string' && value ? value : null
}

/** One envelope error as bounded text: a string as it came, anything else as its JSON. */
function errorText(entry) {
  if (typeof entry === 'string') return entry
  if (isRecord(entry) && typeof entry.message === 'string') return entry.message
  try {
    return JSON.stringify(entry) ?? ''
  } catch {
    return ''
  }
}

/**
 * The host's observation of one spawn, read off the envelope (design D7).
 *
 * Every field is copied BY NAME and is `null` when the envelope omits it or
 * carries a value of the wrong type — never a `0`, `false` or `[]` standing in
 * for something the host did not say. Two fields are not copied but derived:
 *
 *   - `sessionModels` is the key list of `modelUsage`, the envelope's per-model
 *     breakdown. It is SESSION-scoped: every captured envelope listed a
 *     host-internal `bedrock.claude-haiku-4-5` call beside the session's own
 *     model, even on a one-turn run with no tool, so these keys say which models
 *     the session called, not which one served the lane's turns. The adapter
 *     reads that turn-scoped list from the lane's transcript instead
 *     ({@link readLaneTranscript}).
 *   - `resultMissing` is a success with no object `structured_output` on an exit
 *     that was not a non-zero integer — anthropics/claude-code#82258.
 *
 * `hostCostUsd` is `total_cost_usd`, which is a CLIENT-SIDE ESTIMATE the CLI
 * computes from its own price list. It is carried as the host's figure, never
 * summed with or substituted for `MODEL_PRICES` dollars.
 */
function hostRecord(envelope, exitCode, timedOut) {
  const errors = Array.isArray(envelope.errors)
    ? envelope.errors
        .map(errorText)
        .filter(text => text.trim())
        .slice(0, MAX_AGENT_ERRORS)
        .map(text => text.slice(0, MAX_TEXT))
    : null
  const denials = Array.isArray(envelope.permission_denials)
    ? {
        count: envelope.permission_denials.length,
        // The tool names only. A denial's `tool_input` — a command line, a file
        // body — never travels into the record.
        tools: [
          ...new Set(
            envelope.permission_denials
              .map(denial => (isRecord(denial) ? envelopeText(denial.tool_name) : null))
              .filter(Boolean)
          )
        ]
      }
    : null
  const subtype = envelopeText(envelope.subtype)
  const numTurns = envelope.num_turns
  const structured = envelope.structured_output
  return {
    parsed: true,
    subtype,
    isError: typeof envelope.is_error === 'boolean' ? envelope.is_error : null,
    terminalReason: envelopeText(envelope.terminal_reason),
    errors,
    permissionDenials: denials,
    sessionId: envelopeText(envelope.session_id),
    numTurns: Number.isInteger(numTurns) && numTurns >= 0 ? numTurns : null,
    sessionModels: isRecord(envelope.modelUsage) ? Object.keys(envelope.modelUsage) : null,
    hostCostUsd: envelopeCount(envelope.total_cost_usd) ?? null,
    exitCode,
    timedOut,
    resultMissing:
      subtype === 'success' && !(exitCode !== null && exitCode !== 0) && !isRecord(structured)
  }
}

/** The record of a spawn whose stdout was not an envelope: the exit, and nothing invented. */
function unparsedRecord(exitCode, timedOut) {
  return {
    parsed: false,
    subtype: null,
    isError: null,
    terminalReason: null,
    errors: null,
    permissionDenials: null,
    sessionId: null,
    numTurns: null,
    sessionModels: null,
    hostCostUsd: null,
    exitCode,
    timedOut,
    resultMissing: null
  }
}

/**
 * The result, the usage and the host record out of the CLI's JSON envelope.
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
 * `host` is always an object (design D7): what the host said about the spawn,
 * read whatever the exit code, so a lane the host stopped is named by the
 * host's own subtype rather than by "no result". It travels beside the result
 * on the adapter's events, never inside it.
 *
 * @param {string} stdout
 * @param {{exitCode?: number|null, timedOut?: boolean}} [opts]  what the process did, as the caller observed it
 * @returns {{result: object|null, usage: object|null, host: object}}
 */
export function readClaudeEnvelope(stdout, { exitCode = null, timedOut = false } = {}) {
  const exit = Number.isInteger(exitCode) ? exitCode : null
  const timed = timedOut === true
  let envelope
  try {
    envelope = JSON.parse(typeof stdout === 'string' ? stdout : '')
  } catch {
    return { result: null, usage: null, host: unparsedRecord(exit, timed) }
  }
  if (!isRecord(envelope)) return { result: null, usage: null, host: unparsedRecord(exit, timed) }
  const host = hostRecord(envelope, exit, timed)
  const structured = envelope.structured_output
  const result = isRecord(structured) ? structured : null
  const usage = envelope.usage && typeof envelope.usage === 'object' ? envelope.usage : null
  if (!usage) return { result, usage: null, host }
  const cache = readCacheUsage(usage)
  return {
    result,
    usage: {
      inputTokens: envelopeCount(usage.input_tokens),
      outputTokens: envelopeCount(usage.output_tokens),
      // Spread, so an envelope with no cache fields carries no cache keys at all
      // — absent, which is what "this spawn was not measured for cache" means.
      ...(cache || {})
    },
    host
  }
}

/**
 * The models that served a lane's own turns, read from the lane session's
 * transcript (design D7).
 *
 * The envelope's `modelUsage` is session-scoped (see {@link readClaudeEnvelope});
 * the transcript names the model of every assistant turn the lane itself took,
 * which is the TURN-scoped observation a substitution verdict prefers. The host
 * writes it at `<config>/projects/<projectSlug(realpath(cwd))>/<sessionId>.jsonl`,
 * `<config>` being `CLAUDE_CONFIG_DIR` when set and `$HOME/.claude` otherwise —
 * the layout the 2.1.274 probe's `transcript_path` showed, with the cwd
 * realpath'd. It exists because the adapter never disables session persistence.
 *
 * Observation only, never a verdict, and it never throws: a transcript that
 * cannot be read is `servedModels: null` with the reason, and the record keeps
 * its session-scoped models, so the verdict degrades to the session scope
 * rather than to nothing.
 *
 * @param {{cwd?: string, sessionId?: string|null, env?: Record<string, string|undefined>}} [opts]
 * @returns {{servedModels: string[]|null, reason: string|null}}
 */
export function readLaneTranscript({ cwd, sessionId, env } = {}) {
  const absent = reason => ({ servedModels: null, reason })
  try {
    if (!isSafeSegment(sessionId)) {
      return absent(`the session id ${JSON.stringify(sessionId ?? null)} cannot name a transcript file`)
    }
    if (typeof cwd !== 'string' || !cwd) return absent('the spawn named no working directory')
    const source = env && typeof env === 'object' ? env : {}
    const config =
      (typeof source.CLAUDE_CONFIG_DIR === 'string' && source.CLAUDE_CONFIG_DIR.trim()) ||
      join((typeof source.HOME === 'string' && source.HOME.trim()) || homedir(), '.claude')
    let real
    try {
      real = realpathSync(cwd)
    } catch (err) {
      return absent(`the lane directory ${cwd} could not be resolved: ${(err && err.code) || (err && err.message) || err}`)
    }
    const path = join(config, 'projects', projectSlug(real), `${sessionId}.jsonl`)
    if (!existsSync(path)) return absent(`no lane transcript at ${path}`)
    const summary = summarizeTranscriptFile(path)
    if (!summary.transcript.parsed) return absent(summary.reason || `the lane transcript at ${path} could not be read`)
    if (!Array.isArray(summary.models) || !summary.models.length) {
      return absent(`the lane transcript at ${path} names no served model${summary.reason ? ` (${summary.reason})` : ''}`)
    }
    return { servedModels: summary.models, reason: null }
  } catch (err) {
    return absent(`the lane transcript could not be read: ${(err && err.message) || err}`)
  }
}

/**
 * Ask the installed CLI's own help which of the probed flags it lists (design
 * D30, D10): `--effort` and `--permission-prompts`, from ONE `--help` run, so
 * the adapter's one-time probe stays one spawn however many flags sit behind it.
 *
 * Synchronous on purpose: the runner reads `host.capabilities` immediately after
 * creation and sends them to `run start`. Never throws; a probe that cannot
 * answer is `unsupported` for every flag, effort with its own reason, so the
 * degradation is spoken and no unverified flag is ever sent.
 *
 * @param {string} bin
 * @param {string[]} [fixedArgs]
 * @param {{cwd?: string, env?: object, timeoutMs?: number}} [opts]
 * @returns {{effort: {capability: 'flag'|'unsupported', reason: string|null}, permissionPrompts: 'flag'|'unsupported'}}
 */
export function probeHelpFlags(bin, fixedArgs = [], { cwd = process.cwd(), env = process.env, timeoutMs } = {}) {
  const failed = { effort: { capability: 'unsupported', reason: EFFORT_REASONS.probeFailed }, permissionPrompts: 'unsupported' }
  try {
    const out = spawnSync(bin, [...(Array.isArray(fixedArgs) ? fixedArgs : []), '--help'], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_PROBE_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      input: ''
    })
    if (out.error || out.status !== 0) return failed
    const help = `${out.stdout || ''}\n${out.stderr || ''}`
    // An option line that declares the flag — `  --effort <level>` or
    // `  -e, --effort <level>` — not any mention of it. Help prose that names
    // a flag (a deprecation note, another option's description) must not pass
    // a flag the CLI would then reject on every spawn.
    const lists = flag => new RegExp(`^[ \\t]*(?:-[A-Za-z0-9],[ \\t]*)?--${flag}(?=[\\s=<[]|$)`, 'm').test(help)
    return {
      effort: lists('effort')
        ? { capability: 'flag', reason: null }
        : { capability: 'unsupported', reason: EFFORT_REASONS.noFlag },
      permissionPrompts: lists('permission-prompts') ? 'flag' : 'unsupported'
    }
  } catch {
    return failed
  }
}

/**
 * The same `--help` probe the Claude adapter runs, for a caller that is not
 * building that host.
 *
 * The Workflow runtime applies effort through `agent()`, which this process
 * cannot watch. What it can watch is whether the installed CLI lists `--effort`.
 * `interlock run start --host workflow` records that verdict instead of
 * assuming the flag. The command is `$INTERLOCK_CLAUDE_COMMAND` or `claude`,
 * split on whitespace the same way {@link createClaudeHost} splits it.
 *
 * @param {Record<string, string|undefined>} [env]
 * @param {{probeTimeoutMs?: number, cwd?: string}} [opts]
 * @returns {{capability: 'flag'|'unsupported', reason: string|null}}
 */
export function probeClaudeEffort(env = process.env, { probeTimeoutMs, cwd = process.cwd() } = {}) {
  const source = env && typeof env === 'object' ? env : {}
  const raw =
    (typeof source[CLAUDE_COMMAND_ENV] === 'string' && source[CLAUDE_COMMAND_ENV].trim()) || 'claude'
  const argv = String(raw).trim().split(/\s+/)
  return probeHelpFlags(argv[0], argv.slice(1), {
    cwd,
    env: source,
    timeoutMs: Number.isInteger(probeTimeoutMs) && probeTimeoutMs > 0 ? probeTimeoutMs : DEFAULT_PROBE_TIMEOUT_MS
  }).effort
}

/**
 * Ask the installed CLI its version, for `interlock run start --host workflow`
 * (design D2). The run program reads the model-routing variables from its own
 * environment, and what they mean depends on the host: from 2.1.251 the plain
 * subagent-model variable sets only the default. This is how the run learns
 * which side of that line it is on.
 *
 * Same command, same split and same timeout as {@link probeClaudeEffort}.
 * Never throws: a probe that cannot answer is `{ version: null, reason }`, and
 * the run takes the conservative reading and says the version was unknown.
 *
 * @param {Record<string, string|undefined>} [env]
 * @param {{probeTimeoutMs?: number, cwd?: string}} [opts]
 * @returns {{version: string|null, reason: string|null}}
 */
export function probeClaudeVersion(env = process.env, { probeTimeoutMs, cwd = process.cwd() } = {}) {
  try {
    const source = env && typeof env === 'object' ? env : {}
    const [bin, ...fixedArgs] = claudeCommandArgv(source)
    const named = [bin, ...fixedArgs, '--version'].join(' ')
    const out = spawnSync(bin, [...fixedArgs, '--version'], {
      cwd,
      env: source,
      encoding: 'utf8',
      timeout: Number.isInteger(probeTimeoutMs) && probeTimeoutMs > 0 ? probeTimeoutMs : DEFAULT_PROBE_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      input: ''
    })
    if (out.error) return { version: null, reason: `\`${named}\` failed: ${out.error.message}` }
    if (out.status !== 0) {
      return { version: null, reason: `\`${named}\` exited ${out.status === null ? `on ${out.signal}` : out.status}` }
    }
    const version = parseClaudeVersion(out.stdout || '')
    return version
      ? { version, reason: null }
      : { version: null, reason: `\`${named}\` printed no version` }
  } catch (err) {
    return { version: null, reason: `the version probe could not run: ${(err && err.message) || String(err)}` }
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
 * @param {number} [opts.probeTimeoutMs]  wall clock for the one-time `--help` probe
 * @param {(event: object) => void} [opts.onEvent]
 */
export function createClaudeHost({ command, cwd = process.cwd(), env = process.env, timeoutMs, probeTimeoutMs, onEvent } = {}) {
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
  // Probed once, here, so the verdicts are in `capabilities` before any spawn.
  const flags = probeHelpFlags(bin, fixedArgs, {
    cwd,
    env: source,
    timeoutMs: Number.isInteger(probeTimeoutMs) && probeTimeoutMs > 0 ? probeTimeoutMs : DEFAULT_PROBE_TIMEOUT_MS
  })
  const probe = flags.effort
  const permissionPrompts = flags.permissionPrompts

  const host = {
    command: [bin, ...fixedArgs].join(' '),
    // The only capability this adapter can observe about itself. Everything else
    // is the registry's static declaration.
    capabilities: { ...(plugin ? {} : { hooks: false }), effort: probe.capability },
    // What this host degraded on, raised once at creation: the runner folds
    // these into the close through `--host-banners` beside its own. A run that
    // could prompt (any mode but bypass) on a CLI that cannot be told not to is
    // a lane that waits for a person nobody sent (design D10).
    banners: Object.freeze(
      permissionMode !== BYPASS_PERMISSION_MODE && permissionPrompts !== 'flag' ? [PERMISSION_PROMPTS_BANNER] : []
    ),

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
      // Resolved from this host's own probe, not from an effective capability a
      // host built without `createHost` would not have.
      const effort = resolveEffort(request.effort, probe.capability, probe.reason)
      if (!plugin && onEvent) {
        onEvent({ type: 'agent-prefix-skipped', label, reason: 'this checkout is not the interlock plugin' })
      }

      const laneCwd = typeof request.cwd === 'string' && request.cwd ? request.cwd : cwd
      const { code, stdout, stderr, timedOut, started: ran } = await execCapture(
        bin,
        [
          ...fixedArgs,
          ...claudeArgs(request, { model: routed.value, effort: effort.value, permissionMode, plugin, permissionPrompts })
        ],
        {
          cwd: laneCwd,
          env: source,
          input: request.prompt,
          timeoutMs: budget
        }
      )
      // After the process started, not before: "applied" means the flag reached
      // a CLI that ran, and a spawn that never started is only a failed spawn.
      const routedEffort = ran ? effortRoutingEvent(label, effort) : null
      if (routedEffort && onEvent) onEvent(routedEffort)

      // The envelope is read WHATEVER the exit code (design D7): a lane the host
      // stopped prints its reason — `error_max_turns`, the errors — on stdout,
      // and a failed spawn that discarded it would be named only "no result".
      const envelope = readClaudeEnvelope(stdout, { exitCode: code, timedOut })
      const transcript = envelope.host.sessionId
        ? readLaneTranscript({ cwd: laneCwd, sessionId: envelope.host.sessionId, env: source })
        : { servedModels: null, reason: 'the envelope named no session id, so no lane transcript was read' }
      // The host's observation, on its own channel beside the result (design
      // D7). The runner forwards it to the CLI, which decides every banner.
      const hostSeen = {
        ...envelope.host,
        servedModels: transcript.servedModels,
        transcriptReason: transcript.reason,
        // The value this spawn was sent after the map, which is what a served
        // model is compared against — not the planner's slug.
        modelRouted: routed.value ?? null,
        usage: envelope.usage
      }

      if (code !== 0) {
        if (onEvent) {
          onEvent({
            type: 'spawn-failed',
            label,
            code,
            timedOut,
            error: stderr.trim().slice(-500) || `claude exited ${code}`,
            host: hostSeen
          })
        }
        return null
      }

      const { result, usage } = envelope
      if (onEvent) {
        onEvent({ type: 'spawn-done', label, ms: Date.now() - started, parsed: Boolean(result), usage, host: hostSeen })
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
