// The wave board and the Mermaid plan (draw-wave-plan-and-handoff-graph-from-the-cli,
// spec ship/diagrams): a plan drawn as lines, with an optional overlay from the
// wave state.
//
// Every word on the board is one field of one record. Waves are keyed by
// position, never by group: dependency layering emits a later layer under the
// same section number, so a board keyed by group would fold two waves into one.
// Lanes are named by `lib/lane.mjs`, the rule their spawn titles, briefing files
// and trajectory lines are named by. Where the state does not force an
// attribution — a skip recorded by group over two waves of that group, a
// failure id no lane carries — the board says so rather than guess.
//
// Pure and Node-free: no file, no environment, no terminal, no clock. The CLI
// reads the plan and the state and resolves the width; the ship meter's hooks
// module can import this file because its closure is `lib/lane.mjs` and
// `lib/limits.mjs` only (`test/spine/draw-plan.test.mjs` walks it). The widths
// are `interlock limits`'s.

import { TITLE_SEPARATOR, fitRow, laneEffort, laneLabel, laneModel, laneTier, laneTitle } from './lane.mjs'
import { LIMITS } from './limits.mjs'

/** The words a lane's state cell may read, each the state's own record. */
export const STATE_WORDS = Object.freeze(['ok', 'failed', 'current', 'pending', 'not reached', 'not recorded'])

const [OK, FAILED, CURRENT, PENDING, NOT_REACHED, NOT_RECORDED] = STATE_WORDS
const PER_TASK = 'per task'
const TAIL = 'then: verify-final → commit → close'

// Cell widths, so a board's columns align: the longest model name, the longest
// effort word (`inherit`) and the longest state word (`not recorded`).
const MODEL_CELL = 6
const EFFORT_CELL = 7
const STATE_CELL = 12

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const list = value => (Array.isArray(value) ? value : [])
const isText = value => typeof value === 'string' && value !== ''
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : /(ch|sh|s|x)$/.test(word) ? 'es' : 's'}`

/** A width the board draws at: a positive integer, else the published default. */
function boardWidth(columns) {
  return Number.isInteger(columns) && columns > 0 ? columns : LIMITS.waveBoardDefaultColumns
}

/** A lane as drawn: an array of task objects, never empty. */
function lanesOfBatch(batch) {
  return list(batch)
    .map(lane => list(lane).filter(isObject))
    .filter(lane => lane.length > 0)
}

/**
 * The plan's positions: every wave holding a batch, in plan order, then the
 * test wave — the waves `createRunState` keeps, so position `i` here is
 * `state.waves[i]` there.
 */
function positionsOf(plan) {
  if (!isObject(plan)) return []
  const waves = list(plan.waves).filter(isObject).map(wave => ({ wave, test: false }))
  if (isObject(plan.testWave)) waves.push({ wave: plan.testWave, test: true })
  return waves
    .map(({ wave, test }) => ({
      test,
      group: wave.group ?? null,
      // A plan written before waves carried a kind is an implementation plan.
      kind: test ? 'test' : wave.kind === 'test' ? 'test' : 'impl',
      red: wave.red === true,
      batches: list(wave.batches).map(lanesOfBatch).filter(batch => batch.length > 0)
    }))
    .filter(position => position.batches.length > 0)
    .map((position, index) => ({ ...position, index }))
}

/** The text a wave's top rule carries. */
function waveTitle(position) {
  const batches = plural(position.batches.length, 'batch')
  if (position.test) return `test wave · idx ${position.index} · test · ${batches}`
  const group = position.group === null ? '?' : position.group
  return (
    `wave ${position.index + 1} · idx ${position.index} · group ${group} · ${position.kind} · ${batches}` +
    (position.red ? ' · RED' : '')
  )
}

/**
 * The ids a lane was ordered after: the union of the `after` ids of the plan's
 * own deferral records for the lane's tasks, minus the lane's own ids, in
 * record order. Never recomputed from a task's `dependsOn`.
 */
function orderedAfter(lane, deferred) {
  const own = new Set(lane.map(task => task.id))
  const out = []
  for (const record of deferred) {
    if (!own.has(record.id)) continue
    for (const id of list(record.after)) if (isText(id) && !own.has(id) && !out.includes(id)) out.push(id)
  }
  return out
}

/** A skip that carries the wave position its verify step ran at. */
const isPositioned = skip => Number.isInteger(skip.waveIndex) && skip.waveIndex >= 0

/** What the overlay can say, read once from the state. */
function overlayOf(state, positions) {
  if (!isObject(state)) return null
  const stateWaves = list(state.waves)
  const cursor = isObject(state.cursor) ? state.cursor : {}
  const halt = isObject(state.halt) ? state.halt : null
  return {
    runId: isText(state.runId) ? state.runId : null,
    waveCount: stateWaves.length,
    // Applied by position only when the state walks the plan's own positions.
    positional: stateWaves.length === positions.length,
    completed: new Set(list(state.completed).filter(isText)),
    failures: list(state.failures).filter(f => isObject(f) && isText(f.id)),
    skips: list(state.skippedVerifications).filter(isObject),
    positionedSkips: list(state.skippedVerifications)
      .filter(skip => isObject(skip) && isPositioned(skip))
      .map(skip => ({ index: skip.waveIndex, reason: isText(skip.reason) ? skip.reason : 'no reason recorded' })),
    unresolved: list(state.unresolved).filter(isObject),
    cursor: {
      wave: Number.isInteger(cursor.waveIndex) ? cursor.waveIndex : null,
      batch: Number.isInteger(cursor.batchIndex) ? cursor.batchIndex : null,
      phase: typeof cursor.phase === 'string' ? cursor.phase : null
    },
    halted: halt !== null,
    haltReason: halt && isText(halt.reason) ? halt.reason : null
  }
}

/** The word the state records for one task at `position`, `batch`; '' for none. */
function taskWord(overlay, id, position, batch) {
  if (overlay.failures.some(f => f.id === id)) return FAILED
  if (overlay.completed.has(id)) return OK
  const { cursor } = overlay
  if (!overlay.positional || cursor.wave === null) return ''
  const inBatch = cursor.phase === 'batch'
  if (position < cursor.wave || (position === cursor.wave && (!inBatch || (cursor.batch !== null && batch < cursor.batch)))) {
    return NOT_RECORDED
  }
  if (position === cursor.wave && inBatch && batch === cursor.batch) return CURRENT
  return overlay.halted ? NOT_REACHED : PENDING
}

/** A lane's state cell and ids cell: one word when its tasks agree, else per task. */
function laneCells(overlay, lane, position, batch) {
  const ids = lane.map(task => task.id)
  if (!overlay) return { word: null, ids: ids.length > 1 ? ids.join(', ') : null }
  const words = lane.map(task => taskWord(overlay, task.id, position, batch))
  if (words.every(word => word === words[0])) {
    return { word: words[0], ids: ids.length > 1 ? ids.join(', ') : null }
  }
  return { word: PER_TASK, ids: ids.map((id, i) => (words[i] ? `${id} ${words[i]}` : id)).join(', ') }
}

/**
 * The overlay's text for each verify boundary (boundary `i` sits between
 * position `i` and `i + 1`), plus what it could not place.
 *
 * Skips and unresolved checks are recorded by group, so they are placed by
 * group: on the one boundary whose left wave carries that group, or, when two
 * or more do, as an ambiguity on the first that says which boundaries the state
 * does not tell apart. The cursor is not used to break the tie.
 */
function verifyTexts(overlay, positions) {
  const texts = positions.slice(0, -1).map(() => [])
  const unplaced = []
  if (!overlay || !overlay.positional) return { texts, unplaced }
  const { cursor } = overlay
  const after = overlay.halted ? NOT_REACHED : PENDING
  if (cursor.wave !== null) {
    texts.forEach((text, i) => {
      if (i === cursor.wave && cursor.phase === 'verify') text.push(CURRENT)
      else if (i >= cursor.wave) text.push(after)
    })
  }

  const groups = []
  const byGroup = new Map()
  const entry = group => {
    if (!byGroup.has(group)) {
      byGroup.set(group, { skips: [], unresolved: [] })
      groups.push(group)
    }
    return byGroup.get(group)
  }
  for (const skip of overlay.skips.filter(skip => !isPositioned(skip))) {
    entry(skip.wave ?? null).skips.push(isText(skip.reason) ? skip.reason : 'no reason recorded')
  }
  for (const u of overlay.unresolved) {
    entry(u.wave ?? null).unresolved.push(`unresolved after ${Number.isInteger(u.attempts) ? u.attempts : '?'} attempts`)
  }

  // A skip the overlay recorded with its wave position — the ship meter's,
  // read off the verify step (draw-the-wave-board-in-the-meter-pane D6) — is
  // placed by it: the position says which boundary, so no group is guessed.
  const touched = new Set()
  for (const { index, reason } of overlay.positionedSkips) {
    if (index < texts.length) {
      texts[index].push(`skipped: ${reason}`)
      touched.add(index)
    } else unplaced.push(`  unplaced: skip at idx ${index} · no verify boundary follows that position · ${reason}`)
  }
  for (const group of groups) {
    const { skips, unresolved } = byGroup.get(group)
    const recorded = [...skips.map(reason => `skipped: ${reason}`), ...unresolved]
    const boundaries = texts.map((_, i) => i).filter(i => positions[i].group === group)
    if (boundaries.length === 1) {
      texts[boundaries[0]].push(...recorded)
      touched.add(boundaries[0])
      continue
    }
    const counted = [
      ...(skips.length ? [`${skips.length} skip${skips.length === 1 ? '' : 's'}`] : []),
      ...(unresolved.length ? [`${unresolved.length} unresolved`] : [])
    ].join(' and ')
    const reasons = [...skips, ...unresolved]
    if (boundaries.length === 0) {
      unplaced.push(`  unplaced: ${counted} for group ${group} · no boundary carries that group · ${reasons.join(' · ')}`)
      continue
    }
    const [first, ...later] = boundaries
    const named = boundaries.map(i => `idx ${i}`)
    const which = `${named.slice(0, -1).join(', ')} or ${named.at(-1)}`
    texts[first].push(`${counted} for group ${group} · state does not say ${which}`, ...reasons)
    touched.add(first)
    for (const i of later) {
      texts[i].push(`group ${group} skips: see idx ${first}`)
      touched.add(i)
    }
  }

  // A check that passed leaves no record, so a reached boundary with nothing
  // recorded says exactly that, never `passed`.
  if (cursor.wave !== null) {
    texts.forEach((text, i) => {
      if (i < cursor.wave && !touched.has(i)) text.push('no skip recorded')
    })
  }
  return { texts, unplaced }
}

/** Each failure whose id no planned lane carries, by the wave the state recorded. */
function unplacedFailures(overlay, planned) {
  if (!overlay) return []
  return overlay.failures
    .filter(f => !planned.has(f.id))
    .map(f => {
      const where = `wave ${f.wave ?? '?'}${isText(f.waveKind) ? ` ${f.waveKind}` : ''}`
      const error = isText(f.error) ? `error: ${f.error}` : 'no error recorded'
      return `  unplaced: ${f.id} · ${where} · ${error}`
    })
}

/** The overlay's part of the header (and of the Mermaid source comment). */
function overlayHeader(overlay, positions, stateNote, { short = false } = {}) {
  if (!overlay) return `plan only${isText(stateNote) ? ` (${stateNote})` : ''}`
  if (!overlay.positional) {
    return short
      ? 'overlay by task id only'
      : `overlay by task id only: state has ${overlay.waveCount} waves, plan has ${positions.length}`
  }
  const run = `run ${overlay.runId ? overlay.runId.slice(0, 8) : '?'}`
  if (short) return run
  const { cursor } = overlay
  const at =
    cursor.wave === null
      ? ' · cursor not recorded'
      : ` · cursor idx ${cursor.wave}${cursor.phase === 'batch' && cursor.batch !== null ? ` b${cursor.batch}` : ''}` +
        (cursor.phase === 'verify' ? ' · verify' : '')
  return `${run}${at}${overlay.halted ? ' · halted' : ''}`
}

/** Every lane of every position, with what a row or a node draws of it. */
function lanesOf(positions, plan) {
  const deferred = list(isObject(plan) ? plan.deferred : null).filter(r => isObject(r) && isText(r.id))
  const out = []
  for (const position of positions) {
    position.batches.forEach((batch, b) => {
      for (const lane of batch) {
        const label = laneLabel(lane)
        const title = laneTitle(lane)
        const prefix = `${label}${TITLE_SEPARATOR}`
        const tier = laneTier(lane)
        out.push({
          lane,
          position: position.index,
          batch: b,
          label,
          title,
          gist: title.startsWith(prefix) ? title.slice(prefix.length) : '',
          model: laneModel(lane),
          tier: tier > 0 ? String(tier) : '?',
          effort: laneEffort(lane) ?? 'inherit',
          after: orderedAfter(lane, deferred)
        })
      }
    })
  }
  return out
}

/** A top rule: its text, then `─` to exactly the width. */
function topRule(text, width) {
  const head = `┌─ ${text} `
  const length = [...head].length
  return length >= width ? fitRow(head, width) : `${head}${'─'.repeat(width - length)}`
}

/**
 * The plan as rows of `{ key, text }`: `header`, `wave:<i>`, `lane:<label>`,
 * `wave:<i>:end`, `verify:<i>`, `unplaced:<n>`, `tail`.
 */
function boardRows(plan, opts) {
  const width = boardWidth(opts.columns)
  if (width < LIMITS.waveBoardMinColumns) {
    return [{ key: 'header', text: `wave board needs at least ${LIMITS.waveBoardMinColumns} columns; ${width} given` }]
  }
  const positions = positionsOf(plan)
  const overlay = overlayOf(opts.state, positions)
  const lanes = lanesOf(positions, plan)
  const planned = new Set(lanes.flatMap(l => l.lane.map(task => task.id)))
  const notes = new Map(Object.entries(isObject(opts.notes) ? opts.notes : {}).filter(([, text]) => isText(text)))
  const mode = overlayHeader(overlay, positions, opts.stateNote)
  const rows = []
  const push = (key, text) => rows.push({ key, text: fitRow(text, width) })

  push(
    'header',
    positions.length === 0
      ? `plan · holds no waves · ${mode}`
      : `plan · ${plural(positions.length, 'wave')} · ${plural(planned.size, 'task')} · ${mode}`
  )

  const labelCell = Math.max(0, ...lanes.map(l => l.label.length))
  const batchCell = Math.max(0, ...lanes.map(l => `b${l.batch}`.length))
  const { texts, unplaced } = verifyTexts(overlay, positions)
  for (const position of positions) {
    if (position.index > 0) {
      const i = position.index - 1
      push(`verify:${i}`, [`  verify after idx ${i}`, ...texts[i]].join(' · '))
    }
    push(`wave:${position.index}`, topRule(waveTitle(position), width))
    for (const l of lanes.filter(l => l.position === position.index)) {
      const { word, ids } = laneCells(overlay, l.lane, l.position, l.batch)
      const cells = [
        '│',
        `b${l.batch}`.padEnd(batchCell),
        l.label.padEnd(labelCell),
        l.model.padEnd(MODEL_CELL),
        `T${l.tier}`,
        l.effort.padEnd(EFFORT_CELL)
      ]
      // A note is what a host observed of this lane, appended verbatim after the
      // state word; the gist after it gives way first when the row is cut.
      const note = notes.get(l.label)
      if (overlay) cells.push(note ? `${word || ''} ${note}`.trimStart() : (word || '').padEnd(STATE_CELL))
      else if (note) cells.push(note)
      if (ids) cells.push(`[${ids}]`)
      if (l.after.length) cells.push(`←${l.after.join(',')}`)
      const head = cells.join(' ')
      push(`lane:${l.label}`, l.gist ? `${head}${TITLE_SEPARATOR}${l.gist}` : head.trimEnd())
    }
    push(`wave:${position.index}:end`, `└${'─'.repeat(width - 1)}`)
  }

  const spoken = [...unplacedFailures(overlay, planned), ...unplaced]
  spoken.forEach((text, n) => push(`unplaced:${n}`, text))
  const halted = overlay && overlay.halted ? ` · halted${overlay.haltReason ? `: ${overlay.haltReason}` : ''}` : ''
  push('tail', `${TAIL}${halted}`)
  return rows
}

/**
 * The wave board as keyed rows, for a drawer that keys what it draws — the ship
 * meter's pane (draw-the-wave-board-in-the-meter-pane design D7, D10). Keys:
 * `header`, `wave:<i>`, `lane:<label>` (the label its spawn, briefing and
 * trajectory line carry), `wave:<i>:end`, `verify:<i>`, `unplaced:<n>` and
 * `tail`. Below the published minimum width, the one spoken row, keyed
 * `header`: a board always ends in `tail`, and the spoken line never does.
 *
 * `opts.notes` maps a lane label to text a host observed of that lane; it is
 * appended verbatim after the lane's state word and cut with the row. A label
 * no lane carries is drawn nowhere.
 *
 * @param {unknown} plan what `planWaves` emits, or a plan summary; any value draws
 * @param {{columns?: number, state?: object|null, stateNote?: string, notes?: Record<string, string>}} [opts]
 * @returns {{key: string, text: string}[]}
 */
export function drawPlanBoardRows(plan, opts = {}) {
  return boardRows(plan, isObject(opts) ? opts : {})
}

/**
 * The wave board: one bordered block per wave position, one row per lane, a
 * verify cell at each boundary and a tail, every line at most `opts.columns`
 * code points. Below the published minimum width, one spoken line. The texts
 * of `drawPlanBoardRows`, in order.
 *
 * @param {unknown} plan what `planWaves` emits; any value draws, a non-plan as no waves
 * @param {{columns?: number, state?: object|null, stateNote?: string, notes?: Record<string, string>}} [opts]
 * @returns {string[]}
 */
export function drawPlanBoard(plan, opts = {}) {
  return drawPlanBoardRows(plan, opts).map(row => row.text)
}

/** A Mermaid label, quoted: `"` is the one character a quoted label cannot hold. */
const label = text => `"${String(text).replace(/"/g, '#quot;')}"`

/** Node ids from lane labels, so the same plan renders to the same text. */
function laneIds(lanes) {
  const used = new Map()
  return lanes.map(l => {
    const base = `L${l.label.replace(/\./g, '_').replace(/\+/g, 'p').replace(/[^A-Za-z0-9_]/g, '_')}`
    const n = (used.get(base) ?? 0) + 1
    used.set(base, n)
    return n === 1 ? base : `${base}_${n}`
  })
}

/**
 * The plan as a Mermaid `flowchart LR`: a subgraph per wave position (and per
 * batch of a multi-batch wave), a node per lane, dotted `dependsOn` edges from
 * the plan's deferral records, hexagon verify gates and subroutine closing
 * gates. Never cut, and never styled.
 *
 * @param {unknown} plan
 * @param {{state?: object|null, stateNote?: string, source?: string}} [opts]
 * @returns {string[]}
 */
export function drawPlanMermaid(plan, opts = {}) {
  const options = isObject(opts) ? opts : {}
  const positions = positionsOf(plan)
  const overlay = overlayOf(options.state, positions)
  const lanes = lanesOf(positions, plan)
  const ids = laneIds(lanes)
  const source = isText(options.source) ? options.source : 'plan'
  const out = ['flowchart LR', `  %% source: ${source} · ${overlayHeader(overlay, positions, options.stateNote, { short: true })}`]

  const node = (l, i, indent) => {
    const { word, ids: cell } = laneCells(overlay, l.lane, l.position, l.batch)
    const state = word === PER_TASK ? ` · ${PER_TASK} [${cell}]` : word ? ` · ${word}` : ''
    return `${indent}${ids[i]}[${label(`${l.title} · ${l.model} T${l.tier} ${l.effort}${state}`)}]`
  }

  for (const position of positions) {
    out.push(`  subgraph W${position.index}[${label(waveTitle(position))}]`)
    const members = lanes.map((l, i) => ({ l, i })).filter(({ l }) => l.position === position.index)
    if (position.batches.length === 1) {
      for (const { l, i } of members) out.push(node(l, i, '    '))
    } else {
      position.batches.forEach((_, b) => {
        out.push(`    subgraph W${position.index}B${b}[${label(`b${b}`)}]`)
        for (const { l, i } of members.filter(({ l }) => l.batch === b)) out.push(node(l, i, '      '))
        out.push('    end')
      })
      out.push(`    ${position.batches.map((_, b) => `W${position.index}B${b}`).join(' --> ')}`)
    }
    out.push('  end')
  }

  const { texts } = verifyTexts(overlay, positions)
  const chain = []
  for (const position of positions) {
    if (position.index > 0) {
      const i = position.index - 1
      chain.push(`V${i}{{${label([`verify after idx ${i}`, ...texts[i]].join(' · '))}}}`)
    }
    chain.push(`W${position.index}`)
  }
  chain.push(`VF[[${label('verify-final')}]]`, `C[[${label('commit')}]]`, `X[[${label('close')}]]`)
  out.push(`  ${chain.join(' --> ')}`)

  const laneOf = new Map()
  lanes.forEach((l, i) => {
    for (const task of l.lane) if (!laneOf.has(task.id)) laneOf.set(task.id, ids[i])
  })
  const seen = new Set()
  const deferred = list(isObject(plan) ? plan.deferred : null).filter(r => isObject(r) && isText(r.id))
  for (const record of deferred) {
    for (const after of list(record.after).filter(isText)) {
      const from = laneOf.get(after)
      const to = laneOf.get(record.id)
      let line
      if (!to) line = `  %% dependsOn ${record.id} ← ${after}: ${record.id} is in no lane of this plan`
      else if (!from) line = `  %% dependsOn ${record.id} ← ${after}: ${after} is in no lane of this plan`
      else if (from === to) continue
      else line = `  ${from} -. dependsOn .-> ${to}`
      if (seen.has(line)) continue
      seen.add(line)
      out.push(line)
    }
  }
  return out
}
