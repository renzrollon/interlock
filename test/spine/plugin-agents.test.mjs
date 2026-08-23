// Plugin agents + ship.js spawn prefix (slim-ship-spawn-prefix).
//
// A spawn that drops `tools` inherits the parent catalog. That defect is
// invisible to a source grep for "Skill" — the word never appears because the
// inherit path is the *absence* of an allowlist. These tests fail on absence.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PING_AGENT,
  WORKER_AGENT,
  PING_TOOLS,
  WORKER_TOOLS,
  spawnPrefix
} from '../../lib/host.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SHIP = join(ROOT, 'workflows', 'ship.js')
const PING_MD = join(ROOT, 'agents', 'ping.md')
const WORKER_MD = join(ROOT, 'agents', 'worker.md')

function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (!m) return null
  const values = {}
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(line)
    if (kv) values[kv[1]] = kv[2]
  }
  return values
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

function assertSlim(tools, label) {
  assert.ok(tools.length > 0, `${label}: tools allowlist is empty`)
  for (const forbidden of ['Skill', 'Agent']) {
    assert.ok(
      !tools.some(t => t === forbidden || t.startsWith(`${forbidden}(`)),
      `${label}: tools must not include ${forbidden}`
    )
  }
  assert.ok(
    !tools.some(t => t.startsWith('mcp__')),
    `${label}: tools must not include MCP names`
  )
}

test('plugin agent files exist with slim frontmatter', () => {
  assert.ok(existsSync(PING_MD), 'agents/ping.md is missing')
  assert.ok(existsSync(WORKER_MD), 'agents/worker.md is missing')

  const ping = parseFrontmatter(readFileSync(PING_MD, 'utf8'))
  const worker = parseFrontmatter(readFileSync(WORKER_MD, 'utf8'))
  assert.ok(ping && worker, 'agent files must have YAML frontmatter')
  assert.equal(ping.name, 'ping')
  assert.equal(worker.name, 'worker')

  const pingTools = splitList(ping.tools)
  const workerTools = splitList(worker.tools)
  assert.deepEqual(pingTools, [...PING_TOOLS])
  assert.deepEqual(workerTools, [...WORKER_TOOLS])
  assertSlim(pingTools, 'agents/ping.md')
  assertSlim(workerTools, 'agents/worker.md')

  for (const [label, fm] of [
    ['ping', ping],
    ['worker', worker]
  ]) {
    const denied = splitList(fm.disallowedTools)
    for (const need of ['Skill', 'Agent', 'mcp__*']) {
      assert.ok(denied.includes(need), `${label}: disallowedTools must include ${need}`)
    }
  }
})

test('spawnPrefix maps ping vs everything else', () => {
  assert.deepEqual(spawnPrefix('ping'), { type: PING_AGENT, tools: [...PING_TOOLS] })
  assert.deepEqual(spawnPrefix('implementer'), { type: WORKER_AGENT, tools: [...WORKER_TOOLS] })
  assert.deepEqual(spawnPrefix(), { type: WORKER_AGENT, tools: [...WORKER_TOOLS] })
  assert.equal(PING_AGENT, 'interlock:ping')
  assert.equal(WORKER_AGENT, 'interlock:worker')
})

test('ship.js restates the host spawn-prefix literals and uses them on every agent()', () => {
  const text = readFileSync(SHIP, 'utf8')

  const str = name => {
    const m = new RegExp(`const ${name} = '([^']+)'`).exec(text)
    assert.ok(m, `ship.js is missing const ${name}`)
    return m[1]
  }
  const list = name => {
    const m = new RegExp(`const ${name} = \\[([^\\]]+)\\]`).exec(text)
    assert.ok(m, `ship.js is missing const ${name}`)
    return m[1].split(',').map(s => s.replace(/['"]/g, '').trim()).filter(Boolean)
  }

  assert.equal(str('PING_AGENT'), PING_AGENT)
  assert.equal(str('WORKER_AGENT'), WORKER_AGENT)
  assert.deepEqual(list('PING_TOOLS'), [...PING_TOOLS])
  assert.deepEqual(list('WORKER_TOOLS'), [...WORKER_TOOLS])
  assertSlim(list('PING_TOOLS'), 'ship.js PING_TOOLS')
  assertSlim(list('WORKER_TOOLS'), 'ship.js WORKER_TOOLS')
  assert.ok(!list('PING_TOOLS').includes('Edit'), 'a ping must not receive Edit')
  assert.ok(!list('PING_TOOLS').includes('Grep'), 'a ping must not receive Grep')

  assert.match(text, /type:\s*PING_AGENT/)
  assert.match(text, /type:\s*WORKER_AGENT/)
  assert.match(text, /tools:\s*PING_TOOLS/)
  assert.match(text, /tools:\s*WORKER_TOOLS/)
  assert.match(text, /\.\.\.workerExtra/)
  assert.match(text, /\.\.\.pingExtra|\bpingExtra\b/)
  assert.match(text, /cheap = \(name, prompt\) => step\(name, prompt, nextSchema, pingExtra\)/)
  assert.match(
    text,
    /agent\(\s*\n?\s*assembleImplementerPrompt\(\{ change, task, previousHandoffs \}\)/
  )
  assert.match(text, /\.\.\.workerExtra/)

  const agentCalls = [...text.matchAll(/^\s*agent\s*\(/gm)]
  assert.equal(agentCalls.length, 2, 'ship.js should have exactly two agent() calls (step + implementer)')
})
