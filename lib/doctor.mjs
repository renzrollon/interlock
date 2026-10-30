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
// agent definitions ship spawns by id, cli/ — is resolved from this module's own
// location, because that is the copy that will actually run. The *project* —
// settings, openspec artifacts, the test profile, the state directories — is
// resolved from `root`. Conflating them produces the worst kind of green: a
// report that checked the developer's checkout of Interlock while the run used
// the installed one.
//
// ROOT vs STATE HOME. A third place, and the same mistake one level down. From
// a linked worktree the run's append-only corpora go to the main checkout
// (`lib/state-home.mjs`), so the doctor resolves that home once and probes
// each state directory under the home it is actually written to — a read-only
// main checkout is found from the worktree session, not on wave three.
//
// Exposed to skills and to `/interlock:ship` as `interlock doctor [--json]`.

import { execFileSync } from 'node:child_process'
import {
  accessSync,
  constants,
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { cpus, platform } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AGENT_TEAMS_ENV,
  SUBAGENT_MODEL_DEFAULT_ONLY_MIN_VERSION,
  PER_CALL_EFFORT_MIN_VERSION,
  SUBAGENT_MODEL_ENV,
  SUBAGENT_MODEL_FORCE_ENV,
  SUBAGENT_MODEL_FORCE_MIN_VERSION,
  MODS_MIN_HOST_VERSION,
  compareVersions,
  WORKFLOW_MAX_CONCURRENT_ENV,
  WORKFLOW_MAX_CONCURRENT_RANGE,
  claudeCommandArgv,
  observeClaudeEnv,
  parseClaudeVersion,
  readModelRouting
} from './host/claude-env.mjs'
import { advisorDoctor, jsonParseReason, readAdvisorConfig } from './advisor-tool.mjs'
import { RUNTIME } from './limits.mjs'
import { pluginVersionAt } from './version.mjs'
import { profileProblem } from './verify.mjs'
import { DEFAULT_NTFY_URL } from './notify-defaults.mjs'
import { STATE_HOME_ENV, resolveStateHome } from './state-home.mjs'
import { readSettingsSources, settingsSources } from './settings-sources.mjs'
import { OPENSPEC_INSTALL, OPENSPEC_PROVISION, resolveOpenSpec, telemetryOff } from './openspec-cli.mjs'
import { OPENSPEC_PIN } from './openspec-pin.mjs'
import { whichSync } from './which.mjs'

/** The installed copy of the plugin — the one whose workflow and agents run. */
export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Where the test profile lives, mirroring `lib/ready.mjs`. */
export const TEST_PROFILE_PATH = join('.claude', 'testing', 'profile.json')

// The openspec command spellings live in lib/openspec-cli.mjs; re-exported so the
// skills test and every other importer keep resolving them here.
export { OPENSPEC_INSTALL, OPENSPEC_PROVISION, settingsSources, whichSync }

/**
 * The host's two prompt-cache lifetime settings, and the build below which it
 * accepts them and silently does nothing with them.
 *
 * These are facts about Claude Code, not Interlock thresholds, so they are named
 * constants in the module that reads them rather than `interlock limits`
 * material — the convention every `INTERLOCK_*` reader already follows. They are
 * two keys because they govern two different request buckets with two different
 * defaults: setting one leaves the other where it was, and the one that governs
 * a ship run's wave agents is the *subagent* key, not the obvious one.
 *
 * The version floor is load-bearing for the advice. Below it the keys are not
 * rejected — they are ignored, with no error and no effect, which is the worst
 * shape a misconfiguration can take.
 */
export const PROMPT_CACHE_MAIN_KEY = 'promptCacheTtl'
export const PROMPT_CACHE_SUBAGENT_KEY = 'subagentPromptCacheTtl'
export const PROMPT_CACHE_MIN_HOST_VERSION = '2.1.242'

/**
 * The oldest OpenSpec CLI the authoring skills can rely on. 1.7.0 is the first
 * version that syncs nested `specs/<area>/<capability>/spec.md` deltas, but it
 * still validates a change its own archive refuses; 1.8.0 rejects a dropped
 * scenario in both commands, which `/interlock:spec`'s named validate step
 * depends on. A miss is a warn: ship reads artifacts off disk and still works.
 * `docs/01-first-hour.md` names this value, and `test/skills.test.mjs` reads it
 * rather than a restated number.
 */
export const OPENSPEC_MIN_VERSION = '1.8.0'

/**
 * The first OpenSpec CLI that syncs nested deltas on archive; 1.4.0 and 1.6.0
 * read them as "No deltas found" and archive without syncing. It splits the
 * floor-miss warn in two, so a CLI between this and OPENSPEC_MIN_VERSION is
 * told its real fault (validate passes what archive refuses), not one it lacks.
 */
export const OPENSPEC_NESTED_SYNC_VERSION = '1.7.0'

/**
 * State directories a run writes to, each carrying whether losing it ends the
 * run — because the CLI already answers that, differently, per directory, and a
 * preflight that flattened them would fail a run over bookkeeping.
 *
 * `.claude/ship/runs` is fatal since the reconstructability gate landed: a
 * `wave-state` call whose trajectory append fails now exits 1 rather than
 * warning on stderr. `.claude/ship/spill` is fatal for a different reason —
 * `verify spill` has no fallback, and a verify agent that cannot spill an
 * oversized suite log has no legal way to report it. The rest are explicitly
 * never-fatal in their own modules ("losing a corpus line must never fail the
 * run that made it"; metrics "report their own failure and never touch the exit
 * code"), so an unwritable one is a warning here too.
 *
 * Each entry also names its `home`, because from a linked worktree the two are
 * different directories (design D15). `state`: the append-only corpora a report
 * reads across every run the project has had — the trajectory, the outcome
 * corpus, the metrics, the resume cards, the interrupted-run notes — which go to
 * the state home so they outlive a worktree that is deleted when its session is
 * archived. `root`: per-run working state, which stays with the run — the spill,
 * whose locators are root-relative and which `verify spill` writes under the
 * root, and the agent-usage sidecar the SubagentStop recorder keys by run.
 * Probing a directory under the wrong home tests a directory nothing writes to,
 * and misses the one the run will fail on.
 */
export const STATE_DIRS = Object.freeze([
  { path: join('.claude', 'ship', 'runs'), home: 'state', fatal: true, why: 'run trajectory; a failed append exits 1' },
  { path: join('.claude', 'ship', 'spill'), home: 'root', fatal: true, why: 'spilled suite output; no fallback path' },
  { path: join('.claude', 'learning'), home: 'state', fatal: false, why: 'outcome corpus; never fatal at runtime' },
  { path: join('.claude', 'metrics'), home: 'state', fatal: false, why: 'review metrics; never fatal at runtime' },
  {
    path: join('.claude', 'handoff'),
    home: 'state',
    fatal: false,
    why: 'resume cards; outcome-class, a failed write is reported and never fails the run'
  },
  {
    path: join('.claude', 'ship', 'interrupted'),
    home: 'state',
    fatal: false,
    why: 'interrupted-run notes; outcome-class, a failed write is a stderr line from the SessionEnd hook'
  },
  {
    path: join('.claude', 'ship', 'agent-usage'),
    home: 'root',
    fatal: false,
    why: 'per-agent usage sidecar; outcome-class, a failed write is a stderr line from the SubagentStop recorder'
  }
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
    why: 'the bootstrap skill checks for openspec/config.yaml (skills/bootstrap)'
  },
  {
    tokens: ['printenv'],
    open: true,
    why: 'the environment probe reads CLAUDE_CODE_EFFORT_LEVEL'
  },
  { tokens: ['mkdir'], open: true, why: 'the environment probe creates .claude/ship/' }
])

/**
 * Commands Claude Code auto-approves as read-only no matter what the
 * project's own allowlist says, so a briefing that instructs one of these
 * needs no rule of its own and the drift test below must not demand one.
 * Source: the Claude Code permissions documentation, checked
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
    return { present: true, reason: jsonParseReason(err) }
  }
}

/**
 * Best-effort version string. Always non-gating: presence is what decides, a
 * version is what the report says out loud. Follows `gitLastCommit`'s
 * precedent in lib/drift.mjs — every failure mode collapses to `null`.
 */
function probeVersion(bin, args = ['--version'], env) {
  try {
    const out = execFileSync(bin, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      ...(env ? { env } : {})
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

/**
 * Whether the OpenSpec that would run executes on the user's own Node: the
 * provisioned launcher always does, a PATH copy only when it is a script (its file,
 * read at its realpath, begins `#!`; on win32 a `.cmd`/`.bat`/`.ps1` shim). A
 * standalone binary brings its own runtime, so it says nothing about Node.
 */
function openspecRunsOnNode(openspec, osPlatform) {
  if (!openspec || openspec.source === 'none' || !openspec.bin) return false
  if (openspec.source === 'provisioned') return true
  if (osPlatform === 'win32' && /\.(cmd|bat|ps1)$/i.test(openspec.bin)) return true
  try {
    const fd = openSync(realpathSync(openspec.bin), 'r')
    try {
      const buf = Buffer.alloc(2)
      const n = readSync(fd, buf, 0, 2, 0)
      return n === 2 && buf[0] === 0x23 && buf[1] === 0x21
    } finally {
      closeSync(fd)
    }
  } catch {
    return false
  }
}

function checkNode(pluginRoot, nodeVersion, openspec, osPlatform = process.platform) {
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
  // only Interlock's dies inside `openspec`, not here — so it is said here, but only
  // for an OpenSpec that runs on this Node: the provisioned launcher, or a PATH
  // script. With none resolved the openspec row carries the fix; a standalone
  // binary does not use this Node.
  const belowOpenSpec = major < 20 || (major === 20 && minor < 19)
  if (belowOpenSpec && openspecRunsOnNode(openspec, osPlatform)) {
    const which = openspec.source === 'provisioned' ? `the provisioned OpenSpec ${OPENSPEC_PIN.version}` : `the OpenSpec CLI at ${openspec.bin}`
    return check('node', 'warn', `Node ${nodeVersion} satisfies Interlock (${declared || '>=18'}) but is below ${OPENSPEC_PIN.node}, which ${which} needs`, {
      evidence: [`openspec source: ${openspec.source}`, `openspec → ${openspec.bin}`],
      fix: `Install Node.js ${OPENSPEC_PIN.node} or newer; ${which} fails on this Node.`
    })
  }
  if (belowOpenSpec) {
    return check('node', 'ok', `Node ${nodeVersion} (plugin requires ${declared || '>=18'})`, {
      evidence: [`patch level ${major}.${minor}.${patch}`]
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
    'cli/interlock',
    'cli/interlock-graph'
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
 * because the session preflight appends the plugin's `cli/` to it — but not in
 * the SessionStart hook that runs this doctor, nor in a plain shell. A copy in
 * the plugin's `cli/` is a complete install, so it is `ok`: a `warn` here would be drawn
 * above the prompt at every session start for a state nobody has to change.
 * Only a binary found in neither place is a failure.
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
  const bundled = absent.filter(name => existsSync(join(pluginRoot, 'cli', name)))
  if (bundled.length === absent.length) {
    return check('binaries', 'ok', `${absent.join(', ')} run from the plugin's cli/ (${join(pluginRoot, 'cli')}), which the session preflight appends to PATH`, {
      evidence: [...found, ...bundled.map(n => `bundled: ${join(pluginRoot, 'cli', n)}`)]
    })
  }
  return check('binaries', 'fail', `${absent.join(', ')} resolve neither on PATH nor in the plugin's cli/`, {
    evidence: found,
    fix: 'Reinstall the plugin.'
  })
}

/** The package an npm copy of the CLI ships as. */
const CLI_PACKAGE = '@renzrollon/interlock'

const VERSION_PROBE_TIMEOUT_MS = 5000

/**
 * What version the `interlock` at `bin` is. Two ways, in order: the package.json
 * beside a real install (`<real>/../package.json`, named for this package), else
 * ask it with `--version` and read the first `major.minor.patch` on its first
 * line, so a wrapper that prints `interlock 1.8.0` is read too.
 *
 * `{ version: null, reason: null }` is a binary that answered `Unknown command`,
 * which is how 1.7.0 and earlier answer: read as older than any plugin that has
 * this row. Any other failure carries its `reason` (a timeout, a signal, an
 * exit status, or what it printed), because that binary did not say it is old.
 */
export function readCliVersion(bin, real, env) {
  for (const candidate of cliPackageCandidates(real)) {
    const pkg = readJson(candidate)
    if (pkg.value && pkg.value.name === CLI_PACKAGE && typeof pkg.value.version === 'string') {
      return { version: pkg.value.version, npm: true, reason: null }
    }
  }
  try {
    const out = execFileSync(bin, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: VERSION_PROBE_TIMEOUT_MS,
      env: { ...process.env, ...env }
    })
    const first = out.trim().split('\n')[0].trim()
    const m = /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(first)
    if (m) return { version: m[1], npm: false, reason: null }
    return { version: null, npm: false, reason: first ? `it printed ${JSON.stringify(first.slice(0, 40))}` : 'it printed nothing' }
  } catch (err) {
    if (/Unknown command/.test(String((err && err.stderr) || ''))) return { version: null, npm: false, reason: null }
    return { version: null, npm: false, reason: versionProbeFailure(err) }
  }
}

function versionProbeFailure(err) {
  if (err && err.code === 'ETIMEDOUT') return `no answer within ${VERSION_PROBE_TIMEOUT_MS} ms`
  if (err && err.signal) return `killed by ${err.signal}`
  if (err && Number.isInteger(err.status)) return `exit ${err.status}`
  return (err && (err.code || err.message)) || 'it could not be run'
}

/**
 * Where the package.json of the npm copy behind `real` can sit. On POSIX npm
 * links `<prefix>/bin/interlock` to `<prefix>/lib/node_modules/<pkg>/cli/interlock`,
 * so the package is one level above the resolved file's directory. On Windows
 * npm writes `interlock.cmd` and `interlock.ps1` shims straight into the prefix,
 * next to `node_modules/<pkg>`; those resolve to themselves, so the package is
 * found beside the shim instead.
 */
function cliPackageCandidates(real) {
  const dir = dirname(real)
  return [join(dir, '..', 'package.json'), join(dir, 'node_modules', ...CLI_PACKAGE.split('/'), 'package.json')]
}

/**
 * True when `root` is an npm copy of the CLI — the package sits under a
 * `node_modules/@renzrollon/interlock` directory — rather than a plugin
 * checkout. Separator-agnostic, because the same string can arrive from either
 * platform's path rules.
 */
export function isNpmPackageRoot(root) {
  const parts = String(root).split(/[\\/]+/).filter(Boolean)
  const scope = CLI_PACKAGE.split('/')
  for (let i = 0; i + scope.length < parts.length + 0; i++) {
    if (parts[i] === 'node_modules' && scope.every((seg, j) => parts[i + 1 + j] === seg)) return true
  }
  return false
}

function realOf(path) {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/**
 * A plugin root found by walking PATH: the first directory `D` where
 * `D/interlock` exists and `dirname(D)/.claude-plugin/plugin.json` exists, and
 * `dirname(D)` is neither the CLI's own package nor an npm package. This is the
 * `! interlock doctor` case: Claude Code's shell has the plugin's `cli/` on PATH
 * (docs/16-upgrading.md) but does not set CLAUDE_PLUGIN_ROOT, and an npm copy
 * earlier on PATH may shadow it.
 */
function pluginRootOnPath(env, ownRoot) {
  const pathVar = env && typeof env.PATH === 'string' ? env.PATH : env && typeof env.Path === 'string' ? env.Path : ''
  const sep = platform() === 'win32' ? ';' : ':'
  for (const dir of pathVar.split(sep)) {
    if (!dir || !isAbsolute(dir)) continue
    const root = resolve(dirname(resolve(dir)))
    if (root === ownRoot || isNpmPackageRoot(root)) continue
    if (existsSync(join(dir, 'interlock')) && existsSync(join(root, '.claude-plugin', 'plugin.json'))) return root
  }
  return null
}

/**
 * The plugin the `cli-version` row compares the PATH CLI against, and how it was
 * found. In order: the root the caller passed (`opts.pluginRoot`), then
 * `CLAUDE_PLUGIN_ROOT` from the environment (set for a hook or a tool call Claude
 * Code runs from a plugin), then a plugin `cli/` found on PATH, then this
 * module's own package.
 *
 * The last is only a comparison when it is a plugin checkout. An npm copy of the
 * CLI is the CLI itself, not the plugin: an `interlock doctor` run by name from a
 * global install would compare that binary with its own package.json and read
 * `ok` whatever the plugin is. The repo has no reader for Claude Code's own
 * record of installed plugins, and the path format is not something to guess, so
 * with none of the first three there is nothing to compare with.
 *
 * @returns {{ root: string, source: 'option'|'env'|'path'|'own' }}
 */
export function cliComparisonRoot(opts, env, ownRoot) {
  if (opts.pluginRoot) return { root: resolve(opts.pluginRoot), source: 'option' }
  const fromEnv = env && typeof env.CLAUDE_PLUGIN_ROOT === 'string' ? env.CLAUDE_PLUGIN_ROOT.trim() : ''
  if (fromEnv) return { root: resolve(fromEnv), source: 'env' }
  const onPath = pluginRootOnPath(env, ownRoot)
  if (onPath) return { root: onPath, source: 'path' }
  return { root: ownRoot, source: 'own' }
}

/**
 * Which `interlock` the session's PATH serves, against the plugin this doctor
 * belongs to (spec: hooks/session-preflight; design D5). Older, or too old to
 * say, is a `fail`: the preflight draws only failing rows, and an older CLI is
 * the direction that silently drops a review blocker. Newer is a `warn`. A hit
 * that is the plugin's own `cli/` is `ok` whatever it answers.
 *
 * Takes `cliComparisonRoot`'s answer. When it is the CLI's own npm package
 * there is no plugin to compare with, and the row is `skip` and says so rather
 * than comparing a binary with itself.
 */
export function checkCliVersion(comparison, env) {
  const row = compareCliVersion(comparison, env)
  if (comparison.source !== 'path') return row
  return { ...row, evidence: [...row.evidence, `plugin root found on PATH: ${comparison.root}`] }
}

function compareCliVersion({ root: pluginRoot, source }, env) {
  const bin = whichSync('interlock', env)
  if (!bin) {
    return check('cli-version', 'skip', 'interlock is not on PATH; the bundled binary runs', {
      evidence: [`plugin root: ${pluginRoot}`]
    })
  }
  if (source === 'own' && isNpmPackageRoot(pluginRoot)) {
    return check(
      'cli-version',
      'skip',
      `the doctor ran outside a plugin session, so there was no plugin to compare interlock on PATH (${realOf(bin)}) against; the only package found is this CLI's own (${pluginRoot})`,
      {
        evidence: [`interlock → ${realOf(bin)}`, `cli package: ${pluginRoot}`],
        fix: 'Run `interlock doctor` from a Claude Code session with the plugin installed (the session preflight does), or set CLAUDE_PLUGIN_ROOT to the plugin\'s directory.'
      }
    )
  }
  const real = realOf(bin)
  const own = realOf(join(pluginRoot, 'cli', 'interlock'))
  const pluginVersion = pluginVersionAt(pluginRoot)
  if (real === own) {
    return check('cli-version', 'ok', `interlock on PATH is the plugin's own cli/ (${real})`, {
      evidence: [`interlock → ${real}`, `plugin ${pluginVersion || 'unknown'}`]
    })
  }
  if (!pluginVersion || !parseClaudeVersion(pluginVersion)) {
    const declares = pluginVersion
      ? `declares version ${JSON.stringify(pluginVersion)}, which is not major.minor.patch`
      : 'declares no readable version'
    return check('cli-version', 'skip', `the plugin at ${pluginRoot} ${declares}, so interlock on PATH (${real}) has nothing to be compared with`, {
      evidence: [`interlock → ${real}`]
    })
  }
  const read = readCliVersion(bin, real, env)
  const { version, npm } = read
  const order = version ? compareVersions(version, pluginVersion) : null
  const reason = version && order === null ? `it reports ${JSON.stringify(version)}, which is not major.minor.patch` : read.reason
  const fix = npm
    ? `npm i -g ${CLI_PACKAGE}@${pluginVersion}`
    : `Remove ${real} from PATH, or install the plugin's version: npm i -g ${CLI_PACKAGE}@${pluginVersion}`
  const answered = version || `unknown (${reason || 'no version answered'})`
  const evidence = [`interlock → ${real}`, `interlock ${answered}`, `plugin ${pluginVersion}`]
  if (order === null && reason) {
    return check('cli-version', 'fail', `CLI VERSION SKEW: the version of interlock on PATH (${real}) could not be read (${reason}), plugin is ${pluginVersion}`, {
      evidence,
      fix: `Run ${real} --version and read its answer. ${fix}`
    })
  }
  if (order === null) {
    return check('cli-version', 'fail', `CLI VERSION SKEW: interlock on PATH predates version reporting (${real}), plugin is ${pluginVersion}`, { evidence, fix })
  }
  if (order < 0) {
    return check('cli-version', 'fail', `CLI VERSION SKEW: interlock on PATH is ${version} (${real}), plugin is ${pluginVersion}`, { evidence, fix })
  }
  if (order > 0) {
    return check('cli-version', 'warn', `interlock on PATH is ${version} (${real}), newer than plugin ${pluginVersion}`, {
      evidence,
      fix: `Update the plugin to match, or install the plugin's version: npm i -g ${CLI_PACKAGE}@${pluginVersion}`
    })
  }
  return check('cli-version', 'ok', `interlock ${version} on PATH matches plugin ${pluginVersion}`, { evidence })
}

function checkOpenSpec(root, env, probe, openspec) {
  const bin = openspec.source === 'none' ? null : openspec.bin
  const configured = existsSync(join(root, 'openspec', 'config.yaml'))
  const changesDir = existsSync(join(root, 'openspec', 'changes'))

  if (bin) {
    // A provisioned launcher is probed with telemetry off, as it is run.
    const version = openspec.source === 'provisioned' ? probe(bin, ['--version'], telemetryOff(env)) : probe(bin)
    const evidence = [
      `openspec → ${bin}`,
      openspec.source === 'provisioned' ? `source: provisioned (pin ${OPENSPEC_PIN.version}, ${openspec.dataDirSource})` : 'source: your PATH',
      version ? `version ${version}` : 'version probe returned nothing'
    ]
    // On PATH but not running — most often a Node older than OpenSpec's floor.
    // spec and bootstrap stop at this same probe, so the doctor must not say ok.
    if (!version) {
      return check('openspec', 'warn', 'the openspec CLI is on PATH but `openspec --version` did not run; /interlock:spec and /interlock:bootstrap stop at that probe', {
        evidence,
        fix: 'Run `openspec --version` and read its error. OpenSpec needs Node.js 20.19.0 or newer — check `node --version` in the shell the agent uses.'
      })
    }
    // These two warns come before the not-initialised one, so an unconfigured
    // project would lose that advice behind them; the fix carries it along.
    const initNote = configured ? '' : ' This project also has no openspec/config.yaml: run `openspec init` in the project root afterwards.'
    const floorCmp = compareVersions(version, OPENSPEC_MIN_VERSION)
    if (floorCmp === null) {
      return check('openspec', 'warn', `the openspec version could not be read from \`openspec --version\` output "${version}", so it cannot be checked against the ${OPENSPEC_MIN_VERSION} floor`, {
        evidence,
        fix: `Run \`openspec --version\` and read its output. If it is not an x.y.z version, reinstall the CLI: \`${OPENSPEC_INSTALL}\`.${initNote}`
      })
    }
    if (floorCmp < 0) {
      // Two faults sit below the floor, at different versions; name the one
      // this CLI has. floorCmp parsed the version, so this compare does too.
      const why = compareVersions(version, OPENSPEC_NESTED_SYNC_VERSION) < 0
        ? `below ${OPENSPEC_NESTED_SYNC_VERSION}, nested specs/<area>/<capability>/spec.md deltas read "No deltas found" and archive without syncing`
        : `it syncs nested specs/<area>/<capability>/spec.md deltas, but its \`openspec validate\` passes a change whose MODIFIED block drops a scenario, which its \`openspec archive\` then refuses`
      return check('openspec', 'warn', `openspec ${version} is older than ${OPENSPEC_MIN_VERSION}; ${why}`, {
        evidence,
        fix: `Upgrade the openspec CLI: \`${OPENSPEC_INSTALL}\`.${initNote}`
      })
    }
    // The user cache is the one data directory the session preflight never puts on
    // PATH, so a bare `openspec` (what spec and bootstrap probe) misses this copy
    // although the doctor runs it by its full path. Under the plugin's data
    // directory the preflight adds it for later commands, which the preflight's own
    // doctor cannot see yet, so only the cache case is judged.
    if (openspec.source === 'provisioned' && openspec.dataDirSource === 'cache' && openspec.onPath === false) {
      const dir = dirname(bin)
      return check('openspec', 'warn', `the provisioned OpenSpec is in the user cache, whose ${dir} is not on PATH; /interlock:spec and /interlock:bootstrap probe a bare \`openspec\` and stop`, {
        evidence: [...evidence, `not on PATH: ${dir}`],
        fix: `Add ${dir} to PATH, or run \`${OPENSPEC_PROVISION}\` from a Claude Code session with the plugin enabled, whose preflight puts the plugin's data directory on PATH. Until then run it as ${bin}.${initNote}`
      })
    }
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
  const noneEvidence = [
    `source: none (no openspec on PATH, none provisioned for pin ${OPENSPEC_PIN.version})`,
    `data directory: ${openspec.dataDir || '(none)'} (${openspec.dataDirSource})`
  ]
  // Provisioning leads. It needs Node and npm; the npm install stays as the user's own route.
  const provisionFix = `${OPENSPEC_PROVISION} (needs Node.js ${OPENSPEC_PIN.node} or newer and npm), or install it yourself: \`${OPENSPEC_INSTALL}\``
  if (configured) {
    return check('openspec', 'warn', 'the openspec CLI is not on PATH or provisioned; ship reads artifacts from disk, but /interlock:spec and /interlock:bootstrap need it', {
      evidence: ['openspec/config.yaml is present, so existing changes are still readable', ...noneEvidence],
      fix: `${provisionFix}.`
    })
  }
  return check('openspec', 'fail', 'no openspec CLI on PATH or provisioned and no openspec/ project in this repo — neither authoring nor shipping a change can start', {
    evidence: noneEvidence,
    fix: `${provisionFix}, then run \`openspec init\` in the project root.`
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

function checkTestProfile(root, home = root) {
  // Root first, then the state home: the same read-through `run start` performs
  // (ship/state-home), so a linked worktree with no profile of its own is not
  // failed for a profile its run will read from the main checkout.
  const atRoot = join(root, TEST_PROFILE_PATH)
  const atHome = join(home, TEST_PROFILE_PATH)
  const readThrough = !existsSync(atRoot) && resolve(home) !== resolve(root) && existsSync(atHome)
  const path = readThrough ? atHome : atRoot
  const via = readThrough ? ` (read through from the state home: ${atHome})` : ''
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
  // The validation a run applies, from the one validator (design D14): a profile
  // this row passes is never one `run start` then rejects.
  const problem = profileProblem(parsed.value)
  if (problem) {
    return check('test-profile', 'fail', `${TEST_PROFILE_PATH} is invalid: ${problem}`, {
      fix: 'Correct the field named above, or re-run /interlock:fix-tests.'
    })
  }
  return check('test-profile', 'ok', `unit suite: ${command}${via}`, {
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
 *
 * Each directory is probed under the home it is written to (`STATE_DIRS[].home`):
 * `state` under the resolved state home, `root` under the working root. The
 * evidence names every absolute path probed, so a reader of a worktree
 * session's report can see that the trajectory was tested in the main checkout.
 *
 * @param {string} root      the working root
 * @param {string} [stateHome] the resolved state home; the root when absent
 */
export function checkStateDirs(root, stateHome = root) {
  // Real paths on both sides, as the resolver compares them: macOS keeps `/tmp`
  // behind a symlink, and one directory under two spellings is still one.
  const workingRoot = realOrSelf(resolve(root))
  const home = typeof stateHome === 'string' && stateHome ? realOrSelf(resolve(stateHome)) : workingRoot
  const blocked = []
  const evidence = []
  for (const dir of STATE_DIRS) {
    const base = dir.home === 'state' ? home : workingRoot
    const where = dir.home === 'state' ? 'state home' : 'working root'
    const abs = join(base, dir.path)
    let reason = null
    if (existsSync(abs)) {
      const probe = join(abs, `.interlock-doctor-${process.pid}.tmp`)
      try {
        writeFileSync(probe, '')
        rmSync(probe, { force: true })
        evidence.push(`${abs}: writable (${where})`)
      } catch (err) {
        reason = messageOf(err)
      }
    } else {
      let ancestor = dirname(abs)
      while (ancestor && !existsSync(ancestor) && ancestor !== dirname(ancestor)) ancestor = dirname(ancestor)
      try {
        accessSync(ancestor, constants.W_OK)
        evidence.push(`${abs}: absent, creatable under ${ancestor} (${where})`)
      } catch (err) {
        reason = `cannot be created under ${ancestor}: ${messageOf(err)}`
      }
    }
    if (reason) blocked.push({ ...dir, abs, base, reason })
  }

  if (!blocked.length) {
    return check('state-dirs', 'ok', 'every run-state directory is writable or creatable', { evidence })
  }

  const lines = blocked.map(b => `${b.abs}: ${b.reason} — ${b.why}`)
  // Name the directory to repair. From a worktree session the one that blocks
  // may be the main checkout's, which is not the `.claude/` the reader is in.
  const bases = [...new Set(blocked.map(b => b.base))]
  const target = bases.map(b => join(b, '.claude')).join(' and ')
  const elsewhere =
    home !== workingRoot && blocked.some(b => b.home === 'state')
    ? ` — ${join(home, '.claude')} is the state home this root's corpora are written to; pin another with --state-home or ${STATE_HOME_ENV}`
    : ''
  const fatal = blocked.filter(b => b.fatal)
  if (!fatal.length) {
    // Bookkeeping only. The modules behind these say so themselves, and a
    // preflight that failed the run over a lost metrics line would be applying
    // a rule the runtime does not.
    return check('state-dirs', 'warn', `${blocked.length} bookkeeping director${blocked.length === 1 ? 'y is' : 'ies are'} not writable; the run continues without them`, {
      evidence: lines,
      fix: `Make ${target} writable to keep the outcome corpus and review metrics${elsewhere}.`
    })
  }
  return check('state-dirs', 'fail', `${fatal.length} run-state director${fatal.length === 1 ? 'y is' : 'ies are'} not writable, and losing ${fatal.length === 1 ? 'it' : 'them'} ends the run`, {
    evidence: lines,
    fix: `Make ${target} writable, or run from a checkout that is not read-only${elsewhere}. A failed trajectory append exits 1 mid-run.`
  })
}

/**
 * Advice, never a gate: where this root's corpora go, and what the root is.
 *
 * `checkNotify`'s posture — `ok` or `skip`, NEVER `fail`, its own try/catch,
 * outside `diagnose`'s `run()`. The writability of the home is `state-dirs`'
 * question and that row can fail; this one only says which home was resolved,
 * so a worktree session's reader learns before a run that its trajectory, its
 * outcome line and its resume card land in the main checkout. A fallback is
 * `skip` with the resolver's reason, in the same words the run banners, because
 * a fallback is exactly today's behaviour — a degradation to speak, not a block.
 *
 * @param {string} root the working root
 * @param {{home: string, surface: string, reason: string|null, resolvedFrom: string}} resolved
 *   what `resolveStateHome` returned for it
 */
export function checkStateHome(root, resolved) {
  try {
    const home = resolved && typeof resolved.home === 'string' && resolved.home ? resolved.home : null
    if (!home) {
      return check(
        'state-home',
        'skip',
        'STATE HOME UNRESOLVED: the resolver returned no home; corpora of this run go to the working root'
      )
    }
    const surface = typeof resolved.surface === 'string' && resolved.surface ? resolved.surface : 'unknown'
    const from = typeof resolved.resolvedFrom === 'string' ? resolved.resolvedFrom : null
    const reason = typeof resolved.reason === 'string' && resolved.reason ? resolved.reason : null
    const workingRoot = realOrSelf(resolve(root))
    const evidence = [
      `working root: ${workingRoot}`,
      `state home: ${home}`,
      `surface: ${surface}`,
      `resolved from: ${from || 'unknown'}`
    ]
    const corpora = `corpora of this run go to ${home}; the test profile and graph are read from there when this root has none`

    if (from === 'fallback') {
      return check(
        'state-home',
        'skip',
        `STATE HOME UNRESOLVED: ${reason || 'the resolver gave no reason'}; corpora of this run go to the working root ${home}`,
        { evidence }
      )
    }
    if (from === 'explicit') {
      const parts = [`state home ${home}, set explicitly (--state-home or ${STATE_HOME_ENV}); surface ${surface}`]
      if (reason) parts.push(`the surface could not be read: ${reason}`)
      if (realOrSelf(home) !== workingRoot) parts.push(corpora)
      return check('state-home', 'ok', parts.join('; '), { evidence })
    }
    if (surface === 'linked-worktree') {
      return check('state-home', 'ok', `state home ${home}, surface linked-worktree; ${corpora}`, { evidence })
    }
    if (surface === 'main') {
      return check('state-home', 'ok', `state home is the root itself, ${home}, surface main`, { evidence })
    }
    if (surface === 'lane-worktree') {
      return check(
        'state-home',
        'ok',
        `state home is the root itself, ${home}, surface lane-worktree: an Interlock lane worktree keeps its own state`,
        { evidence }
      )
    }
    return check('state-home', 'skip', `the state home ${home} was resolved with an unrecognised surface "${surface}"`, {
      evidence
    })
  } catch (err) {
    // Fail-open, and never `fail`: a resolution this row cannot read is a
    // reason to withhold the advice, not a reason to block a run.
    return check('state-home', 'skip', `the state-home check could not run: ${messageOf(err)}`)
  }
}

/** A path made real when it can be, left as given when it cannot. Never throws. */
function realOrSelf(path) {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
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
 * not degraded their run. Reads the same names `lib/notify.mjs` reads — the
 * shell variables `INTERLOCK_NTFY_TOPIC` / `INTERLOCK_NTFY_URL`, and never the
 * host's option variables — by literal string rather than by importing the
 * transport. The default server comes from `notify-defaults.mjs`, so this row
 * cannot name a different one. The topic value is never read into a string
 * that could reach the report; only the server URL, which is not a
 * capability, is echoed.
 *
 * The row reports the environment the check ran in. A plugin option reaches
 * the session's commands through its own session-start hook, which runs
 * beside the preflight, so a check at session start cannot see one; the
 * `skip` detail says so and names both ways to set a topic
 * (clear-the-plugin-directory-holds design D7).
 */
function configuredValue(env, name) {
  return env && typeof env[name] === 'string' && env[name].trim() ? env[name].trim() : ''
}

function checkNotify(env) {
  try {
    const topic = configuredValue(env, 'INTERLOCK_NTFY_TOPIC')
    if (!topic) {
      return check(
        'notify',
        'skip',
        "no topic in this environment: set the plugin's ntfy topic option (it reaches the session's commands at " +
          'session start, so a check that runs beside it cannot see it) or INTERLOCK_NTFY_TOPIC; optional, but an ' +
          'unattended run that stops will not reach you'
      )
    }
    const url = configuredValue(env, 'INTERLOCK_NTFY_URL') || DEFAULT_NTFY_URL
    return check('notify', 'ok', `push configured: ${url}`)
  } catch (err) {
    // Fail-open, and never `fail`: an unreadable env is a reason to skip the
    // advice, not a reason to block a run that never asked for it.
    return check('notify', 'skip', `the notify check could not run: ${messageOf(err)}`)
  }
}

/**
 * Advice, never a gate: what the Claude Code environment does to a run's model
 * routing, read the way `interlock run start --host workflow` reads it.
 *
 * `checkNotify`'s posture: `ok` only when none of the four variables is set AND
 * the host version was read — an unread version is not a clean reading, because
 * what the plain subagent-model variable means depends on it — otherwise `skip`,
 * and never `fail`. The variables are the operator's environment; a preflight
 * that failed on them would fail every session that set one on purpose.
 *
 * The values printed are model slugs and small integers. Bedrock is named by
 * variable and never by value, under the same presence-only rule as the
 * credential rows: this report is written to disk and pasted into issues.
 *
 * @param {Record<string, string|undefined>} env
 * @param {{version: string|null, cpuCount: number|null}} host
 */
function checkClaudeEnv(env, { version, cpuCount }) {
  try {
    const o = observeClaudeEnv(env, { version, cpuCount })
    const routing = readModelRouting(o)
    const shown = (name, value) => `${name}=${value === null ? 'unset' : value}`
    const four = [
      shown(SUBAGENT_MODEL_ENV, o.subagentModel),
      shown(SUBAGENT_MODEL_FORCE_ENV, o.subagentModelForce),
      shown(WORKFLOW_MAX_CONCURRENT_ENV, o.maxConcurrent ? o.maxConcurrent.raw : null),
      shown(AGENT_TEAMS_ENV, o.agentTeams)
    ]
    const anySet = [o.subagentModel, o.subagentModelForce, o.maxConcurrent, o.agentTeams].some(v => v !== null)

    const detail = [`Claude Code ${o.version || 'unknown (the version probe did not answer)'}`, ...four]
    if (o.subagentModel !== null) {
      detail.push(
        routing.plainDefaultOnly
          ? `${SUBAGENT_MODEL_ENV} sets only the default subagent model on this host (>= ${SUBAGENT_MODEL_DEFAULT_ONLY_MIN_VERSION}); a model a spawn names takes precedence`
          : routing.forceEffective
            ? `${SUBAGENT_MODEL_ENV} names the model FORCE applies`
            : `${SUBAGENT_MODEL_ENV} replaces every agent's model on ` +
              (routing.versionKnown
                ? `this host (below ${SUBAGENT_MODEL_DEFAULT_ONLY_MIN_VERSION})`
                : 'a host whose version is unknown, the conservative reading') +
              ', so the plan\'s per-tier assignment is not in effect'
      )
    }
    if (o.subagentModelForce !== null) {
      detail.push(
        routing.forceInert
          ? `${SUBAGENT_MODEL_FORCE_ENV} has no effect on this host (below ${SUBAGENT_MODEL_FORCE_MIN_VERSION})`
          : o.subagentModelForceEnabled
            ? `${SUBAGENT_MODEL_FORCE_ENV} forces one model: every agent runs on one model`
            : `${SUBAGENT_MODEL_FORCE_ENV} is set to an off value`
      )
    }
    const effortCmp = compareVersions(o.version, PER_CALL_EFFORT_MIN_VERSION)
    detail.push(
      effortCmp === null
        ? `per-call effort: cannot establish whether this host applies it (the version is unknown; it is applied from ${PER_CALL_EFFORT_MIN_VERSION})`
        : effortCmp < 0
          ? `per-call effort is ignored on this host (below ${PER_CALL_EFFORT_MIN_VERSION}); a prose spawn runs at the session's effort`
          : `per-call effort is applied on this host (>= ${PER_CALL_EFFORT_MIN_VERSION})`
    )
    if (o.maxConcurrent && !o.maxConcurrent.valid) {
      const { min, max } = WORKFLOW_MAX_CONCURRENT_RANGE
      detail.push(`${WORKFLOW_MAX_CONCURRENT_ENV} is not an integer from ${min} to ${max}, so a run reads it as unset`)
    }
    if (o.agentTeams !== null) detail.push(`${AGENT_TEAMS_ENV} does not affect Workflow agents`)
    detail.push(
      o.bedrock.length
        ? `Bedrock: ${o.bedrock.join(', ')} set, so control-plane pings inherit the session model`
        : 'Bedrock: not set'
    )
    detail.push(
      `${o.cpuCount === null ? 'CPU count unknown' : `${o.cpuCount} CPUs`} beside the vendor default of ` +
        `${RUNTIME.maxConcurrentAgents} concurrent agents, which the runtime may reduce on a small machine`
    )

    return check('claude-env', !anySet && o.version !== null ? 'ok' : 'skip', detail.join('; '))
  } catch (err) {
    // Fail-open, and never `fail`: an unreadable environment is a reason to
    // withhold the advice, not a reason to block a run.
    return check('claude-env', 'skip', `the claude-env check could not run: ${messageOf(err)}`)
  }
}

/**
 * Whether the host can load the plugin's hooks module (the ship meter), as
 * advice: `ok` at or above the mods floor, `skip` below it or with the version
 * unknown, never `fail`. It reads the version the `claude-env` row already
 * probed, so the preflight spawns nothing new. The binary it names is the one
 * on PATH (or `INTERLOCK_CLAUDE_COMMAND`); a Desktop session's engine is not
 * that binary, which is why the module logs the engine it actually loaded in.
 *
 * @param {Record<string, string|undefined>} env
 * @param {string|null} version
 */
export function checkMods(env, version) {
  try {
    const bin = claudeCommandArgv(env)[0]
    const desktop = 'a Desktop session\'s engine may differ from this binary; the meter logs the engine it loaded in at session start'
    const unchanged = 'a host that cannot load mods runs exactly today\'s run and prints every banner at close'
    if (version === null || version === undefined) {
      return check('mods', 'skip', `${bin}: version unknown (the version probe did not answer); mods need ${MODS_MIN_HOST_VERSION}+; ${unchanged}; ${desktop}`)
    }
    if (compareVersions(version, MODS_MIN_HOST_VERSION) >= 0) {
      return check('mods', 'ok', `${bin} ${version} loads the hooks module (mods ${MODS_MIN_HOST_VERSION}+): /interlock-meter draws a ship run live; ${desktop}`)
    }
    return check(
      'mods',
      'skip',
      `${bin} ${version} is below the mods floor ${MODS_MIN_HOST_VERSION}: the meter draws nothing here; ${unchanged}; ${desktop}`
    )
  } catch (err) {
    return check('mods', 'skip', `the mods check could not run: ${messageOf(err)}`)
  }
}

/** The installed Claude CLI's version through the doctor's probe, or null. Never throws. */
function claudeVersionOf(env, probe) {
  try {
    const [bin, ...fixedArgs] = claudeCommandArgv(env)
    return parseClaudeVersion(probe(bin, [...fixedArgs, '--version']))
  } catch {
    return null
  }
}

/** This machine's CPU count, or null. Never throws. */
function cpuCountOf() {
  try {
    const n = cpus().length
    return Number.isInteger(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

/** The credential a bare print-mode run reads from the environment, by name. */
const BARE_KEY_ENV = 'ANTHROPIC_API_KEY'
/** The settings key a bare print-mode run can take a credential from instead. */
const BARE_HELPER_KEY = 'apiKeyHelper'
/** What `--bare` sets, and what a session already in simple mode carries. */
const CLAUDE_SIMPLE_ENV = 'CLAUDE_CODE_SIMPLE'

/**
 * The vendor's bare-mode facts this row repeats. A host claim this module
 * cannot verify, so it is stated as what the documentation says, not as a
 * measurement of the session.
 */
const BARE_MODE_FACT =
  'the headless docs recommend --bare and say it will become the default for -p; under it OAuth and the keychain ' +
  'are never read, so --host claude lanes need a key or a helper, and a plugin loads only through --plugin-dir'

/**
 * Advice, never a gate: would a bare print-mode run have a credential?
 *
 * `checkNotify`'s posture — `ok` or `skip`, NEVER `fail`, its own try/catch,
 * outside `diagnose`'s `run()`. A session that authenticates with OAuth runs
 * every lane today; the row exists because the vendor intends `--bare` to
 * become the print-mode default, and under it that same session's `--host
 * claude` lanes would start with nothing to authenticate with. A preflight that
 * failed on a default that has not changed yet would block working runs.
 *
 * Read by NAME and never by value: `ANTHROPIC_API_KEY` is reported as set or
 * not, and an `apiKeyHelper` by the settings scope that configures it, never by
 * the command it runs. This report is written to disk and pasted into issues.
 *
 * A settings file that is absent, unreadable or not JSON is skipped here and
 * not reported — `checkPermissions` owns that finding, and an unparseable file
 * is not evidence that a helper is unset.
 *
 * @param {Record<string, string|undefined>} env
 * @param {{root?: string, home?: string, sources?: Array<{scope: string, path: string}>}} [opts]
 */
export function checkClaudeBare(env, { root = '.', home, sources } = {}) {
  try {
    const key = isSet(env, BARE_KEY_ENV)
    const simple = isSet(env, CLAUDE_SIMPLE_ENV)
    const helperScopes = []
    const evidence = []
    for (const source of sources || settingsSources(resolve(root), home)) {
      if (!source || typeof source.path !== 'string' || !existsSync(source.path)) continue
      const parsed = readJson(source.path)
      if (!parsed.value || typeof parsed.value !== 'object') continue
      const helper = parsed.value[BARE_HELPER_KEY]
      if (typeof helper === 'string' && helper.trim()) {
        helperScopes.push(source.scope)
        evidence.push(`${BARE_HELPER_KEY}: ${source.scope} (${source.path})`)
      }
    }

    const helpers = helperScopes.length
      ? `${BARE_HELPER_KEY} is configured in ${helperScopes.join(', ')} settings`
      : null
    const detail = []
    if (key && helpers) {
      detail.push(`${BARE_KEY_ENV} is set and ${helpers}, so a bare print-mode run has a credential`)
    } else if (key) {
      detail.push(`${BARE_KEY_ENV} is set, so a bare print-mode run has a credential`)
    } else if (helpers) {
      detail.push(
        `${helpers}, so a bare print-mode run has a credential`,
        `\`claude --help\` words bare-mode auth as an ${BARE_HELPER_KEY} "via --settings", so a helper configured only in a settings file may need passing with --settings`
      )
    } else {
      detail.push(
        `neither ${BARE_KEY_ENV} nor an ${BARE_HELPER_KEY} is configured, so a bare print-mode run would have no credential — set ${BARE_KEY_ENV} or configure ${BARE_HELPER_KEY}`
      )
    }
    detail.push(
      simple
        ? `${CLAUDE_SIMPLE_ENV} is set (the simple mode --bare turns on)`
        : `${CLAUDE_SIMPLE_ENV} is not set`,
      BARE_MODE_FACT
    )

    const ok = key || Boolean(helpers)
    return check('claude-bare', ok ? 'ok' : 'skip', detail.join('; '), {
      evidence,
      fix: ok
        ? undefined
        : `Set ${BARE_KEY_ENV}, or configure "${BARE_HELPER_KEY}" in a settings file (passed with --settings under --bare), before --host claude lanes run bare. Nothing changes for a run today.`
    })
  } catch (err) {
    // Fail-open, and never `fail`: an unreadable environment or settings tree
    // is a reason to withhold the advice, not a reason to block a run.
    return check('claude-bare', 'skip', `the claude-bare check could not run: ${messageOf(err)}`)
  }
}

/**
 * Advice, never a gate, and never a measurement.
 *
 * An unset prompt-cache lifetime costs money and never costs correctness, so
 * this row takes `checkNotify`'s posture exactly — `ok` or `skip`, never `fail`
 * — rather than `checkPermissions`'s. Taking the other shape would emit a
 * failing preflight on every session that has not set two keys Interlock cannot
 * set for them: a plugin has no settings component, so this row exists to *tell*
 * an operator, which is the whole of what is available here.
 *
 * WHAT IT MAY NOT SAY. Nothing exposes the lifetime a session is actually
 * running under to a hook, a script, or any command's output. The only observable
 * is the post-hoc usage envelope, which this command does not have. So the row
 * reads the four settings scopes and states what is *configured*, plus the
 * authentication mode — because the documented defaults depend on it — and
 * asserts no effective lifetime. An effective lifetime stated here would be a
 * fabricated measurement, the exact failure the eval requirement in this same
 * change forbids.
 *
 * Values are never printed and never resolved across scopes. Claude Code's own
 * merge decides which scope wins; a preflight that picked one and printed it
 * would be recommending a value it did not compute.
 */
function checkPromptCache(root, { home, sources, env } = {}) {
  try {
    const keys = [PROMPT_CACHE_MAIN_KEY, PROMPT_CACHE_SUBAGENT_KEY]
    const scopes = { [PROMPT_CACHE_MAIN_KEY]: [], [PROMPT_CACHE_SUBAGENT_KEY]: [] }

    for (const source of sources || settingsSources(root, home)) {
      if (!existsSync(source.path)) continue
      const parsed = readJson(source.path)
      // An unreadable or unparseable settings file is not evidence that a key is
      // unset — Claude Code ignores such a file too, and `checkPermissions`
      // already reports the parse failure. Silence here, not a claim.
      if (!parsed.value || typeof parsed.value !== 'object') continue
      for (const key of keys) {
        if (isConfiguredLifetime(parsed.value[key])) scopes[key].push(source.scope)
      }
    }

    const where = key =>
      scopes[key].length ? `set in ${scopes[key].join(', ')}` : 'not set in any scope read here'
    const mode = detectAuthMode(env)
    const both = keys.every(k => scopes[k].length)

    const detail = [
      both
        ? 'both prompt-cache lifetimes are configured'
        : 'a prompt-cache lifetime is unset, so its bucket runs on the host default',
      `${PROMPT_CACHE_MAIN_KEY} (main conversation) ${where(PROMPT_CACHE_MAIN_KEY)}`,
      `${PROMPT_CACHE_SUBAGENT_KEY} (subagents and workflows — the bucket a ship run's wave agents fall in) ${where(PROMPT_CACHE_SUBAGENT_KEY)}`,
      `auth mode: ${mode || 'not determined from the environment, so no documented default can be named'}`,
      `both keys need Claude Code >= ${PROMPT_CACHE_MIN_HOST_VERSION}, below which they are accepted and silently ignored`,
      'configuration only — nothing exposes the lifetime a session is actually running under, and the defaults depend on the host build and the authentication mode'
    ].join('; ')

    return check('prompt-cache', both ? 'ok' : 'skip', detail, {
      fix: both
        ? undefined
        : `Set "${PROMPT_CACHE_MAIN_KEY}" and "${PROMPT_CACHE_SUBAGENT_KEY}" in your own settings.json. Interlock cannot: a plugin has no settings component.`
    })
  } catch (err) {
    // Fail-open, and never `fail`: an unreadable settings tree is a reason to
    // withhold the advice, not a reason to block a run that works without it.
    return check('prompt-cache', 'skip', `the prompt-cache check could not run: ${messageOf(err)}`)
  }
}

/**
 * Whether Claude Code's advisor tool is configured, by scope. Advice, never a
 * gate: `ok` or `skip`, and a throw is a `skip` with its reason.
 *
 * Only the user can turn the tool on, so this row reads and says; the texts, and
 * the one spelling of the settings key, live in `lib/advisor-tool.mjs`. Scopes
 * are named and the value is never printed. A settings file that does not read
 * or parse is named in the detail with its reason, and it never demotes an `ok`
 * row: a scope that sets the key is evidence on its own.
 */
function checkAdvisor(root, { home, sources, env } = {}) {
  try {
    const read = readAdvisorConfig(readSettingsSources(sources || settingsSources(root, home)))
    const row = advisorDoctor({ ...read, disabled: observeClaudeEnv(env).advisorDisabled })
    return check('advisor', row.status, row.detail, row.fix ? { fix: row.fix } : {})
  } catch (err) {
    // Fail-open, and never `fail`: an unreadable settings tree is a reason to
    // withhold the advice, not a reason to block a run that works without it.
    return check('advisor', 'skip', `the advisor check could not run: ${messageOf(err)}`)
  }
}

/** A lifetime is configured when it carries a value, whatever the host makes of it. */
function isConfiguredLifetime(value) {
  if (typeof value === 'string') return value.trim() !== ''
  if (typeof value === 'number') return Number.isFinite(value)
  return false
}

/**
 * Which credential the environment carries, by NAME and never by value — the
 * same presence-only rule the eval prerequisite rows hold, for the same reason:
 * this report is written to disk and pasted into issues. Returns null rather
 * than guessing, because a guessed mode would let the row name a default that
 * does not apply.
 */
function detectAuthMode(env) {
  if (isSet(env, 'ANTHROPIC_API_KEY')) return 'API key (ANTHROPIC_API_KEY is set)'
  if (isSet(env, 'CLAUDE_CODE_OAUTH_TOKEN')) return 'OAuth token (CLAUDE_CODE_OAUTH_TOKEN is set)'
  return null
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
        ? check('evals-harness', 'ok', `${EVAL_ENABLEMENT_VAR} is set, so the early-access harness is enabled`)
        : check(
            'evals-harness',
            'skip',
            `${EVAL_ENABLEMENT_VAR} is not set, so the early-access harness is unavailable — no ship run needs it`,
            { fix: `Set one of the harness prerequisites by assigning ${EVAL_ENABLEMENT_VAR} the value 1. Nothing else changes.` }
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
 * @param {(bin: string, args?: string[]) => string|null} [opts.probeVersion]  version probe; injected in tests
 * @param {number} [opts.cpuCount]          overrides the machine's CPU count, for tests
 * @param {Array<{scope:string,path:string}>} [opts.settingsSources]  overrides the merge list
 * @param {string} [opts.stateHome]         an explicit state home (`--state-home`); when absent,
 *                                          `INTERLOCK_STATE_HOME` in `opts.env` and then git decide
 * @returns {object} report, carrying `stateHome` (absolute) and `surface`
 */
export function diagnose(root = '.', opts = {}) {
  const projectRoot = resolve(root)
  const pluginRoot = opts.pluginRoot ? resolve(opts.pluginRoot) : PLUGIN_ROOT
  const env = opts.env || process.env
  const probe = typeof opts.probeVersion === 'function' ? opts.probeVersion : probeVersion

  // Resolved ONCE, here, and handed to every row that needs it — and to the
  // SessionStart preflight through the report, so it reads interrupted-run
  // notes from this home without resolving a second time.
  const resolved = resolveHomeFor(projectRoot, opts.stateHome, env)

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
  // Resolved once: the node row and the openspec row must agree on which CLI they mean.
  let openspec
  try {
    openspec = resolveOpenSpec({ env, platform: opts.platform || process.platform })
  } catch (err) {
    openspec = { source: 'none', dataDir: null, dataDirSource: `unresolved: ${messageOf(err)}` }
  }
  checks.push(run('node', () => checkNode(pluginRoot, opts.nodeVersion || process.version, openspec, opts.platform || process.platform)))
  checks.push(run('plugin', () => checkPlugin(pluginRoot)))
  checks.push(run('binaries', () => checkBinaries(pluginRoot, env)))
  checks.push(run('cli-version', () => checkCliVersion(cliComparisonRoot(opts, env, pluginRoot), env)))
  checks.push(run('openspec', () => checkOpenSpec(projectRoot, env, probe, openspec)))
  checks.push(run('git', () => checkGit(projectRoot, env, probe)))

  const profileCheck = run('test-profile', () => checkTestProfile(projectRoot, resolved.home || projectRoot))
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
  // Not behind `run()`: which home was resolved is advice and may never be a
  // `fail`; whether that home is writable is `state-dirs`' question, which can.
  checks.push(checkStateHome(projectRoot, resolved))
  checks.push(run('state-dirs', () => checkStateDirs(projectRoot, resolved.home)))

  // Not behind `run()`: that wrapper's thrown-probe verdict is `fail`, and
  // this row may never carry one — push is optional, so `checkNotify` owns
  // its own try/catch and degrades to `skip`. Same reasoning as the eval
  // prerequisite rows just below.
  checks.push(checkNotify(env))

  // Same exemption, same reason: prompt-cache lifetime is advice about the
  // operator's own settings file, so this row is `ok`/`skip` and owns its
  // try/catch. See `checkPromptCache`.
  checks.push(checkPromptCache(projectRoot, { home: opts.home, sources: opts.settingsSources, env }))

  // Same posture, same exemption: whether the engine's advisor tool is
  // configured is the operator's choice. `ok`/`skip`, its own try/catch. See
  // `checkAdvisor`.
  checks.push(checkAdvisor(projectRoot, { home: opts.home, sources: opts.settingsSources, env }))

  // And again: the Claude Code environment a run's routing reads is the
  // operator's, so this row is advice. One `claude --version` spawn, bounded by
  // the probe's own timeout. See `checkClaudeEnv`.
  const claudeVersion = claudeVersionOf(env, probe)
  checks.push(
    checkClaudeEnv(env, {
      version: claudeVersion,
      cpuCount: Number.isInteger(opts.cpuCount) ? opts.cpuCount : cpuCountOf()
    })
  )
  // The same reading, no second spawn: whether the ship meter can draw here.
  // Advice, `ok`/`skip`, its own try/catch. See `checkMods`.
  checks.push(checkMods(env, claudeVersion))

  // And again: whether a bare print-mode run would have a credential is advice
  // about the operator's environment and settings. See `checkClaudeBare`.
  checks.push(checkClaudeBare(env, { root: projectRoot, home: opts.home, sources: opts.settingsSources }))

  // Not behind `run()`: that wrapper's thrown-probe verdict is `fail`, and
  // these rows may never carry one. See `evalPrerequisiteChecks`.
  checks.push(...evalPrerequisiteChecks(pluginRoot, env))

  const counts = { ok: 0, warn: 0, fail: 0, skip: 0 }
  for (const c of checks) counts[c.status] = (counts[c.status] || 0) + 1

  return {
    ok: counts.fail === 0,
    root: projectRoot,
    stateHome: resolved.home,
    surface: resolved.surface,
    pluginRoot,
    counts,
    checks,
    failures: checks.filter(c => c.status === 'fail').map(c => c.id),
    warnings: checks.filter(c => c.status === 'warn').map(c => c.id),
    requiredCommands: required.map(r => ({ command: r.tokens.join(' '), why: r.why }))
  }
}

/**
 * The state home for `root`, never throwing. `resolveStateHome` already holds
 * that contract; the guard is here because a doctor that crashed resolving
 * where to look would produce no report at all, and the fallback carries its
 * reason so the `state-home` row can speak it.
 */
function resolveHomeFor(root, explicit, env) {
  try {
    const resolved = resolveStateHome(root, {
      explicit: typeof explicit === 'string' && explicit.trim() ? explicit : undefined,
      env
    })
    if (resolved && typeof resolved.home === 'string' && resolved.home) return resolved
    return { home: root, surface: 'unknown', reason: 'the state home resolver returned no home', resolvedFrom: 'fallback' }
  } catch (err) {
    return {
      home: root,
      surface: 'unknown',
      reason: `the state home could not be resolved: ${messageOf(err)}`,
      resolvedFrom: 'fallback'
    }
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
  // Under `root:` only when the two differ, so a main checkout's report reads as
  // it always did and a worktree session's names where its corpora go.
  if (
    typeof report.stateHome === 'string' &&
    report.stateHome &&
    realOrSelf(report.stateHome) !== realOrSelf(report.root)
  ) {
    lines.push(`  state home: ${report.stateHome}`)
  }
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
