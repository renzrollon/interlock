// The caps are the product's spine, so the tests here are less about arithmetic
// than about the property that makes centralising them worth anything: every
// cap is a positive integer, nothing silently disappears, and a caller asking
// for more parallelism than the workflow runtime allows gets clamped rather
// than a failed run.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  LIMITS,
  EVAL_CAPS,
  MODEL_PRICES,
  RUNTIME,
  EFFORT,
  LANE_CAPS,
  SOLO,
  clampParallel,
  formatLimits
} from '../../lib/limits.mjs'
import { DEFAULT_MODEL } from '../../evals/ship/agent/model.mjs'
import { priceUsage } from '../../evals/ship/arms.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('every cap is a positive integer', () => {
  for (const [name, value] of Object.entries(LIMITS)) {
    assert.equal(typeof value, 'number', `${name} must be a number`)
    assert.ok(Number.isInteger(value), `${name} must be an integer`)
    assert.ok(value > 0, `${name} must be positive`)
  }
})

test('the documented ship caps are the ones the prose promised', () => {
  // These four were prose in skills/ship/SKILL.md before they lived here. If one
  // changes, that is a product decision and this assertion should be updated
  // deliberately — not a refactor that quietly moved a number.
  assert.equal(LIMITS.remediationRounds, 2)
  assert.equal(LIMITS.interWaveFixAttempts, 2)
  assert.equal(LIMITS.replansPerRun, 2)
  assert.equal(LIMITS.rootCauseIterations, 5)
  assert.equal(LIMITS.taskFailureHalt, 2)
  assert.equal(LIMITS.interWaveVerifications, 3)
})

test('the run-step cap is published here rather than restated in a driver', () => {
  // This was `MAX_LOOP_STEPS = 200`, a literal in `workflows/ship.js` and again
  // in `bin/interlock-ship-acp` — a loop bound stated in two places that the
  // cap-authority spec forbids stating anywhere but here. Its reader is
  // `lib/run.mjs`, which counts steps on the run manifest and halts.
  assert.equal(LIMITS.maxRunSteps, 200)
  assert.match(formatLimits(), /run steps \(per run\)/)
  const runProgram = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(
    runProgram,
    /LIMITS\.maxRunSteps/,
    'lib/run.mjs must read the published cap rather than carry a literal of its own'
  )
  // And neither driver may restate it. A driver's RUNAWAY_BACKSTOP is a
  // different thing — the host runtime's agent ceiling, not a policy cap — and
  // is asserted distinct in test/workflows.test.mjs.
  for (const driver of [join(ROOT, 'workflows', 'ship.js'), join(ROOT, 'bin', 'interlock-ship-acp')]) {
    assert.doesNotMatch(
      readFileSync(driver, 'utf8'),
      /MAX_LOOP_STEPS/,
      `${driver} restates the run-step bound — it is published by interlock limits`
    )
  }
})

test('the spill caps match design.md — 8192 byte threshold, 4096 char preview', () => {
  // add-ship-run-inspectability design.md §3 pins these numbers; lib/spill.mjs
  // falls back to the same defaults independently, so a drift here would leave
  // the two modules silently disagreeing.
  assert.equal(LIMITS.verifySpillBytes, 8192)
  assert.equal(LIMITS.verifyPreviewChars, 4096)
})

test('the wave handoff budget is pinned at 2000 characters', () => {
  // add-wave-handoff-and-prompt-snapshots design.md §2. Changing this is a
  // product decision about how much one wave may tell the next — update it here
  // deliberately, the same way remediationRounds would be.
  assert.equal(LIMITS.maxHandoffChars, 2000)
})

test('the notify push timeout is pinned at 5000ms', () => {
  // design D5, add-harden-unattended-ship-runs: a hanging relay must not stall
  // the close. Read by `postNtfy` in lib/notify.mjs (task 1.1).
  assert.equal(LIMITS.notifyTimeoutMs, 5000)
  assert.match(formatLimits(), /push timeout \(ms\)/)
  assert.match(formatLimits(), new RegExp(String(LIMITS.notifyTimeoutMs)))
})

test('the launch ledger max age is published and printed', () => {
  // guard-ship-relaunch design D5: longer than any run the step cap and the
  // runaway backstop allow, shorter than the host's transcript retention, and it
  // widens only the allow direction. Changing it is a decision about how long a
  // session's launch can deny its next one.
  assert.equal(LIMITS.launchLedgerMaxAgeMs, 24 * 60 * 60 * 1000)
  const text = formatLimits()
  assert.match(text, /launch ledger max age \(ms\)/)
  assert.match(text, new RegExp(`launch ledger max age \\(ms\\)\\s+${LIMITS.launchLedgerMaxAgeMs}\\b`))
})

test('the launch ledger max age is read under lib/, where the cap-authority sweep looks', () => {
  // The sweep below walks lib/, bin/, workflows/ and CI — not hooks/. A cap read
  // only by hooks/guard-relaunch.mjs would be a printed cap the sweep reports as
  // unread; this names the reader the design put it in, so a failure here says
  // where the read went rather than only that it is missing.
  const reader = readFileSync(join(ROOT, 'lib', 'launch-ledger.mjs'), 'utf8')
  assert.ok(reader.includes('LIMITS.launchLedgerMaxAgeMs'), 'lib/launch-ledger.mjs does not read the cap')
  const hook = readFileSync(join(ROOT, 'hooks', 'guard-relaunch.mjs'), 'utf8')
  assert.ok(!/launchLedgerMaxAgeMs|24 \* 60 \* 60/.test(hook), 'the hook restates the cap instead of leaving it to lib/')
})

test('the default fan-out sits under the runtime concurrency ceiling', () => {
  assert.ok(
    LIMITS.maxParallel <= RUNTIME.maxConcurrentAgents,
    'default parallelism must not exceed what the workflow runtime will run'
  )
})

test('clampParallel falls back to the default for junk input', () => {
  for (const junk of [undefined, null, 0, -3, 2.5, '8', NaN]) {
    const got = clampParallel(junk)
    assert.equal(got.value, LIMITS.maxParallel)
    assert.equal(got.clamped, false)
    assert.equal(got.reason, null)
  }
})

test('clampParallel honours a reasonable request unchanged', () => {
  const got = clampParallel(4)
  assert.deepEqual(got, { value: 4, clamped: false, reason: null })
})

test('clampParallel clamps to the runtime ceiling and says why', () => {
  const got = clampParallel(40)
  assert.equal(got.value, RUNTIME.maxConcurrentAgents)
  assert.equal(got.clamped, true)
  assert.match(got.reason, /concurrent agents/)
})

test('formatLimits names every cap it prints', () => {
  const text = formatLimits()
  assert.match(text, /max parallel agents/)
  assert.match(text, /remediation rounds/)
  assert.match(text, new RegExp(String(RUNTIME.maxAgentsPerRun)))
  assert.match(text, /verify spill threshold/)
  assert.match(text, /verify preview budget/)
  assert.match(text, /inter-wave verifications/)
  // The handoff cap has to be readable from the CLI: the workflow prompt tells
  // implementers to look it up there rather than restating the number.
  assert.match(text, /wave handoff budget/)
  assert.match(text, new RegExp(String(LIMITS.maxHandoffChars)))
  assert.ok(text.endsWith('\n'))
})

// --- every printed cap is enforced by code (spec: ship/cap-authority) ------
//
// The failure this closes: `interlock limits` advertised two caps no code
// obeyed. `memoryEntriesPerRun` had zero references outside this module and
// its prose, and `verifySpillBytes` was read only by a test asserting it
// equals 8192. A printed cap that nothing reads is the same failure as a cap
// written in prose — which is the failure this module was created to end.
//
// A test that pins a cap's VALUE is deliberately not counted as a reader. That
// is what let the spill threshold look alive: it exercises the number, not the
// behaviour the number governs.
//
// The check covers every cap group the limits surface prints, not only LIMITS.
// EVAL_CAPS used to be exempt on the grounds that its readers lived in CI YAML
// the test could not see — it could, it just did not walk `.github/workflows/`.
// Two properties make walking it work (design D5):
//
//   - Two accepted tokens per cap. A lib/bin/workflows reader names a cap as
//     `<GROUP>.<cap>`; a CI reader names it as `<published>.<cap>`, the field
//     the CLI publishes (`bin/interlock` emits EVAL_CAPS as `evals`). Matching
//     only one form would fail one whole group on day one.
//   - The bare group name never counts. `bin/interlock` contains
//     `evals: EVAL_CAPS`, a whole-group forward to the printed surface; a
//     matcher that accepted the bare identifier would find it there and mark
//     every eval cap read, restoring exactly the blindness being removed.
//
// REPORT_CAPS stays outside this check: it has not been reported as unread, and
// widening the sweep further is a separate judgement.

test('every cap the limits surface prints is read by the code path it governs', () => {
  const dirs = ['lib', 'bin', 'workflows', join('.github', 'workflows')]
  // The limits definition names every cap it prints, so counting it as a reader
  // would make this check vacuous. It is the one exclusion.
  const SELF = join(ROOT, 'lib', 'limits.mjs')
  const sources = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (path !== SELF) sources.push(readFileSync(path, 'utf8'))
    }
  }
  for (const dir of dirs) {
    const root = join(ROOT, dir)
    // A missing `.github/workflows/` is not an excuse: the eval caps lose their
    // readers and this check fails naming them, which is the correct outcome and
    // duplicates the tracked-workflow assertion rather than conflicting with it.
    if (existsSync(root)) walk(root)
  }
  // The eval runners — the `.mjs` modules directly under `evals/ship/` — are code
  // readers too: each reads its ceiling from `interlock limits --json` by the
  // published field. Only those modules count. Not recursive (the fixtures and
  // the agent are not runners) and never prose: `evals/ship/README.md` names a
  // ceiling for a human, and a README counted as a reader is the prose cap this
  // check exists to refuse.
  const runners = join(ROOT, 'evals', 'ship')
  for (const entry of readdirSync(runners, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.mjs')) sources.push(readFileSync(join(runners, entry.name), 'utf8'))
  }

  // `tokens` builds every form a legitimate reader may name a cap by. LIMITS has
  // only code readers, so the export name is the whole vocabulary. EVAL_CAPS is
  // read from CI too, where the reader parses `interlock limits --json` and
  // names the published field (`evals.<cap>`) rather than the export.
  const groups = [
    { name: 'LIMITS', caps: LIMITS, tokens: cap => [`LIMITS.${cap}`] },
    { name: 'EVAL_CAPS', caps: EVAL_CAPS, tokens: cap => [`EVAL_CAPS.${cap}`, `evals.${cap}`] },
    // The lane-cap table and the solo envelope join the sweep on the same terms:
    // every entry printed by `interlock limits` must be read by the planning code
    // path. `byTier` counts as one cap — it is read as a table, and requiring a
    // reader per tier would only invite five `LANE_CAPS.byTier[n]` lookups
    // written to satisfy a test.
    { name: 'LANE_CAPS', caps: LANE_CAPS, tokens: cap => [`LANE_CAPS.${cap}`, `laneCaps.${cap}`] },
    { name: 'SOLO', caps: SOLO, tokens: cap => [`SOLO.${cap}`, `solo.${cap}`] },
    // The effort table joins once a published effort was found unread: the verify
    // effort was printed while every verify spawn ran at the host's default.
    // `byTier` counts as one cap, on the terms `LANE_CAPS.byTier` does.
    { name: 'EFFORT', caps: EFFORT, tokens: cap => [`EFFORT.${cap}`] }
  ]
  const unread = []
  for (const group of groups) {
    for (const cap of Object.keys(group.caps)) {
      const tokens = group.tokens(cap)
      if (!sources.some(text => tokens.some(token => text.includes(token)))) {
        unread.push(`${group.name}.${cap}`)
      }
    }
  }
  assert.deepEqual(
    unread,
    [],
    `these caps are printed but nothing reads them: ${unread.join(', ')}. ` +
      `Wire each to the path it governs, or remove it from its cap group and from the ` +
      `printed surface together — a cap with no reader is a cap written in prose.`
  )
})

// --- the outcome eval's ceiling and its price table (spec: evals/outcome-run) --
//
// The cap lands WITH both of its readers, which is the condition on publishing
// one at all: `runsPerCase` sat here printed and unread for a release, and
// `reportingThreshold` was removed rather than left in that state. The
// cap-authority sweep above already refuses an unread cap, and it now walks the
// eval runners under evals/ship/ too — but a cap with two readers can pass that
// sweep on either one alone. So the runner's readership is asserted here, by
// name, or a cap could pass the sweep on its CI reader alone while the thing
// that actually enforces it had drifted to a literal.

test('the outcome-eval ceiling and price table are published, and the price table is identified', () => {
  assert.equal(typeof EVAL_CAPS.shipEvalCostUsd, 'number')
  assert.ok(EVAL_CAPS.shipEvalCostUsd > 0)
  assert.match(formatLimits(), /eval outcome-run cost ceiling/)
  assert.match(formatLimits(), new RegExp(`\\$${EVAL_CAPS.shipEvalCostUsd}`))

  // The identifier is the load-bearing field: it travels on every recorded row,
  // so a later price revision cannot silently reinterpret rows written under the
  // old one. A table with no id could not do that.
  assert.ok(MODEL_PRICES.id, 'the price table carries no identifier')
  assert.match(formatLimits(), new RegExp(MODEL_PRICES.id))
  for (const [model, price] of Object.entries(MODEL_PRICES.perMillionTokens)) {
    assert.equal(typeof price.input, 'number', `${model} has no input price`)
    assert.equal(typeof price.output, 'number', `${model} has no output price`)
    assert.match(formatLimits(), new RegExp(`price: ${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  }

  // Cache pricing arrived as a new id, not as an edit under the old one: rows
  // written before it were priced by a table with no cache structure, and
  // reusing the identifier would let them be read as though they had been.
  assert.notEqual(MODEL_PRICES.id, 'anthropic-list-2026-09', 'a revised table must mint a new id')

  // A write multiplier per lifetime tier, never one flattened figure — the two
  // tiers are different prices and a total could not be priced back apart.
  const { write, read } = MODEL_PRICES.cacheMultipliers
  assert.deepEqual(Object.keys(write).sort(), ['ephemeral_1h', 'ephemeral_5m'])
  for (const [tier, factor] of Object.entries(write)) {
    assert.equal(typeof factor, 'number', `${tier} has no write multiplier`)
    assert.ok(factor > 1, `a cache write costs more than base input, not less (${tier})`)
    assert.match(formatLimits(), new RegExp(`cache write multiplier: ${tier}`))
  }
  // A read multiplier per MODEL, keyed by the same ids as the base rates: the
  // published read multiplier is not one figure, so a single scalar would
  // misprice every model whose rate differs from it.
  assert.equal(typeof read, 'object', 'the cache read multiplier is a per-model map, not one figure')
  for (const model of Object.keys(MODEL_PRICES.perMillionTokens)) {
    const factor = read[model]
    assert.equal(typeof factor, 'number', `${model} has no cache read multiplier`)
    assert.ok(factor > 0 && factor < 1, `a cache read costs a fraction of base input (${model})`)
    const escaped = model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(
      formatLimits(),
      new RegExp(`cache read multiplier: ${escaped} \\(x input\\)\\s+${String(factor).replace('.', '\\.')}\\s*$`, 'm'),
      `interlock limits must print ${model}'s own read multiplier`
    )
  }
})

/**
 * The identity half of the price table, as a function of the table so the same
 * assertions can be run against an older table and seen to fail there.
 */
function assertCurrentPriceTable(prices) {
  // The October 2026 list is a new id: a later list, not a revision of a
  // September one, and reusing either September id would let rows recorded
  // under it be read as priced by these rates.
  assert.equal(prices.id, 'anthropic-list-2026-10', 'the price table must be anthropic-list-2026-10')
  for (const previous of ['anthropic-list-2026-09', 'anthropic-list-2026-09b']) {
    assert.notEqual(prices.id, previous, `a revised table must not reuse ${previous}`)
  }
  // The models the new list replaced are gone, not kept beside their successors
  // so that an old name still prices.
  for (const dropped of ['claude-opus-5', 'claude-sonnet-5']) {
    assert.ok(
      !Object.prototype.hasOwnProperty.call(prices.perMillionTokens, dropped),
      `${dropped} must not be priced by ${prices.id}`
    )
  }
}

test('the price table is anthropic-list-2026-10, and the models it replaced are gone', () => {
  assertCurrentPriceTable(MODEL_PRICES)
})

// The cache multipliers are printed by `interlock limits`, so they owe a reader
// on the terms every printed cap does. Their reader lives under evals/, which
// the cap-authority sweep cannot see, so it is asserted here by name AND by
// behaviour: a multiplier the pricer only mentioned would pass the first check
// and fail the second.
test('every printed cache multiplier is read by name by the outcome-eval pricer', () => {
  const arms = readFileSync(join(ROOT, 'evals', 'ship', 'arms.mjs'), 'utf8')
  const pricer = arms.slice(arms.indexOf('export function priceUsage'))
  assert.ok(pricer.length < arms.length, 'priceUsage is missing from evals/ship/arms.mjs')
  assert.match(pricer, /cacheMultipliers\.read\[model\]/, 'priceUsage must read the per-model read multiplier by name')
  assert.match(pricer, /cacheMultipliers\.write\[tier\]/, 'priceUsage must read each write tier by name')

  const usage = over => ({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: { ephemeral_5m: 0, ephemeral_1h: 0 },
    reason: null,
    ...over
  })
  for (const model of Object.keys(MODEL_PRICES.perMillionTokens)) {
    const input = MODEL_PRICES.perMillionTokens[model].input
    // One million cache-read tokens cost exactly this model's printed read
    // multiplier times its input rate — the pricer reads THAT entry, not a
    // shared figure and not the base input rate.
    const read = priceUsage(usage({ cacheReadInputTokens: 1_000_000 }), model, MODEL_PRICES)
    assert.equal(read.usd, Math.round(input * MODEL_PRICES.cacheMultipliers.read[model] * 10000) / 10000, `${model} read`)
    for (const tier of Object.keys(MODEL_PRICES.cacheMultipliers.write)) {
      const write = priceUsage(
        usage({ cacheCreationInputTokens: { ephemeral_5m: 0, ephemeral_1h: 0, [tier]: 1_000_000 } }),
        model,
        MODEL_PRICES
      )
      assert.equal(write.usd, Math.round(input * MODEL_PRICES.cacheMultipliers.write[tier] * 10000) / 10000, `${model} ${tier}`)
    }
  }
})

test('the outcome eval’s default model is a key in the published price table', () => {
  // Design D4: the default and the table move together. A default the table did
  // not contain would leave every unconfigured run unpriced, silently.
  assert.equal(DEFAULT_MODEL, 'claude-opus-5-5')
  assert.ok(
    Object.prototype.hasOwnProperty.call(MODEL_PRICES.perMillionTokens, DEFAULT_MODEL),
    `the outcome eval's default model ${DEFAULT_MODEL} is not priced by ${MODEL_PRICES.id}`
  )
  assert.equal(typeof MODEL_PRICES.cacheMultipliers.read[DEFAULT_MODEL], 'number')
})

test('interlock limits --json emits the ceiling and the price table', () => {
  const run = spawnSync(process.execPath, [join(ROOT, 'bin', 'interlock'), 'limits', '--json'], {
    cwd: ROOT,
    encoding: 'utf8'
  })
  assert.equal(run.status, 0, `interlock limits --json exited ${run.status}: ${run.stderr}`)
  const payload = JSON.parse(run.stdout)
  assert.equal(payload.evals.shipEvalCostUsd, EVAL_CAPS.shipEvalCostUsd)
  assert.equal(payload.prices.id, MODEL_PRICES.id)
  assert.deepEqual(payload.prices.perMillionTokens, MODEL_PRICES.perMillionTokens)
  // Each model's own read multiplier and both write tiers travel on the JSON
  // surface too: the runner prices from this payload, not from the module.
  assert.deepEqual(payload.prices.cacheMultipliers.read, MODEL_PRICES.cacheMultipliers.read)
  assert.deepEqual(payload.prices.cacheMultipliers.write, MODEL_PRICES.cacheMultipliers.write)
  for (const model of Object.keys(MODEL_PRICES.perMillionTokens)) {
    assert.equal(typeof payload.prices.cacheMultipliers.read[model], 'number', `${model} has no read multiplier in --json`)
  }
})

test('the outcome eval and its scheduled job are the ceiling’s readers', () => {
  // Both read the published field through `interlock limits --json` rather than
  // importing the module or restating the number — one number, two readers, and
  // neither able to drift from the other.
  const runner = readFileSync(join(ROOT, 'evals', 'ship', 'run.mjs'), 'utf8')
  assert.match(
    runner,
    /evals\.shipEvalCostUsd/,
    'the outcome-eval runner must read the published ceiling rather than carry a literal'
  )
  assert.match(runner, /limits', '--json'|limits --json/, 'the runner must read it from the CLI')

  const workflow = join(ROOT, '.github', 'workflows', 'ship-outcome-eval.yml')
  assert.ok(existsSync(workflow), 'the scheduled outcome-eval workflow is missing')
  const job = readFileSync(workflow, 'utf8')
  assert.match(job, /evals\.shipEvalCostUsd/, 'the scheduled job must read the published ceiling')
  // And it restates no ceiling of its own. A dollar figure written in workflow
  // YAML is the prose cap this module exists to end, one file further out.
  assert.doesNotMatch(
    job.replace(/shipEvalCostUsd/g, ''),
    /\$\s?\d+(\.\d+)?\b/,
    'the scheduled job restates a dollar figure; the ceiling is published by interlock limits'
  )
})

// --- the cost-per-task sweep's ceiling (spec: evals/cost-per-task) -----------
//
// A separate cap from the outcome eval's, published the same way and read the
// same way. Its one reader is the sweep; no workflow reads it, because no
// workflow runs the sweep.

test('the cost-per-task ceiling is published by interlock limits, in prose and in --json', () => {
  assert.equal(EVAL_CAPS.matrixCostUsd, 40)
  assert.match(formatLimits(), /eval cost-per-task sweep ceiling/)
  assert.match(formatLimits(), new RegExp(`cost-per-task sweep ceiling \\(by hand\\)\\s+\\$${EVAL_CAPS.matrixCostUsd}\\s*$`, 'm'))
  const run = spawnSync(process.execPath, [join(ROOT, 'bin', 'interlock'), 'limits', '--json'], {
    cwd: ROOT,
    encoding: 'utf8'
  })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(JSON.parse(run.stdout).evals.matrixCostUsd, EVAL_CAPS.matrixCostUsd)
})

test('the cost-per-task sweep is the ceiling’s reader, through the CLI, with no literal', () => {
  const sweep = readFileSync(join(ROOT, 'evals', 'ship', 'matrix.mjs'), 'utf8')
  assert.match(sweep, /evals\.matrixCostUsd/, 'the sweep must read the published ceiling by its field')
  assert.match(sweep, /limits', '--json'|limits --json/, 'the sweep must read it from the CLI')
  assert.doesNotMatch(
    sweep.replace(/matrixCostUsd/g, ''),
    new RegExp(`\\$\\s?${EVAL_CAPS.matrixCostUsd}\\b|\\b${EVAL_CAPS.matrixCostUsd}\\s*(usd|dollars)`, 'i'),
    'the sweep restates its ceiling; the number is published by interlock limits'
  )
})

// --- effort routing defaults (spec: effort-routing/published-not-restated) --
//
// The effort table lives beside the caps for the same reason they do: a mapping
// written twice drifts. It is a separate export from LIMITS because LIMITS holds
// positive-integer iteration counts (the invariant above), and effort is a
// tier→string table — so `interlock limits` is where an operator reads it.

test('the effort defaults are the ones the design pinned', () => {
  // D2 of add-lane-effort-routing. Changing one of these re-routes reasoning
  // effort across the fleet — a product decision, updated here deliberately.
  assert.deepEqual(EFFORT.byTier, { 1: 'low', 2: 'low', 3: null, 4: null, 5: 'xhigh' })
  assert.equal(EFFORT.verify, 'xhigh')
  assert.equal(EFFORT.skeptic, 'xhigh')
})

test('interlock limits surfaces the tier→effort mapping and the fixed step effort', () => {
  const text = formatLimits()
  assert.match(text, /effort: tier 1 lane\s+low/)
  assert.match(text, /effort: tier 5 lane\s+xhigh/)
  // Tiers 3 and 4 emit no override; the surface says "inherit", never a number
  // that would read as a forced effort.
  assert.match(text, /effort: tier 3 lane\s+inherit/)
  assert.match(text, /effort: verify step \(inter-wave and final\)\s+xhigh/)
  assert.match(text, /effort: review skeptic step\s+xhigh/)
})

// No effort level is written beside an `effort` key in the run program, the
// wave planner or either driver: every effort is read from the published table.
// Level words only — the capability value `effort: 'flag'` is not a level.
const EFFORT_LEVEL_WORDS = ['low', 'medium', 'high', 'xhigh', 'max']

test('no effort level is written beside an effort key outside the published table', () => {
  const pattern = new RegExp(
    `\\beffort['"]?\\s*[:=]\\s*['"\`](${EFFORT_LEVEL_WORDS.join('|')})['"\`]`
  )
  const offenders = []
  for (const rel of ['lib/run.mjs', 'lib/waves.mjs', 'workflows/ship.js', 'bin/interlock-run']) {
    const text = readFileSync(join(ROOT, rel), 'utf8')
    const hit = text.split('\n').findIndex(line => pattern.test(line))
    if (hit !== -1) offenders.push(`${rel}:${hit + 1}`)
  }
  assert.deepEqual(
    offenders,
    [],
    `an effort level is written beside an effort key in: ${offenders.join(', ')}. ` +
      `Read it from EFFORT in lib/limits.mjs instead.`
  )
  // The matcher itself: a level is a hit, the capability value is not.
  assert.ok(pattern.test(`effort: 'xhigh'`))
  assert.ok(pattern.test(`{ "effort": "low" }`))
  assert.ok(!pattern.test(`effort: 'flag'`))
  assert.ok(!pattern.test(`effort: EFFORT.verify`))
})

// --- lane caps and the solo envelope (spec: solo-mode, lanes) --------------
//
// Pinned the way the effort table is: these are the values D2 and D6 of
// add-lane-cohesion-and-solo-mode chose, and changing one re-shapes every plan
// the fleet builds. That is a product decision, updated here deliberately — not
// a refactor that quietly moved a number.

test('the lane-cap table, cohesion ceiling and opus floor are the ones the design pinned', () => {
  assert.deepEqual(LANE_CAPS.byTier, { 1: 8, 2: 8, 3: 6, 4: 4, 5: 8 })
  assert.equal(LANE_CAPS.cohesionMaxTier, 3)
  assert.equal(LANE_CAPS.opusMinTier, 4)
})

test('the solo envelope is the one the design pinned', () => {
  assert.equal(SOLO.maxTasks, 20)
})

test('interlock limits prints every tier cap, the cohesion ceiling, the opus floor and the solo envelope', () => {
  const text = formatLimits()
  for (const tier of [1, 2, 3, 4, 5]) {
    assert.match(
      text,
      new RegExp(`lane cap: tier ${tier} lane[^\\n]*\\s${LANE_CAPS.byTier[tier]}\\s*$`, 'm'),
      `the tier-${tier} lane cap must be printed`
    )
  }
  assert.match(text, new RegExp(`cohesion tier ceiling[^\\n]*\\s${LANE_CAPS.cohesionMaxTier}\\s*$`, 'm'))
  assert.match(text, new RegExp(`multi-task opus floor[^\\n]*\\s${LANE_CAPS.opusMinTier}\\s*$`, 'm'))
  assert.match(text, new RegExp(`solo envelope[^\\n]*\\s${SOLO.maxTasks}\\s*$`, 'm'))
})

test('the scalar lane cap is gone from the object and from the printed surface together', () => {
  // It was replaced by LANE_CAPS.byTier rather than aliased to it: an alias
  // would let one reader keep the scalar while the rest read the table, and the
  // two would disagree silently about how long a lane may get.
  assert.ok(
    !('maxTasksPerAgent' in LIMITS),
    'maxTasksPerAgent was replaced by LANE_CAPS.byTier; it must not be advertised'
  )
  assert.doesNotMatch(formatLimits(), /max tasks per agent/)
})

test('a removed cap is gone from the object and from the printed surface together', () => {
  assert.ok(
    !('memoryEntriesPerRun' in LIMITS),
    'memoryEntriesPerRun has no enforcement point; it must not be advertised'
  )
  assert.doesNotMatch(formatLimits(), /memory entries/)

  // `reportingThreshold` described a score at or above which a case reported as
  // passing. lib/evals-triage.mjs reads no score — classifyCase branches on each
  // grader's `passed` boolean — so there was no path it could govern without
  // inventing one, and it went the same way memoryEntriesPerRun did.
  assert.ok(
    !('reportingThreshold' in EVAL_CAPS),
    'reportingThreshold governs no triage path; it must not be advertised'
  )
  assert.doesNotMatch(formatLimits(), /reporting threshold/)
})

test('formatLimits prints the observed runtime slots beside the vendor default, when given them', () => {
  const plain = formatLimits()
  assert.ok(
    plain.endsWith(`runtime ceilings: ${RUNTIME.maxConcurrentAgents} concurrent, ${RUNTIME.maxAgentsPerRun} agents per run\n`),
    'the plain call is unchanged'
  )
  const fromEnv = formatLimits({ runtimeObserved: { observed: 4, source: 'env', cpuCount: 8 } })
  assert.match(fromEnv, /runtime ceilings: 16 concurrent, 1000 agents per run — observed on this machine: CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=4/)
  const vendor = formatLimits({ runtimeObserved: { observed: null, source: 'vendor-default', cpuCount: 8 } })
  assert.match(vendor, /observed on this machine: vendor default, possibly reduced on this 8-CPU machine/)
  const invalid = formatLimits({ runtimeObserved: { observed: null, source: 'vendor-default', cpuCount: 8, invalid: 'lots' } })
  assert.match(invalid, /CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=lots is not a valid count and is ignored/)
})

test('interlock limits --json carries the observed runtime slots', () => {
  const run = spawnSync(process.execPath, [join(ROOT, 'bin', 'interlock'), 'limits', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS: '4' }
  })
  assert.equal(run.status, 0, run.stderr)
  const payload = JSON.parse(run.stdout)
  assert.equal(payload.runtime.maxConcurrentAgents, RUNTIME.maxConcurrentAgents, 'the vendor fact is unchanged')
  assert.equal(payload.runtime.observed.observed, 4)
  assert.equal(payload.runtime.observed.source, 'env')
  const text = spawnSync(process.execPath, [join(ROOT, 'bin', 'interlock'), 'limits'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS: undefined }
  })
  assert.match(text.stdout, /observed on this machine: vendor default, possibly reduced on this \d+-CPU machine/)
})
