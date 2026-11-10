// The session suggestion (session-advice, design D1, D3, D8, D16, D18): which
// model and effort a person's own session suits for a skill, read from the
// published table, and how the session it is asked in compares.
//
// The values live in `lib/limits.mjs` (`SESSION_ADVICE`, `SESSION_ADVICE_BASIS`);
// this module is their only reader, the way `lib/routing.mjs` is the only
// reader of `SPAWN_ROUTING`. It advises and never selects: it chooses no model,
// sets no effort and writes nothing. It reads only the environment it is handed.
//
// What is observed: the session's effort, from `CLAUDE_EFFORT`, which the host
// sets in a Bash tool subprocess to the live level. What is not: the session's
// model, which no variable carries, so the text says `not observed` and the JSON
// says `null`. A value that is unset, blank, unknown or in another case is
// unobserved, never a default level.
//
// A name with no row throws an `AdviceError` naming the advised skills; the
// binary turns that into exit 1 with nothing on stdout, so a skill never reads a
// default as a suggestion.
//
// Node-free: `lib/checkpoint-card.mjs` imports `adviceLine`, and the hooks module
// imports the card. Imports only `./limits.mjs` and `./host/effort.mjs`, which
// import nothing.

import { SESSION_ADVICE, SESSION_ADVICE_BASIS } from './limits.mjs'
import { effortLevelOverride, EFFORT_LEVEL_ENV } from './host/effort.mjs'

/** The skills the table advises, in table order. */
export const ADVISED_SKILLS = Object.freeze(Object.keys(SESSION_ADVICE))

/** The models a row may name. */
export const SESSION_MODELS = Object.freeze(['sonnet', 'opus', 'fable'])

/** The effort levels, in rising order. */
export const EFFORT_LEVELS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'])

/** The variable the host sets to the session's live effort. */
const SESSION_EFFORT_ENV = 'CLAUDE_EFFORT'

/** Thrown for a name the table has no row for. */
export class AdviceError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AdviceError'
  }
}

/** The row for a skill, with its optional fields as `null`; throws for a name with none. */
function rowOf(skill) {
  if (typeof skill !== 'string' || !Object.hasOwn(SESSION_ADVICE, skill)) {
    throw new AdviceError(
      `interlock: no session suggestion for ${JSON.stringify(skill ?? null)} — advised skills: ${ADVISED_SKILLS.join(', ')}`
    )
  }
  const row = SESSION_ADVICE[skill]
  return {
    model: row.model,
    effort: row.effort,
    upTo: row.upTo ?? null,
    best: row.best ? { model: row.best.model, effort: row.best.effort } : null
  }
}

/** The suggestion line's words after the skill's name. */
function cellOf(row) {
  return (
    `model ${row.model} · effort ${row.effort}` +
    (row.upTo ? `, up to ${row.upTo}` : '') +
    (row.best ? ` · best results: model ${row.best.model} · effort ${row.best.effort}` : '')
  )
}

/**
 * The suggestion line for one skill: the table's words alone, with nothing
 * about the session it is read in. The checkpoint card prints it for `ship`.
 *
 * @param {string} skill one of `ADVISED_SKILLS`
 * @returns {string}
 * @throws {AdviceError} a name with no row
 */
export function adviceLine(skill) {
  return `session suggestion for ${skill}: ${cellOf(rowOf(skill))}`
}

/** The observed session: its effort when `CLAUDE_EFFORT` holds a known level, and never its model. */
function observedOf(env) {
  const raw = env && typeof env === 'object' ? env[SESSION_EFFORT_ENV] : undefined
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  return { effort: EFFORT_LEVELS.includes(trimmed) ? trimmed : null, model: null }
}

/** The override banner, when `CLAUDE_CODE_EFFORT_LEVEL` is set and not blank. */
function bannersOf(env) {
  const override = effortLevelOverride(env)
  return override
    ? [
        `EFFORT SUGGESTION OVERRIDDEN: ${EFFORT_LEVEL_ENV}=${override} — ` +
          `/effort does not change this session's effort while it is set`
      ]
    : []
}

/** `below`, `within` or `above` the row's range, or `unobserved`. */
function fitOf(row, effort) {
  if (effort === null) return 'unobserved'
  const at = EFFORT_LEVELS.indexOf(effort)
  if (at < EFFORT_LEVELS.indexOf(row.effort)) return 'below'
  if (at <= EFFORT_LEVELS.indexOf(row.upTo ?? row.effort)) return 'within'
  return 'above'
}

/** How the session compares, and what was not observed. */
function sessionLine(observed, fit) {
  const effort = observed.effort === null ? 'effort not observed' : `effort ${observed.effort}, ${fit} the suggestion`
  return `this session: ${effort} · model not observed`
}

/**
 * What a person types to follow the row. The model is never observed, so a row
 * with a best-results pair names both models and tells a session on either one
 * to stay.
 */
function followLine(row) {
  const model = row.best
    ? `/model ${row.model} (or /model ${row.best.model} for best results) if this session is on neither`
    : `/model ${row.model} if this session is on another model`
  return (
    `to follow it: /effort ${row.effort}, and ${model}; ` +
    'change models at a break in the work, because the first turn on a new model rewrites the prompt cache'
  )
}

/**
 * One skill's suggestion, compared with the session's observed effort.
 *
 * `lines` holds the suggestion line, the session line and, when the fit is not
 * `within`, the follow line; `banners` holds the override banner when one is set.
 *
 * @param {string} skill one of `ADVISED_SKILLS`
 * @param {Record<string, string|undefined>} [env]
 * @returns {{skill: string, model: string, effort: string, upTo: string|null,
 *   best: {model: string, effort: string}|null, basis: string,
 *   observed: {effort: string|null, model: null}, fit: 'below'|'within'|'above'|'unobserved',
 *   banners: string[], lines: string[]}}
 * @throws {AdviceError} a name with no row
 */
export function resolveAdvice(skill, env = {}) {
  const row = rowOf(skill)
  const observed = observedOf(env)
  const fit = fitOf(row, observed.effort)
  const lines = [adviceLine(skill), sessionLine(observed, fit)]
  if (fit !== 'within') lines.push(followLine(row))
  return {
    skill,
    model: row.model,
    effort: row.effort,
    upTo: row.upTo,
    best: row.best,
    basis: SESSION_ADVICE_BASIS,
    observed,
    fit,
    banners: bannersOf(env),
    lines
  }
}

/**
 * Every row, and the observation, with no fit: there is no single row to
 * compare the session with.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {{basis: string, skills: Record<string, {model: string, effort: string,
 *   upTo: string|null, best: {model: string, effort: string}|null}>,
 *   observed: {effort: string|null, model: null}, banners: string[], lines: string[]}}
 */
export function listAdvice(env = {}) {
  const skills = {}
  for (const skill of ADVISED_SKILLS) skills[skill] = rowOf(skill)
  return {
    basis: SESSION_ADVICE_BASIS,
    skills,
    observed: observedOf(env),
    banners: bannersOf(env),
    lines: ADVISED_SKILLS.map(adviceLine)
  }
}

/**
 * The text `interlock suggest` prints for a `resolveAdvice` or `listAdvice`
 * result: its lines, then each banner. Lives here rather than in `cli/interlock`
 * to keep that file under its size limit.
 *
 * @param {ReturnType<typeof resolveAdvice> | ReturnType<typeof listAdvice>} out
 * @returns {string}
 */
export function formatAdvice(out) {
  return [...out.lines, ...out.banners].join('\n') + '\n'
}
