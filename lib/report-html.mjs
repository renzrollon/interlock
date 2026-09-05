// The third renderer.
//
// `formatReport` renders the report object to text and `--json` emits it
// directly; this renders the same object to one self-contained HTML document.
// It is a pure function of that object — no filesystem, no corpus read, no
// indicator computed, nothing re-derived. That is not tidiness: it is what
// makes "the three surfaces cannot disagree" a test rather than an aspiration,
// since one object can be rendered to all three and the values compared.
//
// Three constraints run through every line below, and each one is a
// requirement rather than a preference:
//
// 1. **Absence renders at full weight.** An unobserved indicator gets the same
//    type, size and position as one carrying a number, and its reason is the
//    cell's content. Every dashboard idiom — the grey cell, the dash, the zero,
//    the collapsed row — translates "we never measured this" into "this
//    measured zero". On these corpora that mistranslation would be near-total.
// 2. **The document issues no verdict.** No threshold, target, goal line, trend
//    arrow, pass/fail label, or colour that encodes health. Colour and weight
//    carry structure and reading order only, so two reports with wildly
//    different figures are indistinguishable in palette.
// 3. **Everything is inline.** No stylesheet, script, font, image or data
//    source is fetched, so the document renders with no network and can be
//    attached to an issue or handed to someone without the repo.
//
// Corpus content is untrusted input: a metrics file name and an unreadable
// file's reason both come off disk. Every interpolated value therefore passes
// through the `html` tagged template below, which escapes unless a fragment is
// explicitly marked `raw`. There is no second interpolation path.

// The one thing this renderer imports: the wording of an absence it shares with
// the text surface. Two surfaces describing the same absence in different words
// is how a reader comes to believe they are looking at two different facts.
import { NO_EVAL_RESULT } from './report.mjs'

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

const RAW = Symbol('raw html')

/**
 * Mark an already-rendered fragment so the template does not escape it again.
 *
 * It carries a `toString` so that concatenating a marked fragment with `+`
 * yields its markup rather than `[object Object]`. Without it the two ways of
 * assembling a fragment — interpolation and concatenation — would disagree, and
 * the failure mode is a silently mangled document rather than an error.
 */
function raw(value) {
  const markup = String(value)
  return { [RAW]: markup, toString: () => markup }
}

/** The one escape. Everything interpolated reaches the document through here. */
function escape(value) {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(escape).join('')
  if (typeof value === 'object' && RAW in value) return value[RAW]
  return String(value).replace(/[&<>"']/g, c => ESCAPES[c])
}

/** Tagged template that escapes every interpolation. `raw()` opts a fragment out. */
function html(strings, ...values) {
  let out = strings[0]
  for (let i = 0; i < values.length; i += 1) out += escape(values[i]) + strings[i + 1]
  return out
}

// ---------------------------------------------------------------------------
// Readings
// ---------------------------------------------------------------------------

// A reading is a headline and a basis. The headline is a numeral or one of two
// words; the basis is either the denominator or the reason there is none. The
// two absence words are typed exactly like a numeral — same face, same size,
// same weight — which is requirement 1 above expressed in markup.

const UNOBSERVED = 'UNOBSERVED'
const NOT_COMPUTABLE = 'NOT COMPUTABLE'

function basisOf(ind) {
  return `of ${ind.observedOf} observed` + (ind.notObserved ? `, ${ind.notObserved} not observed` : '')
}

/** A share, formatted exactly as the text surface formats it. */
function pctReading(ind) {
  if (!ind || ind.value === null) {
    return { headline: UNOBSERVED, basis: ind ? ind.reason : 'no indicator' }
  }
  return { headline: `${(ind.value * 100).toFixed(1)}%`, basis: basisOf(ind) }
}

/** A bare number, formatted exactly as the text surface formats it. */
function plainReading(ind) {
  if (!ind || ind.value === null) {
    return { headline: UNOBSERVED, basis: ind ? ind.reason : 'no indicator' }
  }
  return { headline: String(ind.value), basis: basisOf(ind) }
}

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

const MARK_WIDTH = 260
const MARK_HEIGHT = 9

/**
 * A part-of-whole mark for a coverage proportion. The denominator is printed
 * beside it in every case, so the bar is read against a stated whole rather
 * than against an implied target — and the track is drawn at the same weight
 * whatever the fill, so a low proportion is not styled as a deficiency.
 */
function proportionMark(numerator, denominator) {
  const n = Number(numerator) || 0
  const d = Number(denominator) || 0
  const width = d > 0 ? Math.max(0, Math.min(1, n / d)) * MARK_WIDTH : 0
  return raw(
    html`<svg class="mark" width="${MARK_WIDTH}" height="${MARK_HEIGHT}" viewBox="0 0 ${MARK_WIDTH} ${MARK_HEIGHT}" role="presentation" aria-hidden="true">` +
      html`<rect x="0" y="0" width="${MARK_WIDTH}" height="${MARK_HEIGHT}" class="track"/>` +
      (width > 0 ? html`<rect x="0" y="0" width="${width}" height="${MARK_HEIGHT}" class="fill"/>` : '') +
      '</svg>'
  )
}

/**
 * The gate-exit distribution: one row per command, two bars on ONE shared count
 * scale from a common origin, so a bar's length reads as a count and never as
 * progress toward a full width. The scale is the largest count present; no
 * axis, no threshold line, no marker.
 */
function exitDistribution(commands) {
  const rows = commands.filter(c => c && Number(c.exits) >= 0)
  if (!rows.length) return ''
  const scale = rows.reduce((max, c) => Math.max(max, Number(c.exits) || 0), 0)
  if (!scale) return ''

  const barWidth = count => (Math.max(0, Number(count) || 0) / scale) * MARK_WIDTH
  const body = rows
    .map(
      c =>
        html`<div class="dist-row"><div class="dist-name">${c.command}</div>` +
        html`<div class="dist-marks">` +
        html`<svg class="mark" width="${MARK_WIDTH}" height="20" viewBox="0 0 ${MARK_WIDTH} 20" role="presentation" aria-hidden="true">` +
        html`<rect x="0" y="0" width="${barWidth(c.exits)}" height="8" class="fill-soft"/>` +
        html`<rect x="0" y="11" width="${barWidth(c.nonZero)}" height="8" class="fill"/>` +
        html`</svg></div>` +
        html`<div class="dist-figures"><span>${c.nonZero}</span> of <span>${c.exits}</span> non-zero</div></div>`
    )
    .join('')

  return (
    html`<div class="dist"><div class="dist-legend">bars share one count scale, common origin — upper: exits recorded, lower: exits non-zero. Largest count drawn is ${scale}.</div>` +
    body +
    '</div>'
  )
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/**
 * The fourth corpus's coverage block.
 *
 * Rendered even when it is excluded or absent, and it says which: a corpus that
 * silently vanished from a filtered page would be indistinguishable from one
 * holding nothing.
 */
function evalHistoryCorpus(e) {
  if (!e) return ''
  const count = e.excluded
    ? raw('<span class="word">EXCLUDED</span>')
    : e.exists
      ? raw(html`<span class="num">${e.records}</span> result(s)`)
      : raw('<span class="word">ABSENT</span>')

  const notes = []
  if (e.excluded && e.reason) notes.push(e.reason)
  if (!e.excluded && !e.exists) notes.push(`${e.path} does not exist — no outcome eval has recorded a result`)
  if (!e.excluded && e.reason) notes.push(`unreadable — ${e.reason}`)
  if (e.filteredOut) notes.push(`${e.filteredOut} outside the filter`)
  if (e.skippedLines) notes.push(`${e.skippedLines} unreadable line(s) skipped`)
  for (const u of e.unrecognized || []) {
    notes.push(`line ${u.line} not counted${u.schema ? ` (schema ${u.schema})` : ' (no schema key)'}`)
  }

  return (
    html`<div class="corpus"><div class="corpus-head"><h3>Outcome-eval results</h3>
      <div class="corpus-count">${count}</div></div>
      <p class="reason">Fixture runs, not real work. Nothing here is counted in any figure above.</p>` +
    (notes.length
      ? html`<ul class="named">${raw(notes.map(n => html`<li>${n}</li>`).join(''))}</ul>`
      : '') +
    '</div>'
  )
}

function coverageSection(coverage) {
  const { trajectories: t, outcomes: o, metrics: m } = coverage

  const trajectoryNotes = []
  if (t.truncated) trajectoryNotes.push(`scan capped — ${t.notScanned} not read`)
  if (t.filteredOut) trajectoryNotes.push(`${t.filteredOut} outside the filter`)
  if (t.skippedLines) trajectoryNotes.push(`${t.skippedLines} torn line(s) skipped`)
  if (t.reason) trajectoryNotes.push(t.reason)

  const outcomeModes = Object.keys(o.byMode || {}).sort()

  return html`<section class="block"><h2>Coverage — what the corpora can and cannot answer</h2>
    <p class="lede">Every figure in the next section rests on what is scanned here. A corpus that holds
    nothing is reported as holding nothing; it is never reported as a zero.</p>` +
    // --- trajectories
    html`<div class="corpus"><div class="corpus-head"><h3>Run trajectories</h3>
      <div class="corpus-count"><span class="num">${t.scanned}</span> scanned of <span class="num">${t.total}</span> on disk</div></div>
      ${proportionMark(t.scanned, t.total)}
      <dl class="facets">
        <div><dt>with run-start</dt><dd class="num">${t.withRunStart}</dd></div>
        <div><dt>with terminal</dt><dd class="num">${t.withTerminal}</dd><dd class="aside">run-complete or run-halt</dd></div>
        <div><dt>with receipt</dt><dd class="num">${t.withReceipt}</dd><dd class="aside">every receipt-derived indicator rests on this</dd></div>
      </dl>` +
    (trajectoryNotes.length
      ? html`<ul class="named">${raw(trajectoryNotes.map(n => html`<li>${n}</li>`).join(''))}</ul>`
      : '') +
    (t.unreadable && t.unreadable.length
      ? html`<div class="named-head">Unreadable, named rather than counted</div><ul class="named">` +
        raw(t.unreadable.map(u => html`<li><span class="file">${u.runId}</span> — ${u.reason}</li>`).join('')) +
        '</ul>'
      : '') +
    '</div>' +
    // --- outcomes
    html`<div class="corpus"><div class="corpus-head"><h3>Outcome records</h3>
      <div class="corpus-count">${o.exists ? raw(html`<span class="num">${o.records}</span> record(s)`) : raw('<span class="word">ABSENT</span>')}</div></div>` +
    (o.exists
      ? html`<dl class="facets">${raw(
          outcomeModes.map(k => html`<div><dt>${k}</dt><dd class="num">${o.byMode[k]}</dd></div>`).join('')
        )}</dl>`
      : html`<p class="reason">${o.path} does not exist — no ship run has recorded an outcome</p>`) +
    (o.filteredOut ? html`<ul class="named"><li>${o.filteredOut} outside the filter</li></ul>` : '') +
    (o.skippedLines ? html`<ul class="named"><li>${o.skippedLines} unreadable line(s) skipped</li></ul>` : '') +
    '</div>' +
    // --- review metrics
    html`<div class="corpus"><div class="corpus-head"><h3>Review metrics</h3>
      <div class="corpus-count"><span class="num">${m.recognized}</span> recognized of <span class="num">${m.total}</span> file(s)</div></div>
      ${proportionMark(m.recognized, m.total)}` +
    (m.filteredOut ? html`<ul class="named"><li>${m.filteredOut} outside the filter</li></ul>` : '') +
    (m.unrecognized && m.unrecognized.length
      ? html`<div class="named-head">Not counted, named rather than summarised</div><ul class="named">` +
        raw(
          m.unrecognized
            .map(
              u =>
                html`<li><span class="file">${u.file}</span> — ${
                  u.schema ? `schema ${u.schema}` : 'no schema key'
                }</li>`
            )
            .join('')
        ) +
        '</ul>'
      : '') +
    (m.unreadable && m.unreadable.length
      ? html`<div class="named-head">Unreadable, named rather than counted</div><ul class="named">` +
        raw(m.unreadable.map(u => html`<li><span class="file">${u.file}</span> — ${u.reason}</li>`).join('')) +
        '</ul>'
      : '') +
    '</div>' +
    evalHistoryCorpus(coverage.evalHistory) +
    '</section>'
}

/** One indicator row. `detail` is pre-rendered markup or ''. */
function row(no, name, definition, reading, detail) {
  return html`<div class="ind"><div class="ind-no">${no}</div>
    <div class="ind-name"><div class="ind-title">${name}</div><div class="ind-def">${definition}</div></div>
    <div class="ind-reading"><div class="ind-headline">${reading.headline}</div><div class="ind-basis">${reading.basis}</div></div>
    <div class="ind-detail">${raw(detail || '')}</div></div>`
}

function breakdown(entries) {
  if (!entries.length) return ''
  return html`<div class="breakdown">${raw(
    entries.map(e => html`<div><span class="bk-label">${e.label}</span><span class="bk-value num">${e.value}</span></div>`).join('')
  )}</div>`
}

function indicatorsSection(indicators) {
  const i = indicators
  const rows = []

  rows.push(
    row(
      '01',
      'First-pass ship',
      'Runs that reached a receipt with no halt and no remediation round, over the runs whose receipt observed both.',
      pctReading(i.firstPassShip.rate),
      html`<p class="finding">${i.firstPassShip.note}</p>`
    )
  )

  const dist = Object.keys(i.rework.remediationRounds.distribution || {}).sort()
  rows.push(
    row(
      '02',
      'Remediation rounds per run',
      'The mean number of remediation rounds a run recorded on its receipt.',
      plainReading(i.rework.remediationRounds),
      dist.length
        ? breakdown(dist.map(k => ({ label: `${k} round(s)`, value: i.rework.remediationRounds.distribution[k] })))
        : ''
    )
  )

  const changes = i.rework.attemptsPerChange.changes || []
  rows.push(
    row(
      '03',
      'Runs per change',
      'How many runs each named change took. Runs the corpus could not attribute are excluded and reported separately.',
      plainReading(i.rework.attemptsPerChange),
      (i.rework.attemptsPerChange.unattributed
        ? html`<p class="finding">${i.rework.attemptsPerChange.unattributed} run(s) unattributed and excluded from this figure.</p>`
        : '') + breakdown(changes.map(c => ({ label: c.change, value: `${c.runs} run(s)` })))
    )
  )

  const statuses = Object.keys(i.planFidelity.planStatus.counts || {}).sort()
  rows.push(
    row(
      '04',
      'Plan-reuse status',
      'Whether a run reused a stored wave plan, over the runs that recorded a status.',
      statuses.length
        ? { headline: String(statuses.reduce((n, s) => n + i.planFidelity.planStatus.counts[s], 0)), basis: 'run(s) recorded a status' }
        : { headline: UNOBSERVED, basis: i.planFidelity.planStatus.reason },
      statuses.length
        ? breakdown(statuses.map(s => ({ label: s, value: i.planFidelity.planStatus.counts[s] })))
        : ''
    )
  )

  rows.push(
    row(
      '05',
      'Plan revised mid-run',
      'Runs that recorded a wave action changing the plan after the run began.',
      pctReading(i.planFidelity.midRunRevision),
      ''
    )
  )

  rows.push(
    row(
      '06',
      'Committed diff matches plan',
      'The share of paths a run committed that its executed plan predicted. The touched set is the denominator.',
      pctReading(i.planFidelity.diffMatchesPlan),
      breakdown([
        { label: 'qualifying run(s)', value: i.planFidelity.diffMatchesPlan.runs },
        { label: 'touched path(s) predicted', value: i.planFidelity.diffMatchesPlan.paths.matched },
        { label: 'touched path(s)', value: i.planFidelity.diffMatchesPlan.paths.touched },
        // Every exclusion is shown, zero included: a reason absent from the list
        // and a reason that excluded nobody would otherwise read the same.
        ...Object.keys(i.planFidelity.diffMatchesPlan.excluded).map(key => ({
          label: `excluded — ${i.planFidelity.diffMatchesPlan.exclusionReasons[key]}`,
          value: i.planFidelity.diffMatchesPlan.excluded[key]
        }))
      ])
    )
  )

  const fm = i.reviewFindings.fromMetrics
  rows.push(
    row(
      '07',
      'Findings dismissed at review',
      'Findings the skeptics verified away, over the findings raised — from the recognized review-metrics files.',
      pctReading(fm.dismissalShare),
      breakdown([
        { label: 'metrics file(s) read', value: fm.files },
        { label: 'raised', value: fm.counts.raised },
        { label: 'dismissed', value: fm.counts.dismissed },
        { label: 'dropped by quality', value: fm.counts.droppedByQuality },
        { label: 'surviving', value: fm.counts.surviving }
      ])
    )
  )

  const fr = i.reviewFindings.fromReceipts
  rows.push(
    row(
      '08',
      'Findings surviving to the verdict',
      'Findings that survived review, over the findings raised — from run receipts.',
      pctReading(fr.survivalShare),
      breakdown([
        { label: 'receipt(s) read', value: fr.runs },
        { label: 'raised', value: fr.counts.raised },
        { label: 'surviving', value: fr.counts.surviving },
        { label: 'blocker(s)', value: fr.counts.blockers },
        { label: 'warning(s)', value: fr.counts.warnings }
      ]) + html`<p class="finding">The two series above are never summed — different writers, different runs.</p>`
    )
  )

  const g = i.gateExitHealth
  rows.push(
    row(
      '09',
      'Gate exits non-zero',
      'Command exits the trajectory recorded as non-zero, over the exits it recorded.',
      pctReading(g.nonZeroShare),
      exitDistribution(g.commands || [])
    )
  )

  // The outcome-eval rows come last and are numbered on from the real-run
  // indicators rather than interleaved with them, so a reader cannot pick up a
  // fixture figure believing it says something about real work. One row per arm,
  // each with its own denominator.
  const s = i.shipOutcomeEval
  if (s) {
    if (s.excluded) {
      rows.push(
        row(
          '10',
          'Outcome evals (fixtures)',
          'Criteria met over criteria applicable, from the committed outcome-eval history.',
          { headline: UNOBSERVED, basis: s.reason },
          ''
        )
      )
    } else {
      const arms = Object.keys(s.byArm).sort()
      if (!arms.length) {
        rows.push(
          row(
            '10',
            'Outcome evals (fixtures)',
            'Criteria met over criteria applicable, from the committed outcome-eval history.',
            { headline: UNOBSERVED, basis: NO_EVAL_RESULT },
            ''
          )
        )
      }
      arms.forEach((arm, index) => {
        const a = s.byArm[arm]
        rows.push(
          row(
            String(10 + index).padStart(2, '0'),
            `Outcome evals — ${arm} arm`,
            'Criteria met over criteria applicable, from the committed outcome-eval history. Fixture runs, never real runs.',
            pctReading(a.criteriaMet),
            breakdown([
              { label: 'result(s) recorded', value: a.rows },
              { label: 'not applicable to this arm', value: a.notApplicable },
              { label: 'unobserved, counted as not met', value: a.unobserved }
            ]) + html`<p class="finding">${s.note}</p>`
          )
        )
      })
    }
  }

  return html`<section class="block"><h2>Indicators</h2>
    <div class="ind-head"><div></div><div>Indicator</div><div>Reading</div><div>Detail</div></div>
    ${raw(rows.join(''))}</section>`
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

const STYLE = `
:root {
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --sans: system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
  --ground: #e6eeea; --panel: #f4f9f6; --ink: #0e1c17; --ink2: #4d6a5d;
  --rule: rgba(14,28,23,0.22); --hair: rgba(14,28,23,0.11); --mark: #0e7a56;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ground: #08110e; --panel: #0c1613; --ink: #e4efe9; --ink2: #8aa89a;
    --rule: rgba(228,239,233,0.20); --hair: rgba(228,239,233,0.10); --mark: #34d399;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--ground); color: var(--ink); font-family: var(--sans);
  font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
.sheet { max-width: 1180px; margin: 0 auto; background: var(--panel); padding: 44px 52px 38px; }
.num, .word { font-family: var(--mono); font-variant-numeric: tabular-nums; }
h1 { font-size: 34px; font-weight: 500; letter-spacing: -0.02em; margin: 8px 0 0; }
h2 { font-family: var(--mono); font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--ink2); font-weight: 400; margin: 0 0 12px; }
h3 { font-size: 15px; font-weight: 500; margin: 0; }
.kicker { font-family: var(--mono); font-size: 11px; letter-spacing: 0.18em;
  text-transform: uppercase; color: var(--ink2); }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 48px;
  flex-wrap: wrap; }
.meta { display: grid; grid-template-columns: auto auto; gap: 3px 18px; font-family: var(--mono);
  font-size: 11px; line-height: 1.5; padding-top: 6px; }
.meta .k { color: var(--ink2); }
.rule { height: 1px; background: var(--rule); margin: 24px 0 20px; border: 0; }
.intro { display: grid; grid-template-columns: 1fr 1fr; gap: 44px; }
@media (max-width: 820px) { .intro { grid-template-columns: 1fr; } }
.intro p { margin: 0; max-width: 54ch; }
.legend { display: grid; gap: 6px; font-size: 12.5px; }
.legend > div { display: grid; grid-template-columns: 132px 1fr; gap: 14px; }
.legend .word { font-size: 11px; }
.legend span:last-child { color: var(--ink2); }
.block { margin-top: 34px; }
.lede { color: var(--ink2); max-width: 74ch; margin: 0 0 20px; }
.corpus { padding: 14px 0; border-top: 1px solid var(--hair); }
.corpus-head { display: flex; justify-content: space-between; align-items: baseline; gap: 24px; }
.corpus-count { font-family: var(--mono); font-size: 12px; color: var(--ink2);
  font-variant-numeric: tabular-nums; }
.corpus-count .num { font-size: 15px; color: var(--ink); }
.facets { display: flex; flex-wrap: wrap; gap: 8px 34px; margin: 10px 0 0; }
.facets > div { display: flex; align-items: baseline; gap: 8px; }
.facets dt { font-size: 12.5px; color: var(--ink2); }
.facets dd { margin: 0; font-size: 14px; }
.facets .aside { font-size: 12px; color: var(--ink2); font-family: var(--sans); }
.named-head { font-family: var(--mono); font-size: 10px; letter-spacing: 0.13em;
  text-transform: uppercase; color: var(--ink2); margin-top: 12px; }
.named { list-style: none; margin: 6px 0 0; padding: 0; font-size: 12.5px; color: var(--ink2); }
.named li { padding: 2px 0; overflow-wrap: anywhere; }
.named .file { font-family: var(--mono); font-size: 11.5px; color: var(--ink); }
.reason { margin: 8px 0 0; font-size: 13px; color: var(--ink2); max-width: 78ch; }
.mark { display: block; margin: 12px 0 2px; max-width: 100%; }
.track { fill: var(--hair); }
.fill { fill: var(--mark); }
.fill-soft { fill: var(--rule); }
.ind-head, .ind { display: grid; grid-template-columns: 30px 264px 214px 1fr; gap: 24px; }
@media (max-width: 940px) { .ind-head { display: none; } .ind { grid-template-columns: 1fr; } }
.ind-head { padding: 9px 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.13em;
  text-transform: uppercase; color: var(--ink2); border-bottom: 1px solid var(--rule); }
.ind { padding: 15px 0; border-bottom: 1px solid var(--hair); }
.ind-no { font-family: var(--mono); font-size: 11px; color: var(--ink2); padding-top: 6px; }
.ind-title { font-size: 14.5px; font-weight: 500; }
.ind-def { font-size: 12.5px; color: var(--ink2); margin-top: 4px; }
.ind-headline { font-family: var(--mono); font-size: 20px; font-weight: 500; line-height: 1.2;
  font-variant-numeric: tabular-nums; }
.ind-basis { font-family: var(--mono); font-size: 10.5px; color: var(--ink2); margin-top: 6px;
  line-height: 1.5; overflow-wrap: anywhere; }
.finding { font-size: 13px; line-height: 1.55; max-width: 64ch; margin: 0 0 8px; }
.breakdown { display: grid; gap: 2px; }
.breakdown > div { display: grid; grid-template-columns: 1fr 96px; gap: 14px; }
.bk-label { font-size: 13px; }
.bk-value { font-size: 13px; text-align: right; }
.requires { display: grid; grid-template-columns: 104px 1fr; gap: 12px; margin-top: 9px;
  font-size: 12.5px; max-width: 72ch; }
.requires-label { font-family: var(--mono); font-size: 10px; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--ink2); }
.dist { display: grid; gap: 8px; }
.dist-legend { font-size: 11.5px; color: var(--ink2); max-width: 62ch; }
.dist-row { display: grid; grid-template-columns: 1fr; gap: 2px; }
.dist-name { font-family: var(--mono); font-size: 12px; overflow-wrap: anywhere; }
.dist-figures { font-family: var(--mono); font-size: 11px; color: var(--ink2);
  font-variant-numeric: tabular-nums; }
.dist-figures span { color: var(--ink); }
.foot { display: flex; justify-content: space-between; gap: 32px; flex-wrap: wrap; margin-top: 24px;
  font-family: var(--mono); font-size: 11px; color: var(--ink2); }
`

/**
 * Render a `buildReport()` result to one self-contained HTML document.
 *
 * Pure: no I/O, no corpus read, no indicator computed or re-derived. Every
 * figure comes off the object exactly as the text and machine-readable surfaces
 * take it.
 *
 * @param {object} report a `buildReport()` result
 * @returns {string} a complete HTML document
 */
export function renderReportHtml(report) {
  const r = report && typeof report === 'object' ? report : {}
  const filter = r.filter || {}
  const filterBits = []
  if (filter.since) filterBits.push(`since ${filter.since}`)
  if (filter.change) filterBits.push(`change ${filter.change}`)

  const body = r.coverage
    ? coverageSection(r.coverage) + (r.indicators ? indicatorsSection(r.indicators) : '')
    : html`<section class="block"><h2>The report could not be computed</h2>
        <p class="reason">${r.reason || 'unknown'}</p>
        <p class="lede">Nothing is asserted about the corpora. No indicator below is rendered as a
        zero, because none was measured.</p></section>`

  return (
    '<!doctype html>\n' +
    html`<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Interlock report</title>
<style>${raw(STYLE)}</style>
</head>
<body><main class="sheet">
<div class="head">
  <div><div class="kicker">Interlock · instrument readout</div><h1>Interlock Report</h1></div>
  <div class="meta">
    <span class="k">ROOT</span><span>${r.root || '.'}</span>
    <span class="k">SCHEMA</span><span>${r.schema || 'unknown'}</span>
    <span class="k">SCAN CAP</span><span>${filter.maxRuns === undefined ? 'unstated' : filter.maxRuns} run(s)</span>
    <span class="k">FILTER</span><span>${filterBits.length ? filterBits.join(', ') : 'none'}</span>
    <span class="k">GATES</span><span>off — reports only</span>
  </div>
</div>
<hr class="rule">
<div class="intro">
  <p>This page reports what the scanned corpora record about one development loop. It does not
  evaluate the loop, compare it to a target, or issue a verdict. No threshold is applied to any
  figure below.</p>
  <div class="legend">
    <div><span class="word">${UNOBSERVED}</span><span>The corpus was read and holds no events of this kind.</span></div>
    <div><span class="word">${NOT_COMPUTABLE}</span><span>No scanned corpus records the quantity; it cannot be derived from what exists.</span></div>
    <div><span></span><span>Both are findings, recorded at the same standing as a measured value.</span></div>
  </div>
</div>
${raw(body)}
<div class="foot"><span>${r.note || 'reports only'}</span><span>Exit status is always 0.</span></div>
</main></body></html>
`
  )
}

export default renderReportHtml
