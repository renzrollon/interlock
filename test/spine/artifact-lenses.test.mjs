// Lens selection and detection for the artifact brief (spec:
// spec/artifact-review-brief, design §2). `lib/artifact-lenses.mjs` is pure:
// the I/O (existsSync, readdirSync, git ls-files, package.json) is handed in.
// Written before the module exists (brief-and-record-the-artifact-gate 1.3).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import * as lenses from '../../lib/artifact-lenses.mjs'

const BUNDLED = ['agentic-harness', 'web-ui']
const detectedOf = (...names) => names.map(name => ({ name, marker: `${name}-marker` }))
const select = (over = {}) => lenses.selectLenses({ flag: null, policyLenses: [], detected: [], bundled: BUNDLED, cap: 3, ...over })

// --- selectLenses -----------------------------------------------------------------

test('selectLenses: the --lens flag wins over the policy list and detection, with source --lens', () => {
  const got = select({ flag: ['web-ui'], policyLenses: ['agentic-harness'], detected: detectedOf('agentic-harness') })
  assert.deepEqual(got.lenses, [{ name: 'web-ui', source: '--lens' }])
  assert.deepEqual(got.unknown, [])
  assert.deepEqual(got.capped, [])
})

test('selectLenses: with no flag, the REVIEW.md list wins over detection, with source "REVIEW.md at HEAD"', () => {
  const got = select({ policyLenses: ['web-ui'], detected: detectedOf('agentic-harness') })
  assert.deepEqual(got.lenses, [{ name: 'web-ui', source: 'REVIEW.md at HEAD' }])
})

test('selectLenses: with neither, detection selects, each source naming its own marker', () => {
  const got = select({
    detected: [
      { name: 'agentic-harness', marker: '.claude-plugin/plugin.json' },
      { name: 'web-ui', marker: 'package.json react' }
    ]
  })
  assert.deepEqual(got.lenses, [
    { name: 'agentic-harness', source: 'detected: .claude-plugin/plugin.json' },
    { name: 'web-ui', source: 'detected: package.json react' }
  ])
})

test('selectLenses: no source names a lens, so none is selected', () => {
  for (const empty of [{}, { flag: [] }, { flag: null, policyLenses: [], detected: [] }]) {
    assert.deepEqual(select(empty), { lenses: [], unknown: [], capped: [] })
  }
})

test('selectLenses: a source of unknown names alone selects none and never falls through', () => {
  const got = select({ flag: ['mobile'], policyLenses: ['web-ui'], detected: detectedOf('agentic-harness') })
  assert.deepEqual(got.lenses, [])
  assert.deepEqual(got.unknown, ['mobile'])
  const fromPolicy = select({ policyLenses: ['mobile'], detected: detectedOf('agentic-harness') })
  assert.deepEqual(fromPolicy.lenses, [])
  assert.deepEqual(fromPolicy.unknown, ['mobile'])
})

test('selectLenses: unknown names are returned in source order and the known names of the same source go on', () => {
  const got = select({ flag: ['agentic-harness', 'mobile', 'desktop'] })
  assert.deepEqual(got.lenses, [{ name: 'agentic-harness', source: '--lens' }])
  assert.deepEqual(got.unknown, ['mobile', 'desktop'])
})

test('selectLenses: names past an injected cap are returned under capped, in source order', () => {
  const got = select({ flag: ['agentic-harness', 'web-ui', 'extra-a', 'extra-b'], bundled: [...BUNDLED, 'extra-a', 'extra-b'], cap: 2 })
  assert.deepEqual(got.lenses.map(l => l.name), ['agentic-harness', 'web-ui'])
  assert.deepEqual(got.capped, ['extra-a', 'extra-b'])
  assert.deepEqual(got.unknown, [])
})

test('selectLenses: a list at the cap is selected whole and caps nothing', () => {
  const got = select({ flag: ['agentic-harness', 'web-ui'], cap: 2 })
  assert.equal(got.lenses.length, 2)
  assert.deepEqual(got.capped, [])
})

test('selectLenses: the cap applies to detected lenses too', () => {
  const got = select({ detected: detectedOf('agentic-harness', 'web-ui'), cap: 1 })
  assert.deepEqual(got.lenses.map(l => l.name), ['agentic-harness'])
  assert.deepEqual(got.capped, ['web-ui'])
})

// --- detectLenses -----------------------------------------------------------------

const hasOf = (...paths) => {
  const held = new Set(paths)
  // The skills marker is one directory read in the caller; a double answers it
  // for the pattern and for any concrete skills/<name>/SKILL.md alike.
  return p => held.has(p) || (/^skills\/(\*|[^/]+)\/SKILL\.md$/.test(p) && [...held].some(h => /^skills\/[^/]+\/SKILL\.md$/.test(h)))
}
const detect = (over = {}) => lenses.detectLenses({ has: () => false, packageJson: null, uiFiles: [], ...over })

test('detectLenses: finds nothing in an empty repository and is not partial', () => {
  assert.deepEqual(detect(), { detected: [], partial: null })
})

test('detectLenses: each of the three harness markers selects agentic-harness, naming the marker found', () => {
  const plugin = detect({ has: hasOf('.claude-plugin/plugin.json') })
  assert.deepEqual(plugin.detected, [{ name: 'agentic-harness', marker: '.claude-plugin/plugin.json' }])
  const hooks = detect({ has: hasOf('hooks/hooks.json') })
  assert.deepEqual(hooks.detected, [{ name: 'agentic-harness', marker: 'hooks/hooks.json' }])
  const skill = detect({ has: hasOf('skills/alpha/SKILL.md') })
  assert.equal(skill.detected.length, 1)
  assert.equal(skill.detected[0].name, 'agentic-harness')
  assert.match(skill.detected[0].marker, /^skills\/.*SKILL\.md$/)
})

test('detectLenses: the first harness marker found is the one printed, in the order plugin.json, hooks.json, skills', () => {
  const got = detect({ has: hasOf('.claude-plugin/plugin.json', 'hooks/hooks.json', 'skills/alpha/SKILL.md') })
  assert.equal(got.detected.length, 1, 'one lens, one marker')
  assert.equal(got.detected[0].marker, '.claude-plugin/plugin.json')
  assert.equal(detect({ has: hasOf('hooks/hooks.json', 'skills/alpha/SKILL.md') }).detected[0].marker, 'hooks/hooks.json')
})

test('detectLenses: a UI dependency in any of the three dependency maps selects web-ui, naming package.json and the dependency', () => {
  for (const map of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const got = detect({ packageJson: { [map]: { react: '^18.0.0' } } })
    assert.deepEqual(got.detected, [{ name: 'web-ui', marker: 'package.json react' }], map)
  }
  for (const dep of ['react', 'vue', 'svelte', '@angular/core', 'solid-js', 'preact']) {
    const got = detect({ packageJson: { dependencies: { [dep]: '*' } } })
    assert.deepEqual(got.detected, [{ name: 'web-ui', marker: `package.json ${dep}` }], dep)
  }
})

test('detectLenses: a dependency that is not a UI framework selects nothing', () => {
  assert.deepEqual(detect({ packageJson: { dependencies: { express: '^4.0.0' } } }).detected, [])
  assert.deepEqual(detect({ packageJson: {} }).detected, [])
})

test('detectLenses: a tracked .tsx, .jsx, .vue or .svelte file selects web-ui and names the file', () => {
  for (const file of ['src/App.tsx', 'src/App.jsx', 'src/App.vue', 'src/App.svelte']) {
    const got = detect({ uiFiles: [file] })
    assert.equal(got.detected.length, 1, file)
    assert.equal(got.detected[0].name, 'web-ui')
    assert.ok(got.detected[0].marker.includes(file), got.detected[0].marker)
  }
  assert.deepEqual(detect({ uiFiles: [] }).detected, [])
})

test('detectLenses: both lenses come in a fixed order, agentic-harness first, each with its own marker', () => {
  const got = detect({ has: hasOf('.claude-plugin/plugin.json'), uiFiles: ['src/App.tsx'] })
  assert.deepEqual(got.detected.map(d => d.name), ['agentic-harness', 'web-ui'])
  assert.equal(got.detected[0].marker, '.claude-plugin/plugin.json')
  assert.ok(got.detected[1].marker.includes('src/App.tsx'))
  assert.equal(got.partial, null)
})

test('detectLenses: when uiFiles is an error, partial says web-ui read package.json alone, and package.json still counts', () => {
  const got = detect({ has: hasOf('hooks/hooks.json'), uiFiles: 'fatal: not a git repository' })
  assert.deepEqual(got.detected, [{ name: 'agentic-harness', marker: 'hooks/hooks.json' }])
  assert.equal(typeof got.partial, 'string')
  assert.match(got.partial, /package\.json/)
  const both = detect({ packageJson: { dependencies: { react: '1' } }, uiFiles: 'fatal: not a git repository' })
  assert.deepEqual(both.detected, [{ name: 'web-ui', marker: 'package.json react' }])
  assert.equal(typeof both.partial, 'string')
})
