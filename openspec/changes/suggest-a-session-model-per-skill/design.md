# Design

## Context

See `proposal.md` for the motivation. What shapes the approach:

- **Thresholds live in the CLI.** No file under `skills/` may contain `opus` (`test/skills.test.mjs:1071-1074`), and four skills may not spell a model or level as a spawn parameter (`:2408-2417`). A suggestion has to be a published value a skill prints, never a sentence a skill carries.
- **The session's effort is observable; its model is not.** The host sets `CLAUDE_EFFORT` in Bash tool subprocesses to the live level. Observed in a Claude Code 2.1.322 session on 2026-11-10: `CLAUDE_EFFORT=high` after `/effort high`. Nothing comparable carries the model: `CLAUDE_CODE_SESSION_ID` and `CLAUDECODE` are set, no model variable is.
- **The checkpoint card has one renderer for two callers.** `lib/checkpoint-card.mjs` is drawn by `interlock checkpoint` and by the spec pane (`hooks/mod.mjs:1540`), and it is Node-free because the hooks module imports it.
- **`cli/interlock` is 240,630 bytes** and a pin fails at 245,760 (`test/spine/package.test.mjs:391-397`). The verb gets a case and a usage line there and nothing else.
- **The ship skill is a launcher.** Its `allowed-tools` is `Read` and its body is "call the Workflow tool once, then stop" (`skills/ship/SKILL.md:8`, `:42-44`).

The explore brief is `.claude/handoff/explore-model-and-effort-selection-20261110-194759.md`. Its rows D9 to D15 belong to Brief 2 and are not in this change's ledger.

## Goals / Non-Goals

**Goals:**

- One table says which model and effort suits each skill, and one module reads it.
- A person sees the suggestion where the next step is named: at a skill's start, on the checkpoint card, and in dispatch's answer.
- The suggestion says how the live session compares, and says plainly what it could not observe.

**Non-Goals:**

- Selecting a model or setting an effort. No `model` or `effort` skill frontmatter, no settings write, no `/model` or `/effort` run by the plugin (D2).
- Observing the session's model. It reads `not observed` (D3).
- New hooks-module code, a new engine call, or a new hook event (D4).
- Changing what any spawned agent runs at. That is Brief 2.
- A doctor row, and a price for `fable` in the price table.

## Decisions

### D1 — the table, and one reader

`lib/limits.mjs` gains two exports beside `SPAWN_ROUTING`:

```js
export const SESSION_ADVICE_BASIS = 'anthropic-model-guide-2026-11'

export const SESSION_ADVICE = Object.freeze({
  explore:            { model: 'opus', effort: 'high', best: { model: 'fable', effort: 'high' } },
  spec:               { model: 'opus', effort: 'high', upTo: 'xhigh', best: { model: 'fable', effort: 'high' } },
  'review-artifacts': { model: 'opus', effort: 'high', best: { model: 'fable', effort: 'high' } },
  bootstrap:          { model: 'opus', effort: 'high', best: { model: 'fable', effort: 'high' } },
  ship:               { model: 'opus', effort: 'medium' },
  settle:             { model: 'opus', effort: 'medium' },
  'review-code':      { model: 'opus', effort: 'medium' },
  'fix-tests':        { model: 'opus', effort: 'medium' }
})
```

Rows and nested pairs are frozen. The values are D6, which is the owner's to confirm; they are the owner's own examples (spec on opus at high or xhigh with fable for best results, ship on opus at medium) extended by the guide: architecture planning and leading many subagents start at high and suit the strongest model, everyday engineering and review start on opus at medium.

`lib/session-advice.mjs` is the only module that indexes the table, the way `lib/routing.mjs` is the only reader of `SPAWN_ROUTING`; the reader sweep in `test/spine/limits.test.mjs` gains the table. It imports `lib/limits.mjs` and `lib/host/effort.mjs`, both of which import nothing, so it stays Node-free. It exports:

- `ADVISED_SKILLS` — the table's keys, in order.
- `SESSION_MODELS` (`sonnet`, `opus`, `fable`) and `EFFORT_LEVELS` (`low`, `medium`, `high`, `xhigh`, `max`, in rising order) — the vocabulary the tests hold rows to.
- `adviceLine(skill)` — the suggestion line alone.
- `resolveAdvice(skill, env)` and `listAdvice(env)` — what the verb emits.
- `formatAdvice(out)` — the text form.
- `AdviceError` — thrown for a name with no row.

*Alternative rejected:* a row per shipped skill. A light skill such as `graph` or `report` gains nothing from a model switch, and the guide prices a switch at a prompt-cache rewrite. Eight rows are the skills where the session does the judgment or leads the spawns (D5).

### D3 — what is observed, and the four fits

`resolveAdvice` reads `env.CLAUDE_EFFORT` and trims it. A value in `EFFORT_LEVELS`, compared case-sensitively, is the observed effort; anything else, including unset, blank and `High`, is unobserved. The fit:

| Observed | Fit |
|---|---|
| not observed | `unobserved` |
| below the row's `effort` | `below` |
| from `effort` to `upTo` (or `effort` when there is no `upTo`) | `within` |
| above that | `above` |

The model is always `null` in the JSON and `not observed` in the text.

*Alternative rejected:* reading the session's starting model from the SessionStart hook input into the preflight report. It goes stale at the first `/model`, and a stale comparison is worse than a stated gap.

*Alternative rejected:* asking the model running the skill to pass its own model id. That is a model's self-report standing in for an observation.

### The words

For `interlock suggest spec` with `CLAUDE_EFFORT=low`:

```
session suggestion for spec: model opus · effort high, up to xhigh · best results: model fable · effort high
this session: effort low, below the suggestion · model not observed
to follow it: /effort high, and /model opus (or /model fable for best results) if this session is on neither; change models at a break in the work, because the first turn on a new model rewrites the prompt cache
```

- Line 1 is `adviceLine(skill)`. The `, up to <level>` and ` · best results: …` parts appear only when the row holds them.
- Line 2 reads `effort <level>, <below|within|above> the suggestion` or `effort not observed`.
- Line 3 is printed when the fit is `below`, `above` or `unobserved`, and not when it is `within`. For a row with no best-results pair it reads `/model <model> if this session is on another model`. The model is never observed, so a row with a pair names both models: a session already on the best-results model is not told to leave it.
- A banner follows when `effortLevelOverride(env)` (`lib/host/effort.mjs:41-56`) reports `CLAUDE_CODE_EFFORT_LEVEL`: `EFFORT SUGGESTION OVERRIDDEN: CLAUDE_CODE_EFFORT_LEVEL=<value> — /effort does not change this session's effort while it is set`.

No line holds a code span, so the pane's `printedCommands` (`lib/run-actions.mjs:35-58`) offers no control on any of them.

The JSON for one skill is `{ skill, model, effort, upTo, best, basis, observed: { effort, model }, fit, banners, lines }`, with `upTo` and `best` `null` when the row has none. With no skill it is `{ basis, skills: { <skill>: { model, effort, upTo, best } }, observed, banners, lines }`, where `lines` holds one `adviceLine` per skill, a nested `upTo` or `best` is `null` when that row has none, and `observed` is the same `{ effort, model }` object (`model` always `null`). It carries no `fit`. Its text form is those eight lines, then any banner. It prints no `this session` line and no follow line, because there is no single row to compare with.

### D8 and D18 — the verb

`interlock suggest [skill] [--json]`, a `case 'suggest'` in `cli/interlock` shaped like `case 'routing'` (`cli/interlock:3678-3690`): call `listAdvice` or `resolveAdvice` with `process.env`, catch `AdviceError`, write its message to stderr and exit 1, otherwise `emit`. `lib/cli-flags.mjs` gains `suggest: []`, since `--json` is a global flag (`lib/cli-flags.mjs:78-79`), and `scripts/postinstall-smoke.mjs` gains two `INVENTORY` rows, the table and a name with no row, as `routing` has (`scripts/postinstall-smoke.mjs:219-222`). Both are required by the inventory test, which reads every inline span in a skill that begins with `interlock` and holds it to a known, accepted and smoked command (`test/spine/cli-inventory.test.mjs:23-25`). A name with no row is an error and never a default, as an unknown routing role is (D18).

`interlock limits` prints a `session: <skill>` row per skill and one `session suggestion basis` row; `interlock limits --json` gains `sessionAdvice` (the table) and `sessionAdviceBasis`.

### D16 — the card reads the table itself

`checkpointCard` appends `{ key: 'checkpoint-session', text: adviceLine('ship') }` after the fifth outcome. The line is not a field a caller passes. The pane builds its fields from what the spec meter observed (`hooks/mod.mjs:1540`), so a passed field would need hooks-module code to compute a line the meter never saw, and a caller that forgot it would print `not observed` for a value that is published. Importing the reader makes the line identical for both callers by construction, and the delta to `spec/checkpoint-card` names it as the one line that is neither a passed field nor a title of the checkpoint document.

The card states nothing about the live session: the pane cannot observe an effort, and a card that differed between its two callers would break the requirement that it render the same for both.

### D4, D7, D17 and D19 — where skills print it

Seven skills gain one paragraph, the same in each but for the name:

> **Session suggestion.** Unless another Interlock skill invoked this one, run `interlock suggest <name>` once, now, and print every line it returns verbatim. If it exits non-zero, print `SESSION SUGGESTION UNAVAILABLE: <first line of its output>` and continue. It is advice and never a gate: do not change the model or the effort yourself, and do not wait for the person to.

- **Placement:** in `spec`, at the end of section 0; in `explore`, after "Two modes"; in `review-artifacts`, before "Depth"; in `bootstrap`, `settle`, `review-code` and `fix-tests`, before section 1.
- **Inline code, not a fenced line (D17).** The spec meter and the settle meter classify every fenced `interlock` line of the spec, review-artifacts, settle and review-code skills (`test/spine/spec-meter.test.mjs:783-791`, `test/spine/settle-meter.test.mjs:1690`). The provisioning command and the routing lines are inline for the same reason (`test/skills.test.mjs:656-665`). The meters key an `interlock` line by its verb, and a verb nobody keyed has no kind (`lib/settle-meter.mjs:288-293`), so the call draws no pane row and no meter code changes.
- **An invoked skill prints nothing (D7).** A spec run invokes explore and review-artifacts; three suggestions in one run would be noise, and the session cannot act on them mid-run.
- **`ship` gets none (D19).** The ship skill runs no command and its `allowed-tools` is `Read`. Its row reaches the person before the run starts, on the checkpoint card and in dispatch's answer, which is when a switch is possible.
- **Tool grants.** `bootstrap` and `fix-tests` have no `Bash(interlock *)` grant; each gains `Bash(interlock suggest *)` so the line does not raise an approval prompt.

`dispatch` adds `interlock suggest 2>/dev/null` to its pre-flight batch (`skills/dispatch/SKILL.md:20-27`) and one sentence: print the line for the routed skill when the answer holds one, print none when it does not, and print `SESSION SUGGESTION UNAVAILABLE` when the batch line printed nothing.

### D2 — advice, never selection

Skill frontmatter accepts `model` and `effort`, and a skill's value overrides the session for the turn. That would be the plugin choosing for the person, could not be bannered, and a model override would cost the cache rewrite the suggestion itself warns about. The advisor banners are the precedent for speaking about a session setting the plugin does not own (`lib/host/advisor-banners.mjs:1-22`).

## Risks / Trade-offs

- **The model is never observed** → the suggestion line always names the model and the follow line says "if this session is on another model". A person on the suggested model reads one line they did not need.
- **`CLAUDE_EFFORT` is unset on a model without effort, an older host, or a shell outside a session** → the fit is `unobserved` and the text says `effort not observed`; no level is assumed.
- **Guidance dates** → `SESSION_ADVICE_BASIS` is printed by `interlock limits` and carried in the JSON, so a table read from an older guide is visible. Updating the rows is one table edit.
- **A printed suggestion can be ignored** → by design. The verb exits 0 at any fit.
- **The spec pane's requirement lists the card's parts** (`openspec/specs/hooks/spec-meter/spec.md:255-263`) and does not name the new line. The pane draws every keyed line the card returns, so the line appears there; that requirement is left as written.
- **The hooks-module test for the pane's card runs under `claude plugin test`, not `npm test`** (`test/mod/interactive.test.ts:874-901`). It reads card lines by key and does not hold the key list, so the new key does not fail it; the task list still runs it.
- **The ship row gets no live comparison.** The card line and dispatch's line are the table's words alone, and the ship skill runs nothing, so no surface prints how the session compares with the `ship` row or what to type. Accepted for this change: the line names the model and the effort, and the person reads it at the one point a switch is cheap. A later change can have the spec hand-off run `interlock suggest ship` if the static line proves too quiet.
- **Other hosts** → `interlock checkpoint` and `interlock suggest` run under codex, qwen and ACP too, where the line names Claude model aliases and the follow line names two commands that host lacks. `CLAUDE_EFFORT` is unset there, so the answer also says `effort not observed`. Left as is: the skills that print the suggestion are Claude Code's.
- **The values are a cost policy** → D6 is the owner's to confirm.
