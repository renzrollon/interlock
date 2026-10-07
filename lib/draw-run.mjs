// The handoff graph (draw-wave-plan-and-handoff-graph-from-the-cli, spec
// ship/diagrams): one ship run drawn from its trajectory, in sequence order, as
// lines and as a Mermaid `flowchart TD`.
//
// The trajectory sets the order, because it is the record the run guarantees
// reconstructable; the run's own wave state and manifest add what the
// trajectory never held — lane membership, handoff packets, briefing hashes —
// and only when they name the same run. A source that is absent, unreadable or
// another run's is named in the header and read for nothing.
//
// Two caveats are stated wherever they apply, never drawn around: implementer
// spawn times are the time the step was emitted (`wave-state next` logs every
// lane of a wave at once), not when the host started the agent; and a spawn
// with no recorded result reads `result: not recorded`, never as finished.
//
// Pure and Node-free, like `lib/draw-plan.mjs`: the CLI reads the files and
// hands over `{ value, read }`, because only it can tell an absent file from
// an unreadable one. The widths are `interlock limits`'s.

import { fitRow, laneLabel } from './lane.mjs'
import { LIMITS } from './limits.mjs'

/**
 * The trajectory types this module draws — `RUN_LOG_TYPES` of `lib/run-log.mjs`,
 * restated because that module reads files and cannot be imported Node-free. A
 * type outside it is counted in the header and drawn as nothing.
 */
const DRAWN_TYPES = new Set([
  'run-start',
  'wave-action',
  'cli-exit',
  'agent-spawn',
  'agent-result',
  'verify-judgement',
  'run-halt',
  'run-complete',
  'run-receipt'
])

/** The steps that run implementers, whose spawns are grouped beneath them. */
const IMPLEMENTER_STEPS = new Set(['run-batch', 'test-wave'])

const SPAWN_TIME_CAVEAT = 'spawn times are step-emission times, not host start times'

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const list = value => (Array.isArray(value) ? value : [])
const isText = value => typeof value === 'string' && value !== ''
const span = (first, last) => (first === last ? `[${first}]` : `[${first}-${last}]`)

/** A width the board draws at: a positive integer, else the published default. */
function boardWidth(columns) {
  return Number.isInteger(columns) && columns > 0 ? columns : LIMITS.waveBoardDefaultColumns
}

/**
 * One joined source: `this run` only when it was read and names `runId`.
 *
 * @returns {{word: string, value: object|null}}
 */
function joinSource(source, runId) {
  const read = isObject(source) ? source.read : 'absent'
  if (read === 'unreadable') return { word: 'unreadable', value: null }
  if (read !== 'ok' || !isObject(source.value)) return { word: 'absent', value: null }
  const id = source.value.runId
  if (isText(id) && id === runId) return { word: 'this run', value: source.value }
  return { word: `another run ${isText(id) ? id : '(no run id)'}`, value: null }
}

/** Every task of one state wave, in batch and lane order. */
function waveTasks(wave) {
  return list(isObject(wave) ? wave.batches : null)
    .flatMap(batch => list(batch))
    .flatMap(lane => list(lane))
    .filter(task => isObject(task) && isText(task.id))
}

/** `exit <code> · <ms>ms`, or what was not recorded. */
function exitText(exit) {
  if (!exit) return 'exit not recorded'
  const code = Number.isInteger(exit.exitCode) ? `exit ${exit.exitCode}` : 'exit not recorded'
  const ms = Number.isInteger(exit.durationMs) ? `${exit.durationMs}ms` : 'duration not recorded'
  return `${code} · ${ms}`
}

/**
 * The run as a sequence of items — nodes and implementer groups — with the
 * header, the caveat line and the lines nothing could place.
 */
function compose(run) {
  const input = isObject(run) ? run : {}
  const all = list(input.records).filter(isObject)
  const unsequenced = all.filter(r => !Number.isInteger(r.seq)).length
  const sequenced = all.filter(r => Number.isInteger(r.seq))
  const unknown = sequenced.filter(r => !DRAWN_TYPES.has(r.type)).length
  const torn = list(input.skipped).length
  // Sequence order, file order on a tie.
  const records = sequenced
    .map((record, at) => ({ record, at }))
    .filter(({ record }) => DRAWN_TYPES.has(record.type))
    .sort((a, b) => a.record.seq - b.record.seq || a.at - b.at)
    .map(({ record }) => record)

  const runId = isText(input.runId) ? input.runId : (records.find(r => isText(r.runId)) || {}).runId || '(no run id)'
  const change =
    (records.find(r => r.type === 'run-start' && isText(r.change)) || records.find(r => isText(r.change)) || {})
      .change || '(no change recorded)'
  const state = joinSource(input.state, runId)
  const manifest = joinSource(input.manifest, runId)
  const stateWaves = state.value ? list(state.value.waves) : []

  const items = []
  const consumed = new Set()
  const spawns = []
  const steps = []
  const receipts = []
  let group = null

  const nextOf = (from, stop, type) => {
    for (let j = from + 1; j < records.length; j++) {
      if (consumed.has(j)) continue
      if (records[j].type === type) return j
      if (stop.includes(records[j].type)) return -1
    }
    return -1
  }

  records.forEach((r, at) => {
    if (consumed.has(at)) return
    if (r.type !== 'agent-spawn' && r.type !== 'agent-result') group = null
    switch (r.type) {
      case 'wave-action': {
        const node = {
          kind: 'step',
          first: r.seq,
          last: r.seq,
          action: isText(r.action) ? r.action : 'unknown action',
          source: isText(r.source) ? r.source : 'source not recorded',
          waveIndex: Number.isInteger(r.waveIndex) ? r.waveIndex : null,
          exit: null,
          haltReason: null,
          packets: [],
          notes: []
        }
        const exit = nextOf(at, ['wave-action'], 'cli-exit')
        if (exit !== -1) {
          consumed.add(exit)
          node.exit = records[exit]
          node.last = Math.max(node.last, records[exit].seq)
        }
        if (node.action === 'halt') {
          const halt = nextOf(at, ['wave-action'], 'run-halt')
          if (halt !== -1) {
            consumed.add(halt)
            node.haltReason = isText(records[halt].reason) ? records[halt].reason : null
            node.last = Math.max(node.last, records[halt].seq)
          }
        }
        items.push(node)
        steps.push(node)
        if (IMPLEMENTER_STEPS.has(node.action)) group = { step: node, item: null }
        break
      }
      case 'agent-spawn': {
        const spawn = {
          seq: r.seq,
          label: isText(r.label) ? r.label : '(no label)',
          model: isText(r.model) ? r.model : null,
          kind: isText(r.kind) ? r.kind : 'other',
          result: null
        }
        spawns.push(spawn)
        if (spawn.kind === 'implementer' && group) {
          if (!group.item) {
            group.item = { kind: 'implementers', first: r.seq, last: r.seq, waveIndex: group.step.waveIndex, spawns: [] }
            items.push(group.item)
          }
          group.item.spawns.push(spawn)
          group.item.last = r.seq
        } else {
          group = null
          items.push({ kind: 'spawn', first: r.seq, last: r.seq, spawn })
        }
        break
      }
      case 'agent-result': {
        const label = isText(r.label) ? r.label : null
        const spawn = spawns.find(s => s.label === label && s.result === null)
        const result = `${isText(r.subtype) ? r.subtype : 'recorded'}${r.isError === true ? ' · error' : ''}`
        if (spawn) spawn.result = result
        else items.push({ kind: 'text', first: r.seq, last: r.seq, text: `result ${label ?? '(no label)'} · ${result} · no spawn to join` })
        break
      }
      case 'cli-exit': {
        const previous = items.at(-1)
        if (previous && previous.kind === 'judgement' && !previous.exit) {
          previous.exit = r
          previous.last = r.seq
        } else {
          items.push({ kind: 'text', first: r.seq, last: r.seq, text: `cli ${isText(r.command) ? r.command : '(no command)'} · ${exitText(r)}` })
        }
        break
      }
      case 'verify-judgement':
        items.push({
          kind: 'judgement',
          first: r.seq,
          last: r.seq,
          exit: null,
          text:
            `verify-judgement · ${isText(r.context) ? r.context : 'context not recorded'} · ` +
            `${r.halt === true ? 'halt' : 'no halt'}${isText(r.reason) ? ` · ${r.reason}` : ''}`
        })
        break
      case 'run-start':
        items.push({
          kind: 'text',
          first: r.seq,
          last: r.seq,
          text: `run-start · ${isText(r.mode) ? r.mode : 'mode not recorded'}${r.strict === true ? ' · strict' : ''}`
        })
        break
      case 'run-halt':
        items.push({ kind: 'halt', first: r.seq, last: r.seq, text: `halt · ${isText(r.reason) ? r.reason : 'no reason recorded'}` })
        break
      case 'run-complete':
        items.push({ kind: 'text', first: r.seq, last: r.seq, text: 'run-complete' })
        break
      case 'run-receipt': {
        const outcome = r.halted === true ? 'halted' : r.halted === false ? 'completed' : 'outcome not recorded'
        receipts.push({
          kind: 'receipt',
          first: r.seq,
          last: r.seq,
          text: `receipt · ${outcome} · ${r.committed === true ? 'committed' : 'not committed'}`
        })
        break
      }
    }
  })

  // A halt with no run-halt line takes the state's recorded reason.
  const stateHalt = state.value && isObject(state.value.halt) && isText(state.value.halt.reason) ? state.value.halt.reason : null
  for (const step of steps) if (step.action === 'halt' && !step.haltReason) step.haltReason = stateHalt

  // Packets: the previous position's tasks that hold one, under the step that
  // first enters each later position — the join `previousWaveHandoffs` makes.
  const entered = new Set()
  const firstEntry = new Map()
  for (const step of steps) {
    if (step.waveIndex === null || entered.has(step.waveIndex)) continue
    entered.add(step.waveIndex)
    firstEntry.set(step.waveIndex, step)
    if (step.waveIndex === 0 || !state.value) continue
    const handoffs = isObject(state.value.handoffs) ? state.value.handoffs : {}
    const audits = isObject(state.value.evidenceAudits) ? state.value.evidenceAudits : {}
    for (const task of waveTasks(stateWaves[step.waveIndex - 1])) {
      const packet = handoffs[task.id]
      if (!isObject(packet)) continue
      const audit = audits[task.id]
      step.packets.push({
        id: task.id,
        status: isText(packet.status) ? packet.status : 'no status recorded',
        verdict: isObject(audit) && isText(audit.verdict) ? audit.verdict : 'no audit recorded'
      })
    }
  }

  // Verify skips are recorded by group, so one lands on a step only when exactly
  // one reached boundary carries its group.
  const unplaced = []
  if (state.value) {
    const reached = new Set()
    for (const step of steps) {
      if (step.waveIndex === null) continue
      if (step.action === 'verify') reached.add(step.waveIndex)
      for (let i = 0; i < step.waveIndex; i++) reached.add(i)
    }
    const boundaryNode = i => steps.find(s => s.action === 'verify' && s.waveIndex === i) || firstEntry.get(i + 1)
    const byGroup = new Map()
    for (const skip of list(state.value.skippedVerifications).filter(isObject)) {
      const g = skip.wave ?? null
      if (!byGroup.has(g)) byGroup.set(g, [])
      byGroup.get(g).push(isText(skip.reason) ? skip.reason : 'no reason recorded')
    }
    for (const [g, reasons] of byGroup) {
      const boundaries = [...reached]
        .filter(i => i < stateWaves.length - 1 && isObject(stateWaves[i]) && (stateWaves[i].group ?? null) === g)
        .sort((a, b) => a - b)
      const counted = `${reasons.length} skip${reasons.length === 1 ? '' : 's'} for group ${g}`
      if (boundaries.length === 1 && boundaryNode(boundaries[0])) {
        boundaryNode(boundaries[0]).notes.push(...reasons.map(reason => `skip (group ${g}): ${reason}`))
      } else if (boundaries.length > 1 && boundaryNode(boundaries[0])) {
        const named = boundaries.map(i => `idx ${i}`)
        boundaryNode(boundaries[0]).notes.push(
          `${counted} · state does not say ${named.slice(0, -1).join(', ')} or ${named.at(-1)}`,
          ...reasons
        )
      } else {
        unplaced.push(`unplaced: ${counted} · no reached boundary carries that group · ${reasons.join(' · ')}`)
      }
    }
  }

  // Lane ids and briefing hashes, from the run's own state and manifest.
  const dispatched = manifest.value ? list(manifest.value.dispatched).filter(isObject) : null
  const used = new Set()
  for (const item of items) {
    if (item.kind !== 'implementers') continue
    const lanes = list(isObject(stateWaves[item.waveIndex]) ? stateWaves[item.waveIndex].batches : null)
      .flatMap(batch => list(batch))
      .map(lane => list(lane).filter(isObject))
      .filter(lane => lane.length > 0)
    for (const spawn of item.spawns) {
      const lane = state.value ? lanes.find(l => laneLabel(l) === spawn.label) : null
      spawn.ids = lane ? lane.map(task => task.id) : null
      if (dispatched) {
        const at = dispatched.findIndex((d, i) => !used.has(i) && d.label === spawn.label)
        if (at !== -1) used.add(at)
        spawn.sha = at !== -1 && isText(dispatched[at].sha) ? dispatched[at].sha.slice(0, 12) : null
      }
    }
  }

  const notDrawn = [
    ...(unsequenced ? [`${unsequenced} unsequenced`] : []),
    ...(unknown ? [`${unknown} unknown type`] : []),
    ...(torn ? [`${torn} unreadable line${torn === 1 ? '' : 's'}`] : [])
  ]
  // The change name is prose and goes last, so a narrow board cuts it before it
  // cuts a count or a source word — the order a lane row is cut in.
  const header =
    `run ${runId} · ${records.length} record${records.length === 1 ? '' : 's'}` +
    (notDrawn.length ? ` · not drawn: ${notDrawn.join(', ')}` : '') +
    ` · state.json: ${state.word} · run.json: ${manifest.word} · ${change}`

  const unanswered = spawns.filter(s => s.result === null).length
  const caveats = [
    ...(items.some(item => item.kind === 'implementers') ? [SPAWN_TIME_CAVEAT] : []),
    ...(unanswered ? [`${unanswered} of ${spawns.length} spawns: result not recorded`] : [])
  ]

  return {
    header,
    caveats: caveats.join(' · '),
    items: [...items, ...receipts],
    unplaced,
    path: isText(input.path) ? input.path : runId,
    sources: `state.json: ${state.word} · run.json: ${manifest.word}`,
    manifestJoined: dispatched !== null
  }
}

/** A node's text, without its sequence span. */
function nodeText(item) {
  switch (item.kind) {
    case 'step': {
      const at = item.waveIndex === null ? '' : ` idx ${item.waveIndex}`
      const reason = item.action === 'halt' && item.haltReason ? ` · ${item.haltReason}` : ''
      return [`${item.source} → ${item.action}${at} · ${exitText(item.exit)}${reason}`, ...item.notes].join(' · ')
    }
    case 'spawn': {
      const { spawn } = item
      return `spawn ${spawn.label} · ${spawn.kind}${spawn.model ? ` ${spawn.model}` : ''} · result: ${spawn.result ?? 'not recorded'}`
    }
    case 'judgement':
      return item.exit ? `${item.text} · ${exitText(item.exit)}` : item.text
    case 'implementers':
      return `idx ${item.waveIndex ?? '?'} · implementers ${span(item.first, item.last)}`
    default:
      return item.text
  }
}

/** One implementer's row, without its sequence span. */
function spawnRow(spawn, manifestJoined) {
  const cells = [`${spawn.label}${spawn.model ? ` ${spawn.model}` : ''}`, `result: ${spawn.result ?? 'not recorded'}`]
  if (spawn.ids) cells.push(`[${spawn.ids.join(', ')}]`)
  if (manifestJoined) cells.push(spawn.sha ? `sha ${spawn.sha}` : 'sha not recorded')
  return cells.join(' · ')
}

/**
 * The handoff graph as lines: a header naming the run and its sources, the
 * caveat line, then one node per ping, step and spawn in sequence order, the
 * receipt last. Every line at most `opts.columns` code points; below the
 * published minimum width, one spoken line.
 *
 * @param {{runId?: string, path?: string, records?: object[], skipped?: object[],
 *   state?: {value: object|null, read: string}, manifest?: {value: object|null, read: string}}} run
 * @param {{columns?: number}} [opts]
 * @returns {string[]}
 */
export function drawRunBoard(run, opts = {}) {
  const width = boardWidth(isObject(opts) ? opts.columns : undefined)
  if (width < LIMITS.waveBoardMinColumns) {
    return [`handoff board needs at least ${LIMITS.waveBoardMinColumns} columns; ${width} given`]
  }
  const drawn = compose(run)
  const lines = [drawn.header]
  if (drawn.caveats) lines.push(drawn.caveats)
  for (const item of drawn.items) {
    if (item.kind === 'receipt') for (const text of drawn.unplaced) lines.push(`  ${text}`)
    if (item.kind === 'implementers') {
      lines.push(`  ${nodeText(item)}`)
      for (const spawn of item.spawns) lines.push(`    [${spawn.seq}] ${spawnRow(spawn, drawn.manifestJoined)}`)
      continue
    }
    lines.push(`${span(item.first, item.last)} ${nodeText(item)}`)
    // One line per packet, so the cut never removes one.
    if (item.kind === 'step') for (const p of item.packets) lines.push(`  ↳ ${p.id} ${p.status} · ${p.verdict}`)
  }
  if (!drawn.items.some(item => item.kind === 'receipt')) for (const text of drawn.unplaced) lines.push(`  ${text}`)
  return lines.map(line => fitRow(line, width))
}

/** A Mermaid label, quoted: `"` is the one character a quoted label cannot hold. */
const label = text => `"${String(text).replace(/"/g, '#quot;')}"`

/** A node in its shape: verify steps hexagons, the halt a stadium, the receipt a subroutine. */
function shaped(id, item, text) {
  if (item.kind === 'step' && item.action === 'verify') return `${id}{{${label(text)}}}`
  if ((item.kind === 'step' && item.action === 'halt') || item.kind === 'halt') return `${id}([${label(text)}])`
  if (item.kind === 'receipt') return `${id}[[${label(text)}]]`
  return `${id}[${label(text)}]`
}

/**
 * The handoff graph as a Mermaid `flowchart TD`: nodes `n<seq>`, implementer
 * groups `I<seq>`, the edge into each step labelled with its source, and the
 * edge into the first step of each later position carrying the packets. Never
 * cut, and never styled.
 *
 * @param {object} run as for `drawRunBoard`
 * @returns {string[]}
 */
export function drawRunMermaid(run) {
  const drawn = compose(run)
  const out = ['flowchart TD', `  %% source: ${drawn.path} · ${drawn.sources}`]
  if (drawn.caveats) out.push(`  %% ${drawn.caveats}`)
  out.push(`  %% ${drawn.header}`)
  const chain = []
  for (const item of drawn.items) {
    if (item.kind === 'implementers') {
      const id = `I${item.first}`
      out.push(`  subgraph ${id}[${label(nodeText(item))}]`)
      for (const spawn of item.spawns) out.push(`    n${spawn.seq}[${label(`[${spawn.seq}] ${spawnRow(spawn, drawn.manifestJoined)}`)}]`)
      out.push('  end')
      chain.push({ id, item })
      continue
    }
    const id = `n${item.first}`
    out.push(`  ${shaped(id, item, `${span(item.first, item.last)} ${nodeText(item)}`)}`)
    chain.push({ id, item })
  }
  for (const text of drawn.unplaced) out.push(`  %% ${text}`)
  for (let i = 1; i < chain.length; i++) {
    const { id, item } = chain[i]
    if (item.kind === 'step') {
      const packets = item.packets.map(p => `${p.id} ${p.status}/${p.verdict}`)
      out.push(`  ${chain[i - 1].id} -->|${label([item.source, ...packets].join(' · '))}| ${id}`)
    } else {
      out.push(`  ${chain[i - 1].id} --> ${id}`)
    }
  }
  return out
}
