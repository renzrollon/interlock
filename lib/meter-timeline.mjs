// The ship meter's step timeline: what each step the CLI printed says, and the
// order the pane lays the steps, the agents they spawned and the agents no
// step names in.
//
// A step's words are its own fields, verbatim: the action, its position, how
// many lanes a batch dispatched, a skipped verification's reason, a halt's
// reason and the plan size a step relayed. No word here is a verdict, a cause
// or a state the step did not carry.
//
// The order is pure data over plain inputs, so it is pinned under Node
// (`test/spine/meter-timeline.test.mjs`) and the hooks module only draws it:
//
// - The top level is the launch, every step and every relay agent no step
//   names, laid by time. An entry with a time sorts by it, ties keeping their
//   input order (the launch, then the steps as they crossed, then the relays as
//   first seen); an entry with no time follows every timed one, in input order.
// - Beneath a step, at depth 1, the agents it spawned: a spawn is joined to an
//   agent by its briefing hash, one agent per spawn in step order (an agent
//   beyond the spawns that carry its hash stays with the last of them). The
//   joined spawns are laid by their agent's first request time, by the same
//   rule; the spawns no agent has joined yet follow, `waiting`, in the step's
//   spawn order. A step's relay is drawn on the step's own line and nowhere
//   else.
// - Last, the agents nothing names, under one head, in first-seen order.
//
// Pure and Node-free: the hooks module runs in the engine with no Node, and
// imports this file.

/** The actions that dispatch a batch of lanes. */
export const BATCH_ACTIONS = new Set(['run-batch', 'test-wave'])

const isInt = v => Number.isInteger(v)
const isTime = v => typeof v === 'number' && Number.isFinite(v)
const str = v => (typeof v === 'string' && v ? v : null)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** `batch <j>/<k>`, one-based, as the status line says it; `null` when the step carries no position. */
export function batchText(batchIndex, batchCount) {
  return isInt(batchIndex) && isInt(batchCount) ? `batch ${batchIndex + 1}/${batchCount}` : null
}

/** How many lanes run side by side: `N in parallel`, `1 lane`, or `null` for none. */
export function laneCountText(n) {
  if (!isInt(n) || n < 1) return null
  return n === 1 ? '1 lane' : `${n} in parallel`
}

/** The waves a plan summary holds, its test wave counted; `null` for anything that is not a summary. */
export function planWaveCount(plan) {
  if (plan === null || typeof plan !== 'object' || !Array.isArray(plan.waves)) return null
  return plan.waves.length + (plan.testWave ? 1 : 0)
}

/** A step's words, from its own fields only. */
export function stepText(step) {
  const s = step && typeof step === 'object' ? step : {}
  const parts = [String(s.action)]
  if (s.wave !== undefined && s.wave !== null) parts.push(`wave ${s.wave}`)
  const batch = batchText(s.batchIndex, s.batchCount)
  if (batch) parts.push(batch)
  if (BATCH_ACTIONS.has(s.action)) {
    const lanes = laneCountText(Array.isArray(s.spawns) ? s.spawns.length : 0)
    if (lanes) parts.push(lanes)
  }
  if (s.action === 'verify' && s.skipped === true) parts.push(str(s.reason) ? `skipped: ${s.reason}` : 'skipped')
  if (s.action === 'halt' && str(s.reason)) parts.push(s.reason)
  if (isInt(s.planWaves)) parts.push(`plan: ${plural(s.planWaves, 'wave')}`)
  return parts.join(' · ')
}

/** The entries with a time laid by it, ties in input order; then the entries with none, in input order. */
function byTime(entries) {
  const timed = entries.map((entry, i) => ({ entry, i })).filter(({ entry }) => isTime(entry.at))
  timed.sort((a, b) => a.entry.at - b.entry.at || a.i - b.i)
  return [...timed.map(({ entry }) => entry), ...entries.filter(entry => !isTime(entry.at))]
}

/**
 * The timeline as ordered display entries, each `{ key, kind, at, depth, ... }`:
 * `launch` (`name`), `step` (`step`), `spawn` (`step`, `spawn`, `agent` or
 * `null` while it waits), `relay` (`agent`, a relay agent no step names),
 * `unmatched-head`, and `unmatched` (`agent`). An agent's entry is keyed
 * `agent-<id>`, a waiting spawn's `spawn-<n>-<label>`, a step's `step-<n>`.
 *
 * @param {{
 *   steps?: {n: number, at: number|null, action: string, wave?: unknown, waveIndex?: unknown, batchIndex?: unknown,
 *     batchCount?: unknown, skipped?: unknown, reason?: unknown, planWaves?: number|null, relayId?: string|null,
 *     spawns: {label: string, title: string, sha: string|null}[]}[],
 *   agents?: {id: string, sha?: string|null, relay?: string|null, firstAt?: number|null}[],
 *   launch?: {at: number|null, name?: string|null}|null
 * }} input
 * @returns {object[]}
 */
export function timeline({ steps = [], agents = [], launch = null } = {}) {
  const relays = new Set(steps.map(step => str(step.relayId)).filter(Boolean))

  // Each spawn carrying a hash, in step order, and the agents carrying it, first seen first.
  const slots = new Map()
  const spawnsOf = step => (Array.isArray(step.spawns) ? step.spawns : [])
  steps.forEach((step, i) =>
    spawnsOf(step).forEach((spawn, j) => {
      const sha = str(spawn.sha)
      if (!sha) return
      if (!slots.has(sha)) slots.set(sha, [])
      slots.get(sha).push({ pos: `${i}:${j}`, agents: [] })
    })
  )
  const placed = new Set()
  const counts = new Map()
  for (const agent of agents) {
    const sha = str(agent.sha)
    if (!sha || relays.has(agent.id) || !slots.has(sha)) continue
    const held = slots.get(sha)
    const at = counts.get(sha) || 0
    held[Math.min(at, held.length - 1)].agents.push(agent)
    counts.set(sha, at + 1)
    placed.add(agent.id)
  }
  const joinedBy = new Map()
  for (const held of slots.values()) for (const slot of held) joinedBy.set(slot.pos, slot.agents)

  const top = []
  if (launch && typeof launch === 'object') {
    top.push({ key: 'launch', kind: 'launch', at: isTime(launch.at) ? launch.at : null, depth: 0, name: str(launch.name) })
  }
  for (const step of steps) top.push({ key: `step-${step.n}`, kind: 'step', at: isTime(step.at) ? step.at : null, depth: 0, step })
  const orphans = agents.filter(agent => str(agent.relay) && !relays.has(agent.id) && !placed.has(agent.id))
  for (const agent of orphans) {
    top.push({ key: `agent-${agent.id}`, kind: 'relay', at: isTime(agent.firstAt) ? agent.firstAt : null, depth: 0, agent })
    placed.add(agent.id)
  }

  const out = []
  for (const entry of byTime(top)) {
    out.push(entry)
    if (entry.kind !== 'step') continue
    const i = steps.indexOf(entry.step)
    const joined = []
    const waiting = []
    for (const [j, spawn] of spawnsOf(entry.step).entries()) {
      const held = joinedBy.get(`${i}:${j}`) || []
      if (!held.length) {
        waiting.push({ key: `spawn-${entry.step.n}-${spawn.label}`, kind: 'spawn', at: null, depth: 1, step: entry.step, spawn, agent: null })
      }
      for (const agent of held) {
        const at = isTime(agent.firstAt) ? agent.firstAt : null
        joined.push({ key: `agent-${agent.id}`, kind: 'spawn', at, depth: 1, step: entry.step, spawn, agent })
      }
    }
    out.push(...byTime(joined), ...waiting)
  }

  const unmatched = agents.filter(agent => !relays.has(agent.id) && !placed.has(agent.id))
  if (unmatched.length) {
    out.push({ key: 'agents-unmatched-head', kind: 'unmatched-head', at: null, depth: 0 })
    for (const agent of unmatched) {
      out.push({ key: `agent-${agent.id}`, kind: 'unmatched', at: isTime(agent.firstAt) ? agent.firstAt : null, depth: 1, agent })
    }
  }
  return out
}
