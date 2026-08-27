// The fold decision for `interlock merge-lanes`.
//
// `lib/waves.mjs` makes lanes in a batch path-disjoint over PREDICTED paths —
// but a prediction is a model's guess, and its own comment says a task that
// writes a file it never declared is invisible to that check. Running each
// lane in its own git worktree (workflows/ship.js `isolation:'worktree'`)
// turns isolation between lanes from a probabilistic property of the
// predictor into a filesystem fact; this module is the other half — folding
// those worktrees' ACTUAL writes back into the shared tree, and answering one
// question: did the batch's lanes really stay disjoint, or did two of them
// write the same file despite a disjoint prediction?
//
// Pure: no fs, no clock, no random — consistent with `adjudicateBatches` /
// `laneOutcomes` in workflows/ship.js. The caller (`bin/interlock`) does the
// git plumbing: locating each lane's worktree, diffing it against the shared
// base commit to build `changedByLane`, and applying a clean fold to the
// shared tree. This module only decides `clean` | `collision` | `error` from
// those already-observed facts.
//
// Fails closed in one direction: an uncertain fold (a label that cannot be
// resolved, a lane with no changed-file report) is an `error`, and a real
// path collision is a `collision` — neither ever resolves itself into a
// `clean` fold. A silent overwrite here would be the same defect
// `wave-isolation` exists to prevent, wearing a green check.

import { canonicalizePath } from './risk.mjs'

/**
 * @typedef {{ label: string }} LaneRef
 *   The batch's lanes, identified by their stable label (`laneLabel(lane)` in
 *   workflows/ship.js) — this module never sees the task objects themselves.
 */

/**
 * Decide how a completed batch's lane worktrees fold into the shared tree.
 *
 * @param {object} input
 * @param {LaneRef[]} input.lanes the batch's lanes, in dispatch order
 * @param {Record<string, string[]|null|undefined>} input.changedByLane maps a
 *   lane label to the files that lane actually changed vs `base` (raw, as git
 *   reported them — not yet canonicalized). `null`/`undefined`/absent means
 *   the lane's changed-file set could not be observed (its worktree could not
 *   be located), which is a fold-time error, not an empty write.
 * @param {string} [input.base] the shared-tree commit every lane's diff was
 *   taken against. Carried through for provenance; the decision itself is a
 *   function of `changedByLane`, which already reflects that diff.
 * @returns {{
 *   status: 'clean'|'collision'|'error',
 *   folds: Array<{ lane: string, files: string[] }>,
 *   collisions: Array<{ canonicalPath: string, lanes: string[] }>,
 *   unresolved: Array<{ label: string, reason: string }>
 * }}
 */
export function mergeDecision({ lanes, changedByLane, base } = {}) {
  void base // provenance only — the decision reads changedByLane, not base itself

  const laneList = Array.isArray(lanes) ? lanes : []
  const changed = changedByLane && typeof changedByLane === 'object' ? changedByLane : {}

  const empty = { folds: [], collisions: [], unresolved: [] }

  // Labels first: a lane this module cannot name is a lane it cannot fold —
  // never a filesystem scan for a best guess. Absent, empty, non-string, and
  // duplicate labels are all named rather than defaulted past.
  const seen = new Map()
  const unresolved = []
  for (const lane of laneList) {
    const label = lane && typeof lane.label === 'string' ? lane.label.trim() : ''
    if (!label) {
      unresolved.push({ label: '', reason: 'lane has no label — cannot locate its worktree' })
      continue
    }
    if (seen.has(label)) {
      unresolved.push({ label, reason: 'duplicate lane label within this batch' })
      continue
    }
    seen.set(label, lane)
  }
  if (unresolved.length) return { status: 'error', ...empty, unresolved }

  // Every named lane needs an observed changed-file set. Missing (rather than
  // empty) means its worktree could not be located — an empty-write lane is
  // reported as `files: []` below, never conflated with "unknown".
  const filesByLabel = new Map()
  for (const label of seen.keys()) {
    const files = changed[label]
    if (!Array.isArray(files)) {
      unresolved.push({
        label,
        reason: 'no changed-file report for this lane — its worktree could not be located'
      })
      continue
    }
    filesByLabel.set(label, files.filter(f => typeof f === 'string' && f.trim()))
  }
  if (unresolved.length) return { status: 'error', ...empty, unresolved }

  // Canonicalize each lane's actual writes for CONTENTION KEYING ONLY — the
  // reported `files` below stay in the spelling git reported them in, the
  // same split `canonicalizePath` / `normalizePath` draw in lib/risk.mjs.
  // A path that fails to canonicalize (should not happen for a git-reported,
  // repo-relative path) contends with nothing rather than being silently
  // dropped from the report.
  const canonicalByLabel = new Map()
  for (const [label, files] of filesByLabel) {
    const set = new Set()
    for (const f of files) {
      const c = canonicalizePath(f)
      if (c !== null) set.add(c)
    }
    canonicalByLabel.set(label, set)
  }

  // Pairwise intersection across every lane, over canonical paths — never raw
  // spellings, so `src/a.ts` and `./src/a.ts` written by two lanes are one
  // collision, not two near-misses that both look disjoint.
  const contenders = new Map() // canonicalPath -> Set<label>
  const labels = [...canonicalByLabel.keys()]
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i]
      const b = labels[j]
      for (const path of canonicalByLabel.get(a)) {
        if (canonicalByLabel.get(b).has(path)) {
          if (!contenders.has(path)) contenders.set(path, new Set())
          contenders.get(path).add(a).add(b)
        }
      }
    }
  }

  if (contenders.size) {
    const collisions = [...contenders.entries()]
      .map(([canonicalPath, laneSet]) => ({ canonicalPath, lanes: [...laneSet].sort() }))
      .sort((x, y) => x.canonicalPath.localeCompare(y.canonicalPath))
    return { status: 'collision', folds: [], collisions, unresolved: [] }
  }

  // Disjoint, by construction of the check above: apply the union. An
  // empty-write lane contributes `files: []` and is reported, not dropped —
  // it ran and touched nothing, which is a fact worth keeping, not a lane to
  // silently skip.
  const folds = laneList
    .filter(lane => typeof lane.label === 'string' && lane.label.trim())
    .map(lane => ({ lane: lane.label.trim(), files: filesByLabel.get(lane.label.trim()) || [] }))

  return { status: 'clean', folds, collisions: [], unresolved: [] }
}
