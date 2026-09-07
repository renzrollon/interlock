// Mirrors the slug rule Claude Code's CLI uses under `~/.claude/projects` to
// name a project's directory from its absolute path. Observed mappings:
//   `/` -> `-`   (path separator)
//   `.` -> `-`   (e.g. `.claude` -> `-claude`)
//   ` ` -> `-`   (space, e.g. `Application Support`)
//   `_` -> `-`   (e.g. `w_1` -> `w-1`)
// Generalized: every character outside `[A-Za-z0-9]` becomes `-`.

/**
 * @param {string} absPath
 * @returns {string}
 */
export function projectSlug(absPath) {
  if (typeof absPath !== 'string') {
    throw new TypeError('projectSlug expects a string path');
  }
  return absPath.replace(/[^A-Za-z0-9]/g, '-');
}
