## 1. Host contract and fake host

- [x] 1.1 Add `lib/host.mjs` documenting `WorkflowHost` (`spawn`, `mapPipeline`, `runCli`) and a `runCli` helper that always execs `bin/interlock`
- [x] 1.2 Add `createFakeHost` that stubs `spawn`/`mapPipeline` and uses the real CLI
- [x] 1.3 Add `test/spine/host.test.mjs` that drives `wave-state create` → record-batch through the fake host and asserts halt reasons come from CLI exit/JSON, not the stub

## 2. Keep Claude Code as default

- [x] 2.1 Leave `skills/ship/SKILL.md` launching `workflows/ship.js` and still halt-if-no-Workflow (no ACP auto-start)
- [x] 2.2 Add a sentence that the ACP driver is a separate binary this skill does not invoke
- [x] 2.3 Assert in `test/workflows.test.mjs` / `test/skills.test.mjs` that the trampoline still does not implement the loop inline

## 3. ACP adapter (lean ship only)

- [x] 3.1 Add `lib/host/acp.mjs` plus `bin/interlock-ship-acp` that implements `WorkflowHost` over ACP (`INTERLOCK_ACP_COMMAND`), one session per agent
- [x] 3.2 Drive lean ship only: validate → waves → wave-state loop → verify → commit via `runCli` + `spawn`; do not reimplement limits/verify/gate
- [x] 3.3 Document `--strict` as Claude Code–only until a follow-on; ACP `--strict` MUST refuse rather than silently run lean
- [x] 3.4 Add a source/CLI-invocation checklist test that `ship.js` and the ACP driver both call `validate`, `wave-state`, `verify`, and `outcomes` (no second copy of halt rules)
- [x] 3.5 Skip live ACP in default `npm test`; optional test gated on `INTERLOCK_ACP_COMMAND`

## 4. Docs and non-goals

- [x] 4.1 README: Claude Code remains required for `/interlock:ship`; ACP is an experimental second host; Code Mode is future/out of scope
- [x] 4.2 `docs/04-when-it-stops.md`: Workflow-missing halt unchanged; point at the ACP binary as a separate path
- [x] 4.3 `.docs/COMPETITIVE-ANALYSIS.md`: P0 portability is now "second host adapter", not an apology with no work item
