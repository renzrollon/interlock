// The one set of judged grader types.
//
// A grader is judged when a model judge sits in its loop; every other type is
// deterministic, so its failure is trustworthy on a single run. Triage,
// calibrate and the eval structural test all read this set, so the three cannot
// disagree on which types are judged. Pure: no imports, no I/O.
//
// `llm` and `baseline` are the two judge-calling types the harness knows. The
// rest are triage's legacy aliases, kept so results files and tests written
// against either spelling keep their classification.

export const JUDGED_GRADER_TYPES = new Set([
  'llm',
  'baseline',
  'judge',
  'judged',
  'model-judge',
  'llm-judge',
  'semantic'
])

/** True when `type` names a judged grader type (case-insensitive). */
export function isJudgedType(type) {
  return typeof type === 'string' && JUDGED_GRADER_TYPES.has(type.toLowerCase())
}
