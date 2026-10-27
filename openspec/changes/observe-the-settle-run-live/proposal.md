## Why

The settle loop (`/interlock:settle --review`) now runs end to end on real pull requests — on 2026-10-26 a pass on PR #25 took 26 minutes, two of its agents held the clock for 15 of them, and the person watching saw only a transcript. The hooks module already draws a ship run (`/interlock-meter`) and a spec run (`/interlock-spec`) from what crosses it; nothing draws a settle pass, so its grouping (review dimensions, skeptics, fixer rounds, conformance, verify, checks, merge confidence, publish), its timeline, and the model and effort each spawned agent actually ran with are invisible while they happen.

## What Changes

- A **settle meter** in the hooks module: a `/interlock-settle` pane and a third branch of the module's one status line, live from an interactive load of `interlock:settle` whose arguments carry `--review`, drawn from the lines the settle and review-code skills already run, from the engine's own spawn and turn events, and from the clock. It decides nothing and repeats only the CLI's fields, the engine's fields, the settle skill's own section words and clock readings.
- A pure, Node-free rules module `lib/settle-meter.mjs`: the settle keyed lines (with pipe stages split, which the spec meter's reader does not do), a role matcher over the prompt's first line (the eight dimension briefs' headings, review-code's two skeptic opening sentences, the fixer's and the conformance worker's CLI-printed first lines), the per-agent tally (requested, resolved and served model; routed effort from the pass's `interlock routing` line labelled `routed`, the engine's per-step effort labelled `step`; requests, tokens, duration, the host's end reason), the grouped timeline, the status text and the pane lines.
- Spoken degradation: `routed: not seen` before a routing line, `unattributed` for a spawn matching no source, `result not seen` for a result the skill redirected to a file, the routing lines' banners repeated verbatim.
- Toasts for the loop's `STOP:` line, the merge-confidence verdict and score, a run agent's turn ending with a reason other than `answer`, and a pane the surface declined to place.
- Pins: the role sources are asserted against their files, the settle and review-code skills' fenced command lines are classified or allowed by name, the module's static pins (allowed calls, hooked events, one status composer, the `deny` and `complete` rules, the Node-free walk) extend to the new module, and a captured general-purpose spawn with `model` and `effort` parameters joins the kit fixtures with its provenance.
- Documentation: a `/interlock-settle` section in docs/07, the hooks-module row and a paragraph in docs/13, a sentence in docs/15's loop section, the README's watching line, the module's header paragraph, and a changelog entry under a new `## [Unreleased]` heading.
- No skill prose changes, no CLI changes, no new session-state key, no timer, no new dependency.

## Capabilities

### New Capabilities
- `hooks/settle-meter`: the settle meter — when it goes live and ends, that its words are the CLI's, the engine's, the skill's section words and the clock's, how each spawn is attributed and labelled, what the pane and status line show on both surfaces, and that the whole guarantee is observe-only and pinned statically.

### Modified Capabilities
- `hooks/spec-meter`: the requirement that the module owns one status line composes it in one place from the ship position, else the spec line; it gains the settle line as the third case.
- `hooks/ship-meter`: the requirement that the hooks module observes only and is pinned statically enumerates the module's hooks, panes and commands; it gains the `interlock-settle` pane and command and the settle meter's observers.

## Impact

- `hooks/mod.mjs` (new import, a settle record beside `run` and `spec`, the load observer, the Bash hook's settle branch, the spawn and turn hooks' settle gate, the third status branch, the boundary reset, one pane and one command, a header paragraph) and the new `lib/settle-meter.mjs`. Nothing in `bin/interlock`, which sits 173 bytes under the shipped-file size edge.
- Tests: new `test/spine/settle-meter.test.mjs` (pure rules, the role-source pin, the skill-lines pin, the purity pin) and `test/mod/settle-meter.test.ts` (the kit, run by `claude plugin test`); `test/spine/mod-pins.test.mjs` (the `SETTLE_PANE` constant pin, the `complete` rule extended to the new module, a fixture mirror); the registration enumerations in `test/mod/meter.test.ts`, `test/mod/session-start.test.ts` and `test/mod/spec-meter.test.ts`; `test/fixtures/mod/settle-run.mjs` and its JSON captures.
- Living specs `hooks/spec-meter` and `hooks/ship-meter` (one requirement each); `openspec/specs/hooks/settle-meter/spec.md` on archive. The role keys the meter reads (`roles.review-dimension`, `roles.review-skeptic`, `settle-fixer`, `settle-conformance`) are the living `spawn-routing` spec's contract; that spec and `review/review-depth`, `review/settle-loop` and `review/merge-confidence` are read, not modified.
- Docs 07, 13, 15, README, CHANGELOG. No runtime dependency, no CLI surface, no skill text, no `types/index.d.ts` change.
