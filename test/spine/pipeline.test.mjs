// The pipeline input, produced from a platform's own check output
// (spec: review/pipeline-evidence; design D2 to D7 of
// label-and-harden-the-merge-verdict).
//
// `lib/pipeline.mjs` is the pure half of `interlock pipeline`: two state tables
// as frozen data, three readers that turn a platform document into the input
// `interlock merge-confidence --pipeline` reads, and the one rule for what a
// well-formed input is. The fixtures in test/fixtures/pipeline/ are documents
// in each platform's own shape; nothing here calls gh, glab or the network.
//
// Shapes pinned here, so the module, the command and the skill agree:
//
//   pipelineFromGithub(doc, { required, exclude }) -> { ok: true, input, notes } | { ok: false, reason }
//   pendingFromGitlabMr(doc) -> { ok: true, input } | { ok: true, pending: { sha, headPipeline } } | { ok: false, reason }
//   pipelineFromGitlab(doc, pending, { exclude }) -> { ok: true, input, notes } | { ok: false, reason }
//   validatePipelineInput(value) -> { ok: true } | { ok: false, reason }
//   input = { sha, checks: [{ name, state, required }], excluded: [names] }

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PIPELINE_STATES,
  GITHUB_STATE_TABLE,
  GITLAB_STATE_TABLE,
  pipelineFromGithub,
  pendingFromGitlabMr,
  pipelineFromGitlab,
  validatePipelineInput
} from '../../lib/pipeline.mjs'
import { assessMergeConfidence } from '../../lib/merge-confidence.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FIXTURES = join(ROOT, 'test', 'fixtures', 'pipeline')
const MODULE = join(ROOT, 'lib', 'pipeline.mjs')
const doc = name => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'))

const stateOf = (input, name) => {
  const found = input.checks.filter(c => c.name === name)
  assert.equal(found.length, 1, `expected one entry named ${name}, found ${found.length}`)
  return found[0].state
}
const entry = (input, name) => input.checks.find(c => c.name === name)
const names = input => input.checks.map(c => c.name)

/** The verdict's pipeline signal for an input, on an otherwise clean assessment. */
function pipelineSignal(input) {
  const green = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'merge-confidence', 'all-observable-green.json'), 'utf8'))
  const result = assessMergeConfidence({ ...green, headSha: input.sha, pipeline: input })
  return { result, signal: result.signals.find(s => s.id === 'ci.pipeline') }
}

const ok = result => {
  assert.equal(result.ok, true, result.reason)
  return result
}
const refused = result => {
  assert.equal(result.ok, false, 'expected a refusal')
  assert.equal(typeof result.reason, 'string')
  assert.ok(result.reason.length > 0, 'a refusal carries its reason')
  assert.equal(result.input, undefined, 'a refusal carries no input')
  return result.reason
}

// --- the published data -------------------------------------------------------

test('PIPELINE_STATES is the frozen list of the four states an entry may carry', () => {
  assert.ok(Object.isFrozen(PIPELINE_STATES))
  assert.deepEqual([...PIPELINE_STATES], ['pass', 'fail', 'pending', 'skipped'])
})

test('the two state tables are frozen data and name no state outside the four', () => {
  for (const table of [GITHUB_STATE_TABLE, GITLAB_STATE_TABLE]) {
    assert.ok(Object.isFrozen(table))
    const seen = []
    const walk = value => {
      if (typeof value === 'string') seen.push(value)
      else if (value && typeof value === 'object') {
        assert.ok(Object.isFrozen(value), 'a nested table is not frozen')
        Object.values(value).forEach(walk)
      }
    }
    walk(table)
    assert.ok(seen.length > 0)
    for (const state of seen) assert.ok(PIPELINE_STATES.includes(state), `the table names the state ${state}`)
  }
})

test('the module is pure: no node: import, no bare specifier, no clock', () => {
  const source = readFileSync(MODULE, 'utf8')
  const imports = [...source.matchAll(/^import .* from '([^']+)'/gm)].map(m => m[1])
  for (const specifier of imports) assert.match(specifier, /^\.\/[\w-]+\.mjs$/, `impure import ${specifier}`)
  assert.doesNotMatch(source, /\brequire\(|\bprocess\.|\bDate\.now\b|\bMath\.random\b/)
})

// --- GitHub: the happy path -----------------------------------------------------

test('a pull request with three successful runs becomes an input of three passing, not-required checks', () => {
  const source = doc('github-passing')
  const { input, notes } = ok(pipelineFromGithub(source, {}))
  assert.deepEqual(Object.keys(input).sort(), ['checks', 'excluded', 'sha'])
  assert.equal(input.sha, source.headRefOid)
  assert.deepEqual(names(input), ['test (18)', 'test (20)', 'validate'])
  for (const check of input.checks) {
    assert.deepEqual(Object.keys(check).sort(), ['name', 'required', 'state'], 'an entry carries names and states only')
    assert.equal(check.state, 'pass')
    assert.equal(check.required, false)
  }
  assert.deepEqual(input.excluded, [])
  assert.ok(Array.isArray(notes))
  // Nothing of the platform's links, descriptions or times survives.
  const text = JSON.stringify(input)
  assert.doesNotMatch(text, /https?:|detailsUrl|startedAt|completedAt|workflowName|2026-/)
})

test('the sha is the document’s own head commit, never one the caller holds', () => {
  const source = { ...doc('github-passing'), headRefOid: 'c'.repeat(40) }
  assert.equal(ok(pipelineFromGithub(source, {})).input.sha, 'c'.repeat(40))
})

// --- GitHub: the state table -----------------------------------------------------

const GITHUB_EXPECTED = {
  'run-a': 'pass', // SUCCESS
  'run-b': 'skipped', // NEUTRAL
  'run-c': 'skipped', // SKIPPED
  'run-d': 'fail', // FAILURE
  'run-e': 'fail', // TIMED_OUT
  'run-f': 'fail', // ACTION_REQUIRED
  'run-g': 'fail', // STARTUP_FAILURE
  'run-h': 'pending', // CANCELLED
  'run-i': 'pending', // STALE
  'run-j': 'pending', // not completed: IN_PROGRESS
  'run-k': 'pending', // not completed: QUEUED
  'run-l': 'pending', // a conclusion the table does not name
  'ctx-a': 'pass', // commit status SUCCESS
  'ctx-b': 'fail', // FAILURE
  'ctx-c': 'fail', // ERROR
  'ctx-d': 'pending', // PENDING
  'ctx-e': 'pending', // EXPECTED
  'ctx-f': 'pending' // a state the table does not name
}

test('each named conclusion and commit-status state maps to the state the table gives it', () => {
  const { input } = ok(pipelineFromGithub(doc('github-states'), {}))
  for (const [name, state] of Object.entries(GITHUB_EXPECTED)) {
    assert.equal(stateOf(input, name), state, name)
  }
  // A commit status is named by its context.
  assert.ok(entry(input, 'ctx-a'))
})

test('a conclusion the table does not name never reads pass, and the verdict cannot read MERGE on it', () => {
  const source = doc('github-states')
  const unknown = source.statusCheckRollup.find(e => e.name === 'run-l')
  assert.equal(unknown.status, 'COMPLETED', 'precondition: the run is finished')
  const only = { headRefOid: source.headRefOid, statusCheckRollup: [unknown] }
  const { input } = ok(pipelineFromGithub(only, {}))
  assert.equal(stateOf(input, 'run-l'), 'pending')
  const { result, signal } = pipelineSignal(input)
  assert.equal(signal.band, 'unobserved')
  assert.notEqual(result.verdict, 'MERGE')
})

test('a re-run is one entry, read from the run that started last, whichever is listed first', () => {
  const source = doc('github-states')
  const { input } = ok(pipelineFromGithub(source, {}))
  assert.equal(stateOf(input, 'rerun'), 'pass')

  const pair = source.statusCheckRollup.filter(e => e.name === 'rerun')
  assert.equal(pair.length, 2)
  assert.ok(pair[0].startedAt < pair[1].startedAt, 'precondition: the passing run started later')
  const reversed = { headRefOid: source.headRefOid, statusCheckRollup: [pair[1], pair[0]] }
  assert.equal(stateOf(ok(pipelineFromGithub(reversed, {})).input, 'rerun'), 'pass')

  // The same name under another workflow is another check, not a re-run.
  const other = { ...pair[0], workflowName: 'Nightly' }
  const two = { headRefOid: source.headRefOid, statusCheckRollup: [pair[1], other] }
  assert.equal(ok(pipelineFromGithub(two, {})).input.checks.filter(c => c.name === 'rerun').length, 2)
})

test('a re-run with no readable start time is not ordered by where it is listed: the least favourable state stands, and a note says so', () => {
  const source = doc('github-states')
  const [failed, passed] = source.statusCheckRollup.filter(e => e.name === 'rerun')
  assert.equal(failed.conclusion, 'FAILURE', 'precondition')
  assert.equal(passed.conclusion, 'SUCCESS', 'precondition')
  const read = (rollup, options = { required: ['rerun'] }) =>
    ok(pipelineFromGithub({ headRefOid: source.headRefOid, statusCheckRollup: rollup }, options))
  const saysUnordered = notes => notes.some(note => note.includes('"rerun"') && /start time/.test(note))

  // Absent, unparseable, and the platform's zero time are all no start time.
  for (const noTime of [null, undefined, '', 'not a date', '0001-01-01T00:00:00Z']) {
    const untimedPass = { ...passed, startedAt: noTime }
    for (const rollup of [[failed, untimedPass], [untimedPass, failed]]) {
      const { input, notes } = read(rollup)
      assert.equal(stateOf(input, 'rerun'), 'fail', `startedAt ${JSON.stringify(noTime)}: a pass with no time hid a failure`)
      assert.ok(saysUnordered(notes), notes.join(' | '))
      // A required check in that shape blocks, whichever entry is listed last.
      const { result, signal } = pipelineSignal(input)
      assert.equal(signal.band, 'red')
      assert.equal(result.verdict, 'BLOCK')
    }
  }

  // A run that has not started, beside a finished pass, is a result not yet given.
  const queued = { ...passed, status: 'QUEUED', conclusion: '', startedAt: '0001-01-01T00:00:00Z' }
  for (const rollup of [[passed, queued], [queued, passed]]) {
    const { input, notes } = read(rollup)
    assert.equal(stateOf(input, 'rerun'), 'pending')
    assert.ok(saysUnordered(notes), notes.join(' | '))
    assert.notEqual(pipelineSignal(input).result.verdict, 'MERGE')
  }

  // A timed run later than the failure still does not outrank an untimed failure.
  const untimedFail = { ...failed, startedAt: null }
  for (const rollup of [[untimedFail, failed, passed], [passed, untimedFail, failed], [failed, passed, untimedFail]]) {
    assert.equal(stateOf(read(rollup).input, 'rerun'), 'fail')
  }

  // Nothing is said where nothing was chosen: runs that agree, a single untimed
  // run, a pair with both times, and a check the caller left out.
  assert.ok(!saysUnordered(read([passed, { ...passed, startedAt: null }]).notes))
  assert.ok(!saysUnordered(read([{ ...passed, startedAt: null }]).notes))
  assert.ok(!saysUnordered(read([failed, passed]).notes))
  assert.equal(stateOf(read([failed, passed]).input, 'rerun'), 'pass')
  const excluded = read([failed, { ...passed, startedAt: null }], { required: ['rerun'], exclude: ['rerun'] })
  assert.deepEqual(excluded.input.checks, [])
  assert.ok(!saysUnordered(excluded.notes), excluded.notes.join(' | '))
})

test('a value that names an inherited property, not a table row, reads pending like any other unknown', () => {
  const base = doc('github-passing')
  const [run] = base.statusCheckRollup
  for (const odd of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const github = { headRefOid: base.headRefOid, statusCheckRollup: [{ ...run, conclusion: odd }] }
    const { input } = ok(pipelineFromGithub(github, {}))
    assert.deepEqual(input.checks, [{ name: run.name, state: 'pending', required: false }], odd)
    assert.equal(validatePipelineInput(input).ok, true, odd)

    const gitlab = { ...doc('gitlab-pipeline-branch'), jobs: [{ name: 'job-a', status: odd, allow_failure: false }] }
    const read = ok(pipelineFromGitlab(gitlab, ok(pendingFromGitlabMr(doc('gitlab-mr-pipeline'))).pending, {}))
    assert.deepEqual(read.input.checks, [{ name: 'job-a', state: 'pending', required: true }], odd)
  }
})

test('a cancelled check run reads pending', () => {
  const { input } = ok(pipelineFromGithub(doc('github-states'), {}))
  assert.equal(stateOf(input, 'run-h'), 'pending')
})

test('an empty check list gives the head commit and no checks; a document with no check list is refused', () => {
  const empty = doc('github-empty')
  const { input } = ok(pipelineFromGithub(empty, {}))
  assert.equal(input.sha, empty.headRefOid)
  assert.deepEqual(input.checks, [])
  assert.deepEqual(input.excluded, [])

  assert.match(refused(pipelineFromGithub(doc('github-no-rollup'), {})), /check list/)
})

test('a document that is not the pull-request document is refused, naming what it lacks, and never throws', () => {
  // What `gh pr checks --json name,state` prints: an array, with no commit.
  const checksArray = [{ name: 'unit', state: 'SUCCESS' }]
  const reason = refused(pipelineFromGithub(checksArray, {}))
  assert.match(reason, /head commit/)
  assert.match(reason, /check list/)
  for (const bad of [null, undefined, 'text', 7, {}, { statusCheckRollup: [] }, { headRefOid: '', statusCheckRollup: [] }]) {
    refused(pipelineFromGithub(bad, {}))
  }
  // An entry nobody can name is not guessed at.
  refused(pipelineFromGithub({ headRefOid: 'a'.repeat(40), statusCheckRollup: ['unit'] }, {}))
  refused(pipelineFromGithub({ headRefOid: 'a'.repeat(40), statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] }, {}))
  // And the options are optional.
  ok(pipelineFromGithub(doc('github-passing')))
})

// --- GitHub: required checks ------------------------------------------------------

const threeChecks = () => {
  const base = doc('github-passing')
  const [a, b, c] = base.statusCheckRollup
  return {
    headRefOid: base.headRefOid,
    statusCheckRollup: [{ ...a, name: 'unit' }, { ...b, name: 'lint' }, { ...c, name: 'docs' }]
  }
}

test('two named checks are required and the rest are not', () => {
  const { input } = ok(pipelineFromGithub(threeChecks(), { required: ['unit', 'lint'] }))
  assert.equal(entry(input, 'unit').required, true)
  assert.equal(entry(input, 'lint').required, true)
  assert.equal(entry(input, 'docs').required, false)
})

test('a required name the platform has not reported becomes a pending, required entry, and the signal is unobserved', () => {
  const source = threeChecks()
  source.statusCheckRollup = [source.statusCheckRollup[1]]
  const { input } = ok(pipelineFromGithub(source, { required: ['unit'] }))
  assert.deepEqual(names(input).sort(), ['lint', 'unit'])
  assert.deepEqual(entry(input, 'unit'), { name: 'unit', state: 'pending', required: true })
  assert.equal(entry(input, 'lint').required, false)
  assert.equal(pipelineSignal(input).signal.band, 'unobserved')
})

test('with no required set given, a failed check is not required, a note says so, and the signal is amber, never green', () => {
  const source = threeChecks()
  source.statusCheckRollup = [{ ...source.statusCheckRollup[0], conclusion: 'FAILURE' }]
  for (const options of [{}, { required: [] }, { required: undefined }]) {
    const { input, notes } = ok(pipelineFromGithub(source, options))
    assert.equal(entry(input, 'unit').state, 'fail')
    assert.equal(entry(input, 'unit').required, false)
    assert.ok(notes.some(note => /required set was not given/.test(note)), notes.join(' | '))
    assert.equal(pipelineSignal(input).signal.band, 'amber')
  }
  // Given, no such note.
  const { notes } = ok(pipelineFromGithub(source, { required: ['unit'] }))
  assert.ok(!notes.some(note => /required set was not given/.test(note)))
})

test('a wrong required name never turns a reported check green', () => {
  const source = threeChecks()
  source.statusCheckRollup[0] = { ...source.statusCheckRollup[0], conclusion: 'FAILURE' }
  for (const required of [[], ['lint'], ['nothing-of-that-name'], ['unit']]) {
    const { input } = ok(pipelineFromGithub(source, { required }))
    assert.equal(entry(input, 'unit').state, 'fail', `required ${JSON.stringify(required)}`)
    assert.notEqual(pipelineSignal(input).signal.band, 'green')
  }
})

// --- GitHub: exclusions -----------------------------------------------------------

test('the gate’s own check is left out and named', () => {
  const source = threeChecks()
  source.statusCheckRollup = [
    source.statusCheckRollup[0],
    { ...source.statusCheckRollup[1], name: 'merge-gate', conclusion: 'FAILURE' }
  ]
  const { input, notes } = ok(pipelineFromGithub(source, { required: ['merge-gate'], exclude: ['merge-gate'] }))
  assert.deepEqual(names(input), ['unit'])
  assert.deepEqual(input.excluded, ['merge-gate'])
  assert.ok(!notes.some(note => /matched no check/.test(note)))
})

test('an exclusion is never a pattern: it matches by exact name, and an unmatched one is a note, not a record', () => {
  const source = threeChecks()
  source.statusCheckRollup = [
    { ...source.statusCheckRollup[0], name: 'test-a', conclusion: 'FAILURE' },
    { ...source.statusCheckRollup[1], name: 'test-b', conclusion: 'FAILURE' }
  ]
  const { input, notes } = ok(pipelineFromGithub(source, { exclude: ['test-*'] }))
  assert.deepEqual(names(input), ['test-a', 'test-b'])
  assert.deepEqual(input.excluded, [])
  assert.ok(notes.some(note => note.includes('test-*') && /matched no check/.test(note)), notes.join(' | '))

  // A name that is a prefix of a check's, or differs in case, excludes nothing.
  for (const near of ['test', 'TEST-A', 'test-a ']) {
    const result = ok(pipelineFromGithub(source, { exclude: [near] }))
    assert.deepEqual(names(result.input), ['test-a', 'test-b'], JSON.stringify(near))
    assert.deepEqual(result.input.excluded, [])
  }
})

test('an excluded required name that has not reported leaves no pending entry, and every exclusion given is kept', () => {
  const source = threeChecks()
  source.statusCheckRollup = [source.statusCheckRollup[0], source.statusCheckRollup[1]] // unit, lint
  const { input } = ok(pipelineFromGithub(source, { required: ['merge-gate'], exclude: ['merge-gate', 'lint'] }))
  assert.deepEqual(names(input), ['unit'])
  assert.deepEqual(input.excluded, ['merge-gate', 'lint'])
})

// --- GitLab: the merge request document --------------------------------------------

test('a merge request with no head pipeline is an input with its head commit and no checks', () => {
  const source = doc('gitlab-mr-none')
  const result = ok(pendingFromGitlabMr(source))
  assert.equal(result.pending, undefined)
  assert.deepEqual(result.input, { sha: source.sha, checks: [], excluded: [] })
  assert.equal(validatePipelineInput(result.input).ok, true)
})

test('a merge request with a head pipeline is a pending record: the head commit, the pipeline’s id, no check list', () => {
  const source = doc('gitlab-mr-pipeline')
  const result = ok(pendingFromGitlabMr(source))
  assert.equal(result.input, undefined)
  assert.deepEqual(result.pending, { sha: source.sha, headPipeline: source.head_pipeline.id })
  // The record is not a pipeline input, so the verdict refuses it if the second step never runs.
  const verdict = validatePipelineInput(result.pending)
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /no "checks" list/)
})

test('a merge request document with no head commit, or no head_pipeline key at all, is refused', () => {
  assert.match(refused(pendingFromGitlabMr(doc('gitlab-mr-no-key'))), /head_pipeline/)
  const { sha, ...noSha } = doc('gitlab-mr-pipeline')
  assert.match(refused(pendingFromGitlabMr(noSha)), /head commit/)
  for (const bad of [null, undefined, [], 'text', {}, { sha: '', head_pipeline: null }, { sha, head_pipeline: {} }, { sha, head_pipeline: 'x' }]) {
    refused(pendingFromGitlabMr(bad))
  }
})

// --- GitLab: the pipeline document ----------------------------------------------------

const pendingRecord = () => ok(pendingFromGitlabMr(doc('gitlab-mr-pipeline'))).pending

test('the three GitLab fixtures agree with the merge request: one pipeline id, the head on a branch, another commit merged', () => {
  const mr = doc('gitlab-mr-pipeline')
  const branch = doc('gitlab-pipeline-branch')
  const states = doc('gitlab-pipeline-states')
  const merged = doc('gitlab-pipeline-merged-result')
  for (const pipeline of [branch, states, merged]) assert.equal(pipeline.id, mr.head_pipeline.id)
  assert.equal(branch.sha, mr.sha)
  assert.equal(states.sha, mr.sha)
  assert.notEqual(merged.sha, mr.sha)
  assert.equal(merged.ref, `refs/merge-requests/${mr.iid}/merge`)
  assert.doesNotMatch(branch.ref, /^refs\/merge-requests\//)
})

test('a branch pipeline for the head commit: states from the table, required from allow_failure', () => {
  const pending = pendingRecord()
  const { input, notes } = ok(pipelineFromGitlab(doc('gitlab-pipeline-branch'), pending, {}))
  assert.equal(input.sha, pending.sha)
  assert.deepEqual(input.checks, [
    { name: 'job-a', state: 'pass', required: true },
    { name: 'job-b', state: 'fail', required: false },
    { name: 'job-c', state: 'fail', required: true }
  ])
  assert.deepEqual(input.excluded, [])
  assert.ok(Array.isArray(notes))
  assert.equal(validatePipelineInput(input).ok, true)
})

const GITLAB_EXPECTED = {
  'job-a': 'pass', // success
  'job-b': 'fail', // failed
  'job-c': 'skipped', // skipped
  'job-d': 'skipped', // manual, allowed to fail
  'job-e': 'pending', // manual, not allowed to fail
  'job-f': 'pending', // created
  'job-g': 'pending', // pending
  'job-h': 'pending', // preparing
  'job-i': 'pending', // running
  'job-j': 'pending', // scheduled
  'job-k': 'pending', // waiting_for_resource
  'job-l': 'pending', // waiting_for_callback
  'job-m': 'pending', // canceled
  'job-n': 'pending', // canceling
  'job-o': 'pending' // a status the table does not name
}

test('each job status maps to the state the table gives it', () => {
  const { input } = ok(pipelineFromGitlab(doc('gitlab-pipeline-states'), pendingRecord(), {}))
  for (const [name, state] of Object.entries(GITLAB_EXPECTED)) {
    assert.equal(stateOf(input, name), state, name)
  }
  assert.equal(entry(input, 'job-d').required, false)
  assert.equal(entry(input, 'job-e').required, true)
})

test('a merged-result pipeline takes the record’s head commit, and its manual job is pending and required', () => {
  const pending = pendingRecord()
  const merged = doc('gitlab-pipeline-merged-result')
  const { input } = ok(pipelineFromGitlab(merged, pending, {}))
  assert.equal(input.sha, pending.sha)
  assert.notEqual(input.sha, merged.sha)
  assert.deepEqual(entry(input, 'job-m'), { name: 'job-m', state: 'pending', required: true })
  // A merge-train reference is read the same way.
  const train = { ...merged, ref: merged.ref.replace(/merge$/, 'train') }
  assert.equal(ok(pipelineFromGitlab(train, pending, {})).input.sha, pending.sha)
})

test('a pipeline that is not the record’s is refused, naming both identifiers', () => {
  const pending = pendingRecord()
  const other = { ...doc('gitlab-pipeline-branch'), id: 9002 }
  const reason = refused(pipelineFromGitlab(other, pending, {}))
  assert.ok(reason.includes('9002'), reason)
  assert.ok(reason.includes(String(pending.headPipeline)), reason)
})

test('a branch pipeline for another commit is refused, naming both commits', () => {
  const pending = pendingRecord()
  const moved = { ...doc('gitlab-pipeline-branch'), sha: 'd'.repeat(40) }
  const reason = refused(pipelineFromGitlab(moved, pending, {}))
  assert.ok(reason.includes('d'.repeat(40)), reason)
  assert.ok(reason.includes(pending.sha), reason)
})

test('a pipeline document or a record the reader does not recognise is refused, never guessed at', () => {
  const pending = pendingRecord()
  const branch = doc('gitlab-pipeline-branch')
  const { jobs, ...noJobs } = branch
  for (const bad of [null, [], 'text', {}, noJobs, { ...branch, jobs: 'x' }, { ...branch, jobs: ['job-a'] }, { ...branch, jobs: [{ status: 'success' }] }]) {
    refused(pipelineFromGitlab(bad, pending, {}))
  }
  for (const badRecord of [null, undefined, {}, { sha: pending.sha }, { headPipeline: pending.headPipeline }, { sha: pending.sha, checks: [] }]) {
    refused(pipelineFromGitlab(branch, badRecord, {}))
  }
  ok(pipelineFromGitlab(branch, pending))
})

test('a GitLab exclusion is exact, recorded when it matched, and a note when it did not', () => {
  const pending = pendingRecord()
  const { input, notes } = ok(pipelineFromGitlab(doc('gitlab-pipeline-branch'), pending, { exclude: ['job-c', 'job-*'] }))
  assert.deepEqual(names(input), ['job-a', 'job-b'])
  assert.deepEqual(input.excluded, ['job-c'])
  assert.ok(notes.some(note => note.includes('job-*') && /matched no check/.test(note)), notes.join(' | '))
})

// --- the one rule for a well-formed input ------------------------------------------------

test('validatePipelineInput accepts every input the three readers produce', () => {
  const produced = [
    ok(pipelineFromGithub(doc('github-passing'), {})).input,
    ok(pipelineFromGithub(doc('github-states'), { required: ['run-a', 'not-reported'], exclude: ['run-b'] })).input,
    ok(pipelineFromGithub(doc('github-empty'), {})).input,
    ok(pendingFromGitlabMr(doc('gitlab-mr-none'))).input,
    ok(pipelineFromGitlab(doc('gitlab-pipeline-branch'), pendingRecord(), {})).input,
    ok(pipelineFromGitlab(doc('gitlab-pipeline-states'), pendingRecord(), { exclude: ['job-a'] })).input,
    ok(pipelineFromGitlab(doc('gitlab-pipeline-merged-result'), pendingRecord(), {})).input
  ]
  for (const input of produced) assert.deepEqual(validatePipelineInput(input), { ok: true })
  // `excluded` may be left out: a file written before the field existed is still well-formed.
  const { excluded, ...older } = produced[0]
  assert.deepEqual(validatePipelineInput(older), { ok: true })
})

test('validatePipelineInput refuses each fault, with a reason that names it', () => {
  const good = ok(pipelineFromGithub(threeChecks(), { required: ['unit'] })).input
  const withCheck = change => ({ ...good, checks: [{ ...good.checks[0], ...change }, ...good.checks.slice(1)] })
  const { checks, ...noChecks } = good
  const { sha, ...noSha } = good

  const cases = [
    [noChecks, /no "checks" list/],
    // The misspelt key: an absent list is never read as an empty one.
    [{ ...noChecks, check: checks }, /no "checks" list/],
    [{ ...good, checks: 'unit' }, /"checks"[^\n]*not a list/],
    [{ ...good, checks: { unit: 'pass' } }, /"checks"[^\n]*not a list/],
    [{ ...good, checks: [good.checks[0], 'lint'] }, /checks\[1\][^\n]*not an object/],
    [{ ...good, checks: [null] }, /checks\[0\][^\n]*not an object/],
    [withCheck({ name: '' }), /checks\[0\][^\n]*name/],
    [withCheck({ name: 7 }), /checks\[0\][^\n]*name/],
    [withCheck({ state: 'SUCCESS' }), /checks\[0\][^\n]*SUCCESS/],
    [withCheck({ state: undefined }), /checks\[0\][^\n]*state/],
    [withCheck({ required: 'yes' }), /checks\[0\][^\n]*required/],
    [withCheck({ required: undefined }), /checks\[0\][^\n]*required/],
    [noSha, /"sha"/],
    [{ ...good, sha: 7 }, /"sha"/],
    [{ ...good, excluded: 'merge-gate' }, /"excluded"/],
    [{ ...good, excluded: [7] }, /"excluded"/]
  ]
  for (const [value, pattern] of cases) {
    const verdict = validatePipelineInput(value)
    assert.equal(verdict.ok, false, JSON.stringify(value))
    assert.match(verdict.reason, pattern, JSON.stringify(value))
  }
  // A state outside the four names the four, read from the published list.
  const outside = validatePipelineInput(withCheck({ state: 'SUCCESS' })).reason
  for (const state of PIPELINE_STATES) assert.ok(outside.includes(state), `${outside} does not name ${state}`)
  assert.ok(outside.includes('unit'), 'the entry is named')

  for (const notAnObject of [null, undefined, [], 'text', 7]) {
    const verdict = validatePipelineInput(notAnObject)
    assert.equal(verdict.ok, false)
    assert.equal(typeof verdict.reason, 'string')
  }
})

test('no reader mutates the document it is handed', () => {
  for (const name of ['github-states', 'gitlab-mr-pipeline', 'gitlab-pipeline-states']) {
    const source = doc(name)
    const before = JSON.stringify(source)
    if (name === 'github-states') pipelineFromGithub(source, { required: ['run-a'], exclude: ['run-b'] })
    else if (name === 'gitlab-mr-pipeline') pendingFromGitlabMr(source)
    else pipelineFromGitlab(source, pendingRecord(), { exclude: ['job-a'] })
    assert.equal(JSON.stringify(source), before, name)
  }
})
