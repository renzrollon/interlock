// The run receipt, and the summary both hosts print.
//
// `buildReceipt` was a marked block in `workflows/ship.js` that `bin/interlock-
// ship-acp` evaluated out of that file rather than carrying a second copy —
// because two hosts writing "the same" receipt from two implementations is
// precisely the drift a reader could never see: both trajectories would look
// fine. The smuggling is gone; the reason it existed is why this module is here.
//
// The summary text joins it for the same reason. Two drivers formatting the same
// facts would eventually format them differently, and the difference would show
// up as a support question rather than as a test failure.

/**
 * The wave-state skip reason meaning the per-run verification cap was already
 * spent.
 *
 * A function rather than a constant so a prompt or a banner can name it too: two
 * literals is how the printed banner and the recorded count would come to
 * disagree about what "cap exhausted" means, and only one of them would be wrong
 * in a way anyone noticed.
 */
export function capExhaustedSkipReason() {
  return 'verify-cap-reached'
}

/**
 * The three verification conditions a receipt reports, read out of a wave-state
 * object.
 *
 * The Workflow host could not read that file and asked its closing agent for the
 * same three facts. The CLI reads it directly — one fewer hop, and one statement
 * of which skip reason means the cap was spent.
 */
export function closingFromWaveState(state) {
  if (!state || !Array.isArray(state.skippedVerifications)) return null
  const reasons = state.skippedVerifications.map(s => (s && s.reason) || '').filter(Boolean)
  return {
    skippedVerificationReasons: reasons,
    capExhaustedVerifications: reasons.filter(r => r === capExhaustedSkipReason()).length,
    unresolvedErrors: Array.isArray(state.unresolved) ? state.unresolved.length : undefined
  }
}

/**
 * The strict tail's figures, read off the run manifest (design D7).
 *
 * They used to arrive through `--host-observed`, because the tail ran inside
 * the Workflow host and the CLI never saw it. The tail is a CLI-emitted program
 * now (`emit-strict-tail-from-cli`), so every one of these was adjudicated,
 * counted or recorded by `interlock run` itself and is read back from where it
 * was written rather than reported by the party it describes.
 *
 * An absent field stays absent. A lean run never reviewed, and `null` — "never
 * found out" — is a different fact from a review that found nothing, which is
 * the distinction the outcome corpus's control group depends on.
 *
 * @param {object|null} manifest the run manifest (`.claude/ship/run.json`)
 * @returns {{review: object|null, remediation: object|null,
 *   remediationRounds: number|undefined, handoff: object|null,
 *   autonomy: object|null}}
 */
export function tailFromManifest(manifest) {
  const m = manifest || {}
  const counts = m.review && m.review.counts ? m.review.counts : null
  return {
    // Flattened to the field names `buildReceipt` and `formatRunSummary` read,
    // so neither has to know that the manifest nests them under `counts`.
    review: counts
      ? {
          raised: counts.raised,
          dismissed: counts.dismissed,
          droppedByQuality: counts.droppedByQuality,
          surviving: counts.surviving,
          blockers: counts.blockers
        }
      : null,
    remediation: m.remediation || null,
    // What the run CONSUMED, never the published cap — and only when a review
    // ran at all, so a lean run reports unobserved rather than zero rounds.
    remediationRounds: m.review ? m.fixRoundsRun || 0 : undefined,
    handoff: m.handoff || null,
    // Storage only, and deliberately not printed: the ladder is experimental
    // and a level means nothing to the reader (the retired autonomy-record
    // prompt said so itself). Carried here so a reader of the manifest can see
    // that the close recorded one.
    autonomy: m.autonomy || null
  }
}

/**
 * The run's receipt payload: what this run observed about itself, in the field
 * names `lib/run-log.mjs`'s `run-receipt` whitelist copies by name.
 *
 * Pure. Every field is either observed or `undefined`. Nothing here substitutes
 * a zero for a value the run never found out: the writer turns an absent field
 * into `null`, and `null` reads as unknown. A receipt that reported an
 * unobserved review as zero blockers would flatter exactly the halted runs this
 * record exists to explain.
 *
 * @param {{
 *   change?: string,
 *   summary?: object,
 *   degradations?: string[],
 *   planFingerprint?: string,
 *   leftoverTaskIds?: string[],
 *   host?: {id?: string, billing?: string, hooks?: boolean, usage?: boolean}
 * }} input
 */
export function buildReceipt(input) {
  const source = input || {}
  const summary = source.summary || {}
  const closing = summary.closing || null
  const plan = summary.plan || null
  const review = summary.review || null
  const commit = summary.commit || null

  // The two path sets, in their own group rather than on `closing`: a host that
  // could not read the wave state must still be able to report these, and a
  // host that could not read these must not make `closing` look present.
  //
  // A set is carried only when the close actually read one. Anything else — no
  // close at all, a read that failed, a host that could not run the readers —
  // is `undefined`, which the writer records as unobserved.
  const paths = summary.paths || null
  const touched = paths && Array.isArray(paths.touchedPaths) ? paths.touchedPaths : undefined
  const predicted = paths && Array.isArray(paths.predictedPaths) ? paths.predictedPaths : undefined

  // surviving counts blockers and warnings together, so the warning count is
  // the difference — and only when both halves were actually observed. A
  // negative difference means the two counts disagree, which is reported as
  // unknown rather than as a number nobody measured.
  const surviving = review && Number.isFinite(review.surviving) ? review.surviving : undefined
  const blockers = review && Number.isFinite(review.blockers) ? review.blockers : undefined
  const warnings =
    surviving !== undefined && blockers !== undefined && surviving >= blockers
      ? surviving - blockers
      : undefined

  // Which host ran this, and the three ways it may have been weaker than the
  // default one (design D8). Recorded rather than inferred from the id: a
  // reader comparing two receipts should not have to know that `acp` over the
  // Claude binary has hooks and `acp` over anything else does not, and the
  // outcome corpus's comparisons are only meaningful if the run said so itself.
  const host = source.host && typeof source.host === 'object' ? source.host : null

  return {
    type: 'run-receipt',
    change: source.change,
    host: host
      ? {
          id: host.id,
          billing: host.billing,
          hooks: host.hooks,
          usage: host.usage
        }
      : undefined,
    waves: (Array.isArray(summary.waves) ? summary.waves : []).map(wave => ({
      wave: wave.wave,
      ok: wave.ok,
      failed: wave.failed,
      notAttempted: wave.notAttempted
    })),
    // Measured from the runtime's own counter and carried, not computed by
    // anyone downstream. Element by element, because these entries ride on the
    // same summary the review findings and suite output do.
    spend: (Array.isArray(summary.spend) ? summary.spend : []).map(entry => ({
      wave: entry.wave,
      outputTokens: entry.outputTokens
    })),
    outputTokens: summary.outputTokens,
    planReused: plan ? plan.reused === true : undefined,
    planStatus: plan ? plan.status : undefined,
    planReason: plan ? plan.reason : undefined,
    planFingerprint: source.planFingerprint,
    reviewRaised: review ? review.raised : undefined,
    reviewSurviving: surviving,
    reviewBlockers: blockers,
    reviewWarnings: warnings,
    remediationRounds: summary.remediationRounds,
    // These three are what the degradation block reads, from the same place, so
    // the receipt's counts and the printed banners cannot come apart.
    skippedVerifications: closing ? (closing.skippedVerificationReasons || []).length : undefined,
    capExhaustedVerifications: closing ? closing.capExhaustedVerifications : undefined,
    unresolvedErrors: closing ? closing.unresolvedErrors : undefined,
    leftoverTaskIds: source.leftoverTaskIds,
    halted: Boolean(summary.halted),
    haltReason: summary.halted || undefined,
    // Tri-state, and the reason the field is not just the sha: a run told not to
    // commit reports false, a run that halted before it ever reached a commit
    // step reports unknown, and those are different facts about the same absent
    // sha. `commitSkipped` is set only where the run chose to stop — never
    // inferred from the sha being missing.
    committed: commit ? commit.ok === true : summary.commitSkipped === true ? false : undefined,
    commit: commit && commit.ok === true ? commit.sha : undefined,
    // The two path sets, read at close and carried here — never the commit
    // step's own account of what it committed. An absent set stays absent (the
    // writer turns it into `null`) and takes a stated reason with it: `[]` would
    // assert that a commit touched nothing, and this set is the denominator of
    // an indicator, so that error would be silent and systematic.
    touchedPaths: touched,
    touchedPathsReason: touched
      ? undefined
      : (paths && paths.touchedPathsReason) ||
        (commit && commit.ok !== true
          ? 'the commit step reported failure, so no commit identifier was recorded'
          : summary.commitSkipped === true
            ? 'the run was invoked so that it does not commit'
            : paths
              ? 'the run recorded no commit identifier'
              : 'the run did not reach its close, so no path set was read'),
    predictedPaths: predicted,
    predictedPathsComplete: predicted ? paths.predictedPathsComplete === true : undefined,
    predictedPathsReason:
      predicted && paths.predictedPathsComplete === true
        ? undefined
        : (paths && paths.predictedPathsReason) ||
          (paths
            ? 'the executed plan could not be read back at close'
            : 'the run did not reach its close, so the executed plan was never read'),
    degradations: source.degradations
  }
}

/**
 * Every degradation this run accepted, derived from what was recorded.
 *
 * The block used to print whatever happened to be in a `banners` accumulator, so
 * silence and cleanliness were indistinguishable: the push sites covered graph,
 * test profile, model routing, three skip reasons and e2e, while cap exhaustion
 * and unresolved errors pushed nothing at all. An accumulator can only report
 * what someone remembered to push — which is the exact property this exists to
 * remove. So the run conditions are read back from the wave state, and the
 * absence of a close is itself reported.
 */
export function degradationLines({ banners = [], closing = null, hostBanners = [] } = {}) {
  const out = [...banners, ...hostBanners]

  if (!closing) {
    out.push(
      'CLOSING STEP OUTCOME UNKNOWN: the run ended before its close could read the wave state, so ' +
        'the conditions it reads back — skipped verifications, cap exhaustion, unresolved errors — ' +
        'were never observed'
    )
  } else {
    for (const reason of closing.skippedVerificationReasons || []) {
      out.push(`VERIFICATION SKIPPED: reason=${reason}`)
    }
    if (closing.capExhaustedVerifications > 0) {
      out.push(
        `VERIFY CAP EXHAUSTED: ${closing.capExhaustedVerifications} inter-wave checkpoint(s) were ` +
          `skipped because the per-run verification cap was already spent`
      )
    }
    if (closing.unresolvedErrors > 0) {
      out.push(
        `UNRESOLVED ERRORS CARRIED PAST A WAVE: ${closing.unresolvedErrors} — the fix budget was ` +
          `spent and the run continued because the errors were reported as not blocking`
      )
    }
  }

  // Deduplicate: a skip reason can be both banner-pushed as it happened and
  // read back from the state at the end, and printing it twice reads as two
  // skips.
  return [...new Set(out)]
}

/**
 * The summary's first line, exactly as `formatRunSummary` prints it.
 *
 * Exported so the close's push notification (design D4) can use the same
 * headline the printed summary carries: two implementations of "what does
 * this run's first line say" is exactly how the push and the print would
 * come to disagree, and only the reader comparing them would notice.
 *
 * @param {{change?: string, halted?: string|false, leftoverTaskIds?: string[]}} input
 */
export function summaryHeadline({ change, halted, leftoverTaskIds } = {}) {
  const leftover = Array.isArray(leftoverTaskIds) ? leftoverTaskIds : []
  if (halted) return `SHIP HALTED — ${halted}`
  if (leftover.length) return `SHIP COMPLETE WITH LEFTOVERS — ${change}`
  return `SHIP COMPLETE — ${change}`
}

/**
 * The human summary both hosts print, verbatim.
 *
 * The banner block is always printed, on a halt and on a clean run alike.
 * Silence is the failure mode it exists to remove: a summary with no banner
 * section is indistinguishable from a run that degraded and hid it.
 *
 * `runId`, `root`, `projectSlug`, `push` and `unarchived` all default so this
 * stays callable exactly as it was before design D7/D8/D9 added them — the
 * receipt module stays import-free either way.
 */
export function formatRunSummary({
  change,
  summary = {},
  flags = {},
  leftoverTaskIds = [],
  degradations = [],
  runId = undefined,
  root = undefined,
  projectSlug = undefined,
  push = null,
  unarchived = null
} = {}) {
  const leftover = Array.isArray(leftoverTaskIds) ? leftoverTaskIds : []
  const lines = []

  lines.push(summaryHeadline({ change, halted: summary.halted, leftoverTaskIds: leftover }))

  // Printed on a halt too: the run that stopped early is the one whose
  // unfinished work someone has to pick up, and the receipt carries this list
  // either way.
  if (leftover.length) {
    lines.push(`  leftover tasks (boxes still unchecked): ${leftover.join(', ')}`)
  }

  // Which path the plan took, always, in both directions. A run that silently
  // changed its own cost is the failure mode this block exists to remove, and
  // "there was no prior plan" is a reason like any other.
  if (summary.plan) {
    lines.push(
      summary.plan.reused
        ? `  PLAN REUSED (${summary.plan.status}): ${summary.plan.reason}`
        : `  PLAN REBUILT (${summary.plan.status}): ${summary.plan.reason}`
    )
  } else {
    lines.push(
      '  PLAN UNKNOWN: the run ended before the plan-reuse check reported, so whether the ' +
        'classifier ran was never observed'
    )
  }

  for (const wave of summary.waves || []) {
    lines.push(`  wave ${wave.wave ?? '?'} (${wave.kind}): ${wave.ok} ok, ${wave.failed} failed`)
  }
  if (summary.review) {
    const r = summary.review
    lines.push(
      `  review: ${r.raised ?? '?'} raised, ${r.dismissed ?? 0} dismissed by skeptics, ` +
        `${r.droppedByQuality ?? 0} dropped as too weak to report, ${r.surviving ?? '?'} surviving`
    )
  }
  if (summary.remediation) {
    lines.push(
      `  remediation: ${summary.remediation.fixed ?? 0} fixed, ${summary.remediation.deferred ?? 0} deferred`
    )
  }
  if (summary.handoff) {
    if (flags.handoff) {
      lines.push(
        `  handoff: manual test plan ${summary.handoff.manualTestPlan ? 'written' : `skipped (${summary.handoff.skipReason || 'not UI-testable'})`}`
      )
    }
    if (summary.handoff.scenariosChecked) {
      const unconfirmed = summary.handoff.scenariosUnconfirmed || 0
      lines.push(
        `  conformance: ${summary.handoff.scenariosChecked - unconfirmed}/${summary.handoff.scenariosChecked} scenarios confirmed` +
          (unconfirmed ? ` — ${unconfirmed} unconfirmed, see conformance.md` : '')
      )
    }
  }
  if (summary.commit && summary.commit.ok) lines.push(`  commit: ${summary.commit.sha || 'created'}`)
  for (const note of summary.notes || []) lines.push(`  ${note}`)

  // Identity rows (design D9): the join key a reader who was not watching uses
  // to find this run afterwards. `run:` is always printed — a halt before any
  // plan was adopted has no run id, and that absence is itself the fact.
  lines.push(
    typeof runId === 'string' && runId.length > 0
      ? `  run: ${runId}`
      : '  run: none — the run halted before a plan was adopted'
  )
  if (projectSlug !== undefined && projectSlug !== null) lines.push(`  project: ${projectSlug}`)
  if (root !== undefined && root !== null) lines.push(`  cwd: ${root}`)

  // The push outcome (design D5): a row only when a push was actually
  // attempted — an unconfigured relay is an optional feature left off, not a
  // degraded run, so it prints nothing here.
  if (push && typeof push === 'object' && push.sent !== undefined) {
    lines.push(push.sent ? '  push: sent (ntfy)' : `  push: failed — ${push.reason}`)
  }

  // The archive reminder (design D7): only on a clean, leftover-free close of
  // the change this run shipped. Never on a halt, never with leftovers — in
  // both cases the change is not complete, and the reminder must not claim
  // otherwise.
  if (!summary.halted && leftover.length === 0 && unarchived && unarchived.thisChange) {
    lines.push(`ARCHIVE PENDING — ${change}: after merge, run openspec archive ${change}`)
    if (unarchived.others > 0) {
      lines.push(`  also unarchived: ${unarchived.others} completed change(s) — run interlock drift`)
    }
  }

  lines.push('Do not start another ship run unless the user asks.')

  lines.push('')
  // A lean run must not look like --strict. Silence here is the same failure
  // mode the degradation block exists to remove.
  const skipped = []
  if (!flags.review) skipped.push('review')
  if (!flags.handoff) skipped.push('handoff')
  if (!flags.conformance) skipped.push('conformance')
  if (skipped.length) {
    lines.push(
      `LEAN SHIP: skipped ${skipped.join(', ')} — pass --review / --handoff / --strict to enable`
    )
  }

  if (degradations.length) {
    for (const banner of degradations) lines.push(banner)
  } else {
    lines.push(
      'No degradation banners — graph, test profile, model routing, verification and e2e were all clean.'
    )
  }

  return lines.join('\n')
}
