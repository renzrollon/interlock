## Context

See proposal.md — Why. The constraints that shape the how:

- **The host port is three functions** (`lib/host.mjs:1-30`): `spawn`, `mapPipeline`, `runCli`. After `emit-wave-steps-from-cli` a spawn request carries `label`, `model`, `effort`, `type`, `tools`, `schema`, `promptPath`, `promptSha256`, `prompt`, `isolation` and `worktree`; the driver is an interpreter of step records. An adapter is therefore a transport plus a capability declaration.
- **The ACP driver may import only `node:*` and `lib/host*`** (`test/workflows.test.mjs`, `.claude/memory/coupling/acp-driver-import-allowlist.md`). The runner inherits that rule, so adapters and the registry live under `lib/host/`.
- **Vendor CLI contracts as of 2026-09-04** (explore brief §External Findings): `claude -p --output-format json --json-schema <schema>` returns a JSON envelope with `structured_output`, `session_id` and usage, honours `--agent <name>`, `--model`, `--allowedTools`, `--permission-mode`, `--max-turns`, exit codes; `codex exec --json --output-schema <file> -o <file> --model <m> -C <dir>` with `--ask-for-approval never --sandbox workspace-write` for unattended runs, prompt on stdin, JSONL events on stdout; `qwen -p --output-format json --json-schema <json> --yolo` returns a validated payload, with providers configured in `settings.json`. Every flag named here is a claim to be verified against the installed CLI's `--help` by the tasks that use it, and the fixture CLIs encode the verified contract.
- **Subscription policy** (memory `claude-subscription-programmatic-use-billing`): the real `claude` binary is the only subscription-legal Claude runtime; `claude -p`, the Agent SDK and ACP are the category Anthropic flagged for a separate credit pool, paused 2026-06-15; the interactive Workflow runtime was exempted. Codex on a ChatGPT plan works through device auth with an ~8-day token; OpenAI directs unattended volume to an API key.
- **Isolation on the Workflow host is the runtime's** (`isolation: 'worktree'`, `openspec/specs/ship/lane-merge/spec.md`); on the runner nothing creates a worktree today, so parallel lanes share one tree.
- **Hooks are Claude Code's** (`hooks/`, `.claude-plugin/plugin.json`). On the `claude` adapter they fire as the installed plugin's hooks; on Codex and Qwen there is no equivalent, and the guards' fail-open posture means a run there has no test-edit guard during repair.
- **The trajectory records unknown token spend for hosts without accounting** (`openspec/specs/ship-run/spec.md:261`).

No new library. Nothing to pin. Node stays ≥ 18.

## Goals / Non-Goals

**Goals:**

- One runner binary, one interpreter loop, N adapters that are transports with declared capabilities; adding a host is one file under `lib/host/` plus a fixture.
- Every runner host gets the same isolation and fold guarantees the Workflow host has, owned by the runner.
- Every degradation a host implies — no model routing, no hooks, a flagged billing path, no usage accounting — is spoken in the summary and recorded in the receipt.
- `/interlock:ship` and the Workflow host are untouched, and the docs say why that remains the default.

**Non-Goals:**

- Making Codex or Qwen reachable from `/interlock:ship` inside a Claude Code session (ledger P2).
- A billing or API-key switch in the runner (ledger P1): the runner passes the environment through and names the path; choosing credentials is the operator's.
- Cross-session resume, a scheduler, a queue or a channel layer. The runner runs one change to completion or halt.
- Replacing `lib/host/acp.mjs` with an external ACP client (`acpx`) or adopting a vendor SDK: a dependency and a Node 22 floor, both against policy (ledger P4).

## Decisions

### D1 — A registry of adapters with a capability declaration the run program reads

`lib/host/registry.mjs` exports `HOSTS`, keyed by id, each `{ id, create(opts), capabilities }` with `capabilities = { schemaEnforced, modelSelect: 'flag' | 'negotiated' | 'map-only', worktree: 'driver', hooks: boolean, usage: boolean, billing: 'claude-subscription-programmatic' | 'chatgpt-plan-or-api' | 'local' }`. `interlock-run --host <id>` creates the host and passes `--host <id> --host-capabilities <json>` to `run start`, which stores them on the manifest. `run next` reads `worktree` from the manifest: `'runtime'` (the Workflow host, which the runner refuses) yields `isolation: 'worktree'` on the spawn; `'driver'` yields `worktree: { path }` and a captured `mergeBase`. A registry test asserts every adapter declares every key.

### D2 — Briefings travel on stdin

`claude -p`, `codex exec` and `qwen -p` all accept the prompt on stdin. The adapters always send it that way, never as an argument, so a briefing with inlined rubrics cannot hit an argv limit and never appears in a process listing.

### D3 — The `claude` adapter

Argv: `claude -p --output-format json --json-schema <schema JSON> --agent <type> --model <slug or mapped> --permission-mode <mode> --allowedTools <tools joined>`, cwd = the lane's worktree or the repo. Result = the envelope's `structured_output` (schema enforced by the CLI: `schemaEnforced: true`); non-zero exit or a missing `structured_output` → `null`. Usage from the envelope → `usage: true`. `--agent` is passed only when the plugin's agent is resolvable; otherwise the adapter reports `hooks: false` for the run and the summary says the spawn prefix was not applied. The permission mode defaults to `bypassPermissions`, on one condition that task 2.1 must verify before the default is kept: that a plugin PreToolUse `deny` still blocks under that mode. If it does not, the default becomes `dontAsk` with `--allowedTools` set from the spawn's tools, and the design records the finding. `INTERLOCK_CLAUDE_COMMAND` overrides the binary.

### D4 — The `codex` adapter

Argv: `codex exec --json --output-schema <tmpfile> -o <tmpfile> -C <cwd> --ask-for-approval never --sandbox workspace-write [--model <mapped>]`, prompt on stdin. Result = the `-o` file parsed as JSON (`schemaEnforced: true`); the JSONL on stdout is scanned for a usage event (`usage: true` when present). `modelSelect: 'map-only'`: with no mapping the adapter omits `--model` and reports the spawn as unrouted. Billing `chatgpt-plan-or-api`; when `CODEX_API_KEY` and `OPENAI_API_KEY` are both unset the run banners `CHATGPT PLAN PATH`. `INTERLOCK_CODEX_COMMAND` overrides the binary.

### D5 — The `qwen` adapter

Argv: `qwen -p - --output-format json --json-schema <schema JSON> --yolo [-m <mapped>]`, prompt on stdin. Result = the validated payload from the JSON envelope (`schemaEnforced: true`). `modelSelect: 'map-only'`: the model flag's exact spelling is verified against `qwen --help` by task 2.3 and encoded in the fixture; with no mapping the adapter passes no model flag and relies on `settings.json`, reporting the spawn as unrouted. `hooks: false`, `usage` per what the envelope carries, billing `local`. `INTERLOCK_QWEN_COMMAND` overrides the binary.

### D6 — Model routing per host from one map

`lib/host/model-map.mjs` parses `INTERLOCK_MODEL_MAP` (JSON `{ "<host>": { "haiku": "...", "sonnet": "...", "opus": "..." } }`) once at startup; malformed → the runner exits `1` before starting. Resolution per host: `claude` passes the slug through when unmapped (the CLI accepts `haiku`/`sonnet`/`opus`); `acp` negotiates as `close-acp-model-routing` specifies, with `INTERLOCK_ACP_MODEL_MAP` kept as an alias for the `acp` entry; `codex` and `qwen` require a mapping. Every spawn emits a `model-routing` event; the runner banners `MODEL ROUTING UNAVAILABLE (<host>)` naming the unrouted labels and reasons, exactly the shape the ACP banner has.

### D7 — Driver-owned worktrees on every runner host

For an isolated batch the step carries `mergeBase` and, per lane, `worktree: { path }` derived by the CLI with the same function the Workflow host's fold uses. The runner runs `git worktree add --detach <path> <mergeBase>`, spawns the lane with cwd = path (for ACP, the session cwd), and `run record-batch` folds ok lanes and halts on a real collision per `openspec/specs/ship/lane-merge/spec.md`; the runner removes folded worktrees and leaves survivors named. This closes the isolation gap on the runner without a prediction being right.

### D8 — Banners and the receipt say which host and which path

`RUNNER HOST: <id> (experimental)` replaces `ACP HOST (experimental)` (docs and pins updated). `SUBSCRIPTION PATH: programmatic (<host>) — claude -p, the Agent SDK and ACP are the usage Anthropic has flagged for separate billing; see docs/04` prints for `claude` and for `acp` when the command is the Claude binary. `HOOKS NOT IN FORCE (<host>)` prints when `hooks: false`. The receipt records `host: { id, billing, hooks, usage }`.

### D9 — Usage reaches the receipt

Adapters put `usage: { inputTokens, outputTokens }` beside a spawn's result when the host reports it; the runner passes per-spawn usage in the results file; `run close` sums per wave and per run into the receipt, or records `unknown` when any spawn in the wave lacked it.

### D10 — The default host is unchanged, and the reason is written down

`/interlock:ship` launches the Workflow runtime; the runner refuses `--host workflow`; the ship skill never starts the runner. README and `docs/04` carry one paragraph: the interactive Workflow runtime is the path Anthropic exempted from the paused programmatic-use billing change, so it stays the default until that change is settled; the runner is the multi-vendor path and it says which billing path it is on.

### D11 — The shim

`bin/interlock-ship-acp` prints `interlock-ship-acp is now interlock-run --host acp` to stderr and executes `bin/interlock-run --host acp` with the same arguments and environment; removed in the next minor version, noted in `CHANGELOG.md`.

### D12 — Tests use fixture CLIs; live runs are opt-in

`test/fixtures/hosts/fake-{claude,codex,qwen}.mjs` parse the exact argv each adapter sends, read the prompt from stdin, validate that a schema was passed, and print the vendor's envelope shape with a usage block. Live tests against installed CLIs run only when `INTERLOCK_LIVE_HOSTS` names the host.

## Verified findings (recorded during implementation, 2026-09-05)

Every flag D3–D5 names was checked against the installed CLI before it was sent. Three findings changed the design as written:

1. **A plugin `PreToolUse` deny DOES survive `--permission-mode bypassPermissions`** (Claude Code, live probe). A hook returning `{"permissionDecision":"deny"}` blocked the tool call; the file it would have written was never created, and the envelope recorded the refusal in `permission_denials`. So D3's default stands: `bypassPermissions`, and the `claude` host declares `hooks: true`. The `dontAsk` + `--allowedTools` fallback was not needed.

2. **`codex exec` has no `--ask-for-approval`** (codex-cli 0.145.0): it is rejected with "unexpected argument". `exec` is the non-interactive mode and never prompts, so the flag was redundant as well as wrong. D4's argv drops it and keeps `--sandbox workspace-write`; `--dangerously-bypass-approvals-and-sandbox` is deliberately NOT used in its place, because it removes the sandbox. The remaining flags are verified as spelled: `--json`, `--output-schema <FILE>`, `-o/--output-last-message <FILE>`, `-C/--cd`, `-m/--model`.

3. **Qwen's model flag is `-m`/`--model`** (qwen-code 0.22.2, in `--help`). `--yolo` and `--json-schema` are absent from `--help` but accepted by the parser — confirmed by a live argv probe that reached provider initialisation with the whole D5 argv intact. D5 stands as written, `-p -` included: `-p` requires a value and the briefing travels on stdin.

One addition D3 did not name: the `claude` adapter passes **`--plugin-dir <this checkout>`**. Without it a headless `claude` in a lane worktree has loaded no plugin, so `--agent interlock:worker` would not resolve and `hooks: true` would be an assumption about the operator's installation rather than a fact about the invocation. When the checkout does not look like the plugin, no `--agent` is passed and the adapter declares `hooks: false`.

## Risks / Trade-offs

- **[Vendor flags drift]** → each adapter's argv is built in one function, pinned by a test against the fixture, and the design names the doc each flag came from; a drifted flag fails the live test and the fixture is updated deliberately. The fixture CLIs REFUSE a wrong invocation rather than accepting one, so a dropped `--json-schema` fails instead of yielding a green run that enforced nothing.
- **[A guard deny does not survive `bypassPermissions`]** → verified above; it does. The default is kept.
- **[Codex device-auth token goes stale on a long-lived box]** → the adapter surfaces the CLI's authentication error as a null spawn with the stderr tail; the docs name the ~8-day staleness and the API-key alternative.
- **[Codex and Qwen have no test-edit guard]** → `HOOKS NOT IN FORCE` banner and receipt field; the unit-suite shrink check in `verify` remains the deterministic backstop.
- **[Billing policy changes]** → the banner text points at the docs paragraph, which is the one place to update.

## Migration Plan

Lands after `emit-wave-steps-from-cli`, `emit-strict-tail-from-cli` and `close-acp-model-routing`. The shim keeps `interlock-ship-acp` invocations working for one release.

## Open Questions

- Whether the Workflow runtime's `budget` global can feed usage into the receipt is deferrable and belongs to the Workflow host, not the runner.
