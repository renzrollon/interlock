// Structural validation of every bundled skill.
//
// `claude plugin validate` checks the manifests; this checks the skills
// themselves — frontmatter keys, the description budget, and whether every
// bundled-file reference actually resolves. A skill that points at a
// ${CLAUDE_PLUGIN_ROOT}/shared/ file that does not exist fails silently at
// runtime, which is exactly the class of bug that should not reach a user.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_DIR = join(ROOT, 'skills')

// Fields Claude Code accepts in SKILL.md frontmatter.
// The first six are the Agent Skills open standard; the rest are Claude Code
// extensions and are rejected by strict spec validators such as the Skills API.
const SPEC_FIELDS = new Set([
  'name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'
])
const CLAUDE_EXTENSIONS = new Set([
  'when_to_use', 'argument-hint', 'arguments', 'disable-model-invocation',
  'disallowed-tools', 'context', 'background', 'user-invocable'
])
const ALLOWED = new Set([...SPEC_FIELDS, ...CLAUDE_EXTENSIONS])

// description + when_to_use are truncated at this many characters in the skill
// listing, so anything past it is invisible to the model when it picks a skill.
const LISTING_CAP = 1536

const WORKFLOWS_DIR = join(ROOT, 'workflows')
const workflowFiles = existsSync(WORKFLOWS_DIR)
  ? readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.js'))
  : []
const workflowNames = workflowFiles.map(f => f.replace(/\.js$/, ''))

const skillDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)
  .sort()

// Minimal frontmatter reader: we only need top-level scalar keys, and pulling in
// a YAML dependency for that would be the only dependency in the repo.
function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (!m) return null
  const keys = []
  const values = {}
  let currentKey = null
  for (const line of m[1].split('\n')) {
    if (/^\s/.test(line) || line.trim() === '') {
      if (currentKey) values[currentKey] += '\n' + line.trim()
      continue
    }
    const kv = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(line)
    if (!kv) continue
    currentKey = kv[1]
    keys.push(currentKey)
    values[currentKey] = kv[2]
  }
  return { keys, values, body: text.slice(m[0].length) }
}

test('every skill directory contains a SKILL.md', () => {
  assert.ok(skillDirs.length >= 13, `expected at least 13 skills, found ${skillDirs.length}`)
  for (const dir of skillDirs) {
    assert.ok(existsSync(join(SKILLS_DIR, dir, 'SKILL.md')), `${dir}/SKILL.md is missing`)
  }
})

for (const dir of skillDirs) {
  const path = join(SKILLS_DIR, dir, 'SKILL.md')
  const text = readFileSync(path, 'utf8')
  const fm = parseFrontmatter(text)

  test(`${dir}: frontmatter parses and uses only recognized fields`, () => {
    assert.ok(fm, `${dir}/SKILL.md has no YAML frontmatter block`)
    for (const key of fm.keys) {
      assert.ok(ALLOWED.has(key), `${dir}: unrecognized frontmatter key "${key}"`)
    }
  })

  test(`${dir}: name matches the directory`, () => {
    assert.equal(fm.values.name, dir, `${dir}: frontmatter name is "${fm.values.name}"`)
  })

  test(`${dir}: has a description within the listing budget`, () => {
    const desc = fm.values.description || ''
    assert.ok(desc.length > 40, `${dir}: description is too short to route on`)
    const combined = desc.length + (fm.values.when_to_use || '').length
    assert.ok(
      combined <= LISTING_CAP,
      `${dir}: description + when_to_use is ${combined} chars, over the ${LISTING_CAP} listing cap`
    )
  })

  test(`${dir}: every bundled-file reference resolves`, () => {
    const refs = [
      ...text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)
    ].map(m => ({ raw: m[0], abs: join(ROOT, m[1]) }))
    const skillRefs = [
      ...text.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/([A-Za-z0-9_./-]+)/g)
    ].map(m => ({ raw: m[0], abs: join(SKILLS_DIR, dir, m[1]) }))

    for (const r of [...refs, ...skillRefs]) {
      assert.ok(existsSync(r.abs), `${dir}: ${r.raw} does not resolve to a real file`)
    }
  })
}

test('no skill references a command that was not shipped', () => {
  // `ship` is a workflow with a skill trampoline, so the shipped set is the union of both.
  // Plugin workflows are namespaced identically (`/interlock:<meta.name>`), which
  // is why moving ship out of skills/ did not change a single call site.
  const shipped = new Set([...skillDirs, ...workflowNames])
  const offenders = []
  for (const dir of skillDirs) {
    const text = readFileSync(join(SKILLS_DIR, dir, 'SKILL.md'), 'utf8')
    for (const m of text.matchAll(/\/interlock:([a-z-]+)/g)) {
      if (!shipped.has(m[1])) offenders.push(`${dir} → /interlock:${m[1]}`)
    }
  }
  assert.deepEqual(offenders, [], `dangling skill references: ${offenders.join(', ')}`)
})

test('no skill carries a reference to the private predecessor repo', () => {
  const banned = /carl-|IdeaProjects|gitlab-dedicated|kaspar|day5-sdd|roadmap-harness/
  for (const dir of skillDirs) {
    const text = readFileSync(join(SKILLS_DIR, dir, 'SKILL.md'), 'utf8')
    const hit = banned.exec(text)
    assert.equal(hit, null, `${dir}: leaked reference "${hit && hit[0]}"`)
  }
})

test('side-effecting skills are not model-invocable', () => {
  // ship, commit and mr all write to shared state or a remote. Claude must not
  // decide on its own that now is a good time to commit or open an MR.
  // `ship` is absent here on purpose: it is a workflow, and the workflow runtime
  // gives it a stronger guarantee than this flag does — see the workflow tests.
  for (const dir of ['commit', 'mr']) {
    const fm = parseFrontmatter(readFileSync(join(SKILLS_DIR, dir, 'SKILL.md'), 'utf8'))
    assert.equal(
      fm.values['disable-model-invocation'],
      'true',
      `${dir} must set disable-model-invocation: true`
    )
  }
})

test('ship skill is a workflow trampoline, not the loop', () => {
  // `/interlock:ship` must exist as a skill so the Skill tool can find it in a
  // consumer repo. The loop itself stays in workflows/ship.js — a skill that
  // reimplemented waves/review would shadow the workflow and restore prose
  // control flow. The trampoline may only launch the script.
  assert.ok(skillDirs.includes('ship'), 'skills/ship must exist as the Skill-tool entry point')
  const text = readFileSync(join(SKILLS_DIR, 'ship', 'SKILL.md'), 'utf8')
  assert.match(text, /Workflow tool/, 'trampoline must invoke the Workflow tool')
  assert.match(text, /workflows\/ship\.js/, 'trampoline must point at the script')
  assert.match(text, /scriptPath/, 'trampoline must pass scriptPath, not reimplement the loop')
  assert.doesNotMatch(text, /interlock waves/, 'trampoline must not run the wave planner')
  assert.doesNotMatch(text, /interlock remediate/, 'trampoline must not run remediation')
  assert.doesNotMatch(text, /cap two remediation/i, 'trampoline must not restate loop caps')
})

test('shared contracts referenced by skills all exist', () => {
  const shared = readdirSync(join(ROOT, 'shared')).filter(f => f.endsWith('.md'))
  assert.ok(shared.length >= 5, `expected the shared contracts, found ${shared.length}`)
})

test('every skill that spawns subagents is allowed the Agent tool', () => {
  // `allowed-tools` is a per-turn pre-approval, not a hard allowlist — Claude
  // Code's docs are explicit that it "does not restrict which tools are
  // available". So omitting Agent does not break fan-out; what it costs is a
  // permission prompt under a user's own restrictive rules. That is worth a
  // structural rule anyway, because `ship` runs with AskUserQuestion removed
  // and is sold as a run that never touches the keyboard: stalling on an
  // approval dialog halfway through wave execution breaks exactly the contract
  // the disallowed-tools line is there to keep. Keeping the pre-approval list
  // honest to what the body actually asks for is the cheapest way to hold it.
  // The regex deliberately matches only *affirmative* spawn language:
  // `explain-code` says "Single agent, no fan-out", which must not trip it.
  const SPAWNS_AGENTS = /Agent tool|subagent|spawn (?:\w+ ){0,2}agents?|fan out (?:\w+ ){0,2}agents?/i
  const offenders = []
  for (const dir of skillDirs) {
    const fm = parseFrontmatter(readFileSync(join(SKILLS_DIR, dir, 'SKILL.md'), 'utf8'))
    if (!SPAWNS_AGENTS.test(fm.body)) continue
    if (!/\bAgent\b/.test(fm.values['allowed-tools'] || '')) offenders.push(dir)
  }
  assert.deepEqual(
    offenders,
    [],
    `skills instruct spawning subagents but omit Agent from allowed-tools: ${offenders.join(', ')}`
  )
})

// Same intent as the skill-level scan above, widened to the two other trees an
// agent actually reads at runtime: the shared contracts skills load verbatim,
// and the CLI output they consume. A stale predecessor skill name in a shared
// contract sends the model looking for a command this plugin does not ship.
// Patterns are word-boundary-anchored so ordinary English survives — "propose"
// and "proposed" are legitimate words and are NOT banned.
const BANNED_RESIDUE = [
  /\bCarl Graph\b/,
  /\bsource_grill\b/,
  /\breview-ts\b/,
  /\bopenspec-create-pr\b/,
  /\bapply-change\b/
]

function filesUnder(dir, ext) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...filesUnder(abs, ext))
    else if (entry.name.endsWith(ext)) out.push(abs)
  }
  return out
}

test('shared contracts and lib carry no predecessor skill names', () => {
  const targets = [
    ...filesUnder(join(ROOT, 'shared'), '.md'),
    ...filesUnder(join(ROOT, 'lib'), '.mjs')
  ]
  assert.ok(targets.length >= 10, `expected shared + lib files, found ${targets.length}`)
  const offenders = []
  for (const abs of targets) {
    const text = readFileSync(abs, 'utf8')
    for (const pattern of BANNED_RESIDUE) {
      const hit = pattern.exec(text)
      if (hit) offenders.push(`${abs.slice(ROOT.length + 1)}: "${hit[0]}"`)
    }
  }
  assert.deepEqual(offenders, [], `predecessor residue: ${offenders.join(', ')}`)
})
