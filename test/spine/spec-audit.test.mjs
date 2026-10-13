// The spec audit — what a reviewer can rely on a living spec to say.
//
// The module is pure over gathered inputs, so every count here is checked
// against a fixture corpus whose numbers are known by construction
// (test/fixtures/spec-audit/, three capabilities), and the repository's own
// committed `openspec/specs/` is pinned only on the invariants it holds today.
// Never on counts: every archive moves them, and a pin on a count teaches its
// readers to edit the number. design D5 of judge-against-base-and-living-specs.
//
// Input:  { specs: [{ path, text } | { path, error }], edges, graphReason,
//           broken, graphFiles }
// Output: { absent, reason, coverage: { specs, corpus }, unreadable,
//           capabilities: [{ capability, path, purpose, requirements,
//             nonNormative, scenarios, missingGiven, missingWhen, missingThen,
//             failure, edgeCase, unclassified, boundLines, numericLiterals,
//             flags, links }], totals, graph }

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditSpecs, formatSpecAudit } from '../../lib/spec-audit.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const FIXTURE = join(HERE, '..', 'fixtures', 'spec-audit')

/** Every `spec.md` under `<root>/openspec/specs`, as `{ path, text }`, sorted. */
function gather(root) {
  const base = join(root, 'openspec', 'specs')
  const out = []
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === 'spec.md') {
        out.push({ path: relative(root, p).split('\\').join('/'), text: readFileSync(p, 'utf8') })
      }
    }
  }
  walk(base)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

const BOUNDED = 'openspec/specs/widgets/bounded/spec.md'
const PLAIN = 'openspec/specs/widgets/plain/spec.md'
const GADGETS = 'openspec/specs/gadgets/spec.md'

const link = (spec, file) => ({
  source: `openspec:${spec}`,
  target: `file:${file}`,
  relation: 'implements_spec',
  confidence: 'INFERRED',
  source_file: spec,
  weight: 1
})

/** The fixture's graph: two files named by `bounded` (one since deleted), one by `gadgets`. */
const FIXTURE_GRAPH = {
  edges: [link(BOUNDED, 'lib/a.mjs'), link(BOUNDED, 'lib/b.mjs'), link(GADGETS, 'lib/c.mjs')],
  broken: [{ spec: BOUNDED, file: 'lib/b.mjs' }],
  graphFiles: ['lib/a.mjs', 'lib/b.mjs', 'lib/c.mjs', 'lib/d.mjs', 'lib/e.mjs']
}

const audit = (extra = {}) => auditSpecs({ specs: gather(FIXTURE), graphReason: null, ...FIXTURE_GRAPH, ...extra })
const cap = (report, name) => report.capabilities.find(c => c.capability === name)

// --- a fixture corpus reproduces its stated counts ---------------------------

test('the fixture corpus is three capabilities, sorted by name', () => {
  const report = audit()
  assert.deepEqual(
    report.capabilities.map(c => c.capability),
    ['gadgets', 'widgets/bounded', 'widgets/plain']
  )
  assert.equal(report.absent, false)
  assert.deepEqual(report.coverage, { specs: 3, corpus: 3 })
  assert.deepEqual(report.unreadable, [])
})

test('widgets/bounded: every per-capability count equals the known value', () => {
  const c = cap(audit(), 'widgets/bounded')
  assert.equal(c.path, BOUNDED)
  assert.equal(c.purpose, true)
  assert.equal(c.requirements, 2)
  assert.deepEqual(c.nonNormative, [])
  assert.equal(c.scenarios, 4)
  assert.equal(c.missingGiven, 1)
  assert.equal(c.missingWhen, 0)
  assert.equal(c.missingThen, 0)
  assert.equal(c.failure, 1)
  assert.equal(c.edgeCase, 1)
  assert.equal(c.unclassified, 0)
  assert.equal(c.boundLines, 3)
  assert.deepEqual(c.flags, [])
})

test('widgets/plain: every per-capability count equals the known value', () => {
  const c = cap(audit(), 'widgets/plain')
  assert.equal(c.requirements, 2)
  assert.deepEqual(c.nonNormative, ['Widgets are shown'])
  assert.equal(c.scenarios, 3)
  assert.equal(c.missingGiven, 1)
  assert.equal(c.missingWhen, 0)
  assert.equal(c.missingThen, 1)
  assert.equal(c.failure, 0)
  assert.equal(c.edgeCase, 0)
  // `Rendering` begins with neither Failure, Edge case nor Happy path.
  assert.equal(c.unclassified, 1)
  assert.equal(c.boundLines, 0)
  assert.deepEqual(c.numericLiterals, [])
})

test('gadgets: every per-capability count equals the known value', () => {
  const c = cap(audit(), 'gadgets')
  assert.equal(c.requirements, 1)
  assert.deepEqual(c.nonNormative, [])
  assert.equal(c.scenarios, 2)
  assert.equal(c.missingGiven, 0)
  assert.equal(c.missingWhen, 0)
  assert.equal(c.missingThen, 0)
  assert.equal(c.failure, 1)
  assert.equal(c.edgeCase, 0)
  assert.equal(c.unclassified, 0)
  assert.equal(c.boundLines, 2)
})

test('the repository-wide totals equal the known values', () => {
  const t = audit().totals
  assert.equal(t.specs, 3)
  assert.equal(t.requirements, 5)
  assert.equal(t.nonNormative, 1)
  assert.equal(t.scenarios, 9)
  assert.equal(t.missingGiven, 2)
  assert.equal(t.missingWhen, 0)
  assert.equal(t.missingThen, 1)
  assert.equal(t.failure, 2)
  assert.equal(t.edgeCase, 1)
  assert.equal(t.unclassified, 1)
  assert.equal(t.boundLines, 5)
  assert.equal(t.numericLiterals, 3)
})

test('each numeric literal is listed with its spec, line and value', () => {
  const report = audit()
  assert.deepEqual(cap(report, 'widgets/bounded').numericLiterals, [
    { spec: BOUNDED, line: 11, value: 8 },
    { spec: BOUNDED, line: 34, value: 3 }
  ])
  assert.deepEqual(cap(report, 'gadgets').numericLiterals, [{ spec: GADGETS, line: 12, value: 250 }])
})

test('the link measures count the files each capability names and the ones gone', () => {
  const report = audit()
  assert.deepEqual(cap(report, 'widgets/bounded').links, { files: 2, missing: ['lib/b.mjs'] })
  assert.deepEqual(cap(report, 'widgets/plain').links, { files: 0, missing: [] })
  assert.deepEqual(cap(report, 'gadgets').links, { files: 1, missing: [] })
})

test('the coverable source no living spec names is a count, a share and a list', () => {
  const { graph } = audit()
  assert.equal(graph.available, true)
  assert.equal(graph.reason, null)
  // a, b and c are named; d and e are not. A deleted file is still a named one.
  assert.deepEqual(graph.unspecified, { count: 2, total: 5, percent: 40, files: ['lib/d.mjs', 'lib/e.mjs'] })
})

// --- flags -------------------------------------------------------------------

test('a capability with no bound, no failure scenario and no edge case carries all three flags', () => {
  assert.deepEqual(cap(audit(), 'widgets/plain').flags, ['no-bound', 'no-failure-scenario', 'no-edge-case'])
})

test('a capability with a bound line and a Failure scenario carries neither of the first two flags', () => {
  const flags = cap(audit(), 'gadgets').flags
  assert.ok(!flags.includes('no-bound'))
  assert.ok(!flags.includes('no-failure-scenario'))
  assert.deepEqual(flags, ['no-edge-case'])
})

test('a capability with all three carries no flag', () => {
  assert.deepEqual(cap(audit(), 'widgets/bounded').flags, [])
})

test('missing GIVEN is a count, never a flag', () => {
  const c = cap(audit(), 'widgets/bounded')
  assert.equal(c.missingGiven, 1)
  assert.ok(!c.flags.some(f => /given/i.test(f)))
})

// --- counting rules at their boundaries --------------------------------------

/** One-requirement spec around `body`, for probing a single counting rule. */
function probe(body, scenarios = '') {
  const text = `# x Specification\n\n## Purpose\n\nA probe.\n\n## Requirements\n\n### Requirement: Probe SHALL hold\n\n${body}\n${scenarios}`
  return cap(auditSpecs({ specs: [{ path: 'openspec/specs/x/spec.md', text }], edges: null, graphReason: 'none' }), 'x')
}

test('nevertheless is not a bound line, while a lower-case shall not is', () => {
  const none = probe('The switch nevertheless stays reachable.')
  assert.equal(none.boundLines, 0)

  const lower = probe('Body.', '#### Scenario: Failure — x\n\n- **WHEN** a\n- **THEN** the console shall not hide it\n')
  assert.equal(lower.boundLines, 1)
})

test('never as a word is a bound line, whatever its case', () => {
  assert.equal(probe('It must never happen.').boundLines, 1)
  assert.equal(probe('Never again.').boundLines, 1)
})

test('every bound term counts, once per line', () => {
  const body = [
    'It SHALL NOT x.',
    'It MUST NOT y.',
    'There is at most one.',
    'There is at least one.',
    'It runs exactly once.',
    'Both SHALL NOT and MUST NOT sit on this one line.'
  ].join('\n')
  assert.equal(probe(body).boundLines, 6)
})

test('a number inside inline code is not a numeric literal', () => {
  assert.deepEqual(probe('The code `retry(3)` is quoted here.').numericLiterals, [])
})

test('a number in a scenario body is not a numeric literal', () => {
  const c = probe('Body.', '#### Scenario: Happy path — x\n\n- **WHEN** it reads 42 rows\n- **THEN** it ends\n')
  assert.deepEqual(c.numericLiterals, [])
})

test('a number welded to a word is not a standalone number', () => {
  assert.deepEqual(probe('Labels are utf8 text.').numericLiterals, [])
})

test('a standalone number in requirement prose is listed with its line and value', () => {
  const c = probe('Line one.\nIt waits 30 seconds.')
  assert.equal(c.numericLiterals.length, 1)
  assert.equal(c.numericLiterals[0].value, 30)
  assert.equal(c.numericLiterals[0].spec, 'openspec/specs/x/spec.md')
  // `# x` is line 1; the prose starts on line 11, so the number is on 12.
  assert.equal(c.numericLiterals[0].line, 12)
})

test('scenario titles are classified case-insensitively', () => {
  const c = probe(
    'Body.',
    [
      '#### Scenario: FAILURE — loud',
      '',
      '- **WHEN** a',
      '- **THEN** b',
      '',
      '#### Scenario: edge case — quiet',
      '',
      '- **WHEN** a',
      '- **THEN** b',
      '',
      '#### Scenario: happy path — fine',
      '',
      '- **WHEN** a',
      '- **THEN** b',
      ''
    ].join('\n')
  )
  assert.equal(c.failure, 1)
  assert.equal(c.edgeCase, 1)
  assert.equal(c.unclassified, 0)
})

test('a requirement with neither SHALL nor MUST in heading or prose is named', () => {
  const c = probe('Plain description of how it goes.')
  // The heading says SHALL, so it passes; strip it to see the other side.
  assert.deepEqual(c.nonNormative, [])
  const text =
    '# y Specification\n\n## Purpose\n\nP.\n\n## Requirements\n\n### Requirement: Probe holds\n\nPlain description.\n'
  const y = auditSpecs({ specs: [{ path: 'openspec/specs/y/spec.md', text }], edges: null, graphReason: 'none' })
  assert.deepEqual(cap(y, 'y').nonNormative, ['Probe holds'])
})

// --- never blocks, and says what it could not measure ------------------------

test('no living spec reports absence, with every count absent rather than zero', () => {
  const report = auditSpecs({ specs: [], edges: null, graphReason: 'no graph has been built' })
  assert.equal(report.absent, true)
  assert.match(report.reason, /no living spec/i)
  assert.deepEqual(report.capabilities, [])
  assert.equal(report.totals, null)
})

test('a missing graph leaves the link measures absent with the reason, not zero', () => {
  const report = audit({ edges: null, broken: [], graphFiles: [], graphReason: 'no graph has been built — run /interlock:bootstrap once' })
  for (const c of report.capabilities) assert.equal(c.links, null)
  assert.equal(report.graph.available, false)
  assert.match(report.graph.reason, /no graph has been built/)
  assert.equal(report.graph.unspecified, null)
})

test('a missing graph still reports every text measure', () => {
  const report = audit({ edges: null, broken: [], graphFiles: [], graphReason: 'no graph has been built' })
  assert.equal(report.totals.requirements, 5)
  assert.equal(report.totals.scenarios, 9)
  assert.equal(cap(report, 'widgets/bounded').boundLines, 3)
})

test('an unreadable spec is named with its reason and left out of the totals', () => {
  const specs = [...gather(FIXTURE), { path: 'openspec/specs/zzz/locked/spec.md', error: 'EACCES: permission denied' }]
  const report = auditSpecs({ specs, graphReason: null, ...FIXTURE_GRAPH })
  assert.deepEqual(report.unreadable, [{ path: 'openspec/specs/zzz/locked/spec.md', reason: 'EACCES: permission denied' }])
  assert.deepEqual(report.coverage, { specs: 3, corpus: 4 })
  assert.equal(report.totals.specs, 3)
  assert.equal(report.totals.requirements, 5)
  assert.ok(!report.capabilities.some(c => c.capability === 'zzz/locked'))
})

test('the human report names the absence, the missing graph and the unreadable spec', () => {
  const absent = formatSpecAudit(auditSpecs({ specs: [], edges: null, graphReason: 'none' }))
  assert.match(absent, /no living spec/i)

  const specs = [...gather(FIXTURE), { path: 'openspec/specs/zzz/locked/spec.md', error: 'EACCES: permission denied' }]
  const text = formatSpecAudit(
    auditSpecs({ specs, edges: null, broken: [], graphFiles: [], graphReason: 'no graph has been built' })
  )
  assert.match(text, /no graph has been built/)
  assert.match(text, /openspec\/specs\/zzz\/locked\/spec\.md/)
  assert.match(text, /EACCES: permission denied/)
  assert.match(text, /3 of 4/)
})

test('the human report lists each flag against its capability and each numeric literal', () => {
  const text = formatSpecAudit(audit())
  assert.match(text, /widgets\/plain/)
  assert.match(text, /no-bound/)
  assert.match(text, /no-failure-scenario/)
  assert.match(text, /lib\/d\.mjs/)
  assert.match(text, new RegExp(`${BOUNDED.replace(/\//g, '\\/')}:11`))
})

// --- this repository's living specs keep the invariants the audit measures ---

/** Independent of `auditSpecs`: count headings the plain way. */
const countLines = (specs, re) => specs.reduce((n, s) => n + (s.text.match(re) || []).length, 0)

/**
 * The pin. Returns what is wrong, naming the spec and the requirement, so a
 * failure reads as "this requirement in this spec" and not as a count.
 */
function invariantViolations(specs) {
  const report = auditSpecs({ specs, edges: null, graphReason: 'not needed for the invariants' })
  const out = []
  for (const c of report.capabilities) {
    if (!c.purpose) out.push(`${c.path}: no ## Purpose`)
    for (const heading of c.nonNormative) out.push(`${c.path}: requirement "${heading}" carries neither SHALL nor MUST`)
    if (c.missingWhen) out.push(`${c.path}: ${c.missingWhen} scenario(s) with no WHEN`)
    if (c.missingThen) out.push(`${c.path}: ${c.missingThen} scenario(s) with no THEN`)
  }
  const reqs = countLines(specs, /^### Requirement:/gm)
  const scens = countLines(specs, /^#### Scenario:/gm)
  if (report.totals && report.totals.requirements !== reqs) {
    out.push(`audit counts ${report.totals.requirements} requirements, the headings say ${reqs}`)
  }
  if (report.totals && report.totals.scenarios !== scens) {
    out.push(`audit counts ${report.totals.scenarios} scenarios, the headings say ${scens}`)
  }
  return out
}

test('the committed living specs keep the structural invariants', () => {
  const specs = gather(REPO)
  assert.ok(specs.length > 0, 'the repository has living specs to audit')
  assert.deepEqual(invariantViolations(specs), [])
})

test('the committed living specs are all readable by the audit', () => {
  const report = auditSpecs({ specs: gather(REPO), edges: null, graphReason: 'not needed' })
  assert.deepEqual(report.unreadable, [])
  assert.equal(report.coverage.specs, report.coverage.corpus)
})

test('a requirement with no normative verb fails the pin, naming the spec and the requirement', () => {
  // The fixture's `widgets/plain` holds exactly that: "Widgets are shown".
  const violations = invariantViolations(gather(FIXTURE))
  assert.ok(
    violations.some(v => v.includes(PLAIN) && v.includes('Widgets are shown')),
    violations.join('\n')
  )
})

test('an archive that adds a well-formed capability passes the pin without a test edit', () => {
  const added = {
    path: 'openspec/specs/brand/new-capability/spec.md',
    text: [
      '# brand/new-capability Specification',
      '',
      '## Purpose',
      '',
      'A capability an archive just added.',
      '',
      '## Requirements',
      '',
      '### Requirement: The new thing SHALL work',
      '',
      'It SHALL work.',
      '',
      '#### Scenario: Happy path — it works',
      '',
      '- **WHEN** it is used',
      '- **THEN** it works',
      '',
      '#### Scenario: Failure — it is misused',
      '',
      '- **WHEN** it is misused',
      '- **THEN** it refuses',
      ''
    ].join('\n')
  }
  const live = gather(REPO)
  const enlarged = [...live, added]
  assert.deepEqual(invariantViolations(enlarged), [])

  // The totals follow the enlarged corpus: the same independent count, two more scenarios.
  const before = auditSpecs({ specs: live, edges: null, graphReason: 'x' }).totals
  const after = auditSpecs({ specs: enlarged, edges: null, graphReason: 'x' }).totals
  assert.equal(after.requirements, before.requirements + 1)
  assert.equal(after.scenarios, before.scenarios + 2)
  assert.equal(after.specs, before.specs + 1)
})

// --- which output carries the per-capability measures (label-and-harden-the-merge-verdict, design D19) ---
//
// Behaviour that already holds, pinned because docs/15 used to promise a table
// per capability. The report object is what `--json` prints; the text output is
// a summary of where to look.

/** The lines of the text output between one heading and the next blank line. */
function partOf(text, heading) {
  const lines = text.split('\n')
  const start = lines.findIndex(line => line.startsWith(heading))
  assert.ok(start > -1, `the text output has no "${heading}" part`)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => line === '')
  return end === -1 ? rest : rest.slice(0, end)
}

test('the text output prints the totals, then only the flagged capabilities with their flags', () => {
  const report = audit()
  const text = formatSpecAudit(report)
  const lines = text.split('\n')
  assert.equal(lines[0], 'SPEC AUDIT')
  assert.ok(lines[1].includes(`covers ${report.coverage.specs} of ${report.coverage.corpus}`), lines[1])
  assert.ok(text.includes(`requirements ${report.totals.requirements}`))
  assert.ok(text.includes(`scenarios ${report.totals.scenarios}`))

  const flagged = report.capabilities.filter(c => c.flags.length > 0)
  const unflagged = report.capabilities.filter(c => c.flags.length === 0)
  assert.ok(flagged.length > 0 && unflagged.length > 0, 'precondition: the fixture has both kinds')
  const rows = partOf(text, 'FLAGS')
  assert.equal(rows.length, flagged.length, rows.join(' | '))
  for (const c of flagged) {
    const row = rows.find(line => line.trim().startsWith(c.capability))
    assert.ok(row, `${c.capability} is flagged and has no row`)
    for (const flag of c.flags) assert.ok(row.includes(flag), `${row} lacks ${flag}`)
  }
  // An unflagged capability has no row of its own anywhere in the text output.
  for (const c of unflagged) {
    assert.ok(!lines.some(line => line.trim().startsWith(`${c.capability} `) || line.trim() === c.capability), c.capability)
  }
  assert.ok(text.indexOf('covers') < text.indexOf('FLAGS'), 'the totals come before the flags')
})

test('the text output lists each numeric literal with its spec, line and value, after the flags', () => {
  const report = audit()
  const text = formatSpecAudit(report)
  const literals = report.capabilities.flatMap(c => c.numericLiterals)
  assert.ok(literals.length > 0, 'precondition: the fixture has numeric literals')
  const rows = partOf(text, 'NUMERIC LITERALS')
  assert.equal(rows.length, literals.length)
  for (const n of literals) {
    assert.ok(rows.some(line => line.includes(`${n.spec}:${n.line}`) && line.includes(String(n.value))), `${n.spec}:${n.line}`)
  }
  assert.ok(text.indexOf('FLAGS') < text.indexOf('NUMERIC LITERALS'))
})

test('with no graph, each graph measure is printed with its reason, never as zero', () => {
  const reason = 'no graph has been built'
  const text = formatSpecAudit(audit({ edges: null, broken: [], graphFiles: [], graphReason: reason }))
  for (const measure of ['FILE LINKS', 'UNSPECIFIED SOURCE']) {
    const line = text.split('\n').find(l => l.startsWith(measure))
    assert.ok(line, `no ${measure} line`)
    assert.ok(line.includes('not measured') && line.includes(reason), line)
    assert.doesNotMatch(line, /\b0\b/)
  }
  assert.ok(text.indexOf('NUMERIC LITERALS') < text.indexOf('FILE LINKS'), 'the graph measures come last')
})

test('a corpus in which no capability is flagged says none', () => {
  const specs = gather(FIXTURE).filter(s => s.path === BOUNDED)
  const report = auditSpecs({ specs, edges: null, broken: [], graphFiles: [], graphReason: 'no graph has been built' })
  assert.deepEqual(report.capabilities.map(c => c.flags), [[]], 'precondition: the one capability carries no flag')
  assert.deepEqual(partOf(formatSpecAudit(report), 'FLAGS'), ['  none'])
})

test('the report --json prints carries every capability, flagged or not, each with its own measures', () => {
  const report = audit()
  assert.equal(report.capabilities.length, report.coverage.specs)
  for (const c of report.capabilities) {
    for (const key of ['requirements', 'scenarios', 'boundLines', 'numericLiterals', 'flags', 'failure', 'edgeCase']) {
      assert.ok(key in c, `${c.capability} carries no ${key}`)
    }
  }
  assert.ok(report.capabilities.some(c => c.flags.length === 0), 'an unflagged capability is not lost')
})
