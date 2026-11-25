// The model and effort a prose skill passes when it spawns a subagent, resolved
// from the published tables (design D3, D7, D8, D15).
//
// The values live in `lib/limits.mjs` (`SPAWN_ROUTING`, `REVIEW_DEPTH`,
// `CALLER_DEPTH`); this module only looks them up, resolves a caller's depth, applies a row's `strict` override at the strict
// depth, and speaks the two environment overrides that make a printed value
// not the one in effect. It is called once per role from inside a skill, so it
// is a pure lookup: no subprocess, no version probe, no I/O. A `null` field
// stays `null` — the caller omits the parameter and the host's default applies.
//
// Unknown roles, depths and callers throw a `RoutingError` naming what is
// known; the binary turns that into a non-zero exit with nothing on stdout, so
// a skill never reads a default as a decision.
//
// Imports only `./limits.mjs`, `./host/claude-env.mjs` and `./host/effort.mjs`.

import { SPAWN_ROUTING, REVIEW_DEPTH, CALLER_DEPTH } from './limits.mjs'
import { observeClaudeEnv } from './host/claude-env.mjs'
import { effortLevelOverride, EFFORT_LEVEL_ENV } from './host/effort.mjs'

/** The roles the table holds, in table order. */
export const ROUTING_ROLES = Object.freeze(Object.keys(SPAWN_ROUTING))

/** The depths the depth table holds: every key but `default`. */
export const REVIEW_DEPTHS = Object.freeze(Object.keys(REVIEW_DEPTH).filter(key => key !== 'default'))

/** The callers the caller-depth table names for any role, in table order. */
export const ROUTING_CALLERS = Object.freeze([...new Set(Object.values(CALLER_DEPTH).flatMap(row => Object.keys(row)))])

/** The depth that carries a row's `strict` override. */
const STRICT_DEPTH = 'strict'

/**
 * The strict depth's always-on dimensions, in dispatch order: the set a ship
 * run selects for every review. Exported so `lib/prompts/dimensions.mjs` keeps
 * no second copy and this module stays the one reader of `REVIEW_DEPTH`.
 */
export const STRICT_ALWAYS_ON_DIMENSIONS = Object.freeze([...REVIEW_DEPTH[STRICT_DEPTH].dimensions])

/** Thrown for an unknown role, depth or caller; `kind` is `role`, `depth` or `caller`. */
export class RoutingError extends Error {
  constructor(kind, message) {
    super(message)
    this.name = 'RoutingError'
    this.kind = kind
  }
}

function depthOf(depth) {
  const named = depth === undefined || depth === null ? REVIEW_DEPTH.default : depth
  if (typeof named !== 'string' || !REVIEW_DEPTHS.includes(named)) {
    throw new RoutingError(
      'depth',
      `interlock: unknown routing depth ${JSON.stringify(named)} — depths: ${REVIEW_DEPTHS.join(', ')}`
    )
  }
  return named
}

function callerError(message) {
  return new RoutingError('caller', `interlock: ${message} — callers: ${ROUTING_CALLERS.join(', ')}`)
}

/**
 * The caller named, checked against the caller-depth table, or null when none
 * was given. A caller the table names for no role is refused, never a default.
 */
function callerOf(caller) {
  if (caller === undefined || caller === null) return null
  if (typeof caller !== 'string' || !ROUTING_CALLERS.includes(caller)) {
    throw callerError(`unknown routing caller ${JSON.stringify(caller)}`)
  }
  return caller
}

function rowOf(role, depth) {
  if (typeof role !== 'string' || !Object.hasOwn(SPAWN_ROUTING, role)) {
    throw new RoutingError(
      'role',
      `interlock: unknown routing role ${JSON.stringify(role)} — roles: ${ROUTING_ROLES.join(', ')}`
    )
  }
  const row = SPAWN_ROUTING[role]
  const picked = depth === STRICT_DEPTH && row.strict ? row.strict : row
  return { model: picked.model ?? null, effort: picked.effort ?? null }
}

/**
 * What in the environment makes the printed routing not the one in effect, and
 * the words that say so (D7). `CLAUDE_CODE_SUBAGENT_MODEL` alone raises nothing
 * here: on current hosts it is only a default below a per-call parameter, and
 * whether this host is older is a version fact `interlock doctor` reports.
 *
 * @param {Record<string, string|undefined>} env
 */
function overridesOf(env) {
  const effortLevel = effortLevelOverride(env)
  const observed = observeClaudeEnv(env)
  const force = observed.subagentModelForceEnabled ? observed.subagentModelForce : null
  const banners = []
  if (effortLevel) {
    banners.push(
      `EFFORT ROUTING OVERRIDDEN: ${EFFORT_LEVEL_ENV}=${effortLevel} — every agent runs at that effort, ` +
        `so the effort this prints is not in effect`
    )
  }
  if (force !== null) {
    banners.push(
      `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL_FORCE=${force} — every agent runs on one model, ` +
        `so the model this prints is not in effect`
    )
  }
  return { banners, overrides: { effortLevel: effortLevel || null, subagentModelForce: force } }
}

/**
 * One role at a depth.
 *
 * @param {string} role  one of `ROUTING_ROLES`
 * @param {Record<string, string|undefined>} [env]
 * The depth is resolved in this order (design §5): `depth` when given; else
 * the depth `CALLER_DEPTH` gives the role for `caller`; else the published
 * default.
 *
 * @param {{depth?: string, caller?: string}} [options]  `depth` is `lean` or
 *   `strict`; `caller` is a skill `CALLER_DEPTH` names
 * @returns {{role: string, depth: string, caller: string|null, model: string|null, effort: string|null,
 *   banners: string[], overrides: {effortLevel: string|null, subagentModelForce: string|null}}}
 * @throws {RoutingError} an unknown role, depth or caller
 */
export function resolveRouting(role, env = {}, { depth, caller } = {}) {
  const named = callerOf(caller)
  const given = depth !== undefined && depth !== null
  const row = typeof role === 'string' && Object.hasOwn(CALLER_DEPTH, role) ? CALLER_DEPTH[role] : null
  const fromCaller = !given && named !== null && row && Object.hasOwn(row, named) ? row[named] : undefined
  const resolved = depthOf(given ? depth : fromCaller)
  const { model, effort } = rowOf(role, resolved)
  const { banners, overrides } = overridesOf(env)
  return { role, depth: resolved, caller: named, model, effort, banners, overrides }
}

/**
 * Every role at a depth, and the depth's review shape.
 *
 * @param {Record<string, string|undefined>} [env]
 * A caller depth is a role's, so a `caller` with no role is refused.
 *
 * @param {{depth?: string, caller?: string}} [options]
 * @returns {{depth: string, roles: Record<string, {model: string|null, effort: string|null}>,
 *   review: {dimensions: string[], skeptics: string},
 *   banners: string[], overrides: {effortLevel: string|null, subagentModelForce: string|null}}}
 * @throws {RoutingError} an unknown depth, or any caller
 */
export function listRouting(env = {}, { depth, caller } = {}) {
  if (caller !== undefined && caller !== null) throw callerError('--caller names a role\'s caller and needs a role')
  const named = depthOf(depth)
  const roles = {}
  for (const role of ROUTING_ROLES) roles[role] = rowOf(role, named)
  const row = REVIEW_DEPTH[named]
  const { banners, overrides } = overridesOf(env)
  return {
    depth: named,
    roles,
    review: { dimensions: [...row.dimensions], skeptics: row.skeptics },
    banners,
    overrides
  }
}

/**
 * The text `interlock routing` prints for a `resolveRouting` or `listRouting`
 * result: its routing lines, then each banner. Lives here rather than in
 * `cli/interlock` to keep that file under the plugin directory's size headroom.
 *
 * @param {ReturnType<typeof resolveRouting> | ReturnType<typeof listRouting>} out
 * @returns {string}
 */
export function formatRouting(out) {
  const cell = r => `model ${r.model ?? 'inherit'} · effort ${r.effort ?? 'inherit'}`
  const lines = out.role
    ? [`routing ${out.role} (${out.depth}${out.caller ? `, caller ${out.caller}` : ''}): ${cell(out)}`]
    : [
        `depth: ${out.depth}`,
        ...Object.entries(out.roles).map(([role, r]) => `routing ${role}: ${cell(r)}`),
        `review dimensions: ${out.review.dimensions.join(', ')}`,
        `review skeptics: ${out.review.skeptics}`
      ]
  return [...lines, ...out.banners].join('\n') + '\n'
}
