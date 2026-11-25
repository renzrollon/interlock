// The requirement-wording lint (change `scope-suggest-and-evaluate-the-artifact-gate`,
// design §5, D18, D19, D35). Pure: text in, entries out. It reports and never
// decides; a caller must not let an entry touch readiness.
//
// It reads the lines under `## ADDED Requirements` and `## MODIFIED Requirements`
// and skips headings, fenced blocks, backtick spans and double-quoted text, so a
// spec that quotes a banned phrase is not flagged for quoting it.

const entry = (phrase, reason) => Object.freeze({ phrase, reason })

/** The seven phrases, each with why it fails a reader. No totality word is on it. */
export const WORDING_LIST = Object.freeze([
  entry('properly', 'names no observable condition; state what must hold'),
  entry('as appropriate', 'leaves the judgement to the implementer; state the rule or the cases'),
  entry('if possible', 'makes the requirement optional without saying when; state the condition'),
  entry('and/or', 'does not say whether both or either is required; choose one'),
  entry('but not limited to', 'leaves the set open; list it all or state the rule that bounds it'),
  entry('eventually', 'names no bound; give a time, a count or a trigger'),
  entry('etc.', 'leaves the list unfinished; list every item or state the rule')
])

const escape = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const MATCHERS = WORDING_LIST.map(e => ({
  ...e,
  re: new RegExp(`(?<![A-Za-z0-9_])${escape(e.phrase)}(?![A-Za-z0-9_])`, 'i')
}))

const READ_BLOCK = /^##\s+(ADDED|MODIFIED)\s+Requirements\b/i
const ANY_BLOCK = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\b/i

/** A line with its backtick spans and double-quoted text blanked, columns kept. */
function stripQuoted(line) {
  const blank = m => ' '.repeat(m.length)
  const s = line.replace(/`[^`]*`/g, blank).replace(/"[^"]*"/g, blank)
  // Every smart-quote match ends at a ”, so bounding the scan at the last ” keeps
  // the output and stops an unclosed “ run from rescanning to the end (O(L^2)).
  const last = s.lastIndexOf('”')
  return last === -1 ? s : s.slice(0, last + 1).replace(/“[^”]*”/g, blank) + s.slice(last + 1)
}

/**
 * @param {string} path the path to report each entry under
 * @param {string} text the file's text
 * @returns {{ file: string, line: number, phrase: string, reason: string, message: string }[]}
 */
export function lintWording(path, text) {
  const hits = []
  let reading = false
  let fence = null
  String(text)
    .split('\n')
    .forEach((raw, i) => {
      const line = raw.replace(/\r$/, '')
      const fenceMark = /^\s*(```+|~~~+)/.exec(line)
      if (fenceMark) {
        const run = fenceMark[1]
        if (fence === null) fence = { char: run[0], len: run.length }
        else if (run[0] === fence.char && run.length >= fence.len && /^\s*\S+\s*$/.test(line)) fence = null
        return
      }
      if (fence !== null) return
      if (/^##\s+/.test(line) || ANY_BLOCK.test(line)) {
        reading = READ_BLOCK.test(line)
        return
      }
      if (!reading || /^\s*#/.test(line)) return
      const visible = stripQuoted(line)
      const found = MATCHERS.filter(m => m.re.test(visible)).sort(
        (a, b) => visible.search(a.re) - visible.search(b.re)
      )
      for (const m of found) {
        hits.push({
          file: path,
          line: i + 1,
          phrase: m.phrase,
          reason: m.reason,
          message: `WORDING: ${path}:${i + 1} "${m.phrase}" — ${m.reason}`
        })
      }
    })
  return hits
}
