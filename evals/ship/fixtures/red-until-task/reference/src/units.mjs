/**
 * Every duration unit the package understands, and its length in milliseconds.
 *
 * Exported rather than kept private to the parser so a caller can validate a
 * config file's units before parsing it — and so adding a unit is an entry
 * here rather than a branch in `src/parse.mjs`.
 */
export const UNIT_MS = {
  ms: 1,
  s: 1000,
  min: 60000,
  h: 3600000
}
