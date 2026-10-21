## Context

See `proposal.md` for why. This section holds only what shapes the approach.

**Where an effort comes from, and where it is lost today.**

```
lib/limits.mjs  EFFORT { byTier, verify, skeptic }
      │
      ├─ lib/waves.mjs laneEffort(lane) ──► lib/run.mjs:854   implementer spawn     carries it
      ├─ EFFORT.skeptic ─────────────────► lib/run.mjs:1146, 1182, 1203           carries it
      └─ EFFORT.verify ──────────────────► (no reader)  lib/run.mjs:1032 is null   LOST
                                                  │
                         step.spawns[].effort ────┤
                                                  ├─► workflows/ship.js:291      forwards when truthy
                                                  └─► bin/interlock-run:386-396  drops it   LOST
                                                            │
                                                            └─► lib/host/*.mjs   no adapter reads it
```

**Where it goes after this change.**

```
step.spawns[].effort ─► driver forwards ─► adapter ─► vendor channel ─► effort-routing event ─► runner banner
                                             │
                        claude  --effort <level>                       applied, via flag
                        acp     session/set_config_option              applied, or a reason
                        codex   (argv untouched)                       not applied: not routed here
                        qwen    (argv untouched)                       not applied: no effort control
```

**Constraints the code already enforces.**

- Neither driver may contain an effort level or a derivation. The no-policy sweep bans `xhigh` and `laneEffort` in both (`test/workflows.test.mjs:3571-3627`), and `bin/interlock-run` may not contain `xhigh` even in a comment (`:1375`).
- The runner computes no routing verdict. Every `.applied` it reads must be `event.applied`, and it may not contain the text `applied:` (`test/workflows.test.mjs:700-727`).
- Every banner the runner prints must appear verbatim in `docs/04-when-it-stops.md` (`test/workflows.test.mjs:549-570`).
- The registry test sweeps every capability key over every adapter, so a new key fails until all four declare a legal value (`test/spine/host-registry.test.mjs:30-47`).
- The Workflow host's capabilities are a hand-kept copy in `lib/run.mjs:168-182`, because the CLI must not import the adapters. For the same reason `lib/run-log.mjs` cannot import the registry's legal-value list.
- `workflows/ship.js` cannot import a module, so any string it needs is written in the file.

**One spawn site emits both verify checks.** `verifyStep` (`lib/run.mjs:975-1064`) serves the inter-wave check and the final check.

## Goals / Non-Goals

**Goals:**

- Every effort the table publishes has a reader, and the suite fails when one does not.
- For one step, both drivers hand their host the same effort, or no key.
- On a runner host, each spawn's effort is either applied by a channel the vendor binary is known to accept, or reported as not applied with a reason that is true of that host.
- A host that cannot apply an effort never fails a spawn because of it.
- An operator's exported effort is visible in the summary.
- A past run's receipt says whether effort could be applied on its host.

**Non-Goals:**

- Changing any value in `EFFORT`. A retune waits for a cost-per-task sample (Brief 3).
- Choosing a model for verify. The spawn's model stays null (D6).
- Routing effort on Codex, or mapping levels across vendors (D4, D29).
- Per-message effort, `max`, or any briefing text about how hard to think.
- Recording effort on trajectory events (D12).
- Teaching `drivesClaudeBinary` to recognise ACP wrappers such as `claude-agent-acp`. The limit is now stated in the spec and the docs; see Risks.

## Discovery: what each host accepts

Recorded on 2026-09-30. Nothing below is inferred from a flag's name.

| Host | Channel | Evidence | Declared |
|---|---|---|---|
| Claude Code CLI | `--effort <level>`; levels `low`, `medium`, `high`, `xhigh`, `max` | `claude --help` on 2.1.285: `--effort <level>  Effort level for the current session (low, medium, high, xhigh, max)`. Docs: code.claude.com/docs/en/cli-reference, /model-config#adjust-effort-level — works with `-p`; an unsupported level falls back to the highest supported level at or below it. | `flag` |
| Claude Code CLI on Haiku | flag accepted, not an error | Live probe: `claude -p --model haiku --effort low --output-format json` exited 0, `is_error: false`, result `ok`, model `claude-haiku-4-5-20251001`, empty stderr (D17). | — |
| Claude Code CLI, unknown flag | the invocation is rejected | `claude --definitely-not-a-flag` on 2.1.285 prints `error: unknown option '--definitely-not-a-flag'`. A CLI that predates `--effort` would reject every spawn that passed it (D30). | — |
| Claude Code env | `CLAUDE_CODE_EFFORT_LEVEL` outranks `--effort`, `/effort` and settings; per-agent `effort` "overrides the session level but not the environment variable" | code.claude.com/docs/en/env-vars; /sub-agents#supported-frontmatter-fields | bannered (D16) |
| Workflow runtime | `agent(prompt, { effort })`, same five levels, "omit to inherit the session effort" | Workflow tool description in the 2.1.285 binary; `workflows/ship.js:291` already passes it | `flag` (assumed) |
| ACP, protocol | no effort field in `session/new`, `session/prompt` or `session/set_mode`. Generic `configOptions` with a reserved `thought_level` category | agentclientprotocol.com/protocol/v1/session-config-options | — |
| ACP, `@agentclientprotocol/claude-agent-acp` 0.84.0 | config option id `effort`, category `thought_level`, type `select`; set with `session/set_config_option`. Not offered when the model has no effort. A value outside the model's list is a hard error (`Invalid value for config option effort`) | `src/session-effort.ts:70-117`, `src/acp-agent.ts` at commit `bdb50ad` | `negotiated` |
| Codex CLI | `codex exec -c model_reasoning_effort=<lvl>`; any string parses | developers.openai.com/codex/config-reference. Not installed here; the adapter's verified contract (`lib/host/codex.mjs:6-14`) does not include it | `unsupported`: a channel exists and is not routed (D29) |
| Qwen Code CLI | no flag. `model.reasoningEffort` in settings files only | `docs/users/configuration/settings.md`, `packages/cli/src/config/top-level-options.ts` at commit `d3c2edc`. Not installed here | `unsupported`: no per-spawn channel (D4) |

No native ACP mode was found in the `claude` binary.

## Decisions

Ids match `decisions.md`.

### The run program

- **D14 — both verify checks run at the published verify effort.** Human decision. `verifyStep` passes `effort: EFFORT.verify` unconditionally. Retries come through the same site, so they carry it too.
- **D23 — the limits row is relabelled, its value untouched.** `effort: verify step (inter-wave and final)`. Brief 1's acceptance says the effort rows of `interlock limits` are unchanged; D14 widened what the row governs, so its label follows and only its label. `--json` is unchanged: the field is still `effort.verify`.
- **D6 — the verify spawn's model stays null.** Choosing a model for verify is a model-routing question this change does not take.
- **D8 — `EFFORT` joins the cap-authority sweep**, with `byTier` counted as one cap, as `LANE_CAPS.byTier` is. The sweep's comment excluded `EFFORT` because "neither has been reported as unread"; `EFFORT.verify` now has been. A second sweep covers `lib/run.mjs`, `lib/waves.mjs` and both drivers for a quoted level word beside an `effort` key. It matches level words only, so the capability value `effort: 'flag'` in `ASSUMED_CAPABILITIES` is not a hit. Alternative considered: only the runtime assertion on the verify step. Rejected: it would not catch the next published effort that nobody reads.
- **D28 — a test enumerates spawn kinds.** Every `kind` passed to `spawn()` in `lib/run.mjs` is in the published-effort set (`implementer`, `verify`, `review`, `remediate`) or the inheriting set (`ping`, `planner`, `handoff`, `commit`). A new kind in neither fails. This is what makes "inherit on purpose" checkable.
- **D5 — `ASSUMED_CAPABILITIES.effort` is `flag`.** The Workflow runtime takes the option. The comment says what the default cannot know: a runner manifest written before the key existed also reads `flag`, and that run applied nothing. Nothing reads the key from an old manifest.
- **D31 — the plugin's agent definitions carry no effort.** An `effort` in `agents/*.md` frontmatter outranks the level a spawn is given, with every event still reporting applied. Neither definition has one today; a test keeps it so.

### The drivers

- **D13 — one derivation, two forwarders.** The mirror requirement is removed, not edited: its subject is gone.
- **D7 — both drivers forward truthy-only.** `...(s.effort ? { effort: s.effort } : {})`, the expression `workflows/ship.js:291` already uses. A null effort never reaches a host as a key, not even as `effort: undefined`.
- **D2 — the runner prints the effort banners; the adapters supply the facts.** Brief 1 proposed deciding from `capabilities.effort` and `s.effort` in the runner. Superseded once D15 put negotiation in scope: on a negotiated host the outcome differs per spawn, and the runner is pinned to compute no verdict of its own. So the runner collects `effort-routing` events in a list of its own, `effortRouting`, beside the `model-routing` list, and folds them the same way. The list is named so a test can pin that the unapplied set is read off these events. The run program still holds no copy of the banner.
- **D27 — the event mirrors `model-routing`:** `{ type: 'effort-routing', label, requested, applied, via, value, reason }`. `via` is `flag` or `set_config_option`. Emitted only for a spawn that named an effort and whose agent the adapter got as far as starting.
- **D9 — the runner says when effort was applied, too.** `effort routing: applied on N/N spawns`, where N counts spawns that named an effort. Silence would read the same as a run that degraded and hid it. With no such spawn, neither line prints.
- **Banner text.** The level is always printed as requested, so a host that could not apply it cannot be read as a host that ran at it:

  ```
  EFFORT ROUTING UNAVAILABLE (<host>): the plan's per-step effort assignment is not in effect for the spawns below — each ran at the host's own default
    — <label>: <level> requested, <reason>
  ```

  The level comes from `event.requested`. No level is written in the driver.

### The adapters

- **D1 — the capability is an enum: `flag | negotiated | unsupported`.** Claude and ACP apply effort differently, which is the case Brief 1 named for preferring an enum over a boolean. It mirrors `modelSelect`. `unsupported` means the adapter has no effort channel it is verified to use on this host.
- **D21 — one shared module, `lib/host/effort.mjs`.** It holds `resolveEffort(level, capability, reason)` for the flag and unsupported hosts, `pickEffortValue(level, option)` and `findEffortOption(configOptions)` for ACP, the reason strings, and the override variable's name. `lib/host/model-map.mjs:107-129` is the precedent. Reason strings live here because the runner may not word a verdict. An unknown or missing capability resolves to not-applied with a reason: fail open, and spoken.
- **Reasons.** Each is true of the host that gives it:

  | Reason | Given by |
  |---|---|
  | `host has no effort control` | `qwen`; also any unknown capability |
  | `effort is not routed on this host` | `codex` (D29) |
  | `this claude CLI has no --effort flag` | `claude`, when its help does not list the flag (D30) |
  | `could not establish whether this claude CLI accepts --effort` | `claude`, when the help probe fails (D30) |
  | `no effort option advertised` | `acp` |
  | `level not among advertised values` | `acp` |
  | `agent rejected the effort option` | `acp` |

- **D3 — Claude applies effort with `--effort`, pushed after `--model` in `claudeArgs`.** Not the environment variable: that outranks everything and flattens every subagent's and skill's own effort.
- **D30 — the Claude adapter probes `--help` once, at host creation.** Human decision. `createClaudeHost` runs the configured command with `--help`, synchronously and under a short timeout that a caller may pass in, and looks for `--effort`. It always records the verdict in its observed `capabilities` — `effort: 'flag'`, or `effort: 'unsupported'` when the flag is absent or the probe fails — which `effectiveCapabilities` already merges. `spawn` resolves from that verdict directly, because a host built without `createHost` has no effective capabilities to read. On `unsupported` it passes no flag and emits not-applied events. The probe must be synchronous because the runner reads `host.capabilities` immediately after creation and sends them to `run start`. Alternatives considered: retry once without the flag on an unknown-option error (depends on matching error text and doubles each failed spawn), and documenting a minimum version only (an older CLI still fails the run). Both rejected by the human decision.
- **D11 — the level is passed through unvalidated.** The table is the authority and the CLI falls back on a level a model lacks. A validating copy of the level list in the adapter would be a second statement of the vendor's contract.
- **D24 — on a flag host, "applied" means the flag was passed.** A model with no effort parameter ignores it; the probe confirms this is not an error. The adapter cannot see further than its argv and does not claim to.
- **D4 — Codex and Qwen declare `unsupported`.** Their argv is unchanged, and each emits the event with `applied: false`.
- **D29 — Codex gives its own reason.** Human decision. Codex has a real knob, so "no effort control" would be false for it. It reports `effort is not routed on this host`: sending it a Claude-derived label is a cross-vendor mapping this change does not make. Qwen, which has no per-spawn channel, keeps `host has no effort control`.
- **D15 — ACP negotiates.** Human decision. After model negotiation, the adapter finds the effort option, picks a value, and calls `session/set_config_option` before `session/prompt`.
  - **D19 — the option is found by id `effort` or category `thought_level`**, the same two-way rule `findModelOption` uses for the model.
  - **D18 — a value is selected only on exact equality.** No substring and no display-name rule, unlike the model: `high` is a substring of `xhigh`, and an agent rejects a wrong value outright. No operator map: that would be the cross-vendor mapping D29 declines.
  - **D32 — only a flat list of values is read, and a failure before negotiation raises no effort event.** A grouped or non-select option resolves to `level not among advertised values`. A session that was never created, or a turn that timed out before the effort was negotiated, is a failed spawn under the adapter's existing rules; no effort was attempted, so none is reported. That includes a hung `session/set_config_option`. A turn that times out later, during the prompt, is also a failed spawn, and keeps the event it already emitted.
  - The option is read from the config options the agent returned most recently: the model's `session/set_config_option` response when it carried any, otherwise `session/new`. An agent offers effort only for a model that supports it. Those options travel beside the model's routing verdict, never inside the `model-routing` event, whose shape is pinned.
  - A rejected call is reported, never thrown. The prompt runs either way.
- **D20 — no `_meta` hint for effort.** The model hint `_meta['interlock/model']` keeps travelling because the `workflow-host` spec requires it. No agent is known to read an effort hint, and `_meta.claudeCode.options.effort` is one adapter's private extension.
- Each adapter passes its own capability literal and reason to the resolver, as it does for `modelSelect` (`lib/host/claude-cli.mjs:226`). The registry imports the adapters, so the reverse import is not available. A test pins that each adapter's event agrees with its registry declaration.

### The environment override

- **D16 — `EFFORT ROUTING OVERRIDDEN` on both drivers.** Human decision.
  - Workflow: the environment probe gains `printenv CLAUDE_CODE_EFFORT_LEVEL`, reported as `effortLevelOverride`, handled exactly as `subagentModelOverride` is (`workflows/ship.js:405-462`).
  - Runner: read from `process.env` at startup and pushed with the static banners.
  - Text: `EFFORT ROUTING OVERRIDDEN: CLAUDE_CODE_EFFORT_LEVEL=<value> — every agent runs at that effort, so the per-step effort in the plan is not in effect`.
- **D22 — the runner banners only when `drivesClaudeBinary` is true**, the condition `SUBSCRIPTION PATH` already uses. The variable means nothing to Codex or Qwen. `drivesClaudeBinary` matches a command named `claude` or `claude-code`, so a wrapper is not recognised; the spec and `docs/04` say so.
- **D26 — the variable is never stripped from the child's environment.** It is the operator's, as `workflows/ship.js:445-450` says of its model twin. A deliberate override gets a receipt, not a fight.
- The `applied on N/N` line and the override banner can both print. They state different facts: the flag was passed, and the environment outranked it.

### Records and docs

- **D10 — the receipt's host block records the effort capability.** Human decision. The manifest is one file overwritten by every `run start`, so it is not a record. The receipt gains `host.effort` at the three sites that carry `cacheAccounting`: `lib/run.mjs:3058-3065`, `lib/receipt.mjs:144-158` and `lib/run-log.mjs:241-253`. It is copied from the manifest's own field and is null when the manifest has none, so a run started before this change and closed after it records "not recorded" rather than the assumed `flag`.
- **D33 — the receipt reader keeps `effort` as bounded text, null when absent.** `lib/run-log.mjs` cannot import the registry's legal values, and `billing`, the other enum in that block, is already read as bounded text. A receipt written before this change reads `null`: not recorded.
- **D12 — `agent-spawn` trajectory events do not gain an effort field.** Measurement is Brief 3.
- **D25 — the `effort-routing` Purpose line is edited by hand.** It says effort is "mirrored across the planner/runtime boundary". A delta cannot change a Purpose; the OpenSpec instructions say to edit the living spec directly.

## Invariant sweep

The shared values are a spawn's `effort` on the step record, the published `EFFORT.verify` behind it, and the new `effort` capability key.

| Reader | Today | After |
|---|---|---|
| `lib/run.mjs:1032` verify spawn | writes `null` | reads `EFFORT.verify` |
| `lib/run.mjs:405-440` `relayStep` | keeps `effort` | unchanged |
| `workflows/ship.js:291` | forwards when truthy | unchanged; now observed by a runtime test |
| `bin/interlock-run:386-396` | drops it | forwards when truthy |
| `lib/host/claude-cli.mjs:85-102` | never sees it | `--effort`, when the CLI has the flag |
| `lib/host/acp.mjs` `promptOnce` | never sees it | negotiates |
| `lib/host/codex.mjs`, `lib/host/qwen.mjs` | never see it | report not applied |
| `bin/interlock:884` `formatRunStep` | prints a truthy effort | unchanged code; verify spawn lines now show the level |
| `lib/limits.mjs:520` row label | "inter-wave verify step" | relabelled; pinned at `test/spine/limits.test.mjs:326` |
| `lib/host/registry.mjs:41-60` key list | seven keys | eight; `effectiveCapabilities` merges the new one unchanged |
| `lib/run.mjs:168-182` `ASSUMED_CAPABILITIES` | no `effort` | `flag` |
| `bin/interlock:2542-2547` → `lib/run.mjs:241-252` manifest | passes any declared key through | unchanged; carries `effort` |
| `lib/run.mjs:3058-3065`, `lib/receipt.mjs:144-158`, `lib/run-log.mjs:241-253` receipt host block | four named fields | five, with `effort` |
| `agents/worker.md`, `agents/ping.md` | no `effort` key | pinned to stay that way |
| `test/helpers/ship-harness.mjs:472, 505, 520` | discards `options.effort` | records it, and whether the key was present |

No skill, doc or briefing restates an effort level (swept: `skills/`, `shared/`, `docs/`, `README.md`, `lib/prompts/verify.mjs`).

## Risks / Trade-offs

- **Spend moves.** Both verify checks rise to the published verify effort on the Workflow host, and `--host claude` lanes start receiving their assigned effort. → Intended. The changelog says so in its first sentence, and no table value moves with it.
- **The Workflow runtime honouring `effort` cannot be observed from the script.** → Unchanged from today; the spec already tolerates a runtime that ignores the key. The harness test proves the script passes it.
- **ACP negotiation is built from reading an adapter's source, not from a live agent.** → Every failure path is "not applied, with a reason, prompt still runs". The fixture covers no option, a level not advertised, a grouped option, a rejected call, and an option found by category.
- **An ACP wrapper around Claude is not recognised as Claude.** A run through `claude-agent-acp` gets neither `SUBSCRIPTION PATH` nor the override banner, and can print `effort routing: applied` while an exported variable outranks it. → Stated in the `effort-routing` delta and in `docs/04`. Not fixed here: which wrappers count is its own question.
- **The `--help` probe costs one process per runner run on `--host claude`, and reads help text.** → It looks for the flag's name only, never a level list. A probe that fails degrades to `unsupported`, which is spoken per spawn.
- **A flag host reports "applied" for Haiku, which has no effort parameter.** → D24. The docs section says what "applied" means.
- **`formatRunStep` output changes for verify steps.** → No fixture pins a verify spawn line (checked). If one appears during implementation, it is updated to the new line, not worked around.
- **The base is uncommitted.** The opus-floor lanes work is in the working tree. → Stated in the proposal; this change's deltas are against the working-tree specs.

## Migration Plan

No data migration. A stored manifest without an `effort` capability reads the assumed `flag`. A receipt without `host.effort` reads `null`. Rollback is a revert: no file format, plan format or fingerprint changes.

## Open Questions

- Should `drivesClaudeBinary` recognise known ACP wrappers? It would fix two banners at once. It is a separate change with its own question about which wrappers count.
- Does Brief 3's cost matrix need effort on `agent-spawn` events as well as on the receipt? Likely yes; decided there.
