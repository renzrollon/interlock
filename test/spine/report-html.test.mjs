// The HTML surface, tested as what it is: a pure function from the report
// object to a string.
//
// Three properties carry most of the weight here, and none of them is about
// appearance:
//
//   - absence never renders as a numeral, and always carries its reason;
//   - nothing in the document resolves to a host;
//   - a corpus file name containing markup renders inert.
//
// The third is not hypothetical. File names and unreadable-file reasons are
// read off disk, so they are untrusted input on a page a person opens in a
// browser.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { renderReportHtml } from '../../lib/report-html.mjs'
import { buildReport } from '../../lib/report.mjs'
import { REVIEW_METRICS_SCHEMA } from '../../lib/metrics.mjs'

/** A root with a receipt-bearing run, an outcome and a recognized metrics file. */
function populatedRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-html-'))
  const runs = join(dir, '.claude', 'ship', 'runs')
  mkdirSync(runs, { recursive: true })
  writeFileSync(
    join(runs, 'run-a.jsonl'),
    [
      { type: 'run-start', runId: 'run-a', change: 'add-widget', mode: 'checkpoint' },
      { type: 'cli-exit', runId: 'run-a', command: 'gate', exitCode: 1 },
      { type: 'cli-exit', runId: 'run-a', command: 'gate', exitCode: 0 },
      { type: 'cli-exit', runId: 'run-a', command: 'verify judge', exitCode: 0 },
      {
        type: 'run-receipt',
        runId: 'run-a',
        change: 'add-widget',
        halted: false,
        remediationRounds: 1,
        reviewRaised: 6,
        reviewSurviving: 2,
        reviewBlockers: 0,
        reviewWarnings: 2,
        planStatus: 'reused'
      },
      { type: 'run-complete', runId: 'run-a', leftoverTaskIds: [] }
    ]
      .map(e => JSON.stringify(e))
      .join('\n') + '\n'
  )

  const learning = join(dir, '.claude', 'learning')
  mkdirSync(learning, { recursive: true })
  writeFileSync(
    join(learning, 'outcomes.jsonl'),
    JSON.stringify({ change: 'add-widget', mode: 'checkpoint' }) + '\n'
  )

  const metrics = join(dir, '.claude', 'metrics')
  mkdirSync(metrics, { recursive: true })
  writeFileSync(
    join(metrics, 'review-add-widget-20260101-000000-000Z.json'),
    JSON.stringify({
      schema: REVIEW_METRICS_SCHEMA,
      timestamp: '2026-01-01T00:00:00.000Z',
      change: 'add-widget',
      counts: { raised: 6, dismissed: 3, droppedByQuality: 1, surviving: 2 }
    })
  )
  return dir
}

function emptyRoot() {
  return mkdtempSync(join(tmpdir(), 'interlock-html-empty-'))
}

function withRoot(make, fn) {
  const dir = make()
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('a populated report renders every indicator the object carries', () => {
  withRoot(populatedRoot, dir => {
    const report = buildReport(dir)
    const doc = renderReportHtml(report)

    assert.match(doc, /^<!doctype html>/)
    assert.match(doc, /<\/html>\s*$/)

    // One row per indicator the object carries, named rather than numbered so a
    // dropped row fails here rather than shifting the count quietly.
    for (const name of [
      'First-pass ship',
      'Remediation rounds per run',
      'Runs per change',
      'Plan-reuse status',
      'Plan revised mid-run',
      'Committed diff matches plan',
      'Findings dismissed at review',
      'Findings surviving to the verdict',
      'Gate exits non-zero'
    ]) {
      assert.ok(doc.includes(name), `the document must carry the ${name} indicator`)
    }

    // Values and denominators, in the same form the text surface uses.
    const fm = report.indicators.reviewFindings.fromMetrics
    assert.ok(
      doc.includes(`${(fm.dismissalShare.value * 100).toFixed(1)}%`),
      'the dismissal share must appear at the same precision as the text surface'
    )
    assert.ok(doc.includes(`of ${fm.dismissalShare.observedOf} observed`), 'the denominator must appear')

    // The gate-exit distribution is drawn, on one shared scale from a common origin.
    assert.match(doc, /<svg[^>]*class="mark"/)
    assert.match(doc, /bars share one count scale, common origin/)
  })
})

test('the document contains no reference resolving to a host', () => {
  withRoot(populatedRoot, dir => {
    const doc = renderReportHtml(buildReport(dir))
    // Any scheme-relative or absolute URL, and the tags that would fetch one.
    assert.doesNotMatch(doc, /\b(?:https?:)?\/\/[a-z0-9.-]+/i, 'no absolute or scheme-relative URL')
    assert.doesNotMatch(doc, /<link\b/i, 'no external stylesheet, font or icon')
    assert.doesNotMatch(doc, /<script\b/i, 'no script, inline or otherwise')
    assert.doesNotMatch(doc, /<img\b|<iframe\b|@import|url\(/i, 'no fetched asset')
    assert.match(doc, /<style>/, 'styling must be inline')
  })
})

test('an unobserved indicator states its reason and never renders a numeral', () => {
  withRoot(emptyRoot, dir => {
    const report = buildReport(dir)
    const doc = renderReportHtml(report)

    assert.ok(doc.includes('UNOBSERVED'), 'absence is a word, not a blank')
    assert.ok(
      doc.includes(report.indicators.firstPassShip.rate.reason),
      'the reason the report gives must be the cell content'
    )

    // The reading cell of an unobserved indicator carries the word and its
    // reason — never a 0, a dash, or an empty cell.
    const readings = [...doc.matchAll(/<div class="ind-headline">([^<]*)<\/div>/g)].map(m => m[1])
    assert.ok(readings.length >= 9, `expected a reading per indicator, got ${readings.length}`)
    for (const reading of readings) {
      assert.ok(reading.trim(), 'no reading cell may be empty')
      assert.ok(
        reading === 'UNOBSERVED' || reading === 'NOT COMPUTABLE',
        `an empty corpus must not produce the numeral ${JSON.stringify(reading)}`
      )
    }
  })
})

test('a wholly empty corpus still yields a readable document that says so', () => {
  withRoot(emptyRoot, dir => {
    const doc = renderReportHtml(buildReport(dir))
    assert.match(doc, /Coverage — what the corpora can and cannot answer/)
    assert.ok(doc.includes('ABSENT'), 'a corpus that does not exist says so')
    assert.ok(
      doc.includes('does not exist — no ship run has recorded an outcome'),
      'and says why'
    )
    assert.ok(doc.indexOf('Coverage') < doc.indexOf('Indicators'), 'coverage precedes the indicators')
  })
})

test('coverage names its excluded files rather than counting them', () => {
  withRoot(emptyRoot, dir => {
    const metrics = join(dir, '.claude', 'metrics')
    mkdirSync(metrics, { recursive: true })
    writeFileSync(join(metrics, 'skill-written-findings.json'), JSON.stringify({ findings: [] }))

    const doc = renderReportHtml(buildReport(dir))
    assert.ok(doc.includes('skill-written-findings.json'), 'an excluded file is named')
    assert.match(doc, /Not counted, named rather than summarised/)
  })
})

test('a corpus file name carrying markup renders inert', () => {
  withRoot(emptyRoot, dir => {
    const metrics = join(dir, '.claude', 'metrics')
    mkdirSync(metrics, { recursive: true })
    // A file name is attacker-adjacent input: it comes off disk, and the report
    // names it verbatim. Angle brackets must survive as text, never as markup.
    // No "/" — that is a path separator, not a test of the renderer. The tag
    // is closed by the browser's parser either way if the escape is missing.
    const nasty = '<script>alert(1)<img src=x onerror=alert(2)>&"\'.json'
    writeFileSync(join(metrics, nasty), JSON.stringify({ schema: 'not-ours' }))

    const doc = renderReportHtml(buildReport(dir))
    assert.doesNotMatch(doc, /<script/i, 'the document must contain no script tag at all')
    assert.doesNotMatch(doc, /<img/i, 'nor an image tag smuggled in through a file name')
    assert.ok(doc.includes('&lt;script&gt;alert(1)&lt;img src=x onerror=alert(2)&gt;'), 'the name renders as text')
    assert.ok(doc.includes('&amp;&quot;&#39;.json'), 'every escapable character is escaped')
    // The schema string is untrusted for the same reason: it is parsed off disk.
    assert.ok(doc.includes('schema not-ours'))
  })
})

test('the renderer reads nothing and writes nothing', () => {
  // A hand-built object with no corpus behind it renders completely, which is
  // the whole claim of D4: the renderer cannot disagree with the other surfaces
  // because it never consults anything they consulted.
  const doc = renderReportHtml({
    schema: 'interlock.report/1',
    root: '/nowhere-at-all',
    filter: { since: null, change: null, maxRuns: 200 },
    coverage: null,
    indicators: null,
    gates: false,
    reason: 'EACCES: permission denied',
    note: 'the report could not be computed; nothing is asserted about the corpora'
  })
  assert.match(doc, /The report could not be computed/)
  assert.ok(doc.includes('EACCES: permission denied'))
  // An uncomputed report asserts nothing — not a figure, and not an absence
  // either. The two words still appear once each in the legend, which explains
  // them; what must not appear is a reading cell claiming one.
  assert.equal(
    [...doc.matchAll(/<div class="ind-headline">/g)].length,
    0,
    'nothing was measured, so nothing may be read'
  )
})

test('no threshold, target, trend or health colour is rendered', () => {
  withRoot(populatedRoot, dir => {
    const doc = renderReportHtml(buildReport(dir))

    // No trend arrow, no verdict word standing as a reading.
    assert.doesNotMatch(doc, /↑|↓|▲|▼|▴|▾/)
    const readings = [...doc.matchAll(/<div class="ind-headline">([^<]*)<\/div>/g)].map(m => m[1])
    for (const reading of readings) {
      assert.doesNotMatch(reading, /\b(?:PASS|FAIL|GOOD|BAD|HEALTHY|OK)\b/i, `reading ${reading}`)
    }

    // Marks are rectangles only. A threshold line or a target marker would have
    // to be a <line>, <circle>, <path> or <text> — the geometry the ban is
    // really about, since a rule drawn across a bar is a comparison.
    const svgs = [...doc.matchAll(/<svg[\s\S]*?<\/svg>/g)].map(m => m[0])
    assert.ok(svgs.length > 0, 'the marks must be drawn')
    for (const svg of svgs) {
      assert.doesNotMatch(svg, /<(?:line|circle|path|text|marker|polyline)\b/, svg)
    }

    // One ink for every mark: nothing is coloured by its value, so two reports
    // with wildly different figures are indistinguishable in palette.
    const fills = [...doc.matchAll(/<rect[^>]*class="([^"]+)"/g)].map(m => m[1])
    assert.ok(fills.length > 0)
    for (const cls of new Set(fills)) {
      assert.ok(
        ['fill', 'fill-soft', 'track'].includes(cls),
        `marks carry structural classes only, got ${cls}`
      )
    }
    assert.doesNotMatch(doc, /<rect[^>]*\bfill="/, 'no mark carries a literal colour')
  })
})
