# Design

## Context

Interlock pins `@fission-ai/openspec` 1.15.0 in the generated `lib/openspec-pin.mjs` and provisions it with `npm ci --ignore-scripts`. A user's own `openspec` on PATH is used first, at any version from `OPENSPEC_MIN_VERSION` up, and nothing caps it from above. Four releases followed 1.15.0: 1.16.0 (2026-10-30), 1.16.1 (2026-11-07), 1.17.0 (2026-11-09) and 2.0.0 (2026-11-11).

**What upstream changed.** Sources: the release notes at `github.com/Fission-AI/OpenSpec/releases/tag/v1.16.0`, `v1.16.1`, `v1.17.0` and `v2.0.0`, `CHANGELOG.md` and `docs-lab/help/upgrade-to-2.md` at tag `v2.0.0`, and the published npm tarballs.

| Release | Change | Reaches Interlock? |
|---|---|---|
| 1.16.0 | npm installs need Node.js 22.12.0 or newer (#2159) | Yes. The pin's Node floor, the doctor, three skills, the docs, the design prompts |
| 1.16.0 | Install script on openspec.dev; release files are `.tar.gz` and `.zip` (#2160) | No. Provisioning uses the npm lockfile; a standalone binary on PATH is already handled |
| 1.16.0 | A scenario with no WHEN or THEN step warns, and fails `validate --strict` (#2079) | No. Interlock runs plain `validate` (D6) |
| 1.16.0 | `validate` exits 1 on an unreadable or invalid `openspec/config.yaml` (#2127) | Only as a clearer failure. Measured: exit 0 at 1.15.0, 1 at 2.0.0 |
| 1.16.0 | An unspaced `###Requirement:` is reported; inline triple-backtick fences are read (#2133, #2131) | No |
| 1.16.1 | A section heading with a closing `#` run reads like an unclosed one (#2205) | Follow-up. `lib/spec-text.mjs` does not strip a closing run |
| 1.16.1 | An unrecognised delta section fails `validate` and `archive` (#2207) | No. Measured: a `## DEPRECATED Requirements` block moved from a warning to an error |
| 1.16.1 | `version --check` runs with telemetry off (#2204) | No. Interlock never runs it |
| 1.17.0 | `openspec update` upgrades a project from any release since 0.12 and removes unedited generated files (#2213) | Owner's step, never a skill's |
| 2.0.0 | Stock skills are written to `.agents/skills/` and linked from `.claude/skills/` (#2223) | Docs, `.gitignore` |
| 2.0.0 | `/opsx:*` command files are gone; `/opsx:propose` is `/openspec-propose` | Docs |
| 2.0.0 | The `delivery` setting is accepted and ignored; Amazon Q left `--tools` | No |
| 2.0.0 | `instructions apply` joins a task's wrapped lines (#2228) | Follow-up. The task counter did not change |

**What was measured.** The 1.15.0, 1.17.0 and 2.0.0 tarballs were installed into scratch directories with install scripts off, and compared.

- `scripts/openspec-contract.mjs` against 2.0.0: `passed 29 checks`, as against 1.15.0.
- Twenty-two CLI calls return the same exit codes on all three. The keys of `status --json`, `instructions --json`, `list --json` and `validate --specs --json` are the same. The one text difference in what the skills read is an added bullet in `instructions specs`.
- `archive -y` of this repository's three unarchived changes writes byte-identical `openspec/` trees on 1.15.0 and 2.0.0. `validate --all --json` gives 93 of 94 passing on all three, the same change failing, 350 warnings.
- OpenSpec's task counter (`dist/utils/task-progress.js`) is the same pattern in 1.15.0 and 2.0.0, and equals `TASK_LINE` in `lib/artifacts.mjs`. On a `tasks.md` mixing markers, an odd box, a link bullet and an empty task, `list --json` and `parseTasks` both count 5 tasks, 1 done.
- `engines.node` is `>=20.19.0` in 1.15.0 and `>=22.12.0` in 1.17.0 and 2.0.0. 2.0.0 still runs `--version`, `status` and `validate` on Node 18.20.8 and 20.20.2: `npm install` warns `EBADENGINE` and exits 0, and the launcher has no engine guard.
- The 2.0.0 lockfile has 57 packages, no install script, sha512 everywhere and only `registry.npmjs.org` sources, so it passes `checkPin`.
- `init --tools claude` at 2.0.0 exits 0 and writes `openspec/config.yaml`, `.agents/skills/openspec-*/` and one link per skill under `.claude/skills/`. It writes no `.claude/commands/`.
- `update --dry-run --json` at 2.0.0 on a copy of this repository lists 20 removals, all of files git already ignores, and 11 additions under `.agents/skills/` and `.claude/skills/`. It lists no failure and no change to `.github/workflows/copilot-setup-steps.yml`.

**Constraints.** Zero runtime dependencies. `lib/openspec-pin.mjs` is generated and never edited by hand. Thresholds live in code, never in a skill. A degraded path is spoken. Skills are a shipped surface, so a reworded line is a behaviour change with a test.

## Goals / Non-Goals

**Goals:**

- Provision OpenSpec 2.0.0, with the Node floor that release declares.
- Leave one place that knows OpenSpec's Node floor: the pin for the provisioned copy, the CLI's own package for a copy on PATH.
- Make the next pin regeneration edit no floor literal in code, skills, the living spec or the tests.
- Measure, at each pin bump, the three commands the skills run that the contract script skipped, and task-count agreement.
- Make the docs describe what 2.0.0 installs.

**Non-Goals:**

- Running `openspec update` in this repository, or in a user's. That is the owner's step.
- Reading a wrapped task's continuation lines, or a heading's closing `#` run (follow-ups, D7).
- `validate --strict` (D6).
- Regenerating the `site/` export (D8). The design prompts it is built from are corrected here.
- Any change to `OPENSPEC_MIN_VERSION` (D3) or to the stock workflow file OpenSpec generated (D11).
- Fixing `skills/explain-code/SKILL.md`'s bare `openspec status --json`, which exits 1 on 1.15.0 and 2.0.0 alike when a change is active.

## Decisions

### D1 — Pin exactly 2.0.0

The request names it. The pin is one exact version with a full lockfile; `node scripts/pin-openspec.mjs 2.0.0` regenerates it. No range, no `latest`.

### D2 — The provisioning floor follows the pin: 22.12.0

The pin's `node` is read from the release's `engines.node` by the pin script, and `interlock openspec provision` already refuses a Node below it before any network request (`openspec/specs/openspec-cli/spec.md`, "a Node below the floor makes no request"). So after the regeneration, provisioning refuses Node 20.19 to 22.11, although 2.0.0 was measured running there. Interlock does not second-guess the floor a release declares: upstream calls Node 22.12.0 a requirement and says Node 20 is past its end of life. A user on an older Node keeps their own `openspec` on PATH. This is the one item the changelog marks **BREAKING**.

Alternative considered: provision anyway and warn. Rejected, because it installs a tree its own publisher says is unsupported, and the existing requirement says to refuse.

### D3 — `OPENSPEC_MIN_VERSION` stays 1.8.0

The floor is the oldest CLI the skills can rely on, not the newest one known. It is a CLI-version floor and is the only floor the `openspec` row checks; the Node floor of D2 and D4 is the `node` row's alone, so a standalone binary on PATH is held to `OPENSPEC_MIN_VERSION` and to no Node floor. Nothing the skills read was added after 1.8.0, and the previous pin bump decided the same (`openspec/changes/archive/2026-10-28-agree-with-openspec-1-15/decisions.md`, D1).

### D4 — A PATH script is held to the floor its own package declares

After the regeneration the doctor's `node` row would tell a user running their own 1.15.0 on Node 20.19 that their CLI needs 22.12.0, which is false. So for a script on PATH the doctor reads the minimum from that CLI's package manifest. When it finds no manifest, or the manifest's `engines.node` is not a single `>=x.y.z`, it uses the pin's floor and the row says that CLI's own floor could not be read (the delta scenarios' words, which the code and the tests share). The fallback keeps today's behaviour for a Node far below any floor, and it is spoken.

The lookup is small: from the script's realpath, the nearest `package.json` within four directory levels whose `name` is the pin's package (one of another name is skipped and the walk goes on); for a Windows shim, `node_modules/<package>/package.json` beside the shim. A read or parse error is the fallback, never a thrown error. A shim that execs a file elsewhere (pnpm, volta) is not followed and takes the fallback.

Alternative considered: hold every CLI to the pin's floor. Rejected for the false warning above. Alternative considered: say nothing when the floor cannot be read. Rejected, because a Node 18 user would lose a warning they get today.

### D5 — Skills name no Node floor

`skills/spec/SKILL.md`, `skills/bootstrap/SKILL.md` and `skills/dispatch/SKILL.md` spell `20.19.0` in the installed-but-does-not-run case. They drop the number and keep the cause ("a Node.js older than that OpenSpec supports"), and each names `interlock doctor`, whose `node` row holds the number. Dispatch does not name `interlock doctor` today; it gains it. `test/skills.test.mjs` pins tokens: no three-part Node.js version in any skill file, and `does not run` with `interlock doctor` in those three.

### D6 — No `validate --strict`

At 2.0.0 this repository's specs draw 350 warnings, and `--strict` turns each into a failure. Adopting it is its own change, with a cleanup first.

### D7 — Wrapped task text and closing-`#` headings are follow-ups

2.0.0's `instructions apply` joins a task's wrapped lines; `parseTasks` in `lib/artifacts.mjs` reads the first line only. The count is unaffected, which is what the planner and the drift check use. Reading the continuation changes a value the classifier, the tick and the fingerprint all consume, so it needs its own invariant sweep. The same holds for the heading patterns in `lib/spec-text.mjs`.

### D8 — The design prompts are corrected now; the `site/` export waits for the release

`site/` is a generated export regenerated per release, and `site/README.md` says a stale claim is fixed in the design prompt first. After this change provisioning refuses a Node below 22.12.0, so the prompts' `20.19.0` is wrong the day it merges, and a release that regenerated the page from them would publish it. So the prompts are retyped here, by token: `site/DESIGN-PROMPT.md` (the sample `node` row, `OpenSpec requires 20.19.0+`, and the Node-floor table row, `the OpenSpec CLI needs 20.19.0 or newer`) and `docs/assets/DESIGN-PROMPT.md` (its sample `node` row). D18's check reads both, so a later pin that leaves them stale fails the suite. The export itself (`site/Limits.dc.html`, `site/FirstHour.dc.html`) and its `@latest` install line are corrected when the page is regenerated from the corrected prompt at the next release; the export is never hand-edited.

Alternative considered: leave the prompts for the release too. Rejected: the only tracking was an unticked follow-up, and nothing failed if a release regenerated the page from the stale prompt.

### D9 — `.agents/` joins `.gitignore`

`.gitignore` already ignores `.claude/commands/`, `.claude/skills/`, `.cursor/` and the `.github/` directories OpenSpec generates. `.agents/` is the directory 2.0.0 adds. Ignoring it now means an owner who runs `openspec update` commits nothing by accident.

### D10 — Bootstrap keeps `openspec init --tools claude`

At 2.0.0 the command exits 0 and gives Claude Code the same five stock skills, by link: `.agents/skills/openspec-{propose,apply-change,archive-change,explore,sync-specs}/SKILL.md`, one link per skill under `.claude/skills/`, and no `.claude/commands/`. The contract script now runs it and checks that layout, not only the exit and `openspec/config.yaml` (D13), so a later pin that drops `.agents/skills/` or the links, or writes command files again, is named at the pin bump instead of reaching the docs D17 rewrites.

### D11 — The generated workflow file is left alone

`.github/workflows/copilot-setup-steps.yml` is OpenSpec's own output and 2.0.0's `update --dry-run` proposes no change to it.

### D12 — The doctor stops saying the CLI fails below its floor

The `node` row's fix says the resolved OpenSpec "fails on this Node". Measured, 2.0.0 runs its read commands on Node 18 and 20. The row now says the CLI declares that minimum and is not supported below it. The status stays `warn`.

### D13 — The contract script covers what it skipped

It gains four checks, in the order the commands make sense in the scratch project:

- `list --json` before the archive: a `changes` array holding the probe change with numeric `completedTasks` and `totalTasks`. Dispatch and explore read this.
- Task-count agreement: those two numbers equal what `parseTasks` counts in the same `tasks.md`. The scratch `tasks.md` is widened to hold every shape the task-reader requirement lists, a wrapped task and a link bullet. A difference is named `list.totalTasks` or `list.completedTasks`.
- `validate --specs` after the archive exits 0. Bootstrap runs this.
- `init --tools claude` in a second scratch directory exits 0 and leaves `openspec/config.yaml` (a failure is named `init --tools claude`), then the layout D10 records: the five skills' `SKILL.md` under `.agents/skills/` (`init.agentsSkills`), each of the five under `.claude/skills/` with a realpath inside `.agents/skills/` (`init.claudeSkills`; a realpath, so a copy fails and a Windows junction passes), and no `.claude/commands/` (`init.commands`). Bootstrap runs this.

The stub CLI in `test/spine/openspec-cli.test.mjs` answers the new commands, and the unit suite still never starts a real OpenSpec. With this in place the task-reader requirement can say "the pinned OpenSpec release" in place of a version number, because agreement is measured at every bump.

### D14 — The spec and the tests name the pin's floor, never a number

The living spec's doctor scenarios spell `20.19.0`, and `test/spine/doctor.test.mjs` asserts that literal against a string built from the pin. The delta rewrites them as "the pin's Node floor", and the tests read `OPENSPEC_PIN.node`. Fixture floors (a package that declares `>=20.19.0`, a pin "whose floor is `20.19.0`") stay literal, because they describe the fixture.

Two consequences shape the tasks. The doctor change and the pin regeneration share a wave, because the regenerated pin alone turns those literal assertions red. And the suites' default Node (`v22.11.0` in `test/spine/doctor.test.mjs` and `NODE_OK` in `test/spine/openspec-cli.test.mjs`) sits below 22.12.0, so each is derived from the pin.

### D15 — One reader of `engines.node`, in a module with no pin import

`nodeFloorOf` lives in `scripts/pin-openspec.mjs`, and `scripts/` is not shipped. The doctor needs the same reading. A new `lib/openspec-node-floor.mjs` holds `nodeFloorOf(range)` and the manifest lookup of D4, importing only `node:fs` and `node:path`. The pin script imports `nodeFloorOf` from it. It must not sit in `lib/openspec-cli.mjs`: that module imports the pin statically, and the pin script has to run when the pin file is missing or broken.

### D16 — The `openspec` row's does-not-run fix points at the `node` row

That fix spells "OpenSpec needs Node.js 20.19.0 or newer". It keeps "run `openspec --version` and read its error" and "check `node --version` in the shell the agent uses", drops the number, and names the `node` row, which already knows which floor applies to the resolved CLI.

### D17 — Docs use 2.0.0's names, and two files are edited by token

`/opsx:propose`, `/opsx:apply`, `/opsx:archive`, `/opsx:explore` and `/opsx:sync` become `/openspec-propose`, `/openspec-apply-change`, `/openspec-archive-change`, `/openspec-explore` and `/openspec-sync-specs`, the skill names 2.0.0's `init` writes. `.claude/commands/opsx/` leaves the docs; `.agents/skills/` enters them, with one sentence saying a project made by an older OpenSpec keeps the old files until its owner runs `openspec update`. `README.md` and `docs/10-agentic-workflow-ship-and-spec.md` carry uncommitted edits of the owner's, so tasks name the tokens to replace in them, never line numbers, and touch nothing else there.

### D18 — A test holds the docs' and the design prompts' Node floor to the pin

`test/spine/package.test.mjs` already holds the README's and the first-hour guide's install line to the constant the CLI prints. A sibling check reads every two- or three-part Node.js version in `README.md`, `docs/01-first-hour.md` and `docs/07-cli-and-configuration.md` and fails on one that is not the pin's floor. The plugin's own one-part floor (`≥ 18`) is not matched. `CHANGELOG.md` is history and is not read.

The design prompts (D8) cannot use that rule: their sample `node` row names the running Node (`Node v26.8.1`) beside the word, and they name many Claude Code versions as `X+` or `X or newer`. So over `site/DESIGN-PROMPT.md` and `docs/assets/DESIGN-PROMPT.md` the check reads only a three-part version that follows `OpenSpec requires` or `OpenSpec CLI needs`, requires each to be the pin's floor, and requires each prompt to hold at least one, so a reword that drops the anchor fails instead of passing empty.

### D19 — The floor stays the OpenSpec package's own

Seventeen `@inquirer/*` packages in the 2.0.0 lockfile declare `^22.22.2 || ^24.15.0 || >=26.0.0`, tighter than OpenSpec's `>=22.12.0`. The committed 1.15.0 pin has the same kind of gap. npm warns and installs, and provisioning already quotes npm's last error line when an install fails. The pin keeps one floor, the one the pinned package declares.

## Risks / Trade-offs

- **Users on Node 20.19 to 22.11 lose provisioning** → the changelog entry leads with it; the refusal names the Node found, the floor and the user's own install route; the doctor's `openspec` row leads with the same floor.
- **The pin regeneration needs the npm registry** → the task says so and names the one run outside the sandbox. If the registry is refused, the wave stops with npm's own line; nothing is written by hand.
- **D4's lookup misses a layout** (a pnpm or volta shim) → the fallback applies, the row says the floor is the pin's and why. A false `warn`, never a false `ok` on a Node below both floors.
- **A user's own 2.0.0 on Node 20 draws a warning for a CLI that works** → the row says "declares" and "not supported", which is what upstream says (D12).
- **`init --tools claude` in the contract script writes stock skills into a scratch directory** → it is a second scratch directory under the system temp directory, removed with the first.
- **The docs check reads prose with a pattern** → it matches only a version beside the word `Node`, and the test carries a stale case, a clean case and the one-part case.
- **`npm run scan-pack` and the plugin validation read the regenerated pin** → the lockfile's shape is unchanged (same checks pass on a fresh resolve); both run before the change is reported done.

## Open Questions

None blocks the change. Two belong to the owner after it ships: whether to run `openspec update` in this repository (it removes 20 ignored files and adds 11), and whether the site should name the pinned install line in place of `@latest` at the next release.
