// Where Claude Code's settings files live, and one reader for them.
//
// This module imports node builtins and nothing else, on purpose. The ACP
// runner (`bin/interlock-run`) may import only node builtins and the host port,
// and `lib/host/advisor-banners.mjs` needs to read the same four settings files
// the doctor does. Keeping the path list and the read here means the runner's
// import closure does not reach `lib/doctor.mjs` and, through it, the limits,
// verify and policy modules. `lib/doctor.mjs` re-exports `settingsSources`, so
// every existing importer keeps working.

import { existsSync, readFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

/**
 * Settings files Claude Code merges, least specific first. Enterprise managed
 * settings are read too — they can carry a `deny` a project cannot override,
 * which is precisely the kind of surprise that only shows up mid-run.
 *
 * @param {string} root  the project root
 * @param {string} [home]
 * @returns {Array<{scope: string, path: string, optional: boolean}>}
 */
export function settingsSources(root, home = homedir()) {
  const managed =
    platform() === 'darwin'
      ? '/Library/Application Support/ClaudeCode/managed-settings.json'
      : platform() === 'win32'
        ? join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'ClaudeCode', 'managed-settings.json')
        : '/etc/claude-code/managed-settings.json'
  return [
    { scope: 'managed', path: managed, optional: true },
    { scope: 'user', path: join(home, '.claude', 'settings.json'), optional: true },
    { scope: 'project', path: join(root, '.claude', 'settings.json'), optional: true },
    { scope: 'local', path: join(root, '.claude', 'settings.local.json'), optional: true }
  ]
}

/**
 * Read each settings source: absent, its text, or the error that stopped the read.
 * Never throws. An absent file is not a degradation; an `error` is, and the
 * caller is expected to say so.
 *
 * `error` is the thrown value itself, so a caller formats it with its own
 * redaction rules (a read error names a path, never the file's content).
 *
 * @param {Array<{scope: string, path: string}>} sources
 * @returns {Array<{scope: string, path: string, absent: true} | {scope: string, path: string, text: string} | {scope: string, path: string, error: unknown}>}
 */
export function readSettingsSources(sources) {
  const out = []
  for (const source of Array.isArray(sources) ? sources : []) {
    if (!source || typeof source.path !== 'string') continue
    const { scope, path } = source
    if (!existsSync(path)) {
      out.push({ scope, path, absent: true })
      continue
    }
    try {
      out.push({ scope, path, text: readFileSync(path, 'utf8') })
    } catch (error) {
      out.push({ scope, path, error })
    }
  }
  return out
}
