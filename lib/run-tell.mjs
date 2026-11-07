// The words of a notification, and the key that says it was already told.
//
// The hooks module asks the engine for one notification when a ship run halts,
// when a run that did not halt closes, when the quiet word first appears in a
// stretch, and when a spec run stops at its checkpoint (make-the-run-surfaces-
// interactive design D17). This module builds the words from fields the module
// already holds and adds no verdict: a halt says it halted and why, a close says
// the record's exit code, and the other two read the status line's own text.
// Node-free on purpose: `hooks/mod.mjs` imports it and runs with no Node, so it
// holds no import at all. Pure: fields in, `{ key, text }` out.

/** The title every notification carries. */
export const TELL_TITLE = 'Interlock'

/** One line of text from any value: strings only, whitespace collapsed. */
function line(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

/** A key part from a run id, change name or stretch number; a stable word when absent. */
function part(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return line(value) || fallback
}

/**
 * The words and the told-key of one notification.
 *
 * | kind         | text built from                    | key                          |
 * | `halt`       | change, `halted`, the step's reason | `halt:<runId>`               |
 * | `close`      | change, the record's exit code      | `close:<runId>`              |
 * | `quiet`      | the status line's text              | `quiet:<runId>:<stretch>`    |
 * | `checkpoint` | the status line's text              | `checkpoint:<change>`        |
 *
 * A field that is absent is left out of the words and never invented. Any other
 * kind answers `null`: nothing to tell.
 *
 * @param {{ kind?: string, runId?: string|null, change?: string|null, reason?: string|null,
 *           exitCode?: number|null, statusText?: string|null, stretch?: number|string|null }} [fields]
 * @returns {{ key: string, text: string } | null}
 */
export function tellOf(fields) {
  const f = fields && typeof fields === 'object' ? fields : {}
  const change = line(f.change)
  const runId = part(f.runId, 'no-run')
  const status = line(f.statusText)
  switch (f.kind) {
    case 'halt': {
      const reason = line(f.reason)
      const head = `${change || 'ship run'} halted`
      return { key: `halt:${runId}`, text: reason ? `${head}: ${reason}` : head }
    }
    case 'close': {
      const head = `${change || 'ship run'} closed`
      const code = typeof f.exitCode === 'number' && Number.isFinite(f.exitCode) ? ` (exit ${f.exitCode})` : ''
      return { key: `close:${runId}`, text: `${head}${code}` }
    }
    case 'quiet':
      return {
        key: `quiet:${runId}:${part(f.stretch, '0')}`,
        text: status || `${change || 'ship run'} quiet`
      }
    case 'checkpoint':
      return {
        key: `checkpoint:${part(f.change, 'no-change')}`,
        text: status || `${change || 'spec run'} checkpoint`
      }
    default:
      return null
  }
}
