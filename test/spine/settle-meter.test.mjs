// The settle meter's text rules (observe-the-settle-run-live design D1-D27),
// over the captures in test/fixtures/mod/settle-run.mjs and hand-built edges.
//
// The rules are pure, so the Node runner reaches every branch here; the kit
// (`test/mod/settle-meter.test.ts`) then only proves the engine wiring. These
// tests fail until lib/settle-meter.mjs exists (tasks section 2).
//
// Calling forms the sections below rely on, written down once:
//   applySettleLines(settle, input, result, at)   input is the Bash tool input
//        ({ command, run_in_background? }), result the tool result, at the clock
//   noteSettleSpawn(settle, input, spawned, at)   the agent.spawn input and result
//   noteSettleStep(settle, input, result, at)     a turn.step input and result
//   noteSettleEnd(settle, input, at)              a turn.complete input
//   settleLines(command)                          every stage of a command, in order,
//                                                 as { kind, segment }; kind is null
//                                                 for a stage no keyed line names
//   settleLineKind(stage)                         the stage's kind, or null
//   roleOf(prompt)                                { role, label?, round? } or null
//   settleStatusText(settle, { shipLive, specPhase })
//                                                 the line the settle meter puts on the
//                                                 status line, or null when it holds none
//   settlePaneLines(settle, columns)              [{ key, text, bold?, dim? }]
//
// A record starts as `freshSettle()` and is made live the way the hooks module
// makes it: `phase = 'live'`, `startedAt` the clock reading.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assembleSettleRemediatePrompt } from '../../lib/prompts/settle-remediate.mjs'
import { assembleDimensionPrompt } from '../../lib/prompts/review-dimension.mjs'
import { assembleSkepticPrompts } from '../../lib/prompts/review-skeptics.mjs'
import { SKEPTIC_ROLES } from '../../lib/review-roles.mjs'
import { clockText, durationText } from '../../lib/meter-time.mjs'
import { LIMITS } from '../../lib/limits.mjs'
import {
  SETTLE_KINDS,
  applySettleLines,
  freshSettle,
  noteSettleEnd,
  noteSettleSpawn,
  noteSettleStep,
  roleOf,
  settleDrawsCards,
  settleLineKind,
  settleLines,
  settleLoad,
  settleLoadsCreate,
  settleLoadsReview,
  settlePaneLines as paneLinesOf,
  settleStatusText
} from '../../lib/settle-meter.mjs'
import { promptSkill, skillRole } from '../../lib/spec-meter.mjs'
import * as R from '../fixtures/mod/settle-run.mjs'

/** Asserts that every line's spans join to exactly its text (draw-the-settle-and-spec-panes-as-cards D1). */
function assertSpansJoin(lines) {
  for (const line of lines) {
    assert.ok(Array.isArray(line.spans), `${line.key}: no spans`)
    assert.equal(line.spans.map(s => s.text).join(''), line.text, `${line.key}: the spans do not join to the text`)
  }
}
/** The pane every test in this file draws: each pane is held to the spans rule as it is drawn. */
function settlePaneLines(settle, columns) {
  const lines = paneLinesOf(settle, columns)
  assertSpansJoin(lines)
  return lines
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(ROOT, 'bin', 'interlock')

// --- the shared kit: records, clock, Bash results, agent events ---------------

const A96 = 'a96cb82cedb626d9b6c11c1f6a090b7e52a2afa8'
const H161 = '161f955745b9443e9890890c1ce57ab627ea59af'
const CHANGE = R.CHANGE
const T0 = Date.UTC(2026, 9, 26, 9, 29, 22)
/** The clock reading `s` seconds into the run. */
const at = s => T0 + s * 1000

/** A settle run loaded with `--review`, made live the way the hooks module makes it. */
function live(startedAt = 0, review = true) {
  const s = freshSettle({ review })
  s.phase = 'live'
  s.startedAt = at(startedAt)
  return s
}

/** A Bash result as the engine raises it, with `stdout` as the command printed it (probe 2026-10-26). */
const okBash = (command, stdout = '') => {
  const out = stdout.replace(/\s+$/, '')
  return { command, result: { stdout: out, stderr: '', interrupted: false, isImage: false, noOutputExpected: out === '' }, text: out }
}
const errBash = (command, code, body) => ({
  command,
  result: `Error: Exit code ${code}\n${body}`,
  text: `Exit code ${code}\n${body}`,
  isError: true
})

/** The one place these tests meet applySettleLines' calling form. */
const cross = (settle, fixture, seconds, extra = {}) => applySettleLines(settle, { command: fixture.command, ...extra }, fixture, at(seconds))

const json = value => JSON.stringify(value, null, 2)
const ROUTING = json({
  depth: 'lean',
  roles: {
    'explore-investigator': { model: 'sonnet', effort: 'medium' },
    'review-dimension': { model: 'sonnet', effort: 'medium' },
    'review-skeptic': { model: null, effort: 'xhigh' },
    'settle-fixer': { model: null, effort: 'xhigh' },
    'settle-conformance': { model: 'sonnet', effort: null },
    'artifact-reviewer': { model: null, effort: null }
  },
  review: { dimensions: ['language', 'technical-lead'], skeptics: 'per-review' },
  banners: [],
  overrides: { effortLevel: null, subagentModelForce: null }
})
const ROUTING_FIXER = json({ role: 'settle-fixer', depth: 'lean', model: null, effort: 'xhigh', banners: [], overrides: { effortLevel: null, subagentModelForce: null } })
const ROUTING_CONFORMANCE = json({ role: 'settle-conformance', depth: 'lean', model: 'sonnet', effort: null, banners: [], overrides: { effortLevel: null, subagentModelForce: null } })

const routing = okBash('interlock routing --json', ROUTING)
const routingFixer = okBash('interlock routing settle-fixer --json', ROUTING_FIXER)
const routingConformance = okBash('interlock routing settle-conformance --json', ROUTING_CONFORMANCE)

const TREE_CHECK = 'git status --porcelain=v1 -z --untracked-files=all | interlock settle tree-check --change route-prose-spawns-by-role --status -'
const treeClean = okBash(TREE_CHECK, 'clean')
const comment = okBash(
  `interlock settle comment --review .claude/ship/settle/review-r0.json --head ${A96} --round 0 | gh pr comment 25 --body-file -`,
  'https://github.com/example/repo/pull/25#issuecomment-1'
)
const commitPush = okBash(
  'git commit -m "fix(review): answer the PR #25 review round 1" -m "Refs: #25" && git push',
  '[feat/leaner-review 161f955] fix(review): answer the PR #25 review round 1\n 2 files changed, 7 insertions(+), 3 deletions(-)'
)
const reviewR1 = (() => {
  const doc = JSON.parse(R.BASH_SETTLE_REVIEW.result.stdout)
  doc.counts = { ...doc.counts, raised: 1, surviving: 5 }
  doc.head = H161
  return okBash(
    `interlock review --findings .claude/ship/settle/findings-r1.json --verdicts .claude/ship/settle/verdicts-r1.json --changed CHANGELOG.md --base origin/main --metrics ${CHANGE} --dimensions .claude/ship/settle/dimensions-r1.json --head ${H161} --out .claude/ship/settle/review-r1.json --json`,
    json(doc)
  )
})()
const repliesR1 = okBash(
  `interlock settle replies --before .claude/ship/settle/review-r0.json --after .claude/ship/settle/review-r1.json --head ${H161} | gh pr comment 25 --body-file -`,
  'https://github.com/example/repo/pull/25#issuecomment-2'
)
const TREE_CHECK_R2 = TREE_CHECK
const conformanceBrief = okBash(
  `interlock settle conformance-brief ${CHANGE} --changed CHANGELOG.md README.md --base origin/main --head ${H161}`,
  `Confirm change "${CHANGE}" against its diff at head ${H161}.\n\nScenarios — for each one below, read the implementation.`
)
const verifyPlan = okBash('interlock verify plan --profile .claude/testing/profile.json --context final --changed CHANGELOG.md --json > .claude/ship/settle/plan.json')
const verifyExec = okBash('interlock verify exec --kind unit --command "npm test"', 'tests 3201\npass 3201')
const verifyJudge = okBash(`interlock verify judge --plan .claude/ship/settle/plan.json --results .claude/ship/settle/results.json --context final --head ${H161} --json > .claude/ship/settle/verify.json.tmp`)
const checksWatch = okBash('gh pr checks 25 --watch')
const MC_MARKDOWN = R.BASH_SETTLE_MERGE_CONFIDENCE.command.replace(/ --json$/, ' --markdown')
const mcMarkdown = okBash(MC_MARKDOWN, '## Merge confidence: HUMAN 58')
const addLabels = okBash('gh pr edit 25 --add-label "interlock/human-review,interlock/score-58"', 'https://github.com/example/repo/pull/25')
const drift = okBash(
  'interlock drift --changed CHANGELOG.md README.md --json',
  json({ root: '.', unarchived: [CHANGE], stale: { skipped: false, reason: null, broken: [], aging: [] } })
)

/** A dimension brief as the plugin bundles it: the file is the agent's whole instruction. */
const brief = name => readFileSync(join(ROOT, 'skills', 'review-code', 'dimensions', `${name}.md`), 'utf8')
const SKEPTIC_REFUTE = 'You are a skeptical code reviewer. Your job is to REFUTE this finding if you can.\nRead the actual file and its surrounding context.'
const SKEPTIC_SECOND = 'You are an independent reviewer giving a second opinion. Read the actual file.'
const FIXER_PROMPT = JSON.parse(R.BASH_SETTLE_BRIEF.result.stdout).briefing
const WORKER_PROMPT = `Confirm change "${CHANGE}" against its diff at head ${H161}.\n\nScenarios — for each one below, read the implementation.`

/** The engine's spawn event: the captured one with the prompt, model and type of this agent. */
function spawnEvent(prompt, { model, agentId, resolved, subagentType = 'general-purpose', parentModel = 'claude-opus-5-5' }) {
  const input = { ...R.SPAWN_ROUTED.input, prompt, subagentType, parentModel }
  if (model === undefined) delete input.model
  else input.model = model
  return { input, spawned: { model: resolved, agentId } }
}
/** The engine's turn.step: the captured one for this agent, its level, its served model and its token counts. */
function stepEvent(agentId, { index, effort, model, input = 13971, output = 52 }) {
  const e = { ...R.STEP_AGENT_TOOL.input, agentId, index, model }
  if (effort === undefined) delete e.effort
  else e.effort = effort
  return { input: e, result: { ...R.STEP_AGENT_TOOL.result, index, usage: { ...R.STEP_AGENT_TOOL.result.usage, input_tokens: input, output_tokens: output, model } } }
}
const endEvent = (agentId, { reason = 'answer', durationMs }) => ({
  ...R.COMPLETE_AGENT_TOOL.input,
  agentId,
  reason,
  durationMs,
  isAborted: reason === 'aborted'
})
/** `n` readings from `from` to `to` seconds, both included. */
const spread = (from, to, n) => Array.from({ length: n }, (_, i) => (n === 1 ? to : from + ((to - from) * i) / (n - 1)))

/**
 * Spawns an agent and replays its life: `steps` are the clock readings (seconds)
 * of its turn.step results, `efforts` the level each one carried (the last one
 * repeats), `end` is `{ at, reason, durationMs }` or absent for a live agent.
 */
function agent(settle, { id, prompt, model, resolved, subagentType, parentModel, spawnAt, steps = [], efforts = ['medium'], served = resolved, end }) {
  const sp = spawnEvent(prompt, { model, agentId: id, resolved, subagentType, parentModel })
  noteSettleSpawn(settle, sp.input, sp.spawned, at(spawnAt))
  steps.forEach((seconds, i) => {
    const st = stepEvent(id, { index: i, effort: efforts[Math.min(i, efforts.length - 1)], model: Array.isArray(served) ? served[Math.min(i, served.length - 1)] : served })
    noteSettleStep(settle, st.input, st.result, at(seconds))
  })
  if (end) noteSettleEnd(settle, endEvent(id, end), at(end.at))
}

const GROUP_LABELS = ['review', 'resolve', 'round 1', 'round 2', 'ready', 'conformance', 'verify', 'checks', 'merge confidence', 'publish', 'drift']
const CLOCK = /\d\d:\d\d:\d\d/
/** The index of a group's heading: its first line to start with the section word and carry a clock reading. */
const headingAt = (lines, label) => lines.findIndex(l => new RegExp(`^${label}\\b`).test(l.text) && CLOCK.test(l.text))
/** The texts between a group's heading and the next group's heading. */
function section(lines, label) {
  const start = headingAt(lines, label)
  assert.ok(start >= 0, `no heading for the ${label} group in:\n${lines.map(l => l.text).join('\n')}`)
  const after = GROUP_LABELS.map(g => headingAt(lines, g)).filter(i => i > start)
  const stop = after.length ? Math.min(...after) : lines.length
  return lines.slice(start + 1, stop).map(l => l.text)
}
const textsOf = lines => lines.map(l => l.text)

// --- the load reader (D4) ----------------------------------------------------

test('settleLoad starts a run on the settle skill with --review, typed or loaded, and on the review-code skill', () => {
  for (const name of ['interlock:settle', '/interlock:settle']) {
    for (const args of ['--review', '--create --review', '--review --create', '  --review  ', '25 --review']) {
      assert.equal(settleLoad(name, args), 'settle', `${name} ${JSON.stringify(args)}`)
    }
  }
  // The typed form: the first word of the prompt names the skill, the rest of the line is its arguments.
  assert.equal(settleLoad(promptSkill('/interlock:settle --create --review'), '--create --review'), 'settle')
  // The review-code skill is named alone: the run it joins is the settle run's.
  for (const args of ['', undefined, null, '--changed a.md']) assert.equal(settleLoad('interlock:review-code', args), 'review', String(args))
  assert.equal(settleLoad('/interlock:review-code', ''), 'review')
})

test('settleLoad starts a run on every settle load without --review too, and reads nothing from another skill or a name that is not text', () => {
  // draw-the-settle-and-spec-panes-as-cards D4: every settle load starts a run; settleLoadsReview reads which pass it is.
  for (const name of ['interlock:settle', '/interlock:settle']) {
    for (const args of ['--create', '', undefined, null, 42, {}, [], 'review', '--reviewer', '--review-depth lean', 'no--review', '--no-review']) {
      assert.equal(settleLoad(name, args), 'settle', `${name} ${JSON.stringify(args)}`)
    }
  }
  assert.equal(settleLoad(promptSkill('/interlock:settle --create'), '--create'), 'settle')
  for (const name of ['interlock:spec', 'interlock:ship', 'interlock:explore', 'interlock:settled', 'interlock:settle-x', 'settle', 'review-code', 'other:settle', '', 42, null, undefined]) {
    assert.equal(settleLoad(name, '--review'), null, `${JSON.stringify(name)} --review`)
  }
})

test('settleLoadsReview is true only for the word --review itself among the load\'s arguments', () => {
  for (const args of ['--review', '--create --review', '--review --create', '  --review  ', '25 --review', '--create\t--review\n']) {
    assert.equal(settleLoadsReview(args), true, JSON.stringify(args))
  }
  for (const args of ['--create', '', '--reviewer', '--no-review', '--review-depth lean', 'no--review', 'review', '--review=1', undefined, null, 42, {}, ['--review']]) {
    assert.equal(settleLoadsReview(args), false, JSON.stringify(args))
  }
})

test('the review\'s M1: settleLoadsCreate is true only for the word --create itself, and freshSettle keeps only a true flag', () => {
  for (const args of ['--create', '--create --review', '--review --create', '  --create  ', '25 --create']) assert.equal(settleLoadsCreate(args), true, JSON.stringify(args))
  for (const args of ['--review', '', '--created', '--no-create', '--create=1', 'create', undefined, null, 42, {}, ['--create']]) {
    assert.equal(settleLoadsCreate(args), false, JSON.stringify(args))
  }
  assert.equal(freshSettle({ create: true }).create, true)
  for (const flags of [undefined, {}, { create: false }, { create: 'yes' }]) assert.equal(freshSettle(flags).create, false, JSON.stringify(flags))
})

test('the review\'s M1: only the branch\'s own pull request lookup is keyed, never one that names a pull request', () => {
  for (const stage of ['gh pr view', 'gh pr view 2>/dev/null', 'gh pr view --json number,baseRefName', 'glab mr view 2>/dev/null', 'glab mr view --output json']) {
    assert.equal(settleLineKind(stage), 'pr-lookup', stage)
  }
  for (const stage of ['gh pr view 25 --json headRefOid', 'gh pr view <n> --json isDraft --jq .isDraft', 'glab mr view 7', 'glab mr view <iid> --output json', 'gh pr viewer']) {
    assert.equal(settleLineKind(stage), null, stage)
  }
})

test('the review\'s M1: a pass without --create ends at a failed branch lookup, and the status line yields to a spec checkpoint', () => {
  const s = live(0, false)
  cross(s, errBash('gh pr view 2>/dev/null', 1, 'no pull requests found for branch "feat/x"'), 2)
  assert.equal(s.phase, 'done')
  assert.equal(s.endedAt, at(2))
  assert.equal(groupRows(s, 'resolve')[0], `${clockText(at(2))} gh pr view exit 1`)
  assert.ok(textsOf(settlePaneLines(s, 144)).some(t => t.startsWith('done ')))
  assert.equal(settleStatusText(s, { shipLive: false, specPhase: 'checkpoint' }), null)
  // A keyed line after the stop files nothing.
  cross(s, routing, 3)
  assert.deepEqual(s.groups.map(g => g.rows.length), [1])

  const glab = live(0, true)
  cross(glab, errBash('glab mr view 2>/dev/null', 1, ''), 2)
  assert.equal(glab.phase, 'done', 'a --review pass stops at §2 the same way')
  assert.equal(groupRows(glab, 'review')[0], `${clockText(at(2))} glab mr view exit 1`)
})

test('the review\'s M1: a found pull request, a --create load, a later numbered lookup and an exit not its own keep the pass live', () => {
  const found = live(0, false)
  cross(found, okBash('gh pr view 2>/dev/null', 'title:\tx\nnumber:\t25'), 2)
  assert.equal(found.phase, 'live')
  assert.equal(groupRows(found, 'resolve')[0], `${clockText(at(2))} gh pr view exit 0`)

  const create = freshSettle({ review: false, create: true })
  create.phase = 'live'
  cross(create, errBash('gh pr view 2>/dev/null', 1, 'no pull requests found'), 2)
  assert.equal(create.phase, 'live', 'with --create, §4 makes the pull request the lookup did not find')

  const numbered = live(0, false)
  cross(numbered, errBash('gh pr view 25 --json headRefOid --jq .headRefOid', 1, 'HTTP 502'), 2)
  assert.equal(numbered.phase, 'live')

  const piped = live(0, false)
  cross(piped, errBash('gh pr view --json number | jq .number', 1, ''), 2)
  assert.equal(piped.phase, 'live', 'a pipe may have set the exit')
})

test('freshSettle records whether the load carried --review, and only a true flag counts', () => {
  assert.equal(freshSettle({ review: true }).review, true)
  for (const flags of [undefined, {}, { review: false }, { review: 'yes' }, { review: 1 }]) assert.equal(freshSettle(flags).review, false, JSON.stringify(flags))
})

test('settleLoad leaves the spec meter\'s skillRole alone: the settle and review-code skills are still no role there', () => {
  assert.equal(skillRole('interlock:settle'), null)
  assert.equal(skillRole('interlock:review-code'), null)
  assert.equal(skillRole('interlock:spec'), 'spec')
})

// --- the line reader (D8, D19) -------------------------------------------------

/** Every stage of a command as { kind, text }, the segment trimmed and an absent kind read as null. */
const stagesOf = command => settleLines(command).map(({ kind, segment }) => ({ kind: kind ?? null, text: String(segment).trim() }))

test('settleLines reads each segment of a compound command in order, split at && || ; and line breaks', () => {
  const commit = stagesOf('git commit -m "x" -m "Refs: #25" && git push')
  assert.deepEqual(commit.map(s => s.text.split(' ').slice(0, 2).join(' ')), ['git commit', 'git push'])
  assert.ok(commit[0].kind && commit[1].kind, 'git commit and git push are keyed lines')
  assert.notEqual(commit[0].kind, commit[1].kind)

  const mixed = stagesOf('interlock settle fixer-result --result r.json --review v.json --round 1 --head abc1234 --brief b.json || echo failed\ngit status; interlock drift --changed a.md --json')
  assert.equal(mixed.length, 4)
  assert.deepEqual(mixed.map(s => s.kind !== null), [true, false, false, true])
  assert.ok(mixed[1].text.startsWith('echo failed') && mixed[2].text.startsWith('git status') && mixed[3].text.startsWith('interlock drift'))
})

test('settleLines splits at an unquoted pipe and keys each stage by its own first words', () => {
  const piped = stagesOf(TREE_CHECK)
  assert.equal(piped.length, 2)
  assert.ok(piped[0].text.startsWith('git status --porcelain=v1') && piped[0].kind === null)
  assert.ok(piped[1].text.startsWith('interlock settle tree-check') && piped[1].kind)

  const view = stagesOf(R.BASH_SETTLE_PIPELINE.command)
  assert.equal(view.length, 2, 'gh pr view ... | interlock pipeline ...')
  assert.ok(view[0].text.startsWith('gh pr view 25') && view[0].kind === null)
  assert.ok(view[1].text.startsWith('interlock pipeline') && view[1].kind)

  const comment2 = stagesOf(comment.command)
  assert.equal(comment2.length, 2)
  assert.ok(comment2[0].text.startsWith('interlock settle comment') && comment2[0].kind)
  assert.ok(comment2[1].text.startsWith('gh pr comment 25'), 'the pull request number sits on the second stage')

  const restore = stagesOf('git diff --cached --name-only -z | interlock settle test-paths --changed - --profile p.json --protected-only --nul | git --literal-pathspecs restore --staged --worktree --source=HEAD --pathspec-from-file=- --pathspec-file-nul')
  assert.equal(restore.length, 3)
  assert.deepEqual(restore.map(s => s.kind !== null), [false, true, false])
})

test('settleLines never splits inside quotes, and a redirect is not a stage', () => {
  const quoted = stagesOf('interlock pipeline --github - --required "a | b" --required \'c && d\' --out p.json')
  assert.equal(quoted.length, 1)
  assert.ok(quoted[0].kind)
  const single = stagesOf("echo 'x $(interlock drift --changed a.md --json)' | cat")
  assert.equal(single.length, 2, 'a $( inside single quotes is text')
  assert.ok(single.every(s => s.kind === null))
  const redirected = stagesOf(verifyPlan.command)
  assert.equal(redirected.length, 1)
  assert.ok(redirected[0].kind)
})

test('settleLines splits at $( and reads the stage inside double quotes, so the GitLab lines are seen', () => {
  const note = stagesOf('glab mr note 7 --message "$(interlock settle comment --review .claude/ship/settle/review-r0.json --head abc1234 --round 0)"')
  assert.ok(note.length >= 2)
  assert.ok(note[0].text.startsWith('glab mr note 7'))
  const inner = note.find(s => s.text.startsWith('interlock settle comment'))
  assert.ok(inner && inner.kind, 'the interlock stage inside the double quotes is keyed')

  const bare = stagesOf('echo $(interlock drift --changed a.md --json)')
  assert.ok(bare.some(s => s.text.startsWith('interlock drift') && s.kind))

  const nested = stagesOf('x="$(git diff --cached --name-only -z | interlock settle test-paths --changed - --json)"')
  assert.ok(nested.some(s => s.text.startsWith('git diff') && s.kind === null))
  assert.ok(nested.some(s => s.text.startsWith('interlock settle test-paths') && s.kind))
})

test('a quoted heredoc body is one argument and is never re-split into lines', () => {
  const body = 'a | interlock settle fixer-result --round 9\nb; interlock drift --changed x.md --json\nc $(interlock pipeline --github -)'
  for (const command of [
    `gh pr edit 25 --body "$(cat <<'EOF'\n${body}\nEOF\n)"`,
    `glab mr update 7 --description "$(cat <<'EOF'\n${body}\nEOF\n)"`,
    `gh pr create --title "t" --body-file - <<'EOF'\n${body}\nEOF`
  ]) {
    const stages = stagesOf(command)
    assert.ok(stages.length >= 1, command)
    assert.ok(stages.every(s => s.kind === null), `a body line was keyed in: ${command}\n${JSON.stringify(stages)}`)
    assert.ok(!stages.some(s => s.text.startsWith('interlock')), `a body line became a stage of: ${command}`)
  }
  assert.ok(stagesOf(`gh pr edit 25 --body "$(cat <<'EOF'\n${body}\nEOF\n)"`).some(s => s.text.startsWith('cat <<')))
})

test('settleLines reads nothing from a command that is not text', () => {
  for (const command of [undefined, null, 7, {}, '', '   ']) assert.deepEqual(settleLines(command), [], JSON.stringify(command))
})

// --- the keyed lines (spec requirement 2, D19) ---------------------------------

/** Every keyed stage of the spec and design D19, by the family whose rows draw alike. */
const KEYED_STAGES = [
  ['routing', 'interlock routing --json'],
  ['routing', 'interlock routing --depth lean --json'],
  ['routing', 'interlock routing settle-fixer --json'],
  ['routing', 'interlock routing settle-conformance --json'],
  ['surface', 'interlock surface --changed a.md --json'],
  ['domain-context', `interlock domain-context ${CHANGE} --changed a.md --base origin/main --json`],
  ['gate', `interlock gate --findings f.json --metrics ${CHANGE} --json`],
  ['changes', 'interlock changes'],
  ['review-policy', 'interlock review-policy --base origin/main --json'],
  ['autonomy', 'interlock autonomy record review-code --blockers 0'],
  ['note-derive', `interlock note derive --findings s.json --change ${CHANGE} --json`],
  ['review', 'interlock review --findings f.json --verdicts v.json --json'],
  ['review', R.BASH_SETTLE_REVIEW.command],
  ['comment', 'interlock settle comment --review .claude/ship/settle/review-r0.json --head abc1234 --round 0'],
  ['replies', 'interlock settle replies --before r0.json --after r1.json --head abc1234'],
  ['tree-check', 'interlock settle tree-check --change c --status -'],
  ['test-paths', 'interlock settle test-paths --changed - --profile p.json --json'],
  ['test-paths', 'interlock settle test-paths --changed - --profile p.json --protected-only --nul'],
  ['remediate-brief', R.BASH_SETTLE_BRIEF.command],
  ['fixer-result', R.BASH_SETTLE_FIXER_RESULT.command],
  ['conformance-brief', `interlock settle conformance-brief ${CHANGE} --changed a.md --base origin/main --head abc1234`],
  ['git-commit', 'git commit -m "fix: x"'],
  ['git-push', 'git push'],
  ['ready', 'gh pr ready 25'],
  ['ready', 'glab mr update 7 --ready'],
  ['verify', 'interlock verify plan --profile p.json --context final --changed a.md --json'],
  ['verify', 'interlock verify exec --kind unit --command "npm test"'],
  ['verify', 'interlock verify judge --plan p.json --results r.json --context final --head abc1234 --json'],
  ['verify', 'interlock verify coverage --changed a.md --json'],
  ['checks', 'gh pr checks 25 --watch'],
  ['checks', 'glab ci get --merge-request 7 --output json'],
  ['pipeline', 'interlock pipeline --github - --required test --out p.json'],
  ['merge-confidence', R.BASH_SETTLE_MERGE_CONFIDENCE.command],
  ['merge-confidence', MC_MARKDOWN],
  ['merge-confidence', `interlock merge-confidence ${CHANGE} --base origin/main --json > mc.json`],
  ['label-names', 'interlock merge-confidence --label-names --json'],
  ['label-add', 'gh pr edit 25 --add-label "interlock/human-review,interlock/score-58"'],
  ['label-add', 'glab mr update 7 --label "interlock/human-review,interlock/score-58"'],
  ['label-remove', 'gh pr edit 25 --remove-label "interlock/merge"'],
  ['label-remove', 'glab mr update 7 --unlabel "interlock/merge,interlock/blocked"'],
  ['drift', 'interlock drift --changed a.md README.md --json']
]

test('settleLineKind keys every line of the spec and design D19, the test-paths and label-removal lines included', () => {
  for (const [family, stage] of KEYED_STAGES) {
    const kind = settleLineKind(stage)
    assert.ok(typeof kind === 'string' && kind !== '', `${family}: no kind for: ${stage}`)
    assert.equal(settleLineKind(`   ${stage}`), kind, `leading whitespace changes the kind of: ${stage}`)
  }
})

test('settleLineKind gives one kind to the lines of a family, the gh and glab spellings alike', () => {
  const kinds = new Map()
  for (const [family, stage] of KEYED_STAGES) {
    const kind = settleLineKind(stage)
    if (['routing', 'ready', 'checks', 'label-add', 'label-remove', 'test-paths', 'review'].includes(family)) {
      if (!kinds.has(family)) kinds.set(family, kind)
      assert.equal(kind, kinds.get(family), `${family} splits across two kinds at: ${stage}`)
    }
  }
  // The --json and --markdown forms of one command are one line read twice (D26), not two kinds.
  assert.equal(settleLineKind(R.BASH_SETTLE_MERGE_CONFIDENCE.command), settleLineKind(MC_MARKDOWN))
})

test('settleLineKind keeps the lines that open different sections apart', () => {
  const firsts = [
    'interlock routing --json',
    R.BASH_SETTLE_REVIEW.command,
    'interlock settle tree-check --change c --status -',
    R.BASH_SETTLE_BRIEF.command,
    R.BASH_SETTLE_FIXER_RESULT.command,
    'git commit -m "fix: x"',
    'git push',
    'gh pr ready 25',
    'gh pr checks 25 --watch',
    'interlock pipeline --github -',
    R.BASH_SETTLE_MERGE_CONFIDENCE.command,
    'gh pr edit 25 --add-label a',
    'interlock drift --changed a.md --json'
  ].map(settleLineKind)
  assert.equal(new Set(firsts).size, firsts.length, `two of these lines share a kind: ${firsts.join(', ')}`)
})

test('settleLineKind keys nothing the settle skill runs without the reader needing it, and no verb nobody keyed', () => {
  for (const stage of [
    '',
    'git status --porcelain=v1 -z --untracked-files=all',
    'git diff --cached --name-only -z',
    'git add -A',
    'git log --oneline',
    "git --literal-pathspecs restore --staged --worktree --source=HEAD --pathspec-from-file=-",
    'gh pr view 25 --json headRefOid',
    'gh pr create --draft --title t',
    'gh pr comment 25 --body-file -',
    'gh pr edit 25 --body x',
    'gh pr checks 25 --required',
    'gh label create interlock/merge',
    'glab mr view 7',
    'glab mr create --title t',
    'glab mr update 7 --description x',
    "cat <<'EOF'",
    'echo interlock drift --changed a.md',
    'interlock',
    'interlock settle',
    'interlock settle brand-new-verb --changed -',
    'interlock brand-new-verb',
    'npm test'
  ]) {
    assert.equal(settleLineKind(stage), null, JSON.stringify(stage))
  }
  for (const value of [undefined, null, 7, {}]) assert.equal(settleLineKind(value), null, JSON.stringify(value))
})

// --- applySettleLines: the sections (D14, D20, D21) -----------------------------

const header = settle => settlePaneLines(settle, 144)[0].text
const run = (settle, command, stdout, seconds, extra) => cross(settle, okBash(command, stdout), seconds, extra)
const groupRows = (settle, label, columns = 144) => section(settlePaneLines(settle, columns), label)

/** A run at the top of round 1: routing, the review record, its comment, the round's tree-check and brief. */
function inRound1() {
  const s = live()
  cross(s, routing, 0)
  cross(s, R.BASH_SETTLE_REVIEW, 300)
  cross(s, comment, 311)
  cross(s, treeClean, 320)
  cross(s, R.BASH_SETTLE_BRIEF, 326)
  return s
}

test('the first keyed line opens review, and no other section is drawn until a line opens it', () => {
  const s = live()
  cross(s, routing, 0)
  const lines = settlePaneLines(s, 144)
  assert.ok(headingAt(lines, 'review') >= 0)
  for (const label of GROUP_LABELS.filter(g => g !== 'review')) assert.equal(headingAt(lines, label), -1, `${label} is drawn before a line opens it`)
})

test('a tree-check after the review record opens its round; before any record it appends to the section open', () => {
  const early = live()
  cross(early, routing, 0)
  cross(early, treeClean, 5)
  const earlyLines = settlePaneLines(early, 144)
  assert.equal(headingAt(earlyLines, 'round 1'), -1, 'no review-r0.json has crossed, so no round opens')
  assert.ok(section(earlyLines, 'review').some(t => t.includes('tree-check clean · exit 0')))

  const s = live()
  cross(s, routing, 0)
  cross(s, R.BASH_SETTLE_REVIEW, 300)
  cross(s, comment, 311)
  assert.equal(headingAt(settlePaneLines(s, 144), 'round 1'), -1, 'the comment does not open a round')
  cross(s, treeClean, 320)
  const lines = settlePaneLines(s, 144)
  assert.ok(headingAt(lines, 'round 1') > headingAt(lines, 'review'))
  assert.ok(section(lines, 'round 1').some(t => t.includes('tree-check clean · exit 0')), 'the tree-check is the first row of the round it opened')
  assert.ok(!section(lines, 'review').some(t => t.includes('tree-check')), 'the review group does not keep it')
  assert.match(settleStatusText(s, OPEN), /^interlock settle .*: round 1 · /)
})

test('a brief opens its round when no tree-check did, and a second line for the same round opens nothing', () => {
  const s = live()
  cross(s, R.BASH_SETTLE_BRIEF, 10)
  const lines = settlePaneLines(s, 144)
  assert.ok(headingAt(lines, 'round 1') >= 0, 'remediate-brief --round 1 opens round 1')
  assert.ok(section(lines, 'round 1').some(t => t.includes('1 finding')))
  cross(s, routingFixer, 11)
  cross(s, R.BASH_SETTLE_FIXER_RESULT, 40)
  assert.equal(headingAt(settlePaneLines(s, 144), 'round 2'), -1)
})

test('sections only move forward: a line that opens an earlier section appends to the one open', () => {
  const s = live()
  cross(s, routing, 0)
  cross(s, R.BASH_SETTLE_MERGE_CONFIDENCE, 10)
  cross(s, R.BASH_SETTLE_BRIEF, 20)
  cross(s, verifyExec, 30)
  cross(s, okBash('gh pr ready 25'), 40)
  cross(s, conformanceBrief, 50)
  cross(s, checksWatch, 60)
  const lines = settlePaneLines(s, 144)
  for (const label of ['round 1', 'ready', 'conformance', 'verify', 'checks']) {
    assert.equal(headingAt(lines, label), -1, `${label} reopened behind merge confidence`)
  }
  const mc = section(lines, 'merge confidence').join('\n')
  for (const part of ['HUMAN 58', '1 finding', 'exec unit exit 0']) assert.ok(mc.includes(part), `${part} was not appended to the open section:\n${mc}`)
  cross(s, drift, 70)
  assert.ok(headingAt(settlePaneLines(s, 144), 'drift') >= 0, 'a later section still opens')
})

test('sections run in the pass\'s order when each is opened by its own line, ready included', () => {
  const s = inRound1()
  cross(s, okBash('gh pr ready 25'), 1100)
  cross(s, conformanceBrief, 1110)
  cross(s, verifyExec, 1200)
  cross(s, checksWatch, 1300, { run_in_background: true })
  cross(s, R.BASH_SETTLE_PIPELINE, 1400)
  cross(s, addLabels, 1500)
  cross(s, drift, 1600)
  const lines = settlePaneLines(s, 144)
  const order = ['review', 'round 1', 'ready', 'conformance', 'verify', 'checks', 'merge confidence', 'publish', 'drift']
  const found = order.map(g => headingAt(lines, g))
  assert.ok(found.every(i => i >= 0), `missing: ${order.filter((g, i) => found[i] < 0).join(', ')}`)
  assert.deepEqual([...found].sort((a, b) => a - b), found)
  assert.ok(section(lines, 'ready').join('\n').includes('exit 0'))
})

test('the glab spellings open the same sections as the gh ones', () => {
  const s = inRound1()
  run(s, 'glab mr update 7 --ready', '', 1100)
  run(s, 'glab ci get --merge-request 7 --output json', '{"status":"success"}', 1300)
  run(s, 'glab mr update 7 --label "interlock/human-review,interlock/score-58"', '', 1500)
  run(s, 'glab mr update 7 --unlabel "interlock/merge,interlock/blocked"', '', 1510)
  const lines = settlePaneLines(s, 144)
  assert.ok(headingAt(lines, 'ready') >= 0 && headingAt(lines, 'checks') >= 0 && headingAt(lines, 'publish') >= 0)
  const publish = section(lines, 'publish').join('\n')
  assert.ok(publish.includes('interlock/human-review, interlock/score-58'), publish)
  assert.ok(publish.includes('removed interlock/merge, interlock/blocked'), publish)
  assert.ok(section(lines, 'checks').join('\n').includes('exit 0'))
  assert.ok(!section(lines, 'checks').join('\n').includes('background'))
})

test('a re-review\'s lines land in the round open: its record, its routing and surface rows, never review', () => {
  const s = inRound1()
  const review0 = section(settlePaneLines(s, 144), 'review').length
  cross(s, routing, 1000)
  run(s, 'interlock surface --changed CHANGELOG.md --json', '{}', 1001)
  run(s, `interlock domain-context ${CHANGE} --changed CHANGELOG.md --base origin/main --json`, '{}', 1002)
  cross(s, reviewR1, 1033)
  const lines = settlePaneLines(s, 144)
  const round1 = section(lines, 'round 1').join('\n')
  assert.ok(round1.includes('1 raised · 0 dismissed · 5 surviving · head 161f955'), round1)
  const review = section(lines, 'review')
  assert.equal(review.length, review0, 'the review group did not grow')
  assert.ok(!review.join('\n').includes('161f955'))
  assert.match(settleStatusText(s, OPEN), /: round 1 · /)
})

test('counts.carried is drawn on the review record, and counts the CLI did not print are not invented', () => {
  const s = live()
  const doc = JSON.parse(R.BASH_SETTLE_REVIEW.result.stdout)
  doc.counts = { ...doc.counts, carried: 4 }
  run(s, R.BASH_SETTLE_REVIEW.command, json(doc), 300)
  assert.match(groupRows(s, 'review').join('\n'), /\b4 carried\b/)
  const plain = live()
  cross(plain, R.BASH_SETTLE_REVIEW, 300)
  assert.doesNotMatch(groupRows(plain, 'review').join('\n'), /carried/)
})

test('replies belong to the round open, whatever file their --after names', () => {
  const s = inRound1()
  cross(s, reviewR1, 1033)
  cross(s, repliesR1, 1040)
  // Piped into `gh pr comment`, the call's exit is gh's, not the replies line's (M6).
  assert.ok(groupRows(s, 'round 1').some(t => t.includes('replies') && t.includes('exit not its own')))
  cross(s, { ...treeClean, command: TREE_CHECK_R2 }, 1044)
  // Round 2's nothing-to-keep reply is written --before review-r1 --after review-r1 (skill section 5c).
  const keep = okBash(
    `interlock settle replies --before .claude/ship/settle/review-r1.json --after .claude/ship/settle/review-r1.json --head ${H161} | gh pr comment 25 --body-file -`,
    'https://github.com/example/repo/pull/25#issuecomment-3'
  )
  cross(s, keep, 1050)
  const lines = settlePaneLines(s, 144)
  assert.equal(groupRows(s, 'round 1').filter(t => t.includes('replies')).length, 1, 'round 1 keeps its own reply only')
  assert.ok(section(lines, 'round 2').some(t => t.includes('replies') && t.includes('exit not its own')), 'round 2 draws the reply its tree-check opened')
})

test('a late --markdown row lands in publish, after the labels, and publish keeps any later merge-confidence row', () => {
  const s = live()
  cross(s, R.BASH_SETTLE_MERGE_CONFIDENCE, 1590)
  cross(s, addLabels, 1595)
  cross(s, mcMarkdown, 1600)
  const lines = settlePaneLines(s, 144)
  assert.ok(section(lines, 'publish').join('\n').includes('merge-confidence --markdown · exit 0'))
  assert.ok(!section(lines, 'merge confidence').join('\n').includes('--markdown'))
  assert.ok(section(lines, 'merge confidence').join('\n').includes('HUMAN 58'))
  assert.equal(s.phase, 'live')
})

test('a label removal alone opens publish, and says removed', () => {
  const s = live()
  cross(s, R.BASH_SETTLE_MERGE_CONFIDENCE, 10)
  run(s, 'gh pr edit 25 --remove-label "interlock/merge,interlock/blocked"', '', 20)
  const publish = groupRows(s, 'publish').join('\n')
  assert.ok(publish.includes('removed interlock/merge, interlock/blocked'), publish)
  assert.ok(!publish.includes('labels interlock/merge'), 'a removal is not drawn as an addition')
})

// --- applySettleLines: rows per crossing (D26, D7) -----------------------------

test('a line that crosses again appends a row: it never replaces the earlier one', () => {
  const s = live()
  cross(s, verifyExec, 10)
  cross(s, verifyExec, 20)
  run(s, 'interlock verify exec --kind e2e --command "npm run e2e"', 'ok', 30)
  const verify = groupRows(s, 'verify')
  assert.equal(verify.filter(t => t.includes('exec unit exit 0')).length, 2)
  assert.equal(verify.filter(t => t.includes('exec e2e exit 0')).length, 1)
  assert.ok(verify.findIndex(t => t.includes('exec e2e')) > verify.findIndex(t => t.includes('exec unit')))

  const routed = live()
  cross(routed, routing, 0)
  cross(routed, routingFixer, 1)
  cross(routed, routingConformance, 2)
  assert.ok(groupRows(routed, 'review').filter(t => /routing/.test(t)).length >= 3, 'one routing row per role line')
})

test('the --json then --markdown pair of merge-confidence draws two rows, the verdict first', () => {
  const s = live()
  cross(s, R.BASH_SETTLE_MERGE_CONFIDENCE, 100)
  cross(s, mcMarkdown, 101)
  const mc = groupRows(s, 'merge confidence')
  const verdict = mc.findIndex(t => t.includes('HUMAN 58 · head 161f955'))
  const markdown = mc.findIndex(t => t.includes('merge-confidence --markdown · exit 0'))
  assert.ok(verdict >= 0 && markdown > verdict, mc.join('\n'))
  assert.equal(mc.filter(t => t.includes('HUMAN 58')).length, 1, 'the markdown row carries no verdict of its own')
})

test('--label-names is a row of its own in publish, drawn from the label fields and never unparsed', () => {
  const s = live()
  // The pipeline line names no change (spec requirement 1), so a line that does crosses first.
  cross(s, okBash(`interlock domain-context ${CHANGE} --changed CHANGELOG.md --base origin/main --json`, '{}'), 50)
  cross(s, R.BASH_SETTLE_PIPELINE, 100)
  const names = okBash(
    'interlock merge-confidence --label-names --json',
    json({ labels: { verdictNames: ['interlock/merge', 'interlock/human-review', 'interlock/blocked'], scorePrefix: 'interlock/score-' } })
  )
  cross(s, names, 110)
  const publish = groupRows(s, 'publish').join('\n')
  for (const part of ['interlock/merge', 'interlock/human-review', 'interlock/blocked', 'interlock/score-']) assert.ok(publish.includes(part), `${part} in:\n${publish}`)
  assert.ok(!publish.includes('(unparsed)'))
  assert.ok(!publish.includes('HUMAN'), 'it carries no verdict field')
  assert.equal(settleStatusText(s, OPEN), `interlock settle ${CHANGE} #25: merge confidence · pipeline 161f955`, 'publish does not retarget the line')
})

test('a tree-check reads back as the CLI printed it: clean, tolerated paths, and the dirty paths with the exit code', () => {
  const clean = inRound1()
  assert.ok(groupRows(clean, 'round 1').some(t => t.includes('tree-check clean · exit 0')))

  const tolerated = live()
  cross(tolerated, R.BASH_SETTLE_REVIEW, 300)
  run(tolerated, TREE_CHECK, 'clean (tolerated: .claude/ship/x.json, notes.md)', 320)
  assert.ok(groupRows(tolerated, 'round 1').some(t => t.includes('tree-check clean (tolerated: .claude/ship/x.json, notes.md) · exit 0')))

  const dirty = live()
  cross(dirty, R.BASH_SETTLE_REVIEW, 300)
  cross(dirty, errBash(TREE_CHECK, 1, 'dirty (1):\n  notes.txt'), 320)
  assert.ok(groupRows(dirty, 'round 1').some(t => t.includes('tree-check dirty (1): notes.txt · exit 1')), groupRows(dirty, 'round 1').join('\n'))

  const several = live()
  cross(several, R.BASH_SETTLE_REVIEW, 300)
  cross(several, errBash(TREE_CHECK, 1, 'dirty (2):\n  a.txt\n  b/c.txt'), 320)
  const row = groupRows(several, 'round 1').find(t => t.includes('tree-check dirty (2):'))
  assert.ok(row && row.includes('a.txt') && row.includes('b/c.txt') && row.includes('exit 1'), row)
  // A second tree-check in the same round is a second row, not a replacement.
  cross(several, treeClean, 340)
  const rows = groupRows(several, 'round 1').filter(t => t.includes('tree-check'))
  assert.equal(rows.length, 2)
  assert.ok(rows[0].includes('dirty') && rows[1].includes('clean'))
})

test('the STOP line is a row at the CLI\'s STOP word, verbatim, and carries nothing before it', () => {
  const s = inRound1()
  cross(s, R.BASH_SETTLE_STOP, 1046)
  const stop = R.BASH_SETTLE_STOP.text.split('\n').find(l => l.includes('STOP: ')).replace(/^interlock: /, '')
  const rows = groupRows(s, 'round 1')
  assert.ok(rows.some(t => t.includes(stop)), rows.join('\n'))
  assert.ok(!rows.some(t => t.includes('interlock: STOP')))
  assert.ok(!rows.some(t => /Exit code/.test(t)), 'the engine\'s exit line is not drawn')
})

test('a brief that stops on its first round is drawn from the same line', () => {
  const s = live()
  cross(s, errBash(R.BASH_SETTLE_BRIEF.command, 1, 'interlock: STOP: nothing to remediate: no surviving blocker'), 10)
  assert.ok(groupRows(s, 'round 1').some(t => t.includes('STOP: nothing to remediate: no surviving blocker')))
})

test('a remediate-brief row counts its findings and deferred findings and names the re-review dimensions', () => {
  const s = live()
  const doc = JSON.parse(R.BASH_SETTLE_BRIEF.result.stdout)
  doc.findings = ['F-1', 'F-2', 'F-3']
  doc.deferred = ['F-4', 'F-5']
  doc.reReviewDimensions = ['blast-radius', 'domain']
  run(s, R.BASH_SETTLE_BRIEF.command, json(doc), 10)
  const row = groupRows(s, 'round 1').find(t => /\b3 findings\b/.test(t))
  assert.ok(row, groupRows(s, 'round 1').join('\n'))
  assert.match(row, /\b2 deferred\b/)
  assert.ok(row.includes('blast-radius') && row.includes('domain'), row)
})

test('test-paths draws its counts and protected paths, or the CLI\'s reason when no profile was usable', () => {
  const cmd = 'git diff --cached --name-only -z | interlock settle test-paths --changed - --profile .claude/ship/settle/profile-r1.json --json'
  const s = inRound1()
  run(
    s,
    cmd,
    json({ protected: ['test/a.test.mjs', 'test/b.test.mjs'], unprotected: ['lib/a.mjs'], profile: '.claude/ship/settle/profile-r1.json', reason: null }),
    1000
  )
  const row = groupRows(s, 'round 1').find(t => t.includes('test/a.test.mjs'))
  assert.ok(row, groupRows(s, 'round 1').join('\n'))
  assert.match(row, /\b2 protected\b/)
  assert.match(row, /\b1 unprotected\b/)
  assert.ok(row.includes('test/b.test.mjs'))

  const none = inRound1()
  const reason = 'no testing profile at .claude/ship/settle/profile-r1.json: every path is treated as unprotected'
  run(none, cmd, json({ protected: [], unprotected: ['lib/a.mjs'], profile: null, reason }), 1000)
  assert.ok(groupRows(none, 'round 1').some(t => t.includes(reason)), 'the reason is the CLI\'s, verbatim')

  const only = inRound1()
  run(only, 'git diff --cached --name-only -z | interlock settle test-paths --changed - --profile p.json --protected-only --nul | git --literal-pathspecs restore --staged --worktree --source=HEAD --pathspec-from-file=- --pathspec-file-nul', '', 1000)
  // Piped into `git restore`, the call's exit is the restore's (M6).
  assert.ok(groupRows(only, 'round 1').some(t => t.includes('test-paths') && t.includes('exit not its own')))
})

test('a commit and a push are rows inside a round, the message\'s first line only, and pass through unread outside one', () => {
  const s = inRound1()
  cross(s, okBash('git commit -m "fix(review): subject line\n\nbody paragraph that stays out" -m "Refs: #25"', '[x abc1234] fix'), 1000)
  cross(s, okBash('git push', ''), 1001)
  const rows = groupRows(s, 'round 1').join('\n')
  assert.ok(rows.includes('fix(review): subject line'), rows)
  assert.ok(!rows.includes('body paragraph'), rows)
  assert.ok(rows.includes('push exit 0'), rows)
  cross(s, errBash('git push', 1, 'rejected'), 1002)
  assert.ok(groupRows(s, 'round 1').join('\n').includes('push exit 1'))

  const outside = live()
  cross(outside, routing, 0)
  cross(outside, commitPush, 10)
  const text = textsOf(settlePaneLines(outside, 144)).join('\n')
  assert.ok(!text.includes('push exit') && !text.includes('answer the PR #25 review round 1'), `a create-path commit was drawn:\n${text}`)
  assert.equal(headingAt(settlePaneLines(outside, 144), 'round 1'), -1)
})

test('a result the skill redirected is the command word, its exit code and result not seen (redirected)', () => {
  const s = live()
  cross(s, verifyPlan, 10)
  cross(s, verifyJudge, 20)
  const verify = groupRows(s, 'verify')
  assert.ok(verify.some(t => t.includes('plan exit 0') && t.includes('result not seen (redirected)')), verify.join('\n'))
  assert.ok(verify.some(t => t.includes('judge exit 0') && t.includes('result not seen (redirected)')), verify.join('\n'))

  // A judge that halts exits 1 with a verdict on disk: the exit code is the contract, not a guess.
  const halted = live()
  cross(halted, errBash(verifyJudge.command, 1, ''), 20)
  assert.ok(groupRows(halted, 'verify').some(t => t.includes('judge exit 1')))

  const mc = live()
  run(mc, `interlock merge-confidence ${CHANGE} --base origin/main --review r.json --json > .claude/ship/merge-confidence.out`, '', 30)
  const rows = groupRows(mc, 'merge confidence').join('\n')
  assert.ok(rows.includes('result not seen (redirected)') && rows.includes('exit 0'), rows)
  assert.ok(!rows.includes('(unparsed)'))
})

test('a result that does not parse, or lacks the fields the line names, is that line with (unparsed) and its first line of text', () => {
  const s = live()
  run(s, R.BASH_SETTLE_MERGE_CONFIDENCE.command, 'not json at all\nsecond line of text', 10)
  const mc = groupRows(s, 'merge confidence').join('\n')
  assert.ok(mc.includes('merge-confidence (unparsed)') && mc.includes('not json at all'), mc)
  assert.ok(!mc.includes('second line of text'), 'only the first line')
  assert.ok(!/\b(halted|passed|failed)\b/.test(mc), 'no word the CLI did not print')

  const empty = live()
  run(empty, R.BASH_SETTLE_REVIEW.command, json({ nothing: 'here' }), 10)
  assert.match(groupRows(empty, 'review').join('\n'), /review \(unparsed\)/)

  const noText = live()
  run(noText, R.BASH_SETTLE_REVIEW.command, 'this is not json', 10)
  assert.match(groupRows(noText, 'review').join('\n'), /\(unparsed\).*this is not json|this is not json.*\(unparsed\)/s)
  assert.doesNotMatch(settleStatusText(noText, OPEN), /\b(halted|passed|failed)\b/)
})

// --- applySettleLines: naming (spec requirement 1) --------------------------------

test('the change comes from the CLI\'s argv or a result field and never from a path, a tool input or an unkeyed line', () => {
  const s = live()
  assert.match(header(s), /change: unknown until named/)
  run(s, 'interlock surface --changed openspec/changes/not-this-one/tasks.md --json', '{}', 1)
  run(s, 'cat openspec/changes/another-one/proposal.md', '# x', 2)
  run(s, 'interlock settle comment --review openspec/changes/yet-another/review-r0.json --head abc1234 --round 0', '', 3)
  assert.match(header(s), /change: unknown until named/, header(s))

  for (const command of [
    'interlock settle tree-check --change named-by-argv --status -',
    'interlock settle conformance-brief named-by-argv --changed a.md --base origin/main --head abc1234',
    'interlock merge-confidence named-by-argv --base origin/main --json',
    'interlock domain-context named-by-argv --changed a.md --base origin/main --json',
    'interlock review --findings f.json --verdicts v.json --metrics named-by-argv --json',
    'interlock settle remediate-brief --review r.json --round 1 --change named-by-argv --head abc1234 --json'
  ]) {
    const named = live()
    run(named, command, '{}', 1)
    assert.ok(header(named).includes('named-by-argv'), `${command}\n${header(named)}`)
  }

  const fromResult = live()
  run(fromResult, 'interlock settle remediate-brief --review r.json --round 1 --head abc1234 --pr 25 --json', json({ change: 'named-by-result', round: 1, findings: [], deferred: [], reReviewDimensions: [] }), 1)
  assert.ok(header(fromResult).includes('named-by-result'), header(fromResult))
})

test('the pull request comes from --pr, a pr field or the number on a gh pr stage, the head from --head or a head field', () => {
  const byPr = live()
  run(byPr, 'interlock settle remediate-brief --review r.json --round 1 --change c --head abcdef1234 --pr 31 --json', '{}', 1)
  assert.ok(header(byPr).includes('PR #31') && header(byPr).includes('head abcdef1'), header(byPr))

  const byStage = live()
  run(byStage, 'gh pr ready 44', '', 1)
  assert.ok(header(byStage).includes('PR #44'), header(byStage))

  const bySecondStage = live()
  cross(bySecondStage, comment, 1)
  assert.ok(header(bySecondStage).includes('PR #25') && header(bySecondStage).includes('head a96cb82'), header(bySecondStage))
  assert.match(settleStatusText(bySecondStage, OPEN), /#25: /)

  const byResult = live()
  cross(byResult, R.BASH_SETTLE_MERGE_CONFIDENCE, 1)
  assert.ok(header(byResult).includes('head 161f955'), header(byResult))
  const byField = live()
  run(byField, 'interlock settle remediate-brief --review r.json --round 1 --change c --json', json({ pr: '52', head: 'fedcba9876', findings: [], deferred: [], reReviewDimensions: [] }), 1)
  assert.ok(header(byField).includes('PR #52') && header(byField).includes('head fedcba9'), header(byField))

  const unnamed = live()
  run(unnamed, 'interlock settle tree-check --change c --status -', 'clean', 1)
  assert.doesNotMatch(header(unnamed), /PR #\d/)
})

// --- applySettleLines: the end (D6) -----------------------------------------------

test('the run ends at the drift line alone: the labels line leaves it live, and a later keyed line changes nothing', () => {
  const s = live()
  cross(s, R.BASH_SETTLE_MERGE_CONFIDENCE, 1590)
  cross(s, mcMarkdown, 1591)
  assert.equal(s.phase, 'live')
  cross(s, addLabels, 1595)
  assert.equal(s.phase, 'live', 'the labels line is a publish row, not an end')
  cross(s, okBash('gh pr edit 25 --remove-label "interlock/merge"'), 1596)
  assert.equal(s.phase, 'live')
  cross(s, drift, 1599)
  assert.equal(s.phase, 'done')
  assert.ok(groupRows(s, 'drift').join('\n').includes('unarchived 1 · broken 0'))

  const before = JSON.stringify([textsOf(settlePaneLines(s, 144)), settleStatusText(s, OPEN)])
  cross(s, R.BASH_SETTLE_FIXER_RESULT, 1700)
  cross(s, R.BASH_SETTLE_BRIEF, 1701)
  cross(s, treeClean, 1702)
  cross(s, drift, 1703)
  assert.equal(s.phase, 'done')
  assert.equal(JSON.stringify([textsOf(settlePaneLines(s, 144)), settleStatusText(s, OPEN)]), before, 'a keyed line after done changed the record')
})

test('no other line ends the run, whatever it names', () => {
  const s = live()
  for (const [i, fixture] of [R.BASH_SETTLE_REVIEW, R.BASH_SETTLE_BRIEF, R.BASH_SETTLE_FIXER_RESULT, R.BASH_SETTLE_STOP, R.BASH_SETTLE_PIPELINE, R.BASH_SETTLE_MERGE_CONFIDENCE, mcMarkdown, addLabels, verifyJudge, checksWatch, conformanceBrief].entries()) {
    cross(s, fixture, i * 10)
    assert.equal(s.phase, 'live', fixture.command)
  }
})

// --- applySettleLines: what it does not read (D19) --------------------------------

test('every other Bash line is passed through at the first line: it changes neither the pane nor the status line', () => {
  const s = inRound1()
  const before = JSON.stringify([textsOf(settlePaneLines(s, 144)), settleStatusText(s, OPEN)])
  for (const command of [
    'git status --porcelain=v1',
    'git diff --cached --name-only -z',
    'gh pr view 25 --json headRefOid',
    'gh pr checks 25 --required',
    'gh pr create --title t --body-file -',
    'gh pr edit 25 --body "x"',
    'npm test',
    'ls -la',
    'interlock settle brand-new-verb --change someone-else',
    ''
  ]) {
    cross(s, okBash(command, 'ok'), 1100)
  }
  applySettleLines(s, {}, {}, at(1101))
  applySettleLines(s, { command: 7 }, { text: 'x' }, at(1102))
  assert.equal(JSON.stringify([textsOf(settlePaneLines(s, 144)), settleStatusText(s, OPEN)]), before)
  assert.match(header(s), new RegExp(CHANGE))
})

// --- the role matcher (D1) ---------------------------------------------------

test('roleOf reads the five sources, each as its own role', () => {
  const dimension = roleOf('# Dimension: language & framework\n\nYou are a senior developer.')
  assert.equal(dimension.role, 'dimension')
  assert.equal(dimension.label, 'language & framework')

  const refute = roleOf(SKEPTIC_REFUTE)
  assert.equal(refute.role, 'skeptic')
  assert.equal(refute.label, 'refute')

  const second = roleOf(SKEPTIC_SECOND)
  assert.equal(second.role, 'skeptic')
  assert.equal(second.label, 'second opinion')

  const fixer = roleOf(FIXER_PROMPT)
  assert.equal(fixer.role, 'fixer')
  assert.equal(fixer.round, 1)

  const worker = roleOf(WORKER_PROMPT)
  assert.equal(worker.role, 'conformance')
})

test('roleOf keeps the words of a dimension heading as the brief wrote them', () => {
  for (const [heading, words] of [
    ['# Dimension: QA', 'QA'],
    ['# Dimension: technical lead', 'technical lead'],
    ['# Dimension: blast-radius', 'blast-radius'],
    ['  # Dimension: domain', 'domain']
  ]) {
    const r = roleOf(`${heading}\n\nbody`)
    assert.equal(r.role, 'dimension', heading)
    assert.equal(r.label, words, heading)
  }
})

test('roleOf attributes nothing it cannot read from a line start, and says so with null', () => {
  for (const prompt of [
    'Please summarise the diff',
    '',
    '   \n\n',
    'I told it: You are a skeptical code reviewer.',
    'see the heading # Dimension: QA in the brief',
    'intro line\nFix round 1 for change "c", pull request #1, at head abc1234.',
    'intro line\nConfirm change "c" against its diff at head abc1234.',
    7,
    null,
    undefined,
    {}
  ]) {
    assert.equal(roleOf(prompt), null, JSON.stringify(prompt))
  }
})

test('roleOf reads the CLI-printed sources on the first non-blank line, past blank lines', () => {
  const r = roleOf(`\n\nFix round 2 for change "${CHANGE}", pull request #25, at head ${H161}.\n\nbody`)
  assert.equal(r.role, 'fixer')
  assert.equal(r.round, 2)
  assert.equal(roleOf(`\nConfirm change "${CHANGE}" against its diff at head ${H161}.`).role, 'conformance')
  // Without a pull request the briefing says "the pull request under review".
  assert.equal(roleOf(`Fix round 1 for change "${CHANGE}", the pull request under review, at head ${H161}.`).role, 'fixer')
})

test('a repository policy block before a dimension brief does not hide the dimension', () => {
  const composed = [
    '--- REPOSITORY REVIEW POLICY (advice, not overriding the rubric or the evidence gate) ---',
    'Important means a user-visible regression here. Payments code is owned by the platform team.',
    '--- END OF REPOSITORY REVIEW POLICY ---',
    '',
    '# Dimension: technical lead',
    '',
    'You are a technical lead.'
  ].join('\n')
  const r = roleOf(composed)
  assert.equal(r.role, 'dimension')
  assert.equal(r.label, 'technical lead')
})

test('a fixer brief that quotes a skeptic or a dimension line on a later line is still the fixer', () => {
  const quoted = `${FIXER_PROMPT}\n${SKEPTIC_REFUTE}\n# Dimension: language & framework\n`
  const r = roleOf(quoted)
  assert.equal(r.role, 'fixer')
  assert.equal(r.round, 1)
  const worker = roleOf(`${WORKER_PROMPT}\n${SKEPTIC_SECOND}\n# Dimension: QA`)
  assert.equal(worker.role, 'conformance')
})

// --- the agent record (D3, D2, D23, D22, D9) ---------------------------------

test('a dimension reviewer carries the three model figures, each from its own event', () => {
  const s = live()
  cross(s, routing, 0)
  agent(s, {
    id: 'dim-1',
    prompt: brief('language'),
    model: 'sonnet',
    resolved: 'claude-sonnet-5-5',
    spawnAt: 70,
    steps: [75, 80],
    served: ['claude-sonnet-5-5', 'claude-sonnet-5-5-20261001']
  })
  const rec = s.agents.get('dim-1')
  assert.equal(rec.role, 'dimension')
  assert.equal(rec.group, 'review')
  assert.equal(rec.requests, 2)
  assert.deepEqual(rec.served, ['claude-sonnet-5-5', 'claude-sonnet-5-5-20261001'], 'served is each model the steps reported, distinct')
  const row = textsOf(settlePaneLines(s, 144)).find(t => t.startsWith('language & framework'))
  assert.ok(row, 'the reviewer is drawn under the words of its heading')
  assert.ok(row.includes('sonnet → claude-sonnet-5-5'), row)
  assert.ok(row.includes('step medium'), row)
  assert.match(row, /\b2 req\b/)
  assert.ok(row.includes('27942'), `${row} should carry the summed input tokens`)
  assert.ok(row.endsWith(' · live'), row)
})

test('a spawn that names no model is drawn as inherit, with the model the engine resolved', () => {
  const s = live()
  cross(s, R.BASH_SETTLE_BRIEF, 330)
  agent(s, { id: 'fix-1', prompt: FIXER_PROMPT, model: undefined, resolved: 'claude-opus-5-5', spawnAt: 332, steps: [340], efforts: ['xhigh'], served: 'claude-opus-5-5' })
  const row = textsOf(settlePaneLines(s, 144)).find(t => t.startsWith('fixer'))
  assert.ok(row, 'the fixer row')
  assert.ok(row.includes('inherit → claude-opus-5-5'), row)
  assert.ok(row.includes('step xhigh'), row)
})

test('each role draws its own routed figure, and none borrows another role\'s', () => {
  const s = live()
  cross(s, routing, 0)
  cross(s, routingFixer, 1)
  cross(s, routingConformance, 2)
  agent(s, { id: 'dim', prompt: `--- REPOSITORY REVIEW POLICY (advice, not overriding the rubric or the evidence gate) ---\nx\n---\n\n${brief('technical-lead')}`, model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 10, steps: [20] })
  agent(s, { id: 'skep', prompt: SKEPTIC_REFUTE, model: undefined, resolved: 'claude-opus-5-5', spawnAt: 30, steps: [40], efforts: ['xhigh'], served: 'claude-opus-5-5' })
  cross(s, conformanceBrief, 100)
  agent(s, { id: 'work', prompt: WORKER_PROMPT, model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 101, steps: [110], efforts: ['medium'] })
  const lines = settlePaneLines(s, 144)
  const review = section(lines, 'review')
  const routed = review.filter(t => t.includes('routed'))
  assert.ok(routed.some(t => t.includes('routed sonnet · medium')), `the dimensions row:\n${routed.join('\n')}`)
  assert.ok(routed.some(t => t.includes('routed — · xhigh')), `the skeptics row:\n${routed.join('\n')}`)
  for (const t of routed) {
    assert.ok(!(t.includes('routed sonnet · medium') && t.includes('xhigh')), `a row mixes two roles' figures: ${t}`)
    assert.ok(!(t.includes('routed — · xhigh') && t.includes('sonnet · medium')), `a row mixes two roles' figures: ${t}`)
  }
  const worker = section(lines, 'conformance').find(t => /routed/.test(t))
  assert.ok(worker && worker.includes('routed sonnet · —'), `the conformance worker's row: ${worker}`)
  assert.ok(!worker.includes('xhigh'), worker)
})

test('before any routing line has crossed every role reads routed: not seen', () => {
  const s = live()
  agent(s, { id: 'a', prompt: 'Please summarise the diff', model: undefined, resolved: 'claude-opus-5-5', subagentType: 'general-purpose', spawnAt: 5, steps: [9] })
  agent(s, { id: 'b', prompt: SKEPTIC_REFUTE, model: undefined, resolved: 'claude-opus-5-5', spawnAt: 12, steps: [15] })
  const texts = textsOf(settlePaneLines(s, 144))
  assert.ok(texts.some(t => t.includes('routed: not seen')), texts.join('\n'))
  assert.ok(!texts.some(t => /routed (sonnet|—)/.test(t)), 'a figure is never invented before a routing line')
})

test('an unattributed spawn is drawn as its type and unattributed, never by its description', () => {
  const s = live()
  agent(s, { id: 'u', prompt: 'Please summarise the diff', model: undefined, resolved: 'claude-opus-5-5', subagentType: 'general-purpose', spawnAt: 5, steps: [9], efforts: ['high'], served: 'claude-opus-5-5' })
  const rec = s.agents.get('u')
  assert.equal(rec.role, null)
  const texts = textsOf(settlePaneLines(s, 144))
  const row = texts.find(t => t.startsWith('general-purpose'))
  assert.ok(row && row.includes('unattributed'), texts.join('\n'))
  assert.ok(row.includes('claude-opus-5-5') && row.includes('step high'), row)
  assert.ok(!texts.join('\n').includes(R.SPAWN_ROUTED.input.description), 'the Agent call\'s description is never drawn')
})

test('the step level is the latest, and the first is kept when it changed (D23)', () => {
  const s = live()
  cross(s, conformanceBrief, 10)
  agent(s, { id: 'w', prompt: WORKER_PROMPT, model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 11, steps: [20, 30, 40], efforts: ['medium', 'medium', 'high'] })
  const rec = s.agents.get('w')
  assert.equal(rec.firstStepEffort, 'medium')
  assert.equal(rec.stepEffort, 'high')
  const row = textsOf(settlePaneLines(s, 144)).find(t => t.includes('step '))
  assert.ok(row.includes('step medium → high'), row)

  const steady = live()
  cross(steady, conformanceBrief, 10)
  agent(steady, { id: 'w', prompt: WORKER_PROMPT, model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 11, steps: [20, 30], efforts: ['medium'] })
  const steadyRow = textsOf(settlePaneLines(steady, 144)).find(t => t.includes('step '))
  assert.ok(steadyRow.includes('step medium') && !steadyRow.includes('→ medium') && !steadyRow.includes('medium →'), steadyRow)
})

test('an agent\'s turn end is its duration and the host\'s own reason word, and a live one says live', () => {
  const s = live()
  cross(s, R.BASH_SETTLE_BRIEF, 330)
  agent(s, {
    id: 'fix',
    prompt: FIXER_PROMPT,
    model: undefined,
    resolved: 'claude-opus-5-5',
    spawnAt: 332,
    steps: spread(340, 970, 31),
    efforts: ['xhigh'],
    served: 'claude-opus-5-5',
    end: { at: 977, reason: 'answer', durationMs: 645000 }
  })
  const rec = s.agents.get('fix')
  assert.equal(rec.reason, 'answer')
  assert.equal(rec.durationMs, 645000)
  assert.equal(rec.requests, 31)
  const row = textsOf(settlePaneLines(s, 144)).find(t => t.startsWith('fixer'))
  assert.ok(row.endsWith('10m 45s · answer'), row)

  const aborted = live()
  cross(aborted, conformanceBrief, 10)
  agent(aborted, { id: 'w', prompt: WORKER_PROMPT, model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 11, steps: [20], end: { at: 30, reason: 'aborted', durationMs: 19000 } })
  assert.equal(aborted.agents.get('w').reason, 'aborted')
  const abortedRow = textsOf(settlePaneLines(aborted, 144)).find(t => t.includes('claude-sonnet-5-5') && t.includes('step '))
  assert.ok(abortedRow.endsWith(' · aborted'), abortedRow)
})

test('an agent joins the section open when it spawns, and the fixer the round its first line names (D22)', () => {
  const s = live()
  cross(s, routing, 0)
  agent(s, { id: 'd0', prompt: brief('language'), model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 5, steps: [8], end: { at: 9, reason: 'answer', durationMs: 4000 } })
  assert.equal(s.agents.get('d0').group, 'review')
  assert.equal(s.agents.get('d0').round, null)

  cross(s, R.BASH_SETTLE_REVIEW, 300)
  cross(s, comment, 311)
  cross(s, treeClean, 320)
  cross(s, R.BASH_SETTLE_BRIEF, 326)
  agent(s, { id: 'fix', prompt: FIXER_PROMPT, model: undefined, resolved: 'claude-opus-5-5', spawnAt: 332, steps: [340], efforts: ['xhigh'], served: 'claude-opus-5-5' })
  assert.equal(s.agents.get('fix').group, 'round 1')
  assert.equal(s.agents.get('fix').round, 1)

  // A re-review's reviewer lands in the round open, so the review group keeps its count.
  agent(s, { id: 'd1', prompt: brief('blast-radius'), model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 1020, steps: [1025], end: { at: 1030, reason: 'answer', durationMs: 10000 } })
  assert.equal(s.agents.get('d1').group, 'round 1')
  const lines = settlePaneLines(s, 144)
  assert.match(section(lines, 'review').find(t => t.includes('review dimensions')), /\b1 spawned\b/)
  assert.ok(section(lines, 'round 1').some(t => t.startsWith('blast-radius')), 're-review dimension drawn in round 1')

  // An unattributed child joins whatever is current.
  agent(s, { id: 'kid', prompt: 'Look at the file', model: undefined, resolved: 'claude-opus-5-5', spawnAt: 1100, steps: [1102] })
  assert.equal(s.agents.get('kid').group, 'round 1')

  cross(s, conformanceBrief, 1052)
  agent(s, { id: 'work', prompt: WORKER_PROMPT, model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 1053, steps: [1100] })
  assert.equal(s.agents.get('work').group, 'conformance')
})

// --- the status line (D25, D5) ------------------------------------------------

const OPEN = { shipLive: false, specPhase: 'idle' }

test('a live run that has named nothing reads change: unknown until named', () => {
  const s = live()
  assert.equal(settleStatusText(s, OPEN), 'interlock settle: change: unknown until named')
  assert.equal(settleStatusText(freshSettle(), OPEN), null, 'no run, no line')
})

test('the status figure is the open section\'s last CLI words', () => {
  const s = live()
  cross(s, routing, 0)
  cross(s, R.BASH_SETTLE_REVIEW, 300)
  assert.match(settleStatusText(s, OPEN), /^interlock settle route-prose-spawns-by-role(?: #25)?: review · 6 raised · 0 dismissed · 6 surviving$/)
  cross(s, comment, 311)
  cross(s, treeClean, 320)
  cross(s, R.BASH_SETTLE_BRIEF, 326)
  cross(s, R.BASH_SETTLE_FIXER_RESULT, 980)
  assert.equal(settleStatusText(s, OPEN), `interlock settle ${CHANGE} #25: round 1 · 1 fixed, 0 not fixed`)
  cross(s, R.BASH_SETTLE_STOP, 1046)
  assert.equal(settleStatusText(s, OPEN), `interlock settle ${CHANGE} #25: round 1 · STOP`, 'the STOP line is drawn in the round that opened it')
})

test('a STOP in a round a tree-check opened reads round 2 · STOP', () => {
  const s = live()
  cross(s, R.BASH_SETTLE_REVIEW, 300)
  cross(s, comment, 311)
  cross(s, treeClean, 320)
  cross(s, R.BASH_SETTLE_BRIEF, 326)
  cross(s, reviewR1, 1033)
  cross(s, repliesR1, 1040)
  cross(s, { ...treeClean, command: TREE_CHECK_R2 }, 1044)
  cross(s, R.BASH_SETTLE_STOP, 1046)
  assert.equal(settleStatusText(s, OPEN), `interlock settle ${CHANGE} #25: round 2 · STOP`)
})

test('while attributed agents run the figure is the longest-running one, with a count when several run', () => {
  const s = live()
  cross(s, routing, 0)
  cross(s, okBash(`interlock domain-context ${CHANGE} --changed CHANGELOG.md --base origin/main --json`, '{}'), 1)
  agent(s, { id: 'lang', prompt: brief('language'), model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 74, steps: spread(80, 204, 14) })
  agent(s, { id: 'tl', prompt: brief('technical-lead'), model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 80, steps: spread(90, 170, 6) })
  agent(s, { id: 'dom', prompt: brief('domain'), model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 85, steps: spread(90, 160, 5) })
  agent(s, { id: 'blast', prompt: brief('blast-radius'), model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 88, steps: spread(95, 150, 5) })
  assert.match(settleStatusText(s, OPEN), /^interlock settle route-prose-spawns-by-role(?: #25)?: review · 4 live · language & framework 2m 10s · 14 req$/)
})

test('a single live agent leaves the count out, and the fixer is named by its role', () => {
  const s = live()
  cross(s, R.BASH_SETTLE_BRIEF, 0)
  agent(s, { id: 'fix', prompt: FIXER_PROMPT, model: undefined, resolved: 'claude-opus-5-5', spawnAt: 10, steps: spread(14, 380, 18), efforts: ['xhigh'], served: 'claude-opus-5-5' })
  assert.equal(settleStatusText(s, OPEN), `interlock settle ${CHANGE} #25: round 1 · fixer 6m 10s · 18 req`)
})

test('an unattributed child never takes the figure, however long it has run', () => {
  const s = live()
  cross(s, R.BASH_SETTLE_BRIEF, 0)
  agent(s, { id: 'kid', prompt: 'Search the tree', model: undefined, resolved: 'claude-opus-5-5', spawnAt: 1, steps: spread(2, 500, 40), served: 'claude-opus-5-5' })
  agent(s, { id: 'fix', prompt: FIXER_PROMPT, model: undefined, resolved: 'claude-opus-5-5', spawnAt: 10, steps: spread(14, 380, 18), efforts: ['xhigh'], served: 'claude-opus-5-5' })
  assert.equal(settleStatusText(s, OPEN), `interlock settle ${CHANGE} #25: round 1 · fixer 6m 10s · 18 req`)
  const alone = live()
  cross(alone, R.BASH_SETTLE_BRIEF, 0)
  agent(alone, { id: 'kid', prompt: 'Search the tree', model: undefined, resolved: 'claude-opus-5-5', spawnAt: 1, steps: spread(2, 500, 40), served: 'claude-opus-5-5' })
  assert.doesNotMatch(settleStatusText(alone, OPEN), /live|req/, 'with only an unattributed agent running the line keeps the CLI words')
})

test('publish and drift never retarget the line: a finished pass keeps its verdict', () => {
  const s = live()
  // The pipeline line names no change (spec requirement 1), so a line that does crosses first.
  cross(s, okBash(`interlock domain-context ${CHANGE} --changed CHANGELOG.md --base origin/main --json`, '{}'), 1500)
  cross(s, R.BASH_SETTLE_PIPELINE, 1560)
  assert.equal(settleStatusText(s, OPEN), `interlock settle ${CHANGE}: merge confidence · pipeline 161f955`.replace(`${CHANGE}:`, `${CHANGE} #25:`))
  cross(s, R.BASH_SETTLE_MERGE_CONFIDENCE, 1590)
  const verdict = `interlock settle ${CHANGE} #25: merge confidence · HUMAN 58`
  assert.equal(settleStatusText(s, OPEN), verdict)
  cross(s, mcMarkdown, 1591)
  assert.equal(settleStatusText(s, OPEN), verdict, 'the markdown row is not the line\'s words')
  cross(s, addLabels, 1595)
  assert.equal(settleStatusText(s, OPEN), verdict)
  assert.equal(s.phase, 'live', 'the labels line does not end the run')
  cross(s, drift, 1599)
  assert.equal(s.phase, 'done')
  assert.equal(settleStatusText(s, OPEN), verdict)
})

test('a live run outranks a finished one: the five-way precedence of D5', () => {
  const live1 = live()
  cross(live1, R.BASH_SETTLE_BRIEF, 0)
  const done = live()
  cross(done, R.BASH_SETTLE_MERGE_CONFIDENCE, 10)
  cross(done, drift, 20)
  assert.equal(done.phase, 'done')
  const idle = freshSettle()

  const none = { shipLive: false, specPhase: 'idle' }
  // A live ship run holds the line against everything.
  assert.equal(settleStatusText(live1, { shipLive: true, specPhase: 'idle' }), null)
  assert.equal(settleStatusText(live1, { shipLive: true, specPhase: 'checkpoint' }), null)
  assert.equal(settleStatusText(done, { shipLive: true, specPhase: 'idle' }), null)
  // A live spec run outranks a live settle run, and a done one.
  assert.equal(settleStatusText(live1, { shipLive: false, specPhase: 'live' }), null)
  assert.equal(settleStatusText(done, { shipLive: false, specPhase: 'live' }), null)
  // A live settle run outranks a spec run at its checkpoint; a done one does not.
  assert.match(settleStatusText(live1, { shipLive: false, specPhase: 'checkpoint' }), /^interlock settle /)
  assert.equal(settleStatusText(done, { shipLive: false, specPhase: 'checkpoint' }), null)
  // With no spec line to show, the settle line stands, live or done.
  for (const specPhase of ['idle', 'handed-over']) {
    assert.match(settleStatusText(live1, { shipLive: false, specPhase }), /^interlock settle /, specPhase)
    assert.equal(settleStatusText(done, { shipLive: false, specPhase }), `interlock settle ${CHANGE}: merge confidence · HUMAN 58`)
  }
  assert.equal(settleStatusText(idle, none), null)
  assert.match(settleStatusText(live1, none), /^interlock settle /)
})

// --- the pane (D14, D24, D25) -------------------------------------------------

/** The PR #25 pass, 26m 39s, as the kit replays it. */
function pr25() {
  const s = live()
  cross(s, routing, 0)
  cross(s, okBash(`interlock domain-context ${CHANGE} --changed CHANGELOG.md --base origin/main --json`, '{}'), 3)
  agent(s, { id: 'd-lang', prompt: brief('language'), model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 74, steps: spread(80, 130, 4), end: { at: 134, reason: 'answer', durationMs: 60000 } })
  agent(s, { id: 'd-tl', prompt: brief('technical-lead'), model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 75, steps: spread(82, 140, 4), end: { at: 143, reason: 'answer', durationMs: 68000 } })
  agent(s, { id: 'd-dom', prompt: brief('domain'), model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 76, steps: spread(82, 100, 2), end: { at: 101, reason: 'answer', durationMs: 25000 } })
  agent(s, { id: 'd-blast', prompt: brief('blast-radius'), model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 77, steps: spread(85, 150, 3), end: { at: 152, reason: 'answer', durationMs: 75000 } })
  agent(s, { id: 's-1', prompt: SKEPTIC_REFUTE, model: undefined, resolved: 'claude-opus-5-5', spawnAt: 118, steps: spread(125, 160, 3), efforts: ['xhigh'], served: 'claude-opus-5-5', end: { at: 176, reason: 'answer', durationMs: 58000 } })
  agent(s, { id: 's-2', prompt: SKEPTIC_SECOND, model: undefined, resolved: 'claude-opus-5-5', spawnAt: 121, steps: spread(128, 165, 3), efforts: ['xhigh'], served: 'claude-opus-5-5', end: { at: 180, reason: 'answer', durationMs: 59000 } })
  cross(s, R.BASH_SETTLE_REVIEW, 300)
  cross(s, comment, 311)
  cross(s, treeClean, 320)
  cross(s, R.BASH_SETTLE_BRIEF, 326)
  cross(s, routingFixer, 330)
  agent(s, { id: 'fix', prompt: FIXER_PROMPT, model: undefined, resolved: 'claude-opus-5-5', spawnAt: 332, steps: spread(340, 970, 31), efforts: ['xhigh'], served: 'claude-opus-5-5', end: { at: 977, reason: 'answer', durationMs: 645000 } })
  cross(s, R.BASH_SETTLE_FIXER_RESULT, 980)
  cross(s, commitPush, 1000)
  agent(s, { id: 'd-re', prompt: brief('blast-radius'), model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 1005, steps: [1010, 1020], end: { at: 1025, reason: 'answer', durationMs: 20000 } })
  cross(s, reviewR1, 1033)
  cross(s, repliesR1, 1040)
  cross(s, { ...treeClean, command: TREE_CHECK_R2 }, 1044)
  cross(s, R.BASH_SETTLE_STOP, 1046)
  cross(s, routingConformance, 1050)
  cross(s, conformanceBrief, 1052)
  agent(s, { id: 'work', prompt: WORKER_PROMPT, model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 1053, steps: spread(1060, 1290, 9), efforts: ['medium'], end: { at: 1298, reason: 'answer', durationMs: 245000 } })
  cross(s, verifyPlan, 1300)
  cross(s, verifyExec, 1490)
  cross(s, verifyJudge, 1495)
  cross(s, checksWatch, 1500, { run_in_background: true })
  cross(s, R.BASH_SETTLE_PIPELINE, 1560)
  cross(s, R.BASH_SETTLE_MERGE_CONFIDENCE, 1590)
  cross(s, mcMarkdown, 1591)
  cross(s, addLabels, 1595)
  cross(s, drift, 1599)
  return s
}

test('the pass on PR #25 draws its header in the CLI\'s words', () => {
  const lines = settlePaneLines(pr25(), 144)
  assert.equal(lines[0].text, `interlock settle — ${CHANGE} · PR #25 · lean · head 161f955 · 26m 39s`)
})

test('the header says depth: not seen until a routing line or a review record names it', () => {
  const s = live()
  cross(s, okBash(`interlock domain-context ${CHANGE} --changed CHANGELOG.md --base origin/main --json`, '{}'), 3)
  assert.match(settlePaneLines(s, 144)[0].text, /depth: not seen/)
  cross(s, R.BASH_SETTLE_REVIEW, 300)
  assert.match(settlePaneLines(s, 144)[0].text, /lean/, 'the review record\'s dimensions.depth names it')
})

test('the groups run in the pass\'s order, each with its open time, last time and span; a group never reached is not drawn', () => {
  const lines = settlePaneLines(pr25(), 144)
  const order = ['review', 'round 1', 'round 2', 'conformance', 'verify', 'checks', 'merge confidence', 'publish', 'drift']
  const at_ = order.map(g => headingAt(lines, g))
  assert.ok(at_.every(i => i >= 0), `a heading is missing: ${order.filter((g, i) => at_[i] < 0).join(', ')}`)
  assert.deepEqual([...at_].sort((a, b) => a - b), at_, 'the headings are in the order the pass runs them')
  assert.equal(headingAt(lines, 'ready'), -1, 'no gh pr ready line crossed, so no ready group')

  const review = lines[headingAt(lines, 'review')].text
  for (const part of [clockText(at(0)), clockText(at(311)), durationText(311_000)]) assert.ok(review.includes(part), `${review} lacks ${part}`)
  const round1 = lines[headingAt(lines, 'round 1')].text
  for (const part of [clockText(at(320)), clockText(at(1040)), durationText(720_000)]) assert.ok(round1.includes(part), `${round1} lacks ${part}`)
  assert.ok(lines[headingAt(lines, 'conformance')].text.includes(clockText(at(1050))) || lines[headingAt(lines, 'conformance')].text.includes(clockText(at(1052))))
})

test('the review group draws its dimensions row as two labelled facts, its skeptics, its record and its comment', () => {
  const lines = settlePaneLines(pr25(), 144)
  const review = section(lines, 'review')
  const dims = review.find(t => t.includes('review dimensions'))
  assert.ok(dims.includes('review dimensions language, technical-lead · 4 spawned'), dims)
  assert.ok(dims.includes('routed sonnet · medium'), dims)
  assert.ok(review.some(t => t.includes('routed — · xhigh')), 'the skeptics row')
  assert.ok(review.some(t => t.includes('6 raised · 0 dismissed · 6 surviving · head a96cb82')), 'the review record')
  assert.ok(review.some(t => t.includes('round 0 · exit not its own')), 'the comment, whose exit is the gh stage\'s (M6)')
  for (const name of ['language & framework', 'technical lead', 'domain', 'blast-radius']) assert.ok(review.some(t => t.startsWith(name)), `${name} reviewer row`)
})

test('round 1 draws its tree-check, brief, fixer, result, commit, re-review and replies; round 2 its STOP line', () => {
  const lines = settlePaneLines(pr25(), 144)
  const round1 = section(lines, 'round 1').join('\n')
  for (const part of [
    'tree-check clean · exit 0',
    '1 finding',
    'round 1: 1 fixed, 0 not fixed',
    'fix(review): answer the PR #25 review round 1',
    'push exit 0',
    'blast-radius',
    '161f955'
  ]) assert.ok(round1.includes(part), `round 1 lacks ${part}:\n${round1}`)
  assert.ok(section(lines, 'round 1').some(t => t.startsWith('fixer')), 'the fixer row')
  const round2 = section(lines, 'round 2').join('\n')
  assert.ok(round2.includes('tree-check clean · exit 0'), round2)
  assert.ok(round2.includes('STOP: nothing to remediate: round 2 follows a round that left no surviving blocker'), round2)
  assert.ok(!round2.includes('interlock: STOP'), 'the row starts at the CLI\'s STOP word')
})

test('the later groups repeat the CLI\'s lines: conformance, verify, checks, merge confidence, publish, drift', () => {
  const lines = settlePaneLines(pr25(), 144)
  const verify = section(lines, 'verify').join('\n')
  assert.ok(verify.includes('plan exit 0') && verify.includes('exec unit exit 0') && verify.includes('judge exit 0'), verify)
  assert.equal((verify.match(/result not seen \(redirected\)/g) || []).length, 2, 'plan and judge sent their stdout to a file')
  assert.ok(section(lines, 'checks').join('\n').includes('gh pr checks 25 --watch · background'))
  const mc = section(lines, 'merge confidence').join('\n')
  assert.ok(mc.includes(R.BASH_SETTLE_PIPELINE.text), 'the pipeline line verbatim')
  assert.ok(mc.includes('HUMAN 58 · head 161f955'), mc)
  assert.ok(mc.indexOf('HUMAN 58') < mc.indexOf('merge-confidence --markdown · exit 0'), 'the markdown row follows the verdict row')
  assert.ok(section(lines, 'publish').join('\n').includes('interlock/human-review, interlock/score-58'))
  assert.ok(section(lines, 'drift').join('\n').includes('unarchived 1 · broken 0'))
  assert.ok(textsOf(lines).some(t => /^done /.test(t) && t.includes(clockText(at(1599)).slice(0, 2))) || textsOf(lines).some(t => t.includes('done')), 'the pane says when the run ended')
  assert.ok(!textsOf(lines).join('\n').match(/complete/i), 'the word complete is on no row')
})

test('a full-width agent row carries the requested and resolved models, the routed and step levels, requests, tokens, time and reason', () => {
  const lines = settlePaneLines(pr25(), 144)
  const fixer = textsOf(lines).find(t => t.startsWith('fixer'))
  assert.ok(fixer.startsWith('fixer · inherit → claude-opus-5-5 · routed — · xhigh · step xhigh'), fixer)
  assert.match(fixer, /\b31 req\b/)
  assert.ok(fixer.endsWith('10m 45s · answer'), fixer)
  const lang = textsOf(lines).find(t => t.startsWith('language & framework'))
  assert.ok(lang.startsWith('language & framework · sonnet → claude-sonnet-5-5 · step medium · 4 req · '), lang)
  assert.ok(lang.endsWith('1m 00s · answer'), lang)
  const worker = section(lines, 'conformance').find(t => t.includes('claude-sonnet-5-5'))
  assert.ok(worker.includes('routed sonnet · —') && worker.endsWith('4m 05s · answer'), worker)
})

test('below 110 columns an agent row keeps its role, served model, elapsed time and reason', () => {
  const lines = settlePaneLines(pr25(), 90)
  const fixer = textsOf(lines).find(t => t.startsWith('fixer'))
  assert.equal(fixer, 'fixer · claude-opus-5-5 · 10m 45s · answer')
  const lang = textsOf(lines).find(t => t.startsWith('language & framework'))
  assert.equal(lang, 'language & framework · claude-sonnet-5-5 · 1m 00s · answer')
  for (const row of textsOf(lines).filter(t => /· (answer|live)$/.test(t))) {
    assert.ok(!row.includes(' → ') && !/\breq\b/.test(row) && !/\d{5}/.test(row), `a narrow row keeps its folded columns: ${row}`)
  }
  // The same lines are drawn: only the agent rows fold.
  assert.equal(lines[0].text, settlePaneLines(pr25(), 144)[0].text)
  assert.ok(section(lines, 'round 2').join('\n').includes('STOP: nothing to remediate'))
})

test('110 columns is the first full width; 109 folds', () => {
  const s = pr25()
  assert.ok(textsOf(settlePaneLines(s, 110)).find(t => t.startsWith('fixer')).includes('inherit → claude-opus-5-5'))
  assert.equal(textsOf(settlePaneLines(s, 109)).find(t => t.startsWith('fixer')), 'fixer · claude-opus-5-5 · 10m 45s · answer')
})

test('a running fixer at 90 columns reads its served model, its elapsed time and live', () => {
  const s = live()
  cross(s, R.BASH_SETTLE_BRIEF, 0)
  agent(s, { id: 'fix', prompt: FIXER_PROMPT, model: undefined, resolved: 'claude-opus-5-5', spawnAt: 10, steps: spread(14, 380, 18), efforts: ['xhigh'], served: 'claude-opus-5-5' })
  const lines = settlePaneLines(s, 90)
  assert.equal(textsOf(lines).find(t => t.startsWith('fixer')), 'fixer · claude-opus-5-5 · 6m 10s · live')
  assert.equal(headingAt(lines, 'ready'), -1)
})

test('a pane with no run says so, and the pane of a run that has named nothing says change: unknown until named', () => {
  const none = settlePaneLines(freshSettle(), 144)
  assert.equal(none.length, 1)
  assert.match(none[0].text, /no settle run is live in this session/)
  const fresh = live()
  assert.match(settlePaneLines(fresh, 144)[0].text, /change: unknown until named/)
})

test('the banners area repeats the routing lines\' banners verbatim, or reads none', () => {
  const s = live()
  assert.ok(textsOf(settlePaneLines(s, 144)).some(t => /\bnone\b/.test(t)), 'no routing line yet: the banners area reads none')
  const banner = 'ROUTING OVERRIDE: CLAUDE_CODE_SUBAGENT_MODEL forces every subagent to opus'
  cross(s, okBash('interlock routing --json', json({ ...JSON.parse(ROUTING), banners: [banner] })), 1)
  assert.ok(textsOf(settlePaneLines(s, 144)).some(t => t.includes(banner)), 'the banner is drawn verbatim')
})

// --- the pins (D10) -----------------------------------------------------------

test('the role-source pin: roleOf classifies each bundled dimension brief, every assembled dimension and skeptic prompt, and both CLI-printed first lines', () => {
  const dir = join(ROOT, 'skills', 'review-code', 'dimensions')
  const files = readdirSync(dir).filter(f => f.endsWith('.md'))
  assert.equal(files.length, 9, 'the nine bundled dimension briefs')
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8')
    const first = text.split('\n')[0]
    assert.match(first, /^# Dimension: \S/, `${f} no longer opens with a dimension heading`)
    const r = roleOf(text)
    assert.ok(r && r.role === 'dimension', `${f}: roleOf does not classify its brief as a dimension`)
    assert.equal(r.label, first.replace(/^# Dimension: /, ''), f)
    // Every prompt `interlock review brief --dimension` prints, through the assembler itself.
    const assembled = assembleDimensionPrompt({
      dimension: f.slice(0, -3),
      rubric: text,
      base: 'origin/main',
      changed: [{ path: 'lib/a.mjs', ranges: [[1, 2]] }],
      changedSources: ['lib/a.mjs'],
      policyProse: 'Blockers must cite evidence.',
      reviewContext: '# Review context'
    })
    assert.deepEqual(roleOf(assembled), r, `${f}: the assembled prompt is attributed as its brief is`)
  }

  // The skeptic sentences are defined once, in the import-free roles module, and
  // every skeptic prompt the assembler prints opens with one as a whole line.
  assert.deepEqual(SKEPTIC_ROLES.map(r => r.sentence), ['You are a skeptical code reviewer.', 'You are an independent reviewer giving a second opinion.'])
  const findings = [
    { dimension: 'qa', severity: 'warning', file: 'lib/a.mjs', line: 1, title: 'one', description: 'd' },
    { dimension: 'regression', severity: 'blocker', file: 'hooks/mod.mjs', line: 636, title: 'two', description: 'd' }
  ]
  for (const skeptics of ['per-review', 'per-finding']) {
    const { prompts } = assembleSkepticPrompts({ findings, skeptics })
    assert.ok(prompts.length >= 2, skeptics)
    for (const p of prompts) {
      const role = SKEPTIC_ROLES.find(r => r.skeptic === p.skeptic)
      assert.equal(p.prompt.split('\n')[0], role.sentence, `${skeptics} ${p.skeptic} opens with its sentence as a whole line`)
      assert.deepEqual(roleOf(p.prompt), { role: 'skeptic', label: role.label })
    }
  }
  // The skill keeps no skeptic brief of its own.
  const skill = readFileSync(join(ROOT, 'skills', 'review-code', 'SKILL.md'), 'utf8')
  assert.ok(!/^> You are a/m.test(skill), 'skills/review-code/SKILL.md still blockquotes a skeptic brief')

  // The remediate prompt the CLI assembles, through the real module.
  const prompt = assembleSettleRemediatePrompt({
    change: CHANGE,
    round: 2,
    plan: { fix: { byFile: [], unscoped: [] } },
    head: H161,
    prNumber: 25
  })
  assert.equal(prompt.split('\n')[0], `Fix round 2 for change "${CHANGE}", pull request #25, at head ${H161}.`)
  const fixer = roleOf(prompt)
  assert.deepEqual([fixer.role, fixer.round], ['fixer', 2])

  // The conformance brief, through the real CLI: its first line is the worker's source.
  const firstLine = conformanceFirstLine()
  assert.match(firstLine, /^Confirm change "[^"]+" against its diff at head [0-9a-f]{7,40}\.$/)
  assert.equal(roleOf(firstLine).role, 'conformance')
})

test('the role-source pin: a policy block followed by a dimension brief is that dimension, as the dimension assembler frames it', () => {
  // The CLI frames the policy block now (lib/prompts/review-dimension.mjs); the skill relays the printed prompt.
  const printed = assembleDimensionPrompt({ dimension: 'qa', rubric: brief('qa'), base: 'main', changed: [], policyProse: 'Important means a regression a user can see.' })
  const heading = printed.split('\n').find(l => l.startsWith('REPOSITORY REVIEW POLICY'))
  assert.ok(heading, 'the assembled prompt carries no repository review policy block')
  const composed = `${heading}\n\"\"\"\nImportant means a regression a user can see.\n\"\"\"\n\n${brief('qa')}`
  const r = roleOf(composed)
  assert.equal(r.role, 'dimension')
  assert.equal(r.label, 'QA')
})

/** The first line `interlock settle conformance-brief` prints, from a scratch directory with one scenario (no commit: the brief reads the change files and takes the head as given). */
function conformanceFirstLine() {
  const root = mkdtempSync(join(tmpdir(), 'settle-role-pin-'))
  try {
    const write = (rel, body) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true })
      writeFileSync(join(root, rel), body)
    }
    write('openspec/changes/pin-change/proposal.md', '## Why\n\nA scenario to confirm.\n')
    write('openspec/changes/pin-change/tasks.md', '- [ ] 1.1 Do it\n')
    write(
      'openspec/changes/pin-change/specs/thing/spec.md',
      '## ADDED Requirements\n\n### Requirement: The thing works\n\nThe thing SHALL work.\n\n#### Scenario: it works\n\n- **GIVEN** a thing\n- **WHEN** it runs\n- **THEN** it works\n'
    )
    write('src/thing.mjs', 'export {}\n')
    const r = spawnSync(process.execPath, [BIN, 'settle', 'conformance-brief', 'pin-change', '--changed', 'src/thing.mjs', '--base', 'HEAD', '--head', 'abc1234'], {
      cwd: root,
      encoding: 'utf8',
      env: process.env
    })
    assert.equal(r.status, 0, `conformance-brief: ${r.stderr}`)
    return r.stdout.split('\n')[0]
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// --- the skill-lines pin (D10) ------------------------------------------------

/** Every fenced line of a skill that begins with one of `commands`, with its line number. */
function fencedLines(file, commands) {
  const start = new RegExp(`^\\s*(${commands.join('|')}) `)
  const out = []
  let fenced = false
  readFileSync(join(ROOT, file), 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced
        return
      }
      if (fenced && start.test(line)) out.push({ file, n: i + 1, line: line.trim() })
    })
  return out
}

// A stage that is not an `interlock` stage may be keyed, or may be one of these
// (design D10 writes the same list down, entry for entry).
const UNKEYED_PREFIXES = [
  'git status',
  'git rev-parse',
  'git diff',
  'git add',
  'git fetch',
  'git log',
  'git remote',
  'git --literal-pathspecs restore',
  'gh pr view',
  'gh pr create',
  'gh pr comment',
  'gh label create',
  'glab mr view',
  'glab mr create',
  'glab mr note',
  'glab mr update <id> --description',
  'gh pr edit <id> --body',
  'gh pr checks <n> --required',
  // Piped into `interlock pipeline` it is that line's input, not the wait for the checks (M12).
  'glab ci get',
  'cat <<',
  'rm -f .claude/ship/settle/'
]

test('the skill-lines pin: every stage of every fenced line of the settle and review-code skills is keyed or written down', () => {
  const lines = [
    ...fencedLines('skills/settle/SKILL.md', ['interlock', 'gh', 'glab', 'git']),
    ...fencedLines('skills/review-code/SKILL.md', ['interlock'])
  ]
  assert.ok(lines.length >= 50, `only ${lines.length} fenced command lines found`)
  const stray = []
  for (const { file, n, line } of lines) {
    const stages = settleLines(line)
    assert.ok(Array.isArray(stages) && stages.length >= 1, `${file}:${n}: settleLines read no stage of: ${line}`)
    for (const { kind, segment } of stages) {
      const stage = String(segment).trim()
      if (/^interlock\s/.test(stage)) {
        // An interlock verb has a kind, never an allow-list entry, so a new verb cannot hide behind a git or gh stage.
        if (kind === null || kind === undefined || settleLineKind(stage) === null) stray.push(`${file}:${n}: interlock stage with no kind: ${stage}`)
      } else if (kind === null || kind === undefined) {
        if (!UNKEYED_PREFIXES.some(p => stage.startsWith(p))) stray.push(`${file}:${n}: stage neither keyed nor written down: ${stage}`)
      }
    }
  }
  assert.deepEqual(stray, [], 'a stage the settle reader does not know')
})

test('the skill-lines pin reads pipe stages: an interlock stage behind git status is seen, and a new verb behind an allowed prefix is not hidden', () => {
  const piped = settleLines(TREE_CHECK)
  assert.equal(piped.length, 2)
  assert.equal(piped[0].kind, null, 'git status is an unkeyed stage')
  assert.ok(piped[1].kind, 'the tree-check stage is keyed')
  const hidden = settleLines('git diff --cached --name-only -z | interlock settle brand-new-verb --changed -')
  const interlockStage = hidden.find(s => /^interlock\s/.test(String(s.segment).trim()))
  assert.ok(interlockStage, 'the interlock stage is a stage of its own')
  assert.ok(!interlockStage.kind, 'a verb nobody keyed has no kind')
})

// --- the purity pin ------------------------------------------------------------

test('lib/settle-meter.mjs imports nothing from node, spells no engine call, never reads the roll-up, and spells neither complete nor deny', () => {
  const source = readFileSync(join(ROOT, 'lib', 'settle-meter.mjs'), 'utf8')
  const imports = [...source.matchAll(/^\s*import\b[^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1])
  for (const spec of imports) assert.match(spec, /^\.\.?\//, `${spec}: a bare or node: import in the pure module`)
  assert.doesNotMatch(source, /from\s+['"]node:/)
  assert.doesNotMatch(source, /\bimport\(/)
  assert.doesNotMatch(source, /\brequire\(/)
  assert.ok(!source.includes('$.'), 'the pure module spells an engine call')
  assert.ok(!source.includes('dimensions.completed'), 'the module reads dimensions.completed')
  assert.doesNotMatch(source, /\.completed\b/)
  assert.doesNotMatch(source, /complete/i, 'the module spells complete')
  assert.doesNotMatch(source, /deny/i, 'the module spells deny')
})

// --- the PR #26 review's fixes (M1-M17, B4, B5) --------------------------------

/** A Bash result the engine kept out of line, as it raises one too large to read inline. */
const tooLarge = command => ({
  command,
  result: { stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false, persistedOutputPath: '/tmp/out.txt' },
  text: ''
})
/** A clean exit that printed nothing on stdout and `stderr` on stderr. */
const stderrBash = (command, stderr) => ({ command, result: { stdout: '', stderr, interrupted: false, isImage: false, noOutputExpected: true }, text: '' })

test('M1: a review record whose stdout was too large still names its round, so round 2 opens and the STOP lands there', () => {
  const s = live()
  cross(s, routing, 0)
  cross(s, tooLarge(R.BASH_SETTLE_REVIEW.command), 300)
  cross(s, treeClean, 320)
  cross(s, R.BASH_SETTLE_BRIEF, 326)
  cross(s, tooLarge(reviewR1.command), 1033)
  cross(s, { ...treeClean, command: TREE_CHECK_R2 }, 1044)
  cross(s, R.BASH_SETTLE_STOP, 1050)
  const lines = settlePaneLines(s, 144)
  assert.ok(headingAt(lines, 'round 1') >= 0, textsOf(lines).join('\n'))
  assert.ok(headingAt(lines, 'round 2') >= 0, textsOf(lines).join('\n'))
  assert.ok(section(lines, 'round 2').some(t => t.includes('STOP: ')))
  assert.match(settleStatusText(s, {}), /: round 2 · STOP$/)
  assert.equal(s.lastRecord, 1)
})

test('M2: only the pass\'s own drift line ends it; the spec flow\'s `interlock drift --json` leaves the run live', () => {
  assert.equal(settleLineKind('interlock drift --json'), null)
  assert.equal(settleLineKind('interlock drift --changed a.md --json'), 'drift')
  const s = inRound1()
  run(s, 'interlock drift --json', json({ root: '.', unarchived: [], stale: { skipped: false, reason: null, broken: [], aging: [] } }), 1000)
  assert.equal(s.phase, 'live')
  assert.equal(headingAt(settlePaneLines(s, 144), 'drift'), -1)
})

test('M6: the call\'s exit is drawn only on the stage that set it', () => {
  const coverage = 'interlock verify coverage --base origin/main --json > .claude/ship/settle/coverage.json || rm -f .claude/ship/settle/coverage.json'
  const lines = settleLines(coverage)
  assert.equal(lines[0].own(0), false, 'a stage followed by || does not own the exit')
  assert.equal(lines[1].own(0), false, 'nor does the fallback after it: an exit of 0 may mean it never ran')
  const s = live()
  cross(s, routing, 0)
  run(s, coverage, '', 1200)
  assert.ok(groupRows(s, 'verify').some(t => t.includes('coverage exit not its own') && t.includes('result not seen (redirected)')), groupRows(s, 'verify').join('\n'))

  const pair = settleLines('git commit -m "x" && git push')
  assert.deepEqual([pair[0].own(0), pair[1].own(0)], [true, true], 'an && list that exited 0 ran every stage to 0')
  assert.deepEqual([pair[0].own(1), pair[1].own(1)], [false, false], 'a failed && list could have failed at either stage')
  assert.equal(settleLines('a | interlock settle tree-check --status -')[1].own(1), true, 'the last stage of a pipe owns its exit')
  assert.equal(settleLines('interlock settle comment --round 0 | gh pr comment 25')[0].own(0), false)
  assert.equal(settleLines('git commit -m "$(interlock x)"')[1].own(0), false, 'a stage inside $( ) never owns the call\'s exit')
  assert.equal(settleLines('git commit -m a; git push')[0].own(0), false, 'a stage before ; does not own the exit')

  const failed = inRound1()
  cross(failed, errBash(commitPush.command, 1, 'error: pathspec did not match'), 1000)
  const failedRow = groupRows(failed, 'round 1').find(t => t.includes('commit fix(review)'))
  assert.ok(failedRow && failedRow.includes('exit 1 from the commit or the push') && !failedRow.includes('push exit 1'), failedRow)
  const passed = inRound1()
  cross(passed, commitPush, 1000)
  assert.ok(groupRows(passed, 'round 1').some(t => t.includes('commit fix(review)') && t.includes('push exit 0')))
})

test('M7: a conformance brief with nothing to confirm draws the stderr line the CLI wrote', () => {
  const s = live()
  cross(s, routing, 0)
  const line = `interlock: nothing to confirm for "${CHANGE}": no scenario in its delta specs and no living requirement`
  cross(s, stderrBash(conformanceBrief.command, `${line}\n`), 1110)
  assert.ok(groupRows(s, 'conformance').some(t => t.includes('conformance-brief exit 0') && t.includes(line)), groupRows(s, 'conformance').join('\n'))
  const brief = live()
  cross(brief, conformanceBrief, 1110)
  assert.ok(groupRows(brief, 'conformance').some(t => /conformance-brief exit 0$/.test(t)), 'a brief that printed its briefing adds no line')
})

test('M8: a dirty tree-check lists only the paths it counted, wherever the folded stderr sentence sits', () => {
  const sentence = 'interlock: working tree not clean: 2 path(s) differ from HEAD or are untracked'
  for (const body of [`dirty (2):\n  lib/a.mjs\n  lib/b.mjs\n${sentence}`, `${sentence}\ndirty (2):\n  lib/a.mjs\n  lib/b.mjs`]) {
    const s = live()
    cross(s, R.BASH_SETTLE_REVIEW, 300)
    cross(s, errBash(TREE_CHECK, 1, body), 320)
    const row = groupRows(s, 'round 1').find(t => t.includes('tree-check'))
    assert.ok(row, groupRows(s, 'round 1').join('\n'))
    assert.ok(row.includes('dirty (2): lib/a.mjs, lib/b.mjs · exit 1'), row)
    assert.ok(!row.includes('working tree not clean') && !row.includes('unparsed'), row)
  }
})

test('M9: a skeptic brief copied with its blockquote marker is still the skeptic', () => {
  assert.deepEqual(roleOf(`> ${SKEPTIC_REFUTE.replace('\n', '\n> ')}`), { role: 'skeptic', label: 'refute' })
  assert.deepEqual(roleOf(`> ${SKEPTIC_SECOND}`), { role: 'skeptic', label: 'second opinion' })
})

test('M10: control characters never reach the pane, the status line or a toast, and no text runs past the published cap', () => {
  const s = inRound1()
  const evil = 'test/\u001b]52;c;dGVzdA==\u0007x.test.mjs'
  run(s, 'git diff --cached --name-only -z | interlock settle test-paths --changed - --profile p.json --json', JSON.stringify({ protected: [evil], unprotected: [], profile: 'p.json', reason: null }), 1000)
  agent(s, { id: 'long', prompt: `# Dimension: ${'x'.repeat(10_000)}\u001b[2J`, model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 1001, end: { at: 1002, reason: 'aborted', durationMs: 1000 } })
  const texts = [...textsOf(settlePaneLines(s, 144)), settleStatusText(s, {})]
  for (const t of texts) {
    assert.doesNotMatch(t, /[\u0000-\u001F\u007F-\u009F]/, JSON.stringify(t.slice(0, 120)))
    assert.ok(t.length <= LIMITS.settleTextChars, `${t.length} characters`)
  }
  const end = noteSettleEnd(live(), {}, at(0))
  assert.deepEqual(end.toasts, [])
})

test('M11: pathological commands are read in linear time', () => {
  const started = performance.now()
  settleLines(`git commit -F - <<EOF\n${'a'.repeat(250_000)}\nEOF`)
  settleLines(`interlock gate ${'a#'.repeat(100_000)}`)
  const s = inRound1()
  // Built by hand: okBash's own trim is the backtracking pattern this case measures.
  const body = `dirty (1):\n  a${' '.repeat(50_000)}b`
  cross(s, { command: TREE_CHECK, result: { stdout: body, stderr: '' }, text: body }, 1000)
  assert.ok(performance.now() - started < 400, `${Math.round(performance.now() - started)} ms`)
})

test('M12: a continued line, an unread commit message and a glab line piped onward', () => {
  const s = live()
  run(s, 'interlock routing --json \\\n  --depth strict', ROUTING, 0)
  assert.ok(groupRows(s, 'review').some(t => t.startsWith(`${clockText(at(0))} routing · depth lean`)), groupRows(s, 'review').join('\n'))
  const r = inRound1()
  cross(r, okBash(`git commit -m "$(cat <<'EOF'\nfix: subject\nEOF\n)"`, '[x abc1234] fix'), 1000)
  assert.ok(groupRows(r, 'round 1').some(t => t.includes('commit (message not read)')), groupRows(r, 'round 1').join('\n'))
  const piped = settleLines('glab ci get --merge-request 7 --output json | interlock pipeline --gitlab - --out p.json')
  assert.deepEqual(piped.map(l => l.kind), [null, 'pipeline'])
  assert.equal(settleLineKind('glab ci get --merge-request 7 --output json'), 'checks')
})

test('M13: a review that skipped or could not run a dimension says so on its row', () => {
  const doc = JSON.parse(R.BASH_SETTLE_REVIEW.result.stdout)
  doc.dimensions = { ...doc.dimensions, skipped: [{ name: 'security', reason: 'no trigger' }], unavailable: ['devops'] }
  const s = live()
  cross(s, okBash(R.BASH_SETTLE_REVIEW.command, json(doc)), 300)
  assert.ok(groupRows(s, 'review').some(t => t.includes('skipped security') && t.includes('unavailable devops')), groupRows(s, 'review').join('\n'))
  assert.deepEqual(s.reviews.get(0).skipped, ['security'])
})

test('M15: every keyed line kind is spelled by some line of the settle or review-code skill', () => {
  const lines = [
    ...fencedLines('skills/settle/SKILL.md', ['interlock', 'gh', 'glab', 'git']),
    ...fencedLines('skills/review-code/SKILL.md', ['interlock', 'interlock-graph'])
  ].map(l => l.line)
  for (const file of ['skills/settle/SKILL.md', 'skills/review-code/SKILL.md']) {
    for (const m of readFileSync(join(ROOT, file), 'utf8').matchAll(/`(interlock(?:-graph)? [^`]+)`/g)) lines.push(m[1])
  }
  const seen = new Set(lines.flatMap(l => settleLines(l).map(s => s.kind)).filter(Boolean))
  assert.deepEqual(SETTLE_KINDS.filter(k => !seen.has(k)), [])
})

test('M15: a JSON line the engine kept out of line reads `result not seen (too large)`, never as a verdict', () => {
  const commands = [
    'interlock routing --json',
    R.BASH_SETTLE_REVIEW.command,
    'git diff --cached --name-only -z | interlock settle test-paths --changed - --profile p.json --json',
    R.BASH_SETTLE_BRIEF.command,
    R.BASH_SETTLE_MERGE_CONFIDENCE.command,
    'interlock merge-confidence --label-names --json',
    drift.command
  ]
  for (const command of commands) {
    const s = live()
    const out = cross(s, tooLarge(command), 10)
    const rows = s.groups.flatMap(g => g.rows.map(r => r.text))
    assert.ok(rows.some(t => t.includes('result not seen (too large)')), `${command.slice(0, 60)}: ${rows.join(' | ')}`)
    assert.deepEqual(out.toasts, [], command.slice(0, 60))
  }
})

test('M15: the merge-confidence row names the labels the verdict and score carry', () => {
  const s = live()
  cross(s, R.BASH_SETTLE_MERGE_CONFIDENCE, 1590)
  const doc = JSON.parse(R.BASH_SETTLE_MERGE_CONFIDENCE.result.stdout)
  assert.ok(groupRows(s, 'merge confidence').some(t => t.includes(`labels ${doc.labels.verdict.name}, ${doc.labels.score.name}`)), groupRows(s, 'merge confidence').join('\n'))
})

test('M16: a row the clock could not time says so, and an unreadable routing line reads routed: not read', () => {
  const s = freshSettle({ review: true })
  s.phase = 'live'
  applySettleLines(s, { command: 'interlock routing --json' }, errBash('interlock routing --json', 1, 'interlock: routing unavailable'), null)
  noteSettleSpawn(s, spawnEvent(FIXER_PROMPT, { agentId: 'f', resolved: 'claude-opus-5-5' }).input, { agentId: 'f', model: 'claude-opus-5-5' }, null)
  const texts = textsOf(settlePaneLines(s, 144))
  assert.ok(texts[0].endsWith('time unknown'), texts[0])
  assert.ok(texts.some(t => t.startsWith('time unknown routing (unparsed)')), texts.join('\n'))
  assert.ok(texts.some(t => t.startsWith('review · time unknown')), texts.join('\n'))
  assert.ok(texts.some(t => t.includes('routed: not read')), texts.join('\n'))
  assert.ok(!texts.some(t => t.includes('routed: not seen')), texts.join('\n'))
})

test('M17: the pane folds its agent rows below the published width', () => {
  const s = live()
  agent(s, { id: 'd', prompt: brief('language'), model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 1, steps: [2] })
  const row = cols => textsOf(settlePaneLines(s, cols)).find(t => t.startsWith('Language') || t.includes('→ claude-sonnet-5-5') || t.includes('claude-sonnet-5-5 ·'))
  assert.ok(row(LIMITS.settlePaneFullColumns).includes('→'), row(LIMITS.settlePaneFullColumns))
  assert.ok(!row(LIMITS.settlePaneFullColumns - 1).includes('→'), row(LIMITS.settlePaneFullColumns - 1))
})

// --- cards: the fields beside each text (draw-the-settle-and-spec-panes-as-cards D1, D2, D4, D5) ---

/** The merge-confidence `--json` line resolving with this verdict and score. */
function mcWith(verdict, score) {
  const doc = { ...JSON.parse(R.BASH_SETTLE_MERGE_CONFIDENCE.result.stdout), verdict, score }
  return okBash(R.BASH_SETTLE_MERGE_CONFIDENCE.command, json(doc))
}
/** The line whose key is `key`. */
function lineAt(lines, key) {
  const line = lines.find(l => l.key === key)
  assert.ok(line, `no line keyed ${key} in:\n${lines.map(l => l.key).join('\n')}`)
  return line
}
/** The first line that is not a heading and whose text includes `words`. */
function rowWith(lines, words) {
  const line = lines.find(l => l.text.includes(words) && l.kind !== 'heading')
  assert.ok(line, `no line reads ${words} in:\n${textsOf(lines).join('\n')}`)
  return line
}
/** The tone of the one span whose text is exactly `words`. */
function toneOf(line, words) {
  const found = line.spans.filter(s => s.text === words)
  assert.equal(found.length, 1, `${JSON.stringify(words)} is not one span of ${JSON.stringify(line.spans)}`)
  return found[0].tone
}
const lastSpan = line => line.spans[line.spans.length - 1]

test('a pass loaded without --review groups resolve, merge confidence, publish and drift, and ends at the drift line', () => {
  const s = live(0, false)
  run(s, 'interlock changes', '', 2)
  cross(s, R.BASH_SETTLE_PIPELINE, 60)
  cross(s, mcWith('MERGE', 91), 90)
  cross(s, addLabels, 95)
  cross(s, drift, 99)
  const lines = settlePaneLines(s, 144)
  const order = ['resolve', 'merge confidence', 'publish', 'drift'].map(label => headingAt(lines, label))
  assert.ok(order.every(i => i > 0), JSON.stringify(order))
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'the groups are drawn in the pass\'s order')
  assert.deepEqual(s.groups.map(g => g.label), ['resolve', 'merge confidence', 'publish', 'drift'])
  assert.equal(headingAt(lines, 'review'), -1, 'no review group')
  assert.ok(!lines.some(l => /^round \d/.test(l.text)), 'no round group')
  assert.ok(section(lines, 'resolve').some(t => t.endsWith('changes exit 0')), section(lines, 'resolve').join('\n'))
  assert.equal(s.phase, 'done')
  assert.equal(lines[1].text, 'without --review')
  assert.equal(settleStatusText(s, {}), `interlock settle ${CHANGE} #25: merge confidence · MERGE 91`)
})

test('a pass without --review never opens review or a round, whatever its lines name', () => {
  const s = live(0, false)
  run(s, 'interlock changes', '', 1)
  cross(s, R.BASH_SETTLE_REVIEW, 300)
  cross(s, treeClean, 320)
  cross(s, R.BASH_SETTLE_BRIEF, 326)
  agent(s, { id: 'fix', prompt: FIXER_PROMPT, model: undefined, resolved: 'claude-opus-5-5', spawnAt: 332, steps: [340] })
  cross(s, R.BASH_SETTLE_FIXER_RESULT, 980)
  cross(s, R.BASH_SETTLE_STOP, 1046)
  assert.deepEqual(s.groups.map(g => g.label), ['resolve'])
  const lines = settlePaneLines(s, 144)
  assert.equal(headingAt(lines, 'review'), -1)
  assert.ok(!lines.some(l => /^round \d/.test(l.text)), textsOf(lines).join('\n'))
  assert.ok(section(lines, 'resolve').some(t => t.startsWith('fixer')), 'the fixer lands in the section open')
  // With no section open yet, a pass's first spawn opens resolve too.
  const first = live(0, false)
  agent(first, { id: 'a', prompt: 'hello', model: undefined, resolved: 'claude-opus-5-5', spawnAt: 1 })
  assert.deepEqual(first.groups.map(g => g.label), ['resolve'])
})

test('the mode line follows the header: with --review or without --review, dim, and the header stays rows[0]', () => {
  for (const [review, text] of [[true, 'with --review'], [false, 'without --review']]) {
    const s = live(0, review)
    run(s, 'interlock changes', '', 1)
    const lines = settlePaneLines(s, 144)
    assert.equal(lines[0].key, 'settle-header')
    assert.equal(lines[0].kind, 'header')
    assert.match(lines[0].text, /^interlock settle — /)
    assert.deepEqual(lines[1], { key: 'settle-mode', kind: 'mode', text, dim: true, spans: [{ text, tone: 'dim' }] })
  }
  const none = settlePaneLines(freshSettle(), 144)
  assert.equal(none.length, 1, 'a pane with no run draws no mode line')
  assert.equal(none[0].kind, 'none')
})

test('every line carries its kind, and every line under a heading its group index', () => {
  const s = pr25()
  s.banners.push('a routing banner')
  const lines = settlePaneLines(s, 144)
  const kinds = new Set(['none', 'header', 'mode', 'heading', 'row', 'role', 'agent', 'verdict', 'done', 'banners', 'banner'])
  for (const l of lines) assert.ok(kinds.has(l.kind), `${l.key}: kind ${l.kind}`)
  let g = -1
  for (const l of lines) {
    if (l.kind === 'heading') {
      g++
      assert.equal(l.group, g, l.text)
      assert.ok(l.text.startsWith(s.groups[g].label), l.text)
    } else if (['row', 'role', 'agent', 'verdict'].includes(l.kind)) {
      assert.equal(l.group, g, `${l.key} sits under group ${g}`)
    } else {
      assert.equal(l.group, undefined, `${l.key} is in no group`)
    }
  }
  assert.equal(g, s.groups.length - 1)
  assert.equal(lineAt(lines, 'settle-done').kind, 'done')
  assert.equal(lineAt(lines, 'settle-banners').kind, 'banners')
  assert.equal(lineAt(lines, 'settle-banner-0').kind, 'banner')
})

test('open marks the open group\'s heading while the run is live, and no heading once it is done', () => {
  const s = inRound1()
  agent(s, { id: 'fix', prompt: FIXER_PROMPT, model: undefined, resolved: 'claude-opus-5-5', spawnAt: 332, steps: [340] })
  const lines = settlePaneLines(s, 144)
  const opened = lines.filter(l => l.open === true)
  assert.equal(opened.length, 1)
  assert.equal(opened[0].kind, 'heading')
  assert.match(opened[0].text, /^round 1 · /)
  assert.notEqual(lines[headingAt(lines, 'review')].open, true)
  cross(s, drift, 1599)
  assert.equal(s.phase, 'done')
  assert.ok(!settlePaneLines(s, 144).some(l => l.open === true), 'a done run marks no card')
  assert.ok(!settlePaneLines(pr25(), 144).some(l => 'open' in l), 'the PR #25 pass is done')
})

test('depth: 1 on a role line and on an agent row with no role line, 2 on an agent row under a role', () => {
  const s = live()
  cross(s, routing, 0)
  agent(s, { id: 'd-lang', prompt: brief('language'), model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 74, steps: [80] })
  agent(s, { id: 's-1', prompt: SKEPTIC_REFUTE, model: undefined, resolved: 'claude-opus-5-5', spawnAt: 118, steps: [125] })
  agent(s, { id: 'u', prompt: 'hello', model: undefined, resolved: 'claude-opus-5-5', spawnAt: 119 })
  cross(s, R.BASH_SETTLE_REVIEW, 300)
  cross(s, treeClean, 320)
  cross(s, R.BASH_SETTLE_BRIEF, 326)
  agent(s, { id: 'fix', prompt: FIXER_PROMPT, model: undefined, resolved: 'claude-opus-5-5', spawnAt: 332, steps: [340] })
  cross(s, conformanceBrief, 1052)
  agent(s, { id: 'work', prompt: WORKER_PROMPT, model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 1053, steps: [1060] })
  const lines = settlePaneLines(s, 144)
  const roles = lines.filter(l => l.kind === 'role')
  assert.equal(roles.length, 2, textsOf(roles).join('\n'))
  for (const l of roles) assert.equal(l.depth, 1, l.text)
  const agentRow = start => lines.find(l => l.kind === 'agent' && l.text.startsWith(start))
  assert.equal(agentRow('language & framework').depth, 2)
  assert.equal(agentRow('skeptic (refute)').depth, 2)
  assert.equal(agentRow('fixer').depth, 1)
  assert.equal(agentRow('conformance').depth, 1)
  assert.equal(agentRow('general-purpose · unattributed').depth, 1)
  for (const l of lines.filter(x => !['role', 'agent'].includes(x.kind))) assert.equal(l.depth, undefined, l.key)
})

test('row tones: the clock, exit 0, any other own exit, exit not its own, result not seen, STOP and (unparsed)', () => {
  const s = live()
  run(s, 'interlock changes', '', 1)
  cross(s, errBash('interlock surface --json', 2, 'boom'), 2)
  run(s, 'interlock gate --json | cat', '', 3)
  cross(s, verifyPlan, 4)
  cross(s, errBash('interlock routing --json', 1, 'interlock: routing unavailable'), 5)
  cross(s, R.BASH_SETTLE_STOP, 6)
  cross(s, tooLarge('interlock routing settle-fixer --json'), 7)
  const lines = settlePaneLines(s, 144)
  assert.deepEqual(rowWith(lines, 'changes exit 0').spans, [
    { text: clockText(at(1)), tone: 'clock' },
    { text: ' changes ', tone: null },
    { text: 'exit 0', tone: 'ok' }
  ])
  assert.equal(toneOf(rowWith(lines, 'surface exit 2'), 'exit 2'), 'alarm')
  assert.equal(toneOf(rowWith(lines, 'gate exit not its own'), 'exit not its own'), 'dim')
  const plan = rowWith(lines, 'result not seen (redirected)')
  assert.equal(toneOf(plan, 'exit 0'), 'ok')
  assert.equal(toneOf(plan, 'result not seen (redirected)'), 'dim')
  const large = rowWith(lines, 'result not seen (too large)')
  assert.equal(toneOf(large, 'result not seen (too large)'), 'dim')
  assert.equal(toneOf(rowWith(lines, 'routing (unparsed)'), '(unparsed)'), 'alarm')
  const stop = rowWith(lines, 'STOP: ')
  assert.equal(stop.spans.length, 3, JSON.stringify(stop.spans))
  assert.deepEqual(stop.spans.slice(0, 2), [{ text: clockText(at(6)), tone: 'clock' }, { text: ' ', tone: null }])
  assert.ok(stop.spans[2].text.startsWith('STOP: '))
  assert.equal(stop.spans[2].tone, 'alarm', 'a STOP body is wholly alarm')
  // A row the clock could not time: the words in the clock's place take the clock's tone.
  const untimed = freshSettle({ review: true })
  untimed.phase = 'live'
  applySettleLines(untimed, { command: 'interlock changes' }, okBash('interlock changes'), null)
  assert.equal(toneOf(rowWith(settlePaneLines(untimed, 144), 'changes exit 0'), 'time unknown'), 'clock')
})

test('heading, role, banner, banners heading and done tones', () => {
  const s = pr25()
  s.banners.push('model forced to sonnet')
  const lines = settlePaneLines(s, 144)
  const mc = lines[headingAt(lines, 'merge confidence')]
  assert.equal(mc.spans.length, 2, JSON.stringify(mc.spans))
  assert.deepEqual(mc.spans[0], { text: 'merge confidence', tone: 'heading' })
  assert.equal(mc.spans[1].tone, 'dim')
  const dims = lines.find(l => l.kind === 'role' && l.text.startsWith('review dimensions'))
  assert.deepEqual(dims.spans[0], { text: dims.text.split(' · ')[0], tone: 'accent' })
  assert.ok(dims.spans.slice(1).every(sp => sp.tone === null), JSON.stringify(dims.spans))
  assert.deepEqual(lineAt(lines, 'settle-banner-0').spans, [{ text: 'model forced to sonnet', tone: 'warn' }])
  assert.deepEqual(lineAt(lines, 'settle-banners').spans, [{ text: 'banners', tone: 'dim' }])
  const done = lineAt(lines, 'settle-done')
  assert.deepEqual(done.spans, [{ text: done.text, tone: 'dim' }])
  assert.deepEqual(lineAt(settlePaneLines(live(), 144), 'settle-banners').spans, [{ text: 'banners: none', tone: 'dim' }])
})

test('agent tones: the name up to the first separator, and the end word live, answer or another reason', () => {
  const fixer = settlePaneLines(pr25(), 144).find(l => l.kind === 'agent' && l.text.startsWith('fixer'))
  assert.deepEqual(fixer.spans[0], { text: 'fixer', tone: 'name' })
  assert.deepEqual(lastSpan(fixer), { text: 'answer', tone: 'ok' })
  const s = inRound1()
  agent(s, { id: 'fix', prompt: FIXER_PROMPT, model: undefined, resolved: 'claude-opus-5-5', spawnAt: 332, steps: [340] })
  agent(s, { id: 'ab', prompt: brief('language'), model: 'sonnet', resolved: 'claude-sonnet-5-5', spawnAt: 333, steps: [334], end: { at: 335, reason: 'aborted', durationMs: 2000 } })
  agent(s, { id: 'u', prompt: 'hello', subagentType: 'Explore', model: undefined, resolved: 'claude-opus-5-5', spawnAt: 336 })
  for (const columns of [144, 90]) {
    const lines = settlePaneLines(s, columns)
    const running = lines.find(l => l.kind === 'agent' && l.text.startsWith('fixer'))
    assert.deepEqual(lastSpan(running), { text: 'live', tone: 'running' }, `${columns}: ${JSON.stringify(running.spans)}`)
    const aborted = lines.find(l => l.kind === 'agent' && l.text.endsWith('aborted'))
    assert.deepEqual(lastSpan(aborted), { text: 'aborted', tone: 'alarm' })
    assert.equal(aborted.spans[0].tone, 'name')
    const odd = lines.find(l => l.kind === 'agent' && l.text.includes('unattributed'))
    assert.deepEqual(odd.spans[0], { text: 'Explore', tone: 'name' })
  }
})

test('the verdict row carries the CLI\'s verdict word: MERGE ok, HUMAN warn, BLOCK alarm, any other word uncoloured', () => {
  for (const [verdict, tone] of [['MERGE', 'ok'], ['HUMAN', 'warn'], ['BLOCK', 'alarm'], ['WAIT', null]]) {
    const s = live()
    cross(s, R.BASH_SETTLE_PIPELINE, 1)
    cross(s, mcWith(verdict, 58), 2)
    cross(s, mcMarkdown, 3)
    const lines = settlePaneLines(s, 144)
    const verdicts = lines.filter(l => l.kind === 'verdict')
    assert.equal(verdicts.length, 1, 'only the --json row is the verdict row')
    const row = verdicts[0]
    assert.equal(row.verdict, verdict)
    assert.ok(row.text.startsWith(`${clockText(at(2))} ${verdict} 58`), row.text)
    assert.deepEqual(row.spans[0], { text: clockText(at(2)), tone: 'clock' })
    if (tone === null) {
      assert.equal(row.spans.length, 2, JSON.stringify(row.spans))
      assert.equal(row.spans[1].tone, null, 'an unknown verdict word is drawn uncoloured')
    } else {
      assert.deepEqual(row.spans.slice(1, 3), [{ text: ' ', tone: null }, { text: verdict, tone }])
      assert.ok(row.spans.slice(3).every(sp => sp.tone === null), JSON.stringify(row.spans))
    }
    assert.equal(rowWith(lines, 'merge-confidence --markdown').kind, 'row')
  }
  const pr = settlePaneLines(pr25(), 144).find(l => l.kind === 'verdict')
  assert.equal(pr.verdict, 'HUMAN')
  assert.equal(toneOf(pr, 'HUMAN'), 'warn')
})

test('spans join to the text after the cap, and every tone is one of the vocabulary', () => {
  const s = live()
  run(s, `git status | interlock settle tree-check --change ${CHANGE} --status -`, `dirty (1):\n  ${'x'.repeat(LIMITS.settleTextChars * 2)}`, 1)
  const long = settlePaneLines(s, 144).find(l => l.text.endsWith('…'))
  assert.ok(long, 'a row past the cap')
  assert.equal(long.text.length, LIMITS.settleTextChars)
  assert.equal(long.spans.map(sp => sp.text).join(''), long.text)
  const tones = new Set(['clock', 'dim', 'heading', 'name', 'ok', 'alarm', 'warn', 'current', 'accent', 'running', null])
  for (const columns of [144, 90]) for (const l of settlePaneLines(pr25(), columns)) for (const sp of l.spans) assert.ok(tones.has(sp.tone), `${l.key}: tone ${sp.tone}`)
})

// The columns a settle card takes from a row: the card's border and padding (`paneCard`), the gutter of a
// role or agent row (`SETTLE_GUTTER`) and the indent of each depth beyond the first (`INDENT`), in hooks/mod.mjs.
const CARD_CHROME = 4
const SETTLE_GUTTER = 9
const DEPTH_INDENT = 2

test('the review\'s M2: every folded agent row of the PR #25 pass fits a settle card at the settle card floor', () => {
  const floor = LIMITS.settlePaneCardColumns
  assert.ok(Number.isInteger(floor) && floor >= LIMITS.waveBoardMinColumns && floor < LIMITS.settlePaneFullColumns, String(floor))
  assert.equal(settleDrawsCards(floor), true)
  for (const columns of [floor - 1, LIMITS.waveBoardMinColumns, null, undefined, '144', NaN]) assert.equal(settleDrawsCards(columns), false, String(columns))
  const agents = settlePaneLines(pr25(), floor).filter(l => l.kind === 'agent')
  assert.ok(agents.length >= 9, `only ${agents.length} agent rows`)
  const drawn = agents.map(l => ({ text: l.text, width: l.text.length + CARD_CHROME + SETTLE_GUTTER + DEPTH_INDENT * ((l.depth > 1 ? l.depth : 1) - 1) }))
  const widest = drawn.reduce((a, b) => (b.width > a.width ? b : a))
  assert.ok(widest.width <= floor, `the widest folded agent row needs ${widest.width} columns: ${widest.text}`)
})

// --- the proof lines (spec: hooks/settle-meter, keyed lines) ----------------------

test('own kind: the brief, proof, staging, archived-change and graph-covers lines are their own kinds, never review records', () => {
  const kinds = [
    ['interlock review brief --dimension regression --base origin/main', 'review-brief'],
    ['interlock review brief --skeptics --findings f.json --json', 'review-brief'],
    ['interlock review proof --review .claude/ship/settle/review-r0.json', 'review-proof'],
    ['interlock settle staging-pathspecs --change x --nul', 'staging-pathspecs'],
    ['interlock settle archived-change --name-status - --json', 'archived-change'],
    ['interlock-graph covers --changed - --update', 'graph-covers'],
    ['interlock review --findings f --verdicts v --draft --out d.json --json', 'review-draft']
  ]
  for (const [command, kind] of kinds) {
    assert.deepEqual(settleLines(command).map(s => s.kind), [kind], command)
  }
  const piped = settleLines('git diff --name-status -M 251cebe...e177e7d | interlock settle archived-change --name-status - --json')
  assert.deepEqual(piped.map(s => s.kind), [null, 'archived-change'])
})

test('not proven: an unproven record\'s review row reads not proven with its counts, and the proof line is a row of its own', () => {
  const s = live()
  const record = {
    counts: { raised: 0, dismissed: 0, surviving: 0 },
    head: 'e177e7de66d7db4ca8b0441ce9f2c41248751803',
    dimensions: { ran: ['language', 'technical-lead', 'domain', 'blast-radius'], skipped: [] },
    proof: {
      proven: false,
      unproven: ['language', 'technical-lead', 'domain', 'blast-radius'].map(d => ({ dimension: d, reason: 'coverage not recorded' })),
      unread: [],
      uncited: ['hooks/mod.mjs', 'lib/meter-palette.mjs', 'lib/settle-meter.mjs', 'lib/spec-meter.mjs']
    }
  }
  run(s, 'interlock review --findings f --verdicts v --head e177e7d --out .claude/ship/settle/review-r0.json --json', JSON.stringify(record), 100)
  const rows = groupRows(s, 'review')
  const row = rows.find(t => t.includes('0 raised'))
  assert.ok(row && row.includes('not proven · 4 unproven · 0 unread · 4 uncited'), rows.join('\n'))
  cross(s, errBash('interlock review proof --review .claude/ship/settle/review-r0.json', 1, 're-run: language\n  language: unproven'), 110)
  const proof = groupRows(s, 'review').find(t => t.includes('proof re-run'))
  assert.ok(proof && proof.endsWith('proof re-run: language · exit 1'), groupRows(s, 'review').join('\n'))
})

test('draft: a --draft line is a draft row, not the round\'s record', () => {
  const s = live()
  const record = { counts: { raised: 1, dismissed: 0, surviving: 1 }, dimensions: { ran: ['language'] }, proof: { proven: true } }
  run(s, 'interlock review --findings f --verdicts v --draft --out .claude/ship/settle/review-r0.json.draft.json --json', JSON.stringify(record), 100)
  const row = groupRows(s, 'review').find(t => t.includes('draft ·'))
  assert.ok(row && row.includes('proven'), groupRows(s, 'review').join('\n'))
  assert.equal(s.reviews.size, 0, 'a draft names no round record')
})
