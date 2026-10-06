// The continuity gate (§F1, §F6.3) — may this change skip the human checkpoint?
//
// Everywhere else in Interlock a human reads the artifacts before ship starts.
// The continuity path (WS-F) can skip that read. A gate that removes a person
// from the loop cannot be a paragraph in a skill: a model asked "are these
// artifacts implementable?" answers from vibes, differently every run, and the
// one run where it answers optimistically is the run nobody checked. So the
// checklist in §F1 lives here, as code, and every answer carries its evidence.
//
// Three properties are load-bearing:
//
//   1. FAIL CLOSED, WITHOUT EXCEPTION. `ready` is true only when every
//      implemented check affirmatively passed. A check that could not run is
//      not a pass — an unreadable ledger, an artifact that would not read, a
//      classifier that threw, all become blockers. Nothing in this module can
//      turn an error into permission.
//
//   2. AN ABSENT INPUT IS NOT A CLEAN INPUT. The two ways this gate would
//      otherwise be silently defeated are a missing `decisions.md` ("nobody
//      recorded anything, so nothing needs a human") and a caller that simply
//      forgets to pass the artifact-review result ("no blockers were reported,
//      so there are no blockers"). Both are blockers here, by name.
//
//   3. COMPOSITION, NOT REIMPLEMENTATION. Artifact structure is
//      `lib/artifacts.mjs`, the ledger audit is `lib/ledger.mjs`, blast radius
//      is `lib/risk.mjs`. This module owns only the *policy* that combines
//      them — §4.14 "balanced", encoded once in `STRICTNESS` so re-tuning to
//      strict or loose is a single edit rather than a hunt.
//
// Deliberately unimplemented checks (§F1 items A, part of C, E's agent-tool
// probe, and all of F) are reported as `status: 'skip'` with a reason rather
// than omitted, so the printed checklist never implies they passed. They do
// not block: continuity knowingly accepts wrong-idea risk (§F0) in exchange
// for speed, and a skip that blocked would make the gate unreachable forever.
// A skip is "we chose not to check this"; a fail is "we tried and could not".
//
// Exposed to skills as `interlock ready --change <name> --json`.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { inspectChange, parseTasks, resolveChange } from './artifacts.mjs'
import { readLedger, summarize } from './ledger.mjs'
import { evaluateGate } from './findings.mjs'
import { CONTINUITY_ALLOWED_CLASSES, classifyRisk } from './risk.mjs'

/**
 * §4.14 **balanced**, and nothing else. Every threshold the gate applies is a
 * field here: re-tuning to (strict) or (loose) is one edit to this object, not
 * a search through the checks below.
 */
export const STRICTNESS = Object.freeze({
  /** Which §4.14 option this encodes. Printed, so a run says what it obeyed. */
  name: 'balanced',
  /** Artifact-review blockers tolerated. */
  maxArtifactBlockers: 0,
  /** Balanced: warnings are reported and do not block. Strict would flip this. */
  artifactWarningsBlock: false,
  /** `needs_human` ledger rows tolerated. */
  maxNeedsHuman: 0,
  /** Malformed / unsubstantiated ledger rows tolerated (see lib/ledger.mjs). */
  maxInvalidDecisions: 0,
  /** A change with no ledger at all has recorded no decisions — that blocks. */
  requireLedger: true,
  /** Risk classes that may continue past the checkpoint. */
  allowedRiskClasses: CONTINUITY_ALLOWED_CLASSES,
  /** `.claude/testing/profile.json` must exist before ship runs unattended. */
  requireTestProfile: true
})

/** Where the test profile lives, relative to the repo root. */
export const TEST_PROFILE_PATH = join('.claude', 'testing', 'profile.json')

/**
 * Task phrases that describe an intention rather than a change (§F1 C). A task
 * carrying one of these is not implementable by an agent that cannot ask a
 * question, so it blocks continuity. A trailing `.` in a phrase is optional
 * when matching, so `etc.` also catches a bare `etc`.
 */
export const WEASEL_PHRASES = Object.freeze([
  'appropriately',
  'as needed',
  'etc.',
  'handle edge cases',
  'and so on',
  'where applicable',
  'if necessary',
  'update accordingly'
])

/**
 * The single escape hatch for the weasel lint: a task may keep a vague phrase
 * when it also states what "done" means. One greppable marker rather than a
 * heuristic, so nobody has to guess whether their wording qualifies.
 */
export const ACCEPTANCE_MARKER = /\bacceptance\s*:/i

/** The §F1 escape hatch for a scenario a task covers without naming it. */
export const TASK_COVERAGE_MARKER = /\bcovered\s+by\s+tasks?\s*[:#]?\s*\d[\d.,\s]*/i

/** Artifacts read from the change directory when the caller supplies none. */
const ARTIFACT_FILES = Object.freeze(['proposal.md', 'design.md', 'tasks.md'])

// Tolerate a mis-levelled heading: §F1 says `#### Scenario:`, but a scenario
// written with three hashes is still a scenario, and skipping it would be a
// silent hole in the mapping check.
const SCENARIO_HEADING = /^#{2,6}\s*Scenario\s*:\s*(.+?)\s*$/i
const ANY_HEADING = /^#{1,6}\s/

// How much of an offending line is quoted back as evidence.
const EVIDENCE_CHARS = 160
// Scenario titles shorter than this are too generic to match against a task by
// substring, so they must use the explicit coverage marker instead.
const MIN_TITLE_CHARS = 3

function fail(message) {
  const err = new Error(message)
  err.userFacing = true
  throw err
}

function messageOf(err) {
  return (err && err.message) || String(err)
}

function clip(text, max = EVIDENCE_CHARS) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

// Normalised for substring comparison: case, punctuation and spacing all stop
// mattering, so "Scenario: User signs in" matches a task written "user signs-in".
function normalize(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const WEASEL_PATTERNS = WEASEL_PHRASES.map(phrase => ({
  phrase,
  // A trailing literal dot becomes optional; word-ish boundaries stop
  // "appropriately" from firing inside a longer identifier.
  re: new RegExp(`(^|[^\\w])${escapeRegExp(phrase).replace(/\\\.$/, '\\.?')}(?![\\w])`, 'i')
}))

// --- accumulator ---------------------------------------------------------
//
// Every check pushes exactly one entry, so the printed checklist has one line
// per §F1 item whatever happened.

function pass(run, id, detail) {
  run.checks.push({ id, status: 'pass', detail })
}

function skip(run, id, detail) {
  run.checks.push({ id, status: 'skip', detail })
}

function warn(run, code, message) {
  run.warnings.push({ code, message })
}

function block(run, id, code, message, evidence = []) {
  run.checks.push({ id, status: 'fail', detail: message })
  run.blockers.push({ code, message, evidence: evidence.slice(0, 10) })
}

// A gather step failed: mark every check that depended on it as failed, and
// raise ONE blocker naming the cause. Dependent checks are 'fail', never
// 'skip' — they were meant to run.
function blockAll(run, ids, code, message, evidence = []) {
  for (const id of ids) run.checks.push({ id, status: 'fail', detail: message })
  run.blockers.push({ code, message, evidence: evidence.slice(0, 10) })
}

// Run an evidence-gathering step without letting it escape. An exception here
// must become a blocker, never an unhandled throw and never a silent pass.
function attempt(fn) {
  try {
    return { ok: true, value: fn(), error: null }
  } catch (err) {
    return { ok: false, value: null, error: messageOf(err) }
  }
}

// --- evidence gathering --------------------------------------------------

/** Exported for `lib/conformance.mjs`, for the same anti-drift reason as `extractScenarios`. */
export function readArtifactsFromDisk(inspection) {
  const out = {}
  for (const name of ARTIFACT_FILES) {
    const p = join(inspection.path, name)
    if (existsSync(p)) out[name] = readFileSync(p, 'utf8')
  }
  for (const rel of inspection.specFiles || []) {
    const p = join(inspection.path, 'specs', rel)
    if (existsSync(p)) out[`specs/${rel}`] = readFileSync(p, 'utf8')
  }
  return out
}

// A caller-supplied artifact map is filtered to strings: a stray object would
// otherwise reach the risk classifier's text matching as "[object Object]".
function normalizeArtifacts(input) {
  const out = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  for (const key of Object.keys(input)) {
    if (typeof input[key] === 'string') out[key] = input[key]
  }
  return out
}

/**
 * Compute the blocker count from the artifact review's own findings.
 *
 * This is the whole of §continuity-provenance. The number that decides whether
 * a human reads a specification used to be written by the party being gated —
 * `skills/spec/continuity.md` had the agent `printf` it into a file, and this
 * module validated its *shape* but never its *provenance*. Meanwhile
 * `evaluateGate` was already computing the real count from the real findings
 * and the value was thrown away.
 *
 * `evaluateGate` is reused rather than reimplemented for the same reason
 * `extractScenarios` is shared with lib/conformance.mjs: a second counting
 * implementation lets the readiness gate and the review gate disagree about
 * one findings file, and nobody notices until the two contradict each other.
 *
 * Fails closed on anything it cannot read. Absent, blank and unparseable all
 * resolve to *the review did not run*, never to zero — an unreadable findings
 * file is not a findings file with no blockers.
 *
 * @param {unknown} findings parsed findings, or the raw text of the file
 * @returns {{ran: boolean, blockers?: number, warnings?: number, reason?: string}}
 */
function readFindings(findings) {
  if (findings === undefined || findings === null) {
    return { ran: false, reason: 'no artifact-review findings file was supplied' }
  }

  let parsed = findings
  if (typeof findings === 'string') {
    if (!findings.trim()) {
      return { ran: false, reason: 'the artifact-review findings file is empty' }
    }
    try {
      parsed = JSON.parse(findings)
    } catch (err) {
      return { ran: false, reason: `the artifact-review findings file is not valid JSON: ${messageOf(err)}` }
    }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ran: false, reason: 'the artifact-review findings are not an object or an array' }
  }

  const got = attempt(() => evaluateGate(parsed))
  if (!got.ok) {
    return { ran: false, reason: `the artifact-review findings could not be evaluated: ${got.error}` }
  }
  const gate = got.value
  return {
    ran: true,
    blockers: gate.blockers.length,
    warnings: gate.counts.warning,
    malformed: gate.malformed.length,
    total: gate.total
  }
}

/**
 * Interpret a hand-written artifact-review count.
 *
 * Retained for one release, and no longer sufficient on its own: its
 * provenance is the agent being gated. Only an object carrying a usable
 * `blockers` count counts as "supplied at all" — `undefined`, `true`, an empty
 * object and a negative count are all *unrun*, never zero.
 */
function readReview(review) {
  if (!review || typeof review !== 'object' || Array.isArray(review)) {
    return { ran: false, reason: 'no artifact-review result was supplied' }
  }
  const blockers = countOf(review.blockers)
  if (blockers === null) {
    return { ran: false, reason: 'the artifact-review result carried no usable blocker count' }
  }
  const warnings = countOf(review.warnings)
  return { ran: true, blockers, warnings: warnings === null ? 0 : warnings, reason: null }
}

// A count may arrive as a number or as the array it counts. Anything else is
// "not a count" (null), which the caller above turns into "the review did not
// run" rather than into a zero.
function countOf(value) {
  if (Array.isArray(value)) return value.length
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.trunc(value)
  return null
}

/**
 * Every `#### Scenario:` in the artifacts, with the section text under it.
 *
 * Exported because `lib/conformance.mjs` needs exactly this parse and a second
 * implementation would drift from it — the two would then disagree about what
 * counts as a scenario, which is the kind of divergence nobody notices until a
 * conformance report and a readiness gate contradict each other.
 */
export function extractScenarios(artifacts) {
  const found = []
  for (const name of Object.keys(artifacts)) {
    if (name === 'tasks.md') continue
    const lines = artifacts[name].split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      const m = SCENARIO_HEADING.exec(lines[i].trim())
      if (!m) continue
      const body = []
      for (let j = i + 1; j < lines.length; j += 1) {
        if (ANY_HEADING.test(lines[j])) break
        body.push(lines[j])
      }
      found.push({ artifact: name, line: i + 1, title: m[1], body: body.join('\n') })
    }
  }
  return found
}

// --- the checks ----------------------------------------------------------

function checkDecisions(run, root, change) {
  const ids = ['decisions.ledger-present', 'decisions.needs-human', 'decisions.rows-valid']
  const got = attempt(() => {
    const parsed = readLedger(root, change)
    return { parsed, summary: summarize(parsed) }
  })
  if (!got.ok) {
    blockAll(run, ids, 'LEDGER_UNREADABLE', `the decision ledger could not be read: ${got.error}`, [got.error])
    return null
  }

  const { parsed, summary } = got.value

  if (!summary.exists) {
    if (STRICTNESS.requireLedger) {
      // The quiet failure mode this exists to catch: no ledger reads as
      // "nothing needed a human" only if you assume explore and spec had
      // nothing to record. Under fail-closed it reads as "unknown".
      blockAll(
        run,
        ids,
        'LEDGER_MISSING',
        `no decision ledger at ${parsed.path} — explore and spec never recorded their decisions, ` +
          'so there is nothing to prove no human is needed. Run /interlock:spec again to write decisions.md.',
        [parsed.path]
      )
      return summary
    }
    for (const id of ids) skip(run, id, 'no decision ledger, and the current strictness does not require one')
    return summary
  }
  pass(run, ids[0], `decision ledger present with ${summary.total} row(s)`)

  if (summary.needsHuman > STRICTNESS.maxNeedsHuman) {
    const rows = (parsed.rows || [])
      .filter(r => r.valid && r.class === 'needs_human')
      .map(r => `${r.id || `line ${r.line}`}: ${clip(r.question)}`)
    block(
      run,
      ids[1],
      'DECISIONS_NEED_HUMAN',
      `${summary.needsHuman} decision(s) still need a human (max ${STRICTNESS.maxNeedsHuman})`,
      rows
    )
  } else {
    pass(run, ids[1], `no needs_human rows (${summary.agentResolved} agent_resolved)`)
  }

  if (summary.invalid > STRICTNESS.maxInvalidDecisions) {
    const rows = (parsed.invalid || []).map(({ row, reason }) => `${row.id || `line ${row.line}`}: ${clip(reason)}`)
    block(
      run,
      ids[2],
      'DECISIONS_INVALID',
      `${summary.invalid} ledger row(s) are malformed or unsubstantiated — an unreadable row counts as unresolved`,
      rows
    )
  } else {
    pass(run, ids[2], 'every ledger row parses and substantiates its class')
  }

  return summary
}

function checkArtifactsImplementable(run, inspection) {
  if (inspection.ready) {
    pass(
      run,
      'artifacts.implementable',
      `proposal.md, design.md and tasks.md present and non-empty; ${inspection.tasks.total} task(s)`
    )
    return
  }
  block(
    run,
    'artifacts.implementable',
    'ARTIFACTS_INCOMPLETE',
    `change artifacts are not implementable as written (interlock validate would fail)`,
    inspection.problems || []
  )
}

function checkReview(run, findings, review) {
  const derived = readFindings(findings)
  const transcribed = readReview(review)

  // Both supplied and disagreeing: the findings decide, and the disagreement is
  // reported rather than resolved silently in either direction. A silent
  // resolution here would hide exactly the case this change exists for — the
  // gated agent's number differing from the review's own.
  if (derived.ran && transcribed.ran && derived.blockers !== transcribed.blockers) {
    warn(
      run,
      'REVIEW_COUNT_DISAGREEMENT',
      `the findings file yields ${derived.blockers} blocker(s) but the supplied count says ` +
        `${transcribed.blockers} — the findings decide, because the transcribed count's ` +
        `provenance is the agent being gated`
    )
  }

  if (!derived.ran) {
    if (transcribed.ran) {
      // The deprecated input, on its own. Not a pass: a count written by the
      // party being gated is a self-report, not a review result.
      block(
        run,
        'artifacts.review-blockers',
        'REVIEW_SELF_REPORTED',
        `${derived.reason}, and the only artifact-review input is a transcribed count whose ` +
          `provenance is the gated agent itself — pass the review's findings file to ` +
          `--findings so the count is derived from the review rather than reported by it`,
        []
      )
      return
    }
    // An unrun check is not a clean check. Without this branch the whole
    // artifact-review arm of §F1 C is bypassed by omitting one argument.
    block(
      run,
      'artifacts.review-blockers',
      'REVIEW_NOT_RUN',
      `${derived.reason} — an artifact review that did not run is not an artifact review with zero blockers`,
      []
    )
    return
  }

  const r = derived
  if (r.malformed > 0) {
    block(
      run,
      'artifacts.review-findings-malformed',
      'REVIEW_FINDINGS_MALFORMED',
      `${r.malformed} artifact-review finding(s) carry a severity outside the defined set — ` +
        'a finding the gate cannot interpret is not a finding the gate may ignore'
    )
  }
  if (r.warnings > 0) {
    if (STRICTNESS.artifactWarningsBlock) {
      block(
        run,
        'artifacts.review-warnings',
        'REVIEW_WARNINGS',
        `${r.warnings} artifact-review warning(s), and strictness "${STRICTNESS.name}" blocks on warnings`
      )
    } else {
      warn(run, 'REVIEW_WARNINGS', `${r.warnings} artifact-review warning(s) — not blocking under "${STRICTNESS.name}"`)
    }
  }
  if (r.blockers > STRICTNESS.maxArtifactBlockers) {
    block(
      run,
      'artifacts.review-blockers',
      'REVIEW_BLOCKERS',
      `${r.blockers} artifact-review blocker(s) (max ${STRICTNESS.maxArtifactBlockers})`
    )
    return
  }
  pass(
    run,
    'artifacts.review-blockers',
    `artifact review ran: ${r.blockers} blocker(s), ${r.warnings} warning(s), ` +
      `derived from the review's own findings (${r.total} reportable finding(s))`
  )
}

function checkScenarioCoverage(run, artifacts, tasks) {
  const scenarios = extractScenarios(artifacts)
  if (scenarios.length === 0) {
    // Not a blocker: a change may legitimately carry no delta specs. Loud
    // enough that a missing specs/ directory is visible at the checkpoint.
    warn(run, 'NO_SCENARIOS', 'no "#### Scenario:" blocks found in the change artifacts — nothing to map to tasks')
    pass(run, 'specs.scenarios-mapped', 'no scenarios to map')
    return
  }

  const taskTexts = tasks.map(t => normalize(t.text)).filter(Boolean)
  const unmapped = []
  for (const s of scenarios) {
    const title = normalize(s.title)
    const explicit = TASK_COVERAGE_MARKER.test(s.title) || TASK_COVERAGE_MARKER.test(s.body)
    const named = title.length >= MIN_TITLE_CHARS && taskTexts.some(t => t.includes(title))
    if (!explicit && !named) {
      unmapped.push(`${s.artifact}:${s.line} Scenario: ${clip(s.title)}`)
    }
  }

  if (unmapped.length) {
    block(
      run,
      'specs.scenarios-mapped',
      'SCENARIO_UNMAPPED',
      `${unmapped.length} of ${scenarios.length} scenario(s) map to no task — name the scenario in a task, ` +
        'or write "covered by task N" under the scenario',
      unmapped
    )
    return
  }
  pass(run, 'specs.scenarios-mapped', `all ${scenarios.length} scenario(s) map to at least one task`)
}

function checkWeaselPhrases(run, tasks) {
  const offenders = []
  for (const task of tasks) {
    const text = String(task.text ?? '')
    if (ACCEPTANCE_MARKER.test(text)) continue
    for (const { phrase, re } of WEASEL_PATTERNS) {
      if (re.test(text)) {
        offenders.push(`tasks.md:${task.line} "${phrase}" — ${clip(text)}`)
        break
      }
    }
  }
  if (offenders.length) {
    block(
      run,
      'tasks.no-weasel-phrases',
      'TASK_UNSPECIFIC',
      `${offenders.length} task(s) describe an intention rather than a change — ` +
        'rewrite them, or state what done means with "acceptance: …"',
      offenders
    )
    return
  }
  pass(run, 'tasks.no-weasel-phrases', `${tasks.length} task(s) carry no unqualified vague phrasing`)
}

function checkRisk(run, risk) {
  if (!risk.ok) {
    blockAll(run, ['risk.class-allowed'], 'RISK_UNCLASSIFIABLE', `risk could not be classified: ${risk.error}`, [
      risk.error
    ])
    return
  }
  const result = risk.value
  // `continuityAllowed` is computed by lib/risk.mjs from the allowlist we hand
  // it; the explicit membership test is deliberate redundancy, so a future
  // caller passing its own allowedClasses cannot widen this gate by accident.
  const allowed = STRICTNESS.allowedRiskClasses.includes(result.riskClass) && result.continuityAllowed === true
  if (!allowed) {
    block(
      run,
      'risk.class-allowed',
      'RISK_CLASS_BLOCKED',
      `risk class "${result.riskClass}" is outside {${STRICTNESS.allowedRiskClasses.join(', ')}} — human checkpoint required`,
      result.signals.filter(s => s.class === result.riskClass).map(s => `${s.signal}: ${clip(s.evidence)}`)
    )
    return
  }
  pass(run, 'risk.class-allowed', `risk class "${result.riskClass}" may continue under "${STRICTNESS.name}"`)
}

function checkTestProfile(run, root) {
  if (!STRICTNESS.requireTestProfile) {
    skip(run, 'runtime.test-profile', 'test profile not required by the current strictness')
    return
  }
  const path = join(root, TEST_PROFILE_PATH)
  const got = attempt(() => {
    if (!existsSync(path)) return { present: false, parsed: false }
    if (statSync(path).size === 0) return { present: true, parsed: false }
    JSON.parse(readFileSync(path, 'utf8'))
    return { present: true, parsed: true }
  })
  if (!got.ok) {
    block(run, 'runtime.test-profile', 'TEST_PROFILE_UNREADABLE', `${TEST_PROFILE_PATH} could not be read: ${got.error}`, [
      got.error
    ])
    return
  }
  if (!got.value.present) {
    block(
      run,
      'runtime.test-profile',
      'TEST_PROFILE_MISSING',
      `no ${TEST_PROFILE_PATH} — ship would have to guess how to run the tests. Run /interlock:fix-tests --reconfigure once.`,
      [path]
    )
    return
  }
  if (!got.value.parsed) {
    block(run, 'runtime.test-profile', 'TEST_PROFILE_UNREADABLE', `${TEST_PROFILE_PATH} is empty or not valid JSON`, [path])
    return
  }
  pass(run, 'runtime.test-profile', `${TEST_PROFILE_PATH} present and parseable`)
}

// §F1 items this release deliberately does not check. Listed rather than
// omitted so the printed checklist is the whole checklist, and so nobody reads
// a short green list as "everything in F1 passed".
function addSkips(run) {
  skip(
    run,
    'intent.lock',
    'not machine-checkable from artifacts (§F0): whether this is the *right* change, and whether a bug-fix ' +
      'carries repro evidence, stay with the human. Continuity knowingly accepts this residual risk.'
  )
  skip(
    run,
    'tasks.wave-classifiable',
    'not implemented in this release — wave classification runs in lib/waves.mjs at ship time, not here'
  )
  skip(
    run,
    'invariants.consumers-enumerated',
    'not implemented in this release — enumerating sweep consumers needs the graph, which this gate does not read'
  )
  skip(
    run,
    'runtime.agent-tool',
    'not observable from this process — the ship workflow reports the Agent tool being unavailable at run time'
  )
  skip(
    run,
    'learning.failure-streak',
    'eligibility gating is deliberately out of scope for this release (§4.15a / F6.6): outcomes are recorded, nothing gates on them'
  )
  skip(
    run,
    'learning.path-autonomy',
    'eligibility gating is deliberately out of scope for this release (§4.15a / F6.6): autonomy level never implies continuity (§F7)'
  )
}

// --- public API ----------------------------------------------------------

/**
 * Assess whether one change may continue past the human checkpoint (§F1).
 *
 * Composes `lib/artifacts.mjs`, `lib/ledger.mjs` and `lib/risk.mjs` under the
 * §4.14 "balanced" policy in `STRICTNESS`. Nothing here re-derives what those
 * modules already decide.
 *
 * @param {string} root repo root
 * @param {string} [change] change name; resolved via `resolveChange` when omitted
 * @param {{
 *   findings?: unknown,
 *   review?: {blockers: number|Array, warnings?: number|Array},
 *   changedPaths?: string[],
 *   plannedPaths?: string[],
 *   artifacts?: Record<string,string>
 * }} [opts]
 *   `findings` is the artifact review's own findings output — parsed, or the
 *   raw text of the file. The blocker count is derived from it by
 *   `evaluateGate`. **Omitting it blocks**, and so does supplying only
 *   `review`, which is the deprecated hand-written count: its provenance is
 *   the agent being gated. `changedPaths`/`plannedPaths` feed `classifyRisk`.
 *   `artifacts` overrides reading the change directory (mostly for tests).
 * @returns {{
 *   ready: boolean,
 *   change: string,
 *   strictness: string,
 *   blockers: Array<{code: string, message: string, evidence: string[]}>,
 *   warnings: Array<{code: string, message: string}>,
 *   decisions: {needsHuman: number|null, agentResolved: number|null, invalid: number|null, exists: boolean|null},
 *   riskClass: string|null,
 *   continuityAllowed: boolean,
 *   // `continuityAllowed` is the risk module's answer ANDed with `ready`, not
 *   // the raw risk verdict: an allowed risk class is necessary but nowhere
 *   // near sufficient, and a caller reading this field as the gate must not
 *   // end up bypassing the ledger and artifact checks. `riskClass` and the
 *   // `risk.class-allowed` check carry the risk-only answer.
 *   checks: Array<{id: string, status: 'pass'|'fail'|'skip', detail: string}>,
 *   scores: object
 * }}
 */
export function assessReadiness(root, change, opts = {}) {
  if (typeof root !== 'string' || !root.trim()) fail('readiness requires a repo root')
  const options = opts && typeof opts === 'object' ? opts : {}

  const resolved = resolveChange(root, change)
  if (resolved.error) {
    fail(
      `${resolved.error}${resolved.candidates && resolved.candidates.length ? `\n  candidates: ${resolved.candidates.join(', ')}` : ''}`
    )
  }
  const name = resolved.name

  const run = { checks: [], blockers: [], warnings: [] }

  // 1. Artifacts. Everything downstream of them (scenarios, tasks, risk text)
  //    fails together when they cannot be read.
  const inspected = attempt(() => inspectChange(root, name))
  const artifactsGot = attempt(() => {
    if (!inspected.ok) throw new Error(inspected.error)
    return options.artifacts !== undefined
      ? normalizeArtifacts(options.artifacts)
      : readArtifactsFromDisk(inspected.value)
  })

  const artifactDependents = [
    'artifacts.implementable',
    'specs.scenarios-mapped',
    'tasks.no-weasel-phrases',
    'risk.class-allowed'
  ]

  let riskResult = null

  if (!inspected.ok || !artifactsGot.ok) {
    const reason = inspected.ok ? artifactsGot.error : inspected.error
    blockAll(run, artifactDependents, 'ARTIFACTS_UNREADABLE', `change artifacts could not be read: ${reason}`, [reason])
  } else {
    const inspection = inspected.value
    const artifacts = artifactsGot.value
    const tasks = typeof artifacts['tasks.md'] === 'string' ? parseTasks(artifacts['tasks.md']) : inspection.tasks.items

    checkArtifactsImplementable(run, inspection)
    checkScenarioCoverage(run, artifacts, tasks)
    checkWeaselPhrases(run, tasks)

    const paths = Array.isArray(options.changedPaths)
      ? options.changedPaths
      : Array.isArray(options.plannedPaths)
        ? options.plannedPaths
        : []
    const risk = attempt(() =>
      classifyRisk({ changedPaths: paths, artifacts }, { allowedClasses: STRICTNESS.allowedRiskClasses })
    )
    checkRisk(run, risk)
    riskResult = risk.ok ? risk.value : null
  }

  // 2. The ledger, and the artifact review the caller ran for us.
  const decisions = checkDecisions(run, root, name)
  checkReview(run, options.findings, options.review)

  // 3. Runtime readiness, then the checklist items we chose not to automate.
  checkTestProfile(run, root)
  addSkips(run)

  const failed = run.checks.filter(c => c.status === 'fail').length
  const passed = run.checks.filter(c => c.status === 'pass').length
  const skipped = run.checks.filter(c => c.status === 'skip').length

  // `ready` is an AND of affirmative passes, not the absence of a complaint.
  const ready = run.blockers.length === 0 && failed === 0 && passed > 0

  return {
    ready,
    change: name,
    strictness: STRICTNESS.name,
    blockers: run.blockers,
    warnings: run.warnings,
    decisions: {
      needsHuman: decisions ? decisions.needsHuman : null,
      agentResolved: decisions ? decisions.agentResolved : null,
      invalid: decisions ? decisions.invalid : null,
      exists: decisions ? decisions.exists : null
    },
    riskClass: riskResult ? riskResult.riskClass : null,
    continuityAllowed: Boolean(ready && riskResult && riskResult.continuityAllowed),
    checks: run.checks,
    scores: {
      checksTotal: run.checks.length,
      checksPassed: passed,
      checksFailed: failed,
      checksSkipped: skipped,
      blockers: run.blockers.length,
      warnings: run.warnings.length
    }
  }
}

const STATUS_MARK = { pass: 'ok  ', fail: 'FAIL', skip: 'skip' }

/** Human-readable readiness, for a skill to echo before it decides. */
export function formatReadiness(result) {
  const lines = []
  lines.push(
    result.ready
      ? `READY — ${result.change} may continue (risk ${result.riskClass}, strictness ${result.strictness})`
      : `NOT READY — ${result.change}: ${result.blockers.length} blocker(s) ` +
        `(risk ${result.riskClass ?? 'unknown'}, strictness ${result.strictness})`
  )
  for (const c of result.checks) {
    lines.push(`  [${STATUS_MARK[c.status] || c.status}] ${c.id}: ${c.detail}`)
  }
  for (const b of result.blockers) {
    lines.push(`  blocker ${b.code}: ${b.message}`)
    for (const e of b.evidence || []) lines.push(`      ${e}`)
  }
  for (const w of result.warnings) lines.push(`  warning ${w.code}: ${w.message}`)
  return lines.join('\n') + '\n'
}
