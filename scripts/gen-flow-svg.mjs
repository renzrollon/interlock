#!/usr/bin/env node
// The README flow diagram, generated: docs/assets/flow-{light,dark}.svg and
// their narrow twins flow-narrow-{light,dark}.svg.
//
// Development tooling only. `scripts/` is not in package.json `files`, so
// this never ships; the SVGs it writes are what the README and docs/09 show.
// Every colour is read by name from site/ds/interlock/tokens.json, so the
// diagram cannot drift from the brand: when the design system is revised,
// re-run this. test/flow-svg.test.mjs fails when a committed SVG differs
// from a fresh generation, so a hand edit to one is a red suite.
//
// The geometry follows the Claude Design `Flow` comp, the interactive version
// the README links to at the site's #flow: six nodes in one bordered strip,
// the checkpoint the only filled block, a dashed re-spec bracket, a
// description bar that walks the nodes three seconds each. The comp is not
// in the repository until it is installed into site/ per site/README.md.
// NODES below is the content table both quote; change them together.
//
// GitHub renders an <img> SVG through its proxy: CSS and keyframes run,
// scripts and web fonts do not, so IBM Plex falls back to the viewer's
// system faces. Text is laid out on a 0.6em monospace advance, which every
// common fallback (Menlo, SF Mono, Consolas, DejaVu Sans Mono) is within a
// few percent of. Hover never reaches inside an <img>, which is why the
// README pairs the diagram with a table whose links carry the same text as
// tooltips. Keyframes, not SMIL, so prefers-reduced-motion can stop the
// cycle and leave the checkpoint described.
//
// Usage:
//   node scripts/gen-flow-svg.mjs            write the four SVGs
//   node scripts/gen-flow-svg.mjs --check    exit 1 naming any that drifted
//   node scripts/gen-flow-svg.mjs --at 7.5 --out <dir>
//                                            the wide pair paused 7.5 s into
//                                            the cycle, for checking a render

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const TOKENS_PATH = join(ROOT, 'site', 'ds', 'interlock', 'tokens.json')
export const OUT_DIR = join(ROOT, 'docs', 'assets')
export const FILES = ['flow-light.svg', 'flow-dark.svg', 'flow-narrow-light.svg', 'flow-narrow-dark.svg']

// kind: once | core | stop | optional. fr is the node's share of the strip.
export const NODES = [
  {
    id: 'bootstrap', label: 'bootstrap', kind: 'once', fr: 1, tag: '',
    line: 'code → specs → graph',
    desc: 'Once per repo. Reads the code, writes one spec per existing feature, builds the graph. Never edits source.'
  },
  {
    id: 'spec', label: 'spec', kind: 'core', fr: 1.2, tag: 'skill',
    line: 'explore → write → review',
    desc: 'Explores the repo, writes proposal, design, tasks and delta specs, reviews them, then stops. Nothing but specs.'
  },
  {
    id: 'stop', label: 'You read the spec.', kind: 'stop', fr: 1.6, tag: '',
    line: 'ten minutes · four files',
    desc: 'Four files, one question each. The only required stop. Wrong idea? Re-spec.'
  },
  {
    id: 'ship', label: 'ship', kind: 'core', fr: 1.2, tag: 'workflow',
    line: 'waves → verify → commit',
    desc: 'Parallel agents in waves, your suite, one commit. A workflow has no channel for a question, so it never asks one.'
  },
  {
    id: 'settle', label: 'settle', kind: 'optional', fr: 0.85, tag: '',
    line: 'PR with verdict',
    desc: 'Opens or updates the pull request with the MERGE / HUMAN / BLOCK verdict in the description and labels. Never merges.'
  },
  {
    id: 'archive', label: 'archive', kind: 'optional', fr: 1, tag: '',
    line: 'update living specs',
    desc: 'After the merge: fold the delta specs into the living specs, so the next spec plans against what is now true.'
  }
]

export const GROUPS = [
  { label: 'Once per repo', from: 0, to: 0 },
  { label: 'Every change', from: 1, to: 3 },
  { label: 'When you want it', from: 4, to: 5 }
]

export const FOOT = [
  'ship is a workflow, so there is nobody to ask.',
  'Everything a human decides is decided at the checkpoint, before ship starts.'
]

const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const SANS = '"IBM Plex Sans", -apple-system, "Segoe UI", system-ui, sans-serif'
const ADVANCE = 0.6 // monospace advance, in em
const SLOT = 3 // seconds a node is current
const TITLE = 'The Interlock flow'
const SUMMARY = 'bootstrap once per repo; for every change, spec, then you read the spec, then ship; when you want them, settle and archive. Two commands, one human checkpoint.'

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n2 = v => String(Math.round(v * 100) / 100)
const mono = (text, px) => text.length * px * ADVANCE

export function readTokens (path = TOKENS_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function palette (tokens, theme) {
  const byName = new Map(tokens.color.tokens.map(t => [t.name, t.value]))
  const col = name => {
    const v = byName.get(name)
    if (v === undefined) throw new Error(`tokens.json has no ${name}`)
    return typeof v === 'string' ? v : v[theme]
  }
  return {
    text: col('color-text'),
    soft: col('color-text-soft'),
    muted: col('color-text-muted'),
    divider: col('color-divider'),
    border: col('color-border'),
    strong: col('color-border-strong'),
    accent: col('color-accent'),
    onAccent: col('color-on-accent'),
    surface2: col('color-surface-2')
  }
}

function baseCss (p) {
  return [
    `svg { --text:${p.text}; --soft:${p.soft}; --muted:${p.muted}; --divider:${p.divider}; --border:${p.border}; ` +
      `--strong:${p.strong}; --accent:${p.accent}; --on-accent:${p.onAccent}; --surface-2:${p.surface2}; }`,
    `text { font-family: ${MONO}; }`,
    `.sans { font-family: ${SANS}; }`,
    '.eyebrow { font-size: 13px; font-weight: 600; fill: var(--accent); }',
    '.hair { stroke: var(--divider); stroke-width: 1; }',
    '.panel { fill: none; stroke: var(--border); stroke-width: 1; }',
    '.node { fill: none; stroke: var(--border); stroke-width: 1; }',
    '.node.core { stroke: var(--text); stroke-width: 1.5; }',
    '.node.stop { fill: var(--accent); stroke: var(--accent); }',
    '.name { font-size: 14px; font-weight: 500; fill: var(--soft); }',
    '.name.core { font-weight: 600; fill: var(--text); }',
    '.title { font-size: 18px; font-weight: 600; fill: var(--on-accent); }',
    '.tagbox { fill: var(--surface-2); stroke: var(--surface-2); stroke-width: 1; }',
    '.tagbox.wf { fill: none; stroke: var(--accent); }',
    '.tag { font-size: 12px; font-weight: 500; fill: var(--soft); }',
    '.tag.wf { fill: var(--accent); }',
    '.line { font-size: 12.5px; fill: var(--muted); }',
    '.line.on { fill: var(--on-accent); opacity: .9; }',
    '.arrow { font-size: 14px; fill: var(--strong); }',
    '.back { fill: none; stroke: var(--accent); stroke-width: 1; stroke-dasharray: 3 3; }',
    '.backhead { fill: var(--accent); }',
    '.backlabel { font-size: 12.5px; fill: var(--accent); }',
    '.desc { font-size: 13.5px; fill: var(--soft); }',
    '.desc.on { fill: var(--on-accent); }',
    '.who { font-weight: 600; fill: var(--text); }',
    '.foot { font-size: 14px; font-weight: 500; fill: var(--text); }',
    '.dim { font-weight: 400; fill: var(--soft); }'
  ]
}

function open (width, height, css) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="t d">`,
    `<title id="t">${esc(TITLE)}</title>`,
    `<desc id="d">${esc(SUMMARY)}</desc>`,
    `<style>\n${css.join('\n')}\n</style>`
  ]
}

// The name, and its tag beside it, centred as one group on cx.
function nameAndTag (out, n, cx, mid) {
  const nameCls = n.kind === 'core' ? 'name core' : 'name'
  if (!n.tag) {
    out.push(`<text class="${nameCls}" x="${n2(cx)}" y="${n2(mid + 5)}" text-anchor="middle">${esc(n.label)}</text>`)
    return
  }
  const nameW = mono(n.label, 14)
  const tagW = mono(n.tag, 12) + 14
  const x = cx - (nameW + 8 + tagW) / 2
  const wf = n.tag === 'workflow' ? ' wf' : ''
  out.push(`<text class="${nameCls}" x="${n2(x)}" y="${n2(mid + 5)}">${esc(n.label)}</text>`)
  out.push(`<rect class="tagbox${wf}" x="${n2(x + nameW + 8.5)}" y="${n2(mid - 9.5)}" width="${n2(tagW - 1)}" height="19" rx="3"/>`)
  out.push(`<text class="tag${wf}" x="${n2(x + nameW + 8 + tagW / 2)}" y="${n2(mid + 4.2)}" text-anchor="middle">${esc(n.tag)}</text>`)
}

// --- the wide strip ---------------------------------------------------------

const W = 1120
const PANEL_Y = 28
const PAD_X = 17 // 1px border + 16px padding
const GAP = 24
const NODE_Y = PANEL_Y + 1 + 12 + 36
const NODE_H = 96
const UNDER_Y = NODE_Y + NODE_H + 10
const PANEL_BOTTOM = UNDER_Y + 19 + 16 + 1
const BAR_Y = PANEL_BOTTOM + 20
const FOOT_Y = BAR_Y + 57 + 20
const H = FOOT_Y + 26

export function columns (nodes = NODES) {
  const unit = (W - 2 * PAD_X - GAP * (nodes.length - 1)) / nodes.reduce((s, n) => s + n.fr, 0)
  let x = PAD_X
  return nodes.map(n => {
    const col = { x, w: n.fr * unit }
    x += col.w + GAP
    return col
  })
}

function wide (tokens, theme, at) {
  const p = palette(tokens, theme)
  const cycle = SLOT * NODES.length
  const pct = 100 / NODES.length
  const ramp = 1.2
  const css = baseCss(p).concat([
    '.cur { opacity: 0; animation: slot ' + cycle + 's linear infinite; }',
    '.ring { fill: none; stroke: var(--accent); stroke-width: 2; }',
    `@keyframes slot { 0% { opacity: 0 } ${ramp}% { opacity: 1 } ${n2(pct - ramp)}% { opacity: 1 } ${n2(pct)}% { opacity: 0 } 100% { opacity: 0 } }`
  ])
  NODES.forEach((_, i) => css.push(`.s${i} { animation-delay: -${n2(((NODES.length - i) * SLOT + (at ?? 0)) % cycle)}s; }`))
  if (at != null) css.push('.cur { animation-play-state: paused; }')
  const stop = NODES.findIndex(n => n.kind === 'stop')
  css.push(`@media (prefers-reduced-motion: reduce) { .cur { animation: none; } .cur.s${stop} { opacity: 1; } }`)

  const out = open(W, H, css)
  const cols = columns()

  for (const g of GROUPS) {
    const x0 = cols[g.from].x
    const x1 = cols[g.to].x + cols[g.to].w
    out.push(`<text class="eyebrow sans" x="${n2(x0)}" y="13">${esc(g.label)}</text>`)
    out.push(`<line class="hair" x1="${n2(x0 + g.label.length * 7.4 + 10)}" y1="9.5" x2="${n2(x1)}" y2="9.5"/>`)
  }
  out.push(`<rect class="panel" x="0.5" y="${PANEL_Y + 0.5}" width="${W - 1}" height="${PANEL_BOTTOM - PANEL_Y - 1}" rx="4"/>`)

  // The return path, from the checkpoint's centre back to spec's.
  const sx = cols[stop - 1].x + cols[stop - 1].w / 2
  const tx = cols[stop].x + cols[stop].w / 2
  const top = NODE_Y - 22
  const label = 'wrong idea? re-spec'
  const mid = (sx + tx) / 2
  const half = mono(label, 12.5) / 2 + 6
  out.push(`<path class="back" d="M${n2(mid - half)},${top + 0.5} H${n2(sx + 0.5)} V${NODE_Y - 6}"/>`)
  out.push(`<path class="back" d="M${n2(mid + half)},${top + 0.5} H${n2(tx - 0.5)} V${NODE_Y}"/>`)
  out.push(`<path class="backhead" d="M${n2(sx - 4)},${NODE_Y - 6} L${n2(sx + 5)},${NODE_Y - 6} L${n2(sx + 0.5)},${NODE_Y} Z"/>`)
  out.push(`<text class="backlabel" x="${n2(mid)}" y="${top + 4.5}" text-anchor="middle">${esc(label)}</text>`)

  NODES.forEach((n, i) => {
    const { x, w } = cols[i]
    const cx = x + w / 2
    const midY = NODE_Y + NODE_H / 2
    const inset = n.kind === 'core' ? 0.75 : 0.5
    out.push(`<rect class="node ${n.kind}" x="${n2(x + inset)}" y="${n2(NODE_Y + inset)}" width="${n2(w - 2 * inset)}" height="${n2(NODE_H - 2 * inset)}" rx="4"/>`)
    out.push(`<rect class="ring cur s${i}" x="${n2(x - 3)}" y="${NODE_Y - 3}" width="${n2(w + 6)}" height="${NODE_H + 6}" rx="6"/>`)
    if (n.kind === 'stop') {
      out.push(`<text class="title sans" x="${n2(cx)}" y="${n2(midY - 5.5)}" text-anchor="middle">${esc(n.label)}</text>`)
      out.push(`<text class="line on" x="${n2(cx)}" y="${n2(midY + 18)}" text-anchor="middle">${esc(n.line)}</text>`)
    } else {
      nameAndTag(out, n, cx, midY)
      out.push(`<text class="line" x="${n2(cx)}" y="${UNDER_Y + 14}" text-anchor="middle">${esc(n.line)}</text>`)
    }
    if (i < NODES.length - 1) {
      out.push(`<text class="arrow" x="${n2(x + w + GAP / 2)}" y="${n2(midY + 5)}" text-anchor="middle">→</text>`)
    }
  })

  // The description bar: one line per node, stacked, each current in turn.
  out.push(`<line class="hair" x1="0" y1="${BAR_Y + 0.5}" x2="${W}" y2="${BAR_Y + 0.5}"/>`)
  NODES.forEach((n, i) => {
    out.push(`<text class="desc cur s${i}" x="0" y="${BAR_Y + 27}"><tspan class="who">${esc(n.label)}</tspan><tspan dx="10">${esc(n.desc)}</tspan></text>`)
  })

  out.push(`<text class="foot" x="0" y="${FOOT_Y + 15}">${esc(FOOT[0])}<tspan class="dim" dx="8.4">${esc(FOOT[1])}</tspan></text>`)
  out.push('</svg>')
  return out.join('\n') + '\n'
}

// --- the narrow list --------------------------------------------------------

const NW = 360

export function wrap (text, maxChars) {
  const lines = []
  let cur = ''
  for (const word of text.split(' ')) {
    if (cur && (cur + ' ' + word).length > maxChars) {
      lines.push(cur)
      cur = word
    } else {
      cur = cur ? cur + ' ' + word : word
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function narrow (tokens, theme) {
  const p = palette(tokens, theme)
  const body = []
  const innerX = 17
  const descChars = Math.floor((NW - 2 * innerX) / (13.5 * ADVANCE))
  const footChars = Math.floor(NW / (14 * ADVANCE))
  let y = 0

  GROUPS.forEach((g, gi) => {
    if (gi) y += 20
    body.push(`<text class="eyebrow sans" x="0" y="${n2(y + 13)}">${esc(g.label)}</text>`)
    body.push(`<line class="hair" x1="${n2(g.label.length * 7.4 + 10)}" y1="${n2(y + 9.5)}" x2="${NW}" y2="${n2(y + 9.5)}"/>`)
    y += 18
    for (let i = g.from; i <= g.to; i++) {
      const n = NODES[i]
      y += 8
      const rowTop = y
      const rows = []
      let cy = rowTop + 15 // border + padding
      const stop = n.kind === 'stop'
      if (stop) {
        rows.push(`<text class="title sans" x="${innerX}" y="${n2(cy + 17.5)}">${esc(n.label)}</text>`)
        cy += 23.4 + 6
        rows.push(`<text class="line on" x="${innerX}" y="${n2(cy + 13.5)}">${esc(n.line)}</text>`)
      } else {
        const nameCls = n.kind === 'core' ? 'name core' : 'name'
        rows.push(`<text class="${nameCls}" x="${innerX}" y="${n2(cy + 15)}">${esc(n.label)}</text>`)
        if (n.tag) {
          const tx = innerX + mono(n.label, 14) + 8
          const tagW = mono(n.tag, 12) + 14
          const wf = n.tag === 'workflow' ? ' wf' : ''
          rows.push(`<rect class="tagbox${wf}" x="${n2(tx + 0.5)}" y="${n2(cy + 0.5)}" width="${n2(tagW - 1)}" height="19" rx="3"/>`)
          rows.push(`<text class="tag${wf}" x="${n2(tx + tagW / 2)}" y="${n2(cy + 14.2)}" text-anchor="middle">${esc(n.tag)}</text>`)
        }
        cy += 20 + 6
        rows.push(`<text class="line" x="${innerX}" y="${n2(cy + 13.5)}">${esc(n.line)}</text>`)
      }
      cy += 18.75 + 6
      for (const ln of wrap(n.desc, descChars)) {
        rows.push(`<text class="desc${stop ? ' on' : ''}" x="${innerX}" y="${n2(cy + 15)}">${esc(ln)}</text>`)
        cy += 21.6
      }
      const rowH = cy + 15 - rowTop
      const inset = n.kind === 'core' ? 0.75 : 0.5
      body.push(`<rect class="node ${n.kind}" x="${inset}" y="${n2(rowTop + inset)}" width="${n2(NW - 2 * inset)}" height="${n2(rowH - 2 * inset)}" rx="4"/>`)
      body.push(...rows)
      y = rowTop + rowH
    }
  })

  y += 20
  for (const ln of wrap(FOOT[0], footChars)) {
    body.push(`<text class="foot" x="0" y="${n2(y + 15)}">${esc(ln)}</text>`)
    y += 21
  }
  for (const ln of wrap(FOOT[1], footChars)) {
    body.push(`<text class="foot dim" x="0" y="${n2(y + 15)}">${esc(ln)}</text>`)
    y += 21
  }
  const height = Math.ceil(y + 6)
  return open(NW, height, baseCss(p)).concat(body, ['</svg>']).join('\n') + '\n'
}

// --- entry points -----------------------------------------------------------

/** Every file this script owns, by name, as it should read. `at` pauses the wide pair. */
export function renderFlow (tokens = readTokens(), { at } = {}) {
  return {
    'flow-light.svg': wide(tokens, 'light', at),
    'flow-dark.svg': wide(tokens, 'dark', at),
    'flow-narrow-light.svg': narrow(tokens, 'light'),
    'flow-narrow-dark.svg': narrow(tokens, 'dark')
  }
}

/** The names of the committed files that differ from a fresh generation. */
export function drifted (dir = OUT_DIR, tokens = readTokens()) {
  const fresh = renderFlow(tokens)
  return FILES.filter(f => {
    try {
      return readFileSync(join(dir, f), 'utf8') !== fresh[f]
    } catch {
      return true
    }
  })
}

function main (argv) {
  if (argv.includes('--check')) {
    const bad = drifted()
    if (bad.length) {
      process.stderr.write(`flow SVGs out of date: ${bad.join(', ')}. Run: node scripts/gen-flow-svg.mjs\n`)
      return 1
    }
    process.stdout.write('flow SVGs match tokens.json and NODES\n')
    return 0
  }
  const atIdx = argv.indexOf('--at')
  const outIdx = argv.indexOf('--out')
  const at = atIdx >= 0 ? Number(argv[atIdx + 1]) : undefined
  if (at !== undefined && (!Number.isFinite(at) || outIdx < 0)) {
    process.stderr.write('--at needs a number of seconds and an --out directory, so a paused frame never lands in docs/assets\n')
    return 2
  }
  const dir = outIdx >= 0 ? resolve(argv[outIdx + 1]) : OUT_DIR
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(renderFlow(readTokens(), { at }))) {
    writeFileSync(join(dir, name), text)
    process.stdout.write(`wrote ${join(dir, name)}\n`)
  }
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
