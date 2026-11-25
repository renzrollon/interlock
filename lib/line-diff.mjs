// Pure line diff for a scoped artifact re-gate (change
// `scope-suggest-and-evaluate-the-artifact-gate`, design §2, D8, D10, D31).
//
// A longest-common-subsequence diff over two line arrays. The common head and
// tail are trimmed first, so a typical edit compares only the changed middle.
// Stdlib only; no I/O.
//
//   diffLines(snapshotLines, currentLines) -> { added, removed, hunks }
//   reworkShare({ added, removed, before, after }) -> whole percent

const CONTEXT = 2
// Past this many cells the LCS table is not built: the middle is treated as
// wholly removed and wholly added, which is a correct if coarse diff.
const MAX_CELLS = 25_000_000

/**
 * Edit ops over the whole pair: { t: 'eq'|'del'|'add', text, si, ci } where
 * `si` and `ci` count the snapshot and current lines consumed before the op.
 */
function buildOps(a, b) {
  let head = 0
  const lim = Math.min(a.length, b.length)
  while (head < lim && a[head] === b[head]) head++
  let tail = 0
  while (tail < lim - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++

  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)
  const mid = []

  if (midA.length === 0 || midB.length === 0 || (midA.length + 1) * (midB.length + 1) > MAX_CELLS) {
    for (const text of midA) mid.push({ t: 'del', text })
    for (const text of midB) mid.push({ t: 'add', text })
  } else {
    const w = midB.length + 1
    const table = new Uint32Array((midA.length + 1) * w)
    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) {
        table[i * w + j] =
          midA[i] === midB[j] ? table[(i + 1) * w + j + 1] + 1 : Math.max(table[(i + 1) * w + j], table[i * w + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
        mid.push({ t: 'eq', text: midA[i] })
        i++
        j++
      } else if (i < midA.length && (j >= midB.length || table[(i + 1) * w + j] >= table[i * w + j + 1])) {
        mid.push({ t: 'del', text: midA[i] })
        i++
      } else {
        mid.push({ t: 'add', text: midB[j] })
        j++
      }
    }
  }

  const ops = [
    ...a.slice(0, head).map(text => ({ t: 'eq', text })),
    ...mid,
    ...a.slice(a.length - tail).map(text => ({ t: 'eq', text }))
  ]
  let si = 0
  let ci = 0
  for (const op of ops) {
    op.si = si
    op.ci = ci
    if (op.t !== 'add') si++
    if (op.t !== 'del') ci++
  }
  return ops
}

function rangeOf(nums) {
  return nums.length ? { from: nums[0], to: nums[nums.length - 1] } : null
}

/**
 * @param {string[]} snapshotLines
 * @param {string[]} currentLines
 */
export function diffLines(snapshotLines, currentLines) {
  const ops = buildOps(snapshotLines, currentLines)
  const changed = []
  for (let k = 0; k < ops.length; k++) if (ops[k].t !== 'eq') changed.push(k)
  let added = 0
  let removed = 0
  for (const k of changed) ops[k].t === 'add' ? added++ : removed++

  const groups = []
  for (const k of changed) {
    const last = groups[groups.length - 1]
    if (last && k - last.last - 1 <= 2 * CONTEXT) last.last = k
    else groups.push({ first: k, last: k })
  }

  const hunks = groups.map(({ first, last }) => {
    const start = Math.max(0, first - CONTEXT)
    const end = Math.min(ops.length - 1, last + CONTEXT)
    const slice = ops.slice(start, end + 1)
    const lines = slice.map(op => ({
      kind: op.t === 'eq' ? 'context' : op.t === 'add' ? 'added' : 'removed',
      text: op.text
    }))
    // A range spans every line of its side the hunk covers, from the first
    // change to the last: a kept line between two edits is inside it, so a
    // removal merged across kept lines is never read as one contiguous removal
    // (M10). A side is null only when the hunk has no line of it at all: a pure
    // removal has no current line, a pure insertion no snapshot line.
    const inRange = ops.slice(first, last + 1)
    const current = rangeOf(inRange.filter(o => o.t !== 'del').map(o => o.ci + 1))
    const snapshot = rangeOf(inRange.filter(o => o.t !== 'add').map(o => o.si + 1))
    return {
      current,
      snapshot,
      after: current ? null : ops[first].ci,
      snapshotAfter: snapshot ? null : ops[first].si,
      lines
    }
  })
  return { added, removed, hunks }
}

/** round(100 x max(added, removed) / max(before, after)); 0 when both totals are 0. */
export function reworkShare({ added, removed, before, after }) {
  const total = Math.max(before, after)
  if (total === 0) return 0
  return Math.round((100 * Math.max(added, removed)) / total)
}
