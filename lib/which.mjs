// Resolving an executable by scanning PATH, moved out of lib/doctor.mjs so
// lib/openspec-cli.mjs can use it without importing the doctor (which imports
// it back). `lib/doctor.mjs` re-exports `whichSync`, so every importer resolves.

import { accessSync, constants, statSync } from 'node:fs'
import { platform } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/**
 * Resolve an executable the way a shell would, by scanning PATH. Deliberately
 * not `which`/`where`: shelling out to find out whether we can shell out is a
 * probe that fails for the reason it is testing for.
 *
 * Unlike a shell, a relative or empty PATH entry is skipped. The session-start
 * preflight runs what this resolves (`--version` probes), and a `.` or `./bin`
 * entry would resolve against whatever repository the session was opened in.
 */
export function whichSync(name, env = process.env) {
  if (typeof name !== 'string' || !name) return null
  if (name.includes('/') || name.includes('\\')) {
    const abs = isAbsolute(name) ? name : resolve(name)
    return isExecutable(abs) ? abs : null
  }
  const pathVar = typeof env.PATH === 'string' ? env.PATH : typeof env.Path === 'string' ? env.Path : ''
  const sep = platform() === 'win32' ? ';' : ':'
  const exts =
    platform() === 'win32'
      ? (typeof env.PATHEXT === 'string' ? env.PATHEXT : '.COM;.EXE;.BAT;.CMD').split(';')
      : ['']
  for (const dir of pathVar.split(sep)) {
    if (!dir || !isAbsolute(dir)) continue
    for (const ext of exts) {
      const candidate = join(dir, name + ext)
      if (isExecutable(candidate)) return candidate
    }
  }
  return null
}

function isExecutable(path) {
  try {
    if (!statSync(path).isFile()) return false
  } catch {
    return false
  }
  if (platform() === 'win32') return true
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
