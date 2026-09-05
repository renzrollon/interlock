// The `codex` host adapter (design D4).
//
// OpenAI's Codex CLI in its non-interactive mode. One `codex exec` per spawn,
// prompt on stdin, result in a file the CLI writes.
//
// The contract, verified against `codex exec --help` on codex-cli 0.145.0:
//
//   --output-schema <FILE>        JSON Schema the final response must satisfy
//   -o, --output-last-message <FILE>   where the final message is written
//   --json                        events to stdout as JSONL
//   -C, --cd <DIR>                the agent's working root
//   -s, --sandbox <MODE>          read-only | workspace-write | danger-full-access
//   -m, --model <MODEL>
//   prompt on stdin (or `-`)
//
// One flag design D4 named does NOT exist on this version: `--ask-for-approval`
// is rejected by `codex exec` with "unexpected argument". `exec` is the
// non-interactive mode and never prompts, so the flag was redundant as well as
// wrong; it is dropped and the finding is recorded in the change's design.md.
// `--dangerously-bypass-approvals-and-sandbox` is deliberately NOT used in its
// place — it removes the sandbox, and `workspace-write` is the posture a ship
// lane wants.
//
// Two degradations this host carries, both declared and both bannered by the
// runner rather than discovered later:
//
//   hooks: false   Codex has no equivalent of this repository's PreToolUse
//                  guards, so nothing stops a repair step from weakening a test
//                  except the CLI's own unit-suite shrink check.
//   modelSelect: 'map-only'   the planner's slugs (`haiku`/`sonnet`/`opus`) mean
//                  nothing here, so a spawn with no INTERLOCK_MODEL_MAP entry
//                  runs on whatever the operator configured, and says so.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertWorkflowHost, execCapture, mapPipeline, runCli } from '../host.mjs'
import { parseModelMap, resolveModel } from './model-map.mjs'

/** Override the binary, for a wrapper or a fixture. */
export const CODEX_COMMAND_ENV = 'INTERLOCK_CODEX_COMMAND'

/** Optional per-spawn wall clock, in ms. 0 disables it. */
export const CODEX_TIMEOUT_ENV = 'INTERLOCK_CODEX_TIMEOUT_MS'

/**
 * The two variables whose ABSENCE means the run is spending a ChatGPT plan's
 * device-auth session rather than an API key. Named here because the runner
 * banners the condition and the docs explain it (design D8).
 */
export const CODEX_KEY_ENVS = Object.freeze(['CODEX_API_KEY', 'OPENAI_API_KEY'])

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

/** True when neither key is set, i.e. the run is on a ChatGPT login. */
export function onChatGptPlan(env = {}) {
  return CODEX_KEY_ENVS.every(name => !(env && typeof env[name] === 'string' && env[name].trim()))
}

/**
 * The exact argv one spawn sends. One function, pinned by a test against the
 * fixture, so a vendor flag change is one edit.
 *
 * @param {object} opts
 * @param {string} opts.cwd            the lane's worktree, or the repo root
 * @param {string} opts.schemaPath     the `--output-schema` file
 * @param {string} opts.outputPath     the `-o` file
 * @param {string|null} opts.model     resolved model id, or null for unrouted
 * @returns {string[]}
 */
export function codexArgs({ cwd, schemaPath, outputPath, model } = {}) {
  const args = ['exec', '--json']
  if (schemaPath) args.push('--output-schema', schemaPath)
  args.push('-o', outputPath, '-C', cwd, '--sandbox', 'workspace-write')
  if (typeof model === 'string' && model) args.push('--model', model)
  return args
}

/**
 * The last token count the JSONL event stream reported, in the receipt's units.
 *
 * Best-effort by construction: the event stream is a vendor surface with no
 * stability promise, so an unrecognised stream yields `null` — unknown — rather
 * than a zero that would read as a run that produced no tokens.
 *
 * @param {string} stdout the JSONL on stdout
 * @returns {{inputTokens?: number, outputTokens?: number}|null}
 */
export function readCodexUsage(stdout) {
  const lines = (typeof stdout === 'string' ? stdout : '').split('\n')
  let latest = null
  for (const line of lines) {
    const text = line.trim()
    if (!text || text[0] !== '{') continue
    let event
    try {
      event = JSON.parse(text)
    } catch {
      continue
    }
    const found = findUsage(event, 0)
    if (found) latest = found
  }
  return latest
}

/** The first `{input_tokens, output_tokens}`-shaped object anywhere in an event. */
function findUsage(value, depth) {
  if (!value || typeof value !== 'object' || depth > 6) return null
  if (Number.isFinite(value.output_tokens) || Number.isFinite(value.input_tokens)) {
    return {
      inputTokens: Number.isFinite(value.input_tokens) ? value.input_tokens : undefined,
      outputTokens: Number.isFinite(value.output_tokens) ? value.output_tokens : undefined
    }
  }
  for (const nested of Object.values(value)) {
    const found = findUsage(nested, depth + 1)
    if (found) return found
  }
  return null
}

/**
 * Build a {@link import('../host.mjs').WorkflowHost} backed by `codex exec`.
 *
 * @param {object} [opts]
 * @param {string} [opts.command]  defaults to `$INTERLOCK_CODEX_COMMAND` or `codex`
 * @param {string} [opts.cwd]
 * @param {object} [opts.env]
 * @param {number} [opts.timeoutMs]
 * @param {(event: object) => void} [opts.onEvent]
 */
export function createCodexHost({ command, cwd = process.cwd(), env = process.env, timeoutMs, onEvent } = {}) {
  const source = env && typeof env === 'object' ? env : {}
  const raw = (typeof command === 'string' && command.trim()) || source[CODEX_COMMAND_ENV] || 'codex'
  const argv = String(raw).trim().split(/\s+/)
  const bin = argv[0]
  const fixedArgs = argv.slice(1)
  const budget = Number.isInteger(timeoutMs)
    ? timeoutMs
    : Number.parseInt(source[CODEX_TIMEOUT_ENV] || '', 10) || DEFAULT_TIMEOUT_MS
  const modelMap = parseModelMap(source)

  const host = {
    command: [bin, ...fixedArgs].join(' '),
    chatGptPlan: onChatGptPlan(source),

    async spawn(req) {
      const request = req && typeof req === 'object' ? req : {}
      const label = typeof request.label === 'string' ? request.label : 'agent'
      const started = Date.now()
      const routed = resolveModel('codex', request.model, modelMap, { modelSelect: 'map-only' })
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

      const scratch = mkdtempSync(join(tmpdir(), 'interlock-codex-'))
      const outputPath = join(scratch, 'last-message.json')
      const schemaPath = request.schema ? join(scratch, 'schema.json') : null
      try {
        // Written rather than passed inline: `--output-schema` takes a path.
        if (schemaPath) writeFileSync(schemaPath, JSON.stringify(request.schema))
        const { code, stdout, stderr, timedOut } = await execCapture(
          bin,
          [
            ...fixedArgs,
            ...codexArgs({
              cwd: typeof request.cwd === 'string' && request.cwd ? request.cwd : cwd,
              schemaPath,
              outputPath,
              model: routed.value
            })
          ],
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
              // The stderr tail is the whole diagnostic on this host: a stale
              // device-auth token surfaces here and nowhere else.
              error: stderr.trim().slice(-500) || `codex exited ${code}`
            })
          }
          return null
        }

        let result = null
        try {
          const parsed = JSON.parse(readFileSync(outputPath, 'utf8'))
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) result = parsed
        } catch {
          result = null
        }
        const usage = readCodexUsage(stdout)
        if (onEvent) {
          onEvent({ type: 'spawn-done', label, ms: Date.now() - started, parsed: Boolean(result), usage })
        }
        if (!result) return null
        return usage ? { ...result, usage } : result
      } finally {
        rmSync(scratch, { recursive: true, force: true })
      }
    },

    mapPipeline,

    runCli(argv2, opts = {}) {
      return runCli(argv2, { cwd, env: source, ...opts })
    }
  }

  return assertWorkflowHost(host, 'codex host')
}
