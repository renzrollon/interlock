#!/usr/bin/env node
// Measure the OpenSpec CLI against the fields Interlock's skills read (spec:
// openspec-cli; design D22).
//
// Development tooling only. `scripts/` is not in package.json `files`, and CI
// installs nothing, so this is opt-in: a pin bump runs it (CONTRIBUTING.md) and
// pastes its one line into the PR. The unit suite drives it against a stub CLI
// only (test/spine/openspec-cli.test.mjs).
//
// In a fresh `mkdtemp` project, with OpenSpec's telemetry off, it runs six
// commands:
//
//   1. init --tools none
//   2. new change probe
//   3. status --change probe --json
//   4. instructions proposal --change probe --json
//   5. validate probe, after writing a minimal proposal, design, tasks and one
//      nested delta specs/area/cap/spec.md
//   6. archive probe --yes
//
// and asserts the fields the skills and `compact-instructions.mjs` read. Each
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
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { OPENSPEC_PROVISION, resolveOpenSpec, telemetryOff } from '../lib/openspec-cli.mjs'

const CHANGE = 'probe'
const REQUIREMENT = 'Probe behaviour'
const ARTIFACT_IDS = ['proposal', 'design', 'specs', 'tasks']

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

const TASKS = `## 1. Probe

- [ ] 1.1 Do nothing.
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

    // 6. archive, which must sync the nested delta into the living specs.
    step('archive', ['archive', CHANGE, '--yes'])
    const living = join(project, 'openspec', 'specs', 'area', 'cap', 'spec.md')
    let text = ''
    try {
      text = readFileSync(living, 'utf8')
    } catch {}
    check('archive.sync', text.includes(`Requirement: ${REQUIREMENT}`), `${join('openspec', 'specs', 'area', 'cap', 'spec.md')} does not hold the delta's requirement after archive`)
  } finally {
    rmSync(project, { recursive: true, force: true })
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
