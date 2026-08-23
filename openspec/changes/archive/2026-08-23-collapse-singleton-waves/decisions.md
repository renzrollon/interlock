# Decisions — collapse-singleton-waves

| id | question | class | resolution | evidence |
|----|----------|-------|------------|----------|
| D1 | Where is the canonical wave list produced, and which readers must use it? | agent_resolved | Once, at the end of planWaves after collision packing. formatPlan, projectedWaveLoopAgents, waveCount, folded[], the serial warning, and createRunState all consume that list. classified.json group stays raw. | design.md D1 sweep table; lib/waves.mjs planWaves return today |
| D2 | Fold only same-path singletons, fold every 1-task impl wave, or add dependsOn? | agent_resolved | Fold every 1-task implementation wave onto the previous implementation wave as later batches. Wide waves stay separate. No dependsOn. | design.md D2 D4; human decision 2026-08-23 (fold is the ping cap; no dependsOn) |
| D3 | May wave-state create flatten a wave and re-pack batches? | agent_resolved | No. Split a batch that exceeds maxParallel; do not move a task into an earlier planned batch. | design.md D3; specs/waves Creating a run does not merge planned batches |
| D4 | Add a classified-task dependsOn field in this change? | agent_resolved | No. Happens-after across files remains a later section; a 1-task later section becomes a later batch via D2. | design.md D4; proposal.md Impact out of scope |
| D5 | Does a collapsed 1-task staircase still warn as effectively serial waves? | agent_resolved | No. Serial warning uses post-fold waveCount. formatPlan reports folded[] instead. | design.md D5; specs/waves Plan preview names the agent bill |
| D6 | Where do task-granularity rules live — stock propose skill, or spec workflow? | agent_resolved | In /interlock:spec: insert Task shape for ship into skills/spec/SKILL.md (after Gates while generating). Also config.yaml rules.tasks, review-artifacts, docs/02. Do not fork openspec-propose. | design.md D6; human 2026-08-23 add spec-skill section to this change |
