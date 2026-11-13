// The Node floor an OpenSpec CLI declares (design D4, D15).
//
// Imports only node:fs and node:path, and never the pin: the pin script has to
// run when the pin file is missing or broken, and the doctor reads the floor of
// a CLI on PATH from that CLI's own package manifest.

import { readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** How many directory levels above the script's realpath are searched. */
const LEVELS = 4

/**
 * The Node floor an `engines.node` value states, when it is exactly one
 * `>=x.y.z`; null for anything else (a range, a caret, a bare major).
 */
export function nodeFloorOf(range) {
  if (typeof range !== 'string') return null
  const m = /^\s*>=\s*(\d+\.\d+\.\d+)\s*$/.exec(range)
  return m ? m[1] : null
}

function readManifest(file, pkg) {
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (err) {
    if (err && err.code === 'ENOENT') return { skip: true }
    return { reason: `${file} could not be read (${err && err.code ? err.code : 'error'})` }
  }
  let json
  try {
    json = JSON.parse(raw)
  } catch {
    return { reason: `${file} is not valid JSON` }
  }
  if (!json || typeof json !== 'object' || json.name !== pkg) return { skip: true }
  const range = json.engines && typeof json.engines === 'object' ? json.engines.node : undefined
  if (range === undefined) return { reason: `${file} declares no engines.node` }
  const floor = nodeFloorOf(range)
  if (!floor) return { reason: `${file} declares engines.node ${JSON.stringify(range)}, which is not a single >=x.y.z` }
  return { floor }
}

/**
 * The Node floor the `openspec` at `binPath` declares in its own package.
 * Never throws.
 *
 * @param {string} binPath path of the openspec script found on PATH
 * @param {string} pkg the package name to look for
 * @param {string} platform process.platform
 * @returns {{ floor: string|null, reason: string|null }}
 */
export function declaredNodeFloor(binPath, pkg, platform) {
  try {
    if (typeof binPath !== 'string' || !binPath) return { floor: null, reason: 'no openspec path to look beside' }
    const shim = platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(binPath)
    if (shim) {
      const file = join(dirname(binPath), 'node_modules', ...pkg.split('/'), 'package.json')
      const got = readManifest(file, pkg)
      if (got.floor) return { floor: got.floor, reason: null }
      return { floor: null, reason: got.reason || `no ${pkg} manifest beside ${basename(binPath)}` }
    }
    let real = binPath
    try { real = realpathSync(binPath) } catch { /* keep the given path */ }
    let dir = dirname(real)
    for (let level = 0; level < LEVELS; level++) {
      const got = readManifest(join(dir, 'package.json'), pkg)
      if (got.floor) return { floor: got.floor, reason: null }
      if (got.reason) return { floor: null, reason: got.reason }
      const up = dirname(dir)
      if (up === dir) break
      dir = up
    }
    return { floor: null, reason: `no ${pkg} package.json within ${LEVELS} levels above ${real}` }
  } catch (err) {
    return { floor: null, reason: `the floor could not be read (${err && err.message ? err.message : 'error'})` }
  }
}
