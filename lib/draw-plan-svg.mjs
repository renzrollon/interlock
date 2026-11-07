// The wave plan as one SVG document (make-the-run-surfaces-interactive, spec
// ship/diagrams "The plan SHALL also render as an SVG document", design D9, D10,
// D13, D23).
//
// It takes the rows `drawPlanBoardRows` returns and nothing else: a group per
// wave row, a box per lane row (label, model, state word), and an edge to a lane
// from each lane holding a task id its `after` part names. No second reading of
// the plan, so the picture and the board cannot disagree.
//
// A lane's task ids are read by one rule, because `parts` carries them three
// ways: `tasks[].id` when a state overlay was drawn, else `ids` split on `, `
// (a multi-task lane with no overlay), else `label`, which for a one-task lane
// is the task id (`lib/lane.mjs:29-31`).
//
// State is shown by its word and by a stroke pattern of its own, never by hue
// alone; the document sets its own background and ink, because an `Svg` is not
// shown to read the surface's theme. Every text is XML-escaped and the document
// names nothing outside itself: no font file, no image, no address but the SVG
// namespace. A lane title is task prose from `tasks.md`.
//
// A document over `LIMITS.planSvgMaxChars` is not returned and not cut (a cut
// document is a broken one): the answer is a reason and the `alt`.
//
// Pure and Node-free: `hooks/mod.mjs` imports this file and runs in the engine
// with no Node. Its closure is `lib/limits.mjs` only; `test/spine/draw-plan.test.mjs`
// walks it.

import { LIMITS } from './limits.mjs'

/** The published name of the cap, as `interlock limits` prints it. */
const CAP_LABEL = 'plan diagram svg chars'

// Geometry, in user units. Fixed, so the same rows draw the same document.
const MARGIN = 16
const GROUP_PAD = 12
const GROUP_HEAD = 26
const BOX_W = 340
const BOX_H = 64
const BOX_GAP = 12
const COLUMN_GAP = 56
const LOOP = 18
const TEXT_CHARS = 46

const BACKGROUND = '#ffffff'
const INK = '#1a1a1a'
const MUTED = '#4a4a4a'
const GROUP_FILL = '#f3f3f3'
const FONT = 'ui-monospace, Menlo, Consolas, monospace'

/** The stroke pattern each state word draws with, so state never rests on hue. */
const PATTERNS = Object.freeze({
  ok: { dash: '', width: 1.5 },
  failed: { dash: '6 3', width: 3 },
  current: { dash: '2 2', width: 3 },
  pending: { dash: '1 4', width: 1.5 },
  'not reached': { dash: '8 3 1 3', width: 1.5 },
  'not recorded': { dash: '4 2 1 2 1 2', width: 1.5 },
  'per task': { dash: '12 3', width: 2 }
})

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isText = value => typeof value === 'string' && value !== ''
const asText = value => (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value))

// Control characters XML 1.0 cannot hold become spaces before escaping.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g

/** Text made safe for an element's content or an attribute's value. */
function esc(value) {
  return asText(value)
    .replace(CONTROL, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** `text` cut to `max` code points with an ellipsis; the `alt` keeps the whole. */
function fit(text, max = TEXT_CHARS) {
  const points = [...asText(text).replace(/\s+/g, ' ').trim()]
  return points.length <= max ? points.join('') : `${points.slice(0, max - 1).join('')}…`
}

/** The task ids a lane row's parts hold, by the one rule above. */
function taskIdsOf(parts) {
  if (Array.isArray(parts.tasks) && parts.tasks.length > 0) {
    const ids = parts.tasks.filter(isObject).map(t => t.id).filter(isText)
    if (ids.length > 0) return ids
  }
  if (isText(parts.ids)) return parts.ids.split(', ').filter(isText)
  return isText(parts.label) ? [parts.label] : []
}

/** The waves and their lanes, in row order. A lane before any wave row joins an untitled group. */
function groupsOf(rows) {
  const groups = []
  for (const row of rows) {
    if (!isObject(row) || !isText(row.key)) continue
    if (/^wave:\d+$/.test(row.key)) {
      const title = isObject(row.parts) && isText(row.parts.title) ? row.parts.title : asText(row.text)
      groups.push({ title, lanes: [] })
    } else if (row.key.startsWith('lane:') && isObject(row.parts)) {
      if (groups.length === 0) groups.push({ title: '', lanes: [] })
      groups.at(-1).lanes.push({ parts: row.parts, key: row.key })
    }
  }
  return groups
}

/** The answer when there is nothing to draw, or too much: a reason, never a document. */
const refusal = (reason, alt) => ({ reason, alt })

/**
 * The plan as an SVG document.
 *
 * @param {unknown} rows what `drawPlanBoardRows` returns
 * @param {number} [cap] the longest document returned; defaults to the published cap
 * @returns {{source: string, width: number, height: number, alt: string, unplaced: string[]} | {reason: string, alt: string}}
 */
export function drawPlanSvg(rows, cap = LIMITS.planSvgMaxChars) {
  const list = Array.isArray(rows) ? rows : []
  const alt = list.filter(isObject).map(row => asText(row.text)).join('\n')
  const groups = groupsOf(list)
  if (!groups.some(group => group.lanes.length > 0)) {
    return refusal('no plan to draw: the rows hold no lane row', alt)
  }

  // Positions: a column per wave, boxes stacked inside it.
  const placed = []
  let x = MARGIN
  let tallest = 0
  const columns = groups.map(group => {
    const column = { group, x, boxes: [] }
    group.lanes.forEach((lane, i) => {
      const box = { lane, x: x + GROUP_PAD, y: MARGIN + GROUP_HEAD + i * (BOX_H + BOX_GAP) }
      column.boxes.push(box)
      placed.push(box)
    })
    column.height = GROUP_HEAD + GROUP_PAD + Math.max(1, group.lanes.length) * (BOX_H + BOX_GAP) - BOX_GAP
    tallest = Math.max(tallest, column.height)
    column.width = BOX_W + 2 * GROUP_PAD
    x += column.width + COLUMN_GAP
    return column
  })
  const width = x - COLUMN_GAP + MARGIN + LOOP
  const height = MARGIN + tallest + MARGIN

  // Edges: from the lane holding each task id a lane's `after` names.
  const holder = new Map()
  for (const box of placed) for (const id of taskIdsOf(box.lane.parts)) if (!holder.has(id)) holder.set(id, box)
  const edges = []
  const unplaced = []
  const seen = new Set()
  for (const to of placed) {
    const after = Array.isArray(to.lane.parts.after) ? to.lane.parts.after.filter(isText) : []
    for (const id of after) {
      const from = holder.get(id)
      if (!from) {
        unplaced.push(`${asText(to.lane.parts.label)} after ${id}: no lane holds ${id}`)
        continue
      }
      if (from === to) continue
      const key = `${placed.indexOf(from)}>${placed.indexOf(to)}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ from, to })
    }
  }

  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}" font-size="12" role="img">`,
    `<title>${esc(fit(list.find(row => isObject(row) && row.key === 'header')?.text ?? 'plan', 120))}</title>`,
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${MUTED}"/></marker></defs>`,
    `<rect width="${width}" height="${height}" fill="${BACKGROUND}"/>`
  ]

  for (const column of columns) {
    out.push(
      `<g class="wave">`,
      `<rect x="${column.x}" y="${MARGIN}" width="${column.width}" height="${column.height}" rx="6" fill="${GROUP_FILL}" stroke="${MUTED}" stroke-width="1"/>`,
      `<text x="${column.x + GROUP_PAD}" y="${MARGIN + 17}" fill="${INK}" font-weight="bold">${esc(fit(column.group.title, 52))}</text>`
    )
    for (const box of column.boxes) {
      const p = box.lane.parts
      const word = isText(p.state) ? p.state : ''
      const look = PATTERNS[word] ?? { dash: '', width: 1.5 }
      const dash = look.dash ? ` stroke-dasharray="${look.dash}"` : ''
      const head = [isText(p.batch) ? p.batch : '', asText(p.label), asText(p.model), asText(p.tier), asText(p.effort)]
        .filter(isText)
        .join(' · ')
      const lines = [head, isText(p.gist) ? p.gist : '', [word, isText(p.note) ? p.note : ''].filter(isText).join(' ')]
      out.push(
        `<g class="lane" data-label="${esc(p.label)}" data-state="${esc(word)}">`,
        `<rect x="${box.x}" y="${box.y}" width="${BOX_W}" height="${BOX_H}" rx="4" fill="${BACKGROUND}" stroke="${INK}" stroke-width="${look.width}"${dash}/>`
      )
      lines.forEach((line, i) => {
        if (!isText(line)) return
        out.push(
          `<text x="${box.x + 8}" y="${box.y + 20 + i * 18}" fill="${i === 0 ? INK : MUTED}"${i === 0 ? ' font-weight="bold"' : ''}>${esc(fit(line))}</text>`
        )
      })
      out.push('</g>')
    }
    out.push('</g>')
  }

  for (const { from, to } of edges) {
    const sy = from.y + BOX_H / 2
    const ty = to.y + BOX_H / 2
    let d
    if (from.x === to.x) {
      // Same wave: a bracket on the boxes' right side.
      d = `M${from.x + BOX_W},${sy} h${LOOP} V${ty} h-${LOOP}`
    } else {
      const forward = to.x > from.x
      const sx = forward ? from.x + BOX_W : from.x
      const tx = forward ? to.x : to.x + BOX_W
      const mid = (sx + tx) / 2
      d = `M${sx},${sy} C${mid},${sy} ${mid},${ty} ${tx},${ty}`
    }
    out.push(
      `<path class="edge" data-from="${esc(from.lane.parts.label)}" data-to="${esc(to.lane.parts.label)}" d="${d}" fill="none" stroke="${MUTED}" stroke-width="1.5" marker-end="url(#arrow)"/>`
    )
  }
  out.push('</svg>')

  const source = out.join('\n')
  if (source.length > cap) {
    return refusal(
      `the plan diagram is ${source.length} characters, over the ${cap} that "${CAP_LABEL}" allows (interlock limits); not drawn`,
      alt
    )
  }
  return { source, width, height, alt, unplaced }
}
