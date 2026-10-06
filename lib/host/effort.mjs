// The effort resolver every adapter shares (design D18, D19, D21, D29, D32).
//
// A spawn's effort comes from the run program, which read it off the published
// table in `lib/limits.mjs`. Whether a host can apply it, and the reason when it
// cannot, are decided here, once: the runner prints these verdicts and may not
// word one of its own, and each adapter passes its own capability literal and
// reason in, because the registry imports the adapters and the reverse import is
// not available. `lib/host/model-map.mjs` is the precedent for the shape.
//
// Pure: no I/O, and no import of an adapter.

/**
 * Every reason a named effort can go unapplied. Each is true of the host that
 * gives it — a host with no per-spawn channel, a host whose channel the adapter
 * does not route, and a CLI that lacks the flag each say a different thing.
 * `docs/04-when-it-stops.md` carries each of these verbatim.
 */
export const EFFORT_REASONS = Object.freeze({
  // `qwen`, and any capability this module does not know.
  noControl: 'host has no effort control',
  // `codex` (D29): a real knob exists; sending it a Claude-derived label would
  // be a cross-vendor mapping this module does not make.
  notRouted: 'effort is not routed on this host',
  // `claude` (D30), when its own help does not list the flag.
  noFlag: 'this claude CLI has no --effort flag',
  // `claude` (D30), when the help probe fails or times out.
  probeFailed: 'could not establish whether this claude CLI accepts --effort',
  // `acp`: the agent offered no effort option for this session.
  noOption: 'no effort option advertised',
  // `acp`: the option exists, and the level is not one of its flat values.
  notAdvertised: 'level not among advertised values',
  // `acp`: `session/set_config_option` failed.
  rejected: 'agent rejected the effort option'
})

/**
 * The variable the Claude CLI reads, which outranks `--effort`, `/effort`,
 * settings and a subagent's own `effort` (D16). It is the operator's: it is
 * bannered, never stripped (D26).
 */
export const EFFORT_LEVEL_ENV = 'CLAUDE_CODE_EFFORT_LEVEL'

/**
 * The operator's exported effort override, trimmed, or `''` when it is unset or
 * blank.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {string}
 */
export function effortLevelOverride(env) {
  const raw = env && typeof env === 'object' ? env[EFFORT_LEVEL_ENV] : undefined
  return typeof raw === 'string' ? raw.trim() : ''
}

/** A level as requested, or `''` when none was named. */
function levelOf(level) {
  return typeof level === 'string' ? level.trim() : ''
}

/**
 * The verdict for a flag host or a host with no effort channel.
 *
 * The level is passed through unvalidated (D11): the published table is the
 * authority, and a vendor CLI falls back on a level its model lacks. On a flag
 * host "applied" means the flag was passed (D24) — the adapter cannot see past
 * its own argv and does not claim to.
 *
 * Only `flag` applies. `unsupported`, and any capability this module does not
 * know, resolve to not applied with the reason given — fail open, and spoken. A
 * `negotiated` host does not come through here: it negotiates per session with
 * {@link findEffortOption} and {@link pickEffortValue}.
 *
 * @param {string} [level]       the spawn's effort, as the step named it
 * @param {string} [capability]  the adapter's own `effort` capability literal
 * @param {string} [reason]      what this host says when it cannot apply one
 * @returns {{requested: string|null, applied: boolean, via: string|null, value: string|null, reason: string|null}}
 */
export function resolveEffort(level, capability, reason) {
  const requested = levelOf(level)
  if (!requested) return { requested: null, applied: false, via: null, value: null, reason: null }
  if (capability === 'flag') return { requested, applied: true, via: 'flag', value: requested, reason: null }
  return {
    requested,
    applied: false,
    via: null,
    value: null,
    reason: typeof reason === 'string' && reason ? reason : EFFORT_REASONS.noControl
  }
}

/**
 * The effort-routing event for one spawn, or `null` when the spawn named no
 * effort and so must raise none.
 *
 * A flag or no-channel adapter emits it once the spawn's process has started,
 * never before: a spawn that fails to start is a failed spawn, counted neither
 * as applied nor as unapplied.
 *
 * @param {string} label
 * @param {ReturnType<typeof resolveEffort>} effort
 * @returns {object|null}
 */
export function effortRoutingEvent(label, effort) {
  if (!effort || !effort.requested) return null
  return {
    type: 'effort-routing',
    label,
    requested: effort.requested,
    applied: effort.applied,
    via: effort.via,
    value: effort.value,
    reason: effort.reason
  }
}

/**
 * The agent's effort option, found by its conventional id or by the reserved
 * `thought_level` category (D19) — the same two-way rule the model option is
 * found by. A model option is never returned.
 *
 * @param {unknown} configOptions the config options the agent returned most recently
 * @returns {object|null}
 */
export function findEffortOption(configOptions) {
  if (!Array.isArray(configOptions)) return null
  return (
    configOptions.find(
      o =>
        o &&
        typeof o === 'object' &&
        o.id !== 'model' &&
        o.category !== 'model' &&
        (o.id === 'effort' || o.category === 'thought_level')
    ) || null
  )
}

/**
 * Which advertised value a level means — exactly, or not at all (D18, D32).
 *
 * Exact equality on a flat `options[].value` only. No substring rule, because
 * `high` is inside `xhigh` and an agent rejects a wrong value outright; no
 * display-name rule; no operator map, which would be the cross-vendor mapping
 * D29 declines. A grouped or non-select option is not read, so a level offered
 * only inside a group is not among the advertised values.
 *
 * @param {string} [level]
 * @param {object|null} [option] {@link findEffortOption}'s result
 * @returns {{value: string|null, reason: string|null}}
 */
export function pickEffortValue(level, option) {
  const wanted = levelOf(level)
  if (!wanted) return { value: null, reason: null }
  if (!option || typeof option !== 'object') return { value: null, reason: EFFORT_REASONS.noOption }
  if (option.type !== undefined && option.type !== 'select') {
    return { value: null, reason: EFFORT_REASONS.notAdvertised }
  }
  const flat = Array.isArray(option.options)
    ? option.options.filter(o => o && typeof o === 'object' && typeof o.value === 'string')
    : []
  const hit = flat.find(o => o.value === wanted)
  return hit ? { value: hit.value, reason: null } : { value: null, reason: EFFORT_REASONS.notAdvertised }
}
