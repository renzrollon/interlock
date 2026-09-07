// The preflight — everything that can stop a zero-touch run, checked before it
// starts instead of three waves in.
//
// Every other gate in this repository judges the *work*: is this plan coherent,
// did the suite go red, does this finding survive a skeptic. This one judges the
// *machine the work runs on*, and it exists because those failures are the
// expensive ones. A run that halts on wave four because `openspec` is not
// installed, or because `Bash(npm test:*)` is missing from the allowlist and an
// approval prompt is waiting for a human who went to lunch, has already spent
// four waves of agents to discover something a filesystem read knew at second
// zero.
//
// Three properties are load-bearing:
//
//   1. NON-MUTATING. A doctor that fixes things is a doctor nobody can run to
//      find out what is broken. The writability probe is the only thing here
//      that touches the disk, and it writes a temp file into a directory that
//      already exists and removes it again. Nothing is created, installed, or
//      repaired — every failure carries a `fix` string the reader runs.
//
//   2. NEVER THROWS. A probe that cannot run is evidence, not an exception: a
//      missing `git`, an unreadable settings file, a PATH that is not a string
//      all become checks with a status and a reason. The one thing this module
//      must never do is fail to produce a report.
//
//   3. AN UNKNOWN IS NOT A PASS. The same rule `lib/ready.mjs` holds. A check
//      that could not run reports `skip` (we chose not to look) or `fail` (we
//      looked and could not confirm) — never `ok`. The permission checker in
//      particular refuses to infer coverage: a rule that is *narrower* than the
//      command it would have to permit is reported as narrower, by name, rather
//      than counted.
//
// PLUGIN ROOT vs PROJECT ROOT. Two different things are being diagnosed and
// they live in two different places. The *plugin* — workflows/ship.js, the
// agent definitions ship spawns by id, bin/ — is resolved from this module's own
// location, because that is the copy that will actually run. The *project* —
// settings, openspec artifacts, the test profile, the state directories — is
// resolved from `root`. Conflating them produces the worst kind of green: a
// report that checked the developer's checkout of Interlock while the run used
// the installed one.
//
// Exposed to skills and to `/interlock:ship` as `interlock doctor [--json]`.

import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The installed copy of the plugin — the one whose workflow and agents run. */
export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Where the test profile lives, mirroring `lib/ready.mjs`. */
export const TEST_PROFILE_PATH = join('.claude', 'testing', 'profile.json')

/**
 * Settings files Claude Code merges, least specific first. Enterprise managed
 * settings are read too — they can carry a `deny` a project cannot override,
 * which is precisely the kind of surprise that only shows up mid-run.
 */
export function settingsSources(root, home = homedir()) {
  const managed =
    platform() === 'darwin'
      ? '/Library/Application Support/ClaudeCode/managed-settings.json'
      : platform() === 'win32'
        ? join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'ClaudeCode', 'managed-settings.json')
        : '/etc/claude-code/managed-settings.json'
  return [
    { scope: 'managed', path: managed, optional: true },
    { scope: 'user', path: join(home, '.claude', 'settings.json'), optional: true },
    { scope: 'project', path: join(root, '.claude', 'settings.json'), optional: true },
    { scope: 'local', path: join(root, '.claude', 'settings.local.json'), optional: true }
  ]
}

/**
 * State directories a run writes to, each carrying whether losing it ends the
 * run — because the CLI already answers that, differently, per directory, and a
 * preflight that flattened them would fail a run over bookkeeping.
 *
 * `.claude/ship/runs` is fatal since the reconstructability gate landed: a
 * `wave-state` call whose trajectory append fails now exits 1 rather than
 * warning on stderr. `.claude/ship/spill` is fatal for a different reason —
 * `verify spill` has no fallback, and a verify agent that cannot spill an
 * oversized suite log has no legal way to report it. The other two are
 * explicitly never-fatal in their own modules ("losing a corpus line must never
 * fail the run that made it"; metrics "report their own failure and never touch
 * the exit code"), so an unwritable one is a warning here too.
 */
export const STATE_DIRS = Object.freeze([
  { path: join('.claude', 'ship', 'runs'), fatal: true, why: 'run trajectory; a failed append exits 1' },
  { path: join('.claude', 'ship', 'spill'), fatal: true, why: 'spilled suite output; no fallback path' },
  { path: join('.claude', 'learning'), fatal: false, why: 'outcome corpus; never fatal at runtime' },
  { path: join('.claude', 'metrics'), fatal: false, why: 'review metrics; never fatal at runtime' }
])

/**
 * Commands the flow shells out to, independent of the project's test setup.
 * `open` means the rule has to permit arguments after the prefix — `interlock`
 * is never invoked bare, so a rule allowing exactly `interlock` and nothing else
 * permits none of the ~30 subcommands the loop calls.
 */
export const REQUIRED_COMMANDS = Object.freeze([
  { tokens: ['interlock'], open: true, why: 'every deterministic gate in the loop' },
  { tokens: ['interlock-graph'], open: true, why: 'graph queries in explore / bootstrap' },
  { tokens: ['openspec'], open: true, why: 'spec and bootstrap read and write changes through it' },
  { tokens: ['git'], open: true, why: 'diffs during review, and the commit stage' },
  {
    tokens: ['test'],
    open: true,
    why: 'the environment probe checks for the graph and the test profile (workflows/ship.js)'
  },
  {
    tokens: ['printenv'],
    open: true,
    why: 'the environment probe reads CLAUDE_CODE_SUBAGENT_MODEL and the Bedrock variables'
  },
  { tokens: ['mkdir'], open: true, why: 'the environment probe creates .claude/ship/' }
])

/**
 * Commands Claude Code auto-approves as read-only no matter what the
 * project's own allowlist says, so a briefing that instructs one of these
 * needs no rule of its own and the drift test below must not demand one.
 * Source: the Claude Code permissions documentation
 * (https://docs.claude.com/en/docs/claude-code/permissions), checked
 * 2026-09-07 — a host claim this module cannot itself verify, so it is dated
 * and cited rather than asserted bare. If the host narrows this list the
 * failure is loud: the drift test below goes red naming the command, never a
 * silent trust of a stale copy. Read-only `git` subcommands are covered
 * separately, by `REQUIRED_COMMANDS`' own open `git` entry, not by this list.
 */
export const HOST_READ_ONLY = Object.freeze([
  'ls',
  'cat',
  'echo',
  'pwd',
  'head',
  'tail',
  'grep',
  'find',
  'wc',
  'which',
  'diff',
  'stat',
  'du',
  'cd'
])

const STATUS_MARK = { ok: 'ok  ', warn: 'warn', fail: 'FAIL', skip: 'skip' }
const SEVERITY = { ok: 0, skip: 1, warn: 2, fail: 3 }

function messageOf(err) {
  return (err && err.message) || String(err)
}

function readJson(path) {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    return { present: false, reason: messageOf(err) }
  }
  try {
    return { present: true, value: JSON.parse(raw) }
  } catch (err) {
    return { present: true, reason: `not valid JSON: ${messageOf(err)}` }
  }
}

/**
 * Resolve an executable the way a shell would, by scanning PATH. Deliberately
 * not `which`/`where`: shelling out to find out whether we can shell out is a
 * probe that fails for the reason it is testing for.
 */
export function whichSync(name, env = process.env) {
  if (typeof name !== 'string' || !name) return null
  if (name.includes('/') || name.includes('\\')) {
    const abs = isAbsolute(name) ? name : resolve(name)
    return isExecutable(abs) ? abs : null
  }
  const pathVar = typeof env.PATH === 'string' ? env.PATH : typeof env.Path === 'string' ? env.Path : ''
  const sep = platform() === 'win32' ? ';' : ':'
  const exts =
    platform() === 'win32'
      ? (typeof env.PATHEXT === 'string' ? env.PATHEXT : '.COM;.EXE;.BAT;.CMD').split(';')
      : ['']
  for (const dir of pathVar.split(sep)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, name + ext)
      if (isExecutable(candidate)) return candidate
    }
  }
  return null
}

function isExecutable(path) {
  try {
    if (!statSync(path).isFile()) return false
  } catch {
    return false
  }
  if (platform() === 'win32') return true
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Best-effort version string. Always non-gating: presence is what decides, a
 * version is what the report says out loud. Follows `gitLastCommit`'s
 * precedent in lib/drift.mjs — every failure mode collapses to `null`.
 */
function probeVersion(bin, args = ['--version']) {
  try {
    const out = execFileSync(bin, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000
    })
    return out.trim().split('\n')[0].trim() || null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Permission rules
// ---------------------------------------------------------------------------

/**
 * Parse one Claude Code permission rule into something matchable.
 *
 * Both spellings in the wild are handled: the current `Bash(git status:*)`
 * colon form and the older `Bash(git *)` glob form this repository's own skill
 * frontmatter still uses. A bare `Bash` and `Bash(*)` both mean "any command".
 *
 * @returns {{ tool: string, tokens: string[], open: boolean, rule: string }|null}
 */
export function parseRule(rule) {
  if (typeof rule !== 'string' || !rule.trim()) return null
  const text = rule.trim()
  const paren = /^([A-Za-z_][\w-]*)\((.*)\)$/s.exec(text)
  if (!paren) {
    // A bare tool name permits the whole tool.
    if (/^[A-Za-z_][\w-]*$/.test(text)) return { tool: text, tokens: [], open: true, rule: text }
    return null
  }
  const tool = paren[1]
  let arg = paren[2].trim()
  let open = false
  if (arg === '' || arg === '*') return { tool, tokens: [], open: true, rule: text }
  if (arg.endsWith(':*')) {
    arg = arg.slice(0, -2).trim()
    open = true
  } else if (arg.endsWith('*')) {
    // `git *` and `git*` alike: the trailing star is the open-ended marker.
    arg = arg.slice(0, -1).trim()
    open = true
  }
  const tokens = arg.split(/\s+/).filter(Boolean)
  if (!tokens.length) return { tool, tokens: [], open: true, rule: text }
  return { tool, tokens, open, rule: text }
}

/**
 * Does `rule` permit every invocation `req` describes?
 *
 * Prefix semantics, and deliberately strict in one direction: a rule NARROWER
 * than the requirement (`Bash(interlock waves:*)` against a requirement for
 * `interlock`) does not cover it, because the loop calls thirty other
 * subcommands. Reporting that as coverage would produce the exact green report
 * this module exists to prevent.
 */
export function ruleCovers(rule, req) {
  if (!rule || rule.tool !== 'Bash') return false
  if (rule.tokens.length > req.tokens.length) return false
  for (let i = 0; i < rule.tokens.length; i++) {
    if (rule.tokens[i] !== '*' && rule.tokens[i] !== req.tokens[i]) return false
  }
  if (rule.tokens.length < req.tokens.length) return rule.open
  return rule.open || !req.open
}

/**
 * Could `rule` ever fire on some invocation of `req`? Used for deny and ask,
 * where a rule that matches only *part* of what the requirement covers is still
 * a mid-run stop. Overlap in either direction counts: `Bash(git push:*)` denies
 * something the `git` requirement includes even though it covers far less.
 */
export function ruleOverlaps(rule, req) {
  if (!rule || rule.tool !== 'Bash') return false
  const shared = Math.min(rule.tokens.length, req.tokens.length)
  for (let i = 0; i < shared; i++) {
    if (rule.tokens[i] !== '*' && rule.tokens[i] !== req.tokens[i]) return false
  }
  if (rule.tokens.length > req.tokens.length) return req.open
  return true
}

/** Read every settings file and collect the permission rules, with provenance. */
function collectPermissions(root, { home, sources } = {}) {
  const files = sources || settingsSources(root, home)
  const rules = { allow: [], deny: [], ask: [] }
  const read = []
  let defaultMode = null

  for (const source of files) {
    if (!existsSync(source.path)) {
      read.push({ ...source, present: false })
      continue
    }
    const parsed = readJson(source.path)
    if (!parsed.value) {
      read.push({ ...source, present: true, error: parsed.reason || 'unreadable' })
      continue
    }
    read.push({ ...source, present: true })
    const permissions =
      parsed.value.permissions && typeof parsed.value.permissions === 'object'
        ? parsed.value.permissions
        : {}
    if (typeof permissions.defaultMode === 'string') defaultMode = permissions.defaultMode
    for (const kind of ['allow', 'deny', 'ask']) {
      const list = Array.isArray(permissions[kind]) ? permissions[kind] : []
      for (const entry of list) {
        const rule = parseRule(entry)
        if (rule) rules[kind].push({ ...rule, scope: source.scope })
      }
    }
  }
  return { rules, read, defaultMode }
}

/**
 * Commands the *project's* test setup adds to the required set. Derived from
 * `.claude/testing/profile.json` rather than guessed: the whole reason that file
 * exists is that "how do I run the tests here" is not inferable.
 *
 * A command is truncated at its first `<placeholder>` — `node --test <path>`
 * requires a rule covering `node --test`, and the path is the argument the rule
 * has to leave open.
 */
export function profileCommands(profile) {
  const out = []
  const add = (raw, why) => {
    if (typeof raw !== 'string' || !raw.trim()) return
    const tokens = []
    for (const token of raw.trim().split(/\s+/)) {
      if (token.startsWith('<')) break
      tokens.push(token)
    }
    if (!tokens.length) return
    const key = tokens.join(' ')
    if (out.some(c => c.tokens.join(' ') === key)) return
    out.push({ tokens, open: true, why })
  }
  if (!profile || typeof profile !== 'object') return out
  for (const [kind, label] of [['unit', 'unit suite'], ['e2e', 'e2e suite']]) {
    const section = profile[kind]
    if (!section || typeof section !== 'object') continue
    add(section.command, `${label} (test profile)`)
    add(section.single_file, `${label}, single file (test profile)`)
  }
  return out
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function check(id, status, detail, extra = {}) {
  return { id, status, detail, evidence: [], ...extra }
}

function checkNode(pluginRoot, nodeVersion) {
  const pkg = readJson(join(pluginRoot, 'package.json'))
  const declared =
    pkg.value && pkg.value.engines && typeof pkg.value.engines.node === 'string'
      ? pkg.value.engines.node
      : null
  const floor = declared ? Number((/(\d+)/.exec(declared) || [])[1]) : 18
  const parts = String(nodeVersion).replace(/^v/, '').split('.').map(Number)
  const [major, minor, patch] = [parts[0] || 0, parts[1] || 0, parts[2] || 0]

  if (!Number.isFinite(major) || major === 0) {
    return check('node', 'fail', `could not read a Node version from "${nodeVersion}"`, {
      fix: 'Install Node.js 20.19.0 or newer.'
    })
  }
  if (major < floor) {
    return check('node', 'fail', `Node ${nodeVersion} is below the plugin floor (engines.node ${declared || '>=18'})`, {
      evidence: [`plugin engines.node: ${declared || '(unset, assuming >=18)'}`],
      fix: `Install Node.js ${floor}+ (20.19.0+ to also satisfy the OpenSpec CLI).`
    })
  }
  // OpenSpec's own floor is higher than Interlock's, and a run that satisfies
  // only Interlock's dies inside `openspec`, not here — so it is said here.
  if (major < 20 || (major === 20 && minor < 19)) {
    return check('node', 'warn', `Node ${nodeVersion} satisfies Interlock (${declared || '>=18'}) but is below the OpenSpec CLI's 20.19.0`, {
      fix: 'Install Node.js 20.19.0+ if you use `openspec` from this shell.'
    })
  }
  return check('node', 'ok', `Node ${nodeVersion} (plugin requires ${declared || '>=18'}, OpenSpec requires 20.19.0+)`, {
    evidence: [`patch level ${major}.${minor}.${patch}`]
  })
}

/**
 * The installed plugin, not the checkout you happen to be standing in. A
 * missing workflow or agent definition is the canonical mid-run halt: ship
 * spawns `interlock:worker` by id, and an id that does not resolve fails on the
 * first lane, after the planner has already run.
 */
function checkPlugin(pluginRoot) {
  const manifest = readJson(join(pluginRoot, '.claude-plugin', 'plugin.json'))
  const required = [
    'workflows/ship.js',
    'agents/worker.md',
    'agents/ping.md',
    'bin/interlock',
    'bin/interlock-graph'
  ]
  const missing = required.filter(rel => !existsSync(join(pluginRoot, rel)))
  const evidence = [`plugin root: ${pluginRoot}`]

  if (!manifest.value) {
    return check('plugin', 'fail', `.claude-plugin/plugin.json is ${manifest.present ? manifest.reason : 'missing'}`, {
      evidence,
      fix: 'Reinstall the plugin: /plugin marketplace add renzrollon/interlock, then /plugin install interlock.'
    })
  }
  evidence.push(`version ${manifest.value.version || '(unset)'}`)
  if (missing.length) {
    return check('plugin', 'fail', `the installed plugin is missing ${missing.length} file(s) the run needs`, {
      evidence: [...evidence, ...missing.map(m => `missing: ${m}`)],
      fix: 'Reinstall the plugin — a partial install halts on the wave it first needs the missing file.'
    })
  }
  if (typeof manifest.value.workflows !== 'string') {
    return check('plugin', 'fail', 'plugin.json declares no "workflows" directory, so /interlock:ship has no workflow to launch', {
      evidence,
      fix: 'Add "workflows": "./workflows" to .claude-plugin/plugin.json.'
    })
  }
  return check('plugin', 'ok', `plugin ${manifest.value.version || '(unversioned)'} complete: workflow, both agent types, both binaries`, {
    evidence
  })
}

/**
 * `interlock` and `interlock-graph` are on PATH inside a Claude Code session
 * because the host injects the plugin's `bin/`. Outside one they are not, and
 * that is not a fault — so an absence resolves to `warn` with the reason, never
 * to a failure that would make this command unusable from a plain shell.
 */
function checkBinaries(pluginRoot, env) {
  const found = []
  const absent = []
  for (const name of ['interlock', 'interlock-graph']) {
    const bin = whichSync(name, env)
    if (bin) found.push(`${name} → ${bin}`)
    else absent.push(name)
  }
  if (!absent.length) {
    return check('binaries', 'ok', 'interlock and interlock-graph resolve on PATH', { evidence: found })
  }
  const bundled = absent.filter(name => existsSync(join(pluginRoot, 'bin', name)))
  if (bundled.length === absent.length) {
    return check('binaries', 'warn', `${absent.join(', ')} not on PATH — present in the plugin's bin/, which Claude Code injects inside a session`, {
      evidence: [...found, ...bundled.map(n => `bundled: ${join(pluginRoot, 'bin', n)}`)],
      fix: `Nothing to do for a run inside Claude Code. For a plain shell: export PATH="${join(pluginRoot, 'bin')}:$PATH"`
    })
  }
  return check('binaries', 'fail', `${absent.join(', ')} resolve neither on PATH nor in the plugin's bin/`, {
    evidence: found,
    fix: 'Reinstall the plugin.'
  })
}

function checkOpenSpec(root, env, probe) {
  const bin = whichSync('openspec', env)
  const configured = existsSync(join(root, 'openspec', 'config.yaml'))
  const changesDir = existsSync(join(root, 'openspec', 'changes'))

  if (bin) {
    const version = probe(bin)
    const evidence = [`openspec → ${bin}`, version ? `version ${version}` : 'version probe returned nothing']
    if (!configured) {
      return check('openspec', 'warn', 'the openspec CLI is installed, but this project has no openspec/config.yaml', {
        evidence,
        fix: 'Run `openspec init` in the project root, or /interlock:bootstrap for a brownfield repo.'
      })
    }
    return check('openspec', 'ok', `openspec CLI available and this project is initialised${changesDir ? '' : ' (no changes/ yet)'}`, { evidence })
  }

  // No CLI. Whether that stops you depends on which half of the flow you use:
  // `ship` reads change artifacts off disk through lib/artifacts.mjs and never
  // shells out, while `spec` and `bootstrap` cannot run without it.
  if (configured) {
    return check('openspec', 'warn', 'the openspec CLI is not on PATH; ship reads artifacts from disk, but /interlock:spec and /interlock:bootstrap need it', {
      evidence: ['openspec/config.yaml is present, so existing changes are still readable'],
      fix: 'npm install -g openspec (requires Node 20.19.0+).'
    })
  }
  return check('openspec', 'fail', 'no openspec CLI on PATH and no openspec/ project in this repo — neither authoring nor shipping a change can start', {
    fix: 'npm install -g openspec && openspec init'
  })
}

function checkGit(root, env, probe) {
  const bin = whichSync('git', env)
  if (!bin) {
    return check('git', 'fail', 'git is not on PATH; review diffs and the commit stage both shell out to it', {
      fix: 'Install git.'
    })
  }
  const version = probe(bin)
  let insideWorkTree = false
  try {
    insideWorkTree =
      execFileSync(bin, ['rev-parse', '--is-inside-work-tree'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000
      }).trim() === 'true'
  } catch {
    insideWorkTree = false
  }
  if (!insideWorkTree) {
    return check('git', 'fail', `${root} is not inside a git work tree, so the run has nothing to diff or commit`, {
      evidence: [version || `git → ${bin}`],
      fix: 'Run from a git repository, or `git init` this directory.'
    })
  }
  return check('git', 'ok', `${version || 'git'} in a work tree`, { evidence: [`git → ${bin}`] })
}

function checkTestProfile(root) {
  const path = join(root, TEST_PROFILE_PATH)
  if (!existsSync(path)) {
    return check('test-profile', 'fail', `${TEST_PROFILE_PATH} is missing, so verification has no command to run and continuity refuses to start`, {
      fix: 'Run /interlock:fix-tests once to discover and persist the project test setup.'
    })
  }
  const parsed = readJson(path)
  if (!parsed.value) {
    return check('test-profile', 'fail', `${TEST_PROFILE_PATH} is ${parsed.reason}`, {
      fix: 'Delete it and re-run /interlock:fix-tests, or repair the JSON by hand.'
    })
  }
  const unit = parsed.value.unit && typeof parsed.value.unit === 'object' ? parsed.value.unit : null
  const command = unit && typeof unit.command === 'string' ? unit.command.trim() : ''
  if (!command) {
    return check('test-profile', 'fail', `${TEST_PROFILE_PATH} declares no unit.command; \`verify plan\` will emit no unit step and the commit gate has nothing to judge`, {
      fix: 'Add a "unit": { "command": "..." } section, or re-run /interlock:fix-tests.'
    })
  }
  return check('test-profile', 'ok', `unit suite: ${command}`, {
    evidence: [parsed.value.e2e ? 'e2e configured' : 'no e2e configured'],
    profile: parsed.value
  })
}

/**
 * The check this command was worth writing for on its own. Since the
 * reconstructability gate landed, a trajectory append that fails exits 1 —
 * so a read-only or otherwise unwritable `.claude/` no longer degrades the run,
 * it ends it. Cheap to detect here; expensive to discover on wave three.
 *
 * Probes by writing into a directory that already exists and removing the file
 * again. A directory that does not exist yet is judged by the writability of
 * its nearest existing ancestor, because that is what `mkdirSync(recursive)`
 * will need — nothing is created here.
 */
function checkStateDirs(root) {
  const blocked = []
  const evidence = []
  for (const dir of STATE_DIRS) {
    const abs = join(root, dir.path)
    let reason = null
    if (existsSync(abs)) {
      const probe = join(abs, `.interlock-doctor-${process.pid}.tmp`)
      try {
        writeFileSync(probe, '')
        rmSync(probe, { force: true })
        evidence.push(`${dir.path}: writable`)
      } catch (err) {
        reason = messageOf(err)
      }
    } else {
      let ancestor = dirname(abs)
      while (ancestor && !existsSync(ancestor) && ancestor !== dirname(ancestor)) ancestor = dirname(ancestor)
      try {
        accessSync(ancestor, constants.W_OK)
        evidence.push(`${dir.path}: absent, creatable under ${ancestor}`)
      } catch (err) {
        reason = `cannot be created under ${ancestor}: ${messageOf(err)}`
      }
    }
    if (reason) blocked.push({ ...dir, reason })
  }

  if (!blocked.length) {
    return check('state-dirs', 'ok', 'every run-state directory is writable or creatable', { evidence })
  }

  const lines = blocked.map(b => `${b.path}: ${b.reason} — ${b.why}`)
  const fatal = blocked.filter(b => b.fatal)
  if (!fatal.length) {
    // Bookkeeping only. The modules behind these two say so themselves, and a
    // preflight that failed the run over a lost metrics line would be applying
    // a rule the runtime does not.
    return check('state-dirs', 'warn', `${blocked.length} bookkeeping director${blocked.length === 1 ? 'y is' : 'ies are'} not writable; the run continues without them`, {
      evidence: lines,
      fix: 'Make .claude/ writable to keep the outcome corpus and review metrics.'
    })
  }
  return check('state-dirs', 'fail', `${fatal.length} run-state director${fatal.length === 1 ? 'y is' : 'ies are'} not writable, and losing ${fatal.length === 1 ? 'it' : 'them'} ends the run`, {
    evidence: lines,
    fix: 'Make .claude/ writable, or run from a checkout that is not read-only. A failed trajectory append exits 1 mid-run.'
  })
}

/**
 * The allowlist preflight. A required command with no covering rule is a `fail`,
 * not a warning: an approval prompt in the middle of a zero-touch run is not a
 * degraded run, it is a stopped one, and there is no human watching by
 * construction.
 */
function checkPermissions(root, required, { home, sources } = {}) {
  const { rules, read, defaultMode } = collectPermissions(root, { home, sources })
  const unreadable = read.filter(f => f.error)
  const evidence = read.filter(f => f.present && !f.error).map(f => `${f.scope}: ${f.path}`)
  for (const f of unreadable) evidence.push(`${f.scope}: ${f.path} — ${f.error}`)

  const denied = []
  const asked = []
  const uncovered = []
  for (const req of required) {
    const name = req.tokens.join(' ')
    const deny = rules.deny.filter(r => ruleOverlaps(r, req))
    if (deny.length) {
      denied.push(`${name}: denied by ${deny.map(d => `${d.rule} (${d.scope})`).join(', ')}`)
      continue
    }
    const covering = rules.allow.filter(r => ruleCovers(r, req))
    if (covering.length) {
      const ask = rules.ask.filter(r => ruleOverlaps(r, req))
      if (ask.length) asked.push(`${name}: ${ask.map(a => `${a.rule} (${a.scope})`).join(', ')} prompts`)
      continue
    }
    // Say *why* it is uncovered. "You have a rule, it is just too narrow" and
    // "you have no rule at all" are different mistakes with different fixes.
    const narrower = rules.allow.filter(r => r.tool === 'Bash' && ruleOverlaps(r, req))
    uncovered.push({
      command: name,
      why: req.why,
      suggestion: `Bash(${name}:*)`,
      narrower: narrower.map(r => `${r.rule} (${r.scope})`)
    })
  }

  if (defaultMode === 'bypassPermissions') {
    return check('permissions', 'warn', 'permissions.defaultMode is "bypassPermissions": nothing will prompt, and nothing is checked', {
      evidence: [
        ...evidence,
        ...uncovered.map(u => `would otherwise be uncovered: ${u.command}`)
      ],
      fix: 'Intentional for a sandboxed run. Set an explicit allowlist if this repo is not disposable.'
    })
  }

  if (denied.length) {
    return check('permissions', 'fail', `${denied.length} required command(s) are denied outright; the run cannot proceed past them`, {
      evidence: [...evidence, ...denied],
      fix: 'Remove the deny rule, or accept that this repo cannot run ship unattended.'
    })
  }

  if (uncovered.length) {
    const lines = uncovered.map(u =>
      `${u.command} — ${u.why}` + (u.narrower.length ? ` (found only narrower: ${u.narrower.join(', ')})` : '')
    )
    return check('permissions', 'fail', `${uncovered.length} command(s) the run shells out to have no allow rule; each one stops the run on an approval prompt`, {
      evidence: [...evidence, ...lines],
      uncovered,
      fix:
        `Add to ${join('.claude', 'settings.json')} → permissions.allow:\n` +
        uncovered.map(u => `        "${u.suggestion}"`).join(',\n')
    })
  }

  if (unreadable.length) {
    return check('permissions', 'warn', `every required command is allowed, but ${unreadable.length} settings file(s) could not be read`, {
      evidence,
      fix: 'Repair the JSON: Claude Code ignores a settings file it cannot parse, so its rules are not in effect.'
    })
  }

  const status = asked.length ? 'warn' : 'ok'
  return check(
    'permissions',
    status,
    asked.length
      ? `every required command is allowed, but ${asked.length} also match an "ask" rule that will prompt`
      : `all ${required.length} required commands are allowed`,
    {
      evidence: [...evidence, ...asked, ...required.map(r => `${r.tokens.join(' ')} — ${r.why}`)],
      fix: asked.length ? 'Remove the ask rule, or expect a prompt mid-run.' : undefined
    }
  )
}

/**
 * Advice, never a gate: push notification is an optional feature, so this row
 * is `ok` or `skip` and NEVER `fail` — an operator who never configured it has
 * not degraded their run. Reads the same two environment variable NAMES
 * `lib/notify.mjs` reads (`INTERLOCK_NTFY_TOPIC`, `INTERLOCK_NTFY_URL`) by
 * literal string rather than by importing that module: this file has no
 * other reason to depend on the network transport, and the two spellings are
 * pinned identically in both modules' own test suites. The topic value is
 * never read into a string that could reach the report; only the server URL,
 * which is not a capability, is echoed.
 */
function checkNotify(env) {
  try {
    const topic = env && typeof env.INTERLOCK_NTFY_TOPIC === 'string' ? env.INTERLOCK_NTFY_TOPIC.trim() : ''
    if (!topic) {
      return check(
        'notify',
        'skip',
        'INTERLOCK_NTFY_TOPIC is not set — optional; an unattended run that stops will not reach you'
      )
    }
    const url =
      env && typeof env.INTERLOCK_NTFY_URL === 'string' && env.INTERLOCK_NTFY_URL.trim()
        ? env.INTERLOCK_NTFY_URL.trim()
        : 'https://ntfy.sh'
    return check('notify', 'ok', `push configured: ${url}`)
  } catch (err) {
    // Fail-open, and never `fail`: an unreadable env is a reason to skip the
    // advice, not a reason to block a run that never asked for it.
    return check('notify', 'skip', `the notify check could not run: ${messageOf(err)}`)
  }
}

// ---------------------------------------------------------------------------
// Instructed-command extraction — the drift test's own probe
// ---------------------------------------------------------------------------

/**
 * Backticked spans that satisfy the shape test below — a bare lowercase word
 * with a space, flag or path somewhere in it — but name a field, a
 * placeholder or other non-command text rather than something a shell runs.
 * Checked explicitly, by exact span text, rather than filtered by a broader
 * heuristic: a heuristic clever enough to know "not a command" without being
 * told would also be clever enough to hide a real one. Empty today — every
 * span currently found in `workflows/ship.js` and `lib/prompts/*.mjs` is
 * either a real command or excluded by the shape test itself (a bare
 * `` `group` `` has no space) — but the list is exported and pinned so the
 * next false positive is named here instead of the shape test being loosened
 * to let it through.
 */
export const IGNORED_INSTRUCTION_SPANS = Object.freeze([])

const SHELL_SEPARATORS = /(?:&&|\|\||[;|])/

/**
 * Reduce one shell fragment to the program name a permission rule would have
 * to permit: strip a leading `VAR=value` environment assignment (repeatable —
 * `A=1 B=2 cmd` is legal shell), a leading `$(` command-substitution opener
 * and a leading quote character — in whatever order they actually nest —
 * then take the token up to the next whitespace and drop a trailing quote or
 * closing paren that rode along with it.
 */
function firstToken(fragment) {
  let s = fragment.trim()
  for (;;) {
    const before = s
    s = s.replace(/^\$\(/, '')
    s = s.replace(/^["'`]/, '')
    s = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, '')
    s = s.trim()
    if (s === before) break
  }
  const m = /^(\S+)/.exec(s)
  if (!m) return ''
  return m[1].replace(/["')]+$/, '')
}

/** Split one instructed line on the shell's own separators and take each subcommand's program name. */
function subcommands(text) {
  return text
    .split(SHELL_SEPARATORS)
    .map(part => firstToken(part))
    .filter(Boolean)
}

/**
 * Every shell command a driver or a briefing literally instructs an agent to
 * run, derived from the raw source text rather than assumed. Two independent
 * sources, because the driver text mixes both styles:
 *
 *   1. Every `Run:` / `Then run:` line — the environment probe's own
 *      convention (`workflows/ship.js:368-382`) for a literal shell command,
 *      taken up to the line's embedded `\n` marker (two characters in the
 *      raw source: a backslash and an `n`, not an actual newline) or to the
 *      end of the line if no marker is present.
 *   2. Every markdown-style inline code span in the assembled prompt — an
 *      ESCAPED backtick pair (two characters, a backslash and a backtick, on
 *      each side) in the JS source. An UNESCAPED backtick there is a
 *      template-literal delimiter, not a code span, and matching it produces
 *      exactly the false-positive flood this function exists to avoid. A
 *      span counts only when its first word matches `/^[a-z][a-z0-9-]*$/`
 *      AND the span also carries a space, a `-` flag or a `/` path — the
 *      shape of an invocation rather than a bare field name like `` `group` ``
 *      or `` `paths` `` — and it is not listed in `IGNORED_INSTRUCTION_SPANS`.
 *
 * Both sources are then split on `&&`, `||`, `;` and `|` and reduced to each
 * subcommand's program name by `firstToken`.
 *
 * @param {string} text raw source text (a whole file, or a synthetic fixture)
 * @returns {string[]} deduplicated program names, in first-seen order
 */
export function extractInstructedCommands(text) {
  if (typeof text !== 'string') return []
  const found = new Set()

  for (const line of text.split(/\r?\n/)) {
    const m = /(?:Run|Then run):\s*(.*)/.exec(line)
    if (!m) continue
    let body = m[1]
    const nl = body.indexOf('\\n')
    if (nl !== -1) body = body.slice(0, nl)
    for (const cmd of subcommands(body)) found.add(cmd)
  }

  const spanRe = /\\`([^`]*?)\\`/g
  let sm
  while ((sm = spanRe.exec(text))) {
    const span = sm[1]
    if (IGNORED_INSTRUCTION_SPANS.includes(span)) continue
    const first = span.split(/\s+/)[0] || ''
    if (!/^[a-z][a-z0-9-]*$/.test(first)) continue
    const hasSpace = /\s/.test(span)
    const hasFlag = /(^|\s)-/.test(span)
    const hasPath = span.includes('/')
    if (!hasSpace && !hasFlag && !hasPath) continue
    for (const cmd of subcommands(span)) found.add(cmd)
  }

  return [...found]
}

// ---------------------------------------------------------------------------
// Eval prerequisites
// ---------------------------------------------------------------------------

/**
 * The early-access flag that enables the eval harness, and the credentials a
 * model run can use. Both are read for PRESENCE ONLY — never for value. This
 * report is written to disk and pasted into issues, and a preflight that echoed
 * a key into either surface would be a credential leak with a helpful UI.
 */
export const EVAL_ENABLEMENT_VAR = 'CLAUDE_CODE_WALNUT_SPIRE'
export const EVAL_CREDENTIAL_VARS = Object.freeze(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'])

/** Is a variable set to something meaningful? Its value never leaves this function. */
function isSet(env, name) {
  const raw = env && typeof env[name] === 'string' ? env[name].trim() : ''
  return Boolean(raw) && raw !== '0' && raw.toLowerCase() !== 'false'
}

/** Does an eval suite — at least one case directory — exist at the plugin root? */
function hasEvalSuite(pluginRoot) {
  const dir = join(pluginRoot, 'evals')
  if (!existsSync(dir)) return false
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const caseDir = join(dir, entry.name)
    if (existsSync(join(caseDir, 'case.yaml')) || existsSync(join(caseDir, 'prompt.md'))) return true
  }
  return false
}

/**
 * Two rows about running the eval suite — and never a reason not to run.
 *
 * NEITHER ROW MAY EVER BE `fail`, and that is the whole design of this
 * function. Neither prerequisite stops a ship run: a repository ships changes
 * without ever running an eval, so a preflight that failed on them would block
 * unattended work over a capability the run does not use. `skip` with a reason
 * is what "we chose not to look / it is not here" means in this module's
 * vocabulary, and it leaves the exit status alone.
 *
 * It is also NOT wrapped in `diagnose`'s `run()` helper, deliberately: that
 * wrapper turns a thrown probe into a `fail` row, which is exactly the verdict
 * this check may not produce. It catches its own errors and degrades to `skip`
 * — the same fail-open rule the runtime guards follow, stated for a preflight.
 * A check that failed whenever it could not establish its own answer would
 * block precisely the hosts it was least able to inspect.
 *
 * The rows are omitted entirely when no suite exists: a repository with no
 * cases has no prerequisite, and two permanent `skip` rows on every consumer's
 * preflight would be noise.
 *
 * @param {string} pluginRoot the installed plugin, where the suite lives
 * @param {object} env environment read for presence only
 * @returns {object[]} zero or two checks
 */
export function evalPrerequisiteChecks(pluginRoot, env = process.env) {
  try {
    if (!hasEvalSuite(pluginRoot)) return []

    const enabled = isSet(env, EVAL_ENABLEMENT_VAR)
    const credential = EVAL_CREDENTIAL_VARS.find(name => isSet(env, name)) || null

    return [
      enabled
        ? check('evals-harness', 'ok', `${EVAL_ENABLEMENT_VAR} is set, so \`claude plugin eval\` is enabled`)
        : check(
            'evals-harness',
            'skip',
            `${EVAL_ENABLEMENT_VAR} is not set, so the eval harness is unavailable — no ship run needs it`,
            { fix: `export ${EVAL_ENABLEMENT_VAR}=1 to run \`claude plugin eval\`. Nothing else changes.` }
          ),
      credential
        ? // The NAME of the variable, never its value. Reporting which one is
          // set is what makes the row actionable; reporting what it holds would
          // put a key in a file people attach to issues.
          check('evals-credential', 'ok', `a model credential is present (${credential} is set)`)
        : check(
            'evals-credential',
            'skip',
            `no model credential is set, so an eval run has nothing to call — no ship run needs one`,
            { fix: `Set one of ${EVAL_CREDENTIAL_VARS.join(' or ')} to run the eval suite.` }
          )
    ]
  } catch (err) {
    // The fail-open path, and the reason this function owns its own try/catch.
    return [
      check('evals-harness', 'skip', `the eval prerequisite check could not run: ${messageOf(err)}`),
      check('evals-credential', 'skip', `the eval prerequisite check could not run: ${messageOf(err)}`)
    ]
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * Run every preflight check and report. Never throws: a probe that blows up
 * becomes a failed check with the error as its detail, because a doctor whose
 * own crash is the output is worse than no doctor.
 *
 * @param {string} [root]                   project root (default cwd)
 * @param {object} [opts]
 * @param {string} [opts.pluginRoot]        installed plugin location; defaults to this checkout
 * @param {object} [opts.env]               environment PATH is read from
 * @param {string} [opts.home]              home directory user settings are read from
 * @param {string} [opts.nodeVersion]       overrides process.version, for tests
 * @param {(bin: string) => string|null} [opts.probeVersion]  version probe; injected in tests
 * @param {Array<{scope:string,path:string}>} [opts.settingsSources]  overrides the merge list
 * @returns {object} report
 */
export function diagnose(root = '.', opts = {}) {
  const projectRoot = resolve(root)
  const pluginRoot = opts.pluginRoot ? resolve(opts.pluginRoot) : PLUGIN_ROOT
  const env = opts.env || process.env
  const probe = typeof opts.probeVersion === 'function' ? opts.probeVersion : probeVersion

  const run = (id, fn) => {
    try {
      return fn()
    } catch (err) {
      return check(id, 'fail', `check could not run: ${messageOf(err)}`, {
        fix: 'This is a bug in `interlock doctor`; the underlying condition is unknown, which is not a pass.'
      })
    }
  }

  const checks = []
  checks.push(run('node', () => checkNode(pluginRoot, opts.nodeVersion || process.version)))
  checks.push(run('plugin', () => checkPlugin(pluginRoot)))
  checks.push(run('binaries', () => checkBinaries(pluginRoot, env)))
  checks.push(run('openspec', () => checkOpenSpec(projectRoot, env, probe)))
  checks.push(run('git', () => checkGit(projectRoot, env, probe)))

  const profileCheck = run('test-profile', () => checkTestProfile(projectRoot))
  const profile = profileCheck.profile
  delete profileCheck.profile
  checks.push(profileCheck)

  // The required-command set is derived, never assumed: the static four, plus
  // whatever the project's own test profile says it runs. A repo whose suite is
  // `pnpm vitest run` needs that allowlisted, and no hardcoded list knows it.
  const required = [...REQUIRED_COMMANDS, ...profileCommands(profile)]
  checks.push(
    run('permissions', () =>
      checkPermissions(projectRoot, required, { home: opts.home, sources: opts.settingsSources })
    )
  )
  checks.push(run('state-dirs', () => checkStateDirs(projectRoot)))

  // Not behind `run()`: that wrapper's thrown-probe verdict is `fail`, and
  // this row may never carry one — push is optional, so `checkNotify` owns
  // its own try/catch and degrades to `skip`. Same reasoning as the eval
  // prerequisite rows just below.
  checks.push(checkNotify(env))

  // Not behind `run()`: that wrapper's thrown-probe verdict is `fail`, and
  // these rows may never carry one. See `evalPrerequisiteChecks`.
  checks.push(...evalPrerequisiteChecks(pluginRoot, env))

  const counts = { ok: 0, warn: 0, fail: 0, skip: 0 }
  for (const c of checks) counts[c.status] = (counts[c.status] || 0) + 1

  return {
    ok: counts.fail === 0,
    root: projectRoot,
    pluginRoot,
    counts,
    checks,
    failures: checks.filter(c => c.status === 'fail').map(c => c.id),
    warnings: checks.filter(c => c.status === 'warn').map(c => c.id),
    requiredCommands: required.map(r => ({ command: r.tokens.join(' '), why: r.why }))
  }
}

/** Human-readable preflight, in the shape `interlock ready` already prints. */
export function formatDoctor(report) {
  const lines = []
  lines.push(
    report.ok
      ? `PREFLIGHT OK — ${report.counts.ok} passed` +
        (report.counts.warn ? `, ${report.counts.warn} warning(s)` : '')
      : `PREFLIGHT BLOCKED — ${report.counts.fail} check(s) would stop a zero-touch run` +
        (report.counts.warn ? `, ${report.counts.warn} warning(s)` : '')
  )
  lines.push(`  root: ${report.root}`)
  if (report.pluginRoot !== report.root) lines.push(`  plugin: ${report.pluginRoot}`)
  for (const c of report.checks) {
    lines.push(`  [${STATUS_MARK[c.status] || c.status}] ${c.id}: ${c.detail}`)
    // Evidence for anything that is not clean; a clean run should be readable
    // in nine lines, not ninety.
    if (SEVERITY[c.status] >= SEVERITY.warn) {
      for (const e of c.evidence || []) lines.push(`         ${e}`)
      if (c.fix) {
        const [first, ...rest] = c.fix.split('\n')
        lines.push(`      fix: ${first}`)
        for (const line of rest) lines.push(`           ${line.trim()}`)
      }
    }
  }
  return lines.join('\n') + '\n'
}
