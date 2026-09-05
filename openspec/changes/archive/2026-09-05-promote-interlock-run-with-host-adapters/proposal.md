## Why

Once the run program is emitted by the CLI, the only host-specific code left in `bin/interlock-ship-acp` is a transport, and it speaks one protocol to one kind of agent. The explore brief established three facts that decide what the second host should be (`.claude/handoff/explore-creating-or-reusing-harness-20260904-171500.md` §External Findings): a Claude subscription can be spent only through the real `claude` binary, so any second host must drive vendor CLIs rather than replace them; every vendor CLI the maintainer wants — Claude Code, OpenAI Codex, Qwen Code — now has a headless entry that enforces a JSON result schema; and the harness list's own thesis is that the pick is a model–harness pairing, not a universal harness. The brief's second recommendation follows: promote the ACP driver to a runner with pluggable adapters, one per vendor CLI, and let the runner own per-lane isolation, which `docs/08-harness-landscape.md:785-797` names as the gap that was blocked on the host.

## What Changes

- **`bin/interlock-ship-acp` becomes `bin/interlock-run`** with `--host claude | acp | codex | qwen` (or `INTERLOCK_RUN_HOST`). The old name stays for one release as a shim that prints a deprecation line and runs `interlock-run --host acp`.
- **Adapters under `lib/host/`**, each implementing the three-port host and declaring its capabilities: `claude-cli.mjs` (`claude -p` with `--output-format json --json-schema --agent --model`), `codex.mjs` (`codex exec --json --output-schema -o`), `qwen.mjs` (`qwen -p --output-format json --json-schema --yolo`), and the existing `acp.mjs`. A registry maps ids to adapters; `run start --host` records the declared capabilities in the manifest.
- **Driver-owned worktree isolation for every runner host.** Under `--isolate-waves` the run program emits a worktree path per lane; the runner creates it from the batch's merge base, spawns the lane there, and `run record-batch` folds it — the same fold and halt-on-collision rules the Workflow host has.
- **Per-host model routing from a published map.** `INTERLOCK_MODEL_MAP` maps the planner's slugs to each host's model ids; Claude passes slugs through unmapped; a host with no mapping for a slug gets no model flag and the run banners `MODEL ROUTING UNAVAILABLE (<host>)` naming the spawns. The ACP adapter's map from `close-acp-model-routing` becomes an alias of it.
- **The runner names the billing path it runs on.** `RUNNER HOST: <id> (experimental)` replaces the ACP-only banner; a run over the Claude binary (directly or through ACP) prints `SUBSCRIPTION PATH: programmatic` with a pointer to the docs, and a Codex run on a ChatGPT login prints `CHATGPT PLAN PATH`. The receipt records the path.
- **Usage is recorded when the host reports it.** Adapters that return token usage feed it to `run close`; the receipt records per-wave and per-run output tokens, or `unknown` as today.
- **The default host does not change.** `/interlock:ship` keeps launching the Workflow runtime, the runner is never started for the user, and the docs state why: the Workflow runtime inside an interactive session is the path Anthropic exempted from its paused programmatic-use billing change.

## Capabilities

### New Capabilities

- `run-host-adapters`: the adapter registry and capability declaration, driver-owned worktree isolation on runner hosts, per-host model routing from the map, billing-path banners, and usage recording.

### Modified Capabilities

- `workflow-host`: "Claude Code remains the default host" now covers the runner and any adapter, not only ACP, and states the billing rationale; "ACP is a second host adapter" becomes one adapter of the runner that runs the same steps as every other.

## Impact

- **Code**: `bin/interlock-run` (renamed driver; adapter selection; worktree creation; host banners), `bin/interlock-ship-acp` (shim), `lib/host/registry.mjs`, `lib/host/claude-cli.mjs`, `lib/host/codex.mjs`, `lib/host/qwen.mjs`, `lib/host/model-map.mjs`, `lib/host/acp.mjs` (map alias, cwd per spawn), `lib/run.mjs` (host capabilities on the manifest; worktree emission by capability; usage on close), `lib/receipt.mjs` (billing path, usage), `package.json` (`bin`).
- **Tests**: `test/fixtures/hosts/{fake-claude,fake-codex,fake-qwen}.mjs`, `test/spine/host-adapters.test.mjs`, `test/spine/run.test.mjs`, `test/workflows.test.mjs` (driver name, import allowlist, banners), `test/skills.test.mjs`; live tests opt-in via `INTERLOCK_LIVE_HOSTS`.
- **Docs and skills**: `README.md` (Experimental → the runner; install; host policy), `docs/04-when-it-stops.md` (banners), `docs/06-why-it-works.md` §14, `docs/08-harness-landscape.md` (the gap closed), `docs/10-agentic-workflow-ship-and-spec.md` (host table), `CLAUDE.md` Architecture, `skills/ship/SKILL.md` §3, `CHANGELOG.md`, `.claude/memory/coupling/acp-driver-import-allowlist.md`.
- **Dependencies**: none in the package; the adapters shell out to CLIs the operator installs. Nothing to pin.
- **Compatibility**: `interlock-ship-acp <change>` keeps working through the shim for one release. The Workflow host is untouched.
