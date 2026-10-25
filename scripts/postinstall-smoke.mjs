#!/usr/bin/env node
// The post-install smoke: every command a shipped surface calls, run from a bin
// directory, with the exit code and the JSON keys the caller reads asserted.
//
// Development and CI tooling only. `scripts/` is not in package.json `files`, so
// this never ships. CI runs it against the installed tarball
// (`$RUNNER_TEMP/prefix/bin`); test/spine/postinstall-smoke.test.mjs runs it
// against the working tree's own `bin/`, so an inventory regression fails
// `npm test` instead of only a pipeline most contributors never wait for.
//
// Usage:
//   node scripts/postinstall-smoke.mjs <binDir> <repoRoot> <scratchDir>
//
//   binDir     the directory holding interlock, interlock-graph and interlock-run
//   repoRoot   a checkout, read only for test/fixtures and package.json
//   scratchDir where the throwaway git repository and the input files go
//
// What it proves that `--help` does not: files read at run time (the review
// dimension rubrics, the plugin files the doctor checks), the JSON keys each
// caller reads, the exit code each caller branches on, and that a command the
// CLI refuses is refused with 2. Every child runs with `binDir` first on PATH,
// so the doctor's `cli-version` row resolves to the copy under test and not to
// whatever the machine installed globally.
//
// No model and no network. The ntfy topic is emptied for every child, so a
// notify entry prints "not configured" and sends nothing.
//
// INVENTORY is the contract (design D21, D22): test/spine/cli-inventory.test.mjs
// fails when a shipped surface spells a command leaf this list does not run.
// An entry is { bin, argv, codes, keys, check?, env?, input?, setup? }:
//
//   bin    interlock | interlock-graph | interlock-run
//   argv   the arguments; `{in}`, `{fx}`, `{state}` and `{runId}` are replaced
//          with the scratch input directory, the repository's test/fixtures,
//          the copied run-state home and the committed halted run's id
//   codes  the exit codes that pass. An entry that expects a refusal lists only
//          that code, so a permissive CLI fails it
//   keys   dotted paths that must exist in the JSON on stdout
//   check  (result, ctx) => '' | a message; for what a key cannot say
//   env    extra environment for this child, as an object or (ctx) => object
//   input  stdin, as a string or (ctx) => string
//   setup  (ctx) => void, run first, for the file this entry's argv names
//
// Entries run in order and the run entries are a chain: each names the step the
// one before it returned. The order is the program's, not a style choice.
//
// Exit code: 0 when every row passes, 1 on any FAIL (or a bad invocation).

import { spawnSync, execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// --- the committed fixtures the entries read ------------------------------------------

const RUN_ID = '6e9d0b02-c70b-4d7a-9865-fa892722cecb'
const HALTED = join('ship', 'halted-run-6e9d0b02')
const CHANGE = 'add-thing'
const CLASSIFIED = '.claude/ship/classified.json'
const FINDINGS = '.claude/ship/findings.json'
// The head a merge-request review record is bound to; `mr` refuses a record bound to another.
const MR_HEAD = 'a'.repeat(40)

const TASKS_MD = `# Tasks\n\n## 1. Docs\n\n- [ ] 1.1 Write docs/a.md\n- [ ] 1.2 Write docs/b.md\n`

const handoff = id => ({
  schema: 'interlock.wave-handoff/1',
  taskId: id,
  status: 'ok',
  summary: 'done',
  evidence: ['README.md:1'],
  next: 'nothing',
  blocker: null
})

/** Two tasks in two lanes, the way a host classifies a change of two doc files. */
const classification = () => ({
  tasks: ['a', 'b'].map((n, i) => ({
    id: `1.${i + 1}`,
    group: 1,
    description: `Write docs/${n}.md`,
    tier: 4,
    model: 'sonnet',
    isTestTask: false,
    paths: [`docs/${n}.md`]
  }))
})

/** What the two implementer agents return, one result per spawn. */
const batchResults = () =>
  ['1.1', '1.2'].map(id => ({ id, ok: true, filesChanged: [`docs/${id}.md`], handoff: handoff(id) }))

const stepOf = r => {
  try {
    return JSON.parse(r.stdout)
  } catch {
    return null
  }
}

/** A check that the step names the action the chain expects. */
const action = expected => r => {
  const j = stepOf(r)
  return j && j.action === expected ? '' : `action ${j && j.action}, expected ${expected}`
}

/** `run-batch`: every spawn carries the briefing path and its hash. */
const runBatch = r => {
  const j = stepOf(r)
  if (!j || j.action !== 'run-batch') return `action ${j && j.action}, expected run-batch`
  return j.spawns.length === 2 && j.spawns.every(s => s.promptPath && s.promptSha256)
    ? ''
    : 'spawns carry no promptPath and promptSha256'
}

/** The strict tail's review step: the rubric of every selected dimension was read from the install. */
const reviewStep = (r, ctx) => {
  const j = stepOf(r)
  if (!j || j.action !== 'review') return `action ${j && j.action}, expected review`
  const unavailable = (j.banners || []).filter(b => /REVIEW RUBRIC UNAVAILABLE/.test(b))
  if (unavailable.length) return unavailable.join('; ')
  const briefing = join(ctx.work, '.claude', 'ship', 'briefings', 'review.md')
  if (!existsSync(briefing)) return 'no review briefing was written'
  const text = readFileSync(briefing, 'utf8')
  const headings = (text.match(/^# Dimension: /gm) || []).length
  return headings >= 4 ? '' : `the review briefing carries ${headings} dimension rubrics, expected at least 4`
}

/**
 * Start from a clean slate: the previous run's state files go, its trajectory stays (run-log
 * reads it), and the change's tasks are unticked again.
 */
function freshRun(ctx) {
  const ship = join(ctx.work, '.claude', 'ship')
  for (const name of existsSync(ship) ? readdirSync(ship) : []) {
    if (name !== 'runs') rmSync(join(ship, name), { recursive: true, force: true })
  }
  ctx.put(`openspec/changes/${CHANGE}/tasks.md`, TASKS_MD)
}

const rowOf = (j, id) => (j && Array.isArray(j.checks) ? j.checks.find(c => c.id === id) : undefined)

/** The doctor's rows that prove the install: the plugin is complete and the CLI on PATH is this one. */
const doctorRows = r => {
  const j = stepOf(r)
  for (const id of ['plugin', 'binaries', 'cli-version']) {
    const row = rowOf(j, id)
    if (!row) return `no ${id} row`
    if (row.status !== 'ok') return `${id} row is ${row.status}: ${String(row.detail).slice(0, 160)}`
  }
  return ''
}

// --- the inventory --------------------------------------------------------------------

const I = 'interlock'
const G = 'interlock-graph'
const R = 'interlock-run'

export const INVENTORY = [
  // The four questions every install is asked first: does it run, which version is it,
  // does it refuse what it does not know, does it explain itself where it is asked.
  { bin: I, argv: ['--help'], codes: [0], check: r => ['run start', 'doctor', 'merge-confidence', 'tasks tick'].find(s => !r.stdout.includes(`interlock ${s}`)) ? 'the help does not name every command' : '' },
  { bin: G, argv: ['--help'], codes: [0] },
  { bin: R, argv: ['--help'], codes: [0] },
  {
    bin: I,
    argv: ['--version'],
    codes: [0],
    check: (r, ctx) => {
      const out = r.stdout.trim()
      if (!/^\d+\.\d+\.\d+/.test(out)) return `printed "${out.slice(0, 40)}", not a version`
      if (!ctx.version) return `printed ${out}, but the checkout version could not be read to compare it with`
      return out !== ctx.version ? `printed ${out}, the checkout is ${ctx.version}` : ''
    }
  },
  { bin: I, argv: ['version', '--json'], codes: [0], keys: ['version', 'path'] },
  { bin: G, argv: ['--version'], codes: [0], check: r => (/^\d+\.\d+\.\d+/.test(r.stdout.trim()) ? '' : 'not a version') },
  { bin: R, argv: ['--version'], codes: [0], check: r => (/^\d+\.\d+\.\d+/.test(r.stdout.trim()) ? '' : 'not a version') },
  // An unknown flag is refused by name (exit 2), not run with the flag ignored.
  {
    bin: I,
    argv: ['limits', '--not-a-flag'],
    codes: [2],
    check: r => (/--not-a-flag/.test(r.stderr) && /limits/.test(r.stderr) ? '' : 'the refusal does not name the flag and the subcommand')
  },
  // -h after a subcommand prints that subcommand's usage and runs nothing.
  {
    bin: I,
    argv: ['doctor', '-h'],
    codes: [0],
    check: r => (/interlock doctor/.test(r.stdout) && !/"checks"/.test(r.stdout) ? '' : 'did not print the doctor usage, or ran the doctor')
  },
  {
    bin: R,
    argv: ['add-thing', '-h'],
    codes: [0],
    check: r => (/interlock-run/.test(r.stdout) && /Usage/i.test(r.stdout) ? '' : 'did not print the usage')
  },

  // Preflight: the doctor reads the installed plugin and the binary on PATH, which
  // the script leads with binDir.
  { bin: I, argv: ['limits', '--json'], codes: [0], keys: ['limits.maxParallel', 'evals.smokeCostUsd', 'evals.fullRunCostUsd', 'evals.runsPerCase', 'evals.shipEvalCostUsd', 'evals.matrixCostUsd', 'prices', 'mergeBands'] },
  // Run as a plugin session runs it, with the plugin root set: by name alone the
  // doctor has no plugin to compare the CLI with, and its cli-version row skips.
  // The root is the package the binary under test belongs to.
  {
    bin: I,
    argv: ['doctor', '--json'],
    codes: [0, 1],
    keys: ['ok', 'checks', 'counts', 'stateHome', 'surface'],
    env: ctx => ({ CLAUDE_PLUGIN_ROOT: ctx.binPackage }),
    check: doctorRows
  },

  // The OpenSpec readers.
  { bin: I, argv: ['changes'], codes: [0], check: r => (r.stdout.trim() === CHANGE ? '' : 'change not listed') },
  { bin: I, argv: ['validate', CHANGE, '--json'], codes: [0], keys: ['ready', 'problems'] },
  { bin: I, argv: ['surface', '--changed', 'src/Button.tsx', 'docs/readme.md', '--json'], codes: [0], keys: ['needsManualTestPlan', 'needsDevopsReview', 'files'] },

  // The review gate.
  { bin: I, argv: ['gate', '--findings', '{in}/blocker.json', '--json'], codes: [1], keys: ['passed', 'blockers', 'autonomyOutcome.blockers'] },
  { bin: I, argv: ['gate', '--findings', '{in}/empty.json', '--metrics', CHANGE, '--json'], codes: [0], keys: ['passed', 'metrics.written'] },
  { bin: I, argv: ['review', '--findings', '{in}/blocker.json', '--verdicts', '{in}/empty.json', '--changed', 'src/a.mjs', '--base', 'HEAD~1', '--metrics', CHANGE, '--json'], codes: [0], keys: ['counts.surviving', 'surviving'] },
  { bin: I, argv: ['review-policy', '--base', 'HEAD~1', '--json'], codes: [0], keys: ['humanPaths', 'excludePaths'] },
  { bin: I, argv: ['domain-context', CHANGE, '--changed', 'src/a.mjs', '--base', 'HEAD~1', '--json'], codes: [0], keys: ['selected'] },
  { bin: I, argv: ['drift', '--changed', 'src/a.mjs', '--json'], codes: [0], keys: ['unarchived', 'stale', 'orphans'] },
  { bin: I, argv: ['ledger', CHANGE, '--json'], codes: [1], keys: ['missing', 'blocking'] },
  { bin: I, argv: ['ready', CHANGE, '--findings', '{in}/empty.json', '--json'], codes: [0, 1], keys: ['ready'] },

  // The spec skill's commands.
  { bin: I, argv: ['autonomy', 'record', 'review-code', '--blockers', '0', '--json'], codes: [0], keys: ['current_level', 'consecutive_clean'] },
  { bin: I, argv: ['autonomy', 'clean', 'review-artifacts', 'explore', 'spec', '--json'], codes: [0], check: r => (Array.isArray(stepOf(r)) ? '' : 'not an array') },
  { bin: I, argv: ['note', 'match', CHANGE, '--json'], codes: [0], keys: ['rows'] },
  { bin: I, argv: ['note', 'derive', '--findings', '{in}/blocker.json', '--change', CHANGE, '--json'], codes: [0] },
  { bin: I, argv: ['notify', 'checkpoint', CHANGE], codes: [0], env: { INTERLOCK_NTFY_TOPIC: '' }, check: r => (/not configured/.test(r.stdout) ? '' : 'no not-configured line') },

  // The merge flow.
  { bin: I, argv: ['pipeline', '--github', '-', '--required', 'x', '--out', '{in}/pipe.json'], codes: [0], input: ctx => readFileSync(join(ctx.fixtures, 'pipeline', 'github-passing.json'), 'utf8') },
  { bin: I, argv: ['merge-confidence', CHANGE, '--base', 'HEAD~1', '--pipeline', '{in}/pipe.json', '--json'], codes: [0, 1], keys: ['verdict', 'score', 'signals'] },
  { bin: I, argv: ['merge-confidence', CHANGE, '--base', 'HEAD~1', '--markdown'], codes: [0, 1], check: r => (/Merge confidence/.test(r.stdout) ? '' : 'no markdown header') },
  { bin: I, argv: ['merge-confidence', '--label-names', '--json'], codes: [0] },

  // The merge-request review loop (the mr skill's --review): what it pipes to the merge
  // request, the briefings it hands its workers, and the paths the test guard protects.
  // The scratch change has no delta spec and no graph is built yet, so the conformance
  // brief takes its nothing-to-confirm exit: silent stdout, the reason on stderr.
  {
    bin: I,
    argv: ['mr', 'comment', '--review', '{in}/mr-review.json', '--head', MR_HEAD, '--round', '0', '--json'],
    codes: [0],
    keys: ['head', 'round', 'findings'],
    check: r => (stepOf(r).findings.length === 1 ? '' : 'the surviving finding was not listed')
  },
  {
    bin: I,
    argv: ['mr', 'replies', '--before', '{in}/mr-review.json', '--after', '{in}/mr-review.json', '--head', MR_HEAD, '--json'],
    codes: [0],
    keys: ['head', 'fixed', 'open', 'new'],
    check: r => (stepOf(r).open.length === 1 ? '' : 'the finding both rounds hold is not open')
  },
  {
    bin: I,
    argv: ['mr', 'remediate-brief', '--review', '{in}/mr-review.json', '--round', '1', '--change', CHANGE, '--head', MR_HEAD, '--pr', '7', '--json'],
    codes: [0],
    keys: ['briefing', 'findings', 'resultPath', 'head']
  },
  {
    bin: I,
    argv: ['mr', 'fixer-result', '--result', '{in}/mr-fixer.json', '--review', '{in}/mr-review.json', '--round', '1', '--head', MR_HEAD, '--json'],
    codes: [1],
    check: r => (r.stdout === '' && /fixer result/.test(r.stderr) ? '' : 'a missing fixer result was not refused')
  },
  {
    bin: I,
    argv: ['mr', 'tree-check', '--change', CHANGE, '--status', '-', '--json'],
    codes: [1],
    keys: ['clean', 'dirty', 'tolerated'],
    input: ' M src/a.mjs\0?? json\0',
    check: r => (stepOf(r).dirty.length === 2 ? '' : 'the two dirty paths were not both named')
  },
  {
    bin: I,
    argv: ['mr', 'test-paths', '--changed', '-', '--json'],
    codes: [0],
    keys: ['protected', 'unprotected', 'profile', 'reason'],
    input: 'test/a.test.mjs\nsrc/a.mjs\n',
    check: r => (stepOf(r).unprotected.length === 2 ? '' : 'the paths on stdin were not both read')
  },
  {
    bin: I,
    argv: ['mr', 'conformance-brief', CHANGE, '--changed', 'src/a.mjs', '--base', 'HEAD~1', '--head', MR_HEAD, '--json'],
    codes: [0],
    check: r => (r.stdout === '' && /nothing to confirm/.test(r.stderr) ? '' : 'did not take the nothing-to-confirm exit')
  },

  // The corpora.
  { bin: I, argv: ['report', '--json'], codes: [0], keys: ['coverage', 'indicators'] },
  { bin: I, argv: ['report', '--html'], codes: [0], check: r => (r.stdout.startsWith('<!doctype html>') ? '' : 'no html') },
  {
    bin: I,
    argv: ['evals', 'capture', '--run', '{runId}', '--task', '1.1', '--out', '{in}/captured', '--state-home', '{state}'],
    codes: [0],
    check: r => (/CAPTURED DRAFT/.test(r.stdout) ? '' : 'no draft was captured from the committed run')
  },
  { bin: I, argv: ['evals', 'triage', '--results', '{in}/res.json', '--json'], codes: [0], keys: ['cases'] },

  // The committed halted run: the board is byte-identical to the fixture's, and the
  // trajectory copied under a state home reads back through run-log.
  { bin: I, argv: ['waves', '--plan', '{fx}/' + HALTED + '/plan.json', '--format', 'board'], codes: [0], check: (r, ctx) => (r.stdout === readFileSync(join(ctx.fixtures, HALTED, 'board.txt'), 'utf8') ? '' : 'board differs from the fixture') },
  { bin: I, argv: ['run-log', 'show', '{runId}', '--state-home', '{state}', '--format', 'board'], codes: [0] },
  { bin: I, argv: ['run-log', 'check', '--run-id', '{runId}', '--state-home', '{state}', '--json'], codes: [0], keys: ['ok'] },
  { bin: I, argv: ['run-log', 'query', '--run', '{runId}', '--halted', '--state-home', '{state}', '--json'], codes: [0] },

  // The recovery line the halt card prints: the change is a positional.
  { bin: I, argv: ['tasks', 'tick', CHANGE, '--ids', '1.1', '--json'], codes: [0], keys: ['ticked'] },

  // The loop itself. Three runs, each on a clean slate, each calling exactly the step the
  // one before it named. The order inside a run is the program's, not a style choice.
  //
  // Run A, lean with a handoff: start -> classified -> record-batch -> judge -> commit -> close.
  {
    bin: I,
    argv: ['run', 'start', '--change', CHANGE, '--host', 'workflow', '--handoff', '--json'],
    codes: [0],
    keys: ['action', 'then.argv', 'spawns'],
    check: action('classify')
  },
  {
    bin: I,
    argv: ['run', 'classified', '--classified', CLASSIFIED, '--json'],
    codes: [0],
    keys: ['spawns', 'then.argv'],
    setup: ctx => ctx.put(CLASSIFIED, classification()),
    check: runBatch
  },
  {
    bin: I,
    argv: ['run', 'record-batch', '--results', '{in}/batch.json', '--json'],
    codes: [0],
    keys: ['action', 'then.argv', 'recorded.ok'],
    check: r => {
      const j = stepOf(r)
      return j && j.recorded && j.recorded.ok.length === 2 && j.recorded.failed.length === 0 ? '' : 'the two tasks were not recorded ok'
    }
  },
  { bin: I, argv: ['run', 'judge', '--context', 'final', '--results', '{in}/empty.json', '--json'], codes: [0], keys: ['action', 'then.argv'], check: action('handoff') },
  { bin: I, argv: ['run', 'commit', '--results', '{in}/review-ok.json', '--json'], codes: [0], keys: ['action', 'then.argv'], check: action('commit') },
  { bin: I, argv: ['run', 'close', '--json'], codes: [0], keys: ['action', 'exitCode', 'summary'], check: action('complete') },

  // Run B, strict: the review step reads every dimension's rubric from the install
  // (lib/run.mjs REVIEW_DIMENSIONS_DIR), which `--help` cannot prove. A review that finds a
  // blocker is handed to a fixing round, and the run ends halted, notifying nobody.
  {
    bin: I,
    argv: ['run', 'start', '--change', CHANGE, '--host', 'workflow', '--strict', '--json'],
    codes: [0],
    keys: ['action', 'then.argv'],
    setup: freshRun,
    check: action('classify')
  },
  {
    bin: I,
    argv: ['run', 'classified', '--classified', CLASSIFIED, '--json'],
    codes: [0],
    keys: ['spawns', 'then.argv'],
    setup: ctx => ctx.put(CLASSIFIED, classification()),
    check: runBatch
  },
  { bin: I, argv: ['run', 'record-batch', '--results', '{in}/batch.json', '--json'], codes: [0], keys: ['action', 'then.argv', 'spawns'], check: reviewStep },
  {
    bin: I,
    argv: ['run', 'reviewed', '--results', '{in}/review-ok.json', '--json'],
    codes: [0],
    keys: ['action', 'then.argv'],
    setup: ctx => {
      // What the review agent leaves behind: a blocker on a file the run changed.
      ctx.put('src/a.mjs', 'export const x = 1\nexport const y = 3\n')
      ctx.put(FINDINGS, [{ dimension: 'qa', findings: [{ severity: 'blocker', file: 'src/a.mjs', line: 1, title: 't', description: 'd', evidence: 'src/a.mjs:1' }] }])
    },
    check: action('remediate')
  },
  { bin: I, argv: ['run', 'remediated', '--round', '1', '--results', '{in}/review-ok.json', '--json'], codes: [0], keys: ['action', 'then.argv'] },
  // `run replan` is offered only at a wave boundary after a verify suggested it, which one
  // wave cannot reach. Called now it must be refused by the sequence guard, which proves the
  // leaf is dispatched and the guard is wired.
  {
    bin: I,
    argv: ['run', 'replan'],
    codes: [1],
    check: r => (/out of sequence/.test(r.stderr) ? '' : 'the sequence guard did not refuse a replan nobody asked for')
  },
  { bin: I, argv: ['run', 'close', '--halt', 'post-install smoke', '--notify', '--json'], codes: [1], keys: ['action', 'exitCode', 'summary'] },
  { bin: I, argv: ['run-log', 'list', '--json'], codes: [0], check: r => ((stepOf(r)?.runs?.length ?? 0) >= 2 ? '' : 'fewer than two runs recorded') },

  // Verification.
  {
    bin: I,
    argv: ['verify', 'plan', '--context', 'inter-wave', '--no-profile', '--json'],
    codes: [0],
    keys: ['steps', 'skipped'],
    check: (r, ctx) => {
      ctx.vplan = r.stdout
      return ''
    }
  },
  {
    bin: I,
    argv: ['verify', 'judge', '--plan', '{in}/vplan.json', '--results', '{in}/empty.json', '--json'],
    codes: [0, 1],
    setup: ctx => writeFileSync(join(ctx.inputs, 'vplan.json'), ctx.vplan || '{}'),
    check: r => (stepOf(r) ? '' : 'stdout is not JSON')
  },
  { bin: I, argv: ['verify', 'baseline', '--report', '{in}/lcov.info', '--json'], codes: [0], keys: ['totalPct', 'sha'] },
  { bin: I, argv: ['verify', 'coverage', '--report', '{in}/lcov.info', '--base', 'HEAD~1', '--json'], codes: [0], keys: ['configured', 'headTotalPct', 'diffPct'] },
  { bin: I, argv: ['verify', 'exec', '--kind', 'unit', '--command', 'exit 3'], codes: [3] },
  { bin: I, argv: ['verify', 'spill', '--run-id', 'pi', '--kind', 'unit', '--input', '{in}/big.txt', '--json'], codes: [0], keys: ['bytes', 'truncated'] },

  // The graph.
  { bin: G, argv: ['build', '.'], codes: [0] },
  { bin: G, argv: ['update', '.'], codes: [0] },
  { bin: G, argv: ['query', 'thing', '--budget', '300'], codes: [0] },
  { bin: G, argv: ['consumers', 'src/a.mjs'], codes: [0] },
  { bin: G, argv: ['context', 'thing', '--budget', '300'], codes: [0] },
  { bin: G, argv: ['docs', 'thing', '--budget', '200'], codes: [0] },
  { bin: G, argv: ['docs-index', '.', '--no-write'], codes: [0] },
  { bin: G, argv: ['explain', 'src/a.mjs'], codes: [0] },
  { bin: G, argv: ['which'], codes: [0] },

  // The second host's driver refuses a host it does not know.
  { bin: R, argv: ['add-thing', '--host', 'bogus'], codes: [2] }
]

// --- the run --------------------------------------------------------------------------

/** The scratch repository: one change, two commits, the inputs the entries name. */
function prepare(scratch, repo) {
  const work = join(scratch, 'pi-repo')
  const inputs = join(scratch, 'pi-in')
  const state = join(inputs, 'sh')
  rmSync(work, { recursive: true, force: true })
  rmSync(inputs, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  mkdirSync(inputs, { recursive: true })

  const put = (rel, body) => {
    const p = join(work, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body))
  }
  const fixtures = join(repo, 'test', 'fixtures')
  const input = (name, body) => writeFileSync(join(inputs, name), typeof body === 'string' ? body : JSON.stringify(body))

  put(`openspec/changes/${CHANGE}/proposal.md`, '# Add thing\n\n## Why\nBecause.\n')
  put(`openspec/changes/${CHANGE}/design.md`, '# Design\n\nD1: keep it small.\n')
  put(`openspec/changes/${CHANGE}/tasks.md`, TASKS_MD)
  put('README.md', 'hi\n')
  put('src/a.mjs', 'export const x = 1\n')
  const git = (...a) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...a], { cwd: work, stdio: 'ignore' })
  git('init', '-q', '.')
  git('config', 'user.email', 't@e.x')
  git('config', 'user.name', 't')
  git('add', '-A')
  git('commit', '-qm', 'init')
  put('src/a.mjs', 'export const x = 1\nexport const y = 2\n')
  git('commit', '-qam', 'second')

  input('blocker.json', [{ dimension: 'qa', findings: [{ severity: 'blocker', file: 'src/a.mjs', line: 1, title: 't', description: 'd', evidence: 'src/a.mjs:1' }] }])
  input('empty.json', [])
  input('review-ok.json', { ok: true })
  input('mr-review.json', {
    head: MR_HEAD,
    surviving: [{ severity: 'warning', dimension: 'qa', file: 'src/a.mjs', line: 2, title: 'y is unused', description: 'd', suggestion: 's' }],
    counts: { raised: 1, surviving: 1 }
  })
  input('batch.json', batchResults())
  input('lcov.info', 'TN:\nSF:src/a.mjs\nDA:1,1\nDA:2,0\nLF:2\nLH:1\nend_of_record\n')
  input('big.txt', 'x'.repeat(20000))
  input('res.json', { cases: [{ id: 'c1', runs: [{ graders: [{ name: 'g', type: 'deterministic', passed: true }] }] }] })

  // The committed halted run's trajectory, under a state home of its own.
  mkdirSync(join(state, '.claude', 'ship', 'runs'), { recursive: true })
  cpSync(join(fixtures, HALTED, 'trajectory.jsonl'), join(state, '.claude', 'ship', 'runs', `${RUN_ID}.jsonl`))

  let version = null
  try {
    version = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version
  } catch {
    version = null
  }
  return { work, inputs, state, fixtures, put, version }
}

const fill = (text, ctx) =>
  text
    .replaceAll('{in}', ctx.inputs)
    .replaceAll('{fx}', ctx.fixtures)
    .replaceAll('{state}', ctx.state)
    .replaceAll('{runId}', RUN_ID)

/** Run every entry; returns the rows and the failure count. */
export function runInventory(inventory, { binDir, repo, scratch }) {
  const rows = []
  let fails = 0
  const fail = text => {
    fails++
    rows.push(`FAIL  -     -  ${text}`)
  }

  let ctx
  try {
    ctx = prepare(scratch, repo)
  } catch (err) {
    // A scratch repository that could not be built is a failed smoke, said so,
    // not a crash with no rows.
    fail(`setup  <- could not build the scratch repository: ${err && err.message}`)
    ctx = { work: scratch, inputs: scratch, state: scratch, fixtures: join(repo, 'test', 'fixtures'), put: () => {}, version: null }
  }

  ctx.binPackage = packageOf(binDir)
  const env = { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH || ''}`, INTERLOCK_NTFY_TOPIC: '' }
  // The corpora land in the scratch repository and nowhere else, and the doctor
  // resolves the plugin from the binary under test, not from a session's.
  for (const name of ['INTERLOCK_STATE_HOME', 'INTERLOCK_NTFY_URL', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_ENV_FILE']) delete env[name]

  for (const entry of inventory) {
    const argv = entry.argv.map(a => fill(a, ctx))
    const shown = `${entry.bin} ${entry.argv.join(' ')}`
    const started = Date.now()
    let result
    let why = ''
    try {
      if (entry.setup) entry.setup(ctx)
      const input = typeof entry.input === 'function' ? entry.input(ctx) : entry.input
      result = spawnSync(join(binDir, entry.bin), argv, {
        cwd: ctx.work,
        encoding: 'utf8',
        env: { ...env, ...((typeof entry.env === 'function' ? entry.env(ctx) : entry.env) || {}) },
        input: input ?? '',
        timeout: 60_000
      })
      if (result.error) why = `could not run: ${result.error.code || result.error.message}`
      else if (!entry.codes.includes(result.status)) why = `exit ${result.status}, expected ${entry.codes.join(' or ')}`
    } catch (err) {
      why = `threw: ${err && err.message}`
    }
    if (!why && entry.keys && entry.keys.length) {
      let json = null
      try {
        json = JSON.parse(result.stdout)
      } catch {
        why = 'stdout is not JSON'
      }
      if (!why) {
        const missing = entry.keys.filter(k => k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), json) === undefined)
        if (missing.length) why = `missing ${missing.join(', ')}`
      }
    }
    if (!why && entry.check) {
      try {
        why = entry.check(result, ctx) || ''
      } catch (err) {
        why = `check threw: ${err && err.message}`
      }
    }
    if (why) fails++
    const status = result && result.status !== undefined ? String(result.status) : '-'
    rows.push(
      `${why ? 'FAIL' : 'PASS'} ${status.padStart(2)} ${String(Date.now() - started).padStart(5)}ms  ${shown.replaceAll(scratch, '$S').replaceAll(repo, '$R')}${why ? `  <- ${why}` : ''}`
    )
  }
  return { rows, fails }
}

function main() {
  const [binArg, repoArg, scratchArg] = process.argv.slice(2)
  if (!binArg || !repoArg || !scratchArg) {
    process.stderr.write('usage: node scripts/postinstall-smoke.mjs <binDir> <repoRoot> <scratchDir>\n')
    process.exit(1)
  }
  const binDir = resolve(binArg)
  const repo = resolve(repoArg)
  const scratch = resolve(scratchArg)
  mkdirSync(scratch, { recursive: true })
  const { rows, fails } = runInventory(INVENTORY, { binDir, repo, scratch })
  process.stdout.write(`${rows.join('\n')}\n`)
  process.stdout.write(`${INVENTORY.length} command(s), ${fails} failure(s)\n`)
  process.exit(fails ? 1 : 0)
}

/** The package root `binDir/interlock` belongs to: an npm prefix's bin/ holds a link into it. */
function packageOf(binDir) {
  try {
    return dirname(dirname(realpathSync(join(binDir, I))))
  } catch {
    return dirname(binDir)
  }
}

/** Run directly, under whatever path reached it: a symlinked path (macOS /tmp) must still run main. */
function invokedDirectly() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (invokedDirectly()) main()
