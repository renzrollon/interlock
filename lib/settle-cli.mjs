// The `interlock settle` subcommand family: everything the `settle` skill's review loop
// reads off the CLI instead of typing itself (design D13 of
// close-the-merge-request-loop). `comment` and `replies` render the two things
// a reader sees on the pull request; `remediate-brief` and `conformance-brief`
// print the briefings the loop hands its workers, and `remediate-brief --out`
// keeps the briefing's record; `fixer-result` checks what a fixer wrote back
// against the ids that record lists, so the deferrals are decided once, by the
// briefing, and never worked out again after the fixer ran; `test-paths` names the files
// a fixer touched that the test guard would have refused; `tree-check` says
// whether the working tree is clean before the loop stages anything.
//
// Every refusal is exit 1, the reason on standard error and nothing on standard
// output: the skill branches on the exit status. `remediate-brief` exiting 1
// with a reason that starts `STOP: ` is the loop's stop signal; any other exit 1
// is an input the loop must not act on. `tree-check` on a dirty tree is the one
// exit 1 that prints: the dirty list on stdout, the verdict on stderr.
//
// Reviewer-written text is untrusted: it is posted on the pull request under
// the account of whoever ran the skill. Titles, files and stray severities go
// through `inertSpan`; descriptions and suggestions go in a code fence no line
// of the text can close. Same-key findings are one finding: `survivingOf`
// merges them at the highest severity before anything renders or plans.
//
// The entry file's own helpers come in as `io` — `emit`, `die`, `readStdin`,
// `readFindingsInput`, and `livingListFor` for the conformance gather, which
// needs the entry file's git readers — so stdout and exit codes stay exactly the
// CLI's. Without `io.livingListFor` the living list is reported as not built,
// with that reason, never dropped quietly.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { buildChecklist } from './conformance.mjs'
import { SEVERITIES, TOLERANCE_BAND, findingId, findingKey, normalizeSeverity } from './findings.mjs'
import { LIMITS } from './limits.mjs'
import { inertSpan } from './merge-confidence.mjs'
import { NOTES_PATH } from './notes.mjs'
import { assembleSettleRemediatePrompt } from './prompts/settle-remediate.mjs'
import { planRemediation } from './remediate.mjs'
import { isTestPath, loadTestProfile, testRootsFromProfile } from './test-paths.mjs'

export const SETTLE_SUBCOMMANDS = Object.freeze([
  'comment',
  'replies',
  'remediate-brief',
  'fixer-result',
  'conformance-brief',
  'test-paths',
  'tree-check'
])

const USAGE_LINES = Object.freeze({
  comment: 'interlock settle comment --review <file> --head <sha> --round <n> [--json]',
  replies: 'interlock settle replies --before <file> --after <file> --head <sha> [--json]',
  'remediate-brief':
    'interlock settle remediate-brief --review <file> --round <n> --change <name> --head <sha> [--pr <n>] [--profile <file>] [--result <file>] [--previous <file>] [--out <file>] [--json]',
  'fixer-result':
    'interlock settle fixer-result --result <file> --review <file> --round <n> [--head <sha>] [--brief <file> | [--profile <file>] [--previous <file>]] [--json]',
  'conformance-brief':
    'interlock settle conformance-brief <change> --changed <files|-> --base <ref> --head <sha> [--result <file>] [--json]',
  'test-paths': 'interlock settle test-paths --changed <files|-> [--profile <file>] [--protected-only [--nul]] [--json]',
  'tree-check': 'interlock settle tree-check --change <name> --status <file|-> [--json]'
})

export const SETTLE_HELP =
  `Usage:\n${SETTLE_SUBCOMMANDS.map(s => `  ${USAGE_LINES[s]}`).join('\n')}\n\n` +
  `The settle loop's renderers and checks. Each refusal exits 1 with the reason on standard\n` +
  `error and nothing on standard output.\n` +
  `  comment            the surviving findings of a head-bound review, each with a stable id\n` +
  `  replies            what each finding of the previous round became: fixed, open or new\n` +
  `  remediate-brief    the fixer's briefing for one round; exits 1 with "STOP: " when no round should be briefed\n` +
  `  fixer-result       checks a fixer's result against the ids its round was briefed (--brief: the record --out kept)\n` +
  `  conformance-brief  the scenario and living-requirement checklist, as a briefing for one worker\n` +
  `  test-paths         which changed paths the test guard protects (--protected-only --nul feeds git restore)\n` +
  `  tree-check         whether git status -z --untracked-files=all is clean; exits 1 listing what is not\n`

export const DEFAULT_HANDOFF_PATH = '.claude/ship/settle/handoff.json'
const PROFILE_REL = '.claude/testing/profile.json'

/** What every stop-rule refusal of `remediate-brief` starts with; no input refusal carries it. */
export const STOP_PREFIX = 'STOP: '

/** The replies table's legend: what "fixed" means, and what it does not. */
export const FIXED_LEGEND = 'fixed = not raised again under the same file and title by a fresh review; not a confirmation.'

/**
 * The suffix half of `isTestPath`, in words: its `/\.(test|spec)\.[a-z0-9]+$/i`
 * applied to the project-relative path. It protects with a profile even when
 * the profile names no test root.
 */
export const TEST_SUFFIX_RULE =
  'any path whose file name ends in .test.<ext> or .spec.<ext> (any letter case; <ext> is letters and digits)'

/**
 * The paths `tree-check` lets differ from HEAD: the summary the skill's §8
 * writes, and the notes file the nested review's `interlock note derive`
 * appends to. The skill's staging line excludes exactly these two.
 */
export function toleratedPaths(change) {
  return [`openspec/changes/${change}/settle-summary.md`, NOTES_PATH]
}

/** A flag's string value, or '' when it is absent or was given without one. */
const strFlag = (flags, key) => (typeof flags[key] === 'string' ? flags[key].trim() : '')

/** Refuse a missing required flag with the subcommand's usage line. */
function requireFlags(io, sub, flags, names) {
  const missing = names.filter(n => !strFlag(flags, n))
  if (missing.length) io.die(`settle ${sub} requires ${missing.map(n => `--${n}`).join(', ')}\nusage: ${USAGE_LINES[sub]}`)
}

function requireInt(io, sub, flags, key, min) {
  const raw = strFlag(flags, key)
  if (!/^\d+$/.test(raw) || Number(raw) < min) {
    io.die(`settle ${sub}: --${key} must be an integer of at least ${min} (got ${JSON.stringify(flags[key])})\nusage: ${USAGE_LINES[sub]}`)
  }
  return Number(raw)
}

/** A boolean flag. The parser hands a following non-flag token over as its value; that is refused, not read as true. */
function boolFlag(io, sub, flags, key) {
  const v = flags[key]
  if (v === undefined) return false
  if (v === true) return true
  io.die(`settle ${sub}: --${key} takes no value (got ${JSON.stringify(v)})\nusage: ${USAGE_LINES[sub]}`)
}

/**
 * An adjudicated review record: the file as the CLI reads any findings input,
 * refused when it carries no `surviving` list. A record that carries only raw
 * `findings` is a review nobody adjudicated, and rendering it would present
 * unadjudicated claims as the review's result.
 */
function loadReview(io, value, what) {
  if (value !== '-') {
    try {
      statSync(value)
    } catch (err) {
      io.die(`${what} ${value} could not be read: ${(err && err.message) || String(err)}`)
    }
  }
  const input = io.readFindingsInput(value, what)
  if (!input || Array.isArray(input) || !Array.isArray(input.surviving)) {
    io.die(
      `${what} ${value === '-' ? '(stdin)' : value} is not an adjudicated review: it carries no "surviving" list, ` +
        `so no finding could be adjudicated (produce it with "interlock review --out")`
    )
  }
  return input
}

const isObject = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

const SEVERITY_RANK = sev => {
  const i = SEVERITIES.indexOf(normalizeSeverity(sev))
  return i < 0 ? SEVERITIES.length : i
}

const scoresOf = f => [
  ...(Array.isArray(f.qualityScores) ? f.qualityScores : []),
  ...(f.qualityScore === undefined ? [] : [f.qualityScore])
]

/**
 * The record's surviving findings, one per identity: findings with one key are
 * one finding, kept at the highest severity any of them carries. The
 * representative is the member with the highest normalised severity (the first
 * of them on a tie), its severity canonicalised when it is one of ours. A
 * merged group pools every member's quality scores, as the tolerance band
 * pools repeated entries, so merging cannot drop a finding the band would have
 * kept. Order is the order each key first appears.
 */
function survivingOf(record) {
  const groups = new Map()
  for (const f of record.surviving) {
    if (!isObject(f)) continue
    const key = findingKey(f)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(f)
  }
  return [...groups.values()].map(members => {
    let rep = members[0]
    for (const m of members) if (SEVERITY_RANK(m.severity) < SEVERITY_RANK(rep.severity)) rep = m
    const severity = normalizeSeverity(rep.severity)
    const out = severity === null || severity === rep.severity ? { ...rep } : { ...rep, severity }
    if (members.length > 1) {
      const pooled = members.flatMap(scoresOf)
      delete out.qualityScore
      if (pooled.length) out.qualityScores = pooled
      else delete out.qualityScores
    }
    return out
  })
}

/** Refuse a record that does not describe `head`: evidence about another commit is no evidence. */
function requireHead(io, record, what, file, head) {
  if (typeof record.head !== 'string' || !record.head) {
    io.die(`${what} ${file} records no head, so it is not bound to ${head}; produce it with "interlock review --out <file> --head ${head}"`)
  }
  if (record.head !== head) {
    io.die(`${what} ${file} describes another commit: it records ${record.head}, and the head is ${head}`)
  }
}

const placeOf = f => {
  const file = typeof f.file === 'string' && f.file.trim() ? f.file : '(unscoped)'
  return Number.isFinite(f.line) ? `${file}:${f.line}` : file
}
const titleOf = f => (typeof f.title === 'string' && f.title.trim() ? f.title : '(untitled)')

/** A known severity as itself; anything else is reviewer text, so it is quoted inert. */
const severityOf = (f, opts) =>
  SEVERITIES.includes(f.severity) ? f.severity : inertSpan(typeof f.severity === 'string' ? f.severity : '(missing)', opts)

/**
 * Reviewer prose in a backtick fence longer than any backtick run inside it
 * (at least three), so no line of the text can close it early.
 */
function fenced(text) {
  const runs = text.match(/`+/g) || []
  const fence = '`'.repeat(Math.max(3, ...runs.map(r => r.length + 1)))
  return [fence, text, fence]
}

/** The identity-bearing summary a comment and a reply table both list. */
const summaryOf = f => ({
  id: findingId(f),
  key: findingKey(f),
  severity: typeof f.severity === 'string' ? f.severity : null,
  file: typeof f.file === 'string' ? f.file : null,
  line: Number.isFinite(f.line) ? f.line : null,
  title: typeof f.title === 'string' ? f.title : null
})

// --- comment ------------------------------------------------------------------

function commentCommand(io, flags, json) {
  requireFlags(io, 'comment', flags, ['review', 'head', 'round'])
  const round = requireInt(io, 'comment', flags, 'round', 0)
  const head = strFlag(flags, 'head')
  const record = loadReview(io, flags.review, '--review')
  requireHead(io, record, '--review', flags.review, head)
  const findings = survivingOf(record)
  const inTable = { inTable: true }

  io.emit(
    json,
    { head, round, findings: findings.map(summaryOf) },
    findings.length === 0
      ? `Review round ${round} on ${head}: the review raised no surviving finding.\n`
      : [
          `## Review round ${round} — ${head}`,
          '',
          '| Id | Severity | Location | Finding |',
          '| --- | --- | --- | --- |',
          ...findings.map(
            f => `| ${findingId(f)} | ${severityOf(f, inTable)} | ${inertSpan(placeOf(f), inTable)} | ${inertSpan(titleOf(f), inTable)} |`
          ),
          '',
          ...findings.flatMap(f => [
            `**${findingId(f)}** (${severityOf(f)}) ${inertSpan(placeOf(f))} — ${inertSpan(titleOf(f))}`,
            ...(typeof f.description === 'string' && f.description.trim() ? ['', ...fenced(f.description.trim())] : []),
            ...(typeof f.suggestion === 'string' && f.suggestion.trim() ? ['', 'Suggestion:', ...fenced(f.suggestion.trim())] : []),
            ''
          ])
        ].join('\n')
  )
}

// --- replies ------------------------------------------------------------------

function repliesCommand(io, flags, json) {
  requireFlags(io, 'replies', flags, ['before', 'after', 'head'])
  const head = strFlag(flags, 'head')
  const before = loadReview(io, flags.before, '--before')
  const after = loadReview(io, flags.after, '--after')
  requireHead(io, after, '--after', flags.after, head)

  const was = survivingOf(before)
  const now = survivingOf(after)
  const nowKeys = new Set(now.map(findingKey))
  const wasKeys = new Set(was.map(findingKey))
  const fixed = was.filter(f => !nowKeys.has(findingKey(f)))
  const open = now.filter(f => wasKeys.has(findingKey(f)))
  const added = now.filter(f => !wasKeys.has(findingKey(f)))
  const counts = { fixed: fixed.length, open: open.length, new: added.length }
  const inTable = { inTable: true }

  const rows = [
    ...fixed.map(f => ['fixed', f]),
    ...open.map(f => [f.carried === true ? 'open (carried)' : 'open', f]),
    ...added.map(f => ['new', f])
  ]
  io.emit(
    json,
    {
      head,
      fixed: fixed.map(summaryOf),
      open: open.map(f => ({ ...summaryOf(f), ...(f.carried === true ? { carried: true } : {}) })),
      new: added.map(summaryOf),
      counts
    },
    [
      `## Review replies — ${head}`,
      '',
      ...(rows.length
        ? [
            `${counts.fixed} fixed, ${counts.open} open, ${counts.new} new.`,
            '',
            FIXED_LEGEND,
            '',
            '| Id | Status | File | Finding |',
            '| --- | --- | --- | --- |',
            ...rows.map(
              ([status, f]) =>
                `| ${findingId(f)} | ${status} | ${inertSpan(typeof f.file === 'string' && f.file.trim() ? f.file : '(unscoped)', inTable)} | ${inertSpan(titleOf(f), inTable)} |`
            )
          ]
        : ['No finding was raised before this round or after it.'])
    ].join('\n') + '\n'
  )
}

// --- protection ---------------------------------------------------------------

/**
 * The test profile a classification reads: `--profile <file>` (a snapshot,
 * resolved against the root) or the project's own. Never a throw: a missing or
 * unreadable profile is a state with its reason, and nothing is protected.
 * `lib/test-paths.mjs` is not asked to read the snapshot because hooks import it.
 */
function protectionFor(io, sub, root, flags) {
  let path = PROFILE_REL
  let profile
  if (flags.profile !== undefined) {
    path = strFlag(flags, 'profile')
    if (!path) io.die(`settle ${sub}: --profile needs a file\nusage: ${USAGE_LINES[sub]}`)
    try {
      const value = JSON.parse(readFileSync(resolve(root, path), 'utf8'))
      profile = value && typeof value === 'object' ? value : null
    } catch {
      profile = null
    }
  } else {
    profile = loadTestProfile(root)
  }
  if (!profile) {
    const state = existsSync(resolve(root, path)) ? 'unreadable' : 'missing'
    const reason =
      state === 'missing'
        ? `no test profile at ${path} — nothing is protected`
        : `test profile at ${path} could not be read — nothing is protected`
    return { profile: path, state, roots: [], suffixRule: null, reason, protects: () => false }
  }
  const { roots } = testRootsFromProfile(profile)
  return {
    profile: path,
    state: 'ok',
    roots,
    suffixRule: TEST_SUFFIX_RULE,
    reason: roots.length ? null : `test profile at ${path} names no test root — only the file-name rule protects`,
    protects: p => isTestPath(resolve(root, p), roots, root)
  }
}

const protectionFacts = ({ profile, state, roots, suffixRule, reason }) => ({ profile, state, roots, suffixRule, reason })

// --- remediate-brief ----------------------------------------------------------

/**
 * One round's plan under the ship loop's own stop rule (`run remediated`): the
 * round as asked, and when a later round has no surviving blocker, the verdict
 * round instead, which plans no fix. Returns the plan, `{ stop }` for a round
 * past the verdict round, or `{ refusal }` for an input the planner refused.
 */
function planRound(findings, round) {
  const cap = LIMITS.remediationRounds
  const verdict = cap + 1
  const planAt = at => planRemediation(findings, { round: at, limits: LIMITS, band: TOLERANCE_BAND })
  let plan
  try {
    plan = planAt(round)
  } catch (err) {
    const why = (err && err.message) || String(err)
    return round > verdict
      ? { stop: `round ${round} is past the verdict round (round ${verdict}; remediationRounds=${cap}): ${why}` }
      : { refusal: why }
  }
  if (round > 1 && plan.counts.blockers === 0 && !plan.isFinalRound) {
    try {
      plan = planAt(verdict)
    } catch (err) {
      return { refusal: (err && err.message) || String(err) }
    }
    return { plan, rebuilt: true }
  }
  return { plan, rebuilt: false }
}

/**
 * The fixer result a `--previous` names, read as `fixer-result` reads one (the
 * same shape checks, the same refusals) and refused when it is for a round other
 * than `round - 1`. A result that records a `round` is held to it; otherwise the
 * round is read from the `remediate-r<n>.json` name the loop gives the file.
 * Returns the `notFixed` entries. Never carries the `STOP:` prefix.
 */
function previousResult(io, root, flags, round) {
  const file = strFlag(flags, 'previous')
  if (!file) io.die(`settle: --previous needs the fixer result of round ${round - 1}`)
  if (round < 2) io.die(`--previous ${file}: round ${round} has no round before it, so there is no fixer result to read`)
  const result = readFixerResult(io, root, file)
  const named = /(?:^|[\\/])remediate-r(\d+)\.json$/.exec(file)
  const recorded = Number.isInteger(result.round) ? result.round : named ? Number(named[1]) : null
  if (recorded !== null && recorded !== round - 1) {
    io.die(`--previous ${file} is the fixer result of round ${recorded}, and round ${round} reads round ${round - 1}`)
  }
  return result.notFixed
}

/**
 * Move every blocker and warning out of the surviving list that the fixer cannot
 * act on, before the planner sees the rest: a finding whose file the test guard
 * protects (a person fixes it), and then, with the round before's fixer result,
 * a finding that fixer declined (its reason quoted). The protected deferral is
 * applied first, so a finding both protected and declined counts as protected.
 * Nothing is dropped: the finding stays in the record, `open` in the reply table.
 * Returns `{ kept, deferred: [{ id, file, reason, kind }] }`.
 */
function deferUnfixable(findings, protection, declined) {
  const reasons = new Map(declined.map(e => [e.id, e.reason]))
  const kept = []
  const deferred = []
  for (const f of findings) {
    if (f.severity !== 'blocker' && f.severity !== 'warning') {
      kept.push(f)
      continue
    }
    const file = typeof f.file === 'string' && f.file.trim() ? f.file : null
    if (file && protection.protects(file)) {
      deferred.push({
        id: findingId(f),
        file,
        kind: 'protected',
        reason: `protected test path ${file} — the test guard keeps the fixer out of it; a person fixes it`
      })
    } else if (reasons.has(findingId(f))) {
      deferred.push({ id: findingId(f), file, kind: 'declined', reason: `declined by the previous fixer: ${oneLine(reasons.get(findingId(f)))}` })
    } else {
      kept.push(f)
    }
  }
  return { kept, deferred }
}

/**
 * The `--review` record, refused when it names a commit other than `head`. A
 * record that names another commit raised its findings against code the fixer
 * will not be looking at; one that names none is read as it always was.
 */
function reviewAt(io, flags, head) {
  const record = loadReview(io, flags.review, '--review')
  if (head && typeof record.head === 'string' && record.head && record.head !== head) {
    io.die(`--review ${flags.review} describes another commit: it records ${record.head}, and the head is ${head}`)
  }
  return record
}

/**
 * The round `remediate-brief` would brief, and the ids it would list — the one
 * planning path `remediate-brief` and `fixer-result` share. Returns
 * `{ plan, findings, ids, deferred }`, or `{ stop }` / `{ refusal }` when the
 * round is not briefed. Refuses (exits) on an unreadable record or one for
 * another head. `protection` and `--previous` decide what is deferred first.
 */
function briefedRound(io, root, flags, round, head, protection) {
  const record = reviewAt(io, flags, head)

  const cap = LIMITS.remediationRounds
  const declined = flags.previous === undefined ? [] : previousResult(io, root, flags, round)
  const { kept, deferred } = deferUnfixable(survivingOf(record), protection, declined)
  if (deferred.length && !kept.some(f => f.severity === 'blocker' || f.severity === 'warning')) {
    const p = deferred.filter(d => d.kind === 'protected').length
    return {
      stop: `nothing fixable remains — ${p} finding(s) in protected test paths, ${deferred.length - p} declined by the round ${round - 1} fixer`
    }
  }
  const { plan, rebuilt, stop, refusal } = planRound(kept, round)
  if (stop) return { stop }
  if (refusal) return { refusal }

  const verdictNote = `round ${plan.round} is the verdict round (remediationRounds=${cap}); no fix round remains`
  if (plan.halt) {
    return { stop: `${plan.haltReason}: ${rebuilt ? `round ${round} follows a round that left no blocker standing, so ` : ''}${verdictNote}` }
  }
  const findings = [...plan.fix.byFile.flatMap(g => g.findings), ...plan.fix.unscoped]
  if (findings.length === 0) {
    const planned = plan.deferred.length ? ` (${plan.deferred.length} finding(s) deferred, not fixed in a round)` : ''
    return {
      stop: plan.isFinalRound
        ? `nothing to remediate: ${rebuilt ? `round ${round} follows a round that left no surviving blocker, so ` : ''}${verdictNote}${planned}`
        : `nothing to remediate: no surviving blocker or warning to fix in round ${round}${planned}`
    }
  }
  return { plan, findings, ids: findings.map(findingId), deferred }
}

function remediateBriefCommand(io, root, flags, json) {
  requireFlags(io, 'remediate-brief', flags, ['review', 'round', 'change', 'head'])
  const round = requireInt(io, 'remediate-brief', flags, 'round', 1)
  const head = strFlag(flags, 'head')
  const change = strFlag(flags, 'change')
  const protection = protectionFor(io, 'remediate-brief', root, flags)

  const briefed = briefedRound(io, root, flags, round, head, protection)
  if (briefed.stop) io.die(`${STOP_PREFIX}${briefed.stop}`)
  if (briefed.refusal) io.die(briefed.refusal)
  const { plan, ids, deferred } = briefed

  const resultPath = strFlag(flags, 'result') || `.claude/ship/settle/remediate-r${round}.json`
  const prNumber = strFlag(flags, 'pr') || null
  const out = flags.out === undefined ? null : strFlag(flags, 'out')
  if (out === '') io.die(`settle remediate-brief: --out needs a file\nusage: ${USAGE_LINES['remediate-brief']}`)
  const facts = protectionFacts(protection)
  const briefing = assembleSettleRemediatePrompt({ change, round, plan, head, prNumber, protection: facts, resultPath, deferred })
  const answer = {
    change,
    round,
    head,
    pr: prNumber,
    resultPath,
    findings: ids,
    deferred: deferred.map(({ id, reason }) => ({ id, reason })),
    reReviewDimensions: plan.reReviewDimensions,
    protection: facts,
    briefing
  }
  // The record `fixer-result --brief` reads: the ids this round briefed, as
  // decided here, so the check after the fixer never works the deferrals out
  // again from a profile or a previous result the fixer could have changed.
  // Written before anything is printed, so a write that fails prints nothing.
  if (out) {
    try {
      const at = resolve(root, out)
      mkdirSync(dirname(at), { recursive: true })
      writeFileSync(at, JSON.stringify(answer, null, 2) + '\n')
    } catch (err) {
      io.die(`settle remediate-brief: --out ${out} could not be written: ${(err && err.message) || String(err)}`)
    }
  }
  io.emit(json, answer, briefing + '\n')
}

// --- fixer-result -------------------------------------------------------------

const oneLine = text => String(text).replace(/\s*[\r\n]+\s*/g, ' ').trim()

/**
 * A fixer's result file, read and shape-checked: present, parseable, an object
 * with `ok: true`, `fixed` an array of id strings and `notFixed` an array of
 * `{ id, reason }`. Returns `{ round?, fixed, notFixed }`; every refusal exits 1
 * naming the file. Whether the ids partition a briefed round is the caller's.
 */
function readFixerResult(io, root, file, round) {
  const at = resolve(root, file)
  if (!existsSync(at)) {
    io.die(
      round === undefined
        ? `fixer result ${file} is missing`
        : `fixer result ${file} is missing: the fixer wrote no result for round ${round}`
    )
  }
  let result
  try {
    result = JSON.parse(readFileSync(at, 'utf8'))
  } catch (err) {
    io.die(`fixer result ${file} could not be parsed: ${(err && err.message) || String(err)}`)
  }
  if (!isObject(result)) io.die(`fixer result ${file} is not a JSON object`)
  if (result.ok !== true) {
    io.die(`fixer result ${file} reports ok: ${JSON.stringify(result.ok)} — the round was not carried out`)
  }
  const { fixed, notFixed } = result
  if (!Array.isArray(fixed) || !fixed.every(id => typeof id === 'string')) {
    io.die(`fixer result ${file}: "fixed" must be an array of finding id strings`)
  }
  if (!Array.isArray(notFixed)) io.die(`fixer result ${file}: "notFixed" must be an array of { id, reason }`)
  notFixed.forEach((e, i) => {
    if (!isObject(e) || typeof e.id !== 'string' || typeof e.reason !== 'string' || !e.reason.trim()) {
      io.die(`fixer result ${file}: notFixed[${i}] must be { id, reason } with a string id and a non-empty reason`)
    }
  })
  return { round: result.round, fixed, notFixed }
}

/**
 * The ids a round briefed, read from the record `remediate-brief --out` wrote:
 * refused when it is missing, does not parse, is for another round or another
 * head, lists no id, or lists an id the `--review` record does not hold (a
 * briefing built from another review). Nothing is re-planned and nothing is
 * deferred again: the briefing already decided both.
 */
function readBrief(io, root, flags, round, head) {
  const file = strFlag(flags, 'brief')
  if (!file) io.die(`settle fixer-result: --brief needs a file\nusage: ${USAGE_LINES['fixer-result']}`)
  if (flags.profile !== undefined || flags.previous !== undefined) {
    io.die(
      `settle fixer-result: --brief already carries the deferrals its briefing applied; --profile and --previous work them out again, so pass --brief alone\nusage: ${USAGE_LINES['fixer-result']}`
    )
  }
  const record = reviewAt(io, flags, head)
  const at = resolve(root, file)
  if (!existsSync(at)) io.die(`--brief ${file} is missing: no briefing record was kept for round ${round} (remediate-brief --out writes it)`)
  let brief
  try {
    brief = JSON.parse(readFileSync(at, 'utf8'))
  } catch (err) {
    io.die(`--brief ${file} could not be parsed: ${(err && err.message) || String(err)}`)
  }
  if (!isObject(brief)) io.die(`--brief ${file} is not a JSON object`)
  if (brief.round !== round) {
    io.die(`--brief ${file} is the briefing of round ${JSON.stringify(brief.round)}, and the result is checked for round ${round}`)
  }
  const bound = head || (typeof record.head === 'string' && record.head) || ''
  if (bound && brief.head !== bound) {
    io.die(`--brief ${file} briefed another commit: it records ${JSON.stringify(brief.head)}, and the head is ${bound}`)
  }
  const ids = brief.findings
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every(id => typeof id === 'string' && id.trim())) {
    io.die(`--brief ${file}: "findings" must be a non-empty array of the finding ids round ${round} briefed`)
  }
  const held = new Set(survivingOf(record).map(findingId))
  const foreign = ids.filter(id => !held.has(id))
  if (foreign.length) {
    io.die(
      `--brief ${file} lists ${foreign.join(', ')}, which --review ${flags.review} does not hold as surviving: the briefing was built from another review`
    )
  }
  return [...new Set(ids)]
}

function fixerResultCommand(io, root, flags, json) {
  requireFlags(io, 'fixer-result', flags, ['result', 'review', 'round'])
  const round = requireInt(io, 'fixer-result', flags, 'round', 1)
  const head = strFlag(flags, 'head')
  const file = strFlag(flags, 'result')

  // With --brief, the ids the briefing recorded. Without it, the round is
  // planned again with the same deferrals, from the --profile and --previous
  // given here: they must be the ones the briefing line carried, and a profile
  // read after the fixer ran can differ from the one the briefing read.
  let ids
  if (flags.brief !== undefined) {
    ids = readBrief(io, root, flags, round, head)
  } else {
    const protection = protectionFor(io, 'fixer-result', root, flags)
    const briefed = briefedRound(io, root, flags, round, head, protection)
    if (!briefed.ids) io.die(`round ${round} was not briefed: ${briefed.stop || briefed.refusal}`)
    ids = briefed.ids
  }

  const { fixed, notFixed } = readFixerResult(io, root, file, round)

  const seen = new Map()
  for (const [list, entries] of [['fixed', fixed], ['notFixed', notFixed.map(e => e.id)]]) {
    for (const id of entries) {
      const prior = seen.get(id)
      if (prior === list) io.die(`fixer result ${file}: ${id} is listed twice in ${list}`)
      if (prior) io.die(`fixer result ${file}: ${id} is listed in both fixed and notFixed`)
      seen.set(id, list)
    }
  }
  const briefedSet = new Set(ids)
  const stray = [...seen.keys()].filter(id => !briefedSet.has(id))
  if (stray.length) io.die(`fixer result ${file}: ${stray.join(', ')} ${stray.length === 1 ? 'was' : 'were'} not briefed in round ${round}`)
  const missing = ids.filter(id => !seen.has(id))
  if (missing.length) io.die(`fixer result ${file}: briefed ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} in neither fixed nor notFixed`)

  const notFixedOut = notFixed.map(e => ({ id: e.id, reason: e.reason }))
  io.emit(
    json,
    { round, fixed, notFixed: notFixedOut, briefed: ids },
    `round ${round}: ${fixed.length} fixed, ${notFixed.length} not fixed\n` +
      notFixedOut.map(e => `  ${e.id}: ${oneLine(e.reason)}\n`).join('')
  )
}

// --- test-paths ---------------------------------------------------------------

/**
 * The paths `--changed` names: a variadic flag, comma lists, or `-` for standard
 * input — split on NUL when it holds one (`git diff -z`, paths taken exactly),
 * else one per line. Null when the flag is absent; a bare `--changed` refuses.
 */
function changedPaths(io, sub, flags) {
  if (flags.changed === undefined || flags.changed === true) return null
  const given = [].concat(flags.changed).filter(v => typeof v === 'string')
  if (given.length === 0) io.die(`settle ${sub}: --changed needs paths, or - for standard input\nusage: ${USAGE_LINES[sub]}`)
  if (given.length === 1 && given[0] === '-') {
    const text = io.readStdin()
    if (text.includes('\0')) return text.split('\0').filter(Boolean)
    return text.split('\n').map(p => p.trim().replace(/^\.\//, '')).filter(Boolean)
  }
  return given.flatMap(v => v.split(',')).map(p => p.trim().replace(/^\.\//, '')).filter(Boolean)
}

function testPathsCommand(io, root, flags, json) {
  const protectedOnly = boolFlag(io, 'test-paths', flags, 'protected-only')
  const nul = boolFlag(io, 'test-paths', flags, 'nul')
  if (nul && !protectedOnly) io.die(`settle test-paths: --nul is only read with --protected-only\nusage: ${USAGE_LINES['test-paths']}`)
  const changed = changedPaths(io, 'test-paths', flags)
  if (changed === null) io.die(`settle test-paths requires --changed\nusage: ${USAGE_LINES['test-paths']}`)

  const protection = protectionFor(io, 'test-paths', root, flags)
  const protectedPaths = changed.filter(p => protection.protects(p))
  const unprotected = changed.filter(p => !protection.protects(p))
  const usable = protection.state === 'ok'
  const obj = { protected: protectedPaths, unprotected, profile: usable ? protection.profile : null, reason: protection.reason }

  if (protectedOnly && !json) {
    if (!usable) process.stderr.write(`interlock: warning: ${protection.reason}\n`)
    process.stdout.write(protectedPaths.map(p => p + (nul ? '\0' : '\n')).join(''))
    return
  }
  const list = (title, paths) => `${title} (${paths.length}):\n${paths.map(p => `  ${p}`).join('\n')}${paths.length ? '\n' : ''}`
  io.emit(
    json,
    obj,
    `${list('protected', protectedPaths)}${list('unprotected', unprotected)}` +
      (usable ? `profile: ${protection.profile}\n` : '') +
      (protection.reason ? `reason: ${protection.reason}\n` : '')
  )
}

// --- tree-check ---------------------------------------------------------------

const STATUS_CMD = 'git status --porcelain=v1 -z --untracked-files=all'
const STATUS_ENTRY = /^([ MTADRCU?!])([ MTADRCU?!]) (.+)$/s
const shownPath = p => (/[\u0000-\u001f\u007f]/.test(p) ? JSON.stringify(p) : p)

/**
 * Every path a `git status --porcelain=v1 -z` listing names, in order: one per
 * entry, and for a rename or copy the original path that follows it too. `!!`
 * (ignored) entries are skipped. Throws a reason on input it cannot read.
 */
export function statusPaths(raw) {
  if (raw === '') return []
  if (!raw.endsWith('\0')) throw new Error(`not NUL-terminated: pass ${STATUS_CMD}`)
  const tokens = raw.slice(0, -1).split('\0')
  const out = []
  for (let i = 0; i < tokens.length; i++) {
    const m = STATUS_ENTRY.exec(tokens[i])
    if (!m) throw new Error(`malformed entry ${JSON.stringify(tokens[i])}: expected "XY <path>" as ${STATUS_CMD} prints it`)
    const [, x, y, path] = m
    const moved = x === 'R' || x === 'C' || y === 'R' || y === 'C'
    let from = null
    if (moved) {
      i += 1
      if (i >= tokens.length || tokens[i] === '') {
        throw new Error(`malformed entry ${JSON.stringify(tokens[i - 1])}: a rename or copy with no original path after it`)
      }
      from = tokens[i]
    }
    if (x === '!' && y === '!') continue
    out.push(path)
    if (from !== null) out.push(from)
  }
  return out
}

function treeCheckCommand(io, flags, json) {
  requireFlags(io, 'tree-check', flags, ['change', 'status'])
  const change = strFlag(flags, 'change')
  const source = strFlag(flags, 'status')
  let raw
  if (source === '-') raw = io.readStdin()
  else {
    try {
      raw = readFileSync(source, 'utf8')
    } catch (err) {
      io.die(`--status ${source} could not be read: ${(err && err.message) || String(err)}`)
    }
  }
  let paths
  try {
    paths = statusPaths(raw)
  } catch (err) {
    io.die(`--status ${source === '-' ? '(stdin)' : source}: ${err.message}`)
  }

  const allowed = new Set(toleratedPaths(change))
  const dirty = []
  const tolerated = []
  for (const p of paths) {
    const into = allowed.has(p) ? tolerated : dirty
    if (!into.includes(p)) into.push(p)
  }
  const clean = dirty.length === 0
  io.emit(
    json,
    { clean, dirty, tolerated },
    clean
      ? `clean${tolerated.length ? ` (tolerated: ${tolerated.join(', ')})` : ''}\n`
      : `dirty (${dirty.length}):\n${dirty.map(p => `  ${shownPath(p)}\n`).join('')}`
  )
  if (!clean) {
    process.stderr.write(`interlock: working tree not clean: ${dirty.length} path(s) differ from HEAD or are untracked\n`)
    process.exitCode = 1
  }
}

// --- conformance-brief --------------------------------------------------------

const place = e => `${e.artifact}:${e.line}`
const entryLines = e => [`  ${e.id}  ${e.title}`, `      ${place(e)}`]

function conformanceBriefCommand(io, root, positional, flags, json) {
  const name = strFlag(flags, 'change') || positional[2] || ''
  if (!name) io.die(`settle conformance-brief requires a change\nusage: ${USAGE_LINES['conformance-brief']}`)
  requireFlags(io, 'conformance-brief', flags, ['base', 'head'])
  const changed = changedPaths(io, 'conformance-brief', flags)
  if (changed === null) io.die(`settle conformance-brief requires --changed\nusage: ${USAGE_LINES['conformance-brief']}`)
  const head = strFlag(flags, 'head')
  const resultPath = strFlag(flags, 'result') || DEFAULT_HANDOFF_PATH
  const checklist = buildChecklist(root, name, { changed })
  if (checklist.skipped) io.die(`change "${name}" could not be resolved: ${checklist.reason}`)

  // The same gather `interlock conformance --living` runs. It never ends the
  // command: a base nobody can read is the reason the list was not built.
  const living =
    typeof io.livingListFor === 'function'
      ? io.livingListFor(root, flags, { change: checklist.change, changed })
      : {
          skipped: 'the living-requirements gather is not available to this caller',
          partial: null,
          requirements: [],
          requirementsRequired: 0,
          omitted: [],
          source: 'none'
        }
  const requirements = Array.isArray(living.requirements) ? living.requirements : []

  if (checklist.scenarios.length === 0 && requirements.length === 0) {
    process.stderr.write(
      `interlock: nothing to confirm for "${checklist.change}": no scenario in its delta specs and no living requirement` +
        `${living.skipped ? ` (the living list was not built: ${living.skipped})` : ''}\n`
    )
    return
  }

  const parts = [`Confirm change "${checklist.change}" against its diff at head ${head}.\n`]
  parts.push(
    checklist.scenarios.length
      ? `Scenarios — for each one below, read the implementation and answer whether the described behaviour was ` +
          `actually built, citing file:line. A scenario you cannot confirm is recorded as unconfirmed with what you ` +
          `looked at — never as satisfied, and never omitted.\n\n${checklist.scenarios.flatMap(entryLines).join('\n')}\n`
      : `Scenarios — the change's delta specs carry none. Report scenariosChecked and scenariosUnconfirmed as 0.\n`
  )
  if (living.skipped) {
    parts.push(
      `Living requirements — not built: ${living.skipped}. There is no list to confirm: report requirementsChecked ` +
        `and requirementsUnconfirmed as zero.\n`
    )
  } else {
    parts.push(
      `Living requirements — the requirements below were already in force before this change, for the capabilities ` +
        `it touches (read from ${living.source}). For each one, read the spec at the cited file:line and the ` +
        `implementation, and answer whether the change still honours it, citing file:line. One you cannot confirm is ` +
        `unconfirmed with what you looked at — never satisfied, never omitted.\n` +
        `${living.partial ? `Partial: ${living.partial}\n` : ''}\n${requirements.flatMap(entryLines).join('\n')}\n` +
        `${living.omitted && living.omitted.length ? `\n${living.omitted.length} requirement(s) were left out to fit the size bound; they are not yours to answer.\n` : ''}`
    )
  }
  if (checklist.changedFiles.length) {
    parts.push(`Changed source files to check against (${checklist.changedFiles.length}):\n${checklist.changedFiles.map(f => `  ${f}`).join('\n')}\n`)
  }
  parts.push(
    `This never halts anything: a prose scenario matched to code is a judgement, and the verdict reads your counts ` +
      `beside its own denominators. Do not paste your reasoning into the result.\n\n` +
      `When you are done, write JSON to ${resultPath} in exactly this shape and then stop:\n` +
      `{ "ok": true, "scenariosChecked": <n>, "scenariosUnconfirmed": <n>, "requirementsChecked": <n>, ` +
      `"requirementsUnconfirmed": <n>, "detail": "<one short paragraph>", "head": "${head}" }\n` +
      `head is the commit named above, copied exactly: a result that names another commit is not read.`
  )
  const briefing = parts.join('\n')
  io.emit(
    json,
    {
      change: checklist.change,
      head,
      resultPath,
      scenarios: checklist.scenarios,
      living: { skipped: living.skipped ?? null, requirements },
      briefing
    },
    briefing + '\n'
  )
}

// --- dispatch -----------------------------------------------------------------

/**
 * `interlock settle <subcommand>`. `positional[0]` is `settle`; `positional[1]` the
 * subcommand. `interlock settle --help` never reaches here: the entry file answers
 * `--help` for every command, with `SETTLE_HELP` for this one.
 */
export function settleCommand(io, root, positional, flags, json) {
  const sub = positional[1]
  switch (sub) {
    case 'help':
      process.stdout.write(SETTLE_HELP)
      return
    case 'comment':
      return commentCommand(io, flags, json)
    case 'replies':
      return repliesCommand(io, flags, json)
    case 'remediate-brief':
      return remediateBriefCommand(io, root, flags, json)
    case 'fixer-result':
      return fixerResultCommand(io, root, flags, json)
    case 'conformance-brief':
      return conformanceBriefCommand(io, root, positional, flags, json)
    case 'test-paths':
      return testPathsCommand(io, root, flags, json)
    case 'tree-check':
      return treeCheckCommand(io, flags, json)
    default:
      return io.die(
        sub === undefined
          ? `settle needs a subcommand: ${SETTLE_SUBCOMMANDS.join(', ')} (see interlock settle --help)`
          : `unknown settle subcommand ${JSON.stringify(sub)}: expected ${SETTLE_SUBCOMMANDS.join(', ')} (see interlock settle --help)`
      )
  }
}
