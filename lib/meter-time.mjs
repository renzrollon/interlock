// The ship meter's time words: the clock reading a line was stamped with, and
// how long a turn took, as a person reads them.
//
// Each reading is the engine's own (`$.clock.now()` in the hooks module), so a
// time is either a real reading or absent: absent draws as nothing, never as a
// guessed time. The wall-clock words are the local time of the machine the
// engine runs on, from `Date`'s own local fields. The duration bands are unit
// conversions (seconds, minutes, hours), not thresholds: no band is a verdict
// on the figure it formats.
//
// Pure and Node-free: the hooks module runs in the engine with no Node, and
// imports this file.

const isTime = ms => typeof ms === 'number' && Number.isFinite(ms)
const pad = n => String(n).padStart(2, '0')

/** The local wall-clock time of a reading, `HH:MM:SS`; `''` for no reading. */
export function clockText(ms) {
  if (!isTime(ms)) return ''
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** The local date and time of a reading, `YYYY-MM-DD HH:MM:SS`; `''` for no reading. */
export function stampText(ms) {
  if (!isTime(ms)) return ''
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clockText(ms)}`
}

/**
 * A duration in milliseconds as a person reads it: under a minute, seconds to
 * one decimal, cut down (`41.2s`, `0.8s`, never `60.0s`); under an hour, whole
 * minutes and seconds (`2m 14s`); else hours and minutes (`1h 03m`). `''` for
 * no figure, a negative one or one that is not a finite number.
 */
export function durationText(ms) {
  if (!isTime(ms) || ms < 0) return ''
  if (ms < 60_000) return `${(Math.floor(ms / 100) / 10).toFixed(1)}s`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`
  return `${Math.floor(seconds / 3600)}h ${pad(Math.floor((seconds % 3600) / 60))}m`
}
