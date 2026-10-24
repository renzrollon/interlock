// What the repository's GitHub workflows may do with the token they are given.
//
// A workflow's privileges are invisible in a diff that does not touch its
// `permissions:` block, and its triggers are trusted by whoever reads the name
// on the Actions tab. So four properties are pinned here, over every tracked
// workflow rather than a list of them, so a new workflow is held to the same:
// a `workflow_run` follower acts only on a tag push in this repository, from
// its upstream's own file; a job holding a write permission installs nothing at
// a version chosen at run time; only the plugin bundle job can push; and every
// workflow states its token's scope.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DIR = '.github/workflows'

/**
 * Tracked workflows, repo-relative, plus any new one not yet added (so a
 * workflow is held to these rules before its first commit). Outside a checkout,
 * every file on disk: a local, git-ignored workflow never runs on the remote and
 * is not held here.
 */
function workflowFiles() {
  const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', DIR], { cwd: ROOT, encoding: 'utf8' })
  const names =
    listed.status === 0 && !listed.error
      ? listed.stdout.split('\n').filter(Boolean)
      : readdirSync(join(ROOT, DIR)).map(name => `${DIR}/${name}`)
  return names.filter(path => /\.ya?ml$/.test(path))
}

const workflows = workflowFiles().map(path => ({ path, text: readFileSync(join(ROOT, path), 'utf8') }))

/** The indented block under a `key:` line at `indent`, as text; null when absent. */
function block(lines, key, indent) {
  const at = lines.findIndex(l => l.startsWith(`${' '.repeat(indent)}${key}:`))
  if (at === -1) return null
  const out = [lines[at]]
  for (const line of lines.slice(at + 1)) {
    if (line.trim() && !line.startsWith(' '.repeat(indent + 1))) break
    out.push(line)
  }
  return out.join('\n')
}

/** Each job under `jobs:`, with its own lines. */
function jobs(text) {
  const lines = text.split('\n')
  const out = []
  for (const line of lines.slice(lines.findIndex(l => /^jobs:\s*$/.test(l)) + 1)) {
    if (/^[\w-]+:/.test(line)) break
    const header = /^ {2}([\w-]+):\s*$/.exec(line)
    if (header) out.push({ name: header[1], lines: [] })
    else out.at(-1)?.lines.push(line)
  }
  return out
}

const GRANTS_WRITE = /^\s*(?:[\w-]+:\s*write|permissions:\s*write-all)\s*$/m

test('every tracked workflow was found', () => {
  assert.ok(workflows.length >= 7, `found only ${workflows.map(w => w.path).join(', ')}`)
  assert.ok(workflows.every(w => jobs(w.text).length > 0), 'a workflow was read with no jobs')
})

test('a workflow_run follower acts only on a tag push in this repository, from its upstream file', () => {
  const followers = workflows.filter(w => /^\s+workflow_run:/m.test(w.text))
  assert.ok(followers.length >= 2, 'the Release followers (plugin bundle, pages) were not found')
  for (const { path, text } of followers) {
    const upstreams = (/^\s+workflows:\s*\[([^\]]*)\]/m.exec(text)?.[1] ?? '').split(',').map(s => s.trim()).filter(Boolean)
    assert.ok(upstreams.length, `${path} follows no named workflow`)
    for (const name of upstreams) {
      const upstream = workflows.find(w => new RegExp(`^name:\\s*['"]?${name}['"]?\\s*$`, 'm').test(w.text))
      assert.ok(upstream, `${path} follows "${name}", which no tracked workflow is named`)
      // `workflows:` matches on name alone, and a fork's pull request can add a
      // workflow with any name; its run would otherwise be followed here.
      for (const guard of [
        "github.event.workflow_run.event == 'push'",
        'github.event.workflow_run.head_repository.full_name == github.repository',
        `github.event.workflow_run.path == '${upstream.path}'`
      ]) {
        assert.ok(text.includes(guard), `${path} follows "${name}" without checking ${guard}`)
      }
    }
  }
})

test('no job holding a write permission installs a package at a floating version', () => {
  const EXACT = /^(?:@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+$/
  let privileged = 0
  for (const { path, text } of workflows) {
    const topLevel = block(text.split('\n'), 'permissions', 0)
    for (const job of jobs(text)) {
      const own = block(job.lines, 'permissions', 4)
      if (!GRANTS_WRITE.test(own ?? topLevel ?? '')) continue
      privileged++
      const body = job.lines.join('\n')
      for (const [command, args] of body.matchAll(/\bnpm\s+(?:install|i|add)\b([^\n#;&|]*)/g)) {
        for (const spec of args.trim().split(/\s+/).filter(a => a && !a.startsWith('-'))) {
          assert.match(spec, EXACT, `${path} job ${job.name} can write and runs \`${command.trim()}\`: pin ${spec} to an exact version`)
        }
      }
      assert.doesNotMatch(body, /\bnpx\s/, `${path} job ${job.name} can write and runs npx, which installs at run time`)
    }
  }
  assert.ok(privileged >= 3, `only ${privileged} write-scoped jobs were found; the release, bundle and pages jobs all hold one`)
})

test('only the plugin bundle job can push to the repository', () => {
  // The `release` ruleset forbids force-push and deletion but not an ordinary
  // push: on a repository a person owns, GitHub refuses the Actions app as a
  // bypass actor, so restricting updates would lock out the bundle job too.
  // What that leaves is who holds `contents: write`, and that is pinned here.
  const ALLOWED = ['.github/workflows/plugin-bundle.yml bundle']
  const writers = []
  for (const { path, text } of workflows) {
    const topLevel = block(text.split('\n'), 'permissions', 0)
    for (const job of jobs(text)) {
      const scope = block(job.lines, 'permissions', 4) ?? topLevel ?? ''
      if (/^\s*contents:\s*write\s*$/m.test(scope) || /permissions:\s*write-all/.test(scope)) writers.push(`${path} ${job.name}`)
    }
  }
  assert.deepEqual(
    writers,
    ALLOWED,
    'a job other than the plugin bundle can push, and every branch but main and release takes an ordinary push from it'
  )
})

test('every workflow states its token scope rather than inheriting the repository default', () => {
  for (const { path, text } of workflows) {
    if (block(text.split('\n'), 'permissions', 0)) continue
    const unscoped = jobs(text).filter(job => !block(job.lines, 'permissions', 4)).map(job => job.name)
    assert.deepEqual(unscoped, [], `${path} has no top-level permissions, and these jobs declare none: ${unscoped.join(', ')}`)
  }
})

// --- what continuous integration and the canary prove about what ships -------
//
// spec: distribution/release-gates. These pin the shape of the jobs, because a
// job that is renamed, narrowed or deleted leaves no failing check anywhere.

const stripComments = text => text.replace(/^\s*#.*$/gm, '').replace(/\s+#\s.*$/gm, '')
const workflowNamed = file => {
  const found = workflows.find(w => w.path === `${DIR}/${file}`)
  assert.ok(found, `${DIR}/${file} is not tracked`)
  return { ...found, code: stripComments(found.text) }
}
const jobNamed = (workflow, name) => {
  const job = jobs(workflow.code).find(j => j.name === name)
  assert.ok(job, `${workflow.path} has no ${name} job`)
  return job.lines.join('\n')
}

test('the canary is scheduled, read-only, and runs validate, plugin test, doctor and the smoke', () => {
  const canary = workflowNamed('canary.yml')
  const lines = canary.code.split('\n')
  const triggers = block(lines, 'on', 0)
  assert.ok(triggers, 'canary.yml has no on: block')
  assert.match(triggers, /^\s+schedule:/m, 'the canary must run on a schedule')
  assert.match(triggers, /^\s+- cron: /m, 'the canary schedule has no cron entry')
  assert.match(triggers, /^\s+workflow_dispatch:/m, 'the canary must be manually invocable')
  assert.doesNotMatch(triggers, /^\s+(?:push|pull_request|workflow_run):/m, 'the canary runs on the calendar and nothing else')
  // Its failure IS the notification, so it needs no write token to open an
  // issue; the only write-capable job is the plugin bundle (test above).
  const scope = block(lines, 'permissions', 0)
  assert.ok(scope, 'the canary must state its token scope at the top level')
  assert.match(scope, /^\s+contents:\s*read\s*$/m, 'the canary token is contents: read')
  assert.doesNotMatch(canary.code, GRANTS_WRITE, 'the canary holds a write permission')
  assert.ok(jobs(canary.code).every(job => !block(job.lines, 'permissions', 4)), 'a canary job widens the top-level token scope')
  for (const [what, pattern] of [
    ['install the newest Claude Code', /npm install -g @anthropic-ai\/claude-code\s*$/m],
    ['read the release branch', /ref:\s*release\b/],
    ['validate strictly', /claude plugin validate \S+ --strict/],
    ['run the module tests', /claude plugin test\b/],
    ['run the doctor', /interlock doctor --json/],
    ['run the smoke inventory', /scripts\/postinstall-smoke\.mjs/]
  ]) {
    assert.match(canary.code, pattern, `the canary no longer does this: ${what}`)
  }
  assert.match(canary.code, /^\s+timeout-minutes:\s*\d+\s*$/m, 'the canary job has no timeout')
})

test('the canary checks the bundle with the tests and smoke of the tag it was cut from, not main', () => {
  // main's inventory and module tests describe commands the shipped release
  // does not have yet: run against it, they fail by construction, and a real
  // engine break would read exactly the same.
  const canary = workflowNamed('canary.yml')
  assert.match(canary.code, /ref:\s*v\$\{\{\s*steps\.bundle\.outputs\.version\s*\}\}/, 'the canary must check out the tag matching the bundle')
  const checkouts = [...canary.code.matchAll(/uses:\s*actions\/checkout@\S+((?:\n\s+(?:with:|ref:|path:)[^\n]*)*)/g)]
  assert.ok(
    checkouts.every(([, opts]) => /\bref:/.test(opts)),
    'the canary checks out main (a checkout with no ref); its checks must come from the tag'
  )
  assert.match(canary.code, /cp -R tagged\/test\/mod /, "the module tests must be the tag's")
  assert.match(canary.code, /node tagged\/scripts\/postinstall-smoke\.mjs \S+ tagged /, "the smoke must be the tag's, against the tag's tree")
  // A check the bundle predates is skipped out loud, in the run summary.
  const spoken = canary.code.match(/if \[ "\$PREDATES" = true \]; then\n[^\n]*skipped[^\n]*GITHUB_STEP_SUMMARY/g) || []
  assert.equal(spoken.length, 2, 'the doctor and the smoke must each say in the summary when the bundle predates them')
})

test('ci.yml runs Node 24, the smoke on macOS, and the postinstall smoke from the packed tarball', () => {
  const ci = workflowNamed('ci.yml')
  const matrix = jobNamed(ci, 'test')
  assert.match(matrix, /node:\s*\[[^\]]*'24'[^\]]*\]/, "the test matrix must include Node '24'")
  for (const major of ['18', '20', '22']) assert.ok(matrix.includes(`'${major}'`), `the test matrix dropped Node ${major}`)
  const smoke = jobNamed(ci, 'cli-smoke')
  assert.match(smoke, /os:\s*\[[^\]]*macos-latest[^\]]*\]/, 'the cli-smoke job must run on macOS')
  assert.match(smoke, /os:\s*\[[^\]]*ubuntu-latest[^\]]*\]/, 'the cli-smoke job must keep running on Linux')
  assert.match(smoke, /runs-on:\s*\$\{\{\s*matrix\.os\s*\}\}/, 'the cli-smoke job must run on the matrix os')
  assert.match(smoke, /npm pack /, 'the cli-smoke job must install the packed tarball')
  assert.match(
    smoke,
    /node scripts\/postinstall-smoke\.mjs "\$RUNNER_TEMP\/prefix\/bin" \. "\$RUNNER_TEMP\/smoke"/,
    'the cli-smoke job must run the post-install smoke from the installed prefix'
  )
})

test('ci.yml validates the plugin under the oldest engine, read from code and spelled nowhere', () => {
  const ci = workflowNamed('ci.yml')
  const job = jobNamed(ci, 'validate-plugin')
  assert.match(job, /engine:\s*\[latest, floor\]/, 'validate-plugin must be a latest/floor matrix')
  assert.match(job, /MODS_MIN_HOST_VERSION/, 'the floor leg must read the constant')
  assert.match(job, /lib\/host\/claude-env\.mjs/, 'the floor leg must read the constant from the module that declares it')
  // The floor follows the constant: any version written into this job is a
  // second copy that would go stale the day the constant is raised.
  assert.doesNotMatch(job, /\d+\.\d+\.\d+/, 'validate-plugin spells a version; the floor is read from MODS_MIN_HOST_VERSION')
  assert.doesNotMatch(job, /claude-code@\d/, 'validate-plugin pins an engine version instead of reading the floor')
  assert.match(job, /claude plugin validate \. --strict/)
  assert.match(job, /claude plugin test \./)
  assert.match(
    job,
    /plugin test is not available at the floor engine/,
    'a floor engine without plugin test must be said in the step summary, not passed silently'
  )
})

test('ci.yml installs the release over the previous one and smokes it', () => {
  const ci = workflowNamed('ci.yml')
  const job = jobNamed(ci, 'upgrade-install')
  const order = [
    'npm view @renzrollon/interlock version',
    '@renzrollon/interlock@$prev',
    'npm pack ',
    'scripts/postinstall-smoke.mjs',
    'interlock doctor --json',
    'INTERLOCK_HARNESS_BIN'
  ].map(token => ({ token, at: job.indexOf(token) }))
  for (const { token, at } of order) assert.ok(at !== -1, `upgrade-install no longer contains ${JSON.stringify(token)}`)
  assert.deepEqual(
    order.map(o => o.at),
    order.map(o => o.at).sort((a, b) => a - b),
    'upgrade-install must resolve and install the previous release, pack and install over it, smoke, then run the skew harness'
  )
  assert.doesNotMatch(job, GRANTS_WRITE, 'upgrade-install holds a write permission')
})

test('the skew step runs the harness case by its exact title and fails when that case did not pass', () => {
  // A name pattern that matches nothing exits 0, so a renamed case would leave
  // the step running nothing and passing.
  const ci = workflowNamed('ci.yml')
  const job = jobNamed(ci, 'upgrade-install')
  const title = /^\s+SKEW_CASE:\s*(.+?)\s*$/m.exec(job)?.[1]
  assert.ok(title, 'upgrade-install no longer names the skew case it runs')
  const cases = readFileSync(join(ROOT, 'test', 'workflows.test.mjs'), 'utf8')
  assert.ok(cases.includes(`'${title}'`), `test/workflows.test.mjs has no case titled ${JSON.stringify(title)}`)
  assert.match(job, /--test-name-pattern "\$SKEW_CASE"/, 'the step must select the case by that title')
  assert.match(job, /grep -Fxq "\$SKEW_CASE"/, "the step must require the case's own ok line")
})

// The `main: required CI` ruleset (25566171) lives on GitHub, not in this
// repository, and requires these check names. A matrix leg reports as
// `job (value)`, so a required bare name that no job reports blocks every merge
// with every check green. Mirrors the live list; a change to the ruleset is a
// change here. `test (24)` and `upgrade-install` run on every pull request but
// are advisory: a red one does not block a merge until the ruleset requires it.
const REQUIRED_CHECKS = ['test (18)', 'test (20)', 'test (22)', 'validate-plugin', 'cli-smoke', 'Outcome eval prepare (model-free)']

/** The check names one job reports: its `name:` (or id), once per leg of a one-key matrix. */
function reportedChecks(job) {
  const raw = /^ {4}name:\s*(.+?)\s*$/m.exec(job.lines.join('\n'))?.[1]
  const name = raw ? raw.replace(/^(['"])(.*)\1$/, '$2') : job.name
  const matrix = block(job.lines, 'matrix', 6)
  if (!matrix) return [name]
  const keys = matrix.split('\n').slice(1).map(l => /^ {8}([\w-]+):\s*\[([^\]]*)\]/.exec(l)).filter(Boolean)
  assert.equal(keys.length, 1, `${job.name}: only a one-key matrix is rendered here`)
  const [, key, list] = keys[0]
  const values = list.split(',').map(v => v.trim().replace(/^(['"])(.*)\1$/, '$2'))
  const expr = new RegExp(`\\$\\{\\{\\s*matrix\\.${key}\\s*\\}\\}`, 'g')
  return values.map(v => (expr.test(name) ? name.replace(expr, v) : `${name} (${v})`))
}

test('every check the main ruleset requires is reported by exactly one ci.yml job', () => {
  // A name two jobs report is a required check one of them can satisfy while
  // the other fails.
  const ci = workflowNamed('ci.yml')
  const reported = jobs(ci.code).flatMap(reportedChecks)
  for (const check of REQUIRED_CHECKS) {
    assert.equal(
      reported.filter(r => r === check).length,
      1,
      `the required check "${check}" must be reported by exactly one ci.yml job; reported: ${reported.join(', ')}`
    )
  }
})

test('a gate that reports a matrix under its bare name runs always and passes only when every leg passed', () => {
  // A skipped required check reads as passing, so a gate that skipped when a leg
  // failed would wave the failure through.
  const ci = workflowNamed('ci.yml')
  for (const [check, matrixJob] of [['validate-plugin', 'validate-plugin'], ['cli-smoke', 'cli-smoke']]) {
    const gate = jobs(ci.code).find(job => reportedChecks(job).length === 1 && reportedChecks(job)[0] === check)
    assert.ok(gate, `no job reports ${check}`)
    const body = gate.lines.join('\n')
    assert.match(body, new RegExp(`^ {4}needs:\\s*\\[?\\s*${matrixJob}\\s*\\]?\\s*$`, 'm'), `${gate.name} must wait on ${matrixJob}`)
    assert.match(body, /^ {4}if:\s*\$\{\{\s*always\(\)\s*\}\}\s*$/m, `${gate.name} must run even when a leg failed`)
    assert.match(body, new RegExp(`test "\\$\\{\\{ needs\\.${matrixJob}\\.result \\}\\}" = success`), `${gate.name} must pass only on success`)
  }
})
