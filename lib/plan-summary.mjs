// The plan summary (draw-the-wave-board-in-the-meter-pane design D3, spec
// ship/diagrams): the `plan` field the adoption and replan steps carry, so a
// second reader of the step stream — the ship meter — can draw the wave board
// without reading a file.
//
// The summary is the plan's shape cut to what the board reads: per wave its
// position, group, kind, red marker and batches; per task its id, tier, model
// and the words the lane title is built from; and the ordered-after edges as
// the plan's deferral records. Nothing else rides, because every byte of it is
// retyped by the Workflow host's relay. `test/spine/plan-summary.test.mjs`
// draws a plan and its summary through the renderer and compares the lines.
//
// Pure and Node-free, so the CLI builds the field with it and the hooks module
// could read it; its closure is `lib/lane.mjs` and `lib/limits.mjs`.

import { dependsOnIds, titleGist } from './lane.mjs'

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const list = value => (Array.isArray(value) ? value : [])
const isText = value => typeof value === 'string' && value !== ''

/** A task as the board reads it; a field the task lacks is left out, never filled. */
function summarizeTask(task) {
  const out = { id: task.id }
  if (Number.isInteger(task.tier)) out.tier = task.tier
  if (isText(task.model)) out.model = task.model
  const gist = titleGist(task.description)
  if (gist) out.description = gist
  return out
}

/** A wave's batches as the board draws them: lanes of tasks, empty lanes and batches dropped. */
function summarizeBatches(wave) {
  return list(wave.batches)
    .map(batch =>
      list(batch)
        .map(lane => list(lane).filter(task => isObject(task) && isText(task.id)))
        .filter(lane => lane.length > 0)
    )
    .filter(batch => batch.length > 0)
}

/** A deferral record reduced to the three fields the board reads. */
const reduceRecord = record => ({
  id: record.id,
  group: record.group ?? null,
  after: list(record.after).filter(isText)
})

/**
 * The planner's deferral records, derived from the tasks' own dependency
 * fields: each id a task depends on that belongs to its own group and is
 * placed at an earlier position or batch. A run state keeps no deferral list,
 * and over the real halted run's state this yields its plan's four records.
 */
function deriveDeferred(positions) {
  const placed = new Map()
  positions.forEach(({ batches }, index) =>
    batches.forEach((batch, b) => {
      for (const task of batch.flat()) if (!placed.has(task.id)) placed.set(task.id, { index, b, task })
    })
  )
  const out = []
  for (const [id, at] of placed) {
    const group = at.task.group ?? null
    const after = dependsOnIds(at.task).filter(dep => {
      const before = placed.get(dep)
      return (
        before !== undefined &&
        (before.task.group ?? null) === group &&
        (before.index < at.index || (before.index === at.index && before.b < at.b))
      )
    })
    if (after.length) out.push({ id, group, after })
  }
  return out
}

/**
 * The summary of a plan (`waves` plus `testWave`) or of a run state (`waves`,
 * the test wave last among them with `kind: 'test'`), in the plan's shape so
 * the renderer reads either the same way.
 *
 * @param {unknown} source a plan or a run state; anything else summarises to no waves
 * @param {{deferred?: Array}} [opts] the planner's own deferral records, when the caller has them
 * @returns {{waves: Array, testWave: object|null, deferred: Array}}
 */
export function summarizePlan(source, { deferred } = {}) {
  const from = isObject(source) ? source : {}
  const waves = list(from.waves).filter(isObject)
  let impl = waves
  let test = isObject(from.testWave) ? from.testWave : null
  if (!test && waves.length && waves.at(-1).kind === 'test') {
    impl = waves.slice(0, -1)
    test = waves.at(-1)
  }

  const positions = impl
    .map(wave => ({ wave, batches: summarizeBatches(wave) }))
    .filter(position => position.batches.length > 0)
  const testBatches = test ? summarizeBatches(test) : []
  const all = testBatches.length ? [...positions, { wave: test, batches: testBatches }] : positions

  const records = Array.isArray(deferred) ? deferred : Array.isArray(from.deferred) ? from.deferred : null
  const summarize = batches => batches.map(batch => batch.map(lane => lane.map(summarizeTask)))
  return {
    waves: positions.map(({ wave, batches }, index) => ({
      index,
      group: wave.group ?? null,
      kind: wave.kind === 'test' ? 'test' : 'impl',
      ...(wave.red === true ? { red: true } : {}),
      batches: summarize(batches)
    })),
    testWave: testBatches.length ? { index: positions.length, batches: summarize(testBatches) } : null,
    deferred: records
      ? records.filter(record => isObject(record) && isText(record.id)).map(reduceRecord)
      : deriveDeferred(all)
  }
}
