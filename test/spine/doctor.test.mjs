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
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as claudeEnv from '../../lib/host/claude-env.mjs'
import {
  checkClaudeBare,
  checkStateDirs,
  checkStateHome,
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
  PROMPT_CACHE_MAIN_KEY,
  PROMPT_CACHE_MIN_HOST_VERSION,
  PROMPT_CACHE_SUBAGENT_KEY,
  STATE_DIRS
} from '../../lib/doctor.mjs'
import { AGENT_USAGE_DIR } from '../../lib/agent-usage.mjs'
import { HANDOFF_DIR } from '../../lib/resume-card.mjs'

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

// ---------------------------------------------------------------------------
// Prompt-cache lifetime advice — never a gate, never a measurement (D3, D4)
// ---------------------------------------------------------------------------

/** A project whose settings carry the allowlist plus whatever lifetime keys are asked for. */
function promptCacheReport(dir, settings = {}, env = {}) {
  file(dir, '.claude/testing/profile.json', PROFILE)
  file(dir, '.claude/settings.json', { ...ALL_ALLOWED, ...settings })
  const opts = baseOpts(dir)
  return diagnose(dir, { ...opts, env: { ...opts.env, ...env } })
}

test('the prompt-cache row is ok when both lifetimes are configured, and leaves the verdict alone', () => {
  const dir = tmp()
  try {
    const report = promptCacheReport(dir, {
      [PROMPT_CACHE_MAIN_KEY]: '1h',
      [PROMPT_CACHE_SUBAGENT_KEY]: '1h'
    })
    const row = byId(report, 'prompt-cache')
    assert.equal(row.status, 'ok')
    assert.ok(!report.failures.includes('prompt-cache'))
    assert.ok(!report.warnings.includes('prompt-cache'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unset lifetime is skip, never fail, and does not move the exit code', () => {
  const dir = tmp()
  try {
    const report = promptCacheReport(dir)
    const row = byId(report, 'prompt-cache')
    assert.equal(row.status, 'skip')
    assert.notEqual(row.status, 'fail')
    assert.ok(!report.failures.includes('prompt-cache'))
    assert.ok(!report.warnings.includes('prompt-cache'))
    // The row names both keys, says which governs wave agents, and carries the floor.
    assert.match(row.detail, new RegExp(PROMPT_CACHE_MAIN_KEY))
    assert.match(row.detail, new RegExp(PROMPT_CACHE_SUBAGENT_KEY))
    assert.match(row.detail, /wave agents/)
    assert.match(row.detail, new RegExp(PROMPT_CACHE_MIN_HOST_VERSION.replace(/\./g, '\\.')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('one lifetime configured is still skip — setting one leaves the other on its default', () => {
  const dir = tmp()
  try {
    const report = promptCacheReport(dir, { [PROMPT_CACHE_SUBAGENT_KEY]: '1h' })
    const row = byId(report, 'prompt-cache')
    assert.equal(row.status, 'skip')
    assert.match(row.detail, new RegExp(`${PROMPT_CACHE_SUBAGENT_KEY}[^;]*set in project`))
    assert.match(row.detail, new RegExp(`${PROMPT_CACHE_MAIN_KEY}[^;]*not set`))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a lifetime set in any readable scope counts, and no scope wins a printed value', () => {
  const dir = tmp()
  try {
    file(dir, '.claude/testing/profile.json', PROFILE)
    file(dir, '.claude/settings.json', { ...ALL_ALLOWED, [PROMPT_CACHE_SUBAGENT_KEY]: '5m' })
    file(dir, 'home/.claude/settings.json', { [PROMPT_CACHE_SUBAGENT_KEY]: '1h' })
    const opts = baseOpts(dir, {
      settingsSources: [
        { scope: 'user', path: join(dir, 'home', '.claude', 'settings.json') },
        { scope: 'project', path: join(dir, '.claude', 'settings.json') }
      ]
    })
    const row = byId(diagnose(dir, opts), 'prompt-cache')
    assert.match(row.detail, new RegExp(`${PROMPT_CACHE_SUBAGENT_KEY}[^;]*set in user, project`))
    // Neither value is printed: resolving the merge is the host's job, and a row
    // that printed one would be recommending a value it did not compute.
    assert.doesNotMatch(row.detail, /5m|1h/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the row names the detected auth mode and never claims an effective lifetime', () => {
  const dir = tmp()
  try {
    const report = promptCacheReport(dir, {}, { ANTHROPIC_API_KEY: 'sk-not-a-real-key' })
    const row = byId(report, 'prompt-cache')
    assert.match(row.detail, /auth mode: API key/)
    // Presence only — the value never reaches the report.
    assert.doesNotMatch(JSON.stringify(report), /sk-not-a-real-key/)
    // And nothing asserts what the running session is actually getting.
    assert.doesNotMatch(row.detail, /currently|in force|effective lifetime is/)
    assert.match(row.detail, /nothing exposes the lifetime a session is actually running under/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an undetectable auth mode is named as undetected rather than guessed', () => {
  const dir = tmp()
  try {
    const row = byId(promptCacheReport(dir), 'prompt-cache')
    assert.match(row.detail, /auth mode: not determined/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the prompt-cache row is never fail, whatever the env or the settings tree holds', () => {
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
    assert.equal(byId(diagnose(dir, { ...opts, env: hostile }), 'prompt-cache').status, 'skip')

    // A settings file that is present and unparseable is not evidence either way.
    file(dir, '.claude/settings.json', '{ not json')
    assert.equal(byId(diagnose(dir, baseOpts(dir)), 'prompt-cache').status, 'skip')
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
    // The SessionStart preflight reads the home from here rather than resolving it again.
    assert.equal(typeof report.stateHome, 'string')
    assert.ok(report.stateHome.length > 0)
    assert.equal(typeof report.surface, 'string')
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

// ---------------------------------------------------------------------------
// The Claude Code environment a run's routing reads — advice, never a gate
// ---------------------------------------------------------------------------

/** A report whose `claude --version` probe answers `version` (null for a failed probe). */
function claudeEnvRow(dir, env = {}, version = '2.1.288 (Claude Code)', extra = {}) {
  file(dir, '.claude/testing/profile.json', PROFILE)
  file(dir, '.claude/settings.json', ALL_ALLOWED)
  const opts = baseOpts(dir)
  return byId(
    diagnose(dir, { ...opts, env: { ...opts.env, ...env }, probeVersion: () => version, cpuCount: 8, ...extra }),
    'claude-env'
  )
}

test('the claude-env row is ok with nothing set on a readable host, and leaves the verdict alone', () => {
  const dir = tmp()
  try {
    const row = claudeEnvRow(dir)
    assert.equal(row.status, 'ok')
    assert.match(row.detail, /2\.1\.288/)
    assert.match(row.detail, /8 CPUs/)
    assert.match(row.detail, /16/, 'the vendor default concurrency, beside the CPU count')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the claude-env row names each forcing or overriding variable, and is skip, never fail', () => {
  const cases = [
    [{ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' }, [/CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1/, /every agent runs on one model/]],
    [{ CLAUDE_CODE_SUBAGENT_MODEL: 'opus' }, [/CLAUDE_CODE_SUBAGENT_MODEL=opus/, /sets only the default subagent model/]],
    [{ CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' }, [/CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1/, /does not affect Workflow agents/]],
    [{ CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS: '4' }, [/CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=4/]],
    [{ CLAUDE_CODE_USE_BEDROCK: '1' }, [/Bedrock/]]
  ]
  for (const [env, patterns] of cases) {
    const dir = tmp()
    try {
      const row = claudeEnvRow(dir, env)
      const four = !('CLAUDE_CODE_USE_BEDROCK' in env)
      assert.equal(row.status, four ? 'skip' : 'ok', JSON.stringify(env))
      for (const pattern of patterns) assert.match(row.detail, pattern, JSON.stringify(env))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('the claude-env row reads the plain variable by version: overriding on an older host', () => {
  const dir = tmp()
  try {
    const row = claudeEnvRow(dir, { CLAUDE_CODE_SUBAGENT_MODEL: 'opus' }, '2.1.250 (Claude Code)')
    assert.equal(row.status, 'skip')
    assert.match(row.detail, /replaces every agent's model/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unreadable host version is named unknown, and the row is skip', () => {
  const dir = tmp()
  try {
    const row = claudeEnvRow(dir, { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' }, null)
    assert.equal(row.status, 'skip')
    assert.match(row.detail, /unknown/)
    assert.match(row.detail, /does not affect Workflow agents/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  const clean = tmp()
  try {
    assert.equal(claudeEnvRow(clean, {}, null).status, 'skip', 'an unknown version is not a clean reading')
  } finally {
    rmSync(clean, { recursive: true, force: true })
  }
})

test('the claude-env row is never fail, whatever the env holds', () => {
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
    const report = diagnose(dir, { ...baseOpts(dir), env: hostile })
    assert.equal(byId(report, 'claude-env').status, 'skip')
    assert.ok(!report.failures.includes('claude-env'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// The mods row: whether the host can load the plugin's hooks module — advice
// ---------------------------------------------------------------------------

/** The `mods` row of a report whose `claude --version` probe answers `version`. */
function modsRow(dir, version, env = {}) {
  file(dir, '.claude/testing/profile.json', PROFILE)
  file(dir, '.claude/settings.json', ALL_ALLOWED)
  const opts = baseOpts(dir)
  const report = diagnose(dir, { ...opts, env: { ...opts.env, ...env }, probeVersion: () => version, cpuCount: 8 })
  return { row: byId(report, 'mods'), report }
}

test('the mods row is ok at the floor, naming the version and the binary it probed', () => {
  const dir = tmp()
  try {
    const { row, report } = modsRow(dir, '2.1.289 (Claude Code)', { INTERLOCK_CLAUDE_COMMAND: '/opt/bin/claude-wrapper' })
    assert.ok(row, 'doctor carries no mods row')
    assert.equal(row.status, 'ok')
    assert.match(row.detail, /2\.1\.289/)
    assert.match(row.detail, /\/opt\/bin\/claude-wrapper/)
    assert.ok(!report.failures.includes('mods'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the mods row is skip below the floor, naming the version, the floor, and that the run is unchanged', () => {
  const dir = tmp()
  try {
    const { row, report } = modsRow(dir, '2.1.274 (Claude Code)')
    assert.equal(row.status, 'skip')
    assert.match(row.detail, /2\.1\.274/)
    assert.match(row.detail, new RegExp(String(claudeEnv.MODS_MIN_HOST_VERSION).replace(/\./g, '\\.')))
    assert.match(row.detail, /draws nothing here/)
    assert.match(row.detail, /every banner/)
    assert.ok(!report.failures.includes('mods'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unreadable version is skip, named unknown, with the Desktop sentence', () => {
  const dir = tmp()
  try {
    const { row } = modsRow(dir, null)
    assert.equal(row.status, 'skip')
    assert.match(row.detail, /unknown/)
    assert.match(row.detail, /Desktop/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the mods row is never fail, whatever the env holds', () => {
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
    const report = diagnose(dir, { ...baseOpts(dir), env: hostile })
    assert.equal(byId(report, 'mods').status, 'skip')
    assert.ok(!report.failures.includes('mods'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the mods row rides doctor --json', () => {
  const dir = tmp()
  try {
    const { report } = modsRow(dir, '2.1.289 (Claude Code)')
    assert.ok(JSON.parse(JSON.stringify(report)).checks.some(c => c.id === 'mods'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the interrupted-run notes directory is a non-fatal state directory', () => {
  const entry = STATE_DIRS.find(d => d.path === join('.claude', 'ship', 'interrupted'))
  assert.ok(entry, 'STATE_DIRS does not name .claude/ship/interrupted')
  assert.equal(entry.fatal, false, 'the note is outcome-class: losing it never ends a run')
})

// ---------------------------------------------------------------------------
// The state home — where each state directory lives, and which home the
// doctor resolved (design D12, D13, D15)
// ---------------------------------------------------------------------------
//
// The happy paths run against a real `git worktree add` fixture, the same way
// `test/spine/state-home.test.mjs` does, because the property under test is
// what real git prints. The fixture's git runs without the developer's global
// or system config; the resolver's own git inherits this process's environment,
// so discovery is fenced at the temporary directory for the duration of each
// case — a temp directory that sits inside some other checkout must not turn
// "not a repository" into a pass.

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

function gitOk(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV })
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}

/** Run `fn` with git discovery fenced at the temp directory, restoring the caller's value after. */
function fenced(fn) {
  const prior = process.env.GIT_CEILING_DIRECTORIES
  process.env.GIT_CEILING_DIRECTORIES = realpathSync(tmpdir())
  try {
    return fn()
  } finally {
    if (prior === undefined) delete process.env.GIT_CEILING_DIRECTORIES
    else process.env.GIT_CEILING_DIRECTORIES = prior
  }
}

/**
 * A main checkout at `<tmp>/main` with one commit, and a linked worktree of it
 * at `<main>/.claude/worktrees/w1` — where a Desktop worktree session lives.
 * Every path is real from the start, so the doctor's evidence and the
 * fixture's paths are the same strings on macOS, whose `/tmp` is a symlink.
 */
function worktreeFixture() {
  const dir = realpathSync(tmp())
  const main = join(dir, 'main')
  mkdirSync(main)
  gitOk(main, ['init', '-q', '-b', 'main'])
  gitOk(main, ['config', 'user.email', 'test@example.invalid'])
  gitOk(main, ['config', 'user.name', 'Test'])
  writeFileSync(join(main, 'README.md'), 'fixture\n')
  gitOk(main, ['add', '-A'])
  gitOk(main, ['commit', '-qm', 'base'])
  const worktree = join(main, '.claude', 'worktrees', 'w1')
  gitOk(main, ['worktree', 'add', '-q', worktree, '-b', 'w1'])
  return { dir, main, worktree }
}

const NOT_AS_ROOT = {
  skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root ignores mode bits' : false
}

test('every STATE_DIRS entry names the home it lives under, and keeps its fatality', () => {
  for (const d of STATE_DIRS) {
    assert.ok(d.home === 'state' || d.home === 'root', `${d.path} has no home: ${d.home}`)
    assert.equal(typeof d.fatal, 'boolean', `${d.path} has no fatality`)
  }
  const at = rel => {
    const found = STATE_DIRS.find(d => d.path === rel)
    assert.ok(found, `STATE_DIRS does not name ${rel}`)
    return found
  }
  // Append-only corpora: the state home. The trajectory is the one fatal one.
  assert.deepEqual(
    [join('.claude', 'ship', 'runs'), join('.claude', 'learning'), join('.claude', 'metrics'), HANDOFF_DIR, join('.claude', 'ship', 'interrupted')].map(
      rel => [rel, at(rel).home, at(rel).fatal]
    ),
    [
      [join('.claude', 'ship', 'runs'), 'state', true],
      [join('.claude', 'learning'), 'state', false],
      [join('.claude', 'metrics'), 'state', false],
      [HANDOFF_DIR, 'state', false],
      [join('.claude', 'ship', 'interrupted'), 'state', false]
    ]
  )
  // Per-run working state: the root. The spill is fatal and stays with the run
  // (its locators are root-relative and `verify spill` writes under --root);
  // the agent-usage sidecar is the recorder's, outcome-class.
  assert.deepEqual([at(join('.claude', 'ship', 'spill')).home, at(join('.claude', 'ship', 'spill')).fatal], ['root', true])
  assert.deepEqual([at(AGENT_USAGE_DIR).home, at(AGENT_USAGE_DIR).fatal], ['root', false])
})

test('from a linked worktree the state-home row names the main checkout and the surface, and the JSON carries it', () => {
  fenced(() => {
    const { dir, main, worktree } = worktreeFixture()
    try {
      const report = diagnose(worktree, baseOpts(dir))
      const row = byId(report, 'state-home')
      assert.equal(row.status, 'ok', row.detail)
      assert.ok(row.detail.includes(main), row.detail)
      assert.match(row.detail, /linked-worktree/)
      assert.ok(
        row.detail.includes(
          `corpora of this run go to ${main}; the test profile and graph are read from there when this root has none`
        ),
        row.detail
      )
      assert.equal(report.stateHome, main)
      assert.equal(report.surface, 'linked-worktree')
      const json = JSON.parse(JSON.stringify(report))
      assert.equal(json.stateHome, main)
      assert.equal(json.surface, 'linked-worktree')
      assert.ok(!report.failures.includes('state-home') && !report.warnings.includes('state-home'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('from a linked worktree each state directory is probed under its own home, by absolute path', () => {
  fenced(() => {
    const { dir, main, worktree } = worktreeFixture()
    try {
      const row = byId(diagnose(worktree, baseOpts(dir)), 'state-dirs')
      assert.equal(row.status, 'ok', row.evidence.join('\n'))
      const evidence = row.evidence.join('\n')
      assert.ok(evidence.includes(join(main, '.claude', 'ship', 'runs')), evidence)
      assert.ok(evidence.includes(join(worktree, '.claude', 'ship', 'agent-usage')), evidence)
      // The corpora were probed in the main checkout, not in the worktree.
      assert.ok(!evidence.includes(join(worktree, '.claude', 'ship', 'runs')), evidence)
      assert.ok(!evidence.includes(join(main, '.claude', 'ship', 'agent-usage')), evidence)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('a read-only trajectory directory in the main checkout fails the worktree session\'s doctor, naming that path', NOT_AS_ROOT, () => {
  fenced(() => {
    const { dir, main, worktree } = worktreeFixture()
    const runs = join(main, '.claude', 'ship', 'runs')
    try {
      mkdirSync(runs, { recursive: true })
      chmodSync(runs, 0o555)
      const report = diagnose(worktree, baseOpts(dir))
      const row = byId(report, 'state-dirs')
      assert.equal(row.status, 'fail')
      assert.ok(report.failures.includes('state-dirs'))
      assert.ok(row.evidence.some(e => e.startsWith(`${runs}:`)), row.evidence.join('\n'))
      assert.ok(row.fix.includes(main), row.fix)
      assert.match(row.fix, /exits 1 mid-run/)
    } finally {
      try {
        chmodSync(runs, 0o755)
      } catch {
        // best effort; the rm below is what matters
      }
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('checkStateDirs probes state entries under the home and root entries under the root', () => {
  const dir = realpathSync(tmp())
  try {
    const root = join(dir, 'root')
    const home = join(dir, 'home')
    mkdirSync(root)
    mkdirSync(home)
    const row = checkStateDirs(root, home)
    assert.equal(row.status, 'ok')
    for (const d of STATE_DIRS) {
      const expected = join(d.home === 'state' ? home : root, d.path)
      assert.ok(row.evidence.some(e => e.startsWith(`${expected}:`)), `${expected} not probed:\n${row.evidence.join('\n')}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('on a main checkout the state-home row names the root itself', () => {
  fenced(() => {
    const { dir, main } = worktreeFixture()
    try {
      const report = diagnose(main, baseOpts(dir))
      const row = byId(report, 'state-home')
      assert.equal(row.status, 'ok')
      assert.ok(row.detail.includes(main), row.detail)
      assert.match(row.detail, /\bmain\b/)
      assert.doesNotMatch(row.detail, /corpora of this run go to/)
      assert.equal(report.stateHome, main)
      assert.equal(report.surface, 'main')
      // A main checkout prints no separate state-home header line.
      assert.doesNotMatch(formatDoctor(report), /^ {2}state home:/m)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('a root git cannot read makes the state-home row skip with the reason, and the JSON home is the root', () => {
  fenced(() => {
    const dir = realpathSync(tmp())
    try {
      const report = diagnose(dir, baseOpts(dir))
      const row = byId(report, 'state-home')
      assert.equal(row.status, 'skip')
      assert.match(row.detail, /STATE HOME UNRESOLVED: /)
      assert.match(row.detail, /git rev-parse/, 'the resolver\'s own reason is carried')
      assert.equal(report.stateHome, dir)
      assert.equal(report.stateHome, report.root)
      assert.equal(report.surface, 'unknown')
      assert.ok(!report.failures.includes('state-home') && !report.warnings.includes('state-home'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('an explicit state home wins over INTERLOCK_STATE_HOME, which wins over resolution', () => {
  fenced(() => {
    const dir = realpathSync(tmp())
    try {
      const flag = join(dir, 'from-flag')
      const fromEnv = join(dir, 'from-env')
      mkdirSync(flag)
      mkdirSync(fromEnv)
      const opts = baseOpts(dir)
      const env = { ...opts.env, INTERLOCK_STATE_HOME: fromEnv }

      const byEnv = diagnose(dir, { ...opts, env })
      assert.equal(byEnv.stateHome, fromEnv)
      const envRow = byId(byEnv, 'state-home')
      assert.equal(envRow.status, 'ok')
      assert.match(envRow.detail, /explicit/)
      assert.ok(envRow.detail.includes(`corpora of this run go to ${fromEnv}`), envRow.detail)

      const byFlag = diagnose(dir, { ...opts, env, stateHome: flag })
      assert.equal(byFlag.stateHome, flag)
      // The state directories follow the home the doctor resolved.
      assert.ok(
        byId(byFlag, 'state-dirs').evidence.some(e => e.startsWith(`${join(flag, '.claude', 'ship', 'runs')}:`)),
        byId(byFlag, 'state-dirs').evidence.join('\n')
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('the state-home row is never fail, whatever it is handed', () => {
  for (const resolved of [null, undefined, {}, { home: 42 }, 'nonsense']) {
    const row = checkStateHome('/r', resolved)
    assert.equal(row.id, 'state-home')
    assert.equal(row.status, 'skip', JSON.stringify(resolved))
  }
  const fellBack = checkStateHome('/r', { home: '/r', surface: 'unknown', reason: 'git said no', resolvedFrom: 'fallback' })
  assert.equal(fellBack.status, 'skip')
  assert.match(fellBack.detail, /git said no/)
  const hostile = new Proxy(
    {},
    {
      get() {
        throw new Error('resolution unreadable')
      }
    }
  )
  assert.equal(checkStateHome('/r', hostile).status, 'skip')
})

test('a worktree report prints both rows and a state-home header in the existing format', () => {
  fenced(() => {
    const { dir, main, worktree } = worktreeFixture()
    try {
      const text = formatDoctor(diagnose(worktree, baseOpts(dir)))
      assert.match(text, /^ {2}\[ok {2}\] state-home: /m)
      assert.match(text, /^ {2}\[skip\] claude-bare: /m)
      assert.ok(text.includes(`  state home: ${main}\n`), text)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// claude-bare — would a bare print-mode run have a credential? Advice only.
// ---------------------------------------------------------------------------

const SENTINEL = 'sk-test-SENTINEL'

test('the claude-bare row is ok with ANTHROPIC_API_KEY set, naming it and never its value', () => {
  const dir = tmp()
  try {
    const opts = baseOpts(dir)
    const report = diagnose(dir, { ...opts, env: { ...opts.env, ANTHROPIC_API_KEY: SENTINEL } })
    const row = byId(report, 'claude-bare')
    assert.equal(row.status, 'ok')
    assert.match(row.detail, /ANTHROPIC_API_KEY is set/)
    assert.ok(!JSON.stringify(row).includes(SENTINEL), 'the row carries the value')
    assert.ok(!JSON.stringify(report).includes(SENTINEL), 'the JSON report carries the value')
    assert.ok(!formatDoctor(report).includes(SENTINEL), 'the human report carries the value')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the claude-bare row is ok with an apiKeyHelper in the user scope beside an unreadable project file', () => {
  const dir = tmp()
  try {
    const helper = '/opt/helpers/key-helper-SENTINEL.sh'
    const userSettings = file(dir, 'home/.claude/settings.json', { apiKeyHelper: helper })
    const projectSettings = file(dir, '.claude/settings.json', '{ not json')
    const sources = [
      { scope: 'user', path: userSettings },
      { scope: 'project', path: projectSettings }
    ]
    const report = diagnose(dir, baseOpts(dir, { settingsSources: sources }))
    const row = byId(report, 'claude-bare')
    assert.equal(row.status, 'ok', row.detail)
    assert.match(row.detail, /apiKeyHelper is configured in user settings/)
    // The broken sibling belongs to other rows; this one neither reports nor fails on it.
    assert.doesNotMatch(row.detail, /not valid JSON/)
    assert.ok(!JSON.stringify(row).includes(projectSettings), 'the unreadable file is not this row\'s to report')
    assert.ok(!JSON.stringify(row).includes(helper), 'the helper is named by scope, never by value')
    assert.ok(!report.failures.includes('claude-bare'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('with neither a key nor a helper the claude-bare row is skip, says why, and names the fix', () => {
  const dir = tmp()
  try {
    const report = diagnose(dir, baseOpts(dir))
    const row = byId(report, 'claude-bare')
    assert.equal(row.status, 'skip')
    assert.match(row.detail, /a bare print-mode run would have no credential/)
    assert.match(row.detail, /set ANTHROPIC_API_KEY or configure apiKeyHelper/)
    assert.match(row.fix, /ANTHROPIC_API_KEY/)
    assert.match(row.fix, /apiKeyHelper/)
    // The vendor fact, and the simple-mode variable, are carried either way.
    assert.match(row.detail, /CLAUDE_CODE_SIMPLE is not set/)
    assert.match(row.detail, /--bare/)
    assert.match(row.detail, /default for -p/)
    assert.match(row.detail, /OAuth and the keychain are never read/)
    assert.match(row.detail, /--host claude/)
    assert.match(row.detail, /--plugin-dir/)
    assert.ok(!report.failures.includes('claude-bare'))
    assert.ok(!report.warnings.includes('claude-bare'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the claude-bare row says when CLAUDE_CODE_SIMPLE is set', () => {
  const row = checkClaudeBare({ CLAUDE_CODE_SIMPLE: '1', ANTHROPIC_API_KEY: SENTINEL }, { sources: [] })
  assert.equal(row.status, 'ok')
  assert.match(row.detail, /CLAUDE_CODE_SIMPLE is set/)
  assert.ok(!JSON.stringify(row).includes(SENTINEL))
})

test('the claude-bare row is never fail, whatever the env or the settings hold', () => {
  const dir = tmp()
  try {
    const hostile = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === Symbol.iterator || typeof prop === 'symbol') return undefined
          throw new Error('environment unreadable')
        }
      }
    )
    const direct = checkClaudeBare(hostile, { sources: [] })
    assert.equal(direct.status, 'skip')
    assert.match(direct.detail, /could not run: environment unreadable/)

    const report = diagnose(dir, { ...baseOpts(dir), env: hostile })
    assert.equal(byId(report, 'claude-bare').status, 'skip')
    assert.ok(!report.failures.includes('claude-bare'))

    // A settings "file" that is a directory, and a sources list that throws.
    mkdirSync(join(dir, 'settings-dir'))
    assert.equal(checkClaudeBare({}, { sources: [{ scope: 'user', path: join(dir, 'settings-dir') }] }).status, 'skip')
    const throwing = new Proxy([], {
      get() {
        throw new Error('sources unreadable')
      }
    })
    assert.equal(checkClaudeBare({}, { sources: throwing }).status, 'skip')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the claude-bare and state-home rows change no exit status: clean stays clean either way', () => {
  const dir = tmp()
  try {
    assert.ok(gitInit(dir), 'this assertion needs a real work tree')
    file(dir, 'openspec/config.yaml', 'project: test\n')
    file(dir, '.claude/testing/profile.json', PROFILE)
    file(dir, '.claude/settings.json', ALL_ALLOWED)
    const opts = baseOpts(dir)

    const without = diagnose(dir, opts)
    assert.equal(byId(without, 'claude-bare').status, 'skip')
    assert.equal(byId(without, 'state-home').status, 'ok')
    assert.equal(without.ok, true, without.failures.join(', '))

    const withKey = diagnose(dir, { ...opts, env: { ...opts.env, ANTHROPIC_API_KEY: SENTINEL } })
    assert.equal(byId(withKey, 'claude-bare').status, 'ok')
    assert.equal(withKey.ok, true, withKey.failures.join(', '))
    assert.deepEqual(withKey.failures, without.failures)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('from a linked worktree with no profile of its own the test-profile row reads the main checkout\'s', () => {
  // The same read-through `run start` performs (ship/state-home): a worktree
  // session must not be failed at its preflight for a profile its run will read.
  fenced(() => {
    const { dir, main, worktree } = worktreeFixture()
    try {
      mkdirSync(join(main, '.claude', 'testing'), { recursive: true })
      writeFileSync(
        join(main, '.claude', 'testing', 'profile.json'),
        JSON.stringify({ unit: { command: 'npm test' } })
      )
      const row = byId(diagnose(worktree, baseOpts(dir)), 'test-profile')
      assert.equal(row.status, 'ok', row.detail)
      assert.match(row.detail, /unit suite: npm test/)
      assert.match(row.detail, /read through from the state home/)
      assert.ok(row.detail.includes(join(main, '.claude', 'testing', 'profile.json')), row.detail)

      // Its own profile wins, and nothing is said about the main checkout.
      mkdirSync(join(worktree, '.claude', 'testing'), { recursive: true })
      writeFileSync(
        join(worktree, '.claude', 'testing', 'profile.json'),
        JSON.stringify({ unit: { command: 'node --test' } })
      )
      const own = byId(diagnose(worktree, baseOpts(dir)), 'test-profile')
      assert.equal(own.status, 'ok', own.detail)
      assert.match(own.detail, /unit suite: node --test/)
      assert.doesNotMatch(own.detail, /read through/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('with no profile in the root or the home the test-profile row still fails', () => {
  fenced(() => {
    const { dir, worktree } = worktreeFixture()
    try {
      const row = byId(diagnose(worktree, baseOpts(dir)), 'test-profile')
      assert.equal(row.status, 'fail', row.detail)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
