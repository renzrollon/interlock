// What a task did, as the run recorded it — the adjudication of lane results.
//
// One authority for "what did this task do": the outcome `record-batch`
// recorded, not the outcome the implementing agent reported for itself. Pure:
// nothing here reads a file or a manifest. Moved out of lib/run.mjs, which
// holds the loop itself and had grown into the directory's size headroom
// (test/spine/package.test.mjs); lib/run.mjs re-exports every public name here,
// so its callers and their tests read one import path.

// --- adjudication (moved from the RECORDED_VERDICT block) -------------------
//
// One authority for "what did this task do": the outcome `record-batch`
// recorded, not the outcome the implementing agent reported for itself. The
// claim is the input the state machine adjudicated — a lane result that omits an
// outcome fails every task in the lane — so where the two differ the recorded
// outcome is the one a tick and a tally are built from. (A rejected handoff
// packet is not such a difference: the task stays done and the rejection travels
// beside the outcome, as `reportRejected`.)
//
// Both hosts read this from one place now. A second copy of "which of two
// disagreeing observations is the run's" would drift, and both hosts would
// still look correct.

/** The three outcomes a batch can record. Anything else is not a verdict. */
const RECORDED_OUTCOMES = ['ok', 'failed', 'not-attempted']

/**
 * The recorded verdicts `batchOutcomes` produced, validated.
 *
 * One malformed entry invalidates the whole payload rather than being skipped:
 * a partial verdict read as a complete one is the defect this exists to close,
 * one level down. `null` means "no verdict arrived" and puts the caller on the
 * loud claim-derived fallback.
 */
export function recordedOutcomes(raw) {
  if (!Array.isArray(raw) || !raw.length) return null
  const out = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null
    if (typeof entry.id !== 'string' || !entry.id.trim()) return null
    if (!RECORDED_OUTCOMES.includes(entry.outcome)) return null
    const rejected =
      typeof entry.reportRejected === 'string' && entry.reportRejected.trim()
        ? entry.reportRejected.trim()
        : null
    out.push({
      id: entry.id.trim(),
      outcome: entry.outcome,
      reason: typeof entry.reason === 'string' && entry.reason.trim() ? entry.reason.trim() : '',
      // A whitelist rebuilds the object, so a field not named here is dropped
      // without any caller noticing. Only a non-empty string is a rejection.
      ...(rejected ? { reportRejected: rejected } : {})
    })
  }
  return out
}

/**
 * What to tick, what to tally, and which claims the run had to override.
 *
 * @param {Array<Array<{id: string, ok: boolean, error?: string}>>} batches the
 *   claims sent to `record-batch`, one array per batch, in command order
 * @param {Array<{id: string, outcome: string, reason: string}>|null} recorded
 *   the verdicts those commands reported, concatenated in the same order
 */
export function adjudicateBatches(batches, recorded) {
  const claims = batches.flat()
  // Every claim must have a verdict, or there is no verdict: a payload covering
  // three of five tasks would otherwise tally the other two from the claim
  // while reading as fully recorded.
  const covered = Boolean(recorded) && claims.every(c => recorded.some(o => o.id === c.id))
  const verdicts = covered ? recorded : null
  const rowsOf = batch =>
    batch.map(claim => {
      const found = verdicts ? verdicts.find(o => o.id === claim.id) : null
      return {
        id: claim.id,
        outcome: found ? found.outcome : claim.ok ? 'ok' : 'failed',
        reason: found ? found.reason : typeof claim.error === 'string' ? claim.error : '',
        ...(found && found.reportRejected ? { reportRejected: found.reportRejected } : {})
      }
    })

  const perBatch = batches.map(rowsOf)
  const rows = perBatch.flat()
  return {
    claimDerived: !verdicts,
    tickIds: rows.filter(r => r.outcome === 'ok').map(r => r.id),
    waves: perBatch.map(batchRows => {
      const rejectedIds = batchRows.filter(r => r.reportRejected).map(r => r.id)
      return {
        ok: batchRows.filter(r => r.outcome === 'ok').length,
        failed: batchRows.filter(r => r.outcome === 'failed').length,
        failedIds: batchRows.filter(r => r.outcome === 'failed').map(r => r.id),
        recordedNotAttempted: batchRows.filter(r => r.outcome === 'not-attempted').map(r => r.id),
        // Only a batch that held one carries the key, so a clean wave keeps the
        // shape it always had.
        ...(rejectedIds.length ? { reportRejected: rejectedIds } : {})
      }
    }),
    // A rejected report is a task that did its work and lost its packet: it is
    // recorded as done, so claim and record agree and `overrides` is left alone.
    rejected: rows.filter(r => r.reportRejected).map(r => ({ id: r.id, reason: r.reportRejected })),
    overrides: rows.filter((row, i) => verdicts && (row.outcome === 'ok') !== claims[i].ok)
  }
}

/**
 * An overridden claim is a finding, not a silent correction. A run that quietly
 * re-recorded five claimed successes is indistinguishable from a clean one; a
 * run that says it overrode five claims tells its reader the implementer prompt
 * or the result contract needs attention. A rejected handoff packet is not an
 * override — claim and record agree there — and has its own banner
 * (`rejectedBanner`).
 */
export function overrideBanner(overrides) {
  const detail = overrides
    .map(o => `${o.id}: ${o.outcome}${o.reason ? ` — ${o.reason}` : ''}`)
    .join('; ')
  return (
    `CLAIM OVERRIDDEN: ${overrides.map(o => o.id).join(', ')} — the implementing agent reported ` +
    `otherwise and the run acted on what it recorded (${detail})`
  )
}

/**
 * The fallback said out loud. Silent fallback would reintroduce the defect in
 * the one case nobody would think to check, and a count that was never read
 * must not read as one that came back clean.
 */
export function claimDerivedBanner() {
  return (
    'CLAIM-DERIVED TALLIES: record-batch reported no usable per-task outcomes, so this wave was ' +
    'ticked and counted from what the implementing agents claimed rather than from what the run recorded'
  )
}

/**
 * Who reads a rejected report next, said in the banner's last clause. A later
 * wave is briefed with it. The last wave has none, and a banner that claimed
 * one would be a degradation spoken falsely — so it names what does stand
 * between that work and the commit instead, or says that nothing does.
 */
const REJECTED_REPORT_TOLD = Object.freeze({
  'next-wave': 'the next wave is told these tasks filed no usable report',
  review:
    'no later wave remains to be told, so the review is told instead; final verification still ' +
    'gates the commit',
  'final-verify':
    'no later wave remains to be told, so final verification is the only check on this work',
  none:
    'no later wave remains to be told and --apply-only ends the run here, so nothing in this run ' +
    'checks this work'
})

/**
 * Which of those applies to a batch recorded against `state` (the state BEFORE
 * the batch was recorded, whose cursor still names the batch's own wave).
 * Earlier batches of the same wave are not told either way: only a later wave is.
 */
export function rejectedReportReader(state, flags = {}) {
  const waveIndex = state && state.cursor ? state.cursor.waveIndex : -1
  if (state && Array.isArray(state.waves) && state.waves[waveIndex + 1]) return 'next-wave'
  if (flags.applyOnly === true) return 'none'
  return flags.review === true ? 'review' : 'final-verify'
}

/**
 * A report that could not be used, said out loud once per batch that held any.
 * The tasks are recorded as done, so the banner is the only place a reader learns
 * that no packet was kept for them, and who was told so.
 *
 * @param {string[]} ids      the batch's rejected task ids
 * @param {Array<{id: string, reason: string}>} rejected the adjudication's list
 * @param {keyof typeof REJECTED_REPORT_TOLD} [reader] `rejectedReportReader`'s answer
 */
export function rejectedBanner(ids, rejected, reader = 'next-wave') {
  const detail = ids
    .map(id => {
      const found = rejected.find(r => r.id === id)
      return found && found.reason ? `${id} — ${found.reason}` : id
    })
    .join('; ')
  const told = REJECTED_REPORT_TOLD[reader] || REJECTED_REPORT_TOLD['next-wave']
  return (
    `HANDOFF REJECTED: ${detail} — recorded as done and not counted toward the task-failure cap; ` +
    told
  )
}

/**
 * Turn one lane's agent result into an outcome per task it was given.
 *
 * Fails CLOSED, in one direction only: a result that does not account for every
 * task in the lane fails all of them, because a lane that reported on two of its
 * three tasks has told us nothing about the third — and "nothing" read as
 * success is how a task silently ships unimplemented. `not-attempted` is the one
 * outcome that is neither: it is reported, ticked nowhere, and counted nowhere.
 *
 * A result that is absent entirely is a lost agent — a crash, a timeout, or a
 * briefing the agent never acknowledged — not an agent that filed a bad report.
 * On a multi-task lane that costs one failure, charged to the first task, and
 * the rest are `not-attempted`. Charging every task would halt a chain on one
 * miss. A single-task lane is one failure either way, and stays that.
 */
export function laneOutcomes(lane, result) {
  const failAll = error => lane.map(t => ({ id: t.id, outcome: 'failed', error, handoff: null }))
  if (!result) {
    if (lane.length >= 2) {
      return lane.map((t, i) =>
        i === 0
          ? { id: t.id, outcome: 'failed', error: 'agent returned no result', handoff: null }
          : { id: t.id, outcome: 'not-attempted' }
      )
    }
    return failAll('agent returned no result')
  }

  if (lane.length === 1) {
    const [only] = lane
    return [
      {
        id: result.id || only.id,
        outcome: result.ok ? 'ok' : 'failed',
        error: result.error,
        filesChanged: result.filesChanged,
        handoff: result.handoff
      }
    ]
  }

  const entries = Array.isArray(result.tasks) ? result.tasks : null
  if (!entries) return failAll('lane result carried no per-task outcomes')

  const byId = new Map()
  for (const e of entries) {
    if (e && typeof e === 'object' && typeof e.id === 'string') byId.set(e.id, e)
  }
  const missing = lane.filter(t => !byId.has(t.id)).map(t => t.id)
  if (missing.length) return failAll(`lane result omitted an outcome for ${missing.join(', ')}`)

  return lane.map(t => {
    const e = byId.get(t.id)
    if (e.outcome === 'ok') {
      return {
        id: t.id,
        outcome: 'ok',
        error: e.error,
        filesChanged: e.filesChanged,
        handoff: e.handoff
      }
    }
    if (e.outcome === 'not-attempted') return { id: t.id, outcome: 'not-attempted' }
    // Anything else — including a value the schema let through — is a failure.
    // Guessing which of three named outcomes an unnamed one meant is exactly the
    // inference the schema exists to remove.
    return {
      id: t.id,
      outcome: 'failed',
      error: e.error || `lane reported outcome ${JSON.stringify(e.outcome)}`,
      filesChanged: e.filesChanged,
      handoff: e.handoff
    }
  })
}
