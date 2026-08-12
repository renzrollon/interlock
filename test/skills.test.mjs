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
  assert.ok(skillDirs.length >= 14, `expected at least 14 skills, found ${skillDirs.length}`)
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

test('no skill references a skill that was not shipped', () => {
  const shipped = new Set(skillDirs)
  const offenders = []
  for (const dir of skillDirs) {
    const text = readFileSync(join(SKILLS_DIR, dir, 'SKILL.md'), 'utf8')
    for (const m of text.matchAll(/\/specflow:([a-z-]+)/g)) {
      if (!shipped.has(m[1])) offenders.push(`${dir} → /specflow:${m[1]}`)
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
  for (const dir of ['ship', 'commit', 'mr']) {
    const fm = parseFrontmatter(readFileSync(join(SKILLS_DIR, dir, 'SKILL.md'), 'utf8'))
    assert.equal(
      fm.values['disable-model-invocation'],
      'true',
      `${dir} must set disable-model-invocation: true`
    )
  }
})

test('ship cannot ask the user a question', () => {
  // The zero-touch contract is enforced by the harness, not by prose.
  const fm = parseFrontmatter(readFileSync(join(SKILLS_DIR, 'ship', 'SKILL.md'), 'utf8'))
  assert.match(fm.values['disallowed-tools'] || '', /AskUserQuestion/)
})

test('shared contracts referenced by skills all exist', () => {
  const shared = readdirSync(join(ROOT, 'shared')).filter(f => f.endsWith('.md'))
  assert.ok(shared.length >= 5, `expected the shared contracts, found ${shared.length}`)
})
