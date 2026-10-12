// The one parser of living-spec text.
//
// Three readers need a spec's `### Requirement:` blocks: the subtraction of a
// requirement a change supersedes, the check that a finding's citation names a
// requirement that exists, and the spec audit. Left to themselves each would
// write its own parser, and they would disagree about what a heading is, where
// a block ends and what a scenario has — the epic's own hand audits already did.
// So this module is the only place that knows the shape, and it is pure: text
// in, a plain structure out. No fs, no clock, no git.
//
// `extractScenarios` in lib/ready.mjs keeps its own job (conformance) and is not
// replaced by this. design D1 of judge-against-base-and-living-specs.

/** The delta sections OpenSpec splits a change's spec into. */
const DELTA_SECTIONS = new Set(['ADDED', 'MODIFIED', 'REMOVED', 'RENAMED'])

const REQUIREMENT_HEADING = /^###\s+Requirement:\s*(.*?)\s*$/
const SCENARIO_HEADING = /^####\s+Scenario:\s*(.*?)\s*$/
const H2 = /^##\s+(.*?)\s*$/
const ANY_HEADING = /^#{1,6}\s/
const FENCE = /^\s*(```|~~~)/
// Only the bulleted bold keyword line counts. The word in running prose does
// not, and neither does AND, which continues a line rather than starting one.
const KEYWORD_LINE = /^\s*[-*]\s+\*\*(GIVEN|WHEN|THEN)\*\*/
const RENAME_LINE = /^\s*[-*]\s+(FROM|TO):\s*`?\s*(?:###\s+Requirement:\s*)?(.*?)\s*`?\s*$/

/**
 * The canonical form of a requirement heading: strip a leading `Requirement:`,
 * trim, collapse internal whitespace, keep case. OpenSpec itself matches
 * requirements whitespace-insensitively and case-sensitively, so a case
 * difference is a different requirement.
 *
 * @param {string} heading
 * @returns {string}
 */
export function requirementKey(heading) {
  return String(heading ?? '')
    .replace(/^\s*Requirement:\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The capability a spec file belongs to, or null when the path is not a spec.
 * Reads the three spellings callers hold: a living spec
 * (`openspec/specs/<cap>/spec.md`), a change's delta spec
 * (`openspec/changes/<name>/specs/<cap>/spec.md`, or `specs/<cap>/spec.md`) and
 * the form relative to a change's specs directory (`<cap>/spec.md`, which is how
 * `inspectChange(...).specFiles` lists them). Windows separators are read too.
 *
 * @param {string} path
 * @returns {string|null}
 */
export function capabilityOf(path) {
  if (typeof path !== 'string' || !path) return null
  const normal = path.replace(/\\/g, '/').replace(/^(\.\/)+/, '')
  if (normal !== 'spec.md' && !normal.endsWith('/spec.md')) return null
  const dir = normal.slice(0, -'spec.md'.length).replace(/\/+$/, '')
  // A spec.md sitting directly in a specs root names no capability.
  if (/(?:^|\/)(?:openspec\/specs|openspec\/changes\/[^/]+\/specs)$/.test(dir) || dir === 'specs') return null
  const rest =
    dir.match(/(?:^|\/)openspec\/changes\/[^/]+\/specs\/(.+)$/)?.[1] ??
    dir.match(/(?:^|\/)openspec\/specs\/(.+)$/)?.[1] ??
    dir.match(/^specs\/(.+)$/)?.[1] ??
    dir
  return rest ? rest : null
}

/** Which delta section an `## <NAME> Requirements` heading opens, or null. */
function deltaSection(h2) {
  const name = h2.trim().split(/\s+/)[0]?.toUpperCase()
  return DELTA_SECTIONS.has(name) ? name : null
}

/**
 * Parse a spec's text, living or delta.
 *
 * `section` on a requirement is the delta section it sits under, and null in a
 * living spec. `prose` is the block apart from its scenarios; `text` is the
 * whole block, heading and scenarios included, ending where the next heading of
 * the same or a higher level begins. A RENAMED section yields FROM/TO pairs and
 * no requirements.
 *
 * @param {string} text
 * @returns {{
 *   purpose: string|null,
 *   requirements: Array<{
 *     heading: string, key: string, section: string|null, line: number,
 *     prose: string, text: string,
 *     scenarios: Array<{ title: string, line: number, given: boolean, when: boolean, then: boolean }>
 *   }>,
 *   renamed: Array<{ from: string, to: string }>
 * }}
 */
export function parseSpec(text) {
  const lines = String(text ?? '').split('\n')
  const requirements = []
  const renamed = []
  const purposeLines = []

  let h2 = null // the current `##` heading's text
  let section = null // the delta section it opens, if any
  let req = null // the requirement being read
  let scenario = null // the scenario being read, inside `req`
  let inFence = false
  let pendingFrom = null

  const closeRequirement = () => {
    if (req) req.text = req.lines.join('\n').trimEnd()
    if (req) req.prose = req.proseLines.join('\n').trim()
    req = null
    scenario = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNo = i + 1

    if (FENCE.test(line)) {
      inFence = !inFence
      if (req) {
        req.lines.push(line)
        if (!scenario) req.proseLines.push(line)
      }
      continue
    }

    if (!inFence && ANY_HEADING.test(line)) {
      const h2Match = line.match(H2)
      if (h2Match) {
        closeRequirement()
        h2 = h2Match[1]
        section = deltaSection(h2)
        pendingFrom = null
        continue
      }
      const reqMatch = line.match(REQUIREMENT_HEADING)
      if (reqMatch) {
        closeRequirement()
        if (section !== 'RENAMED') {
          const heading = reqMatch[1]
          req = {
            heading,
            key: requirementKey(heading),
            section,
            line: lineNo,
            prose: '',
            text: '',
            scenarios: [],
            lines: [line],
            proseLines: []
          }
          requirements.push(req)
        }
        continue
      }
      const scenarioMatch = line.match(SCENARIO_HEADING)
      if (scenarioMatch && req) {
        scenario = { title: scenarioMatch[1], line: lineNo, given: false, when: false, then: false }
        req.scenarios.push(scenario)
        req.lines.push(line)
        continue
      }
      // A `###` that is not a requirement ends the block it interrupts. A
      // deeper heading that is not a scenario is text inside the block.
      if (req && /^#{4,}\s/.test(line)) {
        req.lines.push(line)
        if (!scenario) req.proseLines.push(line)
        continue
      }
      if (req) closeRequirement()
      continue
    }

    if (req) {
      req.lines.push(line)
      if (scenario) {
        const kw = line.match(KEYWORD_LINE)
        if (kw) scenario[kw[1].toLowerCase()] = true
      } else {
        req.proseLines.push(line)
      }
      continue
    }

    if (section === 'RENAMED') {
      const m = line.match(RENAME_LINE)
      if (m) {
        if (m[1] === 'FROM') pendingFrom = m[2]
        else if (pendingFrom !== null) {
          renamed.push({ from: requirementKey(pendingFrom), to: requirementKey(m[2]) })
          pendingFrom = null
        }
      }
      continue
    }

    if (h2 !== null && /^purpose$/i.test(h2.trim())) purposeLines.push(line)
  }
  closeRequirement()

  const purpose = purposeLines.join('\n').trim()
  return {
    purpose: purpose ? purpose : null,
    requirements: requirements.map(({ lines: _lines, proseLines: _proseLines, ...r }) => r),
    renamed
  }
}
