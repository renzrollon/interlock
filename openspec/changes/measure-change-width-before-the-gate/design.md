# Design

## Context

See proposal.md for the motivation.

- `inspectChange` (`lib/artifacts.mjs:267`) already reads everything the width needs: it walks `specs/` into `specFiles` and parses `tasks.md` into `tasks.total`. `formatInspection` prints the text form; `bin/interlock`'s `validate` case (line 3313) emits the inspection as JSON or text and exits 1 when `ready` is false. The spec skill runs `interlock validate "<name>" --json` in §4 and reads `ready` and `problems`.
- `LIMITS` (`lib/limits.mjs:28`) is the iteration-count table: every entry is asserted a positive integer, printed by `formatLimits`, emitted whole under `limits`, and swept by `test/spine/limits.test.mjs:238` ("every cap the limits surface prints is read by the code path it governs"), which accepts `LIMITS.<cap>` in `lib/`, `bin/` and `workflows/` and refuses a test that pins the value as a reader.
- The spec meter (`lib/spec-meter.mjs:333`) reads the validate record's `ready` and `problems`, marks a record missing either as unparsed, and composes `validate READY` / `validate NOT READY (problems n)`; `hooks/spec-meter` forbids it comparing any count to a threshold.
- The archive holds 75 changes. Delta spec files per change: median 2, 90th percentile 6, 95th percentile 7.3; two changes above 8 (both 13). Checkbox tasks: median 14, 90th percentile 29, 95th percentile 41; five above 32. The change that did not converge on 2026-10-29 has 12 delta spec files and 20 tasks.
- `skills/spec/SKILL.md` §1b now reads "The width is a judgment made at the brief, not a count: the CLI publishes no cap for it", written on 2026-10-29 as the prose stand-in for this change.
- `bin/interlock` is 245,586 bytes against the plugin directory's 256 KiB file limit. Nothing here adds to it.

## Goals / Non-Goals

**Goals:**

- A width every reader can compute the same way, published on a line the spec skill and the spec meter already read.
- Caps in the CLI with one reader each, so no prose restates a number.
- A wide change stops before it spends a gate, with the split material (the delta specs' capabilities) in hand.

**Non-Goals:**

- A width check before the artifacts exist. The explore brief has no capability list (`shared/EXPLORE-BRIEF.md` carries findings, files and options), so nothing measurable exists before the delta specs are written (D4).
- A new CLI verb, a new spec-meter keyed line, or a width signal in `interlock ready`, the merge verdict or `openspec validate`.
- Any change to what `ready` means or to the validate exit code.
- Choosing the cap values: they are the owner's, with a recommendation (ledger D1).

## Decisions

**D1. The caps are `maxChangeCapabilities` and `maxChangeTasks`, in `LIMITS`, values recommended at 8 and 32, owner to confirm.** Both are counts, so they belong in the positive-integer table rather than a new group. The recommendation reads the archive: 8 capabilities sits at the 95th percentile and flags the 2026-10-29 change (12) while leaving 73 of 75 archived changes within it; 32 tasks sits between the 90th and 95th percentiles and flags five archived changes, every one of them a change later described as too wide. The 2026-10-29 change's 20 tasks would not be flagged, which is right: its width was its capability count. The two archived 13-capability changes shipped, so the signal is advisory (D5), not a refusal. Alternative rejected: a single combined score, which no reader could check against the artifacts by eye.

**D2. The width rides on `interlock validate`, not on a verb of its own.** The spec skill already runs the validate line and parses its JSON, the spec meter already keys it, the inventory smoke already runs it, and the inspection already holds both counts. A new verb would cost bytes in `bin/interlock`, a new keyed line in the spec meter with its order pin, a new skill line and a new inventory row, for a number the validate output can carry. The `validate` case in `bin/interlock` is unchanged: the width is computed inside `inspectChange` and printed by `formatInspection`.

**D3. Width never flips `ready` or the exit code.** `ready` is the implementability verdict (`spec/machine-readable-gate-lines`), and a wide change is implementable; conflating the two would make `--continue`, the inventory smoke and every consumer that branches on the exit code read a split recommendation as a broken change. `wide` is its own boolean, `over` names what exceeded, and the skill branches on the field.

**D4. The width is measured after the artifacts are written, in §4.** The only inputs are the delta spec files and the task list, which exist after §3. The cost of writing a wide change is spent either way; what the check saves is the gate, which is where the 2026-10-29 session's cost ran away, and it produces the split material, since each delta spec directory is a capability a brief can take. The §1b paragraph keeps its judgment for the person reading the brief and loses the sentence that the CLI publishes no cap.

**D5. A wide change runs no gate and stops at the checkpoint.** An artifact gate on a change that wide does not converge (the premise of the spec skill's one-gate rule), so spending one on a change about to be split is waste, and a gate skipped is spoken: the `CHANGE WIDE:` line is printed verbatim and the checkpoint report carries the proposed briefs. No autonomy line is written, because no gate ran; `interlock ready` finds no findings file and refuses `--continue`, which is the correct outcome. The owner may run `/interlock:review-artifacts <change>` by hand instead of splitting; the skill does not.

**D6. The spec meter reads `width.wide` and `width.over` as optional fields.** A validate record from an older CLI carries no `width`, and `hooks/spec-meter` says a record lacking a named field reads as unparsed, so the new fields are declared optional in the requirement: absent, the line reads as today; present, `WIDE (<over>)` is appended from the CLI's boolean and list. The module compares nothing: it never reads `width.capabilities` or `width.tasks` against a cap.

**D7. Capabilities are `spec.md` files under `specs/`, at any depth; tasks are the checkbox count `ready` already uses.** Delta specs nest (`specs/<domain>/<capability>/spec.md`), and `walkSpecs` already lists every markdown file; counting `spec.md` names rather than all markdown files keeps a stray note from counting as a capability. The task count is `tasks.total` from `parseTasks`, so width and readiness read one parse of one file.

**D8. The skill's split proposal is prose over the CLI's list.** The CLI prints the capability paths; grouping them into briefs is a judgment about cohesion the person reviews at the checkpoint. The skill names each brief's capabilities from that list and nothing else, and the suite pins the tokens (`CHANGE WIDE:`, `width.wide`, `epic of briefs`, `not reported by this CLI`).

## Risks / Trade-offs

- [The caps flag a change the owner wants whole] → the signal is advisory: `ready` holds, the gate is one command away by hand, and the values are the owner's to set (D1).
- [An older installed CLI reports no width] → the skill says `CHANGE WIDTH: not reported by this CLI` and gates as before; the spec meter reads the record as it does today.
- [Two active changes modify the `hooks/spec-meter` status-line requirement] → only this change does; `route-a-strict-artifact-reviewer` leaves the spec meter alone (its D5), and `prove-the-review-covered-the-diff` modifies the settle meter, not the spec meter.
- [Counting `spec.md` files undercounts a change whose deltas sit in oddly named files] → `openspec` itself requires `specs/<capability>/spec.md`, so a delta elsewhere is not a delta it would archive.
