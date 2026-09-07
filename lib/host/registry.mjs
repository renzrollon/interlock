// The host registry (design D1).
//
// `bin/interlock-run` is an interpreter of the program `interlock run` emits. It
// spawns what a step names and calls the argv a step names. The only thing that
// differs between running that program over Claude Code, over an ACP agent, over
// Codex or over Qwen is the transport — so a host is one file under this
// directory implementing the three-function port in `../host.mjs`, plus a
// declaration of what it cannot do.
//
// The declaration is the load-bearing half. Every adapter states the same six
// facts, and the run program reads them rather than branching on an id:
//
//   schemaEnforced  does the CLI itself validate the result against the schema
//   modelSelect     'flag' | 'negotiated' | 'map-only' — how a slug becomes a model
//   worktree        'driver' | 'runtime' — who creates a lane's worktree
//   hooks           do this repository's PreToolUse guards fire on this host
//   usage           does the CLI report token usage
//   billing         which account the run spends against
//
// A capability that were merely implied by the adapter's code would be a
// capability nothing could banner, and every one of these describes a way a run
// is WEAKER than the default host. `test/spine/host-registry.test.mjs` asserts
// each adapter declares every key, so a fifth adapter cannot arrive with a
// silently absent one.
//
// The Workflow host is deliberately absent: it is reached through
// `/interlock:ship`, it owns its own worktrees (`worktree: 'runtime'`), and the
// runner refuses its id (design D10).

import { createAcpHost, isClaudeCodeBinary, parseAcpCommand, ACP_COMMAND_ENV } from './acp.mjs'
import { createClaudeHost } from './claude-cli.mjs'
import { createCodexHost } from './codex.mjs'
import { createQwenHost } from './qwen.mjs'

/** Every fact an adapter must declare. Order is the order a banner reads them. */
export const CAPABILITY_KEYS = Object.freeze([
  'schemaEnforced',
  'modelSelect',
  'worktree',
  'hooks',
  'usage',
  'billing'
])

/** The allowed value of each declared capability. */
export const CAPABILITY_VALUES = Object.freeze({
  schemaEnforced: Object.freeze([true, false]),
  modelSelect: Object.freeze(['flag', 'negotiated', 'map-only']),
  worktree: Object.freeze(['driver', 'runtime']),
  hooks: Object.freeze([true, false]),
  usage: Object.freeze([true, false]),
  billing: Object.freeze(['claude-subscription-programmatic', 'chatgpt-plan-or-api', 'local'])
})

/**
 * The Workflow host's id. Not an adapter — the runner refuses it, and `run
 * start` treats a run without declared capabilities as this one (design D10).
 * What that assumption CONTAINS is stated once, in `lib/run.mjs`, because the
 * run program is the only party that reads it.
 */
export const WORKFLOW_HOST_ID = 'workflow'

export const HOSTS = Object.freeze({
  claude: {
    id: 'claude',
    create: opts => createClaudeHost(opts),
    capabilities: Object.freeze({
      schemaEnforced: true,
      modelSelect: 'flag',
      worktree: 'driver',
      hooks: true,
      usage: true,
      billing: 'claude-subscription-programmatic'
    })
  },
  acp: {
    id: 'acp',
    create: opts => createAcpHost(opts),
    // Declared for the general case — an arbitrary agent behind
    // `INTERLOCK_ACP_COMMAND`. The adapter refines `hooks` and `billing` at
    // creation when that command turns out to be the Claude binary, because a
    // run that IS spending a Claude subscription must say so (design D8).
    capabilities: Object.freeze({
      schemaEnforced: false,
      modelSelect: 'negotiated',
      worktree: 'driver',
      hooks: false,
      usage: false,
      billing: 'local'
    })
  },
  codex: {
    id: 'codex',
    create: opts => createCodexHost(opts),
    capabilities: Object.freeze({
      schemaEnforced: true,
      modelSelect: 'map-only',
      worktree: 'driver',
      hooks: false,
      usage: true,
      billing: 'chatgpt-plan-or-api'
    })
  },
  qwen: {
    id: 'qwen',
    create: opts => createQwenHost(opts),
    capabilities: Object.freeze({
      schemaEnforced: true,
      modelSelect: 'map-only',
      worktree: 'driver',
      hooks: false,
      usage: false,
      billing: 'local'
    })
  }
})

/** Every adapter id the runner accepts, for a message that names them. */
export const HOST_IDS = Object.freeze(Object.keys(HOSTS))

/**
 * Create the adapter an id names.
 *
 * Throws on an unknown id and on the Workflow host, both before any step runs:
 * a run that started and then discovered it had no host would already have
 * written a manifest and a trajectory for a run that never happened.
 *
 * @param {string} id
 * @param {object} [opts] passed through to the adapter's factory
 * @returns {import('../host.mjs').WorkflowHost & {capabilities: object}}
 */
export function createHost(id, opts = {}) {
  const wanted = typeof id === 'string' ? id.trim() : ''
  if (wanted === WORKFLOW_HOST_ID) {
    throw new Error(
      'the Workflow runtime is reached through /interlock:ship, not the runner — ' +
        `known runner hosts: ${HOST_IDS.join(', ')}`
    )
  }
  const entry = HOSTS[wanted]
  if (!entry) {
    throw new Error(`unknown host "${wanted || '(none)'}" — known hosts: ${HOST_IDS.join(', ')}`)
  }
  const host = entry.create(opts)
  return Object.assign(host, {
    id: entry.id,
    capabilities: effectiveCapabilities(entry, host)
  })
}

/**
 * The declared capabilities, refined by anything the created host observed
 * about itself.
 *
 * Only ACP refines today, and only downward-to-honest: a `claude` binary behind
 * `INTERLOCK_ACP_COMMAND` means the run does have this repository's hooks and is
 * spending a Claude subscription, and declaring otherwise would suppress the two
 * banners that matter most on that path.
 *
 * @param {{capabilities: object}} entry
 * @param {object} host
 * @returns {object}
 */
function effectiveCapabilities(entry, host) {
  const declared = { ...entry.capabilities }
  const observed = host && typeof host.capabilities === 'object' && host.capabilities ? host.capabilities : {}
  for (const key of CAPABILITY_KEYS) {
    if (observed[key] !== undefined) declared[key] = observed[key]
  }
  return declared
}

/**
 * Whether a host id, as configured, drives the Claude binary — directly or
 * through ACP. The `SUBSCRIPTION PATH` banner's condition (design D8).
 *
 * @param {string} id
 * @param {Record<string, string|undefined>} [env]
 * @param {string} [acpCommand] an explicit --acp-command, which beats the env
 * @returns {boolean}
 */
export function drivesClaudeBinary(id, env = {}, acpCommand) {
  if (id === 'claude') return true
  if (id !== 'acp') return false
  const raw = typeof acpCommand === 'string' && acpCommand.trim()
    ? acpCommand
    : (env && env[ACP_COMMAND_ENV]) || ''
  try {
    return isClaudeCodeBinary(parseAcpCommand(raw).command)
  } catch {
    // An unusable command is not a Claude run; the adapter's own creation error
    // is what the operator will see.
    return false
  }
}
