import { TOKENS } from './tokens.mjs'

/**
 * Resolve a theme name to its palette, with the name attached.
 *
 * Throws rather than returning undefined: by the time a caller dereferences a
 * missing palette the name that was asked for is gone, and the error is then
 * about a property rather than about a theme.
 *
 * @param {string} name
 * @returns {{ name: string, bg: string, fg: string }}
 */
export function themeFor(name) {
  const palette = TOKENS[name]
  if (!palette) {
    throw new Error(`unknown theme "${name}" — known themes: ${Object.keys(TOKENS).join(', ')}`)
  }
  return { name, ...palette }
}
