// Lens selection and detection for the artifact brief (change
// `brief-and-record-the-artifact-gate`, design §2; spec
// `spec/artifact-review-brief`).
//
// Pure: no fs, no git, no clock. `briefArtifacts` does the I/O (existsSync, one
// readdirSync of `skills/`, the parsed root package.json, `git ls-files`) and
// hands plain data in, so the order of the sources and the markers are rules
// here that a test can pin without a repository.

/** Dependencies whose presence in a root package.json marks a web UI. */
export const UI_FRAMEWORK_DEPENDENCIES = Object.freeze(['react', 'vue', 'svelte', '@angular/core', 'solid-js', 'preact'])

const DEPENDENCY_MAPS = Object.freeze(['dependencies', 'devDependencies', 'peerDependencies'])

/** The harness markers, in the order the first one found is the one printed. */
const HARNESS_MARKERS = Object.freeze(['.claude-plugin/plugin.json', 'hooks/hooks.json', 'skills/*/SKILL.md'])

/**
 * Choose the lenses: the first source that names any lens wins, even when every
 * name it gives is unknown, so a typed `--lens mobile` never quietly becomes the
 * detected set. Unknown names are returned, never thrown; names past `cap` are
 * returned under `capped`, in source order.
 *
 * @param {{ flag?: string[]|null, policyLenses?: string[], detected?: {name: string, marker: string}[], bundled: string[], cap: number }} input
 * @returns {{ lenses: {name: string, source: string}[], unknown: string[], capped: string[] }}
 */
export function selectLenses({ flag, policyLenses, detected, bundled, cap }) {
  let names = []
  let source = ''
  let markerOf = () => source
  if (Array.isArray(flag) && flag.length > 0) {
    names = flag
    source = '--lens'
  } else if (Array.isArray(policyLenses) && policyLenses.length > 0) {
    names = policyLenses
    source = 'REVIEW.md at HEAD'
  } else if (Array.isArray(detected) && detected.length > 0) {
    names = detected.map(d => d.name)
    markerOf = name => `detected: ${detected.find(d => d.name === name).marker}`
  }
  const known = []
  const unknown = []
  for (const name of names) {
    if (Array.isArray(bundled) && bundled.includes(name)) known.push(name)
    else unknown.push(name)
  }
  const limit = Number.isInteger(cap) && cap >= 0 ? cap : known.length
  return {
    lenses: known.slice(0, limit).map(name => ({ name, source: markerOf(name) })),
    unknown,
    capped: known.slice(limit)
  }
}

/**
 * Detect lenses by named markers, in a fixed order (agentic-harness, then
 * web-ui), each with the one marker found first. `uiFiles` is the tracked UI
 * file list, or an error string when git could not list: then `partial` says
 * web-ui read package.json alone.
 *
 * @param {{ has: (path: string) => boolean, packageJson: object|null, uiFiles: string[]|string }} input
 * @returns {{ detected: {name: string, marker: string}[], partial: string|null }}
 */
export function detectLenses({ has, packageJson, uiFiles }) {
  const detected = []
  const harness = HARNESS_MARKERS.find(marker => has(marker))
  if (harness) detected.push({ name: 'agentic-harness', marker: harness })

  let partial = null
  let ui = null
  if (packageJson && typeof packageJson === 'object') {
    for (const map of DEPENDENCY_MAPS) {
      const deps = packageJson[map]
      if (!deps || typeof deps !== 'object') continue
      const dep = UI_FRAMEWORK_DEPENDENCIES.find(name => Object.hasOwn(deps, name))
      if (dep) { ui = `package.json ${dep}`; break }
    }
  }
  if (typeof uiFiles === 'string') {
    partial = `web-ui read package.json alone: git could not list tracked files (${uiFiles.split('\n')[0]})`
  } else if (!ui && Array.isArray(uiFiles) && uiFiles.length > 0) {
    // A tracked path is repository data on a status line: one with a control character is quoted.
    ui = `tracked ${/[\x00-\x1f\x7f]/.test(uiFiles[0]) ? JSON.stringify(uiFiles[0]) : uiFiles[0]}`
  }
  if (ui) detected.push({ name: 'web-ui', marker: ui })
  return { detected, partial }
}
