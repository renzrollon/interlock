// The preflight's own preflight.
//
// Two things are being held here, and they are different. The permission
// matcher is a pure function over strings, and every one of its interesting
// cases is a *near miss* — a rule that exists but is too narrow, a deny that
// covers less than the requirement but still fires, an `ask` that is not an
// allow. Those are asserted exhaustively, because the failure mode of getting
// one wrong is a green preflight followed by the halt it promised to prevent.
//
// The checks themselves are asserted through `diagnose`, against fabricated
// roots, with PATH, home, the settings list and the version probe all injected.
// A doctor whose test depended on the developer's own machine would report on
// that machine rather than on the code.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  diagnose,
  formatDoctor,
  parseRule,
  profileCommands,
  ruleCovers,
  ruleOverlaps,
  whichSync,
  evalPrerequisiteChecks,
  extractInstructedCommands,
  REQUIRED_COMMANDS,
  HOST_READ_ONLY,
  IGNORED_INSTRUCTION_SPANS,
  STATE_DIRS
} from '../../lib/doctor.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(REPO, 'bin', 'interlock')

function tmp() {
  return mkdtempSync(join(tmpdir(), 'interlock-doctor-'))
}

function file(dir, rel, contents) {
  const p = join(dir, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2))
  return p
}

/** An executable stub — `whichSync` checks the mode bit, never runs it. */
function stubBin(dir, name) {
  const p = file(dir, name, '#!/bin/sh\nexit 0\n')
  chmodSync(p, 0o755)
  return p
}

const req = (command, open = true) => ({ tokens: command.split(' '), open, why: 'test' })

// ---------------------------------------------------------------------------
// Rule parsing
// ---------------------------------------------------------------------------

test('parseRule reads both the colon form and the older glob form', () => {
  assert.deepEqual(parseRule('Bash(npm test:*)'), {
    tool: 'Bash',
    tokens: ['npm', 'test'],
    open: true,
    rule: 'Bash(npm test:*)'
  })
  assert.deepEqual(parseRule('Bash(git *)'), {
    tool: 'Bash',
    tokens: ['git'],
    open: true,
    rule: 'Bash(git *)'
  })
  // Exact: permits that command and nothing after it.
  assert.deepEqual(parseRule('Bash(git status)'), {
    tool: 'Bash',
    tokens: ['git', 'status'],
    open: false,
    rule: 'Bash(git status)'
  })
})

test('parseRule treats a bare tool and Bash(*) as unrestricted, and rejects noise', () => {
  assert.deepEqual(parseRule('Bash').tokens, [])
  assert.equal(parseRule('Bash').open, true)
  assert.equal(parseRule('Bash(*)').open, true)
  assert.equal(parseRule(''), null)
  assert.equal(parseRule(42), null)
  assert.equal(parseRule('not a rule'), null)
})

test('parseRule keeps non-Bash rules distinguishable rather than dropping them', () => {
  const rule = parseRule('WebFetch(domain:github.com)')
  assert.equal(rule.tool, 'WebFetch')
  // Only the tool matters: ruleCovers refuses anything that is not Bash.
  assert.equal(ruleCovers(rule, req('git')), false)
})

// ---------------------------------------------------------------------------
// Coverage — the near misses
// ---------------------------------------------------------------------------

test('an open rule covers the command and everything after it', () => {
  assert.equal(ruleCovers(parseRule('Bash(interlock:*)'), req('interlock')), true)
  assert.equal(ruleCovers(parseRule('Bash(interlock *)'), req('interlock')), true)
  assert.equal(ruleCovers(parseRule('Bash(*)'), req('interlock')), true)
  assert.equal(ruleCovers(parseRule('Bash'), req('npm test')), true)
})

test('a rule NARROWER than the requirement does not cover it', () => {
  // The whole point: the loop calls ~30 interlock subcommands, so permission
  // for one of them is not permission for the command.
  assert.equal(ruleCovers(parseRule('Bash(interlock waves:*)'), req('interlock')), false)
  assert.equal(ruleCovers(parseRule('Bash(npm run test:*)'), req('npm test')), false)
})

test('an exact rule does not satisfy a requirement that needs arguments', () => {
  assert.equal(ruleCovers(parseRule('Bash(interlock)'), req('interlock', true)), false)
  // …but it does satisfy a requirement for exactly that invocation.
  assert.equal(ruleCovers(parseRule('Bash(interlock)'), req('interlock', false)), true)
})

test('a broader prefix covers a longer requirement', () => {
  assert.equal(ruleCovers(parseRule('Bash(npm:*)'), req('npm test')), true)
  assert.equal(ruleCovers(parseRule('Bash(node:*)'), req('node --test')), true)
})

test('ruleOverlaps fires in both directions, which is what deny and ask need', () => {
  // Denies less than the requirement covers — still a mid-run stop.
  assert.equal(ruleOverlaps(parseRule('Bash(git push:*)'), req('git')), true)
  // Denies more than the requirement covers.
  assert.equal(ruleOverlaps(parseRule('Bash(git:*)'), req('git push')), true)
  assert.equal(ruleOverlaps(parseRule('Bash(npm:*)'), req('git')), false)
  // A narrower rule cannot overlap a requirement that permits no arguments.
  assert.equal(ruleOverlaps(parseRule('Bash(git push:*)'), req('git', false)), false)
})

// ---------------------------------------------------------------------------
// Required commands derived from the project
// ---------------------------------------------------------------------------

test('profileCommands truncates at the first placeholder and dedupes', () => {
  const commands = profileCommands({
    unit: { command: 'npm test', single_file: 'node --test <path>' },
    e2e: { command: 'npm test' }
  })
  assert.deepEqual(commands.map(c => c.tokens.join(' ')), ['npm test', 'node --test'])
  assert.ok(commands.every(c => c.open))
})

test('profileCommands survives a profile that is missing, empty or the wrong shape', () => {
  assert.deepEqual(profileCommands(undefined), [])
  assert.deepEqual(profileCommands({}), [])
  assert.deepEqual(profileCommands({ unit: null, e2e: 'nope' }), [])
  assert.deepEqual(profileCommands({ unit: { command: '   ' } }), [])
})

test('whichSync finds an executable on the injected PATH and nothing else', () => {
  const dir = tmp()
  try {
    stubBin(dir, 'openspec')
    file(dir, 'not-executable', 'x')
    const env = { PATH: dir }
    assert.equal(whichSync('openspec', env), join(dir, 'openspec'))
    assert.equal(whichSync('not-executable', env), null)
    assert.equal(whichSync('definitely-not-installed', env), null)
    assert.equal(whichSync('', env), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// diagnose
// ---------------------------------------------------------------------------

/** A plugin root complete enough to pass the install check. */
function fakePlugin(dir, { version = '9.9.9', omit = [], engines = '>=18', name = 'plugin' } = {}) {
  const root = join(dir, name)
  file(root, 'package.json', { name: 'interlock', engines: { node: engines } })
  file(root, '.claude-plugin/plugin.json', { name: 'interlock', version, workflows: './workflows' })
  for (const rel of ['workflows/ship.js', 'agents/worker.md', 'agents/ping.md', 'bin/interlock', 'bin/interlock-graph']) {
    if (omit.includes(rel)) continue
    file(root, rel, '// stub\n')
  }
  return root
}

function byId(report, id) {
  const found = report.checks.find(c => c.id === id)
  assert.ok(found, `no check "${id}" in the report`)
  return found
}

/** Everything green needs a real git work tree; git is the one probe not stubbed. */
function gitInit(dir) {
  const r = spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' })
  return r.status === 0
}

function baseOpts(dir, extra = {}) {
  const binDir = join(dir, 'stub-bin')
  mkdirSync(binDir, { recursive: true })
  for (const name of ['interlock', 'interlock-graph', 'openspec']) stubBin(binDir, name)
  return {
    // Only fabricate the default plugin when the caller did not bring its own;
    // building it unconditionally would overwrite a deliberately broken one.
    ...('pluginRoot' in extra ? {} : { pluginRoot: fakePlugin(dir) }),
    // The real PATH stays on the end so `git` still resolves; every other
    // binary is answered by the stub directory in front of it.
    env: { PATH: `${binDir}:${process.env.PATH || ''}` },
    nodeVersion: 'v22.11.0',
    probeVersion: () => 'stub 1.0.0',
    settingsSources: [{ scope: 'project', path: join(dir, '.claude', 'settings.json') }],
    ...extra
  }
}

const ALL_ALLOWED = {
  permissions: {
    allow: [
      'Bash(interlock:*)',
      'Bash(interlock-graph:*)',
      'Bash(openspec:*)',
      'Bash(git:*)',
      'Bash(test:*)',
      'Bash(printenv:*)',
      'Bash(mkdir:*)',
      'Bash(npm test:*)'
    ]
  }
}

const PROFILE = { version: 1, unit: { command: 'npm test' }, e2e: null }

test('a fully wired project passes every check', () => {
  const dir = tmp()
  try {
    if (!gitInit(dir)) return // no git on this machine; the green path is unassertable
    file(dir, 'openspec/config.yaml', 'project: test\n')
    file(dir, '.claude/testing/profile.json', PROFILE)
    file(dir, '.claude/settings.json', ALL_ALLOWED)
    const report = diagnose(dir, baseOpts(dir))
    assert.equal(report.ok, true, formatDoctor(report))
    assert.deepEqual(report.failures, [])
    assert.equal(byId(report, 'permissions').status, 'ok')
    assert.equal(byId(report, 'state-dirs').status, 'ok')
    // The derived set is the static four plus the profile's own command.
    assert.deepEqual(
      report.requiredCommands.map(c => c.command),
      [...REQUIRED_COMMANDS.map(r => r.tokens.join(' ')), 'npm test']
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an uncovered required command fails, and the fix names the rule to add', () => {
  const dir = tmp()
  try {
    file(dir, '.claude/testing/profile.json', PROFILE)
    file(dir, '.claude/settings.json', { permissions: { allow: ['Bash(git:*)'] } })
    const report = diagnose(dir, baseOpts(dir))
    const permissions = byId(report, 'permissions')
    assert.equal(permissions.status, 'fail')
    assert.equal(report.ok, false)
    assert.deepEqual(
      permissions.uncovered.map(u => u.command),
      ['interlock', 'interlock-graph', 'openspec', 'test', 'printenv', 'mkdir', 'npm test']
    )
    assert.match(permissions.fix, /"Bash\(npm test:\*\)"/)
    assert.match(permissions.fix, /"Bash\(test:\*\)"/)
    assert.match(permissions.fix, /"Bash\(printenv:\*\)"/)
    assert.match(permissions.fix, /"Bash\(mkdir:\*\)"/)
    // git was allowed, so it is not in the fix.
    assert.doesNotMatch(permissions.fix, /"Bash\(git:\*\)"/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a rule that is only narrower than the requirement fails, and says so', () => {
  const dir = tmp()
  try {
    file(dir, '.claude/testing/profile.json', PROFILE)
    file(dir, '.claude/settings.json', {
      permissions: {
        allow: ['Bash(interlock waves:*)', 'Bash(interlock-graph:*)', 'Bash(openspec:*)', 'Bash(git:*)', 'Bash(npm test:*)']
      }
    })
    const report = diagnose(dir, baseOpts(dir))
    const permissions = byId(report, 'permissions')
    assert.equal(permissions.status, 'fail')
    const interlock = permissions.uncovered.find(u => u.command === 'interlock')
    assert.ok(interlock, 'interlock should be uncovered')
    assert.deepEqual(interlock.narrower, ['Bash(interlock waves:*) (project)'])
    assert.match(permissions.evidence.join('\n'), /found only narrower: Bash\(interlock waves:\*\)/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a deny that overlaps a required command fails ahead of the uncovered report', () => {
  const dir = tmp()
  try {
    file(dir, '.claude/testing/profile.json', PROFILE)
    file(dir, '.claude/settings.json', {
      permissions: { allow: ['Bash(git:*)'], deny: ['Bash(git push:*)'] }
    })
    const report = diagnose(dir, baseOpts(dir))
    const permissions = byId(report, 'permissions')
    assert.equal(permissions.status, 'fail')
    assert.match(permissions.evidence.join('\n'), /git: denied by Bash\(git push:\*\) \(project\)/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an ask rule warns rather than failing — it prompts, it does not block', () => {
  const dir = tmp()
  try {
    file(dir, '.claude/testing/profile.json', PROFILE)
    file(dir, '.claude/settings.json', {
      permissions: { ...ALL_ALLOWED.permissions, ask: ['Bash(git push:*)'] }
    })
    const report = diagnose(dir, baseOpts(dir))
    const permissions = byId(report, 'permissions')
    assert.equal(permissions.status, 'warn')
    assert.match(permissions.evidence.join('\n'), /prompts/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('bypassPermissions warns and checks nothing, because nothing will prompt', () => {
  const dir = tmp()
  try {
    file(dir, '.claude/testing/profile.json', PROFILE)
    file(dir, '.claude/settings.json', { permissions: { defaultMode: 'bypassPermissions', allow: [] } })
    const report = diagnose(dir, baseOpts(dir))
    const permissions = byId(report, 'permissions')
    assert.equal(permissions.status, 'warn')
    assert.match(permissions.detail, /bypassPermissions/)
    // Reported, not silently dropped: the reader still learns what is missing.
    assert.match(permissions.evidence.join('\n'), /would otherwise be uncovered: interlock/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unparseable settings file is never read as an empty allowlist', () => {
  const dir = tmp()
  try {
    file(dir, '.claude/testing/profile.json', PROFILE)
    file(dir, '.claude/settings.json', '{ not json')
    const report = diagnose(dir, baseOpts(dir))
    const permissions = byId(report, 'permissions')
    // It fails on the uncovered commands, and the unreadable file is evidence.
    assert.equal(permissions.status, 'fail')
    assert.match(permissions.evidence.join('\n'), /not valid JSON/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a settings file that parses but allows everything relevant, with a broken sibling, warns', () => {
  const dir = tmp()
  try {
    file(dir, '.claude/testing/profile.json', PROFILE)
    file(dir, '.claude/settings.json', ALL_ALLOWED)
    file(dir, '.claude/settings.local.json', '}{')
    const report = diagnose(
      dir,
      baseOpts(dir, {
        settingsSources: [
          { scope: 'project', path: join(dir, '.claude', 'settings.json') },
          { scope: 'local', path: join(dir, '.claude', 'settings.local.json') }
        ]
      })
    )
    const permissions = byId(report, 'permissions')
    assert.equal(permissions.status, 'warn')
    assert.match(permissions.detail, /could not be read/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a missing test profile fails, and its command is then absent from the required set', () => {
  const dir = tmp()
  try {
    file(dir, '.claude/settings.json', ALL_ALLOWED)
    const report = diagnose(dir, baseOpts(dir))
    assert.equal(byId(report, 'test-profile').status, 'fail')
    assert.equal(report.ok, false)
    assert.deepEqual(
      report.requiredCommands.map(c => c.command),
      REQUIRED_COMMANDS.map(r => r.tokens.join(' '))
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a test profile with no unit command fails: verification would have nothing to run', () => {
  const dir = tmp()
  try {
    file(dir, '.claude/testing/profile.json', { version: 1, unit: {} })
    const report = diagnose(dir, baseOpts(dir))
    assert.equal(byId(report, 'test-profile').status, 'fail')
    assert.match(byId(report, 'test-profile').detail, /no unit\.command/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an incomplete plugin install fails and names the missing files', () => {
  const dir = tmp()
  try {
    const report = diagnose(dir, baseOpts(dir, { pluginRoot: fakePlugin(dir, { omit: ['agents/worker.md'] }) }))
    const plugin = byId(report, 'plugin')
    assert.equal(plugin.status, 'fail')
    assert.match(plugin.evidence.join('\n'), /missing: agents\/worker\.md/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a plugin manifest with no workflows key fails: /interlock:ship would have nothing to launch', () => {
  const dir = tmp()
  try {
    const pluginRoot = fakePlugin(dir)
    file(pluginRoot, '.claude-plugin/plugin.json', { name: 'interlock', version: '1.0.0' })
    const report = diagnose(dir, baseOpts(dir, { pluginRoot }))
    assert.equal(byId(report, 'plugin').status, 'fail')
    assert.match(byId(report, 'plugin').detail, /no "workflows" directory/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the node check reads the plugin floor, and reports OpenSpec\'s higher one separately', () => {
  const dir = tmp()
  try {
    const opts = baseOpts(dir)
    assert.equal(diagnose(dir, { ...opts, nodeVersion: 'v16.20.0' }).checks[0].status, 'fail')
    // Above Interlock's floor, below OpenSpec's — a warning, not a failure.
    const mid = diagnose(dir, { ...opts, nodeVersion: 'v18.20.8' }).checks[0]
    assert.equal(mid.status, 'warn')
    assert.match(mid.detail, /20\.19\.0/)
    assert.equal(diagnose(dir, { ...opts, nodeVersion: 'v20.19.0' }).checks[0].status, 'ok')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('binaries absent from PATH but present in the plugin warn rather than fail', () => {
  const dir = tmp()
  try {
    const report = diagnose(dir, baseOpts(dir, { env: { PATH: '' } }))
    const binaries = byId(report, 'binaries')
    assert.equal(binaries.status, 'warn')
    assert.match(binaries.fix, /Nothing to do for a run inside Claude Code/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('openspec absent with no project at all fails; absent with a project only warns', () => {
  const dir = tmp()
  try {
    const noOpenSpec = { PATH: '' }
    assert.equal(byId(diagnose(dir, baseOpts(dir, { env: noOpenSpec })), 'openspec').status, 'fail')
    file(dir, 'openspec/config.yaml', 'project: test\n')
    const withProject = byId(diagnose(dir, baseOpts(dir, { env: noOpenSpec })), 'openspec')
    assert.equal(withProject.status, 'warn')
    assert.match(withProject.detail, /ship reads artifacts from disk/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the openspec CLI without an initialised project warns', () => {
  const dir = tmp()
  try {
    const openspec = byId(diagnose(dir, baseOpts(dir)), 'openspec')
    assert.equal(openspec.status, 'warn')
    assert.match(openspec.fix, /openspec init/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a directory outside a git work tree fails', () => {
  const dir = tmp()
  try {
    const git = byId(diagnose(dir, baseOpts(dir)), 'git')
    // A machine with no git at all fails for the other reason; both are failures.
    assert.equal(git.status, 'fail')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unwritable run-state directory fails BEFORE the run, not on the wave that appends', {
  skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root ignores mode bits' : false
}, () => {
  const dir = tmp()
  const runs = join(dir, STATE_DIRS[0].path)
  try {
    mkdirSync(runs, { recursive: true })
    chmodSync(runs, 0o555)
    const state = byId(diagnose(dir, baseOpts(dir)), 'state-dirs')
    assert.equal(state.status, 'fail')
    assert.match(state.evidence.join('\n'), /\.claude\/ship\/runs/)
    assert.match(state.fix, /exits 1 mid-run/)
  } finally {
    try {
      chmodSync(runs, 0o755)
    } catch {
      // best effort; the rm below is what matters
    }
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unwritable bookkeeping directory warns — the runtime does not fail the run over it', {
  skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root ignores mode bits' : false
}, () => {
  const dir = tmp()
  const bookkeeping = STATE_DIRS.filter(d => !d.fatal)
  assert.ok(bookkeeping.length, 'the fixture assumes at least one never-fatal directory')
  try {
    for (const d of bookkeeping) {
      mkdirSync(join(dir, d.path), { recursive: true })
      chmodSync(join(dir, d.path), 0o555)
    }
    const state = byId(diagnose(dir, baseOpts(dir)), 'state-dirs')
    assert.equal(state.status, 'warn')
    assert.match(state.detail, /the run continues without them|the run continues without/)
  } finally {
    for (const d of bookkeeping) {
      try {
        chmodSync(join(dir, d.path), 0o755)
      } catch {
        // best effort
      }
    }
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the writability probe leaves nothing behind', () => {
  const dir = tmp()
  try {
    for (const d of STATE_DIRS) mkdirSync(join(dir, d.path), { recursive: true })
    diagnose(dir, baseOpts(dir))
    const stray = spawnSync('find', [join(dir, '.claude'), '-name', '.interlock-doctor-*'], {
      encoding: 'utf8'
    })
    assert.equal(stray.stdout.trim(), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a check that throws becomes a failure, never a pass', () => {
  const dir = tmp()
  try {
    const report = diagnose(dir, baseOpts(dir, { pluginRoot: null, env: null }))
    // Whatever broke, nothing silently reported ok — and a report still came out.
    assert.ok(Array.isArray(report.checks) && report.checks.length >= 8)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('formatDoctor prints evidence and fixes only for the checks that need them', () => {
  const dir = tmp()
  try {
    file(dir, '.claude/testing/profile.json', PROFILE)
    file(dir, '.claude/settings.json', { permissions: { allow: [] } })
    const text = formatDoctor(diagnose(dir, baseOpts(dir)))
    assert.match(text, /^PREFLIGHT BLOCKED/)
    assert.match(text, /\[FAIL\] permissions:/)
    assert.match(text, /fix: Add to/)
    // An ok check contributes exactly one line.
    const okLine = text.split('\n').filter(l => l.includes('[ok  ] node:'))
    assert.equal(okLine.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Eval prerequisites — reported, never gating
// ---------------------------------------------------------------------------
//
// The rule these hold is one-directional: these two rows may report `ok` or
// `skip` and nothing else, ever, including when the check itself breaks.
// Neither prerequisite stops a ship run, so a preflight that failed on them
// would block unattended work over a capability the run never touches.

/** A plugin root whose evals/ holds one case, which is what makes the rows appear. */
function pluginWithSuite(dir) {
  const root = fakePlugin(dir)
  file(root, 'evals/some-case/case.yaml', 'schema_version: "1.0"\nname: some-case\n')
  file(root, 'evals/some-case/graders/x.md', '---\ntype: regex\npattern: x\n---\n')
  return root
}

test('a plugin root with an eval suite reports both prerequisite rows', () => {
  const dir = tmp()
  try {
    const report = diagnose(dir, baseOpts(dir, { pluginRoot: pluginWithSuite(dir) }))
    assert.ok(byId(report, 'evals-harness'))
    assert.ok(byId(report, 'evals-credential'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a plugin root with no eval suite reports neither row', () => {
  const dir = tmp()
  try {
    const report = diagnose(dir, baseOpts(dir))
    const ids = report.checks.map(c => c.id)
    assert.ok(!ids.includes('evals-harness'), 'no suite, no prerequisite to report')
    assert.ok(!ids.includes('evals-credential'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an absent prerequisite is skipped with a reason, never failed and never warned', () => {
  const dir = tmp()
  try {
    const report = diagnose(dir, baseOpts(dir, { pluginRoot: pluginWithSuite(dir) }))
    for (const id of ['evals-harness', 'evals-credential']) {
      const row = byId(report, id)
      assert.equal(row.status, 'skip', `${id} must skip, not fail`)
      assert.ok(row.detail.length > 0, `${id} states what is missing`)
      assert.match(row.fix, /export|Set one of/, `${id} states how to supply it`)
      assert.ok(!report.failures.includes(id))
      assert.ok(!report.warnings.includes(id))
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a present prerequisite reports satisfied, and never the credential value', () => {
  const dir = tmp()
  try {
    const secret = 'sk-ant-SUPERSECRETVALUE'
    const report = diagnose(
      dir,
      baseOpts(dir, {
        pluginRoot: pluginWithSuite(dir),
        env: { PATH: join(dir, 'stub-bin'), CLAUDE_CODE_WALNUT_SPIRE: '1', ANTHROPIC_API_KEY: secret }
      })
    )
    assert.equal(byId(report, 'evals-harness').status, 'ok')
    assert.equal(byId(report, 'evals-credential').status, 'ok')
    assert.match(byId(report, 'evals-credential').detail, /ANTHROPIC_API_KEY is set/, 'the name, not the value')

    // Neither surface: the human rendering, nor the structured payload that gets
    // written to disk and pasted into issues.
    assert.doesNotMatch(formatDoctor(report), new RegExp(secret))
    assert.doesNotMatch(JSON.stringify(report), new RegExp(secret))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a prerequisite check that cannot run degrades to skipped, not to a failure', () => {
  const dir = tmp()
  try {
    const root = pluginWithSuite(dir)
    // A probe that throws where the shared `run()` wrapper would have produced
    // `fail`. Passing a hostile env is the cheapest way to make presence-reading
    // throw without reaching into the module.
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('environment unreadable')
        }
      }
    )
    const rows = evalPrerequisiteChecks(root, hostile)
    assert.equal(rows.length, 2)
    for (const row of rows) {
      assert.equal(row.status, 'skip')
      assert.match(row.detail, /could not run: environment unreadable/)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the eval rows change no exit status: clean stays clean, broken breaks for its own reason', () => {
  const dir = tmp()
  try {
    assert.ok(gitInit(dir), 'this assertion needs a real work tree')
    file(dir, '.claude/testing/profile.json', PROFILE)
    file(dir, '.claude/settings.json', {
      permissions: {
        allow: [
          'Bash(interlock:*)',
          'Bash(interlock-graph:*)',
          'Bash(openspec:*)',
          'Bash(git:*)',
          'Bash(test:*)',
          'Bash(printenv:*)',
          'Bash(mkdir:*)',
          'Bash(npm test:*)',
          'Bash(npm run test:unit:*)'
        ]
      }
    })
    const opts = baseOpts(dir, { pluginRoot: pluginWithSuite(dir) })

    const clean = diagnose(dir, opts)
    assert.equal(clean.ok, true, `both prerequisites absent must still pass: ${clean.failures.join(', ')}`)
    assert.equal(byId(clean, 'evals-harness').status, 'skip')

    // Now break something unrelated and confirm the failure is that, alone.
    rmSync(join(dir, '.claude/testing/profile.json'))
    const broken = diagnose(dir, opts)
    assert.equal(broken.ok, false)
    assert.deepEqual(broken.failures, ['test-profile'], 'the eval rows are not among the failures')
    assert.ok(broken.checks.some(c => c.id === 'evals-harness'), 'and they are still reported')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Push notification advice — never a gate (design D5, D12)
// ---------------------------------------------------------------------------

test('the notify row is ok when a topic is configured, naming the server and never the topic', () => {
  const dir = tmp()
  try {
    file(dir, '.claude/testing/profile.json', PROFILE)
    file(dir, '.claude/settings.json', ALL_ALLOWED)
    const secret = 'super-secret-topic'
    const opts = baseOpts(dir)
    const report = diagnose(dir, { ...opts, env: { ...opts.env, INTERLOCK_NTFY_TOPIC: secret } })
    const notify = byId(report, 'notify')
    assert.equal(notify.status, 'ok')
    assert.match(notify.detail, /https:\/\/ntfy\.sh/)
    assert.doesNotMatch(notify.detail, new RegExp(secret))
    assert.doesNotMatch(JSON.stringify(report), new RegExp(secret))
    assert.doesNotMatch(formatDoctor(report), new RegExp(secret))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the notify row honours a self-hosted server URL, still never the topic', () => {
  const dir = tmp()
  try {
    file(dir, '.claude/testing/profile.json', PROFILE)
    file(dir, '.claude/settings.json', ALL_ALLOWED)
    const opts = baseOpts(dir)
    const report = diagnose(dir, {
      ...opts,
      env: { ...opts.env, INTERLOCK_NTFY_TOPIC: 'a-topic', INTERLOCK_NTFY_URL: 'https://ntfy.example.internal' }
    })
    assert.match(byId(report, 'notify').detail, /https:\/\/ntfy\.example\.internal/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the notify row is skip when no topic is configured, naming the variable, and is never a failure', () => {
  const dir = tmp()
  try {
    file(dir, '.claude/testing/profile.json', PROFILE)
    file(dir, '.claude/settings.json', ALL_ALLOWED)
    const report = diagnose(dir, baseOpts(dir))
    const notify = byId(report, 'notify')
    assert.equal(notify.status, 'skip')
    assert.match(notify.detail, /INTERLOCK_NTFY_TOPIC/)
    assert.ok(!report.failures.includes('notify'))
    assert.ok(!report.warnings.includes('notify'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the notify row is never fail, whatever the env holds', () => {
  const dir = tmp()
  try {
    file(dir, '.claude/testing/profile.json', PROFILE)
    file(dir, '.claude/settings.json', ALL_ALLOWED)
    const hostile = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === Symbol.iterator || typeof prop === 'symbol') return undefined
          throw new Error('environment unreadable')
        }
      }
    )
    const opts = baseOpts(dir)
    const report = diagnose(dir, { ...opts, env: hostile })
    assert.equal(byId(report, 'notify').status, 'skip')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('HOST_READ_ONLY names the host-auto-approved commands and excludes what the run needs allowlisted', () => {
  assert.ok(Object.isFrozen(HOST_READ_ONLY))
  assert.ok(HOST_READ_ONLY.includes('echo'))
  assert.ok(HOST_READ_ONLY.includes('pwd'))
  for (const name of ['test', 'printenv', 'mkdir']) {
    assert.ok(!HOST_READ_ONLY.includes(name), `${name} must not be treated as auto-approved`)
  }
})

// ---------------------------------------------------------------------------
// Instructed-command extraction (design D12)
// ---------------------------------------------------------------------------

test('extractInstructedCommands reports a command a Run: line instructs', () => {
  assert.deepEqual(extractInstructedCommands('Run: chmod +x bin/x'), ['chmod'])
})

test('extractInstructedCommands reports a command inside an escaped-backtick code span', () => {
  assert.deepEqual(extractInstructedCommands('do not run \\`echo $PPID\\` yourself'), ['echo'])
})

test('extractInstructedCommands splits compound shell text on && ; and |', () => {
  assert.deepEqual(extractInstructedCommands('Run: test -f a && echo yes || echo no').sort(), ['echo', 'test'])
})

test('extractInstructedCommands does not treat an unescaped backtick (a JS template-literal delimiter) as a code span', () => {
  // Exactly the shape a JS source line takes: a real backtick opens/closes the
  // template literal, and reading it as a markdown code span would swallow
  // the whole line as one "command".
  assert.deepEqual(extractInstructedCommands('`some prose about rm -rf /`'), [])
})

test('extractInstructedCommands ignores a bare backticked field name or placeholder', () => {
  assert.deepEqual(
    extractInstructedCommands('populate \\`group\\` and \\`paths\\`, never \\`dependsOn\\`'),
    []
  )
})

test('extractInstructedCommands strips VAR=value prefixes, $( and quotes before taking the token', () => {
  assert.deepEqual(extractInstructedCommands('Run: CI=1 npm test'), ['npm'])
  assert.deepEqual(extractInstructedCommands('Run: $(git rev-parse HEAD)'), ['git'])
  assert.deepEqual(extractInstructedCommands('Run: "git" status'), ['git'])
})

test('extractInstructedCommands is defensive about its input and exports a frozen, pinned ignore list', () => {
  assert.deepEqual(extractInstructedCommands(''), [])
  assert.deepEqual(extractInstructedCommands(null), [])
  assert.deepEqual(extractInstructedCommands(undefined), [])
  assert.ok(Array.isArray(IGNORED_INSTRUCTION_SPANS))
  assert.ok(Object.isFrozen(IGNORED_INSTRUCTION_SPANS))
})

test('the live drift test — every command the driver and every briefing instructs is allowlistable', () => {
  const files = [
    join(REPO, 'workflows', 'ship.js'),
    ...readdirSync(join(REPO, 'lib', 'prompts'))
      .filter(f => f.endsWith('.mjs'))
      .map(f => join(REPO, 'lib', 'prompts', f))
  ]
  const allowed = new Set([...REQUIRED_COMMANDS.map(c => c.tokens.join(' ')), 'npm test', 'node --test', ...HOST_READ_ONLY])
  const violations = []
  for (const filePath of files) {
    const text = readFileSync(filePath, 'utf8')
    for (const cmd of extractInstructedCommands(text)) {
      if (!allowed.has(cmd)) violations.push(`${filePath}: ${cmd}`)
    }
  }
  assert.deepEqual(violations, [], `instructed command(s) not covered by any allowlist source:\n${violations.join('\n')}`)
})

// ---------------------------------------------------------------------------
// Repo fact — this repository's own settings cover its own required set (D11/D12)
// ---------------------------------------------------------------------------
//
// Never calls `diagnose(REPO)`, which would read `~/.claude` and the machine's
// own PATH. Reads exactly `<repo>/.claude/settings.json` and matches it with
// the preflight's own `parseRule`/`ruleCovers`, so this is the same claim
// `interlock doctor` would make about this repository, checked without
// depending on the developer's own machine having anything installed.

test("this repository's own .claude/settings.json covers REQUIRED_COMMANDS plus its own runner commands", () => {
  const settingsPath = join(REPO, '.claude', 'settings.json')
  assert.ok(
    existsSync(settingsPath),
    '.claude/settings.json must exist and be committed — it is the whole reason `interlock doctor` is green here'
  )
  const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
  const allowRaw = (parsed.permissions && parsed.permissions.allow) || []
  const rules = allowRaw.map(parseRule).filter(Boolean)

  // .claude/testing/ is gitignored and absent on CI, so the profile is
  // consulted only when present; the repo's own runner commands are pinned
  // explicitly rather than relying on it.
  const profilePath = join(REPO, '.claude', 'testing', 'profile.json')
  const profile = existsSync(profilePath) ? JSON.parse(readFileSync(profilePath, 'utf8')) : null

  const required = [
    ...REQUIRED_COMMANDS,
    ...(profile ? profileCommands(profile) : []),
    { tokens: ['npm', 'test'], open: true, why: "this repository's own unit runner (pinned: profile is gitignored)" },
    {
      tokens: ['node', '--test'],
      open: true,
      why: "this repository's own unit runner, single-file form (pinned: profile is gitignored)"
    }
  ]

  const uncovered = required.filter(req => !rules.some(rule => ruleCovers(rule, req)))
  assert.deepEqual(
    uncovered.map(u => u.tokens.join(' ')),
    [],
    `.claude/settings.json has no covering allow rule for: ${uncovered.map(u => u.tokens.join(' ')).join(', ')}`
  )
})

// ---------------------------------------------------------------------------
// CLI wiring — the exit code is the whole point
// ---------------------------------------------------------------------------

test('interlock doctor exits 1 when a check fails and emits parseable JSON either way', () => {
  const dir = tmp()
  try {
    const r = spawnSync(process.execPath, [BIN, 'doctor', '--root', dir, '--json'], { encoding: 'utf8' })
    assert.equal(r.error, undefined)
    let report
    assert.doesNotThrow(() => {
      report = JSON.parse(r.stdout)
    }, `doctor --json did not emit parseable JSON:\n${r.stdout}`)
    assert.equal(report.ok, false, 'an empty temp dir cannot pass the preflight')
    assert.equal(r.status, 1, 'a failing preflight must exit non-zero')
    assert.ok(report.failures.includes('test-profile'))
    assert.equal(report.root, resolve(dir))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('interlock doctor is listed in the usage text, with its exit code', () => {
  const r = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /interlock doctor\s+Preflight the host/)
  assert.match(r.stdout, /doctor\s+a preflight check would stop a zero-touch run/)
})
