## Context

See `proposal.md — Why` for the motivation. The design-relevant constraints, all established in `.claude/handoff/explore-ship-run-prompt-cache-20260907-070120.md`:

- **A plugin cannot set either prompt-cache lifetime.** Claude Code's plugin component model is skills, agents, hooks, MCP servers, LSP servers, monitors, commands, workflows. There is no settings component and no session-env component. `.claude/settings.json` in this repository governs this checkout and is kept out of the tarball by `test/spine/package.test.mjs:122-131`. Everything Interlock can do here is *tell the operator*, *measure*, or *fix its own code*.
- **Two TTL buckets, and both matter.** The host splits requests into the main conversation and everything else (subagents, workflows, compaction). **D1** settled which one produced the reported symptom: the CLI's main conversation runs on the short default while the desktop app runs on the long one — the transcripts sampled during exploration were all app sessions, which is why they showed a surviving 32-minute gap. **D2** follows: the change addresses both keys, not the subagent bucket alone.
- **The measurement is one field away on one host and unavailable on the other.** `lib/host/claude-cli.mjs:126-135` already parses the vendor's usage envelope and discards its cache fields. The Workflow runtime exposes `budget.spent()` — a single cumulative scalar with no decomposition, which `lib/run.mjs:2230` already describes as something this process "never sees".
- **Standing doctrine this design must obey.** Guards and advisories fail open (`CLAUDE.md`). Degradation is spoken, never silent. Thresholds live in the CLI, not in prose. Drivers are interpreters — `test/workflows.test.mjs:3355-3410` sweeps policy tokens out of both drivers with no allowance, so no cache constant may live in `workflows/ship.js` or `bin/interlock-run`.

## Goals / Non-Goals

**Goals:**

- An operator learns from `interlock doctor` that the two lifetime keys exist, which one governs wave agents, and that the host version floor makes them silent no-ops below a certain release.
- A run's cache cost is recorded in the same corpus as its output-token cost, under the same unknown-not-zero rule.
- A trajectory joins to its host transcript by a key, not by timestamp overlap.
- The outcome eval's cache tallies measure something.

**Non-Goals (design level, beyond the proposal's scope exclusions):**

- **No live cache instrumentation.** Nothing is read during a run to decide anything. Every figure is recorded at the point the host already reports usage, and every consumer is post-hoc.
- **No change to the run program's step shape.** No new `ACTIONS` entry, no extra step, no altered cadence. The additions ride events and records that already exist.
- **No derived cost figure in this change.** The multipliers land in `MODEL_PRICES` so a dollar figure becomes computable; computing and presenting one is a later decision (see **D9**).

## Decisions

**D3 — The doctor check follows `checkNotify`, not `checkPermissions`.**
`lib/doctor.mjs` has two precedents for reporting on an operator's configuration. `checkPermissions` (`:597-679`) can `fail`, because a missing allow rule stops an unattended run. `checkNotify` (`:732-750`) is `ok`/`skip` only, never `fail`, because push is optional and a run works without it. Prompt-cache lifetime is the second kind: unset costs money, never correctness. Taking the `checkPermissions` shape would make every session without the keys emit a failing preflight, which is the "guard that blocked whenever its marker was absent" failure `CLAUDE.md` names directly. *Alternative rejected:* a `warn` severity — the doctor's vocabulary has no such level today, and inventing one for a single advisory row is a bigger change than the advisory.

**D4 — The check reports configuration, never an effective lifetime.**
Nothing exposes the lifetime a session is actually running under to a hook, a script, or any command's output; the only observable is the post-hoc usage envelope, which the doctor does not have. So the row reads the four settings scopes `settingsSources()` (`:61-73`) already opens and the auth mode `:872-880` already distinguishes, and states what is *configured*. Asserting an effective lifetime would be exactly the fabricated measurement the eval requirement in this same change forbids.

**D5 — Cache multipliers go into a new `MODEL_PRICES` id, not an edit in place.**
`lib/limits.mjs:250-285` carries `anthropic-list-2026-09` with input and output rates only. Cache pricing is a different rate structure — a write multiplier per lifetime tier and a read multiplier — and the repository's own doctrine is that revising a price table means minting a new id so historical figures stay attributable to the table that produced them. *Alternative rejected:* a separate `CACHE_MULTIPLIERS` constant beside the existing table — it would let the two drift apart, and a run priced against one id and multiplied by a differently-versioned constant is not attributable to anything.

**D6 — Cache accounting is a declared host capability with a spoken banner, not a best-effort field.**
`lib/host/` exists so the run program can branch on what a host *declares* rather than on its name, and `run-host-adapters` already requires exactly this for usage. Cache accounting is not implied by usage accounting — the Workflow runtime demonstrates the gap by exposing one and not the other — so it is declared separately. The banner is not optional: an absent metric that is never spoken reads as a measured zero, and `lib/run.mjs:2263` already has `TOKEN USAGE NOT REPORTED` as the pattern to follow. *Alternative rejected:* recording cache figures only on hosts that have them and saying nothing elsewhere — that is the silent degradation `CLAUDE.md` forbids, and it would make the corpus quietly incomparable across hosts.

**D7 — Lifetime tiers are carried separately, never summed.**
A prefix written for five minutes and one written for an hour are priced differently. Flattening them yields a total that cannot be priced, and the flattening is irreversible. The parse either keeps both tiers or reports absence.

**D9 — No cache indicator in `interlock report`, this change.**
`docs/12-repository-review-policy.md` forbids the report recommending a threshold change; whether a cache *census* falls on the permitted side of that boundary is a policy question, and `report/non-gating` is a spec with four requirements about exactly what the report may not do. This change records the data and stops. Adding the indicator later requires no change to what is recorded.

**D10 — No `experimental: { cacheTtl: 1h }` on the shipped agents, this change.**
Two official host pages contradict each other on whether the field survives plugin distribution — one documents it for subagents and names only three fields as ignored for plugin agents, the other gives a positive eleven-field allowlist that omits it. Beyond that unresolved question, a one-hour write costs 2x base against 1.25x, and worker prefixes are already cold per lane because cache scope includes the working directory and every lane runs in its own worktree. Shipping the field would be a 60% write-price increase bet on an unmeasured hit rate. The measurement this change adds is what would settle it.

**D11 — the session identifier is read by the CLI, not carried by a driver.**
Neither driver is in a position to supply it honestly: `workflows/ship.js` has no shell or filesystem, and `bin/interlock-run` is a plain Node process with no session at all. So `interlock run start` reads it from its own environment, which keeps host-observed state in the CLI where the interpreter contract and the no-policy sweep both put it. There is a real hazard: on the Workflow host that CLI runs inside a ping subagent, so the value in scope may be the subagent's rather than the parent's. The implementation must establish which it observes and record **absent** rather than a subagent identifier — a wrong identifier is worse than none, because it joins the trajectory to a transcript that is not the run's. *Alternative rejected:* having the ping report it through the step's result payload — that makes the driver carry host-observed state and puts the acquisition in prompt text, where the sweep forbids it.

**Where the host's own constants live.** The version floor and the settings key names are facts about the host, not Interlock thresholds, so they are not `interlock limits` material. They live as named constants in the module that reads them — the convention every `INTERLOCK_*` reader already follows (`lib/host/claude-cli.mjs:45-51`, `model-map.mjs:22-25`). They must not appear in a driver: the no-policy sweep has no allowance.

**Ordering.** The host adapter's envelope parse is the source for everything downstream, so it lands before the recording; the capability declaration must exist before the run program can branch on it. The doctor check and the eval breakpoint touch neither and are independent.

## Risks / Trade-offs

- **The eval breakpoint may be a silent no-op below the provider's minimum cacheable prefix** → the fix lands its assertion first and asserts a non-zero cache read on a prefix known to exceed the floor; if the floor cannot be cleared, the eval records the condition as unmeasured rather than as a miss, which the spec already requires.
- **Cache figures exist on the runner host and not on the Workflow runtime, so corpus rows are not directly comparable** → the capability is declared per run and the banner is carried into the summary, so a reader can partition the corpus rather than average across it. This asymmetry is real and is stated, not engineered away.
- **Advice about someone else's settings file can be wrong or stale** → the row states only what is configured plus the detected auth mode, names the version floor, and never asserts an effective lifetime. It cannot be wrong about a value it does not claim.
- **A new doctor row adds noise to every SessionStart** → it is `ok`/`skip`, and the preflight already summarises rather than enumerating; a `skip` row does not change the overall verdict or the exit code.
- **Recording a host session identifier puts an identifier into a corpus some repositories commit** → unresolved; see Open Questions. If the answer is no, the field is dropped and the trajectory↔transcript join stays timestamp-based, which costs the measurement precision but nothing else in this change.
- **Cache misses observed during exploration did not correlate cleanly with gap length** — of fourteen turns following a gap over five minutes, nine hit and five missed, with survivors at thirty-two minutes and misses at nine. Something besides lifetime invalidates some prefixes, plausibly the working directory or git-status snapshot that forms part of the prefix → this change measures rather than remedies, which is the correct order given that the cause is not diagnosed. A remedy aimed only at lifetime might not move the misses that actually occur.

## Open Questions

**D8 — may a host session identifier be written into `.claude/ship/runs`? — answered 2026-09-07: yes, record it.** `docs/11:75-83` describes repositories that deliberately commit that corpus as an audit trail, so the field is committed in that posture. The operator's call was that an opaque host-generated identifier is no more identifying than the `runId` already recorded beside it, and that losing the exact trajectory→transcript join costs more than the field does. No gitignore change accompanies it: the committed-corpus posture stays available to repositories that want it.

None remaining.
