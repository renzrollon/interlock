// The one parser of living-spec text — `### Requirement:` blocks, their
// scenarios and the delta sections a change's spec is split into.
//
// Three consumers read this module (superseded-requirement subtraction, the
// requirement-citation check and the spec audit), so what is pinned here is
// the shape they all depend on: a heading's canonical key, a block's prose
// apart from its scenarios, and which keyword lines a scenario actually has.
// design D1 of judge-against-base-and-living-specs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { capabilityOf, parseSpec, requirementKey } from '../../lib/spec-text.mjs'

const LIVING = `# demo/cache Specification

## Purpose

Keeps a small cache honest.

## Requirements

### Requirement: The cache SHALL evict old entries

The cache SHALL hold a bounded number of entries.
It SHALL NOT grow past the limit.

#### Scenario: Happy path — a hit is served

- **GIVEN** a cache holding one entry
- **WHEN** the entry is read
- **THEN** it is returned
- **AND** the hit is counted

#### Scenario: Failure — a miss is reported

- **WHEN** an absent entry is read
- **THEN** the miss is reported

### Requirement: Entries MUST be keyed

Every entry MUST carry a key.

#### Scenario: Edge case — an empty key

- **GIVEN** an entry with no key
`

const DELTA = `## ADDED Requirements

### Requirement: The cache SHALL report its size

The cache SHALL expose a count.

#### Scenario: Happy path — a count

- **WHEN** the size is read
- **THEN** a count is returned

## MODIFIED Requirements

### Requirement: Entries MUST be keyed

Every entry MUST carry a non-empty key.

#### Scenario: Failure — an empty key

- **GIVEN** an entry with an empty key
- **WHEN** it is stored
- **THEN** it is refused

## REMOVED Requirements

### Requirement: The cache SHALL evict old entries

**Reason**: Superseded.

**Migration**: None.

## RENAMED Requirements

- FROM: \`### Requirement: Old name\`
- TO: \`### Requirement: New name\`
`

// --- parseSpec: a living spec ------------------------------------------------

test('a living spec parses its purpose and its requirements in order', () => {
  const spec = parseSpec(LIVING)
  assert.match(spec.purpose, /Keeps a small cache honest\./)
  assert.deepEqual(
    spec.requirements.map(r => r.heading),
    ['The cache SHALL evict old entries', 'Entries MUST be keyed']
  )
  assert.deepEqual(spec.renamed, [])
})

test('a requirement in a living spec carries a null section', () => {
  const spec = parseSpec(LIVING)
  for (const r of spec.requirements) assert.equal(r.section, null)
})

test('a requirement carries its key and the line its heading is on', () => {
  const [first, second] = parseSpec(LIVING).requirements
  assert.equal(first.key, requirementKey(first.heading))
  const lines = LIVING.split('\n')
  assert.equal(lines[first.line - 1], '### Requirement: The cache SHALL evict old entries')
  assert.equal(lines[second.line - 1], '### Requirement: Entries MUST be keyed')
})

test('prose is the requirement text apart from its scenarios', () => {
  const [first] = parseSpec(LIVING).requirements
  assert.match(first.prose, /SHALL hold a bounded number of entries/)
  assert.match(first.prose, /SHALL NOT grow past the limit/)
  assert.doesNotMatch(first.prose, /Scenario/)
  assert.doesNotMatch(first.prose, /\*\*GIVEN\*\*|\*\*WHEN\*\*|\*\*THEN\*\*/)
})

test('text is the whole block, scenarios included, and stops at the next requirement', () => {
  const [first, second] = parseSpec(LIVING).requirements
  assert.match(first.text, /Requirement: The cache SHALL evict old entries/)
  assert.match(first.text, /Scenario: Happy path — a hit is served/)
  assert.match(first.text, /Scenario: Failure — a miss is reported/)
  assert.doesNotMatch(first.text, /Entries MUST be keyed/)
  assert.match(second.text, /Every entry MUST carry a key\./)
})

test('a scenario records its title, its line and which keyword lines it has', () => {
  const [first, second] = parseSpec(LIVING).requirements
  assert.equal(first.scenarios.length, 2)

  const [hit, miss] = first.scenarios
  assert.equal(hit.title, 'Happy path — a hit is served')
  assert.equal(LIVING.split('\n')[hit.line - 1], '#### Scenario: Happy path — a hit is served')
  assert.deepEqual([hit.given, hit.when, hit.then], [true, true, true])

  // The miss has no GIVEN: the flag is false, not absent.
  assert.equal(miss.title, 'Failure — a miss is reported')
  assert.deepEqual([miss.given, miss.when, miss.then], [false, true, true])

  const [emptyKey] = second.scenarios
  assert.deepEqual([emptyKey.given, emptyKey.when, emptyKey.then], [true, false, false])
})

test('an AND line is not a keyword line', () => {
  const only = parseSpec(
    `## Requirements\n\n### Requirement: R SHALL x\n\nbody\n\n#### Scenario: S\n\n- **AND** something\n`
  )
  const [s] = only.requirements[0].scenarios
  assert.deepEqual([s.given, s.when, s.then], [false, false, false])
})

test('only the bulleted bold keyword line counts, not the word in prose', () => {
  const only = parseSpec(
    `## Requirements\n\n### Requirement: R SHALL x\n\nbody\n\n#### Scenario: S\n\nGIVEN a thing, WHEN it runs, THEN it ends\n`
  )
  const [s] = only.requirements[0].scenarios
  assert.deepEqual([s.given, s.when, s.then], [false, false, false])
})

test('a requirement with no scenario has an empty scenario list', () => {
  const only = parseSpec(`## Requirements\n\n### Requirement: R SHALL x\n\nbody only\n`)
  assert.deepEqual(only.requirements[0].scenarios, [])
  assert.match(only.requirements[0].prose, /body only/)
})

test('a spec with no Purpose section has a null purpose, not an empty string', () => {
  const spec = parseSpec(`## Requirements\n\n### Requirement: R SHALL x\n\nbody\n`)
  assert.equal(spec.purpose, null)
})

test('text with no requirement heading parses to no requirements', () => {
  const spec = parseSpec('# Title\n\nJust prose.\n')
  assert.deepEqual(spec.requirements, [])
  assert.deepEqual(spec.renamed, [])
})

// --- parseSpec: a delta spec -------------------------------------------------

test('each requirement in a delta spec carries the section it sits under', () => {
  const spec = parseSpec(DELTA)
  const bySection = Object.fromEntries(spec.requirements.map(r => [r.heading, r.section]))
  assert.deepEqual(bySection, {
    'The cache SHALL report its size': 'ADDED',
    'Entries MUST be keyed': 'MODIFIED',
    'The cache SHALL evict old entries': 'REMOVED'
  })
})

test('a removed requirement keeps its Reason and Migration as prose', () => {
  const removed = parseSpec(DELTA).requirements.find(r => r.section === 'REMOVED')
  assert.match(removed.prose, /\*\*Reason\*\*: Superseded\./)
  assert.deepEqual(removed.scenarios, [])
})

test('a RENAMED section yields FROM and TO pairs, not requirements', () => {
  const spec = parseSpec(DELTA)
  assert.deepEqual(spec.renamed, [{ from: 'Old name', to: 'New name' }])
  assert.ok(!spec.requirements.some(r => r.heading === 'Old name' || r.heading === 'New name'))
})

test('a modified requirement keeps its scenarios', () => {
  const modified = parseSpec(DELTA).requirements.find(r => r.section === 'MODIFIED')
  assert.equal(modified.scenarios.length, 1)
  assert.equal(modified.scenarios[0].title, 'Failure — an empty key')
})

// --- requirementKey ----------------------------------------------------------

test('requirementKey collapses internal whitespace and trims', () => {
  assert.equal(requirementKey('  The  cache   SHALL evict\told entries '), 'The cache SHALL evict old entries')
})

test('requirementKey strips one leading Requirement: prefix', () => {
  assert.equal(
    requirementKey('Requirement: The cache SHALL evict old entries'),
    requirementKey('The cache SHALL evict old entries')
  )
})

test('an extra-whitespace spelling and a prefixed spelling share one key', () => {
  const plain = requirementKey('Entries MUST be keyed')
  assert.equal(requirementKey('Entries  MUST   be keyed'), plain)
  assert.equal(requirementKey('Requirement:  Entries MUST be  keyed '), plain)
})

test('requirementKey keeps case, so a case difference is a different requirement', () => {
  assert.notEqual(requirementKey('Entries MUST be keyed'), requirementKey('entries must be keyed'))
  assert.equal(requirementKey('Entries MUST be keyed'), 'Entries MUST be keyed')
})

test('the key parseSpec records is the key requirementKey gives the heading', () => {
  const spec = parseSpec(`## Requirements\n\n### Requirement:   Spaced   out  SHALL hold\n\nbody\n`)
  assert.equal(spec.requirements[0].key, 'Spaced out SHALL hold')
  assert.equal(spec.requirements[0].key, requirementKey(spec.requirements[0].heading))
})

// --- capabilityOf ------------------------------------------------------------

test('capabilityOf names the capability of a living spec path', () => {
  assert.equal(capabilityOf('openspec/specs/review/domain-review/spec.md'), 'review/domain-review')
  assert.equal(capabilityOf('openspec/specs/gadgets/spec.md'), 'gadgets')
})

test('capabilityOf names the capability of a change delta spec path', () => {
  assert.equal(
    capabilityOf('openspec/changes/judge-against-base/specs/review/domain-review/spec.md'),
    'review/domain-review'
  )
  assert.equal(capabilityOf('specs/review/domain-review/spec.md'), 'review/domain-review')
})

test('capabilityOf names the capability of a path relative to a change specs directory', () => {
  // inspectChange(...).specFiles lists delta specs this way.
  assert.equal(capabilityOf('review/domain-review/spec.md'), 'review/domain-review')
  assert.equal(capabilityOf('gadgets/spec.md'), 'gadgets')
})

test('capabilityOf reads a Windows-separated path', () => {
  assert.equal(capabilityOf('openspec\\specs\\review\\domain-review\\spec.md'), 'review/domain-review')
})

test('capabilityOf is null for a path that is not a spec file', () => {
  assert.equal(capabilityOf('lib/spec-text.mjs'), null)
  assert.equal(capabilityOf('openspec/specs/review/domain-review/design.md'), null)
  assert.equal(capabilityOf('openspec/changes/x/proposal.md'), null)
  assert.equal(capabilityOf(''), null)
  assert.equal(capabilityOf(undefined), null)
})

test('capabilityOf is null for a spec.md with no capability above it', () => {
  assert.equal(capabilityOf('spec.md'), null)
  assert.equal(capabilityOf('openspec/specs/spec.md'), null)
})
