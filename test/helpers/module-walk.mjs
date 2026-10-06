// The import walker, shared by the two pins that hold a module to the engine's
// environment: the hooks module's closure (test/spine/mod-pins.test.mjs) and the
// renderers' (test/spine/draw-plan.test.mjs). One walker, so the two pins cannot
// drift apart. `npm test` collects `*.test.mjs` only, so this never runs alone.

import { readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'

const rel = (abs, root) => relative(root, abs).split(sep).join('/')

/** Every module specifier a source names: static imports, re-exports, side-effect and dynamic imports. */
export function specifiers(source) {
  const found = new Set()
  for (const re of [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ]) {
    for (const m of source.matchAll(re)) found.add(m[1])
  }
  return [...found]
}

/**
 * The module's import closure, with what each file names that the engine
 * environment cannot load: a `node:` module, or a bare specifier other than
 * `claude-code`. Relative specifiers are walked; each must resolve to a file
 * inside the plugin.
 *
 * @param {string} entry absolute path of the module to walk from
 * @param {string} root the plugin root every walked file must stay inside
 * @returns {{files: string[], problems: string[]}}
 */
export function walkModule(entry, root) {
  const seen = new Set()
  const problems = []
  const queue = [entry]
  while (queue.length) {
    const file = queue.shift()
    if (seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(file, 'utf8')
    for (const spec of specifiers(source)) {
      if (spec.startsWith('node:')) {
        problems.push(`${rel(file, root)} imports '${spec}', a node: module the engine environment does not have`)
      } else if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec)
        const inside = !relative(root, target).startsWith('..')
        if (!inside) problems.push(`${rel(file, root)} imports '${spec}', which resolves outside the plugin`)
        else if (!statSync(target, { throwIfNoEntry: false })?.isFile()) {
          problems.push(`${rel(file, root)} imports '${spec}', which does not resolve to a file`)
        } else queue.push(target)
      } else if (spec !== 'claude-code') {
        problems.push(`${rel(file, root)} imports '${spec}', a bare specifier other than claude-code`)
      }
    }
  }
  return { files: [...seen], problems }
}
