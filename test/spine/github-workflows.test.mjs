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
 * Tracked workflows, repo-relative. Outside a checkout, every file on disk: a
 * local, git-ignored workflow never runs on the remote and is not held here.
 */
function workflowFiles() {
  const listed = spawnSync('git', ['ls-files', '--', DIR], { cwd: ROOT, encoding: 'utf8' })
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
  assert.ok(workflows.length >= 6, `found only ${workflows.map(w => w.path).join(', ')}`)
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
