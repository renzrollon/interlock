// The git side of carrying a ship run's evidence file to a descendant commit
// (design D8 of close-the-merge-request-loop). `readRunEvidence` never reads
// git; the command asks the question here and hands the answer in. Kept out of
// bin/interlock, which sits near the plugin directory's file-size warning zone.

import { spawnSync } from 'node:child_process'

/**
 * Whether `sha` is an ancestor of HEAD as three values: exit 0 `true`, exit 1
 * `false`, anything else `null` (an unknown commit in a shallow clone, an
 * unreadable repository) with git's own failure handed to `warn`. `null` is not
 * `false`: a commit git never looked at must not be reported as "another commit".
 *
 * @param {string} root
 * @param {unknown} sha
 * @param {(line: string) => void} warn
 * @returns {boolean|null}
 */
export function ancestryOfHead(root, sha, warn) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{4,64}$/i.test(sha)) {
    warn(`could not tell whether ${JSON.stringify(sha ?? null)} is an ancestor of HEAD: it is not a commit id`)
    return null
  }
  // The null object id names no commit in any repository, so no amount of fetched
  // history could make it an ancestor: that is a decision, not a shortage.
  if (/^0+$/.test(sha)) return false
  const r = spawnSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: root, encoding: 'utf8' })
  if (r.status === 0) return true
  if (r.status === 1) return false
  const failure = (r.stderr || (r.error && r.error.message) || '').trim()
  warn(`could not tell whether ${sha} is an ancestor of HEAD (git exited ${r.status ?? 'abnormally'})${failure ? `: ${failure}` : ''}`)
  return null
}

/**
 * The standard-error lines for a usable `readRunEvidence` result: one naming the
 * commit the record was carried from, then one per dropped tree-bound entry.
 * Nothing for a file read at its exact head.
 *
 * @param {{ carriedFrom?: string, dropped?: Array<{key: string, reason: string}> }} read
 * @param {string} label  how the caller names the file (`--run <path>`)
 * @param {string} headSha
 * @returns {string[]}
 */
export function carryLines(read, label, headSha) {
  const lines = []
  if (read.carriedFrom) {
    lines.push(`${label} is carried from commit ${read.carriedFrom}: only its run record is used, the head ${headSha} descends from it`)
  }
  for (const entry of read.dropped || []) lines.push(`${label}: ${entry.key} dropped: ${entry.reason}`)
  return lines
}
