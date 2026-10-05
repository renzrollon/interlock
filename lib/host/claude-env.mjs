// The Claude Code environment a Workflow run's routing reads (design D1, D2).
//
// Pure, and imports nothing: `lib/run.mjs` and `lib/doctor.mjs` both read it,
// and neither may load an adapter — adapters spawn vendor binaries. This module
// only parses. The spawn that learns the host's version lives beside the effort
// probe in `./claude-cli.mjs`; what the run does with the reading is decided in
// `decideHostEnvironment` in `lib/run.mjs`.
//
// Every name and number below is a fact about Claude Code, not an Interlock
// threshold, so each is a named constant in the module that reads it — the
// convention every `INTERLOCK_*` reader follows. The two version floors are the
// load-bearing ones:
//
//   SUBAGENT_MODEL_DEFAULT_ONLY_MIN_VERSION  from 2.1.251 `CLAUDE_CODE_SUBAGENT_MODEL`
//     sets only the DEFAULT subagent model; a model named at spawn time wins.
//     Below it the variable replaces every agent's model. If the task-1 probe in
//     the change's design.md shows a spawn-time model does NOT win on a current
//     host, this constant becomes `null`, which disables the default-only reading
//     on every version — a one-constant revert, which is why it is a constant.
//   SUBAGENT_MODEL_FORCE_MIN_VERSION  from 2.1.257 `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`
//     forces one model onto every agent. Below it the variable is inert.
//   MODS_MIN_HOST_VERSION  from 2.1.287 a plugin's hooks module (hooks/hooks.json
//     `modules`) loads, so the ship meter draws. Below it the module is not
//     loaded and the run is exactly today's; doctor's `mods` row is advice only.

/** Override the binary, for a wrapper or a fixture. Read by the adapter, the doctor and the probes. */
export const CLAUDE_COMMAND_ENV = 'INTERLOCK_CLAUDE_COMMAND'

export const SUBAGENT_MODEL_ENV = 'CLAUDE_CODE_SUBAGENT_MODEL'
export const SUBAGENT_MODEL_FORCE_ENV = 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE'
export const WORKFLOW_MAX_CONCURRENT_ENV = 'CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS'
/** Advice only: Workflow `agent()` calls are unaffected by agent teams. */
export const AGENT_TEAMS_ENV = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'
/** Either one set routes the session through Bedrock, where haiku is often unreachable. */
export const BEDROCK_ENVS = Object.freeze(['CLAUDE_CODE_USE_BEDROCK', 'AWS_BEDROCK'])

export const SUBAGENT_MODEL_DEFAULT_ONLY_MIN_VERSION = '2.1.251'
export const SUBAGENT_MODEL_FORCE_MIN_VERSION = '2.1.257'
export const MODS_MIN_HOST_VERSION = '2.1.287'

/** The vendor's accepted range for the concurrency override. Outside it, the value is not a count. */
export const WORKFLOW_MAX_CONCURRENT_RANGE = Object.freeze({ min: 1, max: 256 })

/**
 * The installed CLI's command line: `$INTERLOCK_CLAUDE_COMMAND` or `claude`,
 * split on whitespace — the same split the adapter applies to the same variable.
 *
 * @returns {string[]} `[bin, ...fixedArgs]`
 */
export function claudeCommandArgv(env) {
  const raw = env && typeof env[CLAUDE_COMMAND_ENV] === 'string' ? env[CLAUDE_COMMAND_ENV].trim() : ''
  return (raw || 'claude').split(/\s+/)
}

/**
 * The first `major.minor.patch` in the output of `claude --version`
 * (`2.1.274 (Claude Code)`), or null. Unknown stays unknown: nothing here
 * guesses a version from anything else.
 */
export function parseClaudeVersion(text) {
  if (typeof text !== 'string') return null
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text)
  return m ? `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}` : null
}

/**
 * Compare two versions numerically, part by part. Returns -1, 0 or 1, or null
 * when either side does not parse — never a guess at an order.
 */
export function compareVersions(a, b) {
  const left = parseClaudeVersion(a)
  const right = parseClaudeVersion(b)
  if (!left || !right) return null
  const x = left.split('.').map(Number)
  const y = right.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  }
  return 0
}

/** A variable's trimmed value, or null when it is unset or blank. */
function valueOf(env, name) {
  const raw = env && typeof env[name] === 'string' ? env[name].trim() : ''
  return raw || null
}

/**
 * Whether a switch-like variable is on: non-empty and not `0` or `false` — the
 * test the validate ping applied to the Bedrock variables, kept exactly.
 */
function enabled(value) {
  return value !== null && !['0', 'false'].includes(value.toLowerCase())
}

/**
 * What the environment, the host version and the machine say, before anything
 * is decided from them. The raw observation is what a run stores on its
 * manifest, so a later reader sees exactly what the decision saw.
 *
 * Throws only if `env` itself throws on read; every caller that hands it an
 * environment it does not own wraps the call.
 *
 * @param {Record<string, string|undefined>} env
 * @param {{version?: string|null, cpuCount?: number|null}} [host]
 */
export function observeClaudeEnv(env, { version = null, cpuCount = null } = {}) {
  const force = valueOf(env, SUBAGENT_MODEL_FORCE_ENV)
  const teams = valueOf(env, AGENT_TEAMS_ENV)
  const rawSlots = valueOf(env, WORKFLOW_MAX_CONCURRENT_ENV)
  let maxConcurrent = null
  if (rawSlots !== null) {
    const n = /^\d+$/.test(rawSlots) ? Number(rawSlots) : NaN
    const valid =
      Number.isInteger(n) && n >= WORKFLOW_MAX_CONCURRENT_RANGE.min && n <= WORKFLOW_MAX_CONCURRENT_RANGE.max
    maxConcurrent = { raw: rawSlots, value: valid ? n : null, valid }
  }
  return {
    version: parseClaudeVersion(version),
    subagentModel: valueOf(env, SUBAGENT_MODEL_ENV),
    subagentModelForce: force,
    subagentModelForceEnabled: force !== null && enabled(force),
    maxConcurrent,
    agentTeams: teams,
    bedrock: BEDROCK_ENVS.filter(name => {
      const value = valueOf(env, name)
      return value !== null && enabled(value)
    }),
    cpuCount: Number.isInteger(cpuCount) && cpuCount > 0 ? cpuCount : null
  }
}

/**
 * The version-aware reading of the two model variables (design D1's table),
 * shared by the run program's decision and the doctor's advice so the two
 * cannot read one environment two ways.
 *
 * An unreadable version takes the conservative reading on both: FORCE is
 * effective and the plain variable overrides.
 */
export function readModelRouting(observation) {
  const o = observation && typeof observation === 'object' ? observation : {}
  const version = parseClaudeVersion(o.version)
  const known = version !== null
  const forceEffective =
    o.subagentModelForceEnabled === true && !(known && compareVersions(version, SUBAGENT_MODEL_FORCE_MIN_VERSION) < 0)
  const plain = typeof o.subagentModel === 'string' && o.subagentModel ? o.subagentModel : null
  const defaultOnly =
    !forceEffective &&
    plain !== null &&
    SUBAGENT_MODEL_DEFAULT_ONLY_MIN_VERSION !== null &&
    known &&
    compareVersions(version, SUBAGENT_MODEL_DEFAULT_ONLY_MIN_VERSION) >= 0
  return {
    version,
    versionKnown: known,
    forceEffective,
    // Set, on a host that predates the variable: it does nothing there.
    forceInert: o.subagentModelForceEnabled === true && !forceEffective,
    plainDefaultOnly: defaultOnly,
    plainOverrides: !forceEffective && plain !== null && !defaultOnly
  }
}

/**
 * The concurrency the runtime will honour, as far as this process can observe
 * it (design D5): the override when it is a valid count, otherwise the vendor
 * default — which the runtime may reduce on a small machine by an amount the
 * vendor does not publish, so the CPU count is recorded and no number is
 * invented. An invalid override is recorded with its raw text and otherwise
 * read as unset.
 */
export function runtimeSlotsOf(observation) {
  const o = observation && typeof observation === 'object' ? observation : {}
  const mc = o.maxConcurrent && typeof o.maxConcurrent === 'object' ? o.maxConcurrent : null
  const cpuCount = Number.isInteger(o.cpuCount) ? o.cpuCount : null
  if (mc && mc.valid) return { observed: mc.value, source: 'env', cpuCount }
  return { observed: null, source: 'vendor-default', cpuCount, ...(mc ? { invalid: mc.raw } : {}) }
}
