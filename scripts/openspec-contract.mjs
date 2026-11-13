#!/usr/bin/env node
// Measure the OpenSpec CLI against the fields Interlock's skills read (spec:
// openspec-cli; design D22).
//
// Development tooling only. `scripts/` is not in package.json `files`, and CI
// installs nothing, so this is opt-in: a pin bump runs it (CONTRIBUTING.md) and
// pastes its one line into the PR. The unit suite drives it against a stub CLI
// only (test/spine/openspec-cli.test.mjs).
//
// In a fresh `mkdtemp` project, with OpenSpec's telemetry off, it runs these
// commands:
//
//   1. init --tools none
//   2. new change probe
//   3. status --change probe --json
//   4. instructions proposal --change probe --json
//   5. validate probe, after writing a minimal proposal, design, tasks (every
//      task shape Interlock's reader counts) and one nested delta
//      specs/area/cap/spec.md
//   6. list --json, whose task counts must equal `parseTasks` over the same text
//   7. archive probe --yes
//   8. validate --specs
//
// then, in a second scratch directory, `init --tools claude` and the layout it
// writes (five stock skills under .agents/skills/, each linked from
// .claude/skills/, no .claude/commands/), and asserts the fields the skills and
// `compact-instructions.mjs` read. Each
// failure is named by its path (`status.applyRequires`); on any, the script
// prints them to stderr and exits 1. On success it prints one line naming the
// CLI it ran, its version and how many checks passed.
//
// Usage:
//   node scripts/openspec-contract.mjs [--openspec <bin>]
//
// With no --openspec it uses what `interlock openspec which` would: a PATH
// openspec, else the provisioned pin.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseTasks } from '../lib/artifacts.mjs'
import { OPENSPEC_PROVISION, resolveOpenSpec, telemetryOff } from '../lib/openspec-cli.mjs'

const CHANGE = 'probe'
const REQUIREMENT = 'Probe behaviour'
const ARTIFACT_IDS = ['proposal', 'design', 'specs', 'tasks']
// The stock skills `openspec init --tools claude` writes at 2.0.0 (design D10).
const STOCK_SKILLS = ['openspec-propose', 'openspec-apply-change', 'openspec-archive-change', 'openspec-explore', 'openspec-sync-specs']

const PROPOSAL = `## Why

A throwaway change that exercises the OpenSpec CLI the way Interlock's skills do, so a version bump can be measured.

## What Changes

- Adds the probe capability.

## Capabilities

### New Capabilities
- \`cap\`: a probe capability

### Modified Capabilities

## Impact

None.
`

const DESIGN = `## Context

A probe for the OpenSpec contract check.

## Goals / Non-Goals

**Goals:**
- Exercise validate and archive.

**Non-Goals:**
- Anything real.

## Decisions

### Decision: keep it minimal

The change holds one requirement with one scenario.

## Risks / Trade-offs

None.
`

// Every task shape the reader counts: each bullet marker, a nested sub-task, a done
// task, a box holding a character other than x, a task with no description, a link
// bullet (not a task), and a task whose text wraps onto a second line.
const TASKS = `## 1. Probe

- [ ] 1.1 Do nothing.
* [ ] 1.2 A star bullet.
+ [ ] 1.3 A plus bullet.
1. [ ] A numbered task.
2) [ ] A parenthesised task.
- [x] 1.4 A done task.
  - [ ] 1.4.1 A nested sub-task.
- [~] 1.5 A box holding another character.
- [ ]
- [x](https://example.com/probe) a link bullet, not a task.
- [ ] 1.6 A task whose text wraps
  onto a second line.
`

const DELTA = `## ADDED Requirements

### Requirement: ${REQUIREMENT}
The system SHALL behave as the probe describes.

#### Scenario: The probe runs
- **WHEN** the contract check runs
- **THEN** the probe behaves as described
`

/** Parse the command line; returns { bin } or an error message. */
function parseArgs(argv) {
  const out = { bin: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--openspec') {
      const value = argv[++i]
      if (!value) return { error: '--openspec needs the path of an OpenSpec executable' }
      out.bin = value
    } else {
      return { error: `unknown argument ${argv[i]} (usage: node scripts/openspec-contract.mjs [--openspec <bin>])` }
    }
  }
  return out
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.error) {
    process.stderr.write(`openspec-contract: ${args.error}\n`)
    return 1
  }
  let bin = args.bin
  if (!bin) {
    const found = resolveOpenSpec({ env: process.env, platform: process.platform })
    if (found.source === 'none') {
      process.stderr.write(`openspec-contract: no OpenSpec resolved (no openspec on PATH, none provisioned); run \`${OPENSPEC_PROVISION}\`, or pass --openspec <bin>\n`)
      return 1
    }
    bin = found.bin
  }

  const env = telemetryOff(process.env)
  const failures = []
  let passed = 0
  const check = (name, ok, detail) => {
    if (ok) passed += 1
    else failures.push(`${name}${detail ? `: ${detail}` : ''}`)
    return ok
  }

  const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)
  const run = (cwd, argv) => {
    const r = spawnSync(shell ? `"${bin}"` : bin, argv, { cwd, env, shell, encoding: 'utf8', timeout: 120_000 })
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error }
  }
  const tail = r => (r.error ? r.error.message : (r.stderr || r.stdout).trim().split('\n').filter(Boolean).pop() || `exit ${r.status}`)

  const versionRun = run(process.cwd(), ['--version'])
  const version = versionRun.stdout.trim().split('\n')[0].trim()
  if (versionRun.status !== 0 || !version) {
    process.stderr.write(`openspec-contract: ${bin} --version failed: ${tail(versionRun)}\n`)
    return 1
  }

  // realpath: a symlinked tmp prefix (macOS) would otherwise differ from the paths OpenSpec prints.
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'interlock-openspec-contract-')))
  try {
    const step = (name, argv) => {
      const r = run(project, argv)
      check(`${name} exit`, r.status === 0, `\`openspec ${argv.join(' ')}\` exited ${r.status === null ? 'without a status' : r.status}: ${tail(r)}`)
      return r
    }
    const jsonOf = (name, r) => {
      try {
        const value = JSON.parse(r.stdout)
        check(`${name} json`, value !== null && typeof value === 'object' && !Array.isArray(value), 'not a JSON object')
        return value && typeof value === 'object' ? value : {}
      } catch {
        check(`${name} json`, false, `stdout is not JSON: ${r.stdout.slice(0, 80) || '(empty)'}`)
        return {}
      }
    }
    const isString = value => typeof value === 'string' && value.length > 0

    // 1-2. A project with a change in it.
    step('init', ['init', '--tools', 'none'])
    step('new', ['new', 'change', CHANGE])
    const changeDir = join(project, 'openspec', 'changes', CHANGE)
    check('new.changeDir', existsSync(changeDir), `${join('openspec', 'changes', CHANGE)} was not created`)

    // 3. status --json
    const status = jsonOf('status', step('status', ['status', '--change', CHANGE, '--json']))
    check('status.changeName', status.changeName === CHANGE, `expected "${CHANGE}", got ${JSON.stringify(status.changeName)}`)
    check('status.applyRequires', Array.isArray(status.applyRequires), `expected an array, got ${JSON.stringify(status.applyRequires)}`)
    const artifacts = Array.isArray(status.artifacts) ? status.artifacts : null
    check('status.artifacts', artifacts !== null && artifacts.length > 0, `expected a non-empty array, got ${JSON.stringify(status.artifacts)}`)
    const ids = []
    ;(artifacts || []).forEach((artifact, i) => {
      const ok = artifact && isString(artifact.id) && isString(artifact.status)
      check(`status.artifacts[${i}].id/status`, !!ok, `expected strings, got ${JSON.stringify(artifact)}`)
      if (ok) ids.push(artifact.id)
    })
    for (const id of ARTIFACT_IDS) check(`status.artifacts[].id ${id}`, ids.includes(id), `no artifact "${id}" in ${JSON.stringify(ids)}`)
    const paths = status.artifactPaths && typeof status.artifactPaths === 'object' ? status.artifactPaths : {}
    check('status.artifactPaths', Object.keys(paths).length > 0, `expected an object keyed by artifact id, got ${JSON.stringify(status.artifactPaths)}`)
    for (const id of ids) {
      check(`status.artifactPaths.${id}.resolvedOutputPath`, !!(paths[id] && isString(paths[id].resolvedOutputPath)), `got ${JSON.stringify(paths[id])}`)
    }

    // 4. instructions --json
    const instructions = jsonOf('instructions', step('instructions', ['instructions', 'proposal', '--change', CHANGE, '--json']))
    check('instructions.instruction', isString(instructions.instruction), `expected a string, got ${JSON.stringify(instructions.instruction)}`)
    check('instructions.template', isString(instructions.template), `expected a string, got ${JSON.stringify(instructions.template)}`)
    check('instructions.resolvedOutputPath', isString(instructions.resolvedOutputPath), `expected a string, got ${JSON.stringify(instructions.resolvedOutputPath)}`)

    // 5. validate, over minimal artifacts and one nested delta.
    const put = (rel, text) => {
      const file = join(changeDir, rel)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, text)
    }
    put('proposal.md', PROPOSAL)
    put('design.md', DESIGN)
    put('tasks.md', TASKS)
    put(join('specs', 'area', 'cap', 'spec.md'), DELTA)
    step('validate', ['validate', CHANGE])

    // 6. list --json, whose task counts must equal Interlock's reader over the same text.
    const list = jsonOf('list', step('list', ['list', '--json']))
    const listed = Array.isArray(list.changes) ? list.changes.find(c => c && c.name === CHANGE) : undefined
    check('list.changes', !!listed, `expected an entry named "${CHANGE}" in changes, got ${JSON.stringify(list.changes)}`)
    const counted = parseTasks(TASKS)
    const expectTotal = counted.length
    const expectDone = counted.filter(t => t.done).length
    check('list.totalTasks', !!listed && listed.totalTasks === expectTotal, `OpenSpec counts ${JSON.stringify(listed && listed.totalTasks)}, Interlock's reader counts ${expectTotal}`)
    check('list.completedTasks', !!listed && listed.completedTasks === expectDone, `OpenSpec counts ${JSON.stringify(listed && listed.completedTasks)}, Interlock's reader counts ${expectDone}`)

    // 7. archive, which must sync the nested delta into the living specs.
    step('archive', ['archive', CHANGE, '--yes'])
    const living = join(project, 'openspec', 'specs', 'area', 'cap', 'spec.md')
    let text = ''
    try {
      text = readFileSync(living, 'utf8')
    } catch {}
    check('archive.sync', text.includes(`Requirement: ${REQUIREMENT}`), `${join('openspec', 'specs', 'area', 'cap', 'spec.md')} does not hold the delta's requirement after archive`)

    // 8. the living specs the archive wrote must validate.
    step('validate --specs', ['validate', '--specs'])
  } finally {
    rmSync(project, { recursive: true, force: true })
  }

  // 9. bootstrap's `init --tools claude`, in a second scratch directory, and the layout it writes.
  const claudeProject = realpathSync(mkdtempSync(join(tmpdir(), 'interlock-openspec-contract-claude-')))
  try {
    const r = run(claudeProject, ['init', '--tools', 'claude'])
    check('init --tools claude exit', r.status === 0, `\`openspec init --tools claude\` exited ${r.status === null ? 'without a status' : r.status}: ${tail(r)}`)
    check('init --tools claude', existsSync(join(claudeProject, 'openspec', 'config.yaml')), `${join('openspec', 'config.yaml')} was not written`)
    const skillsDir = join(claudeProject, '.agents', 'skills')
    const missing = STOCK_SKILLS.filter(name => !existsSync(join(skillsDir, name, 'SKILL.md')))
    check('init.agentsSkills', missing.length === 0, `no SKILL.md under ${join('.agents', 'skills')} for ${missing.join(', ')}`)
    const agentsReal = existsSync(skillsDir) ? realpathSync(skillsDir) : null
    const unlinked = STOCK_SKILLS.filter(name => {
      const entry = join(claudeProject, '.claude', 'skills', name)
      if (!existsSync(entry) || agentsReal === null) return true
      return !realpathSync(entry).startsWith(agentsReal + sep)
    })
    check('init.claudeSkills', unlinked.length === 0, `${unlinked.join(', ')} not present under ${join('.claude', 'skills')} as a link into ${join('.agents', 'skills')}`)
    check('init.commands', !existsSync(join(claudeProject, '.claude', 'commands')), `${join('.claude', 'commands')} was written`)
  } finally {
    rmSync(claudeProject, { recursive: true, force: true })
  }

  if (failures.length) {
    process.stderr.write(`openspec-contract: ${bin} ${version} failed ${failures.length} check(s):\n${failures.map(f => `  - ${f}`).join('\n')}\n`)
    return 1
  }
  process.stdout.write(`openspec contract: ${bin} ${version} passed ${passed} checks\n`)
  return 0
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exit(main())
}
