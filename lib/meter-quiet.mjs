// The ship meter's quiet figure (show-quiet-time-and-reset-the-meter-on-clear
// design D3): how long a live run has gone without activity, and the word the
// meter shows once that reaches the published threshold.
//
// Pure and Node-free: `hooks/mod.mjs` imports it inside the engine, where there
// is no Node, and `test/spine/mod-pins.test.mjs` walks the import. The two
// numbers are `interlock limits`'s; neither this file nor the hooks module
// restates them. The word names no cause: a run waiting on a plan window and a
// run that hung read the same here, and the person tells them apart from the
// windows the pane lists beside it.

import { LIMITS } from './limits.mjs'

const MINUTE_MS = 60 * 1000

/** The period of the meter's interval, in milliseconds. */
export const TICK_MS = LIMITS.meterTickMs

/**
 * Milliseconds from the last activity to now, never negative (a clock that went
 * backwards reads as no wait). `null` unless both are finite numbers: a time
 * the module could not read is no figure, never a guessed one.
 *
 * @param {unknown} lastActivityAt milliseconds since the epoch, or null
 * @param {unknown} now milliseconds since the epoch, or null
 * @returns {number|null}
 */
export function quietMs(lastActivityAt, now) {
  if (!Number.isFinite(lastActivityAt) || !Number.isFinite(now)) return null
  return Math.max(0, now - lastActivityAt)
}

/**
 * `quiet <n> min` once `ms` reaches the threshold, `<n>` the whole minutes and
 * `<1` under one; `null` below it, or for no figure.
 *
 * @param {number|null} ms what `quietMs` returned
 * @param {number} [afterMs] the threshold; the published one unless a test names another
 * @returns {string|null}
 */
export function quietWord(ms, afterMs = LIMITS.meterQuietAfterMs) {
  if (!Number.isFinite(ms) || ms < afterMs) return null
  const minutes = Math.floor(ms / MINUTE_MS)
  return `quiet ${minutes < 1 ? '<1' : minutes} min`
}
