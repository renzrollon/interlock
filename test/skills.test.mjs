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

import { RED_SECTION_MARKER } from '../lib/artifacts.mjs'
import { OPENSPEC_INSTALL } from '../lib/doctor.mjs'
// A namespace import, so a missing `toleratedPaths` is reported by the settle pins
// by name instead of failing the whole file at link time.
import * as settleCli from '../lib/settle-cli.mjs'
// A namespace import, so a missing OPENSPEC_MIN_VERSION is reported by name.
import * as doctorModule from '../lib/doctor.mjs'

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
  // ship, commit and settle all write to shared state or a remote. Claude must not
  // decide on its own that now is a good time to commit or open a PR.
  // `ship` is absent here on purpose: it is a workflow, and the workflow runtime
  // gives it a stronger guarantee than this flag does — see the workflow tests.
  for (const dir of ['commit', 'settle']) {
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

test('ship trampoline halts without the Workflow tool and never auto-starts the runner', () => {
  // add-interlock-acp-host §2: a second host must not weaken the default one.
  // The failure mode this guards is not "ACP is broken" — it is a trampoline
  // that quietly reaches for *any* other way to run the loop when the Workflow
  // tool is missing, whether that is the ACP driver or the parent conversation.
  const text = readFileSync(join(SKILLS_DIR, 'ship', 'SKILL.md'), 'utf8')

  assert.match(text, /\*\*Halt\.\*\*/, 'a missing Workflow tool must halt')
  assert.match(
    text,
    /Do not fall back to implementing the change in this conversation/i,
    'the halt must forbid the inline fallback explicitly'
  )
  assert.match(
    text,
    /interlock-run/,
    'the trampoline must name the runner as a separate binary'
  )
  assert.match(
    text,
    /separate binary this skill never invokes/i,
    'the runner pointer must say the skill does not launch it'
  )
  assert.match(text, /not a fallback for a missing Workflow tool/i)
  // What the second host runs. It used to be "the lean loop", and `--strict`
  // "stays Claude Code only" — both false since `emit-strict-tail-from-cli`
  // made the tail a program the CLI emits. Tokens, not sentences, so the first
  // reword does not delete the pin.
  assert.match(text, /same loop/i, 'the runner pointer must say it runs the same loop')
  assert.match(text, /--host/, 'and that the runner takes a host')
  assert.match(text, /--strict/, 'and that --strict is part of it')
  assert.doesNotMatch(
    text,
    /(strict|tail)[^.]{0,60}Claude Code only/i,
    'the skill must not claim the strict tail is Claude Code only'
  )

  // The loop itself, in any host's vocabulary, stays out of the trampoline.
  for (const forbidden of [
    /interlock wave-state/,
    /interlock verify/,
    /INTERLOCK_ACP_COMMAND/,
    /createAcpHost/,
    /mapPipeline/
  ]) {
    assert.doesNotMatch(text, forbidden, `trampoline must not run the loop itself: ${forbidden}`)
  }
})

test('the ship trampoline carries the plan-shape flags and forwards them verbatim', () => {
  // A flag the trampoline does not know about is a flag the user cannot pass:
  // the skill builds the `args` payload the script parses, so an unmapped
  // `--solo` reaches ship.js as nothing at all and the run silently plans waves.
  // Tokens, not sentences — the first reword must not delete the pin.
  const text = readFileSync(join(SKILLS_DIR, 'ship', 'SKILL.md'), 'utf8')
  const hint = /^argument-hint:.*$/m.exec(text)
  assert.ok(hint, 'the ship skill must publish an argument-hint')
  for (const flag of ['--solo', '--waves', '--tdd', '--no-tdd']) {
    assert.ok(hint[0].includes(flag), `the argument-hint must offer ${flag}`)
  }
  assert.match(text, /flags: \["solo"\]/, 'the flag table must map --solo onto the args payload')
  assert.match(text, /flags: \["waves"\]/, 'and --waves')
  // The TASK shape, which is a third decision beside the plan shape and the
  // resume mode. An unmapped --tdd reaches ship.js as nothing at all and the
  // run silently plans the ordinary shape.
  assert.match(text, /flags: \["tdd"\]/, 'and --tdd')
  assert.match(text, /flags: \["no-tdd"\]/, 'and --no-tdd')
  // Its default lives in the CLI, read off tasks.md — the trampoline must not
  // grow shape judgement of its own here either.
  assert.ok(
    text.includes(RED_SECTION_MARKER),
    'the trampoline must name the heading the CLI reads the task shape from'
  )
  // The preview names the mode before anything is spawned, which is why the
  // trampoline has no shape judgement of its own to make.
  assert.match(text, /plan preview names the mode/i)
  assert.doesNotMatch(
    text,
    /interlock limits|envelope of \d+|\bat most \d+ tasks\b/i,
    'the trampoline must cite no threshold: the envelope is the planner\'s to enforce'
  )
})

test('the ship trampoline forwards the plugin root in the Workflow args', () => {
  // The CLI compares its own version with the plugin's, and can only do that if
  // the run is told where the plugin is. `scriptPath` already holds the root
  // token, so the pin reads the `args` object alone: a trampoline that dropped
  // `pluginRoot` would still pass a match on the whole block.
  // Tokens, not sentences — the first reword must not delete the pin.
  const text = readFileSync(join(SKILLS_DIR, 'ship', 'SKILL.md'), 'utf8')
  const call = /Workflow\(\{[\s\S]*?\n\}\)/.exec(text)
  assert.ok(call, 'the ship skill must show its Workflow invocation')
  const args = /args:\s*\{[^\n]*\}/.exec(call[0])
  assert.ok(args, 'the Workflow invocation must carry an args object')
  assert.ok(args[0].includes('pluginRoot'), 'the args must carry pluginRoot')
  assert.ok(
    args[0].includes('${CLAUDE_PLUGIN_ROOT}'),
    'pluginRoot must be given the ${CLAUDE_PLUGIN_ROOT} token, not a path the model composes'
  )
})

test('the spec skill tells authors not to split a section to buy parallelism', () => {
  // The mirror of the packing rule. An author who splits a section into
  // one-checkbox sections to "get more agents" serializes the change instead:
  // sections run in sequence, and the planner would have packed the siblings
  // into one lane anyway.
  const text = readFileSync(join(SKILLS_DIR, 'spec', 'SKILL.md'), 'utf8')
  assert.match(text, /Never split a section to buy parallelism/i)
  assert.match(text, /packs low-tier siblings in one section into a single lane/i)
  assert.match(text, /may ship solo/i, 'and must name solo as the small-change shape')
})

// ---------------------------------------------------------------------------
// Task-shape flag (--tdd / --no-tdd).
//
// The whole feature is prose: there is no CLI verb, no persisted field and no
// consumer that would fail if the instruction went missing. That is precisely
// the `interlock review --metrics` shape — an instruction nobody asserts
// silently stops running, and a spec skill that quietly forgot how to pick a
// shape reads exactly like one that never had the flag. So it is pinned on the
// day it lands, in tokens rather than sentences.
// ---------------------------------------------------------------------------

test('the spec skill publishes both task-shape flags where a user can find them', () => {
  const text = readFileSync(join(SKILLS_DIR, 'spec', 'SKILL.md'), 'utf8')
  const hint = /^argument-hint:.*$/m.exec(text)
  assert.ok(hint, 'the spec skill must publish an argument-hint')
  for (const flag of ['--tdd', '--no-tdd']) {
    assert.ok(hint[0].includes(flag), `the argument-hint must offer ${flag}`)
    // The table is the only place the flag's effect is stated. A hint without a
    // row is a flag the model sees and cannot interpret.
    assert.match(
      text,
      new RegExp(`^\\|\\s*\`${flag}\`\\s*\\|`, 'm'),
      `the flag table must carry a row for ${flag}`
    )
  }
})

test('the spec skill decides a task shape, and resolves the flags in a fixed order', () => {
  const text = readFileSync(join(SKILLS_DIR, 'spec', 'SKILL.md'), 'utf8')

  assert.match(text, /^#### Decide the task shape$/m, 'the shape decision needs its own heading')
  // Explicit beats inferred, and two contradicting explicit flags are a question
  // rather than a coin flip.
  assert.match(text, /`--tdd` or `--no-tdd` wins/i, 'an explicit flag must win')
  assert.match(text, /Both passed[\s\S]{0,80}ask/i, 'both flags together must ask, not guess')
  // The smart default, named by its criterion rather than by example.
  assert.match(text, /behaviour-critical/i, 'the default classifier needs its criterion named')
  assert.match(
    text,
    /pass\/fail core[\s\S]{0,120}before the code exists/i,
    'and the test that criterion actually applies'
  )
  assert.match(
    text,
    /Plumbing, wiring, config, prose and scaffolding are not/i,
    'and the excluded half — a criterion with no exclusions selects everything'
  )
  // Transience is the locked decision. A future edit that persists the shape as
  // an artifact field would make every downstream skill a consumer of it.
  assert.match(text, /shape is transient/i, 'the shape must stay transient')
  assert.match(
    text,
    /not written into `openspec\/changes\/<name>\/` as a field/i,
    'and say outright that it is not an artifact field'
  )
})

test('a bug fix keeps its repro-first task whichever way the shape flag points', () => {
  // The one precedence rule that is a correctness matter and not a preference:
  // `--no-tdd` suppresses a leading red section, and a repro is not one. A
  // reword that let the flag reach the repro would silently delete the only
  // pass/fail signal a bug fix has.
  const text = readFileSync(join(SKILLS_DIR, 'spec', 'SKILL.md'), 'utf8')
  assert.match(
    text,
    /`--no-tdd`[\s\S]{0,160}never relaxes the repro/i,
    'the skill must state that --no-tdd cannot reach the repro-first task'
  )
  assert.match(
    text,
    /repro-first task is not the TDD shape/i,
    'and keep the two rules distinct, so neither is read as the other'
  )
})

test('the TDD task shape carries both template markers and keeps the anti-split rule', () => {
  // The markers are the contract between this skill and whoever reads the
  // resulting tasks.md: without them a "TDD" file is indistinguishable from a
  // standard one whose tests happened to sort first.
  const text = readFileSync(join(SKILLS_DIR, 'spec', 'SKILL.md'), 'utf8')

  assert.match(text, /^#### Where the tests go$/m, 'the shape branch needs its own heading')
  assert.ok(text.includes('Failing tests first'), 'the leading red section needs its title marker')
  assert.ok(text.includes('make §1 green'), 'and later sections need the marker that satisfies it')

  // Reconciliation with rule 2. The anti-split rule predates this flag and is
  // the reason a leading test wave is even contentious; a shape branch that did
  // not say how the two coexist would read as repealing it.
  assert.match(
    text,
    /failing suite is one checkbox, not one checkbox per TDD beat/i,
    'the red wave must stay one checkbox — rule 2 is not repealed by the shape'
  )
  assert.match(text, /not a licen[cs]e to split/i)
  // And the standard shape is genuinely unchanged, which is what makes the
  // default path safe to leave alone.
  assert.match(
    text,
    /\*\*standard\*\*[\s\S]{0,120}unchanged/i,
    'the standard shape must be stated as unchanged from the four rules'
  )
})

test('the red-wave heading the spec skill writes is the one the CLI reads', () => {
  // The single prose↔code contract in this repo, asserted against the code
  // rather than against a copy of the string. `lib/run.mjs` resolves the task
  // shape from this heading; a reword on the skill side would silently stop
  // every TDD change from being detected as one, and nothing else would fail.
  // That is the `interlock review --metrics` failure exactly, so the two sides
  // are pinned to one another here.
  const text = readFileSync(join(SKILLS_DIR, 'spec', 'SKILL.md'), 'utf8')
  assert.ok(
    text.includes(RED_SECTION_MARKER),
    `the spec skill must write the marker lib/artifacts.mjs reads ("${RED_SECTION_MARKER}")`
  )
})

test('the spec skill states how ship treats the red wave, including the check it skips', () => {
  // Tier 2 made the red wave real: `lib/waves.mjs` keeps it in its own group,
  // runs it first (solo included), and SKIPS its inter-wave check because the
  // suite is expected to be failing there. Two things about that are load-
  // bearing for whoever writes the file and cannot be discovered from it —
  // that the heading is an exact-match contract, and that a skipped check means
  // nobody verifies the suite was genuinely red.
  const text = readFileSync(join(SKILLS_DIR, 'spec', 'SKILL.md'), 'utf8')

  assert.match(
    text,
    /reworded heading is not a smaller signal, it is no signal/i,
    'the exact-match nature of the heading must be stated — a near miss reads as an ordinary change'
  )
  assert.match(
    text,
    /own inter-wave check is skipped, by design/i,
    'the skipped check is the one surprising thing about the red wave'
  )
  assert.match(
    text,
    /cannot tell a genuinely failing suite from one that already passed/i,
    'and what that skip costs, since nothing downstream will say it'
  )
  assert.match(
    text,
    // Emphasis-tolerant: the skill bolds "next", and a pin that died on a pair
    // of asterisks would be deleted by the first edit that improved the prose.
    /next\W{0,4}section's check is the gate/i,
    'plus where the real gate moved to'
  )
  // The edge that used to abort the plan is now legal, and the skill has to
  // stop calling it a prohibition — but still steer away from it, because the
  // section boundary already provides the ordering.
  assert.match(text, /is now legal/i, 'an impl→red-wave edge is no longer a plan failure')
  assert.match(text, /leave it out anyway/i, 'and is still not the way to express the ordering')

  // Spoken at the checkpoint, which is the only place a human is looking.
  const handoff = text.indexOf('## 6. Hand off to the human')
  assert.ok(handoff !== -1, 'the handoff section must still exist for the report to live in')
  const closing = text.slice(handoff)
  assert.match(closing, /task shape/i, 'the handoff must report the shape it chose')
  assert.match(
    closing,
    /skip that wave's check/i,
    'and hand the reviewer the one question the run cannot answer for them'
  )

  // The reversal: nothing may claim the red wave IS verified. That would send a
  // reader looking for a checkpoint the planner deliberately does not spend.
  assert.doesNotMatch(
    text,
    /red wave[^.\n]{0,40}(?:is|gets) verified/i,
    'the skill must not imply the red wave is checked'
  )
})

test('fix-tests does not pre-approve an unrestricted shell', () => {
  const fm = parseFrontmatter(readFileSync(join(SKILLS_DIR, 'fix-tests', 'SKILL.md'), 'utf8'))
  const allowed = fm.values['allowed-tools'] || ''
  assert.doesNotMatch(allowed, /(^|\s)Bash(\s|$)/, 'a bare Bash grant pre-approves every command')
  assert.doesNotMatch(allowed, /Bash\(\*\)/)
})

test('fix-tests resolves the typecheck and lint commands, the only supplier a ship run has', () => {
  // The same class as the `--metrics` defect below. `planVerification` reads
  // `profile.typecheck.command` and `profile.lint.command`; nothing else in the
  // loop supplies either. If this skill stops filling them, both kinds are
  // skipped with `no-detectable-command` on every run forever, `typecheck` — a
  // HALTING kind at the inter-wave checkpoint — never runs, and nothing fails.
  // Tokens, not sentences, so the first reword does not delete the pin.
  const text = readFileSync(join(SKILLS_DIR, 'fix-tests', 'SKILL.md'), 'utf8')
  for (const token of ['typecheck.command', 'lint.command', 'scripts.typecheck', 'scripts.lint']) {
    assert.ok(text.includes(token), `fix-tests/SKILL.md no longer names ${token}`)
  }
  const contract = readFileSync(join(ROOT, 'shared', 'TEST-PROFILE.md'), 'utf8')
  for (const token of ['"typecheck"', '"lint"', 'typecheck.command', 'lint.command']) {
    assert.ok(contract.includes(token), `shared/TEST-PROFILE.md no longer defines ${token}`)
  }
})

test('fix-tests mirrors into an existing .claude/CLAUDE.md, never recreating a root one', () => {
  // A plugin repository keeps its instructions in `.claude/CLAUDE.md`, because
  // `claude plugin validate --strict` rejects a `CLAUDE.md` at the plugin root.
  // A mirror that only knew the root file would create one there and turn that
  // repository's CI red. Tokens, not sentences.
  const text = readFileSync(join(SKILLS_DIR, 'fix-tests', 'SKILL.md'), 'utf8')
  assert.ok(text.includes('.claude/CLAUDE.md'), 'fix-tests/SKILL.md no longer names .claude/CLAUDE.md')
  const contract = readFileSync(join(ROOT, 'shared', 'TEST-PROFILE.md'), 'utf8')
  for (const token of ['.claude/CLAUDE.md', 'AGENTS.md', 'validate --strict']) {
    assert.ok(contract.includes(token), `shared/TEST-PROFILE.md no longer names ${token}`)
  }
})

test('both review skills request review-metrics emission on their gated command line', () => {
  // This is the assertion the defect it guards did not have. `--metrics` existed
  // on `interlock review` for a year and no skill ever passed it, so the
  // report's review-finding indicators read "unobserved" the entire time — not
  // because nothing was reviewed, but because nothing recorded that it had
  // been. Nothing fails when a skill drops the flag; the corpus just quietly
  // stays empty, and an empty corpus reads exactly like a loop that never ran.
  //
  // So the pin is here rather than in prose. Both gated review paths are
  // covered: `review-code` reaches a verdict through `interlock review`,
  // `review-artifacts` through `interlock gate`.
  const paths = {
    'review-code': /interlock review [^\n]*--metrics/,
    'review-artifacts': /interlock gate [^\n]*--metrics/
  }

  for (const [skill, pattern] of Object.entries(paths)) {
    const file = join(SKILLS_DIR, skill, 'SKILL.md')
    assert.ok(existsSync(file), `${skill}/SKILL.md must exist for this pin to mean anything`)
    const text = readFileSync(file, 'utf8')
    assert.match(
      text,
      pattern,
      `${skill} must pass --metrics on its gated command line, or its review path becomes ` +
        'permanently invisible to `interlock report`'
    )
    assert.match(
      text,
      /--metrics <change>/,
      `${skill} must pass a change name to --metrics — the flag refuses a missing value, and ` +
        'no name is ever inferred from the findings file'
    )
  }
})

test('bootstrap instructs a per-path corpus-persistence report via git check-ignore', () => {
  // Same hazard as the --metrics pin above: this step is prose, nothing consumes
  // its output, and a reword that drops a corpus path or swaps the matcher for a
  // hand-rolled .gitignore read fails nothing. It just quietly stops asking the
  // question it exists to ask.
  //
  // Tokens, not sentences. A pin that matched a phrase would be deleted by the
  // first edit that improved the wording, which removes the only mitigation the
  // step has.
  const text = readFileSync(join(SKILLS_DIR, 'bootstrap', 'SKILL.md'), 'utf8')

  for (const corpus of ['.claude/ship/', '.claude/learning/', '.claude/metrics/']) {
    assert.ok(
      text.includes(corpus),
      `bootstrap must report the persistence posture of ${corpus} — a corpus it stops naming is ` +
        'one nobody is asked about'
    )
  }

  assert.match(
    text,
    /git check-ignore/,
    'bootstrap must observe exclusion with git check-ignore, not by reading .gitignore — git ' +
      'own matcher handles negation, nested files, info/exclude and the global excludes file'
  )
})

test('bootstrap declares the permission its corpus-persistence step needs, narrowly', () => {
  // The step instructs `git check-ignore`, and bootstrap's grant had no git verb
  // at all. Shipping the instruction without the permission is worse than
  // shipping neither: the denial lands at runtime on a consumer's repo, and
  // because a failed check is routed to the "undetermined" branch, it is
  // indistinguishable from a repo with no .gitignore — so the step reports
  // "undetermined" on every repo forever and looks like it is working.
  const fm = parseFrontmatter(readFileSync(join(SKILLS_DIR, 'bootstrap', 'SKILL.md'), 'utf8'))
  const allowed = fm.values['allowed-tools'] || ''

  assert.match(
    allowed,
    /Bash\(git check-ignore \*\)/,
    'bootstrap instructs `git check-ignore` but its allowed-tools does not admit it; the ' +
      'instructed command would be denied at runtime'
  )
  assert.doesNotMatch(
    allowed,
    /Bash\(git \*\)/,
    'the grant must stay narrowed to the check-ignore verb — the step uses no other git command'
  )
})

test('spec, bootstrap and dispatch probe the openspec CLI before the first command that needs it', () => {
  // A person who skipped the install docs has no `openspec` on PATH. Without a
  // probe, spec asks for intent and explores before dying at `openspec new
  // change`, bootstrap dies at `openspec init`, and dispatch reads the absent
  // CLI as an empty project and routes a fresh repo to a skill that dies. The
  // probe must come first, name the missing CLI, and quote the doctor's install
  // command — the one spelling, held here against lib/doctor.mjs.
  const cases = [
    { dir: 'spec', first: /^openspec new change /m, installGuard: true },
    { dir: 'bootstrap', first: /openspec init/, installGuard: true },
    { dir: 'dispatch', first: /^openspec list/m, installGuard: false }
  ]
  for (const { dir, first, installGuard } of cases) {
    const text = readFileSync(join(SKILLS_DIR, dir, 'SKILL.md'), 'utf8')
    const probe = text.search(/^openspec --version$/m)
    const needs = text.search(first)
    assert.ok(probe >= 0, `${dir} must probe the CLI with a bare \`openspec --version\` line`)
    assert.ok(needs >= 0, `${dir}: the first command that needs the CLI moved; update this pin`)
    assert.ok(probe < needs, `${dir} probes the CLI after ${first} — the stop must come first`)
    assert.ok(text.includes('command not found'), `${dir} must say what a missing CLI looks like`)
    assert.ok(text.includes(OPENSPEC_INSTALL), `${dir} must quote the doctor's install command: ${OPENSPEC_INSTALL}`)
    // An installed CLI that crashes (Node below OpenSpec's floor) is not a
    // missing one, and reinstalling @latest does not fix it.
    assert.ok(text.includes('does not run'), `${dir} must tell an installed-but-failing CLI apart from a missing one`)
    if (installGuard) {
      assert.ok(text.includes('20.19.0'), `${dir} must name OpenSpec's Node floor`)
      assert.match(text, /(?:do not|never)[^.]{0,40}install/i, `${dir} must forbid installing the CLI itself`)
    }
    const fm = parseFrontmatter(text)
    assert.match(fm.values['allowed-tools'] || '', /Bash\(openspec \*\)/,
      `${dir}'s allowed-tools must admit the \`openspec --version\` probe`)
  }
})

test('bootstrap carries an explicit no-write instruction for .gitignore', () => {
  // The boundary this change was scoped around: bootstrap is invoked to produce
  // specs, and editing an unrelated file it was not asked to touch is a surprise
  // in someone's diff, not a service.
  //
  // Asserted POSITIVELY, and the first draft of this test is why. It tried to
  // assert the absence of write-like phrasing near `.gitignore` and failed on
  // the skill's own prohibition — "Never write to `.gitignore`" contains
  // "write to .gitignore". Prose cannot be checked for the absence of a phrase
  // whose negation contains it. So: require the prohibition to be present, and
  // separately forbid the one form that is unambiguous in any context, a shell
  // redirect into the file.
  const text = readFileSync(join(SKILLS_DIR, 'bootstrap', 'SKILL.md'), 'utf8')

  assert.match(
    text,
    /never write to\s+`?\.gitignore/i,
    'bootstrap must state the prohibition outright — a step that merely omits a write ' +
      'instruction invites one back at the next edit'
  )

  for (const redirect of [/>>?\s*`?\.gitignore/, /tee\s+(?:-a\s+)?`?\.gitignore/]) {
    assert.doesNotMatch(
      text,
      redirect,
      `bootstrap must name the recommended entries, never apply them: ${redirect}`
    )
  }
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

test('ship trampoline treats GOAL MET as satisfying an active /goal', () => {
  const text = readFileSync(join(SKILLS_DIR, 'ship', 'SKILL.md'), 'utf8')
  assert.match(text, /GOAL MET: interlock ship/)
  assert.match(text, /\/goal/)
  assert.match(text, /Leftover.*not.*continue the goal|do not continue the goal/i)
})

test('spec checkpoint prints GOAL MET and does not use /goal to skip it', () => {
  const text = readFileSync(join(SKILLS_DIR, 'spec', 'SKILL.md'), 'utf8')
  assert.match(text, /GOAL MET: interlock spec stopped at the checkpoint/)
  assert.match(text, /Do not (call|invoke|run) \/goal|\/goal must not skip the checkpoint|does not skip the checkpoint/i)
})

test('the spec checkpoint pushes before it prints GOAL MET, so a waiting human is told', () => {
  // A prose instruction nobody asserts silently stops running. The ORDER is
  // half the instruction: a push after the goal line is a push the session may
  // never reach, and the checkpoint's whole point is that it waits.
  const text = readFileSync(join(SKILLS_DIR, 'spec', 'SKILL.md'), 'utf8')
  const push = text.indexOf('interlock notify checkpoint')
  const goal = text.indexOf('GOAL MET: interlock spec stopped at the checkpoint')
  assert.ok(push !== -1, 'the spec skill no longer tells a waiting human that it is waiting')
  assert.ok(goal !== -1)
  assert.ok(push < goal, 'the push must come before the goal line, not after the session may have stopped')
  // And it is unconditional: the CLI, not the skill, decides whether a topic
  // is configured, so the skill must not be told to check first.
  assert.match(text, /no-op|exits 0|unconditionally/i)
})

test("the spec flow's gate lines ask for JSON and say which field is the verdict", () => {
  // The `--metrics` precedent again: a flag on a skill line that nothing
  // asserts is a flag the first reword drops, and nothing fails when it goes.
  // Each gate line asks the CLI for JSON, and the sentence beside it names the
  // field the exit code is computed from. The exit code stays the verdict.
  //
  // Command lines are anchored (`^…$`, `m`) so a prose mention of the command
  // cannot satisfy the pin. Field tokens, never sentences.
  const pins = {
    spec: {
      lines: {
        'interlock ledger … --json': /^interlock ledger [^\n]*--json$/m,
        'interlock validate … --json': /^interlock validate [^\n]*--json$/m
      },
      tokens: ['`blocking`', '`invalidRows`', '`ready`', '`problems`', 'autonomyOutcome.blockers']
    },
    'review-artifacts': {
      lines: {
        'interlock validate … --json': /^interlock validate [^\n]*--json$/m,
        'interlock gate … --json': /^interlock gate [^\n]*--json$/m
      },
      tokens: ['`passed`', '`malformed`', '`problems`', 'autonomyOutcome.blockers']
    }
  }

  for (const [skill, { lines, tokens }] of Object.entries(pins)) {
    const where = `skills/${skill}/SKILL.md`
    const text = readFileSync(join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8')
    for (const [name, pattern] of Object.entries(lines)) {
      assert.match(text, pattern, `${where} no longer runs \`${name}\` on a command line of its own`)
    }
    for (const token of tokens) {
      assert.ok(text.includes(token), `${where} no longer names ${token} in its reading sentence`)
    }
  }

  // The autonomy record's count comes from the gate's field, and the skill
  // says so in a prohibition rather than merely mentioning prose.
  const spec = readFileSync(join(SKILLS_DIR, 'spec', 'SKILL.md'), 'utf8')
  assert.match(
    spec,
    /(?:never|do not|must not)[^.]{0,60}count[^.]{0,60}prose/i,
    'skills/spec/SKILL.md must forbid taking the autonomy blocker count from prose'
  )

  const review = readFileSync(join(SKILLS_DIR, 'review-artifacts', 'SKILL.md'), 'utf8')
  assert.match(
    review,
    /exit (?:status|code)[^.]{0,40}verdict/i,
    'skills/review-artifacts/SKILL.md must keep saying the exit status is the verdict'
  )
  assert.match(
    review,
    /(?:do not|never|must not)[^.]{0,60}re-derive the verdict/i,
    'skills/review-artifacts/SKILL.md must keep forbidding a verdict re-derived in prose'
  )
})

test('the lines an observer of the spec flow keys on are pinned, in the flow\'s order', () => {
  // An observer of the spec flow reads these lines off the Bash tool results,
  // so a reword that drops one blinds it without failing anything — the
  // `--metrics` shape once more. Each is matched on its command line, never on
  // a prose mention (`interlock ledger` and `openspec status … --json` are
  // both mentioned in prose too), and the order is asserted because
  // reordering the gates is a behaviour change that should fail by name.
  const where = 'skills/spec/SKILL.md'
  const text = readFileSync(join(SKILLS_DIR, 'spec', 'SKILL.md'), 'utf8')
  const chain = [
    ['interlock drift --json', /^interlock drift --json$/m],
    ['openspec new change', /^openspec new change /m],
    ['openspec status --change … --json', /^openspec status --change [^\n]*--json$/m],
    ['interlock note match … --json', /^interlock note match [^\n]*--json$/m],
    ['interlock ledger … --json', /^interlock ledger [^\n]*--json$/m],
    ['interlock validate … --json', /^interlock validate [^\n]*--json$/m],
    ['/interlock:review-artifacts', /\/interlock:review-artifacts/],
    ['interlock autonomy record review-artifacts --blockers', /^interlock autonomy record review-artifacts --blockers/m],
    ['interlock autonomy clean review-artifacts explore spec', /^interlock autonomy clean review-artifacts explore spec$/m],
    ['interlock notify checkpoint', /^interlock notify checkpoint /m],
    ['GOAL MET', /GOAL MET: interlock spec stopped at the checkpoint/]
  ]

  const positions = chain.map(([name, pattern]) => {
    const at = text.search(pattern)
    assert.ok(at !== -1, `${where} no longer carries \`${name}\``)
    return at
  })
  for (let i = 1; i < chain.length; i++) {
    assert.ok(
      positions[i - 1] < positions[i],
      `${where}: \`${chain[i - 1][0]}\` must come before \`${chain[i][0]}\``
    )
  }
})

test('the spec skill reads the note match line by field, and a failed match never stops the spec', () => {
  // replace-subagent-advisors-with-advisor-tool D3: the spec skill is now the
  // compound notes' reader. Tokens, not sentences, read in the span from the
  // fenced line to the ledger section.
  const where = 'skills/spec/SKILL.md'
  const text = readFileSync(join(SKILLS_DIR, 'spec', 'SKILL.md'), 'utf8')
  const from = text.search(/^interlock note match "<name>" --json$/m)
  assert.ok(from !== -1, `${where} no longer fences \`interlock note match "<name>" --json\``)
  const to = text.indexOf('### 3a. ', from)
  assert.ok(to !== -1, `${where}: the note match line must come before \`### 3a. \``)
  const span = text.slice(from, to)
  for (const token of ['`rows`', '`unreadable`', 'first output line', 'ledger row']) {
    assert.ok(span.includes(token), `${where} no longer names ${token} beside the note match line`)
  }
  const handOff = text.slice(text.indexOf('## 6. '))
  assert.ok(handOff.includes('Compound notes') && handOff.includes('`rows`'), `${where} §6 must report the matched-notes count`)
})

test('the spec skill forbids configuring the advisor tool and reports its use at the hand-off', () => {
  // replace-subagent-advisors-with-advisor-tool, specs/advisor-tool: tokens, not sentences.
  const where = 'skills/spec/SKILL.md'
  const text = readFileSync(join(SKILLS_DIR, 'spec', 'SKILL.md'), 'utf8')
  for (const token of ['/advisor', 'advisorModel', 'ledger row', 'not available in this session', 'retried', 'own account', 'spec meter']) {
    assert.ok(text.includes(token), `${where} no longer names ${token}`)
  }
  const s3 = text.slice(text.indexOf('## 3. '), text.indexOf('## 4. '))
  assert.match(s3, /\*\*Advisor tool\.\*\*/, `${where} §3 lost its Advisor tool bullet`)
  for (const token of ['/advisor', 'advisorModel', 'ledger row', 'retried']) {
    assert.ok(s3.includes(token), `${where} §3's Advisor tool bullet no longer names ${token}`)
  }
  const s6 = text.slice(text.indexOf('## 6. '))
  for (const token of ['not available in this session', 'own account', 'spec meter']) {
    assert.ok(s6.includes(token), `${where} §6 no longer names ${token}`)
  }
})

test('no shipped skill asks the session to consult the advisor tool', () => {
  // D2: Interlock asks for no consult. A line that names consulting the
  // advisor together with "before" is a request to consult ahead of a step.
  const offenders = filesUnder(SKILLS_DIR, '.md').flatMap(file =>
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /consult/i.test(line) && /advisor/i.test(line) && /\bbefore\b/i.test(line))
      .map(({ n }) => `${file.slice(ROOT.length + 1)}:${n}`)
  )
  assert.deepEqual(offenders, [], 'a skill line asks the session to consult the advisor')
})

/** Every fenced line in a skill file, with the file it came from. */
function fencedLines(file) {
  const out = []
  let fenced = false
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) out.push(line.trim())
  }
  return out
}

test('no skill runs the removed advisor subcommands, and the spec skill spawns no advisor agent', () => {
  // replace-subagent-advisors-with-advisor-tool D1: the subagent advisors and
  // their CLI brackets are gone, so a fenced line naming them would run a
  // command the CLI refuses.
  const offenders = filesUnder(SKILLS_DIR, '.md').flatMap(file =>
    fencedLines(file)
      .filter(line => /^interlock (?:advisor|review-advisor)(?:\s|$)/.test(line))
      .map(line => `${file.slice(ROOT.length + 1)}: ${line}`)
  )
  assert.deepEqual(offenders, [], 'a fenced skill line runs interlock advisor or interlock review-advisor')

  const where = 'skills/spec/SKILL.md'
  const text = readFileSync(join(SKILLS_DIR, 'spec', 'SKILL.md'), 'utf8')
  assert.ok(!text.includes('subagent_type: "interlock:advisor"'), `${where} still spawns the advisor agent`)
  const fm = parseFrontmatter(text)
  assert.doesNotMatch(fm.values['allowed-tools'] || '', /\bAgent\b/, `${where}'s allowed-tools still admits Agent`)
  assert.doesNotMatch(fm.values.description || '', /advisor\.md/, `${where}'s description still names advisor.md`)
})

test('the review-code skill shows specGap in its emit shape and derives notes after the gate', () => {
  const where = 'skills/review-code/SKILL.md'
  const skill = readFileSync(join(SKILLS_DIR, 'review-code', 'SKILL.md'), 'utf8')
  const s2 = skill.slice(skill.indexOf('## 2. '), skill.indexOf('## 3. '))
  const emit = s2.match(/```json([\s\S]*?)```/)
  assert.ok(emit, `${where} §2's emit shape fence was not found`)
  assert.ok(emit[1].includes('"specGap"'), `${where} §2's emit shape must carry the optional specGap field`)
  assert.ok(
    s2.split('\n').some(line => /optional/.test(line) && line.includes('specGap')),
    `${where} §2's optional-field sentence must name specGap`
  )

  const s4 = skill.slice(skill.indexOf('## 4. '), skill.indexOf('## 5. '))
  const gate = s4.search(/^interlock gate --findings /m)
  const derive = s4.search(/^interlock note derive --findings [^\n]*/m)
  assert.ok(gate !== -1, `${where} §4 no longer runs the gate line`)
  assert.ok(derive !== -1, `${where} §4 must run \`interlock note derive --findings\` on a command line`)
  assert.ok(gate < derive, `${where} §4 must derive notes after the gate line`)
  for (const token of ['COMPOUND NOTES NOT WRITTEN', 'do not retry']) {
    assert.ok(s4.includes(token), `${where} §4 no longer names ${token}`)
  }
})

test('review-code names no --advisor flag and no findings consult', () => {
  // replace-subagent-advisors-with-advisor-tool: the findings advisor is gone.
  const where = 'skills/review-code/SKILL.md'
  const skill = readFileSync(join(SKILLS_DIR, 'review-code', 'SKILL.md'), 'utf8')
  const hint = parseFrontmatter(skill).values['argument-hint'] || ''
  assert.doesNotMatch(hint, /--advisor/, `${where}'s argument hint names --advisor`)
  assert.doesNotMatch(skill, /--advisor/, `${where} names an --advisor flag`)
  assert.doesNotMatch(skill, /review-advisor/, `${where} names review-advisor`)
  assert.equal(skill.split(/^## 4a\. /m).length, 1, `${where} still carries a \`## 4a. \` section`)
  // The review line keeps the bookkeeping flag and --base.
  assert.match(skill, /interlock review [^\n]*--metrics/, `${where} lost --metrics on the review line`)
  assert.match(skill, /interlock review [^\n]*--base/, `${where} lost --base on the review line`)
})

test('only the domain and technical-lead briefs tell a reviewer to set specGap', () => {
  const dir = join(SKILLS_DIR, 'review-code', 'dimensions')
  for (const file of readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
    const text = readFileSync(join(dir, file), 'utf8')
    if (file === 'domain.md' || file === 'technical-lead.md') {
      assert.ok(text.includes('specGap'), `skills/review-code/dimensions/${file} must say when to set specGap`)
    } else {
      assert.ok(!text.includes('specGap'), `skills/review-code/dimensions/${file} must not mention specGap`)
    }
  }
})

test('the evals skill still names llm and baseline as the two grader types that call a judge', () => {
  // A fourth spelling of the judged set: it classifies nothing, but it is
  // pinned beside JUDGED_GRADER_TYPES so the prose cannot drift from it.
  const text = readFileSync(join(SKILLS_DIR, 'evals', 'SKILL.md'), 'utf8')
  assert.match(text, /call a judge[\s\S]{0,20}`llm`,?\s+`baseline`/, 'skills/evals/SKILL.md must name `llm` and `baseline` as the judge-calling types')
})

test('no skill prose names a model', () => {
  const offenders = filesUnder(SKILLS_DIR, '').filter(f => readFileSync(f, 'utf8').includes('opus'))
  assert.deepEqual(offenders.map(f => f.slice(ROOT.length + 1)), [], 'files under skills/ name `opus`')
})

test('ship trampoline forbids a second Workflow call after the first returns', () => {
  const text = readFileSync(join(SKILLS_DIR, 'ship', 'SKILL.md'), 'utf8')
  assert.match(text, /Do not call Workflow again/i)
  assert.match(text, /Leftover.*not authorization|not authorization to call Workflow/i)
})

test('dispatch does not auto-route leftover boxes to ship after a run just returned', () => {
  const dispatch = readFileSync(join(SKILLS_DIR, 'dispatch', 'SKILL.md'), 'utf8')
  assert.match(dispatch, /Leftover unchecked|after a ship workflow/i)
  assert.match(dispatch, /Do not route to ship/i)
  const continuity = readFileSync(join(SKILLS_DIR, 'spec', 'continuity.md'), 'utf8')
  assert.match(continuity, /Do not call Workflow again|never launch a second/i)
})

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

test('every handoff pointer is scoped to explore briefs, never the whole directory', () => {
  // `.claude/handoff/` holds two unrelated artifacts: `explore-*.md` briefs,
  // which are session context a later skill is meant to read, and `ship-*.md`
  // halt resume cards, which are records of runs that already stopped and which
  // nothing reads. The prefix is the only thing keeping them apart, so an
  // unqualified "read the latest handoff" hands a model a halt card as if it
  // were a brief — the one way a record becomes a trigger.
  const targets = [
    join(ROOT, 'shared', 'TOOL-ECONOMY.md'),
    join(ROOT, 'shared', 'EXPLORE-BRIEF.md'),
    join(SKILLS_DIR, 'dispatch', 'SKILL.md'),
    join(SKILLS_DIR, 'spec', 'SKILL.md')
  ]
  const offenders = []
  for (const abs of targets) {
    if (!existsSync(abs)) continue
    const text = readFileSync(abs, 'utf8')
    for (const [, glob] of text.matchAll(/\.claude\/handoff\/([^\s`)"']*)/g)) {
      // A bare directory reference is fine when it is not an instruction to
      // READ one; what must never appear is a glob that would match a card.
      if (/^(\*|[^e])/.test(glob)) offenders.push(`${abs.slice(ROOT.length + 1)}: .claude/handoff/${glob}`)
    }
  }
  assert.deepEqual(offenders, [], `handoff pointers that would match a ship halt card: ${offenders.join(', ')}`)

  const economy = readFileSync(join(ROOT, 'shared', 'TOOL-ECONOMY.md'), 'utf8')
  assert.match(economy, /explore-\*\.md/, 'Rule 3 must name the explore glob, not "the latest handoff"')
  assert.doesNotMatch(
    economy,
    /and the latest handoff\./,
    'the unqualified form is what points a session-start read at a halt card'
  )
})

test('the report skill quotes the command and recomputes nothing', () => {
  // `interlock review --metrics` existed for a year and no skill ever passed it:
  // the corpus stayed empty and read exactly like a loop that never ran. The
  // report skill's contract has the same shape — it is prose, and prose nobody
  // asserts silently stops running. These are the three tokens that make the
  // figures the CLI's rather than the model's.
  //
  // Tokens, never sentences: a reword must survive the pin, and a reversal of
  // meaning must not.
  const text = readFileSync(join(SKILLS_DIR, 'report', 'SKILL.md'), 'utf8')

  assert.match(text, /interlock report --json/, 'the command the figures are quoted from')
  assert.match(text, /Never recompute/, 'the rule that keeps the model out of the arithmetic')
  assert.match(text, /Licenses nothing/, 'the form an unobserved indicator is reported in')
})

test('the continuity procedure passes --findings and forbids a transcribed blocker count', () => {
  // The number that decides whether a human reads a spec must not be written by
  // the agent being gated. `interlock ready` derives it from the artifact
  // review's own findings file, and the only thing standing between that and a
  // model composing a tidy `{blockers: 0}` is this instruction — which, until
  // now, nothing asserted. The leftover Workflow pin below covers a different
  // contract entirely and never covered this one.
  const text = readFileSync(join(SKILLS_DIR, 'spec', 'continuity.md'), 'utf8')

  assert.match(text, /interlock ready/, 'the gate the procedure asks')
  assert.match(text, /--findings/, 'and the flag that hands it evidence rather than a count')
  // Tokens, not the sentence: `blocker count` is the distinctive noun phrase,
  // and the second assert requires it to sit inside a prohibition rather than
  // merely appear. A reword ("Never write a file holding a blocker count")
  // survives both; deleting the instruction, or flipping it into an
  // instruction to compose one, fails the second.
  assert.match(text, /blocker count/i, 'the value the gated party must never supply')
  assert.match(
    text,
    /(?:do not|never|must not)[^.]{0,80}blocker count/i,
    'and it is named in a prohibition, not merely mentioned'
  )
  // The readiness verdict crosses the Bash tool as JSON on the one path where
  // the spec flow hands over to ship. Anchored on the fenced line, so a
  // `--json` on some other line of the procedure does not satisfy it.
  assert.match(
    text,
    /^interlock ready [^\n]*--findings[^\n]*--json$/m,
    'skills/spec/continuity.md: the readiness line must keep --json beside --findings'
  )
})

test('the evals skill admits a captured skeleton as evidence, and refuses an unresolved one', () => {
  // The pin the `--metrics` defect argues for: an instruction nobody asserts
  // silently stops running. `interlock evals capture` exists to make a failed
  // run citable, and a skill that never names it leaves the command unreachable
  // in exactly the way `interlock review --metrics` was for a year.
  //
  // Distinguishing tokens, never whole sentences: a reword must not delete the
  // pin, but a reversal of meaning must not survive it.
  const text = readFileSync(join(SKILLS_DIR, 'evals', 'SKILL.md'), 'utf8')

  assert.match(text, /interlock evals capture/, 'the command a consumer files a failure with')
  assert.match(text, /captured skeleton/i, 'a skeleton is named among the admissible evidence')
  assert.match(text, /draft, not a finished case/i, 'and it is a draft rather than a case')
  assert.match(text, /CONFIRM/, 'the marker capture leaves on every derived value')
  assert.match(
    text,
    /Never\s+author a case that still carries one/i,
    'the rule that keeps an unconfirmed pattern out of the suite'
  )

  // The reversal: nothing may describe a skeleton as ready to run or to file
  // unchanged. Capture refuses to write into evals/ precisely so that a human
  // decides, and prose telling them not to bother would undo the refusal.
  assert.doesNotMatch(text, /skeleton[^.]*(?:ready to (?:run|file)|as[- ]is|without review)/i)
})

test('the evals skill requires a transcript to be read before a judged case is explained', () => {
  // The same pin, for the same reason, against the same precedent:
  // `interlock review --metrics` was an instruction in a skill that nobody
  // asserted, so it silently stopped running and the corpus it fed stayed empty
  // for a year while reading exactly like a loop that never fired. This
  // instruction — read a trace before you explain a judged score — has the same
  // shape and would fail the same way. It is pinned here on the day it lands.
  //
  // Tokens, never sentences: a reword must not delete the pin, and pinning a
  // sentence would guarantee the first edit does exactly that.
  const text = readFileSync(join(SKILLS_DIR, 'evals', 'SKILL.md'), 'utf8')

  assert.match(text, /transcripts read:/, 'the report line that names what was read')
  assert.match(
    text,
    /transcripts read:\s*none/,
    'the explicit none-form — an omitted line cannot be told from an unexamined result'
  )
  assert.match(
    text,
    /transcripts read:\s*unavailable, because/,
    'the unavailable-form, so a run with no readable trace is spoken rather than silent'
  )
  assert.match(text, /judged grader/i, 'the condition the step applies to')
  assert.match(
    text,
    // Whitespace-tolerant on purpose: the skill body is hard-wrapped, so a
    // literal space between the tokens would break the pin on a rewrap.
    /read\s+at\s+least\s+one\s+transcript[\s\S]{0,120}before\s+you\s+write\s+your\s+explanation/i,
    'the ordering the requirement is about: transcript first, explanation second'
  )

  // The reversal: reading is for explanation and never for reclassification.
  // A skill that let a transcript overturn triage would reintroduce exactly the
  // re-argued verdict the exit-code contract exists to prevent.
  assert.match(text, /never for reclassification/i, 'reading does not overturn the verdict')
})

// --- compiled-repo fit (change: fit-ship-and-graph-to-compiled-repos) ---------
// Tokens, not sentences: a reword must not delete the pin.

test('the graph skill names the compiled-repo extensions, the INFERRED tier and the unreadable banner', () => {
  const text = readFileSync(join(SKILLS_DIR, 'graph', 'SKILL.md'), 'utf8')
  for (const token of ['.cs', '.csproj', '.bicep', 'INFERRED', 'GRAPH SKIPPED UNREADABLE']) {
    assert.ok(text.includes(token), `skills/graph/SKILL.md must carry ${token}`)
  }
})

test('the fix-tests skill names the profile timeout field', () => {
  const text = readFileSync(join(SKILLS_DIR, 'fix-tests', 'SKILL.md'), 'utf8')
  assert.ok(text.includes('timeout_ms'), 'skills/fix-tests/SKILL.md must carry timeout_ms')
})

test('the fix-tests skill states the unit and the type of the timeout it records', () => {
  // `validateProfile` aborts planning on a non-integer, and a value written in
  // seconds reads as an allowance a thousand times too small — which leaves the
  // budget at the floor with the floor banner suppressed, because the profile
  // "had its say". The instruction has to carry both words on the line that
  // names the field.
  const text = readFileSync(join(SKILLS_DIR, 'fix-tests', 'SKILL.md'), 'utf8')
  const line = text.split('\n').find(l => l.includes('unit.timeout_ms') && l.includes('wall time'))
  assert.ok(line, 'skills/fix-tests/SKILL.md must say what unit.timeout_ms is recorded from')
  for (const token of ['milliseconds', 'integer']) {
    assert.ok(line.includes(token), `the timeout_ms instruction must carry "${token}"`)
  }
})

test('the graph skill names the line a query prints for a partial graph', () => {
  const text = readFileSync(join(SKILLS_DIR, 'graph', 'SKILL.md'), 'utf8')
  assert.ok(text.includes('GRAPH PARTIAL'), 'skills/graph/SKILL.md must carry GRAPH PARTIAL')
  // The marker the skill names is the one the CLI prints.
  const paths = readFileSync(join(ROOT, 'lib', 'graph', 'paths.mjs'), 'utf8')
  assert.ok(paths.includes("'GRAPH PARTIAL'"), 'lib/graph/paths.mjs no longer defines the GRAPH PARTIAL marker')
})

test('the bootstrap skill banners a partial graph and names the compiled languages the graph indexes', () => {
  // `interlock-graph build` exits 0 past a path it cannot read, so the exit code
  // bootstrap branches on no longer says the graph is whole. The skill has to
  // branch on the summary line as well, or a partial graph is reported as a
  // complete one.
  const text = readFileSync(join(SKILLS_DIR, 'bootstrap', 'SKILL.md'), 'utf8')
  for (const token of ['GRAPH PARTIAL', 'skipped=', 'GRAPH SKIPPED UNREADABLE', '.cs', '.bicep']) {
    assert.ok(text.includes(token), `skills/bootstrap/SKILL.md must carry ${token}`)
  }
  // The sentence the snippet greps for is the sentence the CLI prints: a reword
  // on either side has to fail here, not silently stop matching.
  const phrase = 'nothing indexable under the root could be read'
  const cli = readFileSync(join(ROOT, 'lib', 'graph', 'cli.mjs'), 'utf8')
  assert.ok(text.includes(phrase), 'the bootstrap snippet no longer greps for the nothing-readable notice')
  assert.ok(cli.includes(phrase), 'lib/graph/cli.mjs no longer prints the notice the bootstrap snippet greps for')
})

test('the shared test profile ties timeout_ms to the inter-wave budget in one row or paragraph', () => {
  const text = readFileSync(join(ROOT, 'shared', 'TEST-PROFILE.md'), 'utf8')
  const blocks = text.split(/\n\s*\n/)
  const together = blocks.some(block =>
    block.split('\n').some(line => line.includes('timeout_ms') && line.includes('inter-wave')) ||
    (!block.includes('|') && block.includes('timeout_ms') && block.includes('inter-wave'))
  )
  assert.ok(together, 'shared/TEST-PROFILE.md must carry timeout_ms and inter-wave in the same row or paragraph')
})

test('the review-code skill lists the eight dimensions, runs domain-context before fan-out, and passes --base to the review and review-policy lines', () => {
  // Tokens, not sentences: each is what the skill must still say after a reword.
  const skill = readFileSync(join(SKILLS_DIR, 'review-code', 'SKILL.md'), 'utf8')
  for (const token of [
    'interlock domain-context',
    'dimensions/domain.md',
    'DOMAIN REVIEW SKIPPED',
    'list the eight'
  ]) {
    assert.ok(skill.includes(token), `skills/review-code/SKILL.md must carry ${token}`)
  }
  assert.ok(!skill.includes('list the six'), 'skills/review-code/SKILL.md still lists six dimensions')
  assert.ok(!skill.includes('list the seven'), 'skills/review-code/SKILL.md still lists seven dimensions')
  assert.match(skill, /interlock review-policy [^\n]*--base/, 'the review-policy line must pass --base')
  assert.match(skill, /interlock review [^\n]*--base/, 'the review line must pass --base')
  assert.match(skill, /interlock domain-context [^\n]*--base/, 'the domain-context line must pass --base')
  assert.ok(
    skill.indexOf('interlock domain-context') < skill.indexOf('Spawn one agent per dimension'),
    'domain-context must run before the fan-out'
  )

  // `requirement` in the emit shape: inside the json fence that defines it.
  const emit = skill.match(/Every dimension agent returns findings in this shape:\s*```json([\s\S]*?)```/)
  assert.ok(emit, 'the review-code emit shape fence was not found')
  assert.ok(emit[1].includes('"requirement"'), 'the emit shape must carry the optional requirement field')

  // The brief the table names exists, and a name the table lists resolves to a file.
  assert.ok(existsSync(join(SKILLS_DIR, 'review-code', 'dimensions', 'domain.md')))
})

test('the devops rubric checks CI triggers, token scope, floating installs, untrusted expressions and action bumps', () => {
  // `interlock surface` routes CI configuration to this dimension; without these
  // the reviewer it routes to asks only about environment and dependencies.
  const rubric = readFileSync(join(SKILLS_DIR, 'review-code', 'dimensions', 'devops.md'), 'utf8')
  for (const token of [
    'workflow_run',
    'pull_request_target',
    'head_repository',
    'permissions:',
    '@latest',
    'npx',
    'github.event',
    'env:',
    'runs.using'
  ]) {
    assert.ok(rubric.includes(token), `skills/review-code/dimensions/devops.md must carry ${token}`)
  }
})

test('the domain rubric asks for a requirement citation, names the prohibition keyword, and refuses capabilities it was not given', () => {
  const rubric = readFileSync(join(SKILLS_DIR, 'review-code', 'dimensions', 'domain.md'), 'utf8')
  for (const token of ['requirement', 'SHALL NOT', 'were not given', 'blocker', 'warning']) {
    assert.ok(rubric.includes(token), `skills/review-code/dimensions/domain.md must carry ${token}`)
  }
})

test('the review-code skill runs blast-radius from the graph, says when it skipped it, and records its dimensions (spec: review/blast-radius-dimension)', () => {
  // Tokens, not sentences.
  const where = 'skills/review-code/SKILL.md'
  const skill = readFileSync(join(SKILLS_DIR, 'review-code', 'SKILL.md'), 'utf8')
  const paragraphs = skill.split(/\n\s*\n/)

  // The table row names its brief and its condition.
  assert.match(skill, /^\| blast-radius \|[^\n]*dimensions\/blast-radius\.md[^\n]*\.claude\/graph\/graph\.json/m, `${where} has no blast-radius table row naming its brief and the graph file`)
  assert.ok(existsSync(join(SKILLS_DIR, 'review-code', 'dimensions', 'blast-radius.md')), 'dimensions/blast-radius.md is missing')

  // The skip is spoken, and written to the record.
  const skipAt = skill.indexOf('BLAST RADIUS SKIPPED')
  assert.ok(skipAt !== -1, `${where} must carry BLAST RADIUS SKIPPED`)
  assert.ok(skill.indexOf('/interlock:graph', skipAt) > skipAt, 'BLAST RADIUS SKIPPED must be followed by /interlock:graph')
  const skipParagraph = paragraphs.find(p => p.includes('BLAST RADIUS SKIPPED') && p.includes('/interlock:graph'))
  assert.ok(skipParagraph, 'no paragraph carries the skip line with /interlock:graph')
  for (const token of ['still run', '`skipped`', 'reason']) {
    assert.ok(skipParagraph.includes(token), `the blast-radius skip paragraph must carry ${token}`)
  }

  // --dimensions naming blast-radius without a graph is reported, not silently run.
  const dimensionsParagraph = paragraphs.find(p => p.trimStart().startsWith('`--dimensions'))
  assert.ok(dimensionsParagraph, 'no paragraph opens with `--dimensions`')
  for (const token of ['list the eight', '`blast-radius`', 'BLAST RADIUS SKIPPED', 'not silently run', '`skipped`', 'every dimension it did run']) {
    assert.ok(dimensionsParagraph.includes(token), `the --dimensions paragraph must carry ${token}`)
  }

  // The dimension record's four keys, in a fence, before the review line.
  const reviewLines = [...skill.matchAll(/^interlock review --findings[^\n]*$/gm)]
  assert.ok(reviewLines.length > 0, 'no `interlock review --findings` line')
  const firstReview = reviewLines[0].index
  const record = [...skill.matchAll(/```json\n([\s\S]*?)```/g)].find(m => m[1].includes('"selected"'))
  assert.ok(record, 'no json fence writes the dimension record')
  for (const key of ['"selected"', '"ran"', '"unavailable"', '"skipped"']) {
    assert.ok(record[1].includes(key), `the dimension record fence carries no ${key}`)
  }
  assert.ok(record.index < firstReview, 'the dimension record must be written before the interlock review line')

  // Every review line names the record; the --out line binds the head.
  for (const m of reviewLines) assert.match(m[0], /--dimensions\b/, `the review line carries no --dimensions: ${m[0]}`)
  assert.ok(reviewLines.some(m => /--head\b/.test(m[0]) && /--out\b/.test(m[0])), 'no review line carries --head and --out')

  // The brief: graph first, outside callers, data, concurrency, rollback, no consumer.
  const brief = readFileSync(join(SKILLS_DIR, 'review-code', 'dimensions', 'blast-radius.md'), 'utf8')
  for (const token of ['interlock-graph consumers', '"dimension": "blast-radius"', 'outside the diff', 'no consumer', 'observing caller', 'before you read any code', 'blocker', 'warning', 'suggestion']) {
    assert.ok(brief.includes(token), `dimensions/blast-radius.md must carry ${token}`)
  }
  for (const pattern of [/rollback/i, /concurrency/i, /data effects/i, /additive plumbing/i]) {
    assert.match(brief, pattern, `dimensions/blast-radius.md must carry ${pattern}`)
  }

  // What the evidence gate reads, said right, and the pin fails on the old wording.
  assert.deepEqual(blastBriefEvidenceProblems(brief), [])
  const oldWording = blastBriefEvidenceProblems(brief.replace(/Give the observing caller's real `line` too:[^\n]*/, 'Put a `path:line` token for the observing caller in the description, so the evidence gate can check it.'))
  assert.ok(oldWording.some(p => p.includes('so the evidence gate can check it')), oldWording.join(' | '))
  const noOwnFile = blastBriefEvidenceProblems(brief.replace("the finding's own `file`", 'the diff'))
  assert.ok(noOwnFile.some(p => p.includes("finding's own `file`")), noOwnFile.join(' | '))
})

/**
 * The blast-radius brief's `file` bullet must say the evidence gate reads a
 * skeptic's refutation (not the finding's description) and, for this
 * dimension, accepts a citation of the finding's own `file` besides the diff.
 */
function blastBriefEvidenceProblems(brief) {
  const problems = []
  const bullet = brief.split('\n').find(l => l.startsWith("- **`file` is the observing caller's file**"))
  if (!bullet) return ["no bullet opens with **`file` is the observing caller's file**"]
  for (const token of ['evidence gate', 'refutation', "finding's own `file`", 'path:line', 'besides the diff']) {
    if (!bullet.includes(token)) problems.push(`the \`file\` bullet carries no ${token}`)
  }
  if (brief.includes('so the evidence gate can check it')) problems.push('carries so the evidence gate can check it: the gate reads a refutation, not the description')
  return problems
}

// --- the settle skill delivers the CLI's verdict (spec: review/merge-request-delivery) ---
//
// Tokens and anchored command lines, never sentences. Each pin is something the
// skill must still carry after a reword, and the check is a function so the
// suite can show it failing on a doctored copy: a pin that cannot fail holds
// nothing.

// The loop's fixed shell lines. Each precondition the loop runs on is one of
// these or a CLI subcommand, never prose a model re-derives.
const SETTLE_TREE_CHECK = /^git status --porcelain=v1 -z --untracked-files=all \| interlock settle tree-check --change <change> --status -$/
const SETTLE_STAGE = /^git add -A -- \. (?:':\(exclude\)[^']+'\s*)+$/
const SETTLE_CLASSIFY = /^git diff --cached --name-only -z \| interlock settle test-paths --changed - --profile \.claude\/ship\/settle\/profile-r<r>\.json --json$/
const SETTLE_SNAPSHOT = /^cp \.claude\/testing\/profile\.json \.claude\/ship\/settle\/profile-r<r>\.json$/
const SETTLE_PROFILE_CMP = /^cmp -s \.claude\/testing\/profile\.json \.claude\/ship\/settle\/profile-r<r>\.json$/
const SETTLE_PROFILE_RESTORE = /^cp \.claude\/ship\/settle\/profile-r<r>\.json \.claude\/testing\/profile\.json$/
const SETTLE_VERIFY_KEEP = /^test -s \.claude\/ship\/settle\/verify\.json\.tmp && mv \.claude\/ship\/settle\/verify\.json\.tmp \.claude\/ship\/settle\/verify\.json \|\| rm -f \.claude\/ship\/settle\/verify\.json\.tmp$/
const SETTLE_PLATFORM_HEAD = /^gh pr view <n> --json headRefOid --jq \.headRefOid$/
const SETTLE_IS_DRAFT = /^gh pr view <n> --json isDraft --jq \.isDraft$/

/** Every way a copy of skills/settle/SKILL.md falls short of the delivery pins. */
function settleSkillProblems(text) {
  const problems = []
  const lines = text.split('\n')
  const lineAt = (pattern, from = 0) => {
    for (let i = from; i < lines.length; i++) if (pattern.test(lines[i])) return i
    return -1
  }
  const need = (pattern, what, from = 0) => {
    const at = lineAt(pattern, from)
    if (at === -1) problems.push(`no line ${what}`)
    return at
  }

  // The pipeline input comes from the platform's own document, piped in.
  need(/^gh pr view [^\n]*headRefOid,statusCheckRollup[^\n]*\| interlock pipeline --github -/, 'pipes `gh pr view … headRefOid,statusCheckRollup` into `interlock pipeline --github -`')
  const gitlabPr = need(/\| interlock pipeline --gitlab-pr -/, 'pipes the pull request document into `interlock pipeline --gitlab-pr -`')
  if (gitlabPr !== -1) {
    need(/\| interlock pipeline --gitlab - [^\n]*--pending/, 'follows `--gitlab-pr` with `interlock pipeline --gitlab - … --pending`', gitlabPr + 1)
  }

  // The verdict line, then the block line, in that order.
  const verdictLine = need(
    /^interlock merge-confidence [^\n]*--base[^\n]*--pipeline[^\n]*--json/,
    'runs `interlock merge-confidence` with `--base`, `--pipeline` and `--json`'
  )
  const blockLine = need(
    /^interlock merge-confidence [^\n]*--markdown/,
    'runs `interlock merge-confidence … --markdown` after the verdict line',
    verdictLine === -1 ? 0 : verdictLine + 1
  )

  // A stopped assessment still takes the earlier labels off: the names come from
  // the command alone, on a line after the first removal the skill shows.
  const firstRemoval = lineAt(/--remove-label/)
  need(
    /^interlock merge-confidence --label-names\b/,
    'runs `interlock merge-confidence --label-names` after the first --remove-label, for an assessment that stopped',
    firstRemoval === -1 ? 0 : firstRemoval + 1
  )

  for (const token of [
    '--run .claude/ship/merge-confidence.json',
    '--required',
    '--exclude',
    '--gate-check',
    '--confidence-comment',
    '## Merge confidence',
    '--remove-label',
    '--add-label',
    '--unlabel',
    'gh label create',
    'BLOCK',
    '`verdict`',
    '`score`',
    '`driving`',
    '`flags`',
    '`labels`',
    '`head`',
    'labels.verdictNames',
    'labels.scorePrefix',
    'stops the assessment',
    'never merges'
  ]) {
    if (!text.includes(token)) problems.push(`missing ${token}`)
  }

  // The platform's head is read again between the block and the first label.
  const firstLabel = lineAt(/--add-label/)
  const reread = blockLine === -1 ? -1 : lineAt(/headRefOid/, blockLine + 1)
  if (reread === -1 || firstLabel === -1 || reread > firstLabel) {
    problems.push('no second read of headRefOid after the --markdown line and before the first --add-label')
  }

  // Pushing is what clears a pipeline input that describes another commit.
  const paragraphs = text.split(/\n\s*\n/)
  if (!paragraphs.some(p => p.includes('another commit') && /\bpush\b/.test(p))) {
    problems.push('no paragraph tells the reader to push when the pipeline describes another commit')
  }

  // --- the review loop (spec: review/settle-loop, merge-request-delivery) ---
  // Fenced lines carry the loop's order; prose carries the tokens a reword must keep.
  const fence = []
  const blockOf = []
  {
    let open = -1
    lines.forEach((line, i) => {
      if (/^\s*```/.test(line)) {
        open = open === -1 ? i : -1
        return
      }
      if (open !== -1) {
        fence.push({ i, line: line.trim() })
        blockOf[i] = open
      }
    })
  }
  const fencedAt = (pattern, from = -1) => {
    const hit = fence.find(f => f.i > from && pattern.test(f.line))
    return hit ? hit.i : -1
  }
  const lastFencedAt = pattern => {
    const hits = fence.filter(f => pattern.test(f.line))
    return hits.length ? hits[hits.length - 1].i : -1
  }
  const paragraphAt = i => {
    if (blockOf[i] !== undefined) {
      let end = i
      while (end < lines.length && !/^\s*```/.test(lines[end])) end++
      let start = blockOf[i] - 1
      while (start >= 0 && lines[start].trim() === '') start--
      let first = start
      while (first > 0 && lines[first - 1].trim() !== '') first--
      return lines.slice(first, end).join('\n')
    }
    let start = i
    while (start > 0 && lines[start - 1].trim() !== '') start--
    let end = i
    while (end < lines.length - 1 && lines[end + 1].trim() !== '') end++
    return lines.slice(start, end + 1).join('\n')
  }

  const fm = parseFrontmatter(text)
  if (!fm || !(fm.values['argument-hint'] || '').includes('--review')) problems.push('argument-hint carries no --review')
  if (!fm || !/\bAgent\b/.test(fm.values['allowed-tools'] || '')) problems.push('allowed-tools carries no Agent')

  // The section that opens the loop names its condition first.
  const loopHeading = lineAt(/^##\s[^\n]*`--review`/)
  if (loopHeading === -1) {
    problems.push('no section heading names `--review`')
  } else {
    const first = lineAt(/\S/, loopHeading + 1)
    const opening = first === -1 ? '' : paragraphAt(first)
    for (const token of ['--review', '.claude/ship/settle/', 'Without']) {
      if (!opening.includes(token)) problems.push(`the loop section's opening paragraph carries no ${token}`)
    }
  }

  // A pass clears its directory before the first loop review, and reads nothing there before.
  const clear = fencedAt(/^rm -rf \.claude\/ship\/settle\/?$/)
  if (clear === -1) problems.push('no fenced `rm -rf .claude/ship/settle` line')
  const firstLoopReview = fencedAt(/\/interlock:review-code\b/)
  if (clear !== -1 && (firstLoopReview === -1 || firstLoopReview < clear)) {
    problems.push('the `rm -rf .claude/ship/settle` line does not come before the first review-code invocation')
  }
  if (clear !== -1 && fence.some(f => f.i < clear && f.line.includes('.claude/ship/settle/'))) {
    problems.push('a fenced line reads .claude/ship/settle/ before the directory is cleared')
  }

  // The happy path, in order among the fenced lines.
  let at = -1
  for (const [pattern, what] of [
    [SETTLE_TREE_CHECK, 'the `git status … | interlock settle tree-check` line'],
    [/^rm -rf \.claude\/ship\/settle\/?$/, '`rm -rf .claude/ship/settle`'],
    [SETTLE_PLATFORM_HEAD, '`gh pr view <n> --json headRefOid --jq .headRefOid`'],
    [/\/interlock:review-code\b[^\n]*--base origin\/[^\n]*--out \.claude\/ship\/settle\/review-r/, 'review-code with `--base origin/` and `--out .claude/ship/settle/review-r`'],
    [/^interlock settle comment\b/, '`interlock settle comment`'],
    [SETTLE_TREE_CHECK, 'the round\'s `interlock settle tree-check` line'],
    [SETTLE_SNAPSHOT, 'the profile snapshot `cp`'],
    [/^interlock settle remediate-brief\b/, '`interlock settle remediate-brief`'],
    [/^git rev-parse HEAD$/, '`git rev-parse HEAD` before the fixer'],
    [/^git rev-parse HEAD$/, '`git rev-parse HEAD` after the fixer'],
    [/^interlock settle fixer-result\b/, '`interlock settle fixer-result`'],
    [SETTLE_PROFILE_CMP, 'the profile `cmp -s`'],
    [SETTLE_STAGE, "the staging `git add -A -- . ':(exclude)…'`"],
    [SETTLE_CLASSIFY, '`interlock settle test-paths`'],
    [/\| git --literal-pathspecs restore\b/, 'the test-path revert'],
    [/^git diff --cached --quiet\b/, '`git diff --cached --quiet`'],
    [/^git push\b/, '`git push`'],
    [/^interlock settle replies\b/, '`interlock settle replies`'],
    [SETTLE_IS_DRAFT, '`gh pr view <n> --json isDraft --jq .isDraft`'],
    [/^gh pr ready\b/, '`gh pr ready`'],
    [/^interlock settle conformance-brief\b/, '`interlock settle conformance-brief`'],
    [/^interlock verify judge\b(?=[^\n]*--context final)(?=[^\n]*--head)/, '`interlock verify judge` with `--context final` and `--head`'],
    [SETTLE_VERIFY_KEEP, 'the `test -s` keep-or-remove line'],
    [/^interlock verify coverage\b[^\n]*--base origin\//, '`interlock verify coverage` with `--base origin/`'],
    [/^gh pr checks\b[^\n]*--watch/, '`gh pr checks … --watch`'],
    [/^gh pr view [^\n]*\| interlock pipeline --github -/, '`gh pr view …` piped into `interlock pipeline --github -`'],
    [/^interlock merge-confidence\b(?=[^\n]*--review \.claude\/ship\/settle\/review-r<last>\.json)(?=[^\n]*--verify)(?=[^\n]*--handoff)/, '`interlock merge-confidence` with `--review …review-r<last>.json`, `--verify` and `--handoff`']
  ]) {
    const next = fencedAt(pattern, at)
    if (next === -1) {
      problems.push(`no fenced line, in the loop's order, runs ${what}`)
    } else {
      at = next
    }
  }

  // The posting lines pipe what the CLI rendered.
  if (fencedAt(/^interlock settle comment\b[^\n]*\| gh pr comment [^\n]*--body-file -/) === -1) problems.push('no `interlock settle comment` line piped into `gh pr comment … --body-file -`')
  if (fencedAt(/^interlock settle replies\b[^\n]*\| gh pr comment [^\n]*--body-file -/) === -1) problems.push('no `interlock settle replies` line piped into `gh pr comment … --body-file -`')

  // The round stages the fixer's tree, classifies the staged list and reverts from HEAD.
  // One staging line, and what it leaves out is exactly what the tree check tolerates.
  const stageAt = fencedAt(SETTLE_STAGE)
  const testPaths = fencedAt(SETTLE_CLASSIFY)
  if (testPaths === -1) problems.push('no `git diff --cached --name-only -z` piped into `interlock settle test-paths --changed - --profile .claude/ship/settle/profile-r<r>.json --json`')
  if (stageAt === -1 || testPaths === -1 || stageAt > testPaths) problems.push("no staging `git add -A -- . ':(exclude)…'` line before the `interlock settle test-paths` line")
  for (const f of fence.filter(f => /^git add\b/.test(f.line))) {
    if (/^git add -A\s*$/.test(f.line)) problems.push('a fenced bare `git add -A` line sweeps whatever was dirty into the fix commit')
    else if (!SETTLE_STAGE.test(f.line)) problems.push(`a fenced git add line is not the staging line: ${f.line}`)
  }
  if (stageAt !== -1) {
    const excluded = [...lines[stageAt].matchAll(/':\(exclude\)([^']+)'/g)].map(m => m[1]).sort()
    if (typeof settleCli.toleratedPaths !== 'function') {
      problems.push("lib/settle-cli.mjs exports no toleratedPaths, so the staging line's :(exclude) set has nothing to equal")
    } else {
      const tolerated = [...settleCli.toleratedPaths('<change>')].sort()
      if (JSON.stringify(excluded) !== JSON.stringify(tolerated)) {
        problems.push(`the staging line's :(exclude) set ${JSON.stringify(excluded)} is not toleratedPaths('<change>') ${JSON.stringify(tolerated)}`)
      }
    }
  }
  // The revert reads its paths from the CLI, NUL-terminated, literally; never a typed pathspec.
  const restore = fence.find(f => /\brestore --staged --worktree --source=HEAD\b/.test(f.line))
  if (!restore) {
    problems.push('no fenced `restore --staged --worktree --source=HEAD` line')
  } else {
    if (!/^git diff --cached --name-only -z \| interlock settle test-paths --changed - [^|]*--protected-only --nul \| /.test(restore.line)) {
      problems.push('the restore line does not read its paths from `git diff --cached --name-only -z | interlock settle test-paths … --protected-only --nul`')
    }
    if (!/\| git --literal-pathspecs restore\b/.test(restore.line)) problems.push('the restore line carries no --literal-pathspecs')
    if (!/ --pathspec-from-file=- --pathspec-file-nul$/.test(restore.line)) problems.push('the restore line carries no --pathspec-from-file=- --pathspec-file-nul')
    if (testPaths !== -1 && restore.i < testPaths) problems.push('the restore line comes before the classify line')
  }
  if (fence.some(f => /\bgit restore\b/.test(f.line))) problems.push('a fenced `git restore` takes its pathspecs from typed text')
  if (!paragraphs.some(p => p.includes('Only when') && p.includes('`protected`') && p.includes('128'))) {
    problems.push('no paragraph restores only when something is listed under `protected` (git restore exits 128 on an empty list)')
  }
  if (!paragraphs.some(p => p.includes('TESTS STILL STAGED') && p.includes('classify line again') && p.includes('commit nothing'))) {
    problems.push('no paragraph classifies again after the revert and commits nothing when TESTS STILL STAGED')
  }
  if (fence.some(f => /\bgit diff\b[^\n]*--name-only/.test(f.line) && !f.line.includes('--cached'))) {
    problems.push('a fenced `git diff --name-only` runs without --cached')
  }

  // A round that changed nothing commits nothing, pushes nothing, replies with one record on both sides.
  const commit = fencedAt(/^git commit\b[^\n]*fix\(review\): answer the PR #[^\n]*review round/)
  if (commit === -1) problems.push('no fenced `git commit` line naming `fix(review): answer the PR #` and `review round`')
  const quiet = fencedAt(/^git diff --cached --quiet\b/)
  if (quiet === -1 || commit === -1 || quiet > commit) problems.push('no `git diff --cached --quiet` line before the commit line')
  const sameRecord = fence.find(f => {
    const m = /^interlock settle replies\b[^\n]*--before (\S+)[^\n]*--after (\S+)/.exec(f.line)
    return m && m[1] === m[2]
  })
  if (!sameRecord || quiet === -1 || commit === -1 || sameRecord.i < quiet || sameRecord.i > commit) {
    problems.push('no `interlock settle replies` line with one record as --before and --after between the quiet check and the commit')
  }
  if (!paragraphs.some(p => p.includes('changed nothing') && p.includes('Commit nothing') && p.includes('push nothing') && p.includes('`open`'))) {
    problems.push('no paragraph says a round that changed nothing commits nothing, pushes nothing and leaves every finding `open`')
  }

  // The fix is pushed before the next review, and the skill says what a push does.
  if (commit !== -1) {
    const push = fencedAt(/^git push$/, commit)
    const nextReview = fencedAt(/\/interlock:review-code\b/, commit)
    if (push === -1 || nextReview === -1 || push > nextReview) problems.push('no `git push` line between the commit line and the next review-code line')
  }
  if (!paragraphs.some(p => ['dismiss', 'approval', 'merge train', 'auto-merge', 're-request'].every(t => p.includes(t)))) {
    problems.push('no paragraph says a push dismisses approvals, leaves auto-merge or a merge train, and is not re-requested')
  }

  // The create-time push, the draft, and ready after the last reply.
  const createPush = fencedAt(/^git push -u origin HEAD$/)
  const create = fencedAt(/^gh pr create\b/)
  if (createPush === -1 || create === -1 || createPush > create) problems.push('no `git push -u origin HEAD` line before the `gh pr create` line')
  if (fencedAt(/^gh pr create\b[^\n]*--draft/) === -1) problems.push('no `gh pr create` line carries --draft')
  if (fencedAt(/^glab mr create\b[^\n]*--draft/) === -1) problems.push('no `glab mr create` line carries --draft')
  if (!paragraphs.some(p => p.includes('--review') && p.includes('created ready'))) problems.push('no paragraph says a pull request created without --review is created ready')
  const lastReplies = lastFencedAt(/interlock settle replies\b/)
  const ready = fencedAt(/^gh pr ready\b/)
  const conformance = fencedAt(/^interlock settle conformance-brief\b/)
  if (lastReplies === -1 || ready === -1 || conformance === -1 || !(lastReplies < ready && ready < conformance)) {
    problems.push('no `gh pr ready` line between the last `interlock settle replies` and `interlock settle conformance-brief`')
  }
  if (conformance !== -1 && !/--head\b/.test(lines[conformance])) problems.push('the `interlock settle conformance-brief` line carries no --head')
  const judge = fencedAt(/^interlock verify judge\b/)
  if (judge !== -1 && !/--head\b/.test(lines[judge])) problems.push('the `interlock verify judge` line carries no --head')

  // Nothing decides for the reader.
  for (const [pattern, what] of [
    [/^gh pr merge\b/, 'gh pr merge'],
    [/^gh pr review\b/, 'gh pr review'],
    [/^glab mr merge\b/, 'glab mr merge'],
    [/^glab mr approve\b/, 'glab mr approve'],
    [/\bglab ci status\b[^\n]*--live/, 'glab ci status --live']
  ]) {
    if (fencedAt(pattern) !== -1) problems.push(`a fenced line runs ${what}`)
  }
  if (!paragraphs.some(p => ['never merges', 'never approves', 'branch rules', 'merge queue'].every(t => p.includes(t)))) {
    problems.push('no paragraph says the skill never merges and never approves, naming branch rules and a merge queue')
  }

  // Every GitLab line of the loop is marked not exercised.
  for (const [pattern, what] of [
    [/^glab mr note\b/, 'glab mr note'],
    [/^glab ci get --merge-request\b(?![^\n]*\| interlock pipeline)/, 'glab ci get --merge-request wait'],
    [/^glab mr update\b[^\n]*--ready/, 'glab mr update --ready'],
    [/^glab mr create\b/, 'glab mr create']
  ]) {
    const hits = fence.filter(f => pattern.test(f.line))
    if (!hits.length) problems.push(`no fenced ${what} line`)
    for (const hit of hits) {
      if (!paragraphAt(hit.i).includes('not exercised')) problems.push(`the ${what} line sits in no block marked not exercised`)
    }
  }

  // The assessment reads the loop's records for the pushed head.
  if (verdictLine !== -1) {
    for (const flag of [
      '--review .claude/ship/settle/review-r<last>.json',
      '--verify .claude/ship/settle/verify.json',
      '--handoff .claude/ship/settle/handoff.json',
      '--coverage .claude/ship/settle/coverage.json'
    ]) {
      if (!lines[verdictLine].includes(flag)) problems.push(`the merge-confidence verdict line carries no ${flag}`)
    }
  }
  if (!paragraphs.some(p => p.includes('--coverage .claude/ship/settle/coverage.json') && p.includes('exists'))) {
    problems.push('no paragraph passes --coverage only when the coverage file exists')
  }
  for (const token of ['REMEDIATION TOUCHED TESTS', 'TEST PATHS UNKNOWN']) {
    if (!text.includes(token)) problems.push(`missing ${token}`)
  }

  // Without a pull request and without --create, nothing is pushed.
  if (!paragraphs.some(p => p.includes('re-run with') && p.includes('--create') && p.includes('nothing was pushed'))) {
    problems.push('no stop message says nothing was pushed and to re-run with --create')
  }

  // --- the loop's preconditions: each one a CLI subcommand or a fixed line ---
  const sectionOf = heading => {
    const start = lineAt(heading)
    if (start === -1) return null
    const next = lineAt(/^#{2,3}\s/, start + 1)
    const end = next === -1 ? lines.length : next
    return { start, end, text: lines.slice(start, end).join('\n') }
  }
  const s4 = sectionOf(/^##\s+4\.\s/)
  const s5 = loopHeading === -1 ? null : (() => {
    const next = lineAt(/^##\s/, loopHeading + 1)
    const end = next === -1 ? lines.length : next
    return { start: loopHeading, end, text: lines.slice(loopHeading, end).join('\n') }
  })()
  const s5d = sectionOf(/^###\s+5d\b/)
  const s5g = sectionOf(/^###\s+5g\b/)

  // §5's GitHub lines are marked unexercised until the task that records a run.
  if (!s5 || !s5.text.split(/\n\s*\n/).some(p => ['not exercised end to end', '8.5', 'close-the-merge-request-loop'].every(t => p.includes(t)))) {
    problems.push('§5 carries no paragraph marking its GitHub lines not exercised end to end until task 8.5 of close-the-merge-request-loop')
  }
  if (!paragraphs.some(p => p.includes('Stopping early') && p.includes('nothing more is committed or pushed') && p.includes('§5d') && p.includes('§6'))) {
    problems.push('no Stopping early paragraph says nothing more is committed or pushed, keeps the §5d draft check and goes on to §6')
  }

  // The tree is clean before the directory is cleared, and again at each round's start.
  const treeChecks = fence.filter(f => SETTLE_TREE_CHECK.test(f.line)).map(f => f.i)
  if (!treeChecks.length || clear === -1 || treeChecks[0] > clear) {
    problems.push('no fenced `git status --porcelain=v1 -z --untracked-files=all | interlock settle tree-check --change <change> --status -` line before the `rm -rf .claude/ship/settle` line')
  }
  const commentAt = fencedAt(/^interlock settle comment\b/)
  const snapshot = fencedAt(SETTLE_SNAPSHOT)
  if (commentAt === -1 || snapshot === -1 || !treeChecks.some(i => i > commentAt && i < snapshot)) {
    problems.push('no round tree-check line between the `interlock settle comment` line and the profile snapshot')
  }
  for (const token of [
    'WORKING TREE NOT CLEAN: <paths> — the review loop did not start; nothing was committed or pushed',
    'WORKING TREE NOT CLEAN: <paths> — round <r> did not start',
    'HEAD NOT ON THE PLATFORM',
    'FIXER COMMITTED: <before>..<after> — round stopped, nothing pushed',
    'ROUND FAILED',
    'STOP:',
    'never count',
    'spawn no worker',
    'nothing to confirm',
    'halting verdict',
    'TEST PROFILE CHANGED — restored',
    'TESTS STILL STAGED',
    'run_in_background',
    'CHECKS STILL PENDING',
    'timeout_ms'
  ]) {
    if (!text.includes(token)) problems.push(`missing ${token}`)
  }
  // The check reads empty input as clean and the Bash tool runs no pipefail, so a
  // failed `git status` must be said, right after each tree-check line, to be not clean.
  for (const i of treeChecks) {
    const close = lineAt(/^\s*```/, i + 1)
    const next = close === -1 ? -1 : lineAt(/\S/, close + 1)
    const after = next === -1 ? '' : paragraphAt(next)
    if (!(after.includes('WORKING TREE NOT CLEAN') && after.includes('the tree was not read'))) {
      problems.push(`the paragraph after the tree-check line at line ${i + 1} does not say a failed git status means the tree was not read`)
    }
  }
  if (!paragraphs.some(p => p.includes('WORKING TREE NOT CLEAN') && p.includes('passed nothing from `.claude/ship/settle/`'))) {
    problems.push('no paragraph says the assessment is passed nothing from `.claude/ship/settle/` when the loop did not start')
  }

  // The platform holds the local head before anything is reviewed.
  const platformHead = fencedAt(SETTLE_PLATFORM_HEAD)
  if (platformHead === -1 || firstLoopReview === -1 || platformHead > firstLoopReview) {
    problems.push('no fenced `gh pr view <n> --json headRefOid --jq .headRefOid` line before the first review-code line')
  } else {
    const localHead = fencedAt(/^git rev-parse HEAD$/, platformHead)
    if (localHead === -1 || localHead > firstLoopReview) problems.push('no fenced `git rev-parse HEAD` beside the headRefOid --jq line, before the first review-code line')
  }
  if (!paragraphs.some(p => p.includes('HEAD NOT ON THE PLATFORM') && p.includes('stop the loop early'))) {
    problems.push('no paragraph stops the loop early on HEAD NOT ON THE PLATFORM')
  }

  // The stop rule is the CLI's, and any other failure is not a stop.
  if (!paragraphs.some(p => ['STOP:', 'ROUND FAILED', 'never count'].every(t => p.includes(t)))) {
    problems.push('no paragraph tells STOP: from ROUND FAILED and never counts rounds')
  }
  if (!paragraphs.some(p => p.includes('interlock settle comment') && p.includes('ROUND FAILED'))) problems.push('no paragraph says a failed `interlock settle comment` is ROUND FAILED')
  if (!paragraphs.some(p => p.includes('interlock settle replies') && p.includes('ROUND FAILED'))) problems.push('no paragraph says a failed `interlock settle replies` is ROUND FAILED')

  // The snapshot is taken before the briefing names it, and the briefing protects from it.
  const remediate = fencedAt(/^interlock settle remediate-brief\b/)
  if (snapshot === -1 || remediate === -1 || snapshot > remediate) {
    problems.push('no fenced `cp .claude/testing/profile.json .claude/ship/settle/profile-r<r>.json` line before the remediate-brief line')
  }
  if (remediate !== -1 && !lines[remediate].includes('--profile .claude/ship/settle/profile-r<r>.json')) {
    problems.push('the remediate-brief line carries no --profile .claude/ship/settle/profile-r<r>.json')
  }
  if (fence.some(f => /^interlock settle remediate-brief\b[^\n]*--protected\b/.test(f.line))) {
    problems.push('a remediate-brief line passes --protected, which the CLI computes from the profile')
  }

  // One general-purpose fixer, unguarded and unreviewed, between two reads of HEAD.
  const spawn = remediate === -1 ? -1 : lineAt(/`general-purpose`/, remediate + 1)
  if (spawn === -1) {
    problems.push('no `general-purpose` fixer spawn after the remediate-brief line')
  } else {
    const p = paragraphAt(spawn)
    for (const token of ['ONE', 'whole prompt', 'no ship guards', 'Do not fix anything yourself']) {
      if (!p.includes(token)) problems.push(`the general-purpose fixer spawn paragraph carries no ${token}`)
    }
  }
  const fixerResult = fencedAt(/^interlock settle fixer-result\b/)
  const headBefore = remediate === -1 ? -1 : fencedAt(/^git rev-parse HEAD$/, remediate)
  const headAfter = spawn === -1 ? -1 : fencedAt(/^git rev-parse HEAD$/, spawn)
  if (spawn === -1 || headBefore === -1 || headBefore > spawn) problems.push('no fenced `git rev-parse HEAD` line between the remediate-brief line and the fixer spawn')
  if (headAfter === -1 || fixerResult === -1 || headAfter > fixerResult) problems.push('no fenced `git rev-parse HEAD` line between the fixer spawn and the fixer-result line, for FIXER COMMITTED')
  if (spawn === -1 || fixerResult === -1 || stageAt === -1 || !(spawn < fixerResult && fixerResult < stageAt)) {
    problems.push('no fenced `interlock settle fixer-result` line between the fixer spawn and the staging line')
  }
  if (fixerResult !== -1) {
    for (const flag of ['--result .claude/ship/settle/remediate-r<r>.json', '--review .claude/ship/settle/review-r<r-1>.json', '--round <r>', '--head <sha>']) {
      if (!lines[fixerResult].includes(flag)) problems.push(`the fixer-result line carries no ${flag}`)
    }
    if (!paragraphs.some(p => p.includes('ROUND FAILED') && p.includes('left in the working tree') && p.includes('commit nothing'))) {
      problems.push('no paragraph says a failed fixer-result commits nothing and leaves the edits in the working tree')
    }
  }

  // The gitignored profile is compared with its snapshot and put back.
  const profileCmp = fencedAt(SETTLE_PROFILE_CMP)
  if (profileCmp === -1 || fixerResult === -1 || stageAt === -1 || !(fixerResult < profileCmp && profileCmp < stageAt)) {
    problems.push('no fenced `cmp -s .claude/testing/profile.json .claude/ship/settle/profile-r<r>.json` line between the fixer-result line and the staging line')
  }
  const profileRestore = profileCmp === -1 ? -1 : fencedAt(SETTLE_PROFILE_RESTORE, profileCmp)
  if (profileRestore === -1 || (stageAt !== -1 && profileRestore > stageAt)) {
    problems.push('no fenced `cp .claude/ship/settle/profile-r<r>.json .claude/testing/profile.json` restore between the cmp line and the staging line')
  }
  // Restoring the snapshot and removing a created profile are two cases, never one script.
  const profileRemove = profileCmp === -1 ? -1 : fencedAt(/^rm -f \.claude\/testing\/profile\.json$/, profileCmp)
  if (profileRemove === -1 || (stageAt !== -1 && profileRemove > stageAt)) {
    problems.push('no fenced `rm -f .claude/testing/profile.json` line between the cmp line and the staging line')
  } else if (profileRestore !== -1 && blockOf[profileRemove] === blockOf[profileRestore]) {
    problems.push('the `rm -f .claude/testing/profile.json` line shares a fence with the snapshot restore, so running the fence deletes what it restored')
  }

  // A push that fails ends the loop.
  if (!paragraphs.some(p => p.includes('push that fails') && p.includes('ends the loop'))) {
    problems.push('no paragraph says a push that fails ends the loop')
  }

  // §5d reads the draft state on every pass, and says why a draft stays one.
  if (!s5d || !fence.some(f => f.i > s5d.start && f.i < s5d.end && SETTLE_IS_DRAFT.test(f.line))) {
    problems.push('§5d has no fenced `gh pr view <n> --json isDraft --jq .isDraft` line')
  }
  if (!s5d || !s5d.text.includes('still a draft')) problems.push('§5d does not say when the pull request is still a draft and why')
  // A draft this pass did not create is the person's to mark ready: code owners are asked when it is.
  if (!s5d || !s5d.text.includes('this pass created') || !s5d.text.includes('did not create')) {
    problems.push('§5d does not limit the ready mark to a draft this pass created, and say so for one it did not create')
  }

  // The judge's output lands only when it holds something.
  if (judge !== -1 && !/ > \.claude\/ship\/settle\/verify\.json\.tmp$/.test(lines[judge])) {
    problems.push('the `interlock verify judge` line does not write .claude/ship/settle/verify.json.tmp')
  }
  const keep = fencedAt(SETTLE_VERIFY_KEEP)
  if (keep === -1 || judge === -1 || keep < judge) {
    problems.push('no fenced `test -s .claude/ship/settle/verify.json.tmp && mv … || rm -f …` line after the judge line')
  }
  if (!paragraphs.some(p => p.includes('halting verdict') && p.includes('test -s'))) problems.push('no paragraph keeps a halting verdict through the test -s line')
  if (!paragraphs.some(p => p.includes('interlock verify exec') && p.includes('timeout_ms'))) problems.push('no paragraph runs `interlock verify exec` with the profile\'s timeout_ms')

  // The checks wait in the background, and an unsettled end is spoken.
  for (const token of ['run_in_background', 'CHECKS STILL PENDING']) {
    if (!s5g || !s5g.text.includes(token)) problems.push(`§5g carries no ${token}`)
  }

  // Model-typed text never travels in double quotes on a create or edit line.
  lines.forEach(l => {
    if (!/^gh label create\b/.test(l.trim()) && /--(?:body|description) "</.test(l)) problems.push(`carries --body "< or --description "<: ${l.trim()}`)
  })
  for (const f of fence) {
    if (/^gh pr create\b/.test(f.line) && !/ --body-file - <<'EOF'$/.test(f.line)) problems.push(`a gh pr create line takes no quoted heredoc on --body-file -: ${f.line}`)
    if (/^glab mr create\b/.test(f.line) && !/ --description "\$\(cat <<'EOF'$/.test(f.line)) problems.push(`a glab mr create line takes no quoted heredoc on --description: ${f.line}`)
  }
  if (fencedAt(/^gh pr create\b(?![^\n]*--draft)/) === -1) problems.push('no `gh pr create` line without --draft, for a pull request created ready')

  // Before the pull request exists, only §4 pushes.
  const firstCreate = fencedAt(/^gh pr create\b/)
  for (const f of fence) {
    if (/^git push\b/.test(f.line) && firstCreate !== -1 && f.i < firstCreate && (!s4 || f.i < s4.start || f.i >= s4.end)) {
      problems.push(`a fenced git push before the first gh pr create sits outside §4 (line ${f.i + 1})`)
    }
  }

  // The skill states no confidence of its own and carries no label name.
  for (const banned of ['confidence level', 'interlock/merge', 'interlock/human-review', 'interlock/blocked', 'interlock/score-']) {
    if (text.includes(banned)) problems.push(`carries ${banned}`)
  }
  return problems
}

const settleSkill = () => readFileSync(join(SKILLS_DIR, 'settle', 'SKILL.md'), 'utf8')

test('the settle skill obtains the verdict, the block and the labels from the CLI, and satisfies every delivery pin', () => {
  assert.deepEqual(settleSkillProblems(settleSkill()), [])
  const fm = parseFrontmatter(settleSkill())
  assert.equal(fm.values['disable-model-invocation'], 'true', 'settle applies labels on a platform: a person invokes it')
  for (const flag of ['--confidence-comment', '--gate-check']) {
    assert.ok(fm.values['argument-hint'].includes(flag), `argument-hint must carry ${flag}`)
  }
})

test('the delivery pins fail on a doctored copy, naming what was dropped', () => {
  const shipped = settleSkill()
  const problemsOf = edit => settleSkillProblems(edit(shipped))

  // A self-assessed confidence, in a sentence.
  const selfAssessed = problemsOf(t => `${t}\nState your confidence level honestly.\n`)
  assert.ok(selfAssessed.some(p => p.includes('confidence level')), selfAssessed.join(' | '))

  // `--json` dropped from the verdict line is not satisfied by the words appearing in prose.
  const noJson = problemsOf(t =>
    t.replace(/^(interlock merge-confidence [^\n]*--pipeline[^\n]*?) --json([^\n]*)$/m, '$1$2') + '\nPass --json to read it.\n'
  )
  assert.ok(noJson.some(p => p.includes('--json')), noJson.join(' | '))

  // A label name written into the skill.
  const named = problemsOf(t => `${t}\nApply interlock/merge when the verdict allows.\n`)
  assert.ok(named.some(p => p.includes('interlock/merge')), named.join(' | '))

  // The re-read of the platform's head removed.
  const lines = shipped.split('\n')
  const block = lines.findIndex(l => /^interlock merge-confidence [^\n]*--markdown/.test(l))
  const noReread = settleSkillProblems(lines.filter((l, i) => !(i > block && l.includes('headRefOid'))).join('\n'))
  assert.ok(noReread.some(p => p.includes('headRefOid')), noReread.join(' | '))

  // The stopped-assessment removal dropped: a mention in prose is not the command line.
  const noNames = problemsOf(t =>
    t.replace(/^interlock merge-confidence --label-names[^\n]*$/m, 'Ask the CLI with --label-names.')
  )
  assert.ok(noNames.some(p => p.includes('--label-names')), noNames.join(' | '))

  // A prose mention of the pipeline command is not a command line.
  const proseOnly = problemsOf(t => t.replace(/^gh pr view [^\n]*\| interlock pipeline --github -[^\n]*$/m, 'Run gh pr view and interlock pipeline.'))
  assert.ok(proseOnly.some(p => p.includes('--github')), proseOnly.join(' | '))
})

test('the loop pins fail on a doctored copy, naming what was dropped', () => {
  const shipped = settleSkill()
  const problemsOf = edit => settleSkillProblems(edit(shipped))
  const fails = (problems, token) => assert.ok(problems.some(p => p.includes(token)), problems.join(' | '))

  // The round's push dropped: the re-review would describe a commit the platform never saw.
  fails(problemsOf(t => t.replace(/^(git commit -m "fix\(review\)[^\n]*)\ngit push$/m, '$1')), '`git push` line between the commit line')

  // The test-path revert reads the unstaged list.
  fails(problemsOf(t => t.replace('git diff --cached --name-only -z | interlock settle test-paths', 'git diff --name-only -z | interlock settle test-paths')), 'without --cached')

  // The directory is not cleared.
  fails(problemsOf(t => t.replace(/^rm -rf \.claude\/ship\/settle$/m, '')), 'rm -rf .claude/ship/settle')

  // A fenced merge.
  fails(problemsOf(t => t.replace(/^gh pr ready <n>$/m, 'gh pr ready <n>\ngh pr merge <n>')), 'gh pr merge')

  // The assessment reads round 0 after a fix commit.
  fails(problemsOf(t => t.replace('--review .claude/ship/settle/review-r<last>.json --verify .claude/ship/settle/verify.json --handoff .claude/ship/settle/handoff.json --coverage .claude/ship/settle/coverage.json --json', '--review .claude/ship/settle/review-r0.json --verify .claude/ship/settle/verify.json --handoff .claude/ship/settle/handoff.json --coverage .claude/ship/settle/coverage.json --json')), 'review-r<last>.json')

  // A GitLab loop line that loses its marker.
  fails(problemsOf(t => t.replace('# GitLab — not exercised\nglab mr update', '# GitLab\nglab mr update')), 'glab mr update --ready')

  // Ready moved before the last reply.
  fails(problemsOf(t => t.replace(/^gh pr ready <n>$/m, 'echo ready')), '`gh pr ready`')

  // The create-time push dropped while a round's push remains.
  fails(problemsOf(t => t.replace(/^git push -u origin HEAD$/m, '')), 'git push -u origin HEAD')
})

test('the loop precondition pins fail on a doctored copy, naming what was dropped', () => {
  const shipped = settleSkill()
  const problemsOf = edit => settleSkillProblems(edit(shipped))
  const fails = (problems, token) => assert.ok(problems.some(p => p.includes(token)), problems.join(' | '))
  const TREE = 'git status --porcelain=v1 -z --untracked-files=all | interlock settle tree-check --change <change> --status -'
  const STAGE = "git add -A -- . ':(exclude)openspec/changes/<change>/settle-summary.md' ':(exclude)docs/notes/compound.md'"
  const RESTORE_TAIL = 'git --literal-pathspecs restore --staged --worktree --source=HEAD --pathspec-from-file=- --pathspec-file-nul'
  assert.ok(shipped.includes(TREE) && shipped.includes(STAGE) && shipped.includes(RESTORE_TAIL), 'the doctored cases edit lines the shipped skill no longer carries')

  // The tree check dropped from before the clear, or moved after it.
  fails(problemsOf(t => t.replace(`${TREE}\n`, '')), 'before the `rm -rf .claude/ship/settle` line')
  fails(problemsOf(t => t.replace(`${TREE}\n`, '').replace(/^rm -rf \.claude\/ship\/settle$/m, `rm -rf .claude/ship/settle\n${TREE}`)), 'before the `rm -rf .claude/ship/settle` line')
  // The round's tree check dropped.
  fails(problemsOf(t => { const at = t.lastIndexOf(`${TREE}\n`); return t.slice(0, at) + t.slice(at + TREE.length + 1) }), 'no round tree-check line')
  fails(problemsOf(t => t.replaceAll('WORKING TREE NOT CLEAN', 'TREE DIRTY')), 'WORKING TREE NOT CLEAN')
  // A failed `git status` reads clean unless the skill says otherwise.
  fails(problemsOf(t => t.replace('or a `git status` that printed an error (the tree was not read)', 'or a status the check refused')), 'the tree was not read')

  // The platform head check dropped, or its message.
  fails(problemsOf(t => t.replace(/^gh pr view <n> --json headRefOid --jq \.headRefOid$/m, '')), 'headRefOid --jq')
  fails(problemsOf(t => t.replaceAll('HEAD NOT ON THE PLATFORM', 'HEAD ELSEWHERE')), 'HEAD NOT ON THE PLATFORM')

  // The stop rule, the failure line, the cap.
  fails(problemsOf(t => t.replaceAll('STOP:', 'HALT:')), 'STOP:')
  fails(problemsOf(t => t.replaceAll('ROUND FAILED', 'ROUND ERROR')), 'ROUND FAILED')
  fails(problemsOf(t => t.replaceAll('never count', 'count')), 'never count')
  fails(problemsOf(t => t.replace(/^(interlock settle remediate-brief [^\n]*)$/m, '$1 --protected test/')), '--protected')

  // The fixer: one general-purpose subagent, unguarded, unreviewed, and checked.
  fails(problemsOf(t => t.replace('`general-purpose`', 'fixer')), 'general-purpose')
  fails(problemsOf(t => t.replace('no ship guards', 'the usual guards')), 'no ship guards')
  fails(problemsOf(t => t.replace('as its whole prompt.** It fixes', 'as a prompt.** It fixes')), 'whole prompt')
  fails(problemsOf(t => t.replace('Do not fix anything yourself', 'Fix what it missed')), 'Do not fix anything yourself')
  fails(problemsOf(t => t.replaceAll('FIXER COMMITTED', 'FIXER MOVED HEAD')), 'FIXER COMMITTED')
  fails(problemsOf(t => {
    const line = t.match(/^interlock settle fixer-result [^\n]*$/m)[0]
    return t.replace(`${line}\n`, '').replace(`${STAGE}\n`, `${STAGE}\n${line}\n`)
  }), 'fixer-result` line between the fixer spawn and the staging line')

  // The profile snapshot, its comparison and the restore message.
  fails(problemsOf(t => {
    const line = 'cp .claude/testing/profile.json .claude/ship/settle/profile-r<r>.json'
    return t.replace(`${line}\n`, '').replace(/^(interlock settle remediate-brief [^\n]*)$/m, `$1\n${line}`)
  }), 'line before the remediate-brief line')
  fails(problemsOf(t => t.replace(/^cmp -s [^\n]*$/m, '')), 'cmp -s')
  fails(problemsOf(t => t.replaceAll('TEST PROFILE CHANGED', 'PROFILE TOUCHED')), 'TEST PROFILE CHANGED')
  fails(problemsOf(t => t.replace(/(^cp \.claude\/ship\/settle\/profile-r<r>\.json \.claude\/testing\/profile\.json)$/m, '$1\nrm -f .claude/testing/profile.json')), 'shares a fence with the snapshot restore')

  // Staging: no bare sweep, and the exclusions are the tolerated set.
  fails(problemsOf(t => t.replace(STAGE, 'git add -A')), 'bare `git add -A`')
  fails(problemsOf(t => t.replace(` ':(exclude)docs/notes/compound.md'`, '')), "toleratedPaths('<change>')")

  // The revert reads literal, NUL-terminated paths.
  fails(problemsOf(t => t.replace('git --literal-pathspecs restore', 'git restore')), '--literal-pathspecs')
  fails(problemsOf(t => t.replace('--pathspec-from-file=- --pathspec-file-nul', '--pathspec-from-file=-')), '--pathspec-file-nul')
  fails(problemsOf(t => `${t}\n\`\`\`bash\ngit restore --staged --worktree --source=HEAD -- <paths>\n\`\`\`\n`), 'fenced `git restore`')

  // A push that fails, §5d's draft read, the verification record and the checks.
  fails(problemsOf(t => t.replace('**A push that fails ends the loop**', '**A failed push is reported**')), 'push that fails ends the loop')
  fails(problemsOf(t => t.replace(/^gh pr view <n> --json isDraft --jq \.isDraft$/m, '')), 'isDraft')
  fails(problemsOf(t => t.replace('When it is a draft that this pass created (§4) and', 'When it is a draft and')), 'a draft this pass created')
  fails(problemsOf(t => t.replaceAll('halting verdict', 'blocking result')), 'halting verdict')
  fails(problemsOf(t => t.replace(/^test -s [^\n]*$/m, '')), 'test -s')
  fails(problemsOf(t => t.replace('--json > .claude/ship/settle/verify.json.tmp', '--json > .claude/ship/settle/verify.json')), 'verify.json.tmp')
  fails(problemsOf(t => t.replaceAll('spawn no worker', 'skip the worker')), 'spawn no worker')
  fails(problemsOf(t => t.replaceAll('timeout_ms', 'timeout')), 'timeout_ms')
  fails(problemsOf(t => t.replaceAll('run_in_background', 'a long timeout')), 'run_in_background')
  fails(problemsOf(t => t.replaceAll('CHECKS STILL PENDING', 'CHECKS WAITING')), 'CHECKS STILL PENDING')

  // Model-typed text in double quotes, and a push before §4.
  fails(problemsOf(t => t.replace(/^gh pr create --draft --title "<title>" --body-file - <<'EOF'$/m, 'gh pr create --draft --title "<title>" --body "<description so far>"')), '--body "<')
  fails(problemsOf(t => t.replace(/^(glab mr create --title "<title>") --description "\$\(cat <<'EOF'$/m, '$1 --description "<description so far>"')), '--description "<')
  fails(problemsOf(t => t.replace(/^git fetch origin <target branch>$/m, 'git fetch origin <target branch>\ngit push')), 'outside §4')

  // §5's not-exercised marker.
  fails(problemsOf(t => t.replace('task 8.5 of `close-the-merge-request-loop`', 'a later task')), 'not exercised end to end')
})

// ---------------------------------------------------------------------------
// Prose spawn routing (spec: spawn-routing). Tokens, not sentences: each is what
// a site must still say after a reword. The values themselves are never pinned
// here; `interlock routing` publishes them.
// ---------------------------------------------------------------------------

const skillText = name => readFileSync(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8')

/**
 * The text from the first heading matching `start` to the next heading of the same
 * or a higher level. Lines inside a code fence are never headings: a `# GitLab`
 * comment in a bash fence must not end a section.
 */
function sectionOfSkill(text, start) {
  const head = start.exec(text)
  assert.ok(head, `heading ${start} was not found`)
  const level = /^#+/.exec(head[0])[0].length
  const from = head.index + head[0].length
  let offset = from
  let fenced = false
  const lines = text.slice(from).split('\n')
  // The first element is the remainder of the heading line itself.
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (i > 0) {
      if (/^```/.test(line)) fenced = !fenced
      else if (!fenced && new RegExp(`^#{1,${level}} `).test(line)) return text.slice(head.index, offset)
    }
    offset += line.length + 1
  }
  return text.slice(head.index)
}

/** The paragraph (blank-line delimited block) of `text` that contains `token`. */
function paragraphWith(text, token) {
  return text.split(/\n\s*\n/).find(p => p.includes(token)) ?? null
}

/** Assert every token sits in `scope`, naming the file, the site and the token that is missing. */
function assertRoutingTokens(scope, tokens, where) {
  assert.ok(scope, `${where}: the section or paragraph was not found`)
  for (const token of tokens) {
    assert.ok(scope.includes(token), `${where} must carry ${token}`)
  }
}

const ROUTING_COMMON = ['ROUTING UNAVAILABLE', '`banners`', '`null`', 'omit']

test('explore routes its investigators in the investigator rules, and is allowed to run the CLI', () => {
  const text = skillText('explore')
  const fm = parseFrontmatter(text)
  assert.ok(
    fm.values['allowed-tools'].includes('Bash(interlock *)'),
    'skills/explore/SKILL.md allowed-tools must carry Bash(interlock *)'
  )
  const rules = sectionOfSkill(text, /^## Investigator rules$/m)
  assertRoutingTokens(
    rules,
    ['interlock routing explore-investigator --json', ...ROUTING_COMMON],
    'skills/explore/SKILL.md investigator rules'
  )
  assert.ok(
    rules.indexOf('interlock routing explore-investigator') < rules.indexOf('### Prompt template') ||
      !rules.includes('### Prompt template'),
    'skills/explore/SKILL.md routes before the prompt template'
  )
})

test('review-code reads one routing answer in the paragraph before the dimension fan-out', () => {
  const text = skillText('review-code')
  const section = sectionOfSkill(text, /^## 2\. Fan out the dimensions$/m)
  const paragraph = paragraphWith(section, 'interlock routing --json')
  assertRoutingTokens(
    paragraph,
    [
      'interlock routing --json',
      '--depth strict',
      'roles.review-dimension',
      'roles.review-skeptic',
      ...ROUTING_COMMON
    ],
    'skills/review-code/SKILL.md §2 routing paragraph'
  )
  assert.ok(
    text.indexOf('interlock routing --json') < text.indexOf('Spawn one agent per dimension'),
    'skills/review-code/SKILL.md must route before the fan-out'
  )
  assert.ok(
    !/interlock routing (explore|review-|settle-)/.test(text),
    'skills/review-code/SKILL.md must make one no-role routing call, not a per-role one'
  )
})

test('settle routes its fixer in the fixer paragraph and its conformance worker in 5e', () => {
  const text = skillText('settle')
  const fixer = paragraphWith(sectionOfSkill(text, /^### 5c\. /m), 'Spawn ONE `general-purpose` subagent')
  assertRoutingTokens(
    fixer,
    ['interlock routing settle-fixer --json', ...ROUTING_COMMON],
    'skills/settle/SKILL.md §5c fixer paragraph'
  )
  const conformance = sectionOfSkill(text, /^### 5e\. /m)
  assertRoutingTokens(
    conformance,
    ['interlock routing settle-conformance --json', ...ROUTING_COMMON, 'spawn no worker', 'nothing to confirm'],
    'skills/settle/SKILL.md §5e'
  )
})

test('spec §1b says spec spawns nothing and names the routed explore role', () => {
  const text = skillText('spec')
  const section = sectionOfSkill(text, /^### 1b\. /m)
  assertRoutingTokens(
    section,
    ['spawns nothing itself', 'interlock routing explore-investigator'],
    'skills/spec/SKILL.md §1b'
  )
})

test('TOOL-ECONOMY Rule 5 carries the routing tokens and names the five roles', () => {
  const text = readFileSync(join(ROOT, 'shared', 'TOOL-ECONOMY.md'), 'utf8')
  const rule = sectionOfSkill(text, /^## Rule 5 — Route every prose spawn/m)
  assertRoutingTokens(
    rule,
    [
      'interlock routing',
      '--json',
      '--depth strict',
      'ROUTING UNAVAILABLE',
      'banners',
      '`null`',
      'omit',
      'never',
      ...['explore-investigator', 'review-dimension', 'review-skeptic', 'settle-fixer', 'settle-conformance', 'artifact-reviewer']
    ],
    'shared/TOOL-ECONOMY.md Rule 5'
  )
})

test('no routed skill spells a model or an effort level as a spawn parameter', () => {
  const MODEL = /\bmodel\s*[:=]\s*["'`]?(haiku|sonnet|opus|claude-)/i
  const EFFORT_LEVEL = /\beffort\s*[:=]\s*["'`]?(low|medium|high|xhigh|max)\b/i
  for (const name of ['explore', 'review-code', 'settle', 'spec']) {
    const text = skillText(name)
    assert.ok(!MODEL.test(text), `skills/${name}/SKILL.md spells a model slug as a spawn parameter`)
    assert.ok(!EFFORT_LEVEL.test(text), `skills/${name}/SKILL.md spells an effort level as a spawn parameter`)
  }
})

// The review depth (spec: review-depth). The skills say which depth ran and read
// what it runs from `interlock routing`; they never name a count of dimensions
// or skeptics beside `lean` or `strict`.

/** A number, as a digit or a word, directly counting dimensions, skeptics or reviewers. */
const COUNT_OF_REVIEWERS = String.raw`(?:\d+|one|two|three|four|five|six|seven|eight)\s+(?:independent\s+)?(?:dimensions?|skeptics?|reviewers?)`
const DEPTH_WORD = String.raw`\b(?:lean|strict)\b`

function depthCountProblems(text) {
  const plain = text.replaceAll('`', '')
  const before = new RegExp(`${DEPTH_WORD}[^.\\n]{0,12}${COUNT_OF_REVIEWERS}`, 'gi')
  const after = new RegExp(`${COUNT_OF_REVIEWERS}[^.\\n]{0,12}${DEPTH_WORD}`, 'gi')
  return [...plain.matchAll(before), ...plain.matchAll(after)].map(m => m[0])
}

test('review-code selects the depth with --strict, names the dimensions by review.dimensions and spawns skeptics by review.skeptics', () => {
  const text = skillText('review-code')
  const where = 'skills/review-code/SKILL.md'
  const fm = parseFrontmatter(text)
  assert.ok(fm.values['argument-hint'].includes('--strict'), `${where} argument-hint must carry --strict`)
  assert.ok(text.includes('REVIEW DEPTH:'), `${where} must print REVIEW DEPTH:`)

  // The dimension table: the always-on rows read from the depth, and no row is `always`.
  const fanOut = sectionOfSkill(text, /^## 2\. Fan out the dimensions$/m)
  const tableLead = fanOut.slice(fanOut.indexOf('Spawn one agent per dimension'), fanOut.indexOf('| Dimension |'))
  assert.ok(tableLead.includes('review.dimensions'), `${where} must say the always-on set is review.dimensions above the table`)
  assert.ok(!/\|\s*always\s*\|/i.test(fanOut), `${where} still has a dimension row whose Run when is always`)
  assert.ok(/\| in `review\.dimensions` \|/.test(fanOut), `${where} must have rows that run when in review.dimensions`)

  // The record fence carries the depth.
  const fence = /```json\n(\{ "selected"[\s\S]*?)```/.exec(text)
  assert.ok(fence, `${where} dimension record fence was not found`)
  assert.ok(fence[1].includes('"depth"'), `${where} dimension record fence must carry depth`)

  // §3: the per-review paragraph and the per-finding sentence.
  const verify = sectionOfSkill(text, /^## 3\. Adversarial verification$/m)
  const perReview = paragraphWith(verify, 'per-review')
  assertRoutingTokens(
    perReview,
    ['grouped by file', 'one verdict per finding', 'overlapping', 'judged once'],
    `${where} §3 per-review paragraph`
  )
  const perFinding = paragraphWith(verify, 'per-finding')
  assertRoutingTokens(perFinding, ['run it or read it', 'evidence'], `${where} §3 per-finding paragraph`)
  assert.ok(verify.includes('Run both skeptics per finding, in parallel'), `${where} must keep Run both skeptics per finding, in parallel`)
})

test('settle passes --strict through to every review-code line and prints the depth once', () => {
  const text = skillText('settle')
  const where = 'skills/settle/SKILL.md'
  const fm = parseFrontmatter(text)
  assert.ok(fm.values['argument-hint'].includes('--strict'), `${where} argument-hint must carry --strict`)
  assert.match(text, /^\| `--strict` \|/m, `${where} flag table must carry a --strict row`)

  const lines = text.split('\n').filter(l => /^\/interlock:review-code /.test(l))
  assert.ok(lines.length >= 2, `${where} must have review-code lines in 5a and 5c, found ${lines.length}`)
  for (const line of lines) {
    assert.ok(line.endsWith('[--strict]'), `${where} review-code line must end with [--strict]: ${line}`)
  }
  const review = sectionOfSkill(text, /^## 5\. The review loop/m)
  assert.ok(
    sectionOfSkill(review, /^### 5a\. /m).includes('[--strict]'),
    `${where} §5a review-code line must carry [--strict]`
  )
  assert.ok(
    sectionOfSkill(review, /^### 5c\. /m).includes('[--strict]'),
    `${where} §5c review-code line must carry [--strict]`
  )
  assertRoutingTokens(paragraphWith(review, 'placeholder'), ['write `--strict` there', 'invent'], `${where} §5 placeholder paragraph`)
  assert.ok(review.includes('REVIEW DEPTH:'), `${where} must print REVIEW DEPTH:`)
})

test('neither review skill names a count of dimensions or skeptics beside lean or strict', () => {
  for (const name of ['review-code', 'settle']) {
    assert.deepEqual(depthCountProblems(skillText(name)), [], `skills/${name}/SKILL.md counts reviewers beside a depth`)
  }
  // The detector itself: it sees a count beside a depth, in both orders.
  assert.ok(depthCountProblems('the lean depth runs two dimensions').length > 0)
  assert.ok(depthCountProblems('four dimensions at strict').length > 0)
  assert.deepEqual(depthCountProblems('the lean depth runs `review.dimensions`'), [])
})

// The scoped re-review and the two deferrals (spec: settle-loop).

test('the round\'s review-code line scopes the re-review and carries the rest, and review-code forwards --carry', () => {
  const settle = skillText('settle')
  const where = 'skills/settle/SKILL.md'
  const roundLine = settle.split('\n').find(l => /^\/interlock:review-code /.test(l) && l.includes('review-r<r>.json'))
  assert.ok(roundLine, `${where} must have a round review-code line writing review-r<r>.json`)
  assert.match(roundLine, /--dimensions\b/, `${where} round review-code line must carry --dimensions`)
  assert.ok(
    roundLine.includes('--carry .claude/ship/settle/review-r<r-1>.json'),
    `${where} round review-code line must carry --carry .claude/ship/settle/review-r<r-1>.json`
  )
  // Still the line the loop-order pin looks for.
  assert.match(
    roundLine,
    /\/interlock:review-code\b[^\n]*--base origin\/[^\n]*--out \.claude\/ship\/settle\/review-r/,
    `${where} round review-code line must still match the loop-order pin`
  )
  const fix = sectionOfSkill(settle, /^### 5c\. /m)
  assert.ok(fix.includes('reReviewDimensions'), `${where} §5c must name reReviewDimensions`)

  const review = skillText('review-code')
  assert.match(
    review,
    /^interlock review [^\n]*--head <sha> --out <file>[^\n]*--carry/m,
    'skills/review-code/SKILL.md --head --out review line must carry --carry'
  )
})

test('the remediate-brief line passes the last fixer result, and its paragraph names both deferrals', () => {
  const settle = skillText('settle')
  const where = 'skills/settle/SKILL.md'
  const line = settle.split('\n').find(l => /^interlock settle remediate-brief\b/.test(l))
  assert.ok(line, `${where} must have a remediate-brief line`)
  assert.ok(
    line.includes('--previous .claude/ship/settle/remediate-r<r-1>.json'),
    `${where} remediate-brief line must carry --previous .claude/ship/settle/remediate-r<r-1>.json`
  )
  const paragraph = paragraphWith(sectionOfSkill(settle, /^### 5c\. /m), 'Deferred this round')
  assertRoutingTokens(
    paragraph,
    ['protected test path', 'declined', 'nothing fixable remains', '`open`'],
    `${where} §5c deferral paragraph`
  )
})

test('the settle meter attributes a spawn by its brief, so both skills hand the brief over whole', () => {
  // lib/settle-meter.mjs `roleOf` reads a dimension's `# Dimension:` heading and the
  // conformance worker's first line off the spawn's prompt; a skill that paraphrased
  // the brief would leave every such agent unattributed (PR #26 review, M9).
  assert.ok(skillText('review-code').includes('use it verbatim'), 'skills/review-code/SKILL.md must hand each dimension brief over verbatim')
  assert.ok(
    skillText('settle').includes('printed briefing as its whole prompt'),
    'skills/settle/SKILL.md must hand the conformance worker the printed briefing as its whole prompt'
  )
})

// The authoring skills' validate step must name what it validates: a bare
// `openspec validate` checks nothing and exits 1, in every OpenSpec version.
test('the spec skill validates the change by name and never runs a bare openspec validate', () => {
  const lines = fencedLines(join(SKILLS_DIR, 'spec', 'SKILL.md'))
  assert.ok(lines.includes('openspec validate "<name>"'), 'skills/spec/SKILL.md must run `openspec validate "<name>"`')
  assert.ok(!lines.includes('openspec validate'), 'a fenced bare `openspec validate` validates nothing')
})

test('the bootstrap skill validates the specs it wrote with openspec validate --specs', () => {
  const lines = fencedLines(join(SKILLS_DIR, 'bootstrap', 'SKILL.md'))
  assert.ok(lines.includes('openspec validate --specs'), 'skills/bootstrap/SKILL.md must run `openspec validate --specs`')
  assert.ok(!lines.includes('openspec validate'), 'a fenced bare `openspec validate` validates nothing')
})

test('the spec skill states the MODIFIED scenario-title rule', () => {
  const text = readFileSync(join(SKILLS_DIR, 'spec', 'SKILL.md'), 'utf8')
  for (const token of ['MODIFIED', 'scenario title', 'REMOVED']) {
    assert.ok(text.includes(token), `skills/spec/SKILL.md must carry the token \`${token}\``)
  }
})

test('docs/01-first-hour.md names the OpenSpec floor the doctor enforces', () => {
  const floor = doctorModule.OPENSPEC_MIN_VERSION
  assert.match(String(floor), /^\d+\.\d+\.\d+$/, 'OPENSPEC_MIN_VERSION is an exported x.y.z constant')
  const text = readFileSync(join(ROOT, 'docs', '01-first-hour.md'), 'utf8')
  assert.ok(text.includes(floor), `docs/01-first-hour.md must name OpenSpec ${floor}`)
})

test('spec gates once and states the bounded pin rule; review-artifacts offers the scoped re-gate and says what a blocker is', () => {
  // One gate per spec run. On 2026-10-29 a wide change was re-gated five times
  // with a fresh reviewer each round: the blockers never converged, one of them
  // ("the pin list is incomplete") cannot be satisfied before the code exists,
  // and the rounds cost about a million subagent tokens. The rule that stops it
  // lives in prose, so it is pinned here. Tokens, not sentences.
  const spec = skillText('spec')
  const gate = sectionOfSkill(spec, /^## 5\. Gate: artifact review$/m)
  assertRoutingTokens(gate, ['once', 'not a loop', 're-gate nothing', '--since'], 'skills/spec/SKILL.md §5')
  const tests = sectionOfSkill(spec, /^#### Where the tests go$/m)
  assertRoutingTokens(
    tests,
    ['bounded rule', 'never during a remediation stage', 'names the assertion and the requirement'],
    'skills/spec/SKILL.md "Where the tests go"'
  )
  const brief = sectionOfSkill(spec, /^### 1b\. Load the explore brief$/m)
  assertRoutingTokens(brief, ['epic of briefs', 'does not converge'], 'skills/spec/SKILL.md §1b')

  const review = skillText('review-artifacts')
  const where = 'skills/review-artifacts/SKILL.md'
  const fm = parseFrontmatter(review)
  assert.ok((fm.values['argument-hint'] || '').includes('--since'), `${where} argument-hint must offer --since`)
  const allowed = fm.values['allowed-tools'] || ''
  assert.match(allowed, /Bash\(git diff \*\)/, `${where} instructs git diff in its re-gate but does not admit it`)
  assert.match(allowed, /Bash\(git status \*\)/, `${where} instructs git status in its re-gate but does not admit it`)
  assert.doesNotMatch(allowed, /Bash\(git \*\)/, `${where}'s grant must stay narrowed to the two verbs the re-gate uses`)
  const since = sectionOfSkill(review, /^## A scoped re-gate: `--since <findings file>`$/m)
  assertRoutingTokens(since, ['judges the fix', 'changed hunk', 'Re-check each earlier blocker'], `${where} --since section`)
  const output = sectionOfSkill(review, /^## Output$/m)
  assertRoutingTokens(output, ['fail its own verification', 'bounded pin rule', 'never a blocker'], `${where} Output`)
})

test('review-artifacts routes one strict reviewer by role, and spec passes --strict through to the gate', () => {
  // Without these tokens the strict depth is prose nobody asserts: the lookup, the
  // banners and the fallback would each stop running on the first reword.
  const review = skillText('review-artifacts')
  const where = 'skills/review-artifacts/SKILL.md'
  const fm = parseFrontmatter(review)
  assert.ok((fm.values['argument-hint'] || '').includes('--strict'), `${where} argument-hint must offer --strict`)
  assert.match(fm.values['allowed-tools'] || '', /\bAgent\b/, `${where} spawns the strict reviewer but does not admit Agent`)
  const depth = sectionOfSkill(review, /^## Depth$/m)
  assertRoutingTokens(
    depth,
    [
      'interlock routing artifact-reviewer --json',
      'interlock routing artifact-reviewer --depth strict --json',
      'GATE DEPTH',
      'ROUTING UNAVAILABLE',
      'STRICT REVIEW UNREAD',
      '`banners`',
      '`null`',
      'omit',
      'exactly one Agent call',
      'verbatim',
      'writes no file'
    ],
    `${where} Depth`
  )
  const spec = skillText('spec')
  const sfm = parseFrontmatter(spec)
  assert.ok((sfm.values['argument-hint'] || '').includes('--strict'), 'skills/spec/SKILL.md argument-hint must offer --strict')
  const gate = sectionOfSkill(spec, /^## 5\. Gate: artifact review$/m)
  assertRoutingTokens(gate, ['/interlock:review-artifacts <name> --strict'], 'skills/spec/SKILL.md §5')
})
