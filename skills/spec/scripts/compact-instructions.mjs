// Compact an `openspec instructions --json` payload to the fields an author fills.
// Shipped in the plugin so the spec skill does not inline another interpreter.

import { readFileSync } from 'node:fs'

const keep = ['instruction', 'template', 'resolvedOutputPath', 'context', 'rules']

let raw
try {
  raw = readFileSync(0, 'utf8')
} catch (err) {
  process.stderr.write(`compact-instructions: could not read stdin: ${(err && err.message) || err}\n`)
  process.exit(1)
}

let data
try {
  data = JSON.parse(raw)
} catch (err) {
  process.stderr.write(`compact-instructions: stdin is not JSON: ${(err && err.message) || err}\n`)
  process.exit(1)
}

const out = {}
if (data && typeof data === 'object' && !Array.isArray(data)) {
  for (const key of keep) {
    if (data[key]) out[key] = data[key]
  }
}
process.stdout.write(JSON.stringify(out))
