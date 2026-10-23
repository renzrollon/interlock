// Token and cache accounting for a ship run (design D9).
//
// Pure folds over what each host reported for a step's spawns, summed onto the
// manifest. UNKNOWN IS NOT ZERO, and it is contagious: a figure one spawn never
// measured is null for the group, never a measured zero. Moved out of
// lib/run.mjs, which holds the loop itself and had grown into the directory's
// size headroom (test/spine/package.test.mjs); lib/run.mjs re-exports every
// public name here, so its callers and their tests read one import path.

// --- usage (design D9) ------------------------------------------------------

/**
 * Fold one step's spawn results into the run's token accounting.
 *
 * Every results-taking `run` subcommand calls this, because a run's spend is the
 * sum over every spawn it made — the review fan-out and the verification agent
 * cost tokens exactly as a wave does, and a total that counted only waves would
 * understate every strict run.
 *
 * UNKNOWN IS NOT ZERO, and it is contagious by design: one spawn whose host
 * reported nothing makes its whole group unknown, because the alternative is a
 * number that looks like a measurement and is actually a lower bound. A host
 * that never reports usage therefore records `null` throughout, which is what
 * the trajectory already means by "no token accounting".
 *
 * @param {object} manifest
 * @param {Array<object|null>} results
 * @param {number|null} [wave] the wave these spawns belonged to, or null for a
 *   step outside the waves (verification, review, remediation, the commit)
 */
export function recordUsage(manifest, results, wave = null) {
  const list = Array.isArray(results) ? results : []
  if (!list.length) return
  if (!Array.isArray(manifest.usage)) manifest.usage = []

  let outputTokens = 0
  let known = true
  const usages = []
  for (const result of list) {
    const usage = result && typeof result === 'object' ? result.usage : null
    const out = usage && typeof usage === 'object' && Number.isFinite(usage.outputTokens)
      ? usage.outputTokens
      : null
    if (out === null) known = false
    else outputTokens += out
    usages.push(usage && typeof usage === 'object' ? usage : null)
  }
  manifest.usage.push({
    wave: Number.isInteger(wave) ? wave : null,
    outputTokens: known ? outputTokens : null,
    // The input side, under exactly the rule the output side already holds. A
    // host with no cache accounting supplies neither field on any spawn, so both
    // of these come out `null` — unknown, which is a different fact from a wave
    // that measured and found no cache activity.
    ...foldCacheUsage(usages)
  })
}

/**
 * Sum one step's cache figures across its spawns, unknown-contagious.
 *
 * The tiers are NOT enumerated here. They are whatever the host reported them
 * under, unioned across the step's spawns, so a run records the decomposition
 * its host actually supplies rather than a list this module guessed — and so a
 * tier is never invented for a host that does not have one. Restating the
 * adapter's field names would also mean importing an adapter, which the policy
 * engine does not do.
 *
 * A tier one spawn reported and another omitted is `null` for the group: the
 * second spawn's figure was not measured, and adding only the first would
 * produce a lower bound that reads as a total. Same rule, one type down, as the
 * output-token fold above.
 */
function foldCacheUsage(usages) {
  const list = usages.filter(u => u && typeof u === 'object')
  if (!list.length) return { cacheReadInputTokens: null, cacheCreationInputTokens: null }

  const read = list.reduce(
    (sum, usage) =>
      sum === null || !Number.isFinite(usage.cacheReadInputTokens) ? null : sum + usage.cacheReadInputTokens,
    0
  )

  const tiers = new Set()
  for (const usage of list) {
    const creation = usage.cacheCreationInputTokens
    if (creation && typeof creation === 'object' && !Array.isArray(creation)) {
      for (const tier of Object.keys(creation)) tiers.add(tier)
    }
  }
  let creation = null
  if (tiers.size) {
    creation = {}
    for (const tier of tiers) {
      creation[tier] = list.reduce((sum, usage) => {
        const block = usage.cacheCreationInputTokens
        const value = block && typeof block === 'object' ? block[tier] : undefined
        return sum === null || !Number.isFinite(value) ? null : sum + value
      }, 0)
    }
  }
  return { cacheReadInputTokens: read, cacheCreationInputTokens: creation }
}

/**
 * Add one recorded entry's cache figures into a running group total, holding the
 * unknown-contagious rule across entries the way `summarizeUsage` does for
 * output tokens. `null` in, `null` out, permanently.
 */
function addCacheEntry(total, entry) {
  const read =
    total.cacheReadInputTokens === null || !Number.isFinite(entry.cacheReadInputTokens)
      ? null
      : total.cacheReadInputTokens + entry.cacheReadInputTokens

  const incoming =
    entry.cacheCreationInputTokens && typeof entry.cacheCreationInputTokens === 'object'
      ? entry.cacheCreationInputTokens
      : null
  let creation = total.cacheCreationInputTokens
  if (creation === null && incoming === null) {
    // Nothing reported on either side; stays absent.
  } else if (incoming === null) {
    // A contributing entry reported no decomposition at all, so every tier the
    // group has so far becomes unknown rather than being carried as a total.
    creation = Object.fromEntries(Object.keys(creation).map(tier => [tier, null]))
  } else if (creation === null) {
    creation = { ...incoming }
  } else {
    const merged = {}
    for (const tier of new Set([...Object.keys(creation), ...Object.keys(incoming)])) {
      const a = creation[tier]
      const b = incoming[tier]
      merged[tier] = Number.isFinite(a) && Number.isFinite(b) ? a + b : null
    }
    creation = merged
  }
  return { cacheReadInputTokens: read, cacheCreationInputTokens: creation }
}

const EMPTY_CACHE_TOTAL = Object.freeze({ cacheReadInputTokens: 0, cacheCreationInputTokens: null })

/**
 * The receipt's `spend` rows and run total, summed from what was recorded.
 *
 * Per wave and per run, with `null` for either wherever a single contributing
 * spawn went unmeasured. A wave that appears in several batches sums across
 * them; a run with no entries at all reports nothing rather than zero.
 *
 * @param {object} manifest
 * @returns {{spend: Array<object>, outputTokens: number|null|undefined,
 *   cacheReadInputTokens: number|null|undefined,
 *   cacheCreationInputTokens: object|null|undefined}}
 */
export function summarizeUsage(manifest) {
  const entries = Array.isArray(manifest && manifest.usage) ? manifest.usage : []
  if (!entries.length) {
    return {
      spend: [],
      outputTokens: undefined,
      cacheReadInputTokens: undefined,
      cacheCreationInputTokens: undefined
    }
  }

  const byWave = new Map()
  for (const entry of entries) {
    if (!Number.isInteger(entry && entry.wave)) continue
    const current = byWave.has(entry.wave)
      ? byWave.get(entry.wave)
      : { outputTokens: 0, ...EMPTY_CACHE_TOTAL }
    byWave.set(entry.wave, {
      outputTokens:
        current.outputTokens === null || entry.outputTokens === null
          ? null
          : current.outputTokens + entry.outputTokens,
      ...addCacheEntry(current, entry)
    })
  }

  const runTotal = entries.reduce(
    (sum, entry) => (sum === null || entry.outputTokens === null ? null : sum + entry.outputTokens),
    0
  )
  const runCache = entries.reduce((total, entry) => addCacheEntry(total, entry), { ...EMPTY_CACHE_TOTAL })

  return {
    spend: [...byWave.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([wave, totals]) => ({ wave, ...totals })),
    outputTokens: runTotal,
    ...runCache
  }
}
