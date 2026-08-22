// The wave-classification prompt, asserted against its assembled output.
//
// Every other prompt test in this repo reads `workflows/ship.js` and matches a
// sentence against the source bytes. That technique cannot see the defect this
// file exists for: a stray unary `+` in a concatenation chain coerces its
// operand to `NaN`, drops a whole instruction out of the assembled string, and
// leaves the sentence sitting intact in the file. A grep for the missing
// sentence *passes on the broken file*.
//
// So this asserts the string the classifier is actually handed. The prompt is
// captured by running ship.js against stubbed agents (test/helpers/
// ship-harness.mjs), which also means an opt-in prompt cannot escape coverage
// by living behind a flag.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runShip, coercionArtifacts } from '../helpers/ship-harness.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

let cached = null
async function plannerPrompt() {
  if (!cached) {
    const { prompts } = await runShip({})
    const found = prompts.find(p => p.label === 'plan-waves')
    assert.ok(found, 'ship.js assembled no prompt labelled "plan-waves"')
    cached = found.prompt
  }
  return cached
}

// The six rules the ladder states: one per tier, plus the routing rule that
// says which model the cheapest tier may use. `clampModel` clamps opus *down*
// and never clamps haiku *up*, so a classifier told only about the expensive
// end of the ladder produces runs that look correctly conservative while being
// under-powered and under-contexted.
const TIER_RULES = [
  [1, /Tier 1[^.]*\btrivial\b/i],
  [2, /Tier 2[^.]*\bsingle-concern\b/i],
  [3, /Tier 3[^.]*\bnew logic\b/i],
  [4, /Tier 4[^.]*\bcross-file\b/i],
  [5, /Tier 5[^.]*\bnovel\b/i],
  ['haiku routing', /\bhaiku\b/]
]

test('the assembled classifier prompt states all six tier rules', async () => {
  const prompt = await plannerPrompt()
  const missing = TIER_RULES.filter(([, re]) => !re.test(prompt)).map(([name]) => name)
  assert.deepEqual(
    missing,
    [],
    `the assembled plan-waves prompt is missing tier rule(s): ${missing.join(', ')}.\n` +
      `The source bytes may still contain them — a concatenation defect drops them from the ` +
      `assembled string. Assembled prompt:\n${prompt}`
  )
})

test('the assembled classifier prompt carries no coercion artifact', async () => {
  const prompt = await plannerPrompt()
  const found = coercionArtifacts(prompt)
  assert.deepEqual(
    found,
    [],
    `the assembled plan-waves prompt contains ${found.join(', ')} — an operand was coerced ` +
      `rather than concatenated, so whatever it replaced never reaches the classifier`
  )
})

test('a source-text search is not accepted as evidence of prompt correctness', async () => {
  // The decisive property, asserted rather than described: the tier sentence is
  // present in the file whether or not it reaches the agent, so only the
  // assembled check is authoritative.
  const source = readFileSync(join(ROOT, 'workflows', 'ship.js'), 'utf8')
  assert.match(source, /Tier 1 trivial one-file edit/, 'the sentence lives in the source bytes')
  const prompt = await plannerPrompt()
  assert.match(
    prompt,
    /Tier 1 trivial one-file edit/,
    'the sentence is in the file but not in the assembled prompt — the source search proved nothing'
  )
})

test('the classifier is still told the grouping rules and the paths contract', async () => {
  const prompt = await plannerPrompt()
  assert.match(prompt, /Default group to the numbered tasks\.md section/)
  assert.match(prompt, /shared file is NOT a reason for a new group/)
  assert.match(prompt, /OMIT the field when you genuinely cannot/)
})

// --- one classifier policy, two hosts (spec: ship/prompt-integrity) --------
//
// `lib/host.mjs` already forbids a host from carrying its own policy, and the
// tier ladder is the one place that drifted: the ACP driver kept its own
// differently-worded copy, so the same task could classify differently
// depending on which host ran it — and each driver looked individually
// well-formed.
//
// The comparison is on EXTRACTED POLICY, not on bytes. The two drivers word the
// same rules differently, and requiring byte equality would either fail
// immediately or force a rewrite of one host's prose to satisfy a test. What
// must match is the tier boundaries and the routing rule; how they are phrased
// around those is each driver's business.

const ACP_DRIVER = join(ROOT, 'bin', 'interlock-ship-acp')

/**
 * The classifier policy a driver states: what each tier is for, and which
 * models the ladder routes to. Extraction rule, stated where a reader can
 * check it — for each tier 1..5, the clause introduced by "Tier N" up to the
 * next "Tier" or the end of the sentence group, reduced to the content words
 * that carry the boundary.
 */
function extractTierPolicy(text) {
  const ladder = /Tier 1[\s\S]{0,600}?When unsure, sonnet\./.exec(text)
  assert.ok(ladder, 'no tier ladder found — a driver that states none has no classifier policy')
  const region = ladder[0].replace(/\s+/g, ' ')

  // Split on the tier markers themselves. Each tier's rule is whatever the
  // driver wrote between "Tier N" and "Tier N+1" — which is exactly the unit
  // the two hosts have to agree on, and it survives any amount of reflowing,
  // template-literal glue or surrounding prose.
  const parts = region.split(/Tier (\d)\b/)
  const tiers = {}
  for (let i = 1; i < parts.length; i += 2) {
    tiers[Number(parts[i])] = parts[i + 1]
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
  }
  for (let n = 1; n <= 5; n++) {
    assert.ok(tiers[n], `driver states no rule for tier ${n}`)
  }
  return {
    // The boundary each tier draws, as the distinguishing keywords.
    keywords: {
      1: tiers[1].filter(w => ['trivial', 'one', 'file', 'edit', 'haiku'].includes(w)),
      2: tiers[2].filter(w => ['single', 'concern', 'change'].includes(w)),
      3: tiers[3].filter(w => ['new', 'logic', 'one', 'domain'].includes(w)),
      4: tiers[4].filter(w => ['cross', 'file', 'existing', 'patterns'].includes(w)),
      5: tiers[5].filter(w => ['novel', 'architecture', 'opus'].includes(w))
    },
    // The routing rule: cheapest tier to haiku, and only the top tier to opus.
    routing: {
      haikuTier: /Tier 1[^.]*haiku/.test(region) ? 1 : null,
      opusTier: /only tier 5 may be opus/i.test(region) ? 5 : null,
      defaultModel: /When unsure, sonnet\./.test(region) ? 'sonnet' : null
    }
  }
}

test('both host drivers state the same tier boundaries and the same routing rule', () => {
  const fromWorkflow = extractTierPolicy(readFileSync(join(ROOT, 'workflows', 'ship.js'), 'utf8'))
  const fromAcp = extractTierPolicy(readFileSync(ACP_DRIVER, 'utf8'))

  assert.deepEqual(
    fromAcp.keywords,
    fromWorkflow.keywords,
    'the two drivers draw different tier boundaries — a host may not carry its own classifier policy'
  )
  assert.deepEqual(
    fromAcp.routing,
    fromWorkflow.routing,
    'the two drivers route models differently for the same tier'
  )
  assert.deepEqual(fromWorkflow.routing, { haikuTier: 1, opusTier: 5, defaultModel: 'sonnet' })
})

test('the extracted policy is what changed, so a rewording alone does not fail', () => {
  // The rule that makes the comparison usable, asserted rather than trusted:
  // whitespace, ordering of the surrounding prose and punctuation are all
  // stripped before comparison.
  const source = readFileSync(join(ROOT, 'workflows', 'ship.js'), 'utf8')
  const reworded = source
    .replace(/Tier 2 single-concern change\./, 'Tier 2   single-concern   CHANGE!')
    .replace(/When unsure, sonnet\./, 'When unsure, sonnet.')
  assert.deepEqual(
    extractTierPolicy(reworded).keywords,
    extractTierPolicy(source).keywords,
    'casing, spacing and punctuation must not be what the cross-host comparison sees'
  )
})
