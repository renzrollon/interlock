## Context

Five subagent spawns sit on the paths `/interlock:spec` and `/interlock:settle` run, and none names a model or an effort: explore's investigators (`skills/explore/SKILL.md:89`, reached from spec §1b), review-code's dimension reviewers and skeptics (`skills/review-code/SKILL.md:50`, `:96`, reached from settle §5a and §5c), and settle's fixer and conformance worker (`skills/settle/SKILL.md:226`, `:357`). Spec spawns nothing itself (no Agent tool in its `allowed-tools`), and review-artifacts runs both of its reviewers inline. On this host the per-call defaults are: a `general-purpose` agent runs on the main conversation's model; the built-in `Explore` agent runs on the main conversation's model, except that a Fable session's Explore runs on `opus` over a subscription, Console or `ANTHROPIC_BASE_URL` gateway; an agent with no `effort` runs at the session's level.

Ship already solved this for its own spawns. `EFFORT.byTier`, `EFFORT.verify` and `EFFORT.skeptic` in `lib/limits.mjs:465-469` are published by `interlock limits`, read by `lib/run.mjs` when it emits a step, forwarded by the drivers, and bannered when `CLAUDE_CODE_EFFORT_LEVEL` or `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` makes them not in effect (`lib/run.mjs:2764-2784`, `workflows/ship.js:558-561`). `EFFORT.skeptic` is read only there (`lib/run.mjs:1980`, `:2018`, `:2055`): the same skeptic, spawned by the review-code skill under settle, runs at whatever the session has.

Constraints this design works under:

- Thresholds live in the CLI, not in prose (`.claude/CLAUDE.md`, `docs/06-why-it-works.md:80`). A model slug or an effort level in a skill is a threshold.
- Zero runtime dependencies; stdlib Node only.
- `bin/interlock` is 242,819 bytes against the plugin directory's 256 KiB per-file limit, so new logic goes in `lib/`.
- Guards fail open, and degradation is spoken: a spawn site that cannot learn its routing says so and spawns anyway.
- The Agent tool's own rule sets `effort` only when a skill or CLAUDE.md explicitly asks; a skill instruction is that ask. A per-call `effort` is applied by Claude Code 2.1.292 and later (installed: 2.1.310). `CLAUDE_CODE_EFFORT_LEVEL` outranks it; `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` makes the host ignore a per-call `model`.
- A prose instruction nobody asserts silently stops running: every new instruction is pinned by token in `test/skills.test.mjs`.

## Goals / Non-Goals

**Goals:**
- Every prose spawn site spec and settle reach passes a `model` and an `effort` read from one published table, and never a literal.
- The skeptic runs at one published effort whichever path spawns it.
- An environment override that makes the routing not in effect is said at the spawn site, in the words ship already uses.
- A site that cannot learn its routing says `ROUTING UNAVAILABLE` and spawns at the session defaults rather than stopping.
- The host's per-call effort floor is reported where the other subagent-routing host facts are: `interlock doctor`.

**Non-Goals:**
- Ship's run program, `lib/waves.mjs`, `lib/lane.mjs`, the classifier and the plan's tier routing. The owner judged plan-waves fine (D4).
- `review-artifacts`, which spawns nothing.
- The spec meter's investigator line in `hooks/mod.mjs` (D10).
- Routing for hosts other than Claude Code: these skills run only where the Agent tool exists.
- Tuning the values after this change lands: each is one line in `lib/limits.mjs`.

## Decisions

### D1 — The initial table values are the owner's call; the code ships with these (needs_human)

| role | spawned by | model | effort |
|---|---|---|---|
| `explore-investigator` | explore §Investigator rules, reached from spec §1b | `sonnet` | `medium` |
| `review-dimension` | review-code §2 | `sonnet` | `medium` |
| `review-skeptic` | review-code §3 | `null` (inherit) | `EFFORT.skeptic` |
| `settle-fixer` | settle §5c | `null` (inherit) | `EFFORT.skeptic` |
| `settle-conformance` | settle §5e | `sonnet` | `null` (inherit) |

Why these: an investigator locates and cites and returns JSON, and the synthesis stays in the session, so it is tier-2 work in ship's own terms; a dimension reviewer reads a diff against a written rubric and every blocker and warning it raises is then checked by two skeptics; the skeptic and the fixer mirror ship's `review` and `remediate` steps (`lib/run.mjs:1975-1980`, `:2015-2018`: model inherited, effort `EFFORT.skeptic`); the conformance worker is ship's handoff spawn (`lib/run.mjs:4095-4099`) with a cheaper model, since it writes prose answers from a diff. The one thing the repo cannot decide is whether a Sonnet dimension reviewer is an acceptable trade for the session-model one it replaces: the skeptics verify what is raised, not what is missed. That is the question in the ledger.

### D2 — A table in code, published by `interlock limits`, read through `interlock routing <role>`

Alternatives: (A) write `model: sonnet, effort: low` into each skill — rejected, it restates a threshold in prose, drifts across five files and cannot banner an override; (C) set `model`/`effort` in agent-definition frontmatter and spawn those types — rejected, explore needs the built-in `Explore` tool set, a per-call parameter outranks frontmatter anyway, and a definition cannot speak `CLAUDE_CODE_EFFORT_LEVEL`; (D) rely on `CLAUDE_CODE_SUBAGENT_MODEL` — rejected, it is the operator's environment, it does not touch the built-in Explore and Plan agents, and it says nothing about effort.

`SPAWN_ROUTING` is its own export in `lib/limits.mjs`, beside `EFFORT`, for the reason `EFFORT` is: the `LIMITS` invariant asserts positive integers and this is a table. `formatLimits` prints one `routing: <role>` row per role (`inherit` for a `null`, as the effort rows do), and `limits --json` emits the table under `routing`.

### D3 — The resolver is `lib/routing.mjs`; the `bin/interlock` case is a few lines

`resolveRouting(role, env)` returns `{ role, model, effort, banners, overrides }` or throws a typed error naming the known roles. `listRouting(env)` returns every role resolved. The binary parses `routing [role] [--json]`, calls one of the two, and emits. Nothing else, because of the file-size cap. The module imports only `lib/limits.mjs`, `lib/host/claude-env.mjs` and `lib/host/effort.mjs`.

### D4 — Ship's spawns are untouched

Human decision, 2026-10-26: "ship's plan waves are fine currently. only spec and settle." The living `effort-routing` spec names four run-program spawns as the inheriting set and the implementer, verify, review and remediation steps as the published-effort set; neither set changes.

### D5 — `null` means omit the parameter

The same meaning `EFFORT.byTier` gives it (`lib/limits.mjs:457-462`): the host's default applies, which for a model is the subagent model order Claude Code documents (per-call, then frontmatter, then `CLAUDE_CODE_SUBAGENT_MODEL`, then the main conversation's model) and for an effort is the session level. JSON prints `null`; text prints `inherit`. A skill told "a `null` means omit that parameter" has no second interpretation.

### D6 — `review-skeptic` and `settle-fixer` read `EFFORT.skeptic` by reference

Not a second constant with the same value: a later change to the skeptic effort must move both paths at once, or the inconsistency this change removes comes back. The table test asserts the identity.

### D7 — Override detection and the banner words are ship's

`effortLevelOverride(env)` (`lib/host/effort.mjs:50`) and `observeClaudeEnv(env)` (`lib/host/claude-env.mjs:130`) already read the two variables. `banners` carries `EFFORT ROUTING OVERRIDDEN: CLAUDE_CODE_EFFORT_LEVEL=<v> — every agent runs at that effort, so the effort this prints is not in effect` and `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL_FORCE=<v> — every agent runs on one model, so the model this prints is not in effect`. `CLAUDE_CODE_SUBAGENT_MODEL` alone raises no banner here: on 2.1.251 and later it is only a default below a per-call parameter, and whether this host is older is a version fact `interlock doctor` already reports (`lib/doctor.mjs:1203-1230`). `routing` runs no subprocess (D12) and so does not know the version.

### D8 — Fail open, spoken

An unknown role exits non-zero with `interlock: unknown routing role "<role>" — roles: <list>` on stderr and nothing on stdout, so a skill never reads a default as a decision. At the spawn site, any non-zero exit becomes one printed line, `ROUTING UNAVAILABLE: <first line of the command's output>`, and the spawn proceeds at the session defaults. Routing is guidance about cost, never a gate: a review that did not run because a cost hint failed would be the wrong trade.

### D9 — Explore's `allowed-tools` gains `Bash(interlock *)`

It pre-approves `interlock-graph` and `openspec` today (`skills/explore/SKILL.md:7`); without this line the routing call would stall an autonomous explore on an approval dialog under a restrictive user profile, which is the failure `test/skills.test.mjs:651` exists to prevent for the Agent tool.

### D10 — The spec meter stays as it is

`hooks/mod.mjs:699-702` already reads an investigator spawn's served model. Rendering it on the explore line is the natural follow-up and is left out so this change stays in the skills and the CLI.

### D11 — A new flat capability, `spawn-routing`

The `effort-routing` requirements are about the run program's steps and drivers (`openspec/specs/effort-routing/spec.md:191` lists the four inheriting spawns by name); none of its requirement text changes, so a MODIFIED block would carry nothing. A flat `specs/spawn-routing/spec.md` is also what the installed `openspec validate` parses.

### D12 — The per-call effort floor is reported by `interlock doctor`, not by `routing`

`PER_CALL_EFFORT_MIN_VERSION = '2.1.292'` joins `SUBAGENT_MODEL_DEFAULT_ONLY_MIN_VERSION` and `SUBAGENT_MODEL_FORCE_MIN_VERSION` in `lib/host/claude-env.mjs:39-40`. The doctor already probes the version and prints the two subagent-model lines; it gains one more: applied on this host, or ignored below the floor, or cannot establish. `routing` is called once per role from inside a skill and must stay a pure lookup: no `claude --version` per call.

### The command

```text
interlock routing <role> [--json]     resolve one role
interlock routing [--json]            print the whole table
```

JSON for one role:

```json
{ "role": "explore-investigator", "model": "sonnet", "effort": "medium",
  "banners": [],
  "overrides": { "effortLevel": null, "subagentModelForce": null } }
```

Text for one role: `routing explore-investigator: model sonnet · effort medium`, followed by each banner on its own line. Exit 0 whenever the role resolved, banners or not.

### What each spawn site says

The same five sentences at each site, in the skill's own voice, with the role filled in: run `interlock routing <role> --json` once, before the first spawn of that role; pass its `model` and `effort` on every Agent call of that role, and a `null` means omit that parameter; print every line of `banners` verbatim; when the command exits non-zero, print `ROUTING UNAVAILABLE: <first line>` and spawn at the session defaults; never name a model or a level in the skill. `test/skills.test.mjs` pins, per site, the role's `interlock routing` line, `ROUTING UNAVAILABLE`, `banners` and the `null`/omit sentence, and asserts that none of the five skill files spells a `model:` slug or an `effort:` level as a spawn parameter. The settle edits keep every token already pinned at `test/skills.test.mjs:1722-1736` and `:1786-1797`; the review-code edit keeps `Spawn one agent per dimension` and the dimension table.

## Risks / Trade-offs

- [A Sonnet dimension reviewer misses what a frontier reviewer would catch] → the values are the human decision in D1, and each is one line in `lib/limits.mjs`; the two skeptics stay at the published `xhigh`.
- [The host is older than 2.1.292 and ignores the per-call `effort`] → `interlock doctor` says so (D12); the model half of the routing still applies.
- [`CLAUDE_CODE_EFFORT_LEVEL` or `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set] → the banner is the mitigation, as in ship; the variables are the operator's and are never unset.
- [A skill is reworded and the routing sentence is lost] → pinned by token per site; the test names the skill.
- [`bin/interlock` grows past the plugin's 256 KiB file limit] → the case is a few lines; the logic is in `lib/routing.mjs` (D3); the size is checked in the change's verification.
- [Review-code is also run standalone and in ship's `--strict` tail] → the skill change routes the standalone and settle paths; ship's `review` step keeps its own routing, and both read `EFFORT.skeptic` (D6).
