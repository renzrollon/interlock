## Context

See `proposal.md` for motivation.

- Default host: Claude Code plugin. `.claude-plugin/plugin.json` sets `"workflows": "./workflows"`. `skills/ship/SKILL.md` calls `Workflow({ scriptPath: ship.js })` and **halts** if the tool is missing.
- `workflows/ship.js` cannot `import()`, `require`, or use `fs` / `child_process`. It coordinates via `agent()` / `pipeline()` globals and asks agents to run `interlock`.
- Policy already is host-agnostic: `bin/interlock` + `lib/*.mjs`. The portability hole is **spawn**, not rules.
- Prior art (dsh, not to copy): ACP as the way to talk to coding agents headlessly. Steal the protocol, not the harness architecture. Not Cordis.
- This change must not gate `add-ship-run-inspectability` or `add-wave-handoff-and-prompt-snapshots`.

## Goals / Non-Goals

**Goals:**

- A documented host port: `spawn`, `mapPipeline`, `runCli`.
- Claude Code workflow unchanged as default.
- An ACP adapter that drives the same CLI.
- CI coverage with a fake host (no live ACP server).

**Non-Goals:**

- Code Mode.
- Making ACP default in 0.x.
- Replacing `ship.js` with a dsh/Cordis orchestrator.
- Moving `lib/waves.mjs` policy into the host.
- Blocking sibling inspectability/handoff changes.

## Decisions

### 1. Port object, not a rewrite of the loop

`lib/host.mjs` (pure contract + helpers; Node, not loaded by `ship.js`):

```js
/**
 * @typedef {object} WorkflowHost
 * @property {(req: { label: string, prompt: string, model?: string, schema?: object }) => Promise<object|null>} spawn
 * @property {(tasks: object[], fn: (t: object) => Promise<object|null>) => Promise<Array<object|null>>} mapPipeline
 * @property {(argv: string[], opts?: { input?: string }) => Promise<{ code: number, stdout: string, stderr: string }>} runCli
 */
```

`runCli` always invokes `bin/interlock` (absolute path via `fileURLToPath`). Hosts never shell out to a reimplemented `wave-state`.

**Why `ship.js` does not import this:** the workflow runtime would reject the file. Claude Code continues to use native `agent`/`pipeline`. The port is for the ACP driver and tests. Structural tests (`test/workflows.test.mjs`) still prove `ship.js` has no `import()`.

**Alternative considered:** compile `lib/ship-loop.mjs` into `ship.js`. Rejected — generated workflow scripts are a new failure mode. Two drivers (workflow script vs Node ACP) sharing CLI is the split Interlock already has (script vs CLI).

### 2. ACP driver is a Node entry, not a workflow script

Path: `bin/interlock-ship-acp` (or `lib/host/acp.mjs` + bin trampoline). It **may** `import()`.

Loop (isomorphic to `ship.js`, not a copy of review/remediation prose):

1. `runCli(['validate', …])`
2. `runCli(['waves'…])` / `wave-state create`
3. while `next.action` not done/halt: spawn implementers via ACP `spawn` + `mapPipeline`; `runCli(['wave-state', 'record-batch', '--write-state', …])`
4. verify / commit via CLI + ACP spawns the same way `ship.js` uses `step()` / `cheap()`

Do **not** port `--strict` review in the first slice if that explodes scope: default **lean** ship (waves → verify → commit) is the ACP MVP. `--strict` may remain Claude Code–only until a follow-on; document that. Specs require the spawn/CLI boundary and an ACP driver that obeys `wave-state`; they do not require feature-parity on the review tail in this change.

Assumption (recorded): ACP MVP = lean ship. Strict tail stays on the Workflow host until explicitly extended.

### 3. ACP session shape (adapter, not dsh)

- Speak ACP to a user-configured agent process (env `INTERLOCK_ACP_COMMAND`, e.g. a coding-agent ACP server).
- One ACP session per spawned agent (fresh context), matching Interlock's "one agent per task".
- Driver process does not accumulate implementer transcripts in its own prompt.
- JSON result schema: ask the agent to return JSON; parse; `null` on failure (same as workflow `agent()` null).

Do not vendor dsh. Do not add Cordis plugins.

Live ACP is optional in CI. Tests use `createFakeHost({ cli: realBin, spawn: stub })`.

### 4. Claude Code host stays the trampoline

No change to `skills/ship/SKILL.md` halt-if-no-Workflow except a pointer: "ACP driver is a separate binary; this skill does not launch it." README: Interlock still requires Claude Code for `/interlock:ship`; ACP is an experimental second host.

### 5. Code Mode

Explicit non-goal. Interlock does not own a Code Mode runtime. Mention only in Non-Goals and README "future".

## Risks / Trade-offs

- **[Two copies of the loop] →** Accept for this change. Shared source of truth is the CLI. Add a lean-path checklist test that both `ship.js` (string/source) and the ACP driver call the same subcommands (`validate`, `waves`, `wave-state`, `verify`, `outcomes`).
- **[ACP MVP omits --strict] →** Documented; avoids blocking portability on adversarial review. Competitive P0 is spawn host, not review parity.
- **[Fake host tests do not prove ACP bytes] →** Add one optional integration test gated on `INTERLOCK_ACP_COMMAND`; default CI skips it.
- **[Users think `/interlock:ship` became portable] →** Trampoline behaviour unchanged; docs state ACP is a second entry.

## Migration Plan

- Additive binary and `lib/host.mjs`. Plugin workflow path unchanged.
- No migration of existing runs.
- Rollback: delete the ACP entry; Claude Code ship unaffected.

## Open Questions

None that affect specs. ACP MVP = lean ship only is an explicit assumption above, not a later guess.
