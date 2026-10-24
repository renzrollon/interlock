// The `interlock mr` subcommand family: everything the `mr` skill's review loop
// reads off the CLI instead of typing itself (design D13 of
// close-the-merge-request-loop). `comment` and `replies` render the two things
// a reader sees on the merge request; `remediate-brief` and `conformance-brief`
// print the briefings the loop hands its workers; `test-paths` names the files
// a fixer touched that the test guard would have refused.
//
// Every refusal is exit 1, the reason on standard error and nothing on standard
// output: the skill branches on the exit status, and `remediate-brief` exiting
// non-zero is the loop's stop signal.
//
// The entry file's own helpers come in as `io` — `emit`, `die`, `readStdin`,
// `readFindingsInput`, and `livingListFor` for the conformance gather, which
// needs the entry file's git readers — so stdout and exit codes stay exactly the
// CLI's. Without `io.livingListFor` the living list is reported as not built,
// with that reason, never dropped quietly.

import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildChecklist } from './conformance.mjs'
import { TOLERANCE_BAND, findingId, findingKey } from './findings.mjs'
import { LIMITS } from './limits.mjs'
import { assembleMrRemediatePrompt } from './prompts/mr-remediate.mjs'
import { planRemediation } from './remediate.mjs'
import { isTestPath, loadTestProfile, testRootsFromProfile } from './test-paths.mjs'

export const MR_SUBCOMMANDS = Object.freeze(['comment', 'replies', 'remediate-brief', 'conformance-brief', 'test-paths'])

const USAGE_LINES = Object.freeze({
  comment: 'interlock mr comment --review <file> --head <sha> --round <n> [--json]',
  replies: 'interlock mr replies --before <file> --after <file> --head <sha> [--json]',
  'remediate-brief':
    'interlock mr remediate-brief --review <file> --round <n> --change <name> --head <sha> [--pr <n>] [--protected <paths>] [--result <file>] [--json]',
  'conformance-brief':
    'interlock mr conformance-brief <change> --changed <files|-> --base <ref> --head <sha> [--result <file>] [--json]',
  'test-paths': 'interlock mr test-paths --changed <files|-> [--json]'
})

export const MR_HELP =
  `Usage:\n${MR_SUBCOMMANDS.map(s => `  ${USAGE_LINES[s]}`).join('\n')}\n\n` +
  `The merge-request review loop's renderers. Each refusal exits 1 with the reason on standard error and\n` +
  `nothing on standard output.\n` +
  `  comment            the surviving findings of a head-bound review, each with a stable id\n` +
  `  replies            what each finding of the previous round became: fixed, open or new\n` +
  `  remediate-brief    the fixer's briefing for one round; exits 1 when no round should be briefed\n` +
  `  conformance-brief  the scenario and living-requirement checklist, as a briefing for one worker\n` +
  `  test-paths         which changed paths the test guard protects\n`

export const DEFAULT_HANDOFF_PATH = '.claude/ship/mr/handoff.json'
const PROFILE_REL = '.claude/testing/profile.json'

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

/** The record's surviving findings, one per identity (two with one key are one finding). */
function survivingOf(record) {
  const seen = new Set()
  const out = []
  for (const f of record.surviving) {
    if (!isObject(f)) continue
    const key = findingKey(f)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
  }
  return out
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

const cell = text => String(text ?? '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|')
const placeOf = f => {
  const file = typeof f.file === 'string' && f.file.trim() ? f.file : '(unscoped)'
  return Number.isFinite(f.line) ? `${file}:${f.line}` : file
}
const titleOf = f => (typeof f.title === 'string' && f.title.trim() ? f.title : '(untitled)')

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
          ...findings.map(f => `| ${findingId(f)} | ${cell(f.severity)} | ${cell(placeOf(f))} | ${cell(titleOf(f))} |`),
          '',
          ...findings.flatMap(f => [
            `**${findingId(f)}** (${cell(f.severity)}) ${placeOf(f)} — ${titleOf(f)}`,
            ...(typeof f.description === 'string' && f.description.trim() ? ['', f.description.trim()] : []),
            ...(typeof f.suggestion === 'string' && f.suggestion.trim() ? ['', `Suggestion: ${f.suggestion.trim()}`] : []),
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
            '| Id | Status | File | Finding |',
            '| --- | --- | --- | --- |',
            ...rows.map(([status, f]) => `| ${findingId(f)} | ${status} | ${cell(f.file ?? '(unscoped)')} | ${cell(titleOf(f))} |`)
          ]
        : ['No finding was raised before this round or after it.'])
    ].join('\n') + '\n'
  )
}

// --- remediate-brief ----------------------------------------------------------

/**
 * One round's plan under the ship loop's own stop rule (`run remediated`): the
 * round as asked, and when a later round has no surviving blocker, the verdict
 * round instead, which plans no fix. Returns the plan or `{ refusal }`.
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
    return {
      refusal:
        round > verdict
          ? `round ${round} is past the verdict round (round ${verdict}; remediationRounds=${cap}): ${why}`
          : why
    }
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

function remediateBriefCommand(io, flags, json) {
  requireFlags(io, 'remediate-brief', flags, ['review', 'round', 'change', 'head'])
  const round = requireInt(io, 'remediate-brief', flags, 'round', 1)
  const head = strFlag(flags, 'head')
  const change = strFlag(flags, 'change')
  const record = loadReview(io, flags.review, '--review')
  // A record that names another commit raised its findings against code the
  // fixer will not be looking at; one that names none is read as it always was.
  if (typeof record.head === 'string' && record.head && record.head !== head) {
    io.die(`--review ${flags.review} describes another commit: it records ${record.head}, and the head is ${head}`)
  }

  const cap = LIMITS.remediationRounds
  const { plan, rebuilt, refusal } = planRound(record.surviving, round)
  if (refusal) io.die(refusal)

  const verdictNote = `round ${plan.round} is the verdict round (remediationRounds=${cap}); no fix round remains`
  if (plan.halt) {
    io.die(`${plan.haltReason}: ${rebuilt ? `round ${round} follows a round that left no blocker standing, so ` : ''}${verdictNote}`)
  }
  const hasFix = plan.fix.byFile.length > 0 || plan.fix.unscoped.length > 0
  if (!hasFix) {
    const deferred = plan.deferred.length ? ` (${plan.deferred.length} finding(s) deferred, not fixed in a round)` : ''
    io.die(
      plan.isFinalRound
        ? `nothing to remediate: ${rebuilt ? `round ${round} follows a round that left no surviving blocker, so ` : ''}${verdictNote}${deferred}`
        : `nothing to remediate: no surviving blocker or warning to fix in round ${round}${deferred}`
    )
  }

  const protectedPaths = strFlag(flags, 'protected')
    .split(/[,\s]+/)
    .filter(Boolean)
  const resultPath = strFlag(flags, 'result') || `.claude/ship/mr/remediate-r${round}.json`
  const prNumber = strFlag(flags, 'pr') || null
  const briefing = assembleMrRemediatePrompt({ change, round, plan, head, prNumber, protectedPaths, resultPath })
  const ids = [...plan.fix.byFile.flatMap(g => g.findings), ...plan.fix.unscoped].map(findingId)
  io.emit(json, { change, round, head, pr: prNumber, resultPath, findings: ids, briefing }, briefing + '\n')
}

// --- test-paths ---------------------------------------------------------------

/** The paths `--changed` names: a variadic flag, comma lists, or `-` for standard input one per line. */
function changedPaths(io, flags) {
  if (flags.changed === undefined || flags.changed === true) return null
  const given = [].concat(flags.changed).filter(v => typeof v === 'string')
  const raw = given.length === 1 && given[0] === '-' ? io.readStdin().split('\n') : given.flatMap(v => v.split(','))
  return raw.map(p => p.trim().replace(/^\.\//, '')).filter(Boolean)
}

function testPathsCommand(io, root, flags, json) {
  const changed = changedPaths(io, flags)
  if (changed === null) io.die(`mr test-paths requires --changed\nusage: ${USAGE_LINES['test-paths']}`)

  const profile = loadTestProfile(root)
  if (!profile) {
    const onDisk = existsSync(resolve(root, PROFILE_REL))
    const reason = onDisk
      ? `test profile at ${PROFILE_REL} could not be read — nothing is protected`
      : `no test profile at ${PROFILE_REL} — nothing is protected`
    io.emit(
      json,
      { protected: [], unprotected: changed, profile: null, reason },
      `protected (0):\nunprotected (${changed.length}):\n${changed.map(p => `  ${p}`).join('\n')}${changed.length ? '\n' : ''}reason: ${reason}\n`
    )
    return
  }
  const { roots } = testRootsFromProfile(profile)
  const isProtected = p => isTestPath(resolve(root, p), roots, root)
  const protectedPaths = changed.filter(isProtected)
  const unprotected = changed.filter(p => !isProtected(p))
  const list = (title, paths) => `${title} (${paths.length}):\n${paths.map(p => `  ${p}`).join('\n')}${paths.length ? '\n' : ''}`
  io.emit(
    json,
    { protected: protectedPaths, unprotected, profile: PROFILE_REL, reason: null },
    `${list('protected', protectedPaths)}${list('unprotected', unprotected)}profile: ${PROFILE_REL}\n`
  )
}

// --- conformance-brief --------------------------------------------------------

const place = e => `${e.artifact}:${e.line}`
const entryLines = e => [`  ${e.id}  ${e.title}`, `      ${place(e)}`]

function conformanceBriefCommand(io, root, positional, flags, json) {
  const name = strFlag(flags, 'change') || positional[2] || ''
  if (!name) io.die(`mr conformance-brief requires a change\nusage: ${USAGE_LINES['conformance-brief']}`)
  requireFlags(io, 'conformance-brief', flags, ['base', 'head'])
  const changed = changedPaths(io, flags)
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
 * subcommand.
 */
export function mrCommand(io, root, positional, flags, json) {
  const sub = positional[1]
  if (flags.help === true || sub === 'help') {
    process.stdout.write(MR_HELP)
    return
  }
  switch (sub) {
    case 'comment':
      return commentCommand(io, flags, json)
    case 'replies':
      return repliesCommand(io, flags, json)
    case 'remediate-brief':
      return remediateBriefCommand(io, flags, json)
    case 'conformance-brief':
      return conformanceBriefCommand(io, root, positional, flags, json)
    case 'test-paths':
      return testPathsCommand(io, root, flags, json)
    default:
      return io.die(
        sub === undefined
          ? `mr needs a subcommand: ${MR_SUBCOMMANDS.join(', ')} (see interlock mr --help)`
          : `unknown mr subcommand ${JSON.stringify(sub)}: expected ${MR_SUBCOMMANDS.join(', ')} (see interlock mr --help)`
      )
  }
}
