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
const JUDGED_GRADER_TYPES = new Set(['llm', 'baseline'])

// Directories the case suite must not live inside — placing a case under a
// declared plugin component would shadow it and trip the harness's
// component-overlap warning (case-suite spec).
const COMPONENT_DIRS = ['skills', 'agents', 'commands', 'workflows']

// Non-case entries that legitimately appear under evals/.
const NON_CASE_ENTRIES = new Set(['results', 'mocks'])

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

  test(`${kase.name}: if tagged smoke, uses only deterministic graders`, () => {
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

test('every judged grader has a calibration set or a recorded deferral', () => {
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

test('a deferral entry carries a reason and cannot outlive what it describes', () => {
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
