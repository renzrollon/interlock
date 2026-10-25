// The `interlock mr` subcommand family: everything the `mr` skill's review loop
// reads off the CLI instead of typing itself (design D13 of
// close-the-merge-request-loop). `comment` and `replies` render the two things
// a reader sees on the merge request; `remediate-brief` and `conformance-brief`
// print the briefings the loop hands its workers; `fixer-result` checks what a
// fixer wrote back against the ids it was briefed; `test-paths` names the files
// a fixer touched that the test guard would have refused; `tree-check` says
// whether the working tree is clean before the loop stages anything.
//
// Every refusal is exit 1, the reason on standard error and nothing on standard
// output: the skill branches on the exit status. `remediate-brief` exiting 1
// with a reason that starts `STOP: ` is the loop's stop signal; any other exit 1
// is an input the loop must not act on. `tree-check` on a dirty tree is the one
// exit 1 that prints: the dirty list on stdout, the verdict on stderr.
//
// Reviewer-written text is untrusted: it is posted on the merge request under
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

import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildChecklist } from './conformance.mjs'
import { SEVERITIES, TOLERANCE_BAND, findingId, findingKey, normalizeSeverity } from './findings.mjs'
import { LIMITS } from './limits.mjs'
import { inertSpan } from './merge-confidence.mjs'
import { NOTES_PATH } from './notes.mjs'
import { assembleMrRemediatePrompt } from './prompts/mr-remediate.mjs'
import { planRemediation } from './remediate.mjs'
import { isTestPath, loadTestProfile, testRootsFromProfile } from './test-paths.mjs'

export const MR_SUBCOMMANDS = Object.freeze([
  'comment',
  'replies',
  'remediate-brief',
  'fixer-result',
  'conformance-brief',
  'test-paths',
  'tree-check'
])

const USAGE_LINES = Object.freeze({
  comment: 'interlock mr comment --review <file> --head <sha> --round <n> [--json]',
  replies: 'interlock mr replies --before <file> --after <file> --head <sha> [--json]',
  'remediate-brief':
    'interlock mr remediate-brief --review <file> --round <n> --change <name> --head <sha> [--pr <n>] [--profile <file>] [--result <file>] [--json]',
  'fixer-result': 'interlock mr fixer-result --result <file> --review <file> --round <n> [--head <sha>] [--json]',
  'conformance-brief':
    'interlock mr conformance-brief <change> --changed <files|-> --base <ref> --head <sha> [--result <file>] [--json]',
  'test-paths': 'interlock mr test-paths --changed <files|-> [--profile <file>] [--protected-only [--nul]] [--json]',
  'tree-check': 'interlock mr tree-check --change <name> --status <file|-> [--json]'
})

export const MR_HELP =
  `Usage:\n${MR_SUBCOMMANDS.map(s => `  ${USAGE_LINES[s]}`).join('\n')}\n\n` +
  `The merge-request review loop's renderers and checks. Each refusal exits 1 with the reason on standard\n` +
  `error and nothing on standard output.\n` +
  `  comment            the surviving findings of a head-bound review, each with a stable id\n` +
  `  replies            what each finding of the previous round became: fixed, open or new\n` +
  `  remediate-brief    the fixer's briefing for one round; exits 1 with "STOP: " when no round should be briefed\n` +
  `  fixer-result       checks a fixer's result against the ids its round was briefed\n` +
  `  conformance-brief  the scenario and living-requirement checklist, as a briefing for one worker\n` +
  `  test-paths         which changed paths the test guard protects (--protected-only --nul feeds git restore)\n` +
  `  tree-check         whether git status -z --untracked-files=all is clean; exits 1 listing what is not\n`

export const DEFAULT_HANDOFF_PATH = '.claude/ship/mr/handoff.json'
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
  return [`openspec/changes/${change}/mr-summary.md`, NOTES_PATH]
}

/** A flag's string value, or '' when it is absent or was given without one. */
const strFlag = (flags, key) => (typeof flags[key] === 'string' ? flags[key].trim() : '')

/** Refuse a missing required flag with the subcommand's usage line. */
function requireFlags(io, sub, flags, names) {
  const missing = names.filter(n => !strFlag(flags, n))
  if (missing.length) io.die(`mr ${sub} requires ${missing.map(n => `--${n}`).join(', ')}\nusage: ${USAGE_LINES[sub]}`)
}

function requireInt(io, sub, flags, key, min) {
  const raw = strFlag(flags, key)
  if (!/^\d+$/.test(raw) || Number(raw) < min) {
    io.die(`mr ${sub}: --${key} must be an integer of at least ${min} (got ${JSON.stringify(flags[key])})\nusage: ${USAGE_LINES[sub]}`)
  }
  return Number(raw)
}

/** A boolean flag. The parser hands a following non-flag token over as its value; that is refused, not read as true. */
function boolFlag(io, sub, flags, key) {
  const v = flags[key]
  if (v === undefined) return false
  if (v === true) return true
  io.die(`mr ${sub}: --${key} takes no value (got ${JSON.stringify(v)})\nusage: ${USAGE_LINES[sub]}`)
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
    ...open.map(f => ['open', f]),
    ...added.map(f => ['new', f])
  ]
  io.emit(
    json,
    { head, fixed: fixed.map(summaryOf), open: open.map(summaryOf), new: added.map(summaryOf), counts },
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
    if (!path) io.die(`mr ${sub}: --profile needs a file\nusage: ${USAGE_LINES[sub]}`)
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
 * The round `remediate-brief` would brief, and the ids it would list — the one
 * planning path `remediate-brief` and `fixer-result` share. Returns
 * `{ plan, findings, ids }`, or `{ stop }` / `{ refusal }` when the round is not
 * briefed. Refuses (exits) on an unreadable record or one for another head.
 */
function briefedRound(io, flags, round, head) {
  const record = loadReview(io, flags.review, '--review')
  // A record that names another commit raised its findings against code the
  // fixer will not be looking at; one that names none is read as it always was.
  if (head && typeof record.head === 'string' && record.head && record.head !== head) {
    io.die(`--review ${flags.review} describes another commit: it records ${record.head}, and the head is ${head}`)
  }

  const cap = LIMITS.remediationRounds
  const { plan, rebuilt, stop, refusal } = planRound(survivingOf(record), round)
  if (stop) return { stop }
  if (refusal) return { refusal }

  const verdictNote = `round ${plan.round} is the verdict round (remediationRounds=${cap}); no fix round remains`
  if (plan.halt) {
    return { stop: `${plan.haltReason}: ${rebuilt ? `round ${round} follows a round that left no blocker standing, so ` : ''}${verdictNote}` }
  }
  const findings = [...plan.fix.byFile.flatMap(g => g.findings), ...plan.fix.unscoped]
  if (findings.length === 0) {
    const deferred = plan.deferred.length ? ` (${plan.deferred.length} finding(s) deferred, not fixed in a round)` : ''
    return {
      stop: plan.isFinalRound
        ? `nothing to remediate: ${rebuilt ? `round ${round} follows a round that left no surviving blocker, so ` : ''}${verdictNote}${deferred}`
        : `nothing to remediate: no surviving blocker or warning to fix in round ${round}${deferred}`
    }
  }
  return { plan, findings, ids: findings.map(findingId) }
}

function remediateBriefCommand(io, root, flags, json) {
  requireFlags(io, 'remediate-brief', flags, ['review', 'round', 'change', 'head'])
  const round = requireInt(io, 'remediate-brief', flags, 'round', 1)
  const head = strFlag(flags, 'head')
  const change = strFlag(flags, 'change')
  const protection = protectionFor(io, 'remediate-brief', root, flags)

  const briefed = briefedRound(io, flags, round, head)
  if (briefed.stop) io.die(`${STOP_PREFIX}${briefed.stop}`)
  if (briefed.refusal) io.die(briefed.refusal)
  const { plan, ids } = briefed

  const resultPath = strFlag(flags, 'result') || `.claude/ship/mr/remediate-r${round}.json`
  const prNumber = strFlag(flags, 'pr') || null
  const facts = protectionFacts(protection)
  const briefing = assembleMrRemediatePrompt({ change, round, plan, head, prNumber, protection: facts, resultPath })
  io.emit(json, { change, round, head, pr: prNumber, resultPath, findings: ids, protection: facts, briefing }, briefing + '\n')
}

// --- fixer-result -------------------------------------------------------------

const oneLine = text => String(text).replace(/\s*[\r\n]+\s*/g, ' ').trim()

function fixerResultCommand(io, root, flags, json) {
  requireFlags(io, 'fixer-result', flags, ['result', 'review', 'round'])
  const round = requireInt(io, 'fixer-result', flags, 'round', 1)
  const head = strFlag(flags, 'head')
  const file = strFlag(flags, 'result')

  const briefed = briefedRound(io, flags, round, head)
  if (!briefed.ids) io.die(`round ${round} was not briefed: ${briefed.stop || briefed.refusal}`)
  const ids = briefed.ids

  const at = resolve(root, file)
  if (!existsSync(at)) io.die(`fixer result ${file} is missing: the fixer wrote no result for round ${round}`)
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
  if (given.length === 0) io.die(`mr ${sub}: --changed needs paths, or - for standard input\nusage: ${USAGE_LINES[sub]}`)
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
  if (nul && !protectedOnly) io.die(`mr test-paths: --nul is only read with --protected-only\nusage: ${USAGE_LINES['test-paths']}`)
  const changed = changedPaths(io, 'test-paths', flags)
  if (changed === null) io.die(`mr test-paths requires --changed\nusage: ${USAGE_LINES['test-paths']}`)

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
  if (!name) io.die(`mr conformance-brief requires a change\nusage: ${USAGE_LINES['conformance-brief']}`)
  requireFlags(io, 'conformance-brief', flags, ['base', 'head'])
  const changed = changedPaths(io, 'conformance-brief', flags)
  if (changed === null) io.die(`mr conformance-brief requires --changed\nusage: ${USAGE_LINES['conformance-brief']}`)
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
 * `interlock mr <subcommand>`. `positional[0]` is `mr`; `positional[1]` the
 * subcommand. `interlock mr --help` never reaches here: the entry file answers
 * `--help` for every command, with `MR_HELP` for this one.
 */
export function mrCommand(io, root, positional, flags, json) {
  const sub = positional[1]
  switch (sub) {
    case 'help':
      process.stdout.write(MR_HELP)
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
          ? `mr needs a subcommand: ${MR_SUBCOMMANDS.join(', ')} (see interlock mr --help)`
          : `unknown mr subcommand ${JSON.stringify(sub)}: expected ${MR_SUBCOMMANDS.join(', ')} (see interlock mr --help)`
      )
  }
}
