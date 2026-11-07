#!/usr/bin/env node
// Build what the plugin directory scans onto a local branch, so its Validate
// can run on a change before any release (npm run scan-pack).
//
// The directory scans the `release` branch: the unpacked npm tarball that
// `.github/workflows/plugin-bundle.yml` writes after a tagged release. Its
// findings are not in the local `claude` binary, so `npm run validate` cannot
// show them; the portal's Validate, run against a pushed branch, is the only
// oracle. 1.14.0 was released without that step, and the hold it was meant to
// clear was still there (remove-the-push-notification).
//
// What this does: `npm pack` of the working tree, unpacked, committed onto
// `temp/plugin-scan` (or `--branch <name>`) through a temporary index, so the
// working tree, the real index and the current branch are never touched. The
// commit's parent is the branch's current tip, or `origin/<branch>`'s, so a
// plain push fast-forwards; with neither it is a root commit.
//
// What it never does: push, or touch the network (`npm pack` runs with
// --offline --no-update-notifier, so npm's weekly version check stays off too). The push and the Validate
// are the owner's, and the script prints both steps.
//
// Exit codes: 0 the branch was written; 1 a step failed, named on stderr.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function usage() {
  return 'usage: node scripts/plugin-scan-pack.mjs [--branch <name>]\n'
}

function parseArgs(argv) {
  let branch = 'temp/plugin-scan'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--branch' && typeof argv[i + 1] === 'string' && argv[i + 1].trim()) branch = argv[++i].trim()
    else if (argv[i] === '--help' || argv[i] === '-h') {
      process.stdout.write(usage())
      process.exit(0)
    } else {
      process.stderr.write(`plugin-scan-pack: unknown argument ${argv[i]}\n${usage()}`)
      process.exit(1)
    }
  }
  return { branch }
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
}

/**
 * The one package entry in `npm pack --json` output. npm <= 11 prints an array
 * of entries; npm 12 prints an object keyed by package name. The release job
 * runs npm 12, so both shapes are read.
 */
function packEntry(report) {
  if (Array.isArray(report)) return report[0]
  if (report && typeof report === 'object') {
    if (typeof report.filename === 'string') return report
    const entries = Object.values(report).filter(v => v && typeof v === 'object' && typeof v.filename === 'string')
    return entries.length === 1 ? entries[0] : undefined
  }
  return undefined
}

/** The commit a fast-forwarding push would build on, or null for a root commit. */
function parentOf(branch) {
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    try {
      return run('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    } catch {
      // not there; try the next
    }
  }
  return null
}

function main() {
  const { branch } = parseArgs(process.argv.slice(2))
  try {
    run('git', ['check-ref-format', '--branch', branch])
  } catch {
    throw new Error(`"${branch}" is not a valid branch name`)
  }
  const current = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (current === branch) throw new Error(`refusing to write ${branch} while it is checked out`)

  const work = mkdtempSync(join(tmpdir(), 'interlock-scan-pack-'))
  try {
    const report = JSON.parse(run('npm', ['pack', '--json', '--offline', '--no-update-notifier', '--pack-destination', work]))
    const entry = packEntry(report)
    const file = entry && entry.filename
    if (!file) throw new Error(`npm pack reported no tarball (npm ${run('npm', ['--version'])}, --json gave ${JSON.stringify(report).slice(0, 200)})`)
    const unpacked = join(work, 'unpacked')
    mkdirSync(unpacked)
    run('tar', ['-xzf', join(work, file), '-C', unpacked])
    const bundle = join(unpacked, 'package')
    const version = JSON.parse(readFileSync(join(bundle, '.claude-plugin', 'plugin.json'), 'utf8')).version

    // A temporary index, so the real one and the working tree stay as they are.
    const env = { ...process.env, GIT_INDEX_FILE: join(work, 'index') }
    const gitDir = run('git', ['rev-parse', '--absolute-git-dir'])
    // autocrlf off, so the staged bytes are the tarball's bytes whatever the
    // operator's global git config says.
    run('git', ['-c', 'core.autocrlf=false', '--git-dir', gitDir, '--work-tree', bundle, 'add', '--all', '--force', '.'], { env, cwd: bundle })
    const tree = run('git', ['write-tree'], { env })

    const head = run('git', ['rev-parse', '--short', 'HEAD'])
    // npm pack packs the working tree, untracked files included, so a new file
    // under a `files` path counts as uncommitted. Paths that do not ship do not.
    const shipped = JSON.parse(readFileSync(join(bundle, 'package.json'), 'utf8')).files || []
    const dirty = run('git', ['status', '--porcelain', '--untracked-files=all', '--', 'package.json', ...shipped]) !== ''
    const message =
      'temp: unpublished plugin bundle for a directory scan\n\n' +
      `npm pack of ${head} on ${current}${dirty ? ' with uncommitted changes' : ''}, plugin version ${version}, ` +
      `${entry.entryCount} files. Built by scripts/plugin-scan-pack.mjs; never released.\n`
    const parent = parentOf(branch)
    const commit = run('git', ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-F', '-'], { input: message, stdio: ['pipe', 'pipe', 'pipe'] })
    run('git', ['update-ref', `refs/heads/${branch}`, commit])

    process.stdout.write(
      `scan pack: ${branch} at ${commit.slice(0, 7)} (${entry.entryCount} files, plugin ${version}, from ${head}${dirty ? ' + uncommitted changes' : ''})\n` +
        'next, by the owner:\n' +
        `  1. git push origin ${branch}${parent ? '' : '   (a root commit: add --force if the remote branch exists)'}\n` +
        `  2. claude.ai/directory/manage → the submission → Source → Validate against ${branch}\n` +
        '  3. point the tracked ref back at release when done\n'
    )
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

try {
  main()
} catch (err) {
  const detail = err && err.stderr ? String(err.stderr).trim() : ''
  process.stderr.write(`plugin-scan-pack: ${(err && err.message) || err}${detail ? `\n${detail}` : ''}\n`)
  process.exit(1)
}
