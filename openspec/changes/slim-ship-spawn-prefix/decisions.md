# Decisions — slim-ship-spawn-prefix

| id | question | class | resolution | evidence |
|----|----------|-------|------------|----------|
| D1 | Which `agent()` option keys, and is `agentType` safe? | agent_resolved | Dual-write `type` and `tools`. Do not pass `agentType` with a custom slug. | design.md D1; workflows cookbook; #63762 |
| D2 | How many plugin agents? | agent_resolved | Two: ping (cheap) and worker (everything else). | design.md D2; plan table |
| D3 | Ship plugin agents if workflow `type` may be ignored? | agent_resolved | Yes. ACP `--agent` is the system-prompt replacement path. | design.md D3 |
| D4 | Do workers load CLAUDE.md / Interlock skills? | agent_resolved | No. Implementer prompt plus artifacts are the contract. | design.md D4; proposal.md out of scope |
