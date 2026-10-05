// One published model map, read once, for every host (design D6).
//
// The planner assigns a tier slug — `haiku`, `sonnet`, `opus` — and that slug is
// a statement about how much judgement a lane needs, not about a vendor's
// catalogue. Every host has to answer the same question from it: which model id
// does this slug mean HERE. Four adapters answering it four ways is four places
// for a tier ladder to quietly stop applying, and a run whose cost profile was
// never applied looks exactly like one where it was.
//
// So the mapping is one environment variable, parsed once at startup, and the
// resolution is one function whose answer carries its own reason:
//
//   INTERLOCK_MODEL_MAP={"codex":{"sonnet":"gpt-5-codex"},"qwen":{"opus":"qwen3-max"}}
//
// `INTERLOCK_ACP_MODEL_MAP` predates it (`close-acp-model-routing`) and is
// folded in as the `acp` entry, so an operator who set it keeps working.
//
// Malformed is fatal at creation, never at wave three: a typo that surfaced
// halfway through a run would have already spent the tier ladder it broke.

/** The published map: host id → slug → that host's model id. */
export const MODEL_MAP_ENV = 'INTERLOCK_MODEL_MAP'

/** The ACP-only predecessor, folded in as the `acp` entry. */
export const ACP_MODEL_MAP_ENV = 'INTERLOCK_ACP_MODEL_MAP'

/**
 * Parse one host's slug → value object, from an already-parsed JSON value.
 *
 * @param {unknown} value
 * @param {string} where the variable path to name in an error
 * @returns {Record<string, string>}
 */
function parseHostEntry(value, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${where} must be a JSON object of model slug to that host's model id`)
  }
  for (const [slug, model] of Object.entries(value)) {
    if (typeof model !== 'string' || !model.trim()) {
      throw new Error(`${where}.${slug} must be a non-empty string`)
    }
  }
  return { ...value }
}

/**
 * Parse {@link MODEL_MAP_ENV} (and the ACP alias) into a host → slug → value map.
 *
 * Throws on anything that is not a JSON object of objects of non-empty strings.
 * The throw is the point: the runner parses this before its first step, so a
 * typo fails the invocation rather than three waves in.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {Record<string, Record<string, string>>}
 */
export function parseModelMap(env = {}) {
  const source = env && typeof env === 'object' ? env : {}
  const out = {}

  const raw = typeof source[MODEL_MAP_ENV] === 'string' ? source[MODEL_MAP_ENV].trim() : ''
  if (raw) {
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      throw new Error(`${MODEL_MAP_ENV} is not valid JSON: ${err.message}`)
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${MODEL_MAP_ENV} must be a JSON object keyed by host id`)
    }
    for (const [hostId, entry] of Object.entries(parsed)) {
      out[hostId] = parseHostEntry(entry, `${MODEL_MAP_ENV}.${hostId}`)
    }
  }

  // The alias wins for `acp` only where the newer variable said nothing about
  // that host: an operator mid-migration has both set, and silently discarding
  // the one they most recently wrote is the confusing half of either order.
  const legacy = typeof source[ACP_MODEL_MAP_ENV] === 'string' ? source[ACP_MODEL_MAP_ENV].trim() : ''
  if (legacy) {
    let parsed
    try {
      parsed = JSON.parse(legacy)
    } catch (err) {
      throw new Error(`${ACP_MODEL_MAP_ENV} is not valid JSON: ${err.message}`)
    }
    const entry = parseHostEntry(parsed, ACP_MODEL_MAP_ENV)
    out.acp = { ...entry, ...(out.acp || {}) }
  }

  return out
}

/**
 * What one host should do with one planner slug.
 *
 * Never guesses a nearest model and never substitutes a default: a wrong model
 * that ran is invisible in a summary, and an unapplied one that was bannered is
 * not. `applied: false` always carries the reason the runner prints.
 *
 * @param {string} hostId
 * @param {string} [slug]                     the planner's model, e.g. `sonnet`
 * @param {Record<string, Record<string, string>>} [map] {@link parseModelMap}'s output
 * @param {{modelSelect?: string}} [capabilities]
 * @returns {{value: string|null, applied: boolean, reason: string|null}}
 */
export function resolveModel(hostId, slug, map = {}, capabilities = {}) {
  const wanted = typeof slug === 'string' ? slug.trim() : ''
  if (!wanted) return { value: null, applied: false, reason: 'no model requested' }

  const forHost = map && typeof map === 'object' ? map[hostId] : undefined
  const mapped = forHost && typeof forHost === 'object' ? forHost[wanted] : undefined
  if (typeof mapped === 'string' && mapped) return { value: mapped, applied: true, reason: null }

  const kind = capabilities && typeof capabilities.modelSelect === 'string' ? capabilities.modelSelect : ''

  // The host's own CLI accepts the slug (Claude's `--model haiku`), so an
  // unmapped slug is routed rather than dropped.
  if (kind === 'flag') return { value: wanted, applied: true, reason: null }

  // The agent advertises its models and the adapter negotiates on the wire; the
  // map only supplies a preference. Whether it landed is the adapter's to say,
  // so nothing is claimed here.
  if (kind === 'negotiated') {
    return { value: null, applied: false, reason: 'negotiated with the agent at session creation' }
  }

  return { value: null, applied: false, reason: `no mapping for ${wanted}` }
}

/** The tier slugs a planner routes by, which match any id that carries the tier. */
const TIER_SLUGS = Object.freeze(['haiku', 'sonnet', 'opus'])

/** A model id as comparable tokens: lowercased, provider prefix and date stamp dropped. */
function modelTokens(value) {
  const tokens = String(value).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const claude = tokens.indexOf('claude')
  const rest = claude > 0 ? tokens.slice(claude) : tokens
  return rest.length > 1 && /^\d{8}$/.test(rest[rest.length - 1]) ? rest.slice(0, -1) : rest
}

/**
 * Whether a served model is the model a spawn was routed to (design D6).
 *
 * THE ONLY COMPARISON of a routed model against a served one, on either host:
 * `modelSubstitution` in `lib/run.mjs` calls it, and nothing else may.
 * Plain equality would banner every lane, because the run routes `sonnet` and
 * the host serves `claude-sonnet-5-5`; a prefix test misses `bedrock.`; a fuzzy
 * one is a guess, and a wrong model that ran would be invisible, which is the
 * failure the banner exists to name. So:
 *
 *   - both are lowercased and split on runs of non-alphanumerics;
 *   - every token before the first `claude` token is dropped (a provider prefix);
 *   - a trailing token of exactly eight digits is dropped (a date stamp);
 *   - a bare tier slug matches any served id that carries that tier token;
 *   - anything else matches only the same token list.
 *
 * `sonnet` matches `bedrock.claude-sonnet-5-5`; `claude-sonnet-5-5` matches
 * `claude-sonnet-5-5-20261001`; `claude-sonnet-5` does not match
 * `claude-sonnet-5-5`; `sonnet` does not match `claude-opus-5-5`.
 *
 * @param {string} routed  the model the spawn was sent with
 * @param {string} served  one model the host reports having served
 * @returns {boolean|null} `null` when either side is empty: no comparison was made
 */
export function modelMatches(routed, served) {
  const want = typeof routed === 'string' ? modelTokens(routed) : []
  const got = typeof served === 'string' ? modelTokens(served) : []
  if (!want.length || !got.length) return null
  if (want.length === 1 && TIER_SLUGS.includes(want[0])) return got.includes(want[0])
  return want.length === got.length && want.every((token, i) => token === got[i])
}
