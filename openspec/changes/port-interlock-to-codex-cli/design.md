## Context

See [proposal.md](./proposal.md) — Why. Three facts about the current state shape everything below.

**The seam already exists.** `lib/host.mjs` defines the whole portability hole as three functions (`spawn`, `mapPipeline`, `runCli`) and its header comment already states the rule this change must not break: a host "does NOT decide wave order, it does NOT judge a verify result, it does NOT apply a cap or a review gate." `lib/host/acp.mjs` is the existing proof that a second implementation fits. This change adds a third; it does not add an abstraction.

**`workflows/ship.js` cannot import anything.** The Claude Code workflow runtime rejects a script containing `import()` before the run starts, which is why `workflows/ship.js` restates the four spawn-prefix literals that `lib/host.mjs` also defines, and why `test/spine/plugin-agents.test.mjs` exists to fail when they drift. Any constant this change introduces on the shared path acquires the same obligation: one definition, one drift test.

**The Codex flag surface is verified, not assumed.** Every flag named below was read out of `codex exec --help` on `codex-cli 0.145.0` installed on the development machine: `-c/--config key=value`, `-m/--model`, `-p/--profile`, `-s/--sandbox {read-only,workspace-write,danger-full-access}`, `-C/--cd`, `--add-dir`, `--skip-git-repo-check`, `--ephemeral`, `--ignore-user-config`, `--output-schema FILE`, `--json`, `-o/--output-last-message FILE`. The pinned minimum is higher than that (see Decision 8) because `--full-auto` was removed in `0.147.0` and pinning above the removal means no deprecated-flag path to document.

## Goals / Non-Goals

**Goals:**

- One resolution table per host, so the tier ladder's cost profile is readable in one place per host and testable without a model call.
- The Codex host is *strictly better instrumented* than the ACP host on the two axes where ACP is weakest: result-schema enforcement and approval-prompt immunity. If it is not, the third host is not worth its maintenance.
- A Codex operator can run the whole loop — spec, explore, review, ship, commit — not only the parts that happen to be host-agnostic already.
- The `model` rename lands as one atomic sweep. A half-renamed invariant is worse than either end state.

**Non-Goals:**

- **No new abstraction layer.** No host registry, no plugin bus, no capability negotiation protocol. Three hosts do not justify a framework; a `switch` on host id inside one resolution function is the correct amount of structure.
- **No shared driver.** `bin/interlock-ship-codex` will duplicate loop *shape* with `bin/interlock-ship-acp`. Extracting a common driver is deliberately deferred — see Decision 9.
- **No `--strict` on Codex**, no Codex plugin-marketplace manifest, no Cursor, no Copilot, no Code Mode. Named as future work in docs, refused at runtime.
- **No credential handling.** Interlock reads no OpenAI key, writes none, and passes none. Authentication is whatever `codex login` established.

## Decisions

### 1. Model class is the canonical value; the vendor slug is derived at the edge

This is the load-bearing decision and the one with a blast radius. Today `task.model` is simultaneously a *demand signal* (how hard is this task) and a *vendor identifier* (`haiku`), and because it is one field the second meaning leaks everywhere the first is read. The fix is the standard one: **normalize once at the boundary, derive at the edge, enumerate every reader.**

- **Boundary (one place):** plan validation in `lib/waves.mjs`. The classifier's raw output is canonicalized — trimmed, lowercased, mapped to one of `cheap` | `standard` | `deep` — and rejected if it is anything else. Nothing downstream sees a raw string.
- **Edge (one place per host):** a `resolveModel(hostId, class, tier)` function returning `{ model, effort }`. Claude Code returns `{ model: 'haiku'|'sonnet'|'opus' }` with no effort; Codex returns `{ model, effort }`.

**Invariant sweep — every reader of `task.model`.** Per `shared/INVARIANT-SWEEP.md`, the unit of work is the invariant, not the file. Fixing the clamp and leaving the plan preview printing a slug is how the original bug survives the fix. The complete reader set, from `grep -rn '\.model\b'`:

| Reader | Location | Becomes |
|---|---|---|
| `MODELS` enum | `lib/waves.mjs:168` | closed set of three classes |
| `clampModel` | `lib/waves.mjs:78-83` | operates on classes; `deep`→`standard`, `cheap` stays |
| `laneModel` | `lib/waves.mjs:219-221` | returns the hardest task's class; default `standard` |
| plan build | `lib/waves.mjs:558` | writes the class |
| plan preview / agent bill | `lib/waves.mjs:645,686` | prints class, not slug |
| `laneModelOf` | `bin/interlock:604,617` | returns the class on the next step |
| run-log field | `lib/run-log.mjs:170` | records class **and** resolved model, so a run stays auditable |
| `agent({ model })` | `workflows/ship.js` | resolves class → Anthropic slug at the call |
| ACP `_meta` slug | `bin/interlock-ship-acp`, `lib/host/acp.mjs:372` | resolves class → slug; `modelRoutingSupported: false` is unchanged |
| classifier prompt text | `workflows/ship.js` tier ladder | names classes; this is why `ship/prompt-integrity` has a delta |
| implementer prompt snapshots | `test/fixtures/prompts/implementer-lane-tier-*.txt` | regenerated |

The run-log keeping **both** the class and the resolved model is the one place duplication is correct: the class is the decision, the model is what actually ran, and a cost question after the fact needs the second.

*Alternative rejected:* keep `model` as a slug and add a parallel `modelClass`. Two fields meaning one thing is the drift generator this repo has spent several changes eliminating (see `lib/limits.mjs`'s header on prose caps). Rejected.

*Alternative rejected:* derive the class from `tier` alone and delete `model` entirely. Tempting — `laneModel` already reduces to `laneTier` in practice — but the clamp exists precisely because the classifier's model opinion and its tier opinion disagree, and that disagreement is a signal worth keeping. Deferred as a possible follow-on, not folded in here.

### 2. Tier drives effort; class drives model

Codex exposes two dials where Claude exposes one. Mapping both from the same input wastes the second, so:

| Tier | Class | Codex model | `model_reasoning_effort` |
|---|---|---|---|
| 1 | `cheap` | `gpt-5.6-luna` | `low` |
| 2 | `cheap` | `gpt-5.6-luna` | `medium` |
| 3 | `standard` | `gpt-5.6-terra` | `medium` |
| 4 | `standard` | `gpt-5.6-terra` | `high` |
| 5 | `deep` | `gpt-5.6-terra` | `xhigh` |

Tiers 3–5 share a model and separate on effort, which is exactly the property the `model-routing` spec's "two tiers sharing a model differ in effort" scenario pins. Mechanical pings are dispatched at `cheap`/`low` regardless of the wave's tier — they run CLI commands and write JSON, and `openspec/specs/ship/spawn-prefix` already forbids giving them a judgement budget.

The table is published by `interlock limits` (the same command that publishes the caps) so an operator can price a run before starting it, and so the `model-routing` spec's "published mapping and dispatched effort cannot disagree" scenario has something to compare against.

*Alternative rejected:* effort-only, one model for all five tiers. Simpler and one fewer pin to rot, but it gives up a genuinely cheaper model on the mechanical pings — and pings are the highest-count spawn in a run.

### 3. One `codex exec` process per spawn

Codex offers four transports: `codex exec` (subprocess), `codex mcp-server`, `codex app-server`, and `codex exec-server`. Take the subprocess.

A fresh process is the cheapest honest way to get a fresh context — the same reasoning `lib/host/acp.mjs` records for spawning one process per task — and it removes any question about whether a long-lived server tolerates concurrent turns at the width `mapPipeline` runs. The two server transports are marked experimental in `codex --help`; building the third host on an experimental surface would make the host's stability a function of someone else's release notes.

Flags per spawn, and why each is load-bearing rather than decorative:

```
codex exec
  --cd <repo>                        agent's working root
  --sandbox workspace-write          writes inside the repo; denies outside
  --model <resolved>                 Decision 2
  -c model_reasoning_effort=<effort> Decision 2
  --output-schema <tmp.json>         Decision 4
  --output-last-message <tmp.txt>    the result, read from disk not scraped from a stream
  --json                             JSONL events → the run log
  --ignore-user-config               reproducible across machines
  --ephemeral                        no session rollout files from a 20-agent run
  --skip-git-repo-check              the caller already validated the change
  [--add-dir <dir>]...               only when the operator asked
```

`--ignore-user-config` is the non-obvious one. Without it a run inherits the operator's `~/.codex/config.toml` — their model, their effort, their sandbox — and two machines produce different runs from the same plan. That is the same class of failure as `CLAUDE_CODE_SUBAGENT_MODEL` silently overriding every per-tier model, which `README.md` already banners rather than hides. Here it is preventable, so prevent it.

`--dangerously-bypass-approvals-and-sandbox` is refused, per the `codex-host` spec. In exec mode a command needing approval fails rather than prompting, which is the property that makes the run structurally zero-touch — the same guarantee the Claude Code host gets from the workflow runtime taking no mid-run input.

### 4. `--output-schema` replaces prose-recovery for this host

`lib/host.mjs` exports `parseAgentJson` — a fenced-block check, then a string-aware balanced-brace scan — because ACP has no schema enforcement and agents prepend greetings. Codex enforces the schema at the transport, so the Codex host writes the schema to a temp file, passes `--output-schema`, and reads `--output-last-message`. `parseAgentJson` is still called on the file contents as a cheap guard, but it should never have work to do.

**This makes the host stricter than ACP, which is a real behavioral difference and must be measured, not assumed.** A malformed turn on ACP often gets recovered; on Codex it resolves to a null spawn, and `lib/limits.mjs`'s `taskFailureHalt: 2` means three null spawns halt the run. Mitigation is in Risks.

*Alternative rejected:* parse the `--json` JSONL event stream for the final message. More moving parts, and the event schema is a wider contract to depend on than one file path.

### 5. Tool-surface constraint via sandbox, not a fabricated agent id

`spawnPrefix()` returns `{ type, tools }` where `type` is `interlock:ping` or `interlock:worker` — Claude Code plugin agent ids. `lib/host/acp.mjs` forwards `--agent <type>` only when the ACP command is literally `claude` or `claude-code`, and ignores it otherwise. The Codex host follows the "otherwise" branch: it does not invent a Codex equivalent.

What it does instead, and what the `ship/spawn-prefix` delta requires it to record: sandbox mode, the writable-path set, and `--ignore-user-config`. That is a *narrower* effective surface than the Claude allowlist in one respect (the filesystem is enforced by the OS, not by tool availability) and wider in another (Codex has no way to remove shell access from an agent that also needs to run tests). Stating that honestly in the run record is the requirement; claiming equivalence would not be.

### 6. Codex surface: `AGENTS.md` plus namespaced prompts, installed by a CLI subcommand

`docs/10-agentic-workflow-ship-and-spec.md:34` already names the gap: "No `AGENTS.md` or `CLAUDE.md`. … This repo relies on plugin skills and `docs/`. Fine for Claude Code with the plugin loaded; thin for anyone else." This closes it.

- **`AGENTS.md`** at the repo root: purpose, the test command, the allowlisted commands, and pointers into `docs/`. It restates **no** cap, tier, or limit — it points at `interlock limits`. `lib/limits.mjs`'s header explains why: "a model reading a cap in prose treats it as guidance, and the whole point of a cap is that it is not." The `codex-surface` spec turns that into a test.
- **`prompts/codex/interlock-*.md`** in the repository, installed into `$CODEX_HOME/prompts/` by `interlock codex prompts --install`.

Why a CLI subcommand rather than a documented `cp -r`: the `codex-surface` spec requires the install to be idempotent and to leave an operator's unrelated prompts byte-identical. `cp -r` satisfies neither claim in a way a test can check. Why on the existing `bin/interlock` rather than a new binary: this repo has three binaries and adding a fourth for a file copy is not worth a `package.json` entry — `bin/interlock-ship-codex` is the only new binary this change earns.

`AGENTS.md` at the repo root is also read by some Claude Code versions and by Cursor. That is a feature, not a leak, provided it stays a pointer file — which is what the no-restated-caps rule enforces.

### 7. Plan schema version bump, so a stale plan is rejected rather than reused

`lib/plan-fingerprint.mjs` and the `plan-reuse` capability exist to reuse a plan across runs. A plan written before this change carries `model: "sonnet"`; validated after it, that is an error. Reuse must fail closed: the fingerprint gains the plan schema version, a mismatch invalidates reuse, and the run replans. Silently reusing a plan whose `model` field means something different is the exact failure mode `plan-reuse` was built to prevent.

### 8. Pinned versions

Every version this change depends on, exact, no ranges:

| Dependency | Pin | Kind |
|---|---|---|
| `@openai/codex` | `0.149.0` | Optional runtime tool, minimum. Not an npm dependency — shelled out to, like `openspec` and `git` |
| `gpt-5.6-terra` | exact model id | Codex model for classes `standard` and `deep` |
| `gpt-5.6-luna` | exact model id | Codex model for class `cheap` |
| Node.js | `>=18` | Unchanged from `package.json` |

No new npm packages. The two model ids are overridable by `INTERLOCK_CODEX_MODEL_CHEAP` / `INTERLOCK_CODEX_MODEL_STANDARD` / `INTERLOCK_CODEX_MODEL_DEEP` so an operator on a different plan or a future model is not blocked on a release — but the defaults are pinned, and an override is banner-worthy for the same reason `CLAUDE_CODE_SUBAGENT_MODEL` is.

The minimum Codex version is checked once at driver startup, before the first wave, and a version below it halts naming what was found. Discovering it on spawn 14 of 20 is a wasted run.

### 9. Duplicate the driver loop; do not extract a shared one yet

`bin/interlock-ship-codex` will look a great deal like `bin/interlock-ship-acp` — the same validate → classify → plan → wave loop → verify → commit sequence, because they drive the same CLI. Extracting a shared driver is the obvious move and it is deliberately not taken here.

Two implementations is the point at which a shared abstraction is a guess about the third. The ACP driver already loads two functions out of `workflows/ship.js` at runtime (`loadImplementerAssembler`, `loadLaneDispatch`) specifically to avoid a second copy of prompt assembly and lane dispatch — the Codex driver uses those same loaders, so the parts that *must not* diverge already do not. What is duplicated is loop shape, and the `ship/prompt-integrity` cross-host comparison is what stops the parts that matter from drifting. Revisit at host four.

## Risks / Trade-offs

**Model ids are unverified against the authoritative source.** `learn.chatgpt.com/docs/models` would not fetch during planning (the fetch tool's summarizer model was unavailable), so `gpt-5.6-terra` and `gpt-5.6-luna` come from search results, not from the page. → Mitigation: all three ids live in exactly one resolution table with env overrides; the driver probes model reachability on its first spawn and halts naming the model rather than falling back; the first implementation task is to verify the ids against the live docs and correct the table before anything depends on it.

**`gpt-5.4` and `gpt-5.4-mini` retire from Codex on 2026-08-31, eight days after this proposal.** → Mitigation: neither is pinned. This is the reason the pins are `5.6-terra`/`5.6-luna` rather than the ids most installs run today.

**`--output-schema` is stricter than ACP's recovery, so a run could halt on malformed turns that ACP would have salvaged.** With `taskFailureHalt: 2`, three null spawns end the run. → Mitigation: keep the schemas permissive in shape (required fields minimal, no enums where prose would do); log every schema rejection to the run log with the label and the raw last message so a halt is diagnosable rather than mysterious; treat a schema-rejection rate above zero on the first real run as a design defect, not operator error.

**Eight concurrent `codex exec` processes are heavier than eight ACP sessions.** `LIMITS.maxParallel` is 8 and `mapPipeline` deliberately does not throttle, because batch width is the planner's decision and a host that throttled would be overriding policy it does not own. → Mitigation: do not throttle. Document the memory profile, and note that `--max-parallel` on the driver is the operator's lever — the same lever the ACP driver already exposes.

**Model availability diverges by authentication mode.** `gpt-5.5` is ChatGPT-sign-in only; the pinned ids were chosen partly to avoid this, but the risk generalizes — an operator on API-key auth may not reach a model an operator on ChatGPT auth does. → Mitigation: the startup probe halts naming the model *and* the authentication mode, so the message points at the actual cause instead of looking like a network failure.

**The `model` rename touches eleven readers across five files plus fixtures.** A partial sweep leaves a run that validates and then prints or dispatches a stale slug. → Mitigation: the sweep is one task section, not spread across waves; plan validation rejecting any non-class value is the enforcement point, so a missed reader fails loudly at the boundary rather than silently downstream; the regenerated prompt fixtures are the canary.

**`AGENTS.md` is read by hosts this change does not target** (some Claude Code versions, Cursor). → Mitigation: the no-restated-caps rule keeps it a pointer file, so being read by an extra host is harmless. The `codex-surface` spec makes "nothing in the loop depends on this file having been read" a requirement.

**Codex cannot remove shell access from an agent that must run tests**, so the Codex worker surface is wider than the Claude worker allowlist in that respect. → Mitigation: state it in the run record and in the host matrix rather than implying parity. The filesystem sandbox is the compensating control, and it is enforced by the OS rather than by tool availability.

## Migration Plan

1. **Verify and correct the model ids** against the live Codex models documentation. Everything downstream reads one table; this is cheap now and expensive after the driver exists.
2. **Land the model-class sweep in one section** — boundary canonicalization, the clamp, all eleven readers, the per-host resolution function, regenerated prompt fixtures. `npm test` green here means the Claude Code and ACP hosts behave identically to before under new internal names.
3. **Bump the plan fingerprint schema version** so any plan on disk from step 2 or earlier is rejected for reuse rather than reused under changed semantics.
4. **Add the Codex host and driver.** No existing host changes.
5. **Add the Codex surface** — `AGENTS.md`, prompts, install subcommand.
6. **Update docs last**, including the host matrix, so what is written matches what shipped.

**Rollback.** Steps 4–6 are additive: deleting `lib/host/codex.mjs`, `bin/interlock-ship-codex`, `AGENTS.md`, `prompts/codex/` and the install subcommand returns the repo to a two-host state with no other edits. Steps 1–3 are not additive — the class rename is the breaking part and rolling it back means reverting the sweep. That ordering is deliberate: the risky change lands first and alone, verified by the existing suite on the existing hosts, before anything depends on it.

**No user-visible migration for Claude Code installs.** No new requirement, no new dependency, no changed slash command. A Claude Code operator should be unable to tell this change landed except from the docs.

## Open Questions

- **Should `interlock limits` print the Codex table unconditionally, or only when a Codex CLI is present?** Unconditionally is simpler and makes the mapping auditable without Codex installed; conditionally is less noise for Claude-only operators. Either satisfies the `model-routing` spec, neither changes the task breakdown. Decide when writing the subcommand.
- **Does `--ephemeral` lose anything worth keeping for post-mortems?** Session rollout files would give a second, Codex-native record alongside `lib/run-log.mjs`. The run log is already the system of record, so the default is `--ephemeral`; revisit only if a real halt proves undiagnosable without the rollout.
