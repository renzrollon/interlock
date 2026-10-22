// The `interlock review-advisor` subcommand and the brief `interlock review
// --advisor-brief` writes: the review-code consult's CLI brackets
// (add-review-findings-advisor).
//
// The thin I/O around lib/review-advisor.mjs and lib/prompts/review-advisor.mjs,
// kept out of bin/interlock so the entry file stays a dispatcher under the
// plugin directory's per-file size limit. The entry file's own output and exit
// helpers come in as `io` (`emit`, `readStdin`), so stdout and the one-stdin-read
// guard stay exactly the CLI's.
//
// The brief and its id index go under `<root>/.claude/metrics/`, the draft is
// persisted beside them, and the rendered file is the change's
// `review-advisor.md`. Nothing here gates anything.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { inspectChange, resolveChange } from './artifacts.mjs'
import { LIMITS } from './limits.mjs'
import { indexOf, planReviewAdvisorBrief } from './prompts/review-advisor.mjs'
import { checkFlags, renderReviewAdvisor, reviewAdvisorDidNotRun, reviewVerdict } from './review-advisor.mjs'

const isoNow = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z')
const fileStamp = iso => iso.replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
const METRICS = join('.claude', 'metrics')

/**
 * Write the brief and its id index for a resolved review.
 * Bookkeeping: any failure is `{ written: false, reason }`, never a throw.
 */
export function reviewAdvisorBrief(io, root, change, result, verdicts, changedPaths, flags = {}) {
  try {
    const resolved = resolveChange(root, change)
    if (resolved.error) return { written: false, reason: resolved.error }
    const iso = isoNow()
    const rel = join(METRICS, `review-advisor-brief-${resolved.name}-${fileStamp(iso)}.md`)
    const input = { change: resolved.name, stamp: iso, briefPath: rel, result, verdicts, changedPaths, limits: LIMITS }
    const plan = planReviewAdvisorBrief(input)
    const indexRel = rel.replace(/\.md$/, '.json')
    mkdirSync(join(root, METRICS), { recursive: true })
    writeFileSync(join(root, rel), plan.text)
    writeFileSync(join(root, indexRel), JSON.stringify(indexOf(input), null, 2) + '\n')
    return { written: true, path: rel, index: indexRel, chars: plan.chars, omitted: plan.omitted, overrun: plan.overrun }
  } catch (err) {
    return { written: false, reason: err.message }
  }
}

/** The newest index file for a change, as { rel, index } or { error }. */
function newestIndex(root, change) {
  const prefix = `review-advisor-brief-${change}-`
  let names = []
  try {
    names = readdirSync(join(root, METRICS)).filter(f => f.startsWith(prefix) && /^\d{8}-\d{6}\.json$/.test(f.slice(prefix.length)))
  } catch {
    // No metrics directory: no index.
  }
  if (names.length === 0) return { error: `no brief index for ${change}` }
  const rel = join(METRICS, names.sort().pop())
  try {
    return { rel, index: JSON.parse(readFileSync(join(root, rel), 'utf8')) }
  } catch (err) {
    return { error: `brief index unreadable: ${err.message}` }
  }
}

export function reviewAdvisorCheck(io, root, change, flags, json) {
  const info = inspectChange(root, change)
  const iso = isoNow()
  let result
  let raw
  let draftPath
  let briefPath
  let index
  // Once the change resolves, every path exits 0: a draft that is missing or
  // unreadable is written down as a consult that did not run, never an exit.
  if (flags.failed !== undefined) {
    result = { status: 'did-not-run', reason: flags.failed === true ? '' : String(flags.failed) }
  } else if (flags.check === true) {
    result = { status: 'did-not-run', reason: 'no draft given to --check' }
  } else {
    try {
      raw = flags.check === '-' ? io.readStdin() : readFileSync(String(flags.check), 'utf8')
    } catch (err) {
      result = { status: 'did-not-run', reason: `draft unreadable: ${err.message}` }
    }
  }
  if (raw !== undefined && flags.check === '-') {
    // Persisted unchanged before it is parsed, so the skill needs no Write. A
    // persist failure leaves `draft` out and carries on.
    const rel = join(METRICS, `review-advisor-${change}-${fileStamp(iso)}.json`)
    try {
      mkdirSync(join(root, METRICS), { recursive: true })
      writeFileSync(join(root, rel), raw)
      draftPath = rel
    } catch {
      draftPath = undefined
    }
  }
  if (result === undefined) {
    const found = newestIndex(root, change)
    if (found.error) {
      result = { status: 'did-not-run', reason: found.error }
    } else {
      index = found.index
      briefPath = found.rel.replace(/\.json$/, '.md')
      let draft
      try {
        draft = JSON.parse(raw)
      } catch {
        result = { status: 'did-not-run', reason: 'draft is not JSON' }
      }
      if (result === undefined) result = checkFlags(draft, index, LIMITS)
    }
  }
  const drafted = result.status === 'drafted'
  const reason = drafted ? undefined : String(result.reason ?? '').trim() || 'no reason given'
  const body = drafted
    ? renderReviewAdvisor(result, { change, stamp: iso, briefPath, index })
    : reviewAdvisorDidNotRun(reason, { change, stamp: iso })
  const path = `openspec/changes/${change}/review-advisor.md`
  let failure = reason
  try {
    writeFileSync(join(info.path, 'review-advisor.md'), body)
  } catch (err) {
    // The consult is advice: a file that could not be written is a reason to
    // report, never an exit code.
    failure = `review-advisor.md not written: ${err.message}`
  }
  const ok = drafted && failure === undefined
  const out = {
    step: 'check',
    change,
    status: ok ? 'drafted' : 'did-not-run',
    ...(ok ? {} : { reason: failure }),
    flags: ok ? result.flags.map(f => ({ id: f.id, kind: f.kind })) : [],
    dropped: ok ? result.dropped.length : 0,
    ...(draftPath ? { draft: draftPath } : {}),
    path
  }
  const lines = ok
    ? [`review advisor: drafted ${out.flags.length} flags, ${out.dropped} dropped`, ...out.flags.map(f => `  ${f.id} ${f.kind}`)]
    : [`review advisor: did not run: ${failure}`]
  io.emit(json, out, [...lines, `  ${path}`].join('\n') + '\n')
  if (json && failure !== undefined && drafted) process.stderr.write(lines[0] + '\n')
}

export function reviewAdvisorVerdict(io, root, flags, json) {
  const { reasons, ...out } = reviewVerdict(typeof flags.labels === 'string' ? flags.labels : join(root, 'evals'), LIMITS)
  const c = out.caps
  io.emit(json, out, [
    `review advisor verdict: ${out.verdict}`,
    `  labelled ${out.labelled} (min ${c.minLabels})`,
    `  matches ${out.matches} (keepMinMatches ${c.keepMinMatches})`,
    `  repeats ${out.repeats} (repeatMaxPercent ${c.repeatMaxPercent}%)`,
    ...reasons.map(x => `  ${x}`),
    ...out.problems.map(p => `  problem: ${p}`)
  ].join('\n') + '\n')
}
