// The two arms, and the one thing that differs between them.
//
// Both arms use the same agent, the same model and the same fixture starting
// state. The loop arm runs the product — `interlock-ship-acp <change> --root
// <scratch>`, which is the lean ship loop the CLI emits as a program. The
// control arm removes the loop and nothing else: the same agent is prompted once
// per task in `tasks.md` order with the task text and nothing else, then the
// fixture's unit command runs, then a commit is made. No planner, no waves, no
// state machine, no `interlock` in the loop.
//
// Varying one thing is the entire point. A control on a different model or a
// different agent would answer nothing, because a difference between the arms
// could then be the harness rather than the loop (design D5).
//
// WHY THE LOOP ARM RUNS ON THE ACP HOST. `workflows/ship.js` needs the Workflow
// tool and cannot be driven from a shell. `bin/interlock-ship-acp` takes every
// decision from the same CLI and differs only in where its agents come from. The
// cost of that choice — no per-tier model routing, no interactive-runtime launch
// behaviour — is stated in `evals/ship/README.md` and carried on every row, not
// discovered by a reader later (design D1).

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAcpHost } from '../../lib/host/acp.mjs'
import { interlock, runUnitCommand, shell } from './graders.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The driver the loop arm runs. */
export const SHIP_ACP_BIN = join(HERE, '..', '..', 'bin', 'interlock-ship-acp')

/** The host identity carried on every row produced here. */
export const HOST_ID = 'acp'

/** Git identity for a commit the control arm makes. Fixed, so no row depends on a machine's config. */
const GIT_IDENTITY = [
  '-c',
  'user.name=Interlock Outcome Eval',
  '-c',
  'user.email=eval@interlock.invalid'
]

function messageOf(err) {
  return (err && err.message) || String(err)
}

/**
 * The environment an arm's agent runs under.
 *
 * `INTERLOCK_EVAL_USAGE_FILE` is where the committed agent appends what it
 * measured of its own token usage. It is deliberately OUTSIDE the scratch root:
 * a bookkeeping file inside the repository the run is committing would show up
 * in that run's own diff and in the paths the receipt records.
 */
export function armEnv({ agent, usageFile, env = process.env }) {
  return {
    ...env,
    INTERLOCK_ACP_COMMAND: agent.command,
    ...(usageFile ? { INTERLOCK_EVAL_USAGE_FILE: usageFile } : {})
  }
}

/** The run ids the scratch root's trajectory corpus holds, newest last. */
export function runIdsIn(root) {
  const listed = interlock(['run-log', 'list', '--root', root, '--json'])
  const runs = listed.json && Array.isArray(listed.json.runs) ? listed.json.runs : []
  return runs.map(r => (typeof r === 'string' ? r : r && r.runId)).filter(Boolean)
}

/** Agents the trajectory records this run having spawned. Absent, never zero, if unreadable. */
export function agentsSpawnedIn(root, runId) {
  if (!runId) return { value: null, reason: 'the run wrote no trajectory, so no spawn was recorded' }
  const queried = interlock([
    'run-log',
    'query',
    '--run',
    runId,
    '--type',
    'agent-spawn',
    '--root',
    root,
    '--json'
  ])
  if (!queried.json || !Array.isArray(queried.json.records)) {
    return { value: null, reason: `the trajectory's agent-spawn events could not be read` }
  }
  return { value: queried.json.records.length, reason: null }
}

/**
 * The loop arm: the product, run to termination against the scratch root.
 *
 * Never throws for a halted run — a halt is a graded outcome, not an error. It
 * reports transport-level failure (the driver would not start) separately,
 * because that is the eval's own apparatus failing rather than the loop.
 */
export function runLoopArm({ fixture, root, agent, usageFile, env = process.env, timeoutMs }) {
  const argv = [SHIP_ACP_BIN, fixture.change, '--root', root]
  const started = Date.now()
  const run = spawnSync(process.execPath, argv, {
    cwd: root,
    encoding: 'utf8',
    env: armEnv({ agent, usageFile, env }),
    maxBuffer: 64 * 1024 * 1024,
    ...(Number.isInteger(timeoutMs) && timeoutMs > 0 ? { timeout: timeoutMs } : {})
  })
  const wallClockMs = Date.now() - started

  const runIds = runIdsIn(root)
  const runId = runIds.length ? runIds[runIds.length - 1] : null

  return {
    arm: 'loop',
    ran: !run.error,
    reason: run.error ? messageOf(run.error) : null,
    command: `interlock-ship-acp ${fixture.change} --root <scratch>`,
    exitCode: run.status === null ? null : run.status,
    wallClockMs,
    runId,
    agentsSpawned: agentsSpawnedIn(root, runId),
    // Kept for the operator's console, never for the record: the history holds
    // counts and measures only, and stdout is unbounded text.
    stdout: run.stdout || '',
    stderr: run.stderr || ''
  }
}

/** The tasks a change declares, in `tasks.md` order, with the text a control prompt carries. */
export function readTasksInOrder(root, change) {
  const validated = interlock(['validate', change, '--root', root, '--json'])
  const items =
    validated.json && validated.json.tasks && Array.isArray(validated.json.tasks.items)
      ? validated.json.tasks.items
      : []
  return items
    .filter(t => typeof t.text === 'string' && t.text.trim())
    .map(t => ({ id: t.id, text: t.text.trim() }))
}

/**
 * The control arm: the same agent, the loop removed.
 *
 * One prompt per task, in order, carrying the task text and nothing else. No
 * result schema is imposed — this arm is graded from the scratch root's files
 * like the other one, and asking the agent to report on itself would put a claim
 * where the eval has promised to read a disk.
 *
 * A prompt whose transport failed is counted and named. If every prompt failed
 * that way the caller reads it as no signal rather than as a control arm that
 * did badly: an unreachable model is not a measurement.
 */
export async function runControlArm({
  fixture,
  root,
  agent,
  usageFile,
  env = process.env,
  timeoutMs,
  onLog = () => {}
}) {
  const tasks = readTasksInOrder(root, fixture.change)
  if (!tasks.length) {
    return {
      arm: 'control',
      ran: false,
      reason: `no task lines could be read from ${fixture.change}'s tasks.md in the scratch root`,
      command: 'one prompt per task, in tasks.md order',
      exitCode: null,
      wallClockMs: 0,
      runId: null,
      agentsSpawned: { value: null, reason: 'no prompt was sent' },
      prompts: { sent: 0, failed: 0 },
      stdout: '',
      stderr: ''
    }
  }

  const failures = []
  let host
  try {
    host = createAcpHost({
      command: agent.command,
      cwd: root,
      env: armEnv({ agent, usageFile, env }),
      ...(Number.isInteger(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {}),
      onEvent: event => {
        if (event && event.type === 'spawn-failed') failures.push(`${event.label}: ${event.error}`)
      }
    })
  } catch (err) {
    return {
      arm: 'control',
      ran: false,
      reason: `the control arm could not reach an agent: ${messageOf(err)}`,
      command: 'one prompt per task, in tasks.md order',
      exitCode: null,
      wallClockMs: 0,
      runId: null,
      agentsSpawned: { value: null, reason: 'no prompt was sent' },
      prompts: { sent: 0, failed: 0 },
      stdout: '',
      stderr: ''
    }
  }

  const started = Date.now()
  for (const task of tasks) {
    onLog(`    control prompt: ${task.id || task.text.slice(0, 40)}`)
    // Sequential on purpose. Parallelism is the loop's contribution, and a
    // control that ran its tasks concurrently would be measuring a second
    // difference nobody asked about.
    await host.spawn({ label: task.id || 'task', prompt: task.text })
  }

  // Then the fixture's own unit command, then a commit — the two steps the loop
  // ends with, kept so the arms end in the same shape. No repair round: a
  // control that repaired a red suite would be a loop with extra steps.
  const unit = runUnitCommand(fixture, root)
  const added = shell('git add -A', { cwd: root })
  const committed = spawnSync(
    'git',
    [...GIT_IDENTITY, 'commit', '-q', '--allow-empty', '-m', `control arm: ${fixture.change}`],
    { cwd: root, encoding: 'utf8' }
  )
  const wallClockMs = Date.now() - started

  return {
    arm: 'control',
    ran: failures.length < tasks.length,
    reason:
      failures.length >= tasks.length
        ? `every one of the ${tasks.length} control prompts failed in transport: ${failures[0]}`
        : null,
    command: 'one prompt per task, in tasks.md order, then the unit command, then a commit',
    exitCode: committed.status === null ? null : committed.status,
    wallClockMs,
    runId: null,
    // The control arm's agent count is exact: it spawned one per prompt, and
    // nothing else spawned anything.
    agentsSpawned: { value: tasks.length, reason: null },
    prompts: { sent: tasks.length, failed: failures.length },
    unit: { exitCode: unit.exitCode, total: unit.total, failed: unit.failed },
    stdout: `${added.stdout || ''}${committed.stdout || ''}`,
    stderr: `${added.stderr || ''}${committed.stderr || ''}${failures.join('\n')}`
  }
}

// --- what the agent measured of itself --------------------------------------

/**
 * Sum the usage records the eval's own agent appended.
 *
 * This is an APPARATUS measurement, and it is kept structurally apart from the
 * receipt's `outputTokens` for that reason (design D8). The receipt's figure is
 * the loop's own accounting, absent on this host with the host's stated reason;
 * this one is what the eval's agent read off the API responses it made itself.
 * Merging them would let an apparatus measurement masquerade as a product one.
 *
 * A missing file is "not measured", carried as `null` with its reason — never
 * as a zero, which would be indistinguishable from an agent that made no call.
 */
export function readAgentUsage(usageFile) {
  const absent = reason => ({
    requests: null,
    inputTokens: null,
    outputTokens: null,
    reason
  })
  if (!usageFile) return absent('no usage file was requested of the agent')
  if (!existsSync(usageFile)) {
    return absent(
      'the agent wrote no usage record — an operator-supplied agent does not write one, and ' +
        'an agent that never reached the model has nothing to write'
    )
  }
  try {
    const tally = { requests: 0, inputTokens: 0, outputTokens: 0 }
    let records = 0
    for (const line of readFileSync(usageFile, 'utf8').split('\n')) {
      if (!line.trim()) continue
      let parsed
      try {
        parsed = JSON.parse(line)
      } catch {
        // A torn line costs that record, not the file — the same rule every
        // other line-oriented corpus here is read under.
        continue
      }
      if (!parsed || typeof parsed !== 'object') continue
      records++
      tally.requests += Number(parsed.requests) || 0
      tally.inputTokens += Number(parsed.inputTokens) || 0
      tally.outputTokens += Number(parsed.outputTokens) || 0
    }
    if (!records) return absent('the usage file holds no readable record')
    return { ...tally, reason: null }
  } catch (err) {
    return absent(`the usage file could not be read: ${messageOf(err)}`)
  }
}

/**
 * What a measured usage tally cost, at a published price table.
 *
 * `null` with a reason for a model the table does not price — never a zero, and
 * never a tier guessed from the model's name. An unpriced run still runs; it
 * simply cannot be counted against the ceiling, and the sweep says so.
 */
export function priceUsage(usage, model, prices) {
  const table = prices && prices.perMillionTokens ? prices.perMillionTokens : null
  if (!table) return { usd: null, reason: 'no price table was available' }
  if (!usage || usage.inputTokens === null || usage.outputTokens === null) {
    return { usd: null, reason: usage && usage.reason ? usage.reason : 'no usage was measured' }
  }
  const entry = table[model]
  if (!entry) {
    return {
      usd: null,
      reason: `${prices.id} prices no model named "${model}" — the spend is unpriced rather than estimated`
    }
  }
  const usd =
    (usage.inputTokens / 1e6) * Number(entry.input) + (usage.outputTokens / 1e6) * Number(entry.output)
  return { usd: Math.round(usd * 10000) / 10000, reason: null }
}
