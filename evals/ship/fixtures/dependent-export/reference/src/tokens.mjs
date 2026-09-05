/**
 * Every colour value in the package, written down exactly once.
 *
 * Data only — the decision about what a missing theme means lives in
 * `src/theme.mjs`, so a consumer that only wants the raw values does not pull
 * that behaviour in with them.
 */
export const TOKENS = {
  light: { bg: '#ffffff', fg: '#111111' },
  dark: { bg: '#111111', fg: '#ffffff' }
}
