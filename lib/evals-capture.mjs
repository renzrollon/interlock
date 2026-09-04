// Turning a recorded ship-run trajectory into an eval-case skeleton.
//
// The step this closes is the first arrow of the flywheel: production failure →
// regression case → outcome measurement. Today the only route from a consumer's
// misbehaving run to an Interlock regression case is a human pasting a
// transcript into a chat, which loses the one thing a case needs most — a
// citation a reader can follow back to the evidence.
//
// What this emits is a DRAFT, and every property below exists to keep it
// readable as one:
//
//   1. IT REFUSES A RUN IT CANNOT CITE. Reconstructability is `checkRunLog`,
//      called here and reported verbatim. A second, laxer private notion ("has a
//      run-start and any event") would let a skeleton cite an event range a
//      reader following the citation could not replay, which destroys the only
//      thing a captured skeleton has going for it.
//
//   2. IT QUOTES, IT NEVER INVENTS. The grader's pattern is a value read out of
//      the cited events. Where no such value exists, the skeleton says so and
//      carries a stated placeholder — it does not guess a pattern, and it never
//      emits a judged grader, because nothing about a draft has been shown to
//      need judgement.
//
//   3. EVERY DERIVED VALUE IS MARKED. The grader pattern and the prompt both
//      carry an explicit confirmation marker, and `skills/evals/SKILL.md`
//      forbids authoring a case that still carries one.
//
//   4. IT NEVER WRITES INTO THE SUITE. Adding a case is a human decision taken
//      after reading the draft. A command that could write into `evals/` would
//      make a draft indistinguishable from a reviewed case.
//
// The quotable surface is deliberately narrow, and the reason is worth stating:
// `lib/run-log.mjs` coerces every enum-typed field to `null` (or to `other`) at
// the write site, so a value outside `RUN_MODES`, `WAVE_SOURCES`,
// `AGENT_KINDS` or `VERIFY_CONTEXTS` never reaches the trajectory to be quoted
// from it. What survives is the free-text fields — which is why the two rules
// below read exactly those, and why the placeholder path is the common one.
//
// Exposed to skills as `interlock evals capture --run <id> [--task <id>] --out <dir>`.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { checkRunLog, readRunLog, RUN_LOG_DIR } from './run-log.mjs'
import {
  REUSE_MATCH,
  REUSE_MISMATCH,
  REUSE_NO_PLAN,
  REUSE_NO_FINGERPRINT,
  REUSE_UNREADABLE_PLAN,
  REUSE_UNREADABLE_FINGERPRINT,
  REUSE_FORMAT_VERSION,
  REUSE_ERROR
} from './plan-fingerprint.mjs'

/** The eval suite, relative to the repository root. Capture never writes here. */
export const EVAL_SUITE_DIR = 'evals'

/** The case schema version an emitted skeleton pins, matching the seeded cases. */
export const CASE_SCHEMA_VERSION = '1.0'

/** The marker every value capture derived rather than read carries. */
export const CONFIRM_MARKER = 'CONFIRM'

/** What a skeleton carries in place of a value the trajectory did not record. */
export const PLACEHOLDER = `${CONFIRM_MARKER}-REPLACE-ME`

/**
 * Fields whose vocabulary is declared somewhere and whose value the trajectory
 * stores as free text — the only place an out-of-set value can survive the
 * writer's coercion and still be quotable. Each set is imported from the module
 * that owns it, never restated here, so a vocabulary that grows does not leave a
 * second stale copy behind.
 */
const OUT_OF_SET_FIELDS = [
  {
    type: 'run-receipt',
    field: 'planStatus',
    allowed: new Set([
      REUSE_MATCH,
      REUSE_MISMATCH,
      REUSE_NO_PLAN,
      REUSE_NO_FINGERPRINT,
      REUSE_UNREADABLE_PLAN,
      REUSE_UNREADABLE_FINGERPRINT,
      REUSE_FORMAT_VERSION,
      REUSE_ERROR
    ]),
    why: 'the plan-reuse vocabulary lib/plan-fingerprint.mjs declares'
  }
]

/** Event types whose recorded reason names the offending value in double quotes. */
const QUOTING_REASON_TYPES = new Set(['run-halt', 'verify-judgement'])

function messageOf(err) {
  return (err && err.message) || String(err)
}

function refuse(reason, problems = []) {
  return { ok: false, reason, problems, files: [], notes: [] }
}

/** A directory name safe to hand a filesystem and readable as a case name. */
function safeName(value, fallback) {
  const s = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return s || fallback
}

/** Escape for a YAML single-quoted scalar: the one escape YAML has is doubling. */
function yamlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/** Escape for a regex literal, so a quoted value matches itself and nothing else. */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The events the skeleton cites. With no task id that is the whole run; with
 * one, the events carrying it — a narrower citation for a narrower claim.
 *
 * A task id the run never recorded is reported rather than silently widened:
 * a citation that says "this task" while covering the whole run is exactly the
 * kind of provenance a reader cannot check.
 */
function citedEvents(records, taskId) {
  if (!taskId) return { events: records, scope: 'the whole run', note: null }
  const matching = records.filter(r => typeof r.taskId === 'string' && r.taskId === taskId)
  if (!matching.length) {
    return {
      events: records,
      scope: 'the whole run',
      note: `no event in this trajectory carries taskId "${taskId}", so the citation covers the whole run`
    }
  }
  return { events: matching, scope: `task ${taskId}`, note: null }
}

/**
 * One value the run should not have produced, quoted out of the cited events.
 *
 * Two rules, both deterministic and both reading recorded text rather than
 * inferring intent:
 *
 *   - a field whose declared vocabulary does not contain its recorded value, and
 *   - a value the run itself named in double quotes while halting or judging,
 *     which is how this repository's halts report an offending value
 *     (`status "done" is not one of ok, blocked, partial`).
 *
 * Returns `null` when neither fires. That is not a failure — it is the common
 * case, and the caller states it rather than inventing a pattern.
 */
function quotableValue(events) {
  for (const event of events) {
    for (const rule of OUT_OF_SET_FIELDS) {
      if (event.type !== rule.type) continue
      const value = event[rule.field]
      if (typeof value !== 'string' || !value.trim()) continue
      if (rule.allowed.has(value)) continue
      return {
        value,
        seq: event.seq,
        source: `${event.type}.${rule.field}`,
        why: `"${value}" is outside ${rule.why}`
      }
    }
  }
  for (const event of events) {
    if (!QUOTING_REASON_TYPES.has(event.type)) continue
    const reason = typeof event.reason === 'string' ? event.reason : ''
    const quoted = /"([^"\n]{1,120})"/.exec(reason)
    if (!quoted) continue
    return {
      value: quoted[1],
      seq: event.seq,
      source: `${event.type}.reason`,
      why: `the run named "${quoted[1]}" while reporting: ${reason.slice(0, 200)}`
    }
  }
  return null
}

/**
 * The prompt snapshot the cited events recorded, if any.
 *
 * The trajectory records no prompt today — the writer's whitelist has no such
 * field — so this reads what a host may have recorded and otherwise reports
 * nothing. It never reconstructs a prompt from the events: a reconstructed
 * prompt is not the prompt the model was given, and a case built on one tests
 * something that never ran.
 */
function recordedPrompt(events) {
  for (const event of events) {
    if (typeof event.prompt === 'string' && event.prompt.trim()) {
      return { prompt: event.prompt, seq: event.seq }
    }
  }
  return null
}

function indentBlock(text, indent = '    ') {
  return String(text)
    .split('\n')
    .map(line => (line.trim() ? `${indent}${line}` : ''))
    .join('\n')
}

/**
 * Build an eval-case skeleton from a recorded run. Reads only; writes nothing.
 *
 * @param {string} root repository root
 * @param {{runId?: string, taskId?: string}} opts
 * @returns {{
 *   ok: boolean, reason: string|null, problems: string[],
 *   name?: string, provenance?: string, files?: Array<{path: string, contents: string}>,
 *   notes?: string[], quoted?: object|null, promptRecorded?: boolean
 * }}
 */
export function buildSkeleton(root, opts = {}) {
  try {
    const runId = typeof opts.runId === 'string' ? opts.runId.trim() : ''
    const taskId = typeof opts.taskId === 'string' && opts.taskId.trim() ? opts.taskId.trim() : null
    if (!runId) return refuse('no run identifier was given')

    // The published decision, reused rather than re-derived. Its problems are
    // reported verbatim: the caller learns why the run cannot be cited, not
    // merely that it cannot.
    const reconstructable = checkRunLog(root, runId)
    if (!reconstructable.ok) {
      return refuse(
        `run ${runId} is not reconstructable, so nothing may cite it`,
        reconstructable.problems
      )
    }

    const read = readRunLog(root, runId)
    const cited = citedEvents(read.records, taskId)
    const seqs = cited.events.map(e => Number(e.seq)).filter(n => Number.isFinite(n))
    const first = seqs.length ? Math.min(...seqs) : 1
    const last = seqs.length ? Math.max(...seqs) : read.records.length

    const locator = join(RUN_LOG_DIR, `${runId}.jsonl`)
    const provenance = `${locator} events ${first}-${last} (${cited.scope})`

    const notes = []
    if (cited.note) notes.push(cited.note)

    const quoted = quotableValue(cited.events)
    if (!quoted) {
      notes.push(
        'no out-of-set or fabricated value could be quoted from the cited events, so the grader ' +
          `carries a stated placeholder — replace ${PLACEHOLDER} with the value this case should catch`
      )
    }

    const prompt = recordedPrompt(cited.events)
    if (!prompt) {
      notes.push(
        'no prompt was recorded for the cited events, so the prompt is a stated placeholder — ' +
          'paste the briefing the run actually gave the agent, never a paraphrase'
      )
    }

    const name = taskId
      ? `captured-${safeName(runId, 'run')}-task-${safeName(taskId, 'task')}`
      : `captured-${safeName(runId, 'run')}`

    const pattern = quoted ? escapeRegex(quoted.value) : PLACEHOLDER

    const caseYaml =
      `# CAPTURED DRAFT — emitted by \`interlock evals capture\` from a recorded ship-run\n` +
      `# trajectory. This is NOT a reviewed case. Every ${CONFIRM_MARKER} marker below is a value\n` +
      `# capture derived rather than confirmed, and skills/evals/SKILL.md forbids authoring a\n` +
      `# case that still carries one. Resolve each against the cited trajectory, then move the\n` +
      `# directory into evals/ yourself — capture never writes there.\n` +
      `#\n` +
      `# Provenance: ${provenance}\n` +
      notes.map(n => `# ${CONFIRM_MARKER}: ${n}\n`).join('') +
      `schema_version: ${yamlQuote(CASE_SCHEMA_VERSION)}\n` +
      `name: ${name}\n` +
      // No `smoke` tag, deliberately: that tag runs a case on every pull
      // request, and a pattern nobody has confirmed must not gate anyone's PR.
      `tags: []\n` +
      `provenance: ${yamlQuote(provenance)}\n` +
      `runs: 1\n` +
      `execution:\n` +
      `  prompt: |\n` +
      (prompt
        ? indentBlock(prompt.prompt)
        : indentBlock(
            `${CONFIRM_MARKER}: no prompt was recorded for the cited events.\n` +
              `Replace this block with the verbatim briefing the run gave the agent.\n` +
              `Do not paraphrase it and do not reconstruct it from the trajectory.`
          )) +
      `\n  max_turns: 8\n` +
      `  timeout_seconds: 600\n`

    const graderMd =
      `---\n` +
      `type: regex\n` +
      `pattern: ${yamlQuote(pattern)}\n` +
      `weight: 1\n` +
      `---\n` +
      `\n` +
      `${CONFIRM_MARKER} BEFORE USE — this grader was captured, not authored.\n` +
      `\n` +
      (quoted
        ? `The pattern is the value \`${quoted.value}\` quoted from ${quoted.source} at event ` +
          `${quoted.seq} of ${provenance}. ${quoted.why}\n`
        : `No out-of-set or fabricated value could be quoted from the cited events, so the ` +
          `pattern is the placeholder \`${PLACEHOLDER}\`. Capture does not invent a pattern: ` +
          `replace it with the value this case should catch, read from the cited trajectory.\n`) +
      `\n` +
      `Deterministic by construction. Capture never emits a judged grader — nothing about a ` +
      `draft has been shown to need judgement, and a judged grader's run-to-run variance is ` +
      `exactly what triage would (correctly) refuse to call a regression.\n`

    return {
      ok: true,
      reason: null,
      problems: [],
      name,
      provenance,
      quoted,
      promptRecorded: Boolean(prompt),
      notes,
      files: [
        { path: 'case.yaml', contents: caseYaml },
        { path: join('graders', 'observed-value.md'), contents: graderMd }
      ]
    }
  } catch (err) {
    // Never throws: a capture that crashes tells a caller nothing about their
    // run, which is the one thing they came here for.
    return refuse(`the skeleton could not be built: ${messageOf(err)}`)
  }
}

/** Does `dir` resolve inside the eval suite at `root`? */
function insideSuite(root, dir) {
  const suite = resolve(root, EVAL_SUITE_DIR)
  const target = resolve(dir)
  if (target === suite) return true
  const rel = relative(suite, target)
  return Boolean(rel) && !rel.startsWith('..') && !rel.startsWith(`..${sep}`)
}

/** Does `dir` already hold a case? */
function holdsCase(dir) {
  if (!existsSync(dir)) return false
  try {
    if (existsSync(join(dir, 'case.yaml')) || existsSync(join(dir, 'prompt.md'))) return true
    return readdirSync(dir).some(entry => entry === 'graders')
  } catch {
    // An unreadable directory is treated as occupied. Refusing costs the caller
    // one command; overwriting costs them a case they may not have backed up.
    return true
  }
}

/**
 * Build a skeleton and write it into a directory the caller named.
 *
 * Refuses — writing nothing — when the run is not reconstructable, when the
 * output directory resolves inside the eval suite, and when it already holds a
 * case. Every refusal carries its reason; the CLI turns one into an exit code.
 *
 * @param {string} root repository root
 * @param {{runId?: string, taskId?: string, outDir?: string}} opts
 * @returns {{ok: boolean, reason: string|null, problems: string[], written: string[], notes: string[], dir: string|null, provenance: string|null}}
 */
export function captureCase(root, opts = {}) {
  const base = { written: [], dir: null, provenance: null }
  try {
    const outDir = typeof opts.outDir === 'string' && opts.outDir.trim() ? opts.outDir.trim() : ''
    if (!outDir) return { ...refuse('no output directory was given'), ...base }

    const target = resolve(root || '.', outDir)
    if (insideSuite(root || '.', target)) {
      return {
        ...refuse(
          `${outDir} resolves inside ${EVAL_SUITE_DIR}/, and capture never writes into the suite — ` +
            'adding a case is a decision taken after reading the draft'
        ),
        ...base
      }
    }
    if (holdsCase(target)) {
      return { ...refuse(`${outDir} already holds a case; capture refuses rather than overwrite one`), ...base }
    }

    // Built before anything is created, so a refused run leaves no directory
    // behind either.
    const skeleton = buildSkeleton(root, opts)
    if (!skeleton.ok) return { ...skeleton, ...base }

    const written = []
    for (const file of skeleton.files) {
      const path = join(target, file.path)
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, file.contents)
      written.push(path)
    }

    return {
      ok: true,
      reason: null,
      problems: [],
      written,
      dir: target,
      provenance: skeleton.provenance,
      notes: skeleton.notes
    }
  } catch (err) {
    return { ...refuse(`the skeleton could not be written: ${messageOf(err)}`), ...base }
  }
}

/** Human-readable rendering of `captureCase`, for the CLI. */
export function formatCapture(result) {
  if (!result.ok) {
    const lines = [`CAPTURE REFUSED — ${result.reason}`]
    for (const p of result.problems || []) lines.push(`  ${p}`)
    return lines.join('\n') + '\n'
  }
  const lines = [`CAPTURED DRAFT — ${result.dir}`, `  provenance: ${result.provenance}`]
  for (const path of result.written) lines.push(`  wrote ${path}`)
  for (const note of result.notes || []) lines.push(`  ${CONFIRM_MARKER}: ${note}`)
  lines.push('  This is a draft, not a case. Resolve every CONFIRM marker before authoring one.')
  return lines.join('\n') + '\n'
}
