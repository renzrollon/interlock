# Tasks: agree with OpenSpec 1.15

## 1. Failing tests first

- [x] 1.1 Write the failing suite for the four behaviours (design D1–D9). Make each test fail against the current code.
  - In `test/spine/artifacts.test.mjs`: `parseTasks` returns one open task per line for `-`, `*`, `+`, `1.`, `1)`, a nested `  - [ ]` and an empty `- [ ]`; `- [~]`, `- []` and `- [ x ]` parse with `[ x ]` done and the other two open; `- [A](./notes.md)` is no task; `inspectChange` on a tasks.md whose only open line is `- [~] 2.1 …` reports remaining 1; `tickTasks` on `+ [ ] 1.1 alpha`, `1. [~] 1.2 beta`, `- [ x ] 1.3 gamma` writes `+ [x] 1.1 alpha` and `1. [x] 1.2 beta` and reports 1.3 `already`; `normalizeTaskMarkers` rewrites every matched box to `[ ]` and keeps the rest of each line byte-identical.
  - In `test/hooks.test.mjs`, beside the existing guard-tasks tests: an implement-stage edit that flips `+ [ ] 1.1 do thing` to `+ [x] 1.1 do thing` is denied; a prose-only edit to a `1. [ ]` line is allowed.
  - In `test/spine/doctor.test.mjs`, following the `:547` pattern with its own `probeVersion`: the `openspec` row is `ok` at `OPENSPEC_MIN_VERSION`; it is `warn` for `1.4.0`, with a detail naming `1.4.0`, the constant and `nested`, and a fix including `OPENSPEC_INSTALL`; it is `warn` quoting the line for `openspec (dev build)`; with no `openspec/config.yaml` it is still the not-initialised warn whose fix names `openspec init`; `report.ok` stays true for the `1.4.0` case.
  - In `test/skills.test.mjs`: `skills/spec/SKILL.md` has a fenced `openspec validate "<name>"` and no fenced bare `openspec validate`; `skills/bootstrap/SKILL.md` has a fenced `openspec validate --specs`; `skills/spec/SKILL.md` carries the tokens `MODIFIED`, `scenario title` and `REMOVED`; `docs/01-first-hour.md` contains the value of `OPENSPEC_MIN_VERSION`.
  - In `test/spine/spec-meter.test.mjs`: change `UNREAD_BY_NAME` to `['openspec validate "<name>"', 'openspec --version']`.

## 2. Implement (make §1 green)

- [x] 2.1 In `lib/artifacts.mjs`, replace `TASK_LINE` with OpenSpec 1.15.0's task-line shape (design D5) and export it. Then make `parseTasks`, `tickTasks` and `normalizeTaskMarkers` read the box's span and marker from the match. Done means `x`/`X` only. `tickTasks` writes `[x]` over the matched span and still reports an `x`/`X` box as `already`; `normalizeTaskMarkers` writes `[ ]` over it (design D7). Update the comments above `TASK_LINE` and `normalizeTaskMarkers` to name the upstream source. Also update `bin/interlock`'s `tasks tick` help text, which says "Flips matching - [ ] to - [x]", to say it ticks the matched box.
- [x] 2.2 In `hooks/guard-tasks.mjs`, delete `CHECKBOX`. Build `checkboxStates` from `TASK_LINE` imported from `../lib/artifacts.mjs`, folding every non-`x`/`X` marker to open (design D6). This depends on 2.1's export. Keep the `const GUARD = 'guard-tasks'` line as it is, because `test/spine/mod-pins.test.mjs:496` reads it.
- [x] 2.3 In `lib/doctor.mjs`, add `export const OPENSPEC_MIN_VERSION = '1.8.0'` beside `OPENSPEC_INSTALL`. In `checkOpenSpec`, between the `!version` guard and the `!configured` guard, add two `warn` branches (design D2–D4):
  - `compareVersions(version, OPENSPEC_MIN_VERSION)` is `null`: the detail says the version could not be read and quotes the line.
  - It is `< 0`: the detail names the found version, the floor, and that nested `specs/<area>/<capability>/spec.md` deltas read "No deltas found" and archive without syncing below it. The fix is `OPENSPEC_INSTALL`.
- [x] 2.4 In `skills/spec/SKILL.md`:
  - Change §4's fenced line to `openspec validate "<name>"`.
  - Rewrite the §4 sentence so it says what the named validate checks: delta structure, and every MODIFIED block against its living spec (design D8).
  - Add one bullet to §3 "Gates while generating": a `## MODIFIED` requirement copies every `#### Scenario:` title, its scenario title verbatim from the living spec. To drop or rename one, use `## REMOVED` and add the requirement back under `## ADDED`, because archive refuses a MODIFIED block that omits a living scenario (design D9).
- [x] 2.5 In `skills/bootstrap/SKILL.md`, change §4's fenced line to `openspec validate --specs` and its report bullet to name the same command (design D8).
- [x] 2.6 Delete `openspec/specs/evals/spec-range/spec.md` and `openspec/specs/spec/checkpoint-advisor/spec.md`, with their now-empty directories. Replace the placeholder Purpose in `openspec/specs/distribution/npm-package/spec.md` with one written from that spec's own requirements (design D11). Done when every `openspec/specs/**/spec.md` holds at least one `### Requirement:` heading, and `distribution/npm-package`'s Purpose no longer starts with `TBD`.
- [x] 2.7 State the floor in the docs (design D4):
  - `docs/01-first-hour.md`: one sentence in the install section naming OpenSpec `1.8.0` as the minimum, and that `interlock doctor` warns below it. The number must match `OPENSPEC_MIN_VERSION`; §1's test reads it.
  - `docs/07-cli-and-configuration.md`: one clause in the `interlock doctor` row naming the OpenSpec version floor.
  - `CHANGELOG.md`: an `## [Unreleased]` section with `### Changed` entries for the task-line parity, the doctor floor, the named validate lines and the deleted retired specs. It carries no breaking entry.
