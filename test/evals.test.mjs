// Structural validation of every eval case under evals/.
//
// The eval *run* needs a model, a credential and early-access enablement, so it
// cannot gate an ordinary pull request — least of all one from a fork. This test
// is the part of the suite that gates everything: it runs offline in the same
// `npm test` job as everything else, and it holds the case files to the
// case-suite spec so a malformed case fails loudly here rather than silently at
// harness load time.
//
// It is the eval-suite twin of test/skills.test.mjs, and deliberately shaped
// like it: a minimal frontmatter reader (no YAML dependency — that would be the
// only one in the repo), a discovery walk, and one assertion per requirement.
//
// The requirements it enforces (specs/evals/case-suite):
//   - every case pins schema_version
//   - every case carries a provenance citation
//   - no case directory sits under skills/, agents/, commands/ or workflows/
//   - every grader file declares one of the known grader types
//   - every case tagged `smoke` uses only non-judged (deterministic) graders
//   - the CI definition that runs the suite is tracked in version control
//   - a `twin_of:` citation resolves to a case that exists, and the twin and
//     observed-failure citation kinds are countable apart
//   - every judged grader has a calibration set or a live deferral entry
//   - the model-facing surface partitions into exercised and unexercised, and
//     the unexercised half is printed by name (a report, never a gate)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXPECTED_PROMPT_LABELS } from './helpers/ship-harness.mjs'
import { LIMITS } from '../lib/limits.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EVALS_DIR = join(ROOT, 'evals')

// The grader types the harness accepts, read from the shipped binary's schema:
//   regex | tool_order | tool_used | file_exists | llm | baseline
// A grader .md whose frontmatter `type:` is none of these fails to load.
const KNOWN_GRADER_TYPES = new Set([
  'regex', 'tool_order', 'tool_used', 'file_exists', 'llm', 'baseline'
])

// Judged graders call a model to reach a verdict, so their failures carry
// run-to-run variance. A `smoke` case is one triage trusts on a single run, so
// it must use only deterministic graders.
//
// The set is the one triage and calibrate read, `JUDGED_GRADER_TYPES` in
// lib/evals-types.mjs, intersected with the types this harness knows: the
// shared set also carries triage's legacy aliases, which no grader file may
// declare. It is imported dynamically so that, while the module is missing, the
// rest of this file still loads; the tests that need the set say they were
// skipped and one test fails naming the import, rather than any falling back
// to a list spelled here.
let SHARED_JUDGED = null
let SHARED_JUDGED_ERROR = null
try {
  ;({ JUDGED_GRADER_TYPES: SHARED_JUDGED } = await import('../lib/evals-types.mjs'))
} catch (err) {
  SHARED_JUDGED_ERROR = err
}
const JUDGED_GRADER_TYPES = new Set([...(SHARED_JUDGED || [])].filter(t => KNOWN_GRADER_TYPES.has(t)))
const JUDGED_UNAVAILABLE = SHARED_JUDGED
  ? false
  : `lib/evals-types.mjs did not load (${SHARED_JUDGED_ERROR?.message}); the judged set is unknown`

// Directories the case suite must not live inside — placing a case under a
// declared plugin component would shadow it and trip the harness's
// component-overlap warning (case-suite spec).
const COMPONENT_DIRS = ['skills', 'agents', 'commands', 'workflows']

// Non-case entries that legitimately appear under evals/.
//
// `ship` and `history` hold the outcome eval — fixture repositories, its runner
// and its committed results record. None of them carries a case.yaml or a
// prompt.md, so `discoverCases` already ignores them; they are named here
// anyway, and the discovered set is pinned below, because a fixture that
// silently joined the metered case suite would spend a credential on a
// repository nobody wrote a case for.
const NON_CASE_ENTRIES = new Set(['results', 'mocks', 'ship', 'history'])

// The model-facing cases, by name. Pinned rather than counted: a count still
// passes when one case is deleted and a fixture directory is discovered in its
// place, which is the exact substitution this pin exists to catch. Adding a
// case is a deliberate edit here.
const EXPECTED_CASES = [
  'cited-cap-resolution',
  'control-plane-action',
  'evidence-locator',
  'handoff-status-enum',
  'lane-partial-failure',
  'review-range-advisor-check-exits',
  'review-range-briefing-label-path',
  'review-range-doctor-openspec-probe',
  'review-range-halt-card-band',
  'review-range-notes-path-skipped',
  'review-range-preflight-closer',
  'skill-routing',
  'skill-routing-explore',
  'spec-range-add-report-dashboard',
  'spec-range-collapse-singleton',
  'spec-range-dispatch-effort',
  'spec-range-harden-substantive-gates',
  'spec-range-harden-unattended',
  'spec-range-judge-against-base',
  'spec-range-label-merge-verdict',
  'spec-range-merge-confidence',
  'spec-range-prompt-cache-cost',
  'spec-range-publish-npm',
  'tier-read-scope',
  'tier-read-scope-full',
  'trampoline-halt',
  'trampoline-launch'
]

// Minimal top-level scalar reader for a case.yaml. We only need `schema_version`,
// `provenance`, and `tags` — all top-level — so a full YAML parser is overkill.
function readTopLevel(text, key) {
  const re = new RegExp(`^${key}:\\s*(.+)$`, 'm')
  const m = re.exec(text)
  return m ? m[1].trim() : null
}

// A top-level list field in either form YAML permits — `key: [a, b]` inline, or
// a `- ` block beneath the key. Parameterised by key so `exercises:` reads the
// same way `tags:` always has (design D4): one reader, still no YAML dependency.
// Returns the raw entries in order; the caller decides whether case matters.
function readList(text, key) {
  const inline = new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]`, 'm').exec(text)
  if (inline) {
    return inline[1]
      .split(',')
      .map(t => t.trim().replace(/['"]/g, ''))
      .filter(Boolean)
  }
  const block = new RegExp(`^${key}:\\s*\\n((?:\\s*-\\s*.+\\n?)+)`, 'm').exec(text)
  if (block) {
    return block[1]
      .split('\n')
      .map(l => /^\s*-\s*(.+)$/.exec(l))
      .filter(Boolean)
      .map(m => m[1].trim().replace(/['"]/g, ''))
      .filter(Boolean)
  }
  return []
}

// `tags: [smoke]` or a block list. Returns a lowercased set — tags are compared
// case-insensitively, which paths are not, so the lowercasing lives here rather
// than in the shared reader.
function readTags(text) {
  return new Set(readList(text, 'tags').map(t => t.toLowerCase()))
}

// --- the two citation fields this suite adds (spec: evals/case-suite) -------
//
// HARNESS TOLERANCE, verified 2026-09-05 (task 1.2). Both fields are unknown to
// the harness's own case schema, so the question was whether it rejects an
// unknown top-level key at load. It does not. The case schema in the shipped
// binary (`@anthropic-ai/claude-code/bin/claude.exe`, the object bound as the
// case parser: `schema_version … name … tags … plugins … context … execution …
// runs … graders … expected_outcome`) is a plain object schema with NO
// `.strict()` call, while the grader schemas in the same expression DO end in
// `.strict()` — so the omission on the case object is deliberate, and unknown
// top-level keys are stripped rather than rejected. The eight cases that shipped
// before this change already carry an unknown top-level `provenance:` key and
// load, which is the same fact observed from the other side.
//
// This is the same method the KNOWN_GRADER_TYPES list above was established by:
// read the shipped binary's schema. The harness offers no dry-run or validate
// mode, so a live load would cost a metered run and a credential. Because the
// answer is "tolerated", the comment-prefix fallback named in design.md Risks
// was not needed and neither field was moved into a comment block.

// `twin_of: <case-name>` — the case this one supplies the opposite side of.
// Optional: a case authored from an independently observed failure carries none.
function readTwinOf(text) {
  const raw = readTopLevel(text, 'twin_of')
  return raw ? raw.replace(/['"]/g, '').trim() : null
}

// `exercises: [path, path]` — model-facing surfaces this case puts under load,
// named directly rather than inferred from the free text of `provenance:`.
// Optional, and repository-relative.
function readExercises(text) {
  return readList(text, 'exercises')
}

// The grader type is the frontmatter `type:` in a graders/*.md file.
function readGraderType(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text)
  const block = m ? m[1] : text
  const t = /^type:\s*(\S+)/m.exec(block)
  return t ? t[1].trim().replace(/['"]/g, '') : null
}

// Discover case directories: any directory under evals/ that holds a case.yaml
// (or a prompt.md), excluding results/ and mocks/.
function discoverCases(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (NON_CASE_ENTRIES.has(entry.name)) continue
    const caseDir = join(dir, entry.name)
    if (existsSync(join(caseDir, 'case.yaml')) || existsSync(join(caseDir, 'prompt.md'))) {
      out.push({ name: entry.name, dir: caseDir })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

const cases = discoverCases(EVALS_DIR)
const caseNames = new Set(cases.map(c => c.name))

test('the eval suite lives at evals/ and holds cases', () => {
  assert.ok(existsSync(EVALS_DIR), 'evals/ directory is missing')
  assert.ok(cases.length >= 8, `expected at least the 8 seeded cases, found ${cases.length}`)
})

test('case discovery finds exactly the model-facing cases and no fixture', () => {
  // The outcome eval's fixtures are repositories, not cases: they carry no
  // case.yaml and no prompt.md, are graded on disk state rather than on a
  // transcript, and cost a metered run each. A fixture appearing here means one
  // acquired a case marker file, which is a defect in the fixture set — report
  // it, do not let the metered suite quietly grow by one.
  assert.deepEqual(
    cases.map(c => c.name),
    EXPECTED_CASES,
    'the discovered case set changed. If a case was added or removed on purpose, update ' +
      'EXPECTED_CASES. If a name here is an outcome-eval fixture, that fixture has acquired a ' +
      'case.yaml or prompt.md and must not be discovered as a case.'
  )
})

test('no case directory sits under a declared plugin component', () => {
  // evals/ is at the repository root by construction; this proves no case
  // escaped into skills/, agents/, commands/ or workflows/ where it would
  // shadow a component (case-suite spec).
  for (const comp of COMPONENT_DIRS) {
    const compDir = join(ROOT, comp)
    if (!existsSync(compDir)) continue
    const strays = discoverCases(compDir)
    assert.deepEqual(
      strays.map(c => `${comp}/${c.name}`),
      [],
      `eval cases must not live under ${comp}/`
    )
  }
})

test('.claude-plugin/plugin.json declares no experimental.evals key', () => {
  // evals/ is the harness default for a plugin whose root is the repo root, so
  // no manifest declaration is needed — and declaring one puts the change on an
  // undocumented, changeable manifest surface (case-suite spec, design D2).
  const manifestPath = join(ROOT, '.claude-plugin', 'plugin.json')
  if (!existsSync(manifestPath)) return
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.ok(
    !('experimental' in manifest),
    'plugin.json must not declare an experimental key for evals'
  )
})

// --- the CI definition is tracked (spec: evals/gate) ----------------------
//
// `.github/workflows/` is gitignored, so evals.yml is tracked only because it
// was force-added. Nothing else notices if that stops being true: an untracked
// workflow never runs on the remote and its absence is completely silent — the
// whole gate disappears with no failing check anywhere. GitHub requires
// workflow definitions to live in `.github/workflows/`, so moving the file out
// of the ignored directory is not available; the assertion is the mechanism.
//
// Where version-control status cannot be determined — a published tarball, an
// export with no `.git` — this skips with its reason stated rather than
// passing silently. Degradation is spoken, never silent.
const EVAL_WORKFLOW = '.github/workflows/evals.yml'
const gitCheck = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
  cwd: ROOT,
  encoding: 'utf8'
})
const NOT_A_CHECKOUT =
  gitCheck.error || gitCheck.status !== 0
    ? 'not a git checkout (or git unavailable) — tracking status cannot be determined'
    : false

test('the eval workflow definition is tracked in version control', { skip: NOT_A_CHECKOUT }, () => {
  const listed = spawnSync('git', ['ls-files', '--', EVAL_WORKFLOW], {
    cwd: ROOT,
    encoding: 'utf8'
  })
  assert.ok(!listed.error, `git ls-files failed to run: ${listed.error && listed.error.message}`)
  assert.equal(listed.status, 0, `git ls-files exited ${listed.status}: ${listed.stderr}`)
  assert.ok(
    listed.stdout.trim().length > 0,
    `${EVAL_WORKFLOW} is not tracked. .gitignore:38 ignores .github/workflows/, so this ` +
      `file only stays tracked because it was force-added — restore it with ` +
      `\`git add -f ${EVAL_WORKFLOW}\`. Untracked, the eval gate never runs on the remote ` +
      `and nothing else says so.`
  )
})

for (const kase of cases) {
  const caseYaml = join(kase.dir, 'case.yaml')

  test(`${kase.name}: is a case.yaml that pins schema_version`, () => {
    // schema_version is a case.yaml field; the harness rejects it as an unknown
    // key in prompt.md frontmatter. Pinning it is required (case-suite spec), so
    // every case takes the case.yaml form.
    assert.ok(existsSync(caseYaml), `${kase.name}: must use case.yaml to pin schema_version`)
    const text = readFileSync(caseYaml, 'utf8')
    const version = readTopLevel(text, 'schema_version')
    assert.ok(version, `${kase.name}: case.yaml does not pin schema_version`)
  })

  test(`${kase.name}: carries a provenance citation`, () => {
    const text = readFileSync(caseYaml, 'utf8')
    const provenance = readTopLevel(text, 'provenance')
    assert.ok(
      provenance && provenance.length > 0,
      `${kase.name}: case.yaml carries no provenance citation`
    )
  })

  test(`${kase.name}: every grader declares a known type`, () => {
    const gradersDir = join(kase.dir, 'graders')
    assert.ok(existsSync(gradersDir), `${kase.name}: has no graders/ directory`)
    const graderFiles = readdirSync(gradersDir).filter(f => f.endsWith('.md'))
    assert.ok(graderFiles.length >= 1, `${kase.name}: has no grader files`)
    for (const file of graderFiles) {
      const type = readGraderType(readFileSync(join(gradersDir, file), 'utf8'))
      assert.ok(
        type && KNOWN_GRADER_TYPES.has(type),
        `${kase.name}/graders/${file}: type "${type}" is not one of ${[...KNOWN_GRADER_TYPES].join(', ')}`
      )
    }
  })

  test(`${kase.name}: any twin_of declaration resolves to a case in the suite`, () => {
    // A gap-class twin cites the case it supplies the opposite side of. The
    // citation is only worth anything if it resolves: a `twin_of:` naming a case
    // that does not exist reads exactly like two-sided coverage and is none
    // (case-suite spec, "Dangling twin declaration is rejected").
    const twin = readTwinOf(readFileSync(caseYaml, 'utf8'))
    if (!twin) return
    assert.notEqual(twin, kase.name, `${kase.name}: twin_of must name another case, not itself`)
    assert.ok(
      caseNames.has(twin),
      `${kase.name}: twin_of names "${twin}", which is not a case under evals/ ` +
        `(known: ${[...caseNames].join(', ')})`
    )
  })

  test(`${kase.name}: if tagged smoke, uses only deterministic graders`, { skip: JUDGED_UNAVAILABLE }, () => {
    const text = readFileSync(caseYaml, 'utf8')
    if (!readTags(text).has('smoke')) return
    const gradersDir = join(kase.dir, 'graders')
    const graderFiles = readdirSync(gradersDir).filter(f => f.endsWith('.md'))
    const judged = []
    for (const file of graderFiles) {
      const type = readGraderType(readFileSync(join(gradersDir, file), 'utf8'))
      if (JUDGED_GRADER_TYPES.has(type)) judged.push(file)
    }
    assert.deepEqual(
      judged,
      [],
      `${kase.name}: a smoke case must use only deterministic graders, but ${judged.join(', ')} is judged`
    )
  })
}

// --- the two citation kinds are countable apart (spec: evals/case-suite) ----
//
// The review finding this closes: the structural gate could not tell an
// observed failure from a gap-class hypothesis, because both were free text in
// one `provenance:` field — so "three of eight cases are hypotheses with a
// citation" was a review finding rather than a computable fact. `twin_of:` is
// the discriminator, and this asserts the partition it induces is real: every
// case lands on exactly one side, and both sides are inhabited.

test('a twin citation is separable from an observed-failure provenance', () => {
  const twins = []
  const observed = []
  for (const kase of cases) {
    const text = readFileSync(join(kase.dir, 'case.yaml'), 'utf8')
    ;(readTwinOf(text) ? twins : observed).push(kase.name)
  }
  assert.equal(
    twins.length + observed.length,
    cases.length,
    'every case must fall on exactly one side of the twin/observed partition'
  )
  assert.deepEqual(
    twins.filter(n => observed.includes(n)),
    [],
    'the two citation kinds must be disjoint'
  )
  // Both sides inhabited: a partition where one side is empty would pass the
  // disjointness and totality checks above while proving nothing.
  assert.ok(observed.length > 0, 'the suite must hold cases citing an observed failure')
  assert.ok(
    twins.length > 0,
    'the suite must hold at least one gap-class twin declaring twin_of; the ' +
      'conditional-instruction requirement is not met without one'
  )
})

// --- judged graders are calibrated or the deferral is recorded --------------
//
// (spec: evals/case-suite, "Every judged grader carries a calibration set or a
// recorded deferral".) There are no transcripts yet, so requiring a populated
// set on the day this lands would fail. The two bad options were an assertion
// nobody runs and a set of invented labels; this is the third — the gate accepts
// a set OR a named, reasoned entry in a committed record, and separately fails
// when that record has outlived what it describes (design D2).

const DEFERRALS_FILE = join(EVALS_DIR, 'CALIBRATION-DEFERRALS.md')

/** Every judged grader in the suite, as `<case>/<grader>`. */
function judgedGraders() {
  const out = []
  for (const kase of cases) {
    const gradersDir = join(kase.dir, 'graders')
    if (!existsSync(gradersDir)) continue
    for (const file of readdirSync(gradersDir).filter(f => f.endsWith('.md'))) {
      const type = readGraderType(readFileSync(join(gradersDir, file), 'utf8'))
      if (JUDGED_GRADER_TYPES.has(type)) out.push(`${kase.name}/${file.replace(/\.md$/, '')}`)
    }
  }
  return out.sort()
}

/**
 * A judged grader has a calibration set when `evals/<case>/calibration/<grader>/`
 * exists and holds at least one label file. Per-grader rather than per-case: a
 * case with two judged graders can have one calibrated and one deferred, and
 * collapsing that to the case would report the uncalibrated one as covered.
 */
function hasCalibrationSet(graderId) {
  const [caseName, graderName] = graderId.split('/')
  const dir = join(EVALS_DIR, caseName, 'calibration', graderName)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false
  return readdirSync(dir).some(f => f.endsWith('.md'))
}

/**
 * `- \`<case>/<grader>\` — <reason>` rows from the committed deferral record.
 *
 * Only rows beneath the `## Deferred` heading count. The file documents its own
 * row format in a fenced example above that heading, and a reader that scanned
 * the whole file would parse the example as an entry — which then fails the
 * staleness check for naming a grader that does not exist. Anchoring on the
 * heading keeps the file able to explain itself.
 */
function readDeferrals() {
  if (!existsSync(DEFERRALS_FILE)) return []
  const text = readFileSync(DEFERRALS_FILE, 'utf8')
  const start = text.indexOf('\n## Deferred')
  if (start === -1) return []
  const out = []
  for (const line of text.slice(start).split('\n')) {
    const m = /^-\s*`([^`]+)`\s*[—-]\s*(.+)$/.exec(line.trim())
    if (m) out.push({ grader: m[1].trim(), reason: m[2].trim() })
  }
  return out
}

test('every judged grader has a calibration set or a recorded deferral', { skip: JUDGED_UNAVAILABLE }, () => {
  const deferred = new Set(readDeferrals().map(d => d.grader))
  const uncovered = judgedGraders().filter(g => !hasCalibrationSet(g) && !deferred.has(g))
  assert.deepEqual(
    uncovered,
    [],
    `these judged graders are neither calibrated nor recorded as deferred: ${uncovered.join(', ')}. ` +
      `Store human-labelled transcripts under evals/<case>/calibration/<grader>/, or name the ` +
      `grader with its reason in ${DEFERRALS_FILE.replace(ROOT + '/', '')}. An unlabelled judge is ` +
      `stated, never silent.`
  )
})

test('a deferral entry carries a reason and cannot outlive what it describes', { skip: JUDGED_UNAVAILABLE }, () => {
  const deferrals = readDeferrals()
  if (!existsSync(DEFERRALS_FILE)) return
  const judged = new Set(judgedGraders())
  const stale = []
  for (const { grader, reason } of deferrals) {
    if (!judged.has(grader)) {
      stale.push(`${grader} (no such judged grader)`)
    } else if (hasCalibrationSet(grader)) {
      stale.push(`${grader} (now has a calibration set)`)
    }
    assert.ok(reason.length > 0, `${grader}: a deferral must state why the set does not yet exist`)
  }
  assert.deepEqual(
    stale,
    [],
    `stale deferral entries: ${stale.join(', ')}. Remove each one — the record must not ` +
      `outlive the condition it describes.`
  )
})

// --- the eval-coverage report (spec: evals/case-suite) ---------------------
//
// A partition over the model-facing surface: every file under skills/, shared/
// and agents/, plus every prompt the ship loop assembles, lands in exactly one
// of exercised and unexercised, and the unexercised set is PRINTED, never
// asserted on. Coverage reports; it does not gate (design D3).
//
// This is a test rather than an `interlock evals coverage` subcommand for three
// reasons, the binding one being that `EXPECTED_PROMPT_LABELS` lives in
// test/helpers/ — a bin/ command reading it would make bin/ import from test/,
// inverting the dependency direction this repository holds.
//
// The hazard a print-only test creates is the one CLAUDE.md names: an
// instruction nobody asserts silently stops running. So the assertions here are
// on the SHAPE of the partition — totality, non-emptiness, and that every
// declared surface resolves — never on its size.

const SURFACE_DIRS = ['skills', 'shared', 'agents']

/** Every model-facing file, repository-relative, plus every assembled prompt. */
function discoverSurfaces() {
  const files = []
  const walk = (dir, prefix) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(join(dir, entry.name), rel)
      else files.push(rel)
    }
  }
  for (const dir of SURFACE_DIRS) walk(join(ROOT, dir), dir)
  return {
    files,
    prompts: EXPECTED_PROMPT_LABELS.map(label => `prompt:${label}`)
  }
}

/**
 * The surfaces one case declares: `exercises:` entries verbatim, plus every
 * path-shaped token in its free-text `provenance:`.
 *
 * Provenance is prose ("workflows/ship.js:194-195; test/skills.test.mjs:90-98"),
 * so tokens are split out and their `:line` / `:start-end` suffix trimmed. The
 * classifier then keeps only what matches a discovered surface EXACTLY — a
 * substring match would mark a surface exercised on a coincidence, and for a
 * report whose whole purpose is making absence visible, a false "unexercised"
 * is the correct direction to err in.
 */
function declaredSurfaces(text) {
  const exercises = readExercises(text)
  const provenance = readTopLevel(text, 'provenance') || ''
  const tokens = provenance
    .split(/[\s;,()"]+/)
    .map(t => t.replace(/:[0-9]+(-[0-9]+)?$/, '').replace(/[.,;]+$/, ''))
    .filter(Boolean)
  return { exercises, tokens }
}

test('the eval coverage report partitions the model-facing surface', () => {
  const { files, prompts } = discoverSurfaces()
  const surfaces = [...files, ...prompts]

  // A classifier that stopped discovering would satisfy totality over an empty
  // set. These bound that: the surface set is non-empty, and every component
  // directory contributes to it.
  assert.ok(surfaces.length > 0, 'discovered no model-facing surface at all')
  for (const dir of SURFACE_DIRS) {
    assert.ok(
      files.some(f => f.startsWith(`${dir}/`)),
      `discovered no file under ${dir}/ — the surface walk has stopped seeing a component directory`
    )
  }
  assert.ok(prompts.length > 0, 'discovered no assembled prompt labels')

  const known = new Set(surfaces)
  const exercised = new Set()
  for (const kase of cases) {
    const { exercises, tokens } = declaredSurfaces(readFileSync(join(kase.dir, 'case.yaml'), 'utf8'))
    for (const name of [...exercises, ...tokens]) if (known.has(name)) exercised.add(name)
  }

  const unexercised = surfaces.filter(s => !exercised.has(s))

  // Totality: exactly one of the two sets holds each surface.
  assert.equal(
    exercised.size + unexercised.length,
    surfaces.length,
    'every discovered surface must land in exactly one of exercised / unexercised'
  )
  for (const s of unexercised) {
    assert.ok(!exercised.has(s), `${s} landed in both halves of the partition`)
  }

  // The report. Printed by name, asserted on for nothing — not its size, not
  // its growth. Coverage never fails a build (case-suite spec).
  console.log(
    `\neval coverage: ${exercised.size} of ${surfaces.length} model-facing surfaces exercised by a case.`
  )
  console.log(`unexercised (${unexercised.length}):`)
  for (const s of unexercised) console.log(`  ${s}`)
  console.log('')
})

test('every surface a case declares in exercises: resolves', () => {
  // The counterpart to the twin citation's resolution check: a declaration that
  // names nothing real reads as coverage and is none (case-suite spec, "A
  // declared surface that does not exist is rejected").
  const knownPrompts = new Set(EXPECTED_PROMPT_LABELS.map(l => `prompt:${l}`))
  const unresolved = []
  for (const kase of cases) {
    for (const declared of readExercises(readFileSync(join(kase.dir, 'case.yaml'), 'utf8'))) {
      if (declared.startsWith('prompt:')) {
        if (!knownPrompts.has(declared)) unresolved.push(`${kase.name}: ${declared} (no such prompt label)`)
      } else if (!existsSync(join(ROOT, declared))) {
        unresolved.push(`${kase.name}: ${declared} (no such file)`)
      }
    }
  }
  assert.deepEqual(
    unresolved,
    [],
    `these declared surfaces do not exist: ${unresolved.join('; ')}`
  )
})

// --- one judged-type set (spec: evals/triage) --------------------------------

test('the judged grader types are the shared set, and the harness knows two of them', () => {
  assert.ok(SHARED_JUDGED, `lib/evals-types.mjs must export JUDGED_GRADER_TYPES: ${SHARED_JUDGED_ERROR?.message}`)
  assert.deepEqual(
    [...JUDGED_GRADER_TYPES].sort(),
    ['baseline', 'llm'],
    'JUDGED_GRADER_TYPES intersected with the known grader types must be exactly llm and baseline'
  )
})

// --- Spec Range (spec: evals/spec-range) --------------------------------------
//
// Ten cases, one per archived change whose ledger carried a question a human had
// to answer. Each seeds a frozen copy of that change folder WITHOUT its ledger:
// a fixture that kept `decisions.md` carries the answer, and cannot test whether
// the advisor asks the question.

const SPEC_RANGE = [
  ['harden-substantive-gates', 'harden-substantive-gates', 'D11'],
  ['add-report-dashboard', 'add-report-dashboard', 'D11'],
  ['publish-npm', 'publish-interlock-as-npm-package', 'P1'],
  ['harden-unattended', 'harden-unattended-ship-runs', 'D6'],
  ['label-merge-verdict', 'label-and-harden-the-merge-verdict', 'D1'],
  ['collapse-singleton', 'collapse-singleton-waves', 'D2'],
  ['prompt-cache-cost', 'surface-prompt-cache-cost', 'D8'],
  ['dispatch-effort', 'dispatch-published-effort', 'D14'],
  ['judge-against-base', 'judge-against-base-and-living-specs', 'D3'],
  ['merge-confidence', 'add-merge-confidence-gate', 'D8']
]

const FIXTURE_ENTRIES = new Set(['proposal.md', 'design.md', 'tasks.md', 'specs'])

/** `key: value` lines of a label.md, top-level, as written. */
function readLabelFields(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const m = /^(change|row|source|question):\s*(.*)$/.exec(line)
    if (m && !(m[1] in out)) out[m[1]] = m[2].trim()
  }
  return out
}

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    out.push(abs)
    if (entry.isDirectory()) out.push(...walk(abs))
  }
  return out
}

test('Spec Range: every slug in the table is pinned in EXPECTED_CASES', () => {
  for (const [slug] of SPEC_RANGE) {
    assert.ok(EXPECTED_CASES.includes(`spec-range-${slug}`), `EXPECTED_CASES must list spec-range-${slug}`)
  }
})

for (const [slug, change, row] of SPEC_RANGE) {
  const name = `spec-range-${slug}`
  const dir = join(EVALS_DIR, name)

  test(`${name}: case.yaml runs once, seeds by scaffold, exercises the advisor and is not smoke`, () => {
    const yamlPath = join(dir, 'case.yaml')
    assert.ok(existsSync(yamlPath), `${name}: evals/${name}/case.yaml is missing`)
    const text = readFileSync(yamlPath, 'utf8')
    assert.ok(readTopLevel(text, 'schema_version'), `${name}: case.yaml does not pin schema_version`)
    assert.equal(readTopLevel(text, 'runs'), '1', `${name}: case.yaml must set runs: 1`)
    assert.ok((readTopLevel(text, 'provenance') || '').includes(change), `${name}: provenance must name ${change}`)
    const exercises = readExercises(text)
    for (const surface of ['agents/advisor.md', 'skills/spec/SKILL.md']) {
      assert.ok(exercises.includes(surface), `${name}: exercises: must name ${surface}`)
    }
    assert.ok(!readTags(text).has('smoke'), `${name}: a Spec Range case runs in the full job only, never smoke`)

    const tools = /^\s+allowed_tools:\s*\[([^\]]*)\]/m.exec(text)
    assert.ok(tools, `${name}: execution.allowed_tools is not set`)
    assert.deepEqual(
      tools[1].split(',').map(t => t.trim()).sort(),
      ['Agent', 'Bash', 'Glob', 'Grep', 'Read', 'Write'],
      `${name}: allowed_tools must be [Agent, Bash, Read, Glob, Grep, Write]`
    )

    const script = /^\s+scaffold_script:\s*(\S+)\s*$/m.exec(text)
    assert.ok(script, `${name}: context.scaffold_script is not set`)
    const scriptPath = join(dir, script[1].replace(/['"]/g, ''))
    assert.ok(existsSync(scriptPath), `${name}: scaffold script ${script[1]} does not exist`)
    assert.ok(statSync(scriptPath).mode & 0o111, `${name}: scaffold script ${script[1]} is not executable`)
  })

  test(`${name}: the fixture holds ${change} without its ledger and nothing but the four artifact kinds`, () => {
    const changes = join(dir, 'fixture', 'openspec', 'changes')
    assert.ok(existsSync(changes), `${name}: fixture/openspec/changes/ is missing`)
    const folders = readdirSync(changes)
    assert.deepEqual(folders, [change], `${name}: the fixture must hold exactly ${change}, named without a date prefix`)
    const folder = join(changes, change)
    const extra = readdirSync(folder).filter(f => !FIXTURE_ENTRIES.has(f))
    assert.deepEqual(extra, [], `${name}: the fixture carries files the four artifact kinds do not: ${extra.join(', ')}`)
    for (const required of FIXTURE_ENTRIES) {
      assert.ok(existsSync(join(folder, required)), `${name}: the fixture is missing ${required}`)
    }
    const leaked = walk(join(dir, 'fixture')).filter(p => /(?:^|\/)(decisions|advisor)\.md$/.test(p))
    assert.deepEqual(
      leaked.map(p => p.slice(ROOT.length + 1)),
      [],
      `${name}: a fixture that carries the ledger or an advisor file carries the answer`
    )
  })

  test(`${name}: label.md cites the archived row and its question is the matches-label grader's`, () => {
    const labelPath = join(dir, 'label.md')
    assert.ok(existsSync(labelPath), `${name}: label.md is missing`)
    const fields = readLabelFields(readFileSync(labelPath, 'utf8'))
    for (const key of ['change', 'row', 'source', 'question']) {
      assert.ok(fields[key], `${name}: label.md carries no ${key}: line`)
    }
    assert.equal(fields.change, change, `${name}: label.md change: must be ${change}`)
    assert.equal(fields.row, row, `${name}: label.md row: must be ${row}`)
    assert.match(fields.source, /decisions\.md:\d+/, `${name}: label.md source: must name the archived decisions.md and line`)
    const grader = join(dir, 'graders', 'matches-label.md')
    assert.ok(existsSync(grader), `${name}: graders/matches-label.md is missing`)
    assert.ok(
      readFileSync(grader, 'utf8').includes(fields.question),
      `${name}: the label's question must appear in graders/matches-label.md`
    )
  })

  test(`${name}: carries the five graders by type`, () => {
    const expected = {
      'advisor-written': 'file_exists',
      'consult-spawned': 'tool_used',
      'check-ran': 'tool_used',
      'matches-label': 'llm',
      'answered-already': 'llm'
    }
    for (const [grader, type] of Object.entries(expected)) {
      const path = join(dir, 'graders', `${grader}.md`)
      assert.ok(existsSync(path), `${name}: graders/${grader}.md is missing`)
      assert.equal(readGraderType(readFileSync(path, 'utf8')), type, `${name}/${grader} must be ${type}`)
    }
    const written = readFileSync(join(dir, 'graders', 'advisor-written.md'), 'utf8')
    assert.ok(written.includes(`openspec/changes/${change}/advisor.md`), `${name}/advisor-written must name the advisor file`)
    const spawned = readFileSync(join(dir, 'graders', 'consult-spawned.md'), 'utf8')
    assert.ok(spawned.includes('interlock:advisor'), `${name}/consult-spawned must match interlock:advisor`)
    assert.match(spawned, /^arm:\s*with-only/m, `${name}/consult-spawned must be arm: with-only`)
    assert.match(spawned, /^max:\s*1\b/m, `${name}/consult-spawned must cap the spawn at one`)
    const check = readFileSync(join(dir, 'graders', 'check-ran.md'), 'utf8')
    assert.ok(check.includes('--check'), `${name}/check-ran must match the --check line`)
  })
}

// --- the page names Spec Range and never its caps (spec: evals/spec-range) ----

const ADVISOR_CAPS = [
  'maxAdvisorQuestions',
  'maxAdvisorBriefChars',
  'maxAdvisorNoteRows',
  'advisorKeepMinMatches',
  'advisorRepeatMaxPercent',
  'advisorVerdictMinLabels'
]

test('docs/14 has a Spec Range section naming the verdict, interlock limits and --scaffold, and no cap', () => {
  const page = readFileSync(join(ROOT, 'docs', '14-evals.md'), 'utf8')
  const heading = /^#{2,4} [^\n]*Spec Range[^\n]*$/m.exec(page)
  assert.ok(heading, 'docs/14-evals.md carries no heading naming Spec Range')
  const after = page.slice(heading.index + heading[0].length)
  const next = after.search(/^## /m)
  const section = heading[0] + (next === -1 ? after : after.slice(0, next))
  for (const token of ['interlock advisor --verdict', 'interlock limits', '--scaffold']) {
    assert.ok(section.includes(token), `docs/14-evals.md's Spec Range section must name ${token}`)
  }
  for (const cap of ADVISOR_CAPS) {
    assert.ok(!section.includes(cap), `docs/14-evals.md's Spec Range section states ${cap}; name interlock limits instead`)
    const value = LIMITS[cap]
    assert.equal(typeof value, 'number', `LIMITS.${cap} is not defined`)
    for (const spelling of new Set([String(value), value.toLocaleString('en-US'), String(value).replace(/\B(?=(\d{3})+$)/g, '_')])) {
      assert.doesNotMatch(
        section,
        new RegExp(`(?<![\\w.])${spelling}(?![\\w.])`),
        `docs/14-evals.md's Spec Range section states ${cap} (${spelling}); name interlock limits instead`
      )
    }
  }
})

// --- Review Range (spec: evals/review-range) ----------------------------------
//
// Six cases, one per fix commit whose bug a later `fix(...)` repaired. Each
// seeds the pre-fix file beside a planted review in which the real bug was
// dismissed on a citation that resolves to a changed file but does not address
// the defect. The structural block below runs `interlock review` over every
// fixture, so a fixture edit cannot quietly turn the planted bug into a
// survivor, and compares the fixture's copy of the buggy file with the fix
// commit's, so a fixture cannot quietly carry the fix.

const REVIEW_RANGE = [
  'briefing-label-path',
  'doctor-openspec-probe',
  'preflight-closer',
  'advisor-check-exits',
  'notes-path-skipped',
  'halt-card-band'
]

const REVIEW_LABEL_KEYS = ['fix', 'introduced', 'file', 'dismissed', 'bug']

/** `key: value` lines of a Review Range label.md, first occurrence wins. */
function readReviewLabel(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const m = /^(fix|introduced|file|dismissed|bug):\s*(.*)$/.exec(line)
    if (m && !(m[1] in out)) out[m[1]] = m[2].trim()
  }
  return out
}

/** The frontmatter block of a grader file, as text. */
function graderFront(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text)
  return m ? m[1] : ''
}

/** A scalar frontmatter field, unquoted. YAML single quotes escape a quote by doubling it. */
function graderField(front, key) {
  const m = new RegExp(`^${key}:[ \\t]*(.+)$`, 'm').exec(front)
  if (!m) return null
  const raw = m[1].trim()
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) return raw.slice(1, -1).replace(/''/g, "'")
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) return raw.slice(1, -1)
  return raw
}

test('Review Range: every slug in the table is pinned in EXPECTED_CASES', () => {
  for (const slug of REVIEW_RANGE) {
    assert.ok(EXPECTED_CASES.includes(`review-range-${slug}`), `EXPECTED_CASES must list review-range-${slug}`)
  }
})

for (const slug of REVIEW_RANGE) {
  const name = `review-range-${slug}`
  const dir = join(EVALS_DIR, name)
  const fixture = join(dir, 'fixture')
  const labelPath = join(dir, 'label.md')

  const label = () => {
    assert.ok(existsSync(labelPath), `${name}: label.md is missing`)
    return readReviewLabel(readFileSync(labelPath, 'utf8'))
  }
  // The files the planted review is about: everything in the fixture that is
  // not the review input or the change folder.
  const changedFiles = () => {
    assert.ok(existsSync(fixture), `${name}: fixture/ is missing`)
    return walk(fixture)
      .filter(p => statSync(p).isFile())
      .map(p => p.slice(fixture.length + 1))
      .filter(p => !p.startsWith('review/') && !p.startsWith('openspec/'))
  }

  test(`${name}: case.yaml runs once, names the fix, exercises the review advisor, grants no Write and is not smoke`, () => {
    const yamlPath = join(dir, 'case.yaml')
    assert.ok(existsSync(yamlPath), `${name}: evals/${name}/case.yaml is missing`)
    const text = readFileSync(yamlPath, 'utf8')
    assert.ok(readTopLevel(text, 'schema_version'), `${name}: case.yaml does not pin schema_version`)
    assert.equal(readTopLevel(text, 'runs'), '1', `${name}: case.yaml must set runs: 1`)
    const fixSha = (label().fix || '').split(/\s+/)[0]
    assert.match(fixSha, /^[0-9a-f]{7,40}$/, `${name}: label.md fix: must start with the fix commit's short sha`)
    assert.ok((readTopLevel(text, 'provenance') || '').includes(fixSha), `${name}: provenance must name the fix commit ${fixSha}`)
    const exercises = readExercises(text)
    for (const surface of ['agents/review-advisor.md', 'skills/review-code/SKILL.md']) {
      assert.ok(exercises.includes(surface), `${name}: exercises: must name ${surface}`)
    }
    assert.ok(!readTags(text).has('smoke'), `${name}: a Review Range case runs in the full job only, never smoke`)

    const tools = /^\s+allowed_tools:\s*\[([^\]]*)\]/m.exec(text)
    assert.ok(tools, `${name}: execution.allowed_tools is not set`)
    assert.deepEqual(
      tools[1].split(',').map(t => t.trim()).sort(),
      ['Agent', 'Bash', 'Glob', 'Grep', 'Read'],
      `${name}: allowed_tools must be [Agent, Bash, Read, Glob, Grep] with no Write, because the check reads the draft from standard input`
    )

    const script = /^\s+scaffold_script:\s*(\S+)\s*$/m.exec(text)
    assert.ok(script, `${name}: context.scaffold_script is not set`)
    const scriptPath = join(dir, script[1].replace(/['"]/g, ''))
    assert.ok(existsSync(scriptPath), `${name}: scaffold script ${script[1]} does not exist`)
    assert.ok(statSync(scriptPath).mode & 0o111, `${name}: scaffold script ${script[1]} is not executable`)
    assert.ok(existsSync(join(dir, 'fixture.sh')), `${name}: fixture.sh is missing`)
    assert.ok(statSync(join(dir, 'fixture.sh')).mode & 0o111, `${name}: fixture.sh is not executable`)
  })

  test(`${name}: the fixture holds the two review files and the proposal, and no review-advisor.md`, () => {
    assert.ok(existsSync(fixture), `${name}: fixture/ is missing`)
    for (const rel of ['review/findings.json', 'review/verdicts.json', `openspec/changes/${slug}/proposal.md`]) {
      assert.ok(existsSync(join(fixture, rel)), `${name}: the fixture is missing ${rel}`)
    }
    const leaked = walk(fixture).filter(p => /(?:^|\/)review-advisor\.md$/.test(p))
    assert.deepEqual(
      leaked.map(p => p.slice(ROOT.length + 1)),
      [],
      `${name}: a fixture that carries a review-advisor.md carries the answer`
    )
    assert.ok(changedFiles().length >= 1, `${name}: the fixture holds no changed file beside the review input`)
  })

  test(`${name}: label.md carries fix, introduced, file, dismissed and bug`, () => {
    const fields = label()
    for (const key of REVIEW_LABEL_KEYS) {
      assert.ok(fields[key], `${name}: label.md carries no ${key}: line`)
    }
    assert.match(fields.file, /^\S+:\d+$/, `${name}: label.md file: must be path:line`)
  })

  test(`${name}: interlock review over the fixture dismisses the labelled finding and leaves a survivor`, () => {
    const fields = label()
    assert.ok(fields.dismissed, `${name}: label.md carries no dismissed: line`)
    for (const rel of ['review/findings.json', 'review/verdicts.json']) {
      assert.ok(existsSync(join(fixture, rel)), `${name}: the fixture is missing ${rel}`)
    }
    const changed = changedFiles()
    assert.ok(changed.length >= 1, `${name}: the fixture holds no changed file`)
    // cwd is the fixture, so the repo's own REVIEW.md excludes nothing from it.
    const run = spawnSync(
      process.execPath,
      [
        join(ROOT, 'bin', 'interlock'), 'review',
        '--findings', 'review/findings.json',
        '--verdicts', 'review/verdicts.json',
        '--changed', changed.join(','),
        '--json'
      ],
      { cwd: fixture, encoding: 'utf8' }
    )
    assert.equal(run.status, 0, `${name}: interlock review exited ${run.status}: ${run.stderr}`)
    const result = JSON.parse(run.stdout)
    assert.ok(result.counts.raised >= 3, `${name}: the planted review must carry at least three findings, found ${result.counts.raised}`)
    assert.ok(
      result.dismissed.some(f => f.title === fields.dismissed),
      `${name}: the labelled finding "${fields.dismissed}" is not dismissed, so the case would no longer test a wrong dismissal`
    )
    assert.ok(result.surviving.length >= 1, `${name}: no finding survives, so repeats-survivor has nothing to measure`)
  })

  test(`${name}: the fixture's copy of the buggy file is not the fix commit's`, t => {
    const fields = label()
    const fixSha = (fields.fix || '').split(/\s+/)[0]
    assert.match(fixSha, /^[0-9a-f]{7,40}$/, `${name}: label.md fix: must start with the fix commit's short sha`)
    const path = (fields.file || '').replace(/:\d+$/, '')
    assert.ok(path, `${name}: label.md carries no file: line`)
    const have = spawnSync('git', ['cat-file', '-e', `${fixSha}^{commit}`], { cwd: ROOT, encoding: 'utf8' })
    if (have.status !== 0) {
      t.skip(`git history does not hold ${fixSha} (shallow or exported checkout); the fix cannot be compared`)
      return
    }
    const mine = join(fixture, path)
    assert.ok(existsSync(mine), `${name}: the fixture holds no ${path}`)
    const fixed = spawnSync('git', ['show', `${fixSha}:${path}`], { cwd: ROOT, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
    if (fixed.status !== 0) return // the fix removed the file, so the fixture cannot match it
    assert.ok(
      !readFileSync(mine).equals(fixed.stdout),
      `${name}: the fixture's ${path} matches ${fixSha}'s version, so it carries the fix`
    )
  })

  test(`${name}: carries the five graders, typed and aimed`, () => {
    const fields = label()
    const expected = {
      'check-drafted': 'regex',
      'consult-spawned': 'tool_used',
      'check-ran': 'tool_used',
      'matches-label': 'llm',
      'repeats-survivor': 'llm'
    }
    const front = {}
    for (const [grader, type] of Object.entries(expected)) {
      const path = join(dir, 'graders', `${grader}.md`)
      assert.ok(existsSync(path), `${name}: graders/${grader}.md is missing`)
      const text = readFileSync(path, 'utf8')
      assert.equal(readGraderType(text), type, `${name}/${grader} must be ${type}`)
      front[grader] = graderFront(text)
    }

    // check-drafted: the floor. Only a drafted check passes it.
    const pattern = graderField(front['check-drafted'], 'pattern')
    assert.ok(pattern, `${name}/check-drafted carries no pattern`)
    const drafted = new RegExp(pattern)
    assert.match('{"step":"check","change":"x","status":"drafted"}', drafted, `${name}/check-drafted must match a compact drafted check`)
    assert.match(
      '{\n  "step": "check",\n  "change": "x",\n  "status": "drafted",\n  "flags": []\n}',
      drafted,
      `${name}/check-drafted must match a pretty-printed drafted check`
    )
    assert.doesNotMatch(
      '{\n  "step": "check",\n  "change": "x",\n  "status": "did-not-run"\n}',
      drafted,
      `${name}/check-drafted must not pass on a did-not-run check`
    )

    // consult-spawned: the plugin-fired indicator.
    assert.equal(graderField(front['consult-spawned'], 'tool'), 'Agent', `${name}/consult-spawned must watch the Agent tool`)
    assert.ok(
      (graderField(front['consult-spawned'], 'input_match') || '').includes('interlock:review-advisor'),
      `${name}/consult-spawned must match interlock:review-advisor`
    )
    assert.equal(graderField(front['consult-spawned'], 'arm'), 'with-only', `${name}/consult-spawned must be arm: with-only`)
    assert.equal(graderField(front['consult-spawned'], 'max'), '1', `${name}/consult-spawned must cap the spawn at one`)

    // check-ran: the CLI bracket, in both of its forms.
    assert.equal(graderField(front['check-ran'], 'tool'), 'Bash', `${name}/check-ran must watch the Bash tool`)
    const ran = new RegExp(graderField(front['check-ran'], 'input_match') || '(?!)')
    for (const line of [
      `interlock review-advisor "${slug}" --check - --json`,
      `interlock review-advisor "${slug}" --check --failed "no reply" --json`
    ]) {
      assert.match(line, ran, `${name}/check-ran must match: ${line}`)
    }

    // matches-label: judged against the file the check renders.
    const matches = front['matches-label']
    assert.match(matches, /^focus:\s*\n\s+source:\s*file\s*\n\s+path:\s*(\S+)/m, `${name}/matches-label must focus a file`)
    assert.equal(
      /^focus:\s*\n\s+source:\s*file\s*\n\s+path:\s*(\S+)/m.exec(matches)[1],
      `openspec/changes/${slug}/review-advisor.md`,
      `${name}/matches-label must focus the review-advisor.md the check renders`
    )
    assert.ok(
      readFileSync(join(dir, 'graders', 'matches-label.md'), 'utf8').includes(fields.dismissed),
      `${name}/matches-label must carry the dismissed: title from label.md`
    )

    // repeats-survivor: judged against the trace.
    assert.match(front['repeats-survivor'], /^focus:\s*trace\s*$/m, `${name}/repeats-survivor must focus the trace`)
  })
}

// --- the page names Review Range and never its caps (spec: evals/review-range) --

const REVIEW_ADVISOR_CAPS = [
  'maxReviewAdvisorFlags',
  'maxReviewAdvisorBriefChars',
  'reviewAdvisorVerdictMinLabels',
  'reviewAdvisorKeepMinMatches'
]

test('docs/14 has a Review Range section naming the verdict and interlock limits, and none of the new caps', () => {
  const page = readFileSync(join(ROOT, 'docs', '14-evals.md'), 'utf8')
  const heading = /^(#{2,4}) [^\n]*Review Range[^\n]*$/m.exec(page)
  assert.ok(heading, 'docs/14-evals.md carries no heading naming Review Range')
  const after = page.slice(heading.index + heading[0].length)
  // The section runs to the next heading of the same or a shallower level.
  const next = after.search(new RegExp(`^#{1,${heading[1].length}} `, 'm'))
  const section = heading[0] + (next === -1 ? after : after.slice(0, next))
  for (const token of ['interlock review-advisor --verdict', 'interlock limits']) {
    assert.ok(section.includes(token), `docs/14-evals.md's Review Range section must name ${token}`)
  }
  for (const cap of REVIEW_ADVISOR_CAPS) {
    assert.ok(!section.includes(cap), `docs/14-evals.md's Review Range section states ${cap}; name interlock limits instead`)
    const value = LIMITS[cap]
    assert.equal(typeof value, 'number', `LIMITS.${cap} is not defined`)
    for (const spelling of new Set([String(value), value.toLocaleString('en-US'), String(value).replace(/\B(?=(\d{3})+$)/g, '_')])) {
      assert.doesNotMatch(
        section,
        new RegExp(`(?<![\\w.])${spelling}(?![\\w.])`),
        `docs/14-evals.md's Review Range section states ${cap} (${spelling}); name interlock limits instead`
      )
    }
  }
})

test('the full eval job is reachable by manual invocation only, with no schedule', () => {
  // Spec: evals/gate. With no model credential provisioned a scheduled run
  // reaches the skip step and reports green with nothing run. Adding a schedule
  // is the edit that records the credential's arrival, and it edits this pin.
  const yml = readFileSync(join(ROOT, '.github', 'workflows', 'evals.yml'), 'utf8').replace(/#.*$/gm, '')
  const triggers = yml.slice(yml.indexOf('\non:'), yml.indexOf('\nconcurrency:'))
  assert.ok(triggers.includes('\non:'), 'evals.yml has no on: block')
  assert.doesNotMatch(triggers, /^\s+schedule:/m, 'evals.yml carries a schedule with no credential provisioned')
  assert.doesNotMatch(yml, /\bcron:/, 'evals.yml carries a cron entry')
  assert.match(triggers, /^\s+workflow_dispatch:/m, 'the full suite must stay manually invocable')
  assert.match(triggers, /^\s+pull_request:/m, 'the per-change smoke keeps its pull-request trigger')
  const start = yml.search(/^ {2}full:\s*$/m)
  assert.ok(start !== -1, 'evals.yml has no full job')
  const rest = yml.slice(start + 1)
  const end = rest.search(/^ {2}[\w-]+:\s*$/m)
  const body = end === -1 ? rest : rest.slice(0, end)
  const condition = /^\s+if:\s*(.+)$/m.exec(body)?.[1].trim()
  assert.equal(condition, "github.event_name == 'workflow_dispatch'", "the full job's if must be workflow_dispatch only")
})

test('the full eval job seeds fixtures with --scaffold and the smoke job does not', () => {
  const yml = readFileSync(join(ROOT, '.github', 'workflows', 'evals.yml'), 'utf8')
  // The `claude plugin eval` invocation of one job, with its `\` continuations.
  function evalLine(job) {
    const start = yml.search(new RegExp(`^  ${job}:\\s*$`, 'm'))
    assert.ok(start !== -1, `evals.yml has no ${job} job`)
    const rest = yml.slice(start + 1)
    const end = rest.search(/^  [\w-]+:\s*$/m)
    const body = end === -1 ? rest : rest.slice(0, end)
    const lines = body.split('\n')
    const at = lines.findIndex(l => l.includes('claude plugin eval'))
    assert.ok(at !== -1, `the ${job} job runs no claude plugin eval`)
    const out = [lines[at]]
    for (let i = at; lines[i].trimEnd().endsWith('\\') && i + 1 < lines.length; i++) out.push(lines[i + 1])
    return out.join('\n')
  }
  assert.ok(evalLine('full').includes('--scaffold'), "the full job's claude plugin eval line must pass --scaffold")
  assert.ok(!evalLine('smoke').includes('--scaffold'), "the smoke job's claude plugin eval line must not pass --scaffold")
})

test('each eval job grants exactly the gated tools its cases list, so no grader is unwinnable', () => {
  // Bash, Write, Edit and WebFetch are operator-gated in `claude plugin eval`: a
  // case's allowed_tools alone does not grant them, the harness withholds them
  // from the model, and a grader that needs one cannot pass. A 2.1.306 run of a
  // Spec Range case with no --allow-tools printed that advisory and scored 0
  // (test/fixtures/evals/README.md, spec-range-2026-10-21.json).
  const GATED = ['Bash', 'Edit', 'WebFetch', 'Write']
  const yml = readFileSync(join(ROOT, '.github', 'workflows', 'evals.yml'), 'utf8')
  const jobBody = job => {
    const start = yml.search(new RegExp(`^  ${job}:\\s*$`, 'm'))
    const rest = yml.slice(start + 1)
    const end = rest.search(/^  [\w-]+:\s*$/m)
    return end === -1 ? rest : rest.slice(0, end)
  }
  const granted = job => {
    const lines = jobBody(job).split('\n')
    const at = lines.findIndex(l => l.includes('claude plugin eval'))
    const out = [lines[at]]
    for (let i = at; lines[i].trimEnd().endsWith('\\') && i + 1 < lines.length; i++) out.push(lines[i + 1])
    const m = out.join(' ').replace(/\\\s*/g, ' ').match(/--allow-tools((?:\s+(?!--)\S+)+)/)
    return m ? m[1].trim().split(/\s+/).sort() : []
  }
  const declared = cases.filter(k => existsSync(join(k.dir, 'case.yaml'))).map(k => {
    const text = readFileSync(join(k.dir, 'case.yaml'), 'utf8')
    const list = re => ((text.match(re) || [])[1] || '').split(',').map(s => s.trim()).filter(Boolean)
    return { name: k.name, tags: list(/^\s*tags:\s*\[([^\]]*)\]/m), tools: list(/^\s*allowed_tools:\s*\[([^\]]*)\]/m) }
  })
  assert.ok(declared.length >= 8 && declared.every(k => k.tools.length), 'every case.yaml was read with its allowed_tools')
  const needed = subset => [...new Set(subset.flatMap(k => k.tools.filter(t => GATED.includes(t))))].sort()
  const smokeCases = declared.filter(k => k.tags.includes('smoke'))
  assert.ok(smokeCases.length > 0, 'the smoke tag selects at least one case')
  assert.deepEqual(granted('smoke'), needed(smokeCases), 'the smoke job must grant the gated tools its smoke cases list')
  assert.deepEqual(granted('full'), needed(declared), 'the full job must grant the gated tools every case lists')
  // With no terminal (CI, or --json) an untrusted plugin directory is refused
  // before any case runs; a fresh checkout is never trusted (2.1.306).
  for (const job of ['smoke', 'full']) assert.match(jobBody(job), /claude plugin eval[^\n]*\\\n(?:\s+--?[^\n]*\\\n)*\s+--trust-plugin\b/, `the ${job} job must pass --trust-plugin`)
})
