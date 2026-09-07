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
  for (const flag of ['--solo', '--waves']) {
    assert.ok(hint[0].includes(flag), `the argument-hint must offer ${flag}`)
  }
  assert.match(text, /flags: \["solo"\]/, 'the flag table must map --solo onto the args payload')
  assert.match(text, /flags: \["waves"\]/, 'and --waves')
  // The preview names the mode before anything is spawned, which is why the
  // trampoline has no shape judgement of its own to make.
  assert.match(text, /plan preview names the mode/i)
  assert.doesNotMatch(
    text,
    /interlock limits|envelope of \d+|\bat most \d+ tasks\b/i,
    'the trampoline must cite no threshold: the envelope is the planner\'s to enforce'
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
