// The halt resume card: the one file a halted ship run leaves behind for the
// person who has to pick it up later.
//
// Everything a halt already records is machine-shaped and scattered — the
// trajectory under `.claude/ship/runs/`, the plan and its fingerprint under
// `.claude/ship/`, the leftover boxes in `tasks.md`, the reason in a summary
// printed to a terminal nobody was watching. A reader coming back in a new
// session, with none of that conversation in context, had to reassemble it. The
// card is that reassembly, written once at the close, in one place, in prose.
//
// Three rules it exists under, and all three are load-bearing:
//
// 1. **It is a record, not a trigger.** Nothing reads it back. `/interlock:ship`
//    still decides whether to skip the classifier from the plan fingerprint, not
//    from this file, so a stale or hand-edited card cannot make a later run
//    reuse a plan it should have rebuilt. The card says that about itself, in
//    the file, because a markdown "resume" artifact that nothing consumes is
//    exactly the thing a reader would otherwise assume is wired in.
// 2. **It never throws.** A read-only checkout, a full disk, an unwritable
//    `.claude/` — each degrades to a no-op that *reports* itself through the
//    return value, and the close turns that into a degradation banner. The run
//    already halted; losing its card must not also change how it halted. This
//    is the outcome-corpus class of the repository's deliberately-different
//    corpus-loss semantics, not the trajectory's.
// 3. **It is bounded, and says where the unbounded copy is.** Every list it
//    prints is capped by `LIMITS.resumeCardListRows` and names the command that
//    prints the whole thing. Truncation is stated, never silent.
//
// Only on a halt. A clean run's summary already ends in `ARCHIVE PENDING` and
// there is nothing to resume.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LIMITS } from './limits.mjs'

/** Where the card lands, relative to the repo root. Already gitignored. */
export const HANDOFF_DIR = join('.claude', 'handoff')

/** Bump when the card's shape changes, so an older one stays identifiable. */
export const RESUME_CARD_SCHEMA = 'interlock.resume-card/1'

/**
 * What the filename says when the run halted before a plan was adopted and so
 * never got a run id. A literal rather than a timestamp: a card keyed to the
 * clock would accumulate one file per failed invocation, and the thing a reader
 * wants is the latest state of this change, not a pile of them.
 */
export const NO_RUN_ID = 'no-run-id'

/** Halt reasons are already bounded upstream; this is the backstop. */
const MAX_REASON_CHARS = 500

// A change name and a run id both reach us from a branch, a directory or a
// model, so both are untrusted as path components: `../` or a slash would put
// the card somewhere other than the handoff directory.
// Dropping the separators alone would leave `a/b/../c` as `a-b-..-c`: safe,
// because nothing can traverse without a separator, but a filename carrying a
// literal `..` invites the next reader to decide it is fine somewhere else. The
// run of dots collapses too, so no segment ever contains one.
function segment(value, fallback) {
  const s = typeof value === 'string' ? value.trim() : ''
  const safe = s
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return safe.slice(0, 80) || fallback
}

function clamp(value, max) {
  const s = typeof value === 'string' ? value.trim() : ''
  if (s.length <= max) return s
  return `${s.slice(0, max)}… (truncated)`
}

/**
 * The first `LIMITS.resumeCardListRows` of a list, plus a line saying how many
 * were left out and where the whole list is. Never a silent head.
 */
function rows(list, { whole }) {
  const all = Array.isArray(list) ? list.filter(Boolean) : []
  const cap = LIMITS.resumeCardListRows
  if (all.length <= cap) return { shown: all, note: null }
  return {
    shown: all.slice(0, cap),
    note: `_… and ${all.length - cap} more — the full list is in ${whole}._`
  }
}

/**
 * Where this change's card lives, relative to the repo root.
 *
 * One card per change per run. A second halt of the same run overwrites its own
 * card, which is correct: the card describes the run's final state, and two
 * cards for one run would only ask a reader to work out which is current.
 *
 * @param {{change?: string, runId?: string}} [input]
 * @returns {string} repo-relative path
 */
export function resumeCardPath({ change, runId } = {}) {
  return join(HANDOFF_DIR, `ship-${segment(change, 'unnamed')}-${segment(runId, NO_RUN_ID)}.md`)
}

/**
 * Render the card. Pure: every fact is passed in, nothing is read from disk and
 * nothing is inferred about a future run.
 *
 * In particular this never predicts whether the next ship will reuse the plan.
 * It reports what is stored now and what the reuse rule is; the recomputation
 * happens at the next `run start`, against artifacts that may change in
 * between, and a card that guessed would be wrong exactly when it mattered.
 *
 * @param {object} input
 * @returns {string} the markdown body
 */
export function formatResumeCard({
  change,
  runId = null,
  halted = null,
  leftoverTaskIds = [],
  plan = null,
  planStored = false,
  waves = [],
  degradations = [],
  projectSlug = null,
  cwd = null
} = {}) {
  const name = typeof change === 'string' && change.trim() ? change.trim() : 'unnamed'
  const reason = clamp(halted, MAX_REASON_CHARS) || 'the run halted without recording a reason'
  const hasRun = typeof runId === 'string' && runId.length > 0
  const lines = []

  lines.push(`<!-- ${RESUME_CARD_SCHEMA} change=${name} run=${hasRun ? runId : NO_RUN_ID} -->`)
  lines.push(`# Ship halted — ${name}`)
  lines.push('')
  lines.push(reason)
  lines.push('')
  lines.push(
    'This file is a record, not a trigger. Nothing reads it back: the next ship decides ' +
      'what to skip from the stored plan fingerprint, never from this card. ' +
      '**Do not start another ship run unless the user asks.**'
  )
  lines.push('')

  lines.push('## Where this run stopped')
  lines.push('')
  lines.push(`- change: \`${name}\``)
  lines.push(
    hasRun
      ? `- run: \`${runId}\``
      : '- run: none — the run halted before a plan was adopted, so no trajectory was opened'
  )
  if (projectSlug) lines.push(`- project: \`${projectSlug}\``)
  if (cwd) lines.push(`- cwd: \`${cwd}\``)
  if (hasRun) {
    lines.push(`- trajectory: \`.claude/ship/runs/${runId}.jsonl\``)
    lines.push('')
    lines.push('Read the whole walk that led here rather than re-deriving it:')
    lines.push('')
    lines.push('```bash')
    lines.push(`interlock run-log show ${runId}`)
    lines.push(`interlock run-log query --run ${runId} --halted`)
    lines.push('```')
  }
  lines.push('')

  lines.push('## Leftover tasks')
  lines.push('')
  const leftover = rows(leftoverTaskIds, { whole: `\`openspec/changes/${name}/tasks.md\`` })
  if (!leftover.shown.length) {
    lines.push(
      `Every box in \`openspec/changes/${name}/tasks.md\` is ticked. The halt was not about ` +
        'unfinished tasks — read the reason above.'
    )
  } else {
    lines.push('Boxes still unchecked in `openspec/changes/' + name + '/tasks.md`:')
    lines.push('')
    for (const id of leftover.shown) lines.push(`- \`${id}\``)
    if (leftover.note) {
      lines.push('')
      lines.push(leftover.note)
    }
    lines.push('')
    // Deliberately NOT paste-ready over the whole list. Most of these ids were
    // never dispatched — the run halted — and `interlock tasks tick` is
    // mechanical: it flips a marker by id and verifies nothing. A command that
    // ticked all of them would delete the only on-disk record of what is left to
    // do, which is the outcome the halt that wrote this card exists to prevent.
    lines.push(
      'Some of these are done on disk and only unticked; the rest were never attempted, ' +
        'because the run stopped. Tick **only** the ones you have checked are implemented — ' +
        'ticking the rest is how unimplemented work ships behind a `[x]`:'
    )
    lines.push('')
    lines.push('```bash')
    lines.push(`interlock tasks tick ${name} --ids <the ids above you verified are done>`)
    lines.push('```')
  }
  lines.push('')

  lines.push('## The plan')
  lines.push('')
  if (plan && typeof plan === 'object') {
    lines.push(
      plan.reused
        ? `This run **reused** the stored plan (${plan.status}): ${plan.reason}`
        : `This run **rebuilt** the plan (${plan.status}): ${plan.reason}`
    )
  } else {
    lines.push(
      'This run ended before the plan-reuse check reported, so whether the classifier ran ' +
        'was never observed.'
    )
  }
  lines.push('')
  if (planStored) {
    lines.push(
      'A plan and its fingerprint are on disk at `.claude/ship/plan.json` and ' +
        '`.claude/ship/plan-fingerprint.json`, and they name this change. The next ship ' +
        'skips the wave classifier only if a fingerprint recomputed from the current ' +
        'artifacts still matches — ticking a checkbox does not break it; editing an ' +
        'artifact, or adding, removing, reordering or rewording a task does, and so does ' +
        'passing a different `--solo` / `--waves` / `--tdd` shape.'
    )
  } else {
    lines.push(
      'No stored plan on disk names this change, so the next ship classifies the waves ' +
        'again. That is the normal cost of a first run, not a fault.'
    )
  }
  lines.push('')

  lines.push('## Waves, as far as they got')
  lines.push('')
  const waveRows = rows(
    (Array.isArray(waves) ? waves : []).map(w =>
      w && typeof w === 'object'
        ? `- wave ${w.wave ?? '?'} (${w.kind ?? 'unknown'}): ${w.ok ?? '?'} ok, ${w.failed ?? '?'} failed`
        : null
    ),
    { whole: hasRun ? `\`interlock run-log show ${runId}\`` : 'the run receipt' }
  )
  if (!waveRows.shown.length) lines.push('No wave was recorded — the run halted before or during the first one.')
  else {
    for (const row of waveRows.shown) lines.push(row)
    if (waveRows.note) {
      lines.push('')
      lines.push(waveRows.note)
    }
  }
  lines.push('')

  lines.push('## Degraded before the halt')
  lines.push('')
  const bannerRows = rows(
    (Array.isArray(degradations) ? degradations : []).map(b => (typeof b === 'string' ? `- ${b}` : null)),
    { whole: 'the printed summary' }
  )
  if (!bannerRows.shown.length) lines.push('No degradation banners were raised.')
  else {
    for (const row of bannerRows.shown) lines.push(row)
    if (bannerRows.note) {
      lines.push('')
      lines.push(bannerRows.note)
    }
  }
  lines.push('')

  lines.push('## Picking it up')
  lines.push('')
  lines.push('1. Fix what the halt reason names. A halt is a gate that failed closed, not a flake.')
  lines.push('2. Tick anything already done but unticked, with the command above.')
  lines.push(
    `3. In a new session, when a person asks for it: \`/interlock:ship ${name}\`. A stored ` +
      'plan whose fingerprint still matches is reused, so the wave classifier is not paid ' +
      'for twice. Add `--apply-only` if you want the waves alone and will review and commit ' +
      'yourself.'
  )
  lines.push('')
  lines.push(
    'The wave cursor and the previous wave\'s handoff packets are **not** resumed: ' +
      '`.claude/ship/state.json` is replaced at wave 0 by the next run. Work that was ' +
      'written but never ticked can therefore be dispatched again, which is why step 2 is ' +
      'not optional.'
  )
  lines.push('')

  return lines.join('\n')
}

/**
 * Write the card for a halted run.
 *
 * Never throws — see the module header. The caller gets a reason, never an
 * exception, and turns it into a degradation banner.
 *
 * @param {string} root repo root; `.claude/handoff` is created beneath it
 * @param {object} [input] everything `formatResumeCard` takes
 * @returns {{written: boolean, path: string|null, reason: string|null}}
 */
export function writeResumeCard(root, input = {}) {
  try {
    if (typeof root !== 'string' || !root.trim()) {
      return { written: false, path: null, reason: 'no root directory given' }
    }
    if (!existsSync(root)) {
      return { written: false, path: null, reason: `root does not exist: ${root}` }
    }
    const rel = resumeCardPath(input)
    const dest = join(root, rel)
    mkdirSync(join(root, HANDOFF_DIR), { recursive: true })
    writeFileSync(dest, formatResumeCard(input))
    // The repo-relative path, not the absolute one: it is printed in a summary
    // a person reads next to a `cwd:` row, and it is what they type.
    return { written: true, path: rel, reason: null }
  } catch (err) {
    // Deliberately swallowed: see the module header.
    return { written: false, path: null, reason: (err && err.message) || String(err) }
  }
}
