// Delivering the merge verdict: the platform's checks in, the verdict, its
// labels and its description block out (specs: review/pipeline-evidence,
// review/merge-confidence; design D2, D7, D8, D14, D15 of
// label-and-harden-the-merge-verdict).
//
// Everything here drives the built CLI in temporary git repositories, because
// what is under test is the hand-off between two commands: `interlock pipeline`
// writes a file, `interlock merge-confidence` reads it, and a person or a skill
// stands between them holding nothing but paths. The module-level rules are
// pinned in pipeline.test.mjs and merge-confidence.test.mjs; this file pins the
// wiring: flags, files, standard output, standard error and the exit status.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { MERGE_LABELS } from '../../lib/merge-confidence.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(ROOT, 'bin', 'interlock')
const PIPELINE_FIXTURES = join(ROOT, 'test', 'fixtures', 'pipeline')
const CHANGE = 'add-widget-catalogue'
const WIDGET_SOURCE = 'src/widgets/catalogue.ts'
const SCENARIO_COUNT = 5

let dir
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'interlock-merge-delivery-'))
})
after(() => {
  rmSync(dir, { recursive: true, force: true })
})

// --- helpers (the few this file needs, as test/spine/cli.test.mjs has them) -----

/** Run the real binary. Never throws on a non-zero exit: that is the assertion. */
function run(args, { input = '', cwd } = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: cwd === undefined ? dir : cwd, encoding: 'utf8', input })
  assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.message}`)
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

function file(name, contents) {
  const path = join(dir, name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents))
  return path
}

const fixtureText = name => readFileSync(join(PIPELINE_FIXTURES, `${name}.json`), 'utf8')
const fixtureDoc = name => JSON.parse(fixtureText(name))
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const greenFixture = () =>
  JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'merge-confidence', 'all-observable-green.json'), 'utf8'))
const signalIn = (out, id) => out.signals.find(s => s.id === id)

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid'
}

function git(root, ...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...GIT_IDENTITY } })
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}

function commit(root, files, message) {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', message)
  return git(root, 'rev-parse', 'HEAD')
}

/** The one change's files: a ledger, and delta specs carrying SCENARIO_COUNT scenarios that name the source. */
function changeFiles() {
  const scenarios = Array.from(
    { length: SCENARIO_COUNT },
    (_, i) => `#### Scenario: case ${i + 1}\n\n- **GIVEN** a catalogue\n- **WHEN** it renders\n- **THEN** it lists case ${i + 1}\n`
  ).join('\n')
  const base = `openspec/changes/${CHANGE}`
  return {
    [`${base}/proposal.md`]: '## Why\n\nList the widgets a shop sells in one catalogue view.\n',
    [`${base}/design.md`]: '## Decisions\n\nD1. The catalogue reads the existing widget store.\n',
    [`${base}/tasks.md`]: '- [ ] 1.1 Render the catalogue\n',
    [`${base}/decisions.md`]: [
      `# Decisions — ${CHANGE}`,
      '',
      '| id | question | class | resolution | evidence |',
      '|----|----|----|----|----|',
      '| D1 | Read the existing store or add one? | agent_resolved | read the existing store | design.md:3 |',
      ''
    ].join('\n'),
    [`${base}/specs/widgets/catalogue/spec.md`]:
      `## ADDED Requirements\n\n### Requirement: The catalogue lists widgets\n\n` +
      `The catalogue SHALL list every widget, rendered by \`${WIDGET_SOURCE}\`.\n\n${scenarios}`
  }
}

/**
 * A repository with a base commit on `target` and `further` commits beyond it on
 * `feature`: the first adds the source, each later one a line of documentation.
 * `shas[0]` is the first commit beyond the base; `head` is the last.
 */
function branchRepo(sub, further = 1) {
  const root = join(dir, sub)
  mkdirSync(root, { recursive: true })
  git(root, 'init', '-q', '-b', 'target')
  const base = commit(root, changeFiles(), 'base')
  git(root, 'checkout', '-q', '-b', 'feature')
  const shas = [commit(root, { [WIDGET_SOURCE]: 'export const catalogue = () => []\n' }, 'add the catalogue')]
  for (let i = 2; i <= further; i++) shas.push(commit(root, { [`docs/notes-${i}.md`]: `note ${i}\n` }, `note ${i}`))
  return { root, base, shas, head: shas[shas.length - 1] }
}

/** What a clean, reviewed run's close would have written for a run from `base` to `headSha`. */
function runEvidence({ base, headSha }, over = {}) {
  const green = greenFixture()
  const { evidence = {}, ...top } = over
  return {
    schema: 'interlock.merge-evidence/1',
    change: CHANGE,
    runId: 'run-fixture-1',
    base,
    headSha,
    committed: true,
    evidence: {
      review: green.review,
      verify: green.verify,
      handoff: { scenariosChecked: SCENARIO_COUNT, scenariosUnconfirmed: 0 },
      coverage: green.coverage,
      run: {
        halted: false,
        trajectoryComplete: true,
        stageMarkerGaps: 0,
        rejectedReports: 0,
        permissionPrompts: 0,
        autoModeDenials: 0,
        leftoverTasks: 0
      },
      ...evidence
    },
    result: null,
    ...top
  }
}

/** A passing, well-formed pipeline input for a commit, as `interlock pipeline` would write it. */
const passingPipeline = (name, sha) =>
  file(name, {
    sha,
    checks: [
      { name: 'unit', state: 'pass', required: true },
      { name: 'lint', state: 'pass', required: false }
    ],
    excluded: []
  })

const assess = (repo, ...extra) => ['merge-confidence', CHANGE, '--root', repo.root, ...extra]

// =============================================================================
// interlock pipeline
// =============================================================================

test('pipeline --github reads the document from standard input, creates the output directory, writes the input and prints one summary line', () => {
  const doc = fixtureDoc('github-passing')
  const out = join(dir, 'p-stdin', 'nested', 'deeper', 'pipeline.json')
  assert.ok(!existsSync(dirname(out)), 'precondition: the directory does not exist')
  const r = run(['pipeline', '--github', '-', '--out', out], { input: fixtureText('github-passing') })
  assert.equal(r.code, 0, r.stderr)
  const written = readJson(out)
  assert.deepEqual(written, {
    sha: doc.headRefOid,
    checks: doc.statusCheckRollup.map(entry => ({ name: entry.name, state: 'pass', required: false })),
    excluded: []
  })
  assert.equal(
    r.stdout,
    `pipeline ${doc.headRefOid}: 3 check(s) (3 pass, 0 fail, 0 pending, 0 skipped); required: not given; excluded: none\n`
  )
  assert.match(r.stderr, /required set was not given/)
})

test('pipeline --github reads a file too, and --json prints the input it wrote', () => {
  const source = file('p-file-doc.json', fixtureText('github-passing'))
  const out = join(dir, 'p-file', 'pipeline.json')
  const r = run(['pipeline', '--github', source, '--out', out, '--json'])
  assert.equal(r.code, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout), readJson(out))
  // Without --out nothing is written, and the input is still printed.
  const printed = run(['pipeline', '--github', source, '--json'])
  assert.equal(printed.code, 0, printed.stderr)
  assert.deepEqual(JSON.parse(printed.stdout), readJson(out))
})

test('two --required and two --exclude flags are all applied, and the summary names them', () => {
  const out = join(dir, 'p-flags', 'pipeline.json')
  const r = run(
    ['pipeline', '--github', '-', '--required', 'run-a', '--required', 'run-d', '--exclude', 'run-b', '--exclude', 'run-c', '--out', out],
    { input: fixtureText('github-states') }
  )
  assert.equal(r.code, 0, r.stderr)
  const written = readJson(out)
  const required = written.checks.filter(c => c.required).map(c => c.name)
  assert.deepEqual(required, ['run-a', 'run-d'], 'both required names are kept, not only the last')
  assert.ok(!written.checks.some(c => c.name === 'run-b' || c.name === 'run-c'), 'both excluded checks are left out')
  assert.deepEqual(written.excluded, ['run-b', 'run-c'])
  assert.match(r.stdout, /required: run-a, run-d; excluded: run-b, run-c\n$/)
  assert.doesNotMatch(r.stderr, /required set was not given/)

  // A single use of each flag is a list of one, not a string of characters.
  const single = run(['pipeline', '--github', '-', '--required', 'run-a', '--exclude', 'run-b', '--json'], {
    input: fixtureText('github-states')
  })
  assert.equal(single.code, 0, single.stderr)
  const one = JSON.parse(single.stdout)
  assert.deepEqual(one.checks.filter(c => c.required).map(c => c.name), ['run-a'])
  assert.deepEqual(one.excluded, ['run-b'])
})

test('an exclusion that matches nothing is said on standard error and recorded nowhere', () => {
  const r = run(['pipeline', '--github', '-', '--exclude', 'run-*', '--json'], { input: fixtureText('github-states') })
  assert.equal(r.code, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout).excluded, [])
  assert.ok(r.stderr.includes('run-*') && /matched no check/.test(r.stderr), r.stderr)
})

test('a document that is not the expected one exits 1 with nothing on stdout, and an earlier file at --out does not survive it', () => {
  const out = join(dir, 'p-refused', 'pipeline.json')
  assert.equal(run(['pipeline', '--github', '-', '--out', out], { input: fixtureText('github-passing') }).code, 0)
  assert.ok(existsSync(out), 'precondition: an earlier pipeline input is at the output path')

  // What `gh pr checks --json name,state` prints: an array, with no commit.
  const r = run(['pipeline', '--github', '-', '--out', out], { input: JSON.stringify([{ name: 'unit', state: 'SUCCESS' }]) })
  assert.equal(r.code, 1)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /head commit/)
  assert.match(r.stderr, /check list/)
  assert.ok(!existsSync(out), 'the earlier input is still where the next command would read it')
  assert.ok(r.stderr.includes(out) && /removed/.test(r.stderr), r.stderr)

  // A document that is not JSON is refused the same way, and with no earlier file nothing is said about one.
  const notJson = run(['pipeline', '--github', '-', '--out', out, '--json'], { input: 'gh: not found\n' })
  assert.equal(notJson.code, 1)
  assert.equal(notJson.stdout, '')
  assert.ok(!existsSync(out))
  assert.doesNotMatch(notJson.stderr, /removed/)
})

test('pipeline names no platform, or two, as a usage error', () => {
  const source = file('p-usage-doc.json', fixtureText('github-passing'))
  for (const argv of [['pipeline'], ['pipeline', '--github', source, '--gitlab', source, '--pending', source], ['pipeline', '--github']]) {
    const r = run(argv)
    assert.equal(r.code, 1, argv.join(' '))
    assert.equal(r.stdout, '')
    assert.ok(r.stderr.length > 0)
  }
})

test('pipeline --gitlab-pr writes an input with no checks when the pull request has no head pipeline', () => {
  const doc = fixtureDoc('gitlab-pr-none')
  const out = join(dir, 'p-gitlab-none', 'pipeline.json')
  const r = run(['pipeline', '--gitlab-pr', '-', '--out', out], { input: fixtureText('gitlab-pr-none') })
  assert.equal(r.code, 0, r.stderr)
  assert.deepEqual(readJson(out), { sha: doc.sha, checks: [], excluded: [] })
  assert.match(r.stdout, new RegExp(`^pipeline ${doc.sha}: 0 check\\(s\\)`))
})

test('pipeline --gitlab-pr writes a pending record when there is a head pipeline, and merge-confidence refuses that record', () => {
  const doc = fixtureDoc('gitlab-pr-pipeline')
  const out = join(dir, 'p-gitlab-pending', 'pipeline.json')
  const r = run(['pipeline', '--gitlab-pr', '-', '--out', out], { input: fixtureText('gitlab-pr-pipeline') })
  assert.equal(r.code, 0, r.stderr)
  assert.deepEqual(readJson(out), { sha: doc.sha, headPipeline: doc.head_pipeline.id })
  assert.equal(r.stdout, `pending ${doc.sha}: head pipeline ${doc.head_pipeline.id}\n`)

  // The second step never ran: the record is not a pipeline input.
  const repo = branchRepo('p-gitlab-pending-repo')
  const refused = run(assess(repo, '--pipeline', out, '--json'))
  assert.equal(refused.code, 1)
  assert.equal(refused.stdout, '', 'no verdict is printed')
  assert.match(refused.stderr, /no "checks" list/)

  // --gitlab-pr has nowhere to carry the head commit without --out.
  const noOut = run(['pipeline', '--gitlab-pr', '-'], { input: fixtureText('gitlab-pr-pipeline') })
  assert.equal(noOut.code, 1)
  assert.equal(noOut.stdout, '')
  assert.match(noOut.stderr, /--out/)

  // And a document with no head_pipeline key is not the platform saying there is none.
  const noKey = run(['pipeline', '--gitlab-pr', '-', '--out', out], { input: fixtureText('gitlab-pr-no-key') })
  assert.equal(noKey.code, 1)
  assert.equal(noKey.stdout, '')
  assert.match(noKey.stderr, /head_pipeline/)
  assert.ok(!existsSync(out), 'the earlier record does not survive a refused document')
})

test('pipeline --gitlab completes the record --pending names, over the same path, and refuses to run without it', () => {
  const pr = fixtureDoc('gitlab-pr-pipeline')
  const out = join(dir, 'p-gitlab', 'pipeline.json')
  assert.equal(run(['pipeline', '--gitlab-pr', '-', '--out', out], { input: fixtureText('gitlab-pr-pipeline') }).code, 0)

  const r = run(['pipeline', '--gitlab', '-', '--pending', out, '--out', out], { input: fixtureText('gitlab-pipeline-branch') })
  assert.equal(r.code, 0, r.stderr)
  assert.deepEqual(readJson(out), {
    sha: pr.sha,
    checks: [
      { name: 'job-a', state: 'pass', required: true },
      { name: 'job-b', state: 'fail', required: false },
      { name: 'job-c', state: 'fail', required: true }
    ],
    excluded: []
  })
  assert.match(r.stdout, new RegExp(`^pipeline ${pr.sha}: 3 check\\(s\\) \\(1 pass, 2 fail, 0 pending, 0 skipped\\); required: job-a, job-c; excluded: none\\n$`))

  const noPending = run(['pipeline', '--gitlab', '-', '--out', join(dir, 'p-gitlab', 'other.json')], { input: fixtureText('gitlab-pipeline-branch') })
  assert.equal(noPending.code, 1)
  assert.equal(noPending.stdout, '')
  assert.match(noPending.stderr, /--pending/)
})

test('a GitLab pipeline that is not the record’s, or a branch pipeline for another commit, exits 1 and leaves no input at the output path', () => {
  const branch = fixtureDoc('gitlab-pipeline-branch')
  for (const [label, doc, named] of [
    ['another pipeline', { ...branch, id: 9002 }, ['9002', '9001']],
    ['another commit', { ...branch, sha: 'd'.repeat(40) }, ['d'.repeat(40), branch.sha]]
  ]) {
    const out = join(dir, `p-gitlab-${label.replace(/\W+/g, '-')}`, 'pipeline.json')
    assert.equal(run(['pipeline', '--gitlab-pr', '-', '--out', out], { input: fixtureText('gitlab-pr-pipeline') }).code, 0)
    const r = run(['pipeline', '--gitlab', '-', '--pending', out, '--out', out], { input: JSON.stringify(doc) })
    assert.equal(r.code, 1, label)
    assert.equal(r.stdout, '', label)
    for (const token of named) assert.ok(r.stderr.includes(token), `${label}: ${r.stderr}`)
    assert.ok(!existsSync(out), `${label}: something is left at the output path`)
  }
})

test('a merged-result pipeline is written with the pull request’s head commit, never its own', () => {
  const pr = fixtureDoc('gitlab-pr-pipeline')
  const merged = fixtureDoc('gitlab-pipeline-merged-result')
  const out = join(dir, 'p-gitlab-merged', 'pipeline.json')
  assert.equal(run(['pipeline', '--gitlab-pr', '-', '--out', out], { input: fixtureText('gitlab-pr-pipeline') }).code, 0)
  const r = run(['pipeline', '--gitlab', '-', '--pending', out, '--out', out, '--exclude', 'job-a'], {
    input: fixtureText('gitlab-pipeline-merged-result')
  })
  assert.equal(r.code, 0, r.stderr)
  const written = readJson(out)
  assert.equal(written.sha, pr.sha)
  assert.notEqual(written.sha, merged.sha)
  assert.deepEqual(written.checks, [{ name: 'job-m', state: 'pending', required: true }])
  assert.deepEqual(written.excluded, ['job-a'])
})

// =============================================================================
// interlock merge-confidence: the pipeline file is validated before assessing
// =============================================================================

test('a pipeline file with the key check over a failed required check exits 1 naming the missing list, and prints no verdict', () => {
  const repo = branchRepo('mc-misspelt')
  const misspelt = file('mc-misspelt.json', { sha: repo.head, check: [{ name: 'unit', state: 'fail', required: true }] })
  for (const json of [[], ['--json'], ['--markdown']]) {
    const r = run(assess(repo, '--base', 'target', '--pipeline', misspelt, ...json))
    assert.equal(r.code, 1, json.join(''))
    assert.equal(r.stdout, '', 'no verdict is printed')
    assert.match(r.stderr, /no "checks" list/)
    assert.ok(r.stderr.includes(misspelt), 'the file is named')
  }
})

test('a pipeline file with an entry in the state SUCCESS exits 1 naming the entry and the four states', () => {
  const repo = branchRepo('mc-bad-state')
  const bad = file('mc-bad-state.json', { sha: repo.head, checks: [{ name: 'e2e-smoke', state: 'SUCCESS', required: true }] })
  const r = run(assess(repo, '--base', 'target', '--pipeline', bad, '--json'))
  assert.equal(r.code, 1)
  assert.equal(r.stdout, '')
  assert.ok(r.stderr.includes('e2e-smoke') && r.stderr.includes('SUCCESS'), r.stderr)
  for (const state of ['pass', 'fail', 'pending', 'skipped']) assert.ok(r.stderr.includes(state), `${r.stderr} does not name ${state}`)
})

test('an explicit empty check list is accepted: green with the no-pipeline flag', () => {
  const repo = branchRepo('mc-empty-list')
  const empty = file('mc-empty-list.json', { sha: repo.head, checks: [] })
  const r = run(assess(repo, '--base', 'target', '--pipeline', empty, '--json'))
  assert.equal(r.code, 0, r.stderr)
  const signal = signalIn(JSON.parse(r.stdout), 'ci.pipeline')
  assert.equal(signal.band, 'green')
  assert.deepEqual(signal.flags, ['no-pipeline'])
})

// =============================================================================
// interlock merge-confidence --run: the diff a run's evidence covers (D8)
// =============================================================================

const RUN_SUPPLIED = ['review.blockers', 'verify.suite', 'run.integrity']

test('on a one-commit branch the run’s evidence file is used', () => {
  const repo = branchRepo('mc-run-one')
  const evidence = file('mc-run-one.json', runEvidence({ base: repo.base, headSha: repo.head }))
  const r = run(assess(repo, '--base', 'target', '--run', evidence, '--json'))
  assert.equal(r.code, 0, r.stderr)
  assert.doesNotMatch(r.stderr, /is not used/)
  const out = JSON.parse(r.stdout)
  for (const id of RUN_SUPPLIED) assert.equal(signalIn(out, id).band, 'green', `${id}: ${signalIn(out, id).reason}`)
})

test('on a five-commit branch, a run that started at the fourth is not used under --base, and stderr names both commits', () => {
  const repo = branchRepo('mc-run-five', 5)
  assert.equal(repo.shas.length, 5)
  const fourth = repo.shas[3]
  const evidence = file('mc-run-five.json', runEvidence({ base: fourth, headSha: repo.head }))
  const pipeline = passingPipeline('mc-run-five-pipeline.json', repo.head)

  const r = run(assess(repo, '--base', 'target', '--run', evidence, '--pipeline', pipeline, '--json'))
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stderr, /is not used/)
  assert.ok(r.stderr.includes(fourth), `the run's base is not named: ${r.stderr}`)
  assert.ok(r.stderr.includes(repo.base), `the merge base is not named: ${r.stderr}`)
  const out = JSON.parse(r.stdout)
  assert.notEqual(out.verdict, 'MERGE')
  for (const id of RUN_SUPPLIED) {
    assert.equal(signalIn(out, id).band, 'unobserved', `${id} took something from a refused file: ${signalIn(out, id).reason}`)
  }
  assert.match(signalIn(out, 'review.ran').reason, /no review ran/i)
})

test('the same file with a passing pipeline and no --base is not MERGE, and --require-merge exits 1', () => {
  const repo = branchRepo('mc-run-five-no-base', 5)
  const evidence = file('mc-run-five-no-base.json', runEvidence({ base: repo.shas[3], headSha: repo.head }))
  const pipeline = passingPipeline('mc-run-five-no-base-pipeline.json', repo.head)

  const r = run(assess(repo, '--run', evidence, '--pipeline', pipeline, '--json'))
  assert.equal(r.code, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.notEqual(out.verdict, 'MERGE')
  // Nothing was borrowed from the file to stand in for the base nobody gave.
  for (const id of ['diff.shape', 'spec.coverage', 'policy.humanPaths']) {
    assert.equal(signalIn(out, id).band, 'unobserved', `${id}: ${signalIn(out, id).reason}`)
  }
  assert.equal(out.base, null)
  assert.equal(run(assess(repo, '--run', evidence, '--pipeline', pipeline, '--require-merge')).code, 1)
})

test('a target branch that gained a commit after the run started does not refuse the file: the merge base is still the run’s base', () => {
  const repo = branchRepo('mc-run-target-moved')
  git(repo.root, 'checkout', '-q', 'target')
  const moved = commit(repo.root, { 'docs/elsewhere.md': 'someone else merged this\n' }, 'an unrelated merge')
  git(repo.root, 'checkout', '-q', 'feature')
  assert.notEqual(moved, repo.base)

  const evidence = file('mc-run-target-moved.json', runEvidence({ base: repo.base, headSha: repo.head }))
  const r = run(assess(repo, '--base', 'target', '--run', evidence, '--json'))
  assert.equal(r.code, 0, r.stderr)
  assert.doesNotMatch(r.stderr, /is not used/)
  const out = JSON.parse(r.stdout)
  for (const id of RUN_SUPPLIED) assert.equal(signalIn(out, id).band, 'green', `${id}: ${signalIn(out, id).reason}`)
  assert.equal(out.base.sha, repo.base, 'the base assessed is the merge base, not the tip of the target')
})

test('a file that records no base is refused when a base is given', () => {
  const repo = branchRepo('mc-run-no-recorded-base')
  const evidence = file('mc-run-no-recorded-base.json', runEvidence({ base: null, headSha: repo.head }))
  const r = run(assess(repo, '--base', 'target', '--run', evidence, '--json'))
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stderr, /is not used/)
  assert.equal(signalIn(JSON.parse(r.stdout), 'run.integrity').band, 'unobserved')
})

test('a merge base git cannot give refuses the file naming fetch depth, and the output carries the reference with no commit', () => {
  const repo = branchRepo('mc-run-shallow')
  git(repo.root, 'checkout', '-q', 'target')
  commit(repo.root, { 'docs/elsewhere.md': 'someone else merged this\n' }, 'an unrelated merge')
  git(repo.root, 'checkout', '-q', 'feature')
  // One commit of each branch and nothing under them: no merge base to read.
  const shallow = join(dir, 'mc-run-shallow-clone')
  git(dir, 'clone', '-q', '--depth', '1', '--no-single-branch', '--branch', 'feature', pathToFileURL(repo.root).href, shallow)
  assert.equal(git(shallow, 'rev-parse', 'HEAD'), repo.head)

  const evidence = file('mc-run-shallow.json', runEvidence({ base: repo.base, headSha: repo.head }))
  const r = run(['merge-confidence', CHANGE, '--root', shallow, '--base', 'origin/target', '--run', evidence, '--json'])
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stderr, /is not used/)
  assert.ok(r.stderr.includes('fetch depth'), r.stderr)
  const out = JSON.parse(r.stdout)
  assert.deepEqual(out.base, { ref: 'origin/target', sha: null })
  assert.equal(out.head.sha, repo.head)
  assert.notEqual(out.verdict, 'MERGE')
})

// =============================================================================
// interlock merge-confidence: the commit, the base and the labels (D14)
// =============================================================================

test('--json carries the head commit, the base reference and its merge base, and the labels for the verdict and score', () => {
  const repo = branchRepo('mc-json-labels')
  const r = run(assess(repo, '--base', 'target', '--json'))
  assert.equal(r.code, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.deepEqual(out.head, { sha: repo.head })
  assert.deepEqual(out.base, { ref: 'target', sha: repo.base })

  const { labels } = out
  assert.deepEqual(Object.keys(labels).sort(), ['score', 'scorePrefix', 'verdict', 'verdictNames'])
  assert.deepEqual(labels.verdict, { ...MERGE_LABELS.verdicts[out.verdict] })
  assert.equal(labels.score.name, MERGE_LABELS.scorePrefix + String(out.score))
  assert.match(labels.score.name, /-(0|[1-9]\d*)$/)
  assert.equal(labels.score.color, MERGE_LABELS.score.color)
  assert.deepEqual(labels.verdictNames, Object.values(MERGE_LABELS.verdicts).map(l => l.name))
  assert.equal(labels.scorePrefix, MERGE_LABELS.scorePrefix)

  // The text form prints the two names on one line.
  const text = run(assess(repo, '--base', 'target'))
  const line = text.stdout.split('\n').filter(l => l.startsWith('labels:'))
  assert.equal(line.length, 1, text.stdout)
  assert.ok(line[0].includes(labels.verdict.name) && line[0].includes(labels.score.name), line[0])
})

test('in a directory that is not a repository, head and base are null and the labels are still printed', () => {
  const plain = join(dir, 'mc-not-a-repo')
  mkdirSync(plain, { recursive: true })
  // GIT_CEILING_DIRECTORIES keeps git from finding a repository above the temp directory.
  const r = spawnSync(process.execPath, [BIN, 'merge-confidence', '--root', plain, '--json'], {
    cwd: plain,
    encoding: 'utf8',
    env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(plain) }
  })
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.head, null)
  assert.equal(out.base, null)
  assert.notEqual(out.verdict, 'MERGE')
  assert.equal(out.labels.verdict.name, MERGE_LABELS.verdicts[out.verdict].name)
  assert.equal(out.labels.score.name, MERGE_LABELS.scorePrefix + String(out.score))
})

test('--label-names prints how to recognise the labels with no assessment, where every input the assessment needs is unusable', () => {
  const plain = join(dir, 'mc-label-names')
  mkdirSync(plain, { recursive: true })
  const names = { verdictNames: Object.values(MERGE_LABELS.verdicts).map(l => l.name), scorePrefix: MERGE_LABELS.scorePrefix }
  const at = args =>
    spawnSync(process.execPath, [BIN, 'merge-confidence', '--root', plain, ...args], {
      cwd: plain,
      encoding: 'utf8',
      env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(plain) }
    })

  // Not a repository, a base that names no commit and a pipeline file that does
  // not exist: each ends the assessment, and none of them is read here.
  const unusable = ['--base', 'no-such-ref', '--pipeline', join(plain, 'absent.json')]
  const stopped = at([...unusable, '--json'])
  assert.equal(stopped.status, 1, 'precondition: the assessment itself cannot run on these inputs')
  assert.equal(stopped.stdout, '')

  const r = at(['--label-names', ...unusable, '--json'])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout), { labels: names }, 'the names alone: no verdict, no score, no signal')

  // The same two keys an assessment prints under `labels`, so one rule recognises both.
  const repo = branchRepo('mc-label-names-assessed')
  const assessed = JSON.parse(run(assess(repo, '--base', 'target', '--json')).stdout)
  assert.deepEqual(
    { verdictNames: assessed.labels.verdictNames, scorePrefix: assessed.labels.scorePrefix },
    names
  )

  // The text form names each, a change name after the flag is not swallowed by
  // it, and with --markdown it is a usage error.
  const text = at(['--label-names', CHANGE])
  assert.equal(text.status, 0, text.stderr)
  for (const name of names.verdictNames) assert.ok(text.stdout.includes(name), text.stdout)
  assert.ok(text.stdout.includes(names.scorePrefix), text.stdout)
  const both = at(['--label-names', '--markdown'])
  assert.equal(both.status, 1)
  assert.equal(both.stdout, '')
  assert.ok(both.stderr.includes('--label-names') && both.stderr.includes('--markdown'), both.stderr)
})

// =============================================================================
// interlock merge-confidence --markdown (D15)
// =============================================================================

test('--markdown prints the block and nothing else, with the exit status it has without the flag', () => {
  const repo = branchRepo('mc-markdown')
  const r = run(assess(repo, '--base', 'target', '--markdown'))
  assert.equal(r.code, 0, r.stderr)
  assert.ok(r.stdout.startsWith('## Merge confidence\n'), r.stdout.slice(0, 80))
  assert.ok(r.stdout.trimEnd().endsWith('</details>'), 'the collapsed signal table is the last thing printed')
  assert.doesNotMatch(r.stdout, /^MERGE CONFIDENCE /m, 'the text form is not printed beside the block')
  assert.ok(r.stdout.includes(repo.head), 'the commit assessed')
  assert.ok(r.stdout.includes(repo.base) && r.stdout.includes('target'), 'the base')

  const json = JSON.parse(run(assess(repo, '--base', 'target', '--json')).stdout)
  assert.ok(r.stdout.includes(json.verdict))
  assert.ok(r.stdout.includes(json.labels.verdict.name) && r.stdout.includes(json.labels.score.name))
})

test('a change name after --markdown is still read as the change', () => {
  const repo = branchRepo('mc-markdown-name')
  // A second active change, so that no name resolves to "several are plausible".
  commit(repo.root, { 'openspec/changes/another-change/tasks.md': '- [ ] 1.1 Something else\n' }, 'another change')
  const first = run(['merge-confidence', CHANGE, '--root', repo.root, '--base', 'target', '--markdown'])
  const after = run(['merge-confidence', '--root', repo.root, '--base', 'target', '--markdown', CHANGE])
  assert.equal(after.code, first.code, after.stderr)
  assert.equal(after.stdout, first.stdout)
  assert.doesNotMatch(after.stderr, /no change under assessment/)
  // And with no name at all, the difference is spoken, so the comparison above means something.
  const unnamed = run(['merge-confidence', '--root', repo.root, '--base', 'target', '--markdown'])
  assert.match(unnamed.stderr, /no change under assessment/)
})

test('--markdown together with --json is a usage error: exit 1, both flags named, nothing on stdout', () => {
  const repo = branchRepo('mc-markdown-json')
  for (const order of [['--markdown', '--json'], ['--json', '--markdown']]) {
    const r = run(assess(repo, '--base', 'target', ...order))
    assert.equal(r.code, 1)
    assert.equal(r.stdout, '')
    assert.ok(r.stderr.includes('--markdown') && r.stderr.includes('--json'), r.stderr)
  }
})

test('a BLOCK prints its block and exits 1', () => {
  const repo = branchRepo('mc-markdown-block')
  const blocked = file('mc-markdown-block-review.json', {
    surviving: [
      {
        dimension: 'typescript',
        severity: 'blocker',
        title: 'unchecked null deref on an empty store',
        file: WIDGET_SOURCE,
        votes: { real: 2, notReal: 0, uncited: 0, total: 2 }
      }
    ],
    counts: { raised: 1, droppedByPolicy: 0, dismissed: 0, droppedByQuality: 0, surviving: 1, dismissalsRejected: 0 }
  })
  const r = run(assess(repo, '--base', 'target', '--review', blocked, '--markdown'))
  assert.equal(r.code, 1)
  assert.ok(r.stdout.startsWith('## Merge confidence\n'))
  assert.ok(r.stdout.includes('BLOCK'))
  assert.ok(r.stdout.includes(MERGE_LABELS.verdicts.BLOCK.name))
  assert.match(r.stdout, /needs a fix/i)
})

test('the block names the checks the pipeline input left out', () => {
  const repo = branchRepo('mc-markdown-excluded')
  const pipeline = file('mc-markdown-excluded.json', {
    sha: repo.head,
    checks: [{ name: 'unit', state: 'pass', required: true }],
    excluded: ['merge-gate']
  })
  const r = run(assess(repo, '--base', 'target', '--pipeline', pipeline, '--markdown'))
  assert.equal(r.code, 0, r.stderr)
  const above = r.stdout.slice(0, r.stdout.indexOf('<details>'))
  assert.ok(above.includes('`merge-gate`'), above)
})

// =============================================================================
// The chain: a captured platform document to a MERGE verdict, its labels and its block
// =============================================================================

test('gh’s document, through interlock pipeline, then merge-confidence with the run’s evidence: MERGE, exit 0, the MERGE label, and a block for the same commit', () => {
  const repo = branchRepo('chain')
  const doc = { ...fixtureDoc('github-passing'), headRefOid: repo.head }
  const pipeline = join(repo.root, '.claude', 'ship', 'pipeline.json')

  const produced = run(['pipeline', '--github', '-', '--out', pipeline], { input: JSON.stringify(doc) })
  assert.equal(produced.code, 0, produced.stderr)
  assert.match(produced.stdout, new RegExp(`^pipeline ${repo.head}: 3 check\\(s\\)`))

  const evidence = file('chain-evidence.json', runEvidence({ base: repo.base, headSha: repo.head }))
  const inputs = ['--base', 'target', '--pipeline', pipeline, '--run', evidence]

  const assessed = run(assess(repo, ...inputs, '--json'))
  assert.equal(assessed.code, 0, assessed.stderr)
  const out = JSON.parse(assessed.stdout)
  assert.equal(out.verdict, 'MERGE', JSON.stringify(out.driving.map(d => [d.id, d.band, d.reason]), null, 2))
  assert.equal(out.labels.verdict.name, MERGE_LABELS.verdicts.MERGE.name)
  assert.equal(out.labels.score.name, MERGE_LABELS.scorePrefix + String(out.score))
  assert.deepEqual(out.head, { sha: repo.head })
  assert.equal(run(assess(repo, ...inputs, '--require-merge')).code, 0, 'MERGE satisfies --require-merge')

  const block = run(assess(repo, ...inputs, '--markdown'))
  assert.equal(block.code, 0, block.stderr)
  assert.ok(block.stdout.startsWith('## Merge confidence\n'))
  assert.ok(block.stdout.includes('MERGE') && block.stdout.includes(`score ${out.score}`))
  assert.ok(block.stdout.includes(repo.head), 'the block names the commit the JSON names')
  assert.ok(block.stdout.includes(out.labels.verdict.name) && block.stdout.includes(out.labels.score.name))
})

test('the same chain with a required check that failed is BLOCK, exit 1, and a later pass with no start time does not lift it', () => {
  const repo = branchRepo('chain-required-fail')
  const base = fixtureDoc('github-passing')
  const [first] = base.statusCheckRollup
  const failed = { ...first, name: 'ci', conclusion: 'FAILURE' }
  const pipeline = join(repo.root, '.claude', 'ship', 'pipeline.json')
  const evidence = file('chain-required-fail-evidence.json', runEvidence({ base: repo.base, headSha: repo.head }))
  const inputs = ['--base', 'target', '--pipeline', pipeline, '--run', evidence]

  const untimedPass = { ...first, name: 'ci', conclusion: 'SUCCESS', startedAt: null }
  for (const rollup of [[failed], [failed, untimedPass], [untimedPass, failed]]) {
    const doc = { headRefOid: repo.head, statusCheckRollup: rollup }
    const produced = run(['pipeline', '--github', '-', '--required', 'ci', '--out', pipeline], { input: JSON.stringify(doc) })
    assert.equal(produced.code, 0, produced.stderr)
    assert.deepEqual(readJson(pipeline).checks, [{ name: 'ci', state: 'fail', required: true }])
    // Said on standard error only where the rule chose between two runs.
    assert.equal(/"ci".*start time/.test(produced.stderr), rollup.length > 1, produced.stderr)

    const assessed = run(assess(repo, ...inputs, '--json'))
    assert.equal(assessed.code, 1, 'BLOCK exits 1')
    const out = JSON.parse(assessed.stdout)
    assert.equal(out.verdict, 'BLOCK')
    assert.equal(signalIn(out, 'ci.pipeline').band, 'red')
    assert.equal(out.labels.verdict.name, MERGE_LABELS.verdicts.BLOCK.name)
  }
})

test('the same chain for a head the platform has not seen reads the pipeline unobserved, and is not MERGE', () => {
  const repo = branchRepo('chain-stale')
  // The platform's document still names the commit before the local head.
  const doc = { ...fixtureDoc('github-passing'), headRefOid: repo.base }
  const pipeline = join(repo.root, '.claude', 'ship', 'pipeline.json')
  assert.equal(run(['pipeline', '--github', '-', '--out', pipeline], { input: JSON.stringify(doc) }).code, 0)
  const evidence = file('chain-stale-evidence.json', runEvidence({ base: repo.base, headSha: repo.head }))

  const r = run(assess(repo, '--base', 'target', '--pipeline', pipeline, '--run', evidence, '--json'))
  assert.equal(r.code, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  const signal = signalIn(out, 'ci.pipeline')
  assert.equal(signal.band, 'unobserved')
  assert.match(signal.reason, /another commit/)
  assert.notEqual(out.verdict, 'MERGE')
})
