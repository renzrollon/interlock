# waves Specification

## Purpose

Stops the wave planner from encoding "these two tasks cannot run at the same time" as a new wave — a new wave is a checkpoint, and a checkpoint is an agent. Path collisions become later batches of the same wave. Verification between waves is a capped, skippable policy, not an automatic consequence of ordering.

## Requirements

### Requirement: A shared file is not a reason for a new classified group

The ship classifier prompt MUST tell the model to default `group` to the numbered `tasks.md` section, to put predicted edit paths in `paths`, and to add a new group only when a later numbered section needs an earlier section's output to already exist. Sequential slices of the same file MUST remain in that file's section group. Sharing a file MUST be described as the planner's problem, not a reason to increment `group`.

The prompt MUST additionally tell the model to populate `dependsOn` on a task with the ids of the earlier tasks whose output that task needs, and MUST tell it to prefer a precise `dependsOn` edge over incrementing `group` when a task depends on another task that edits a *different* file. Incrementing `group` to order one cross-file dependency serializes every task independent of it that shares the new group; a `dependsOn` edge orders only the dependent task, so its independent siblings stay parallel. Expressing a cross-file dependency MUST therefore be described as a reason to add an edge, not a reason to increment `group`.

The prompt MUST additionally tell the model to emit a top-level `recommendedMode` of `solo` or `waves` with a one-line `modeReason`, describing solo as one agent implementing the whole change in order, and MUST tell it that the planner enforces a published envelope on that recommendation rather than stating the envelope's value.

#### Scenario: Classifier prompt forbids collision-as-group

- **GIVEN** an operator inspects the `plan-waves` prompt
- **WHEN** they read the grouping rules in `workflows/ship.js`
- **THEN** that prompt states that a shared file is not a reason for a new group and that groups default to numbered `tasks.md` sections

#### Scenario: Failure — sequential same-file slices are not a new group

- **GIVEN** the same `plan-waves` prompt
- **WHEN** an operator searches it for how to increment `group`
- **THEN** the prompt says a new group is only for a later numbered section that needs an earlier section's output
- **AND** it does not tell the model to increment `group` for the next slice of the same file

#### Scenario: Edge case — `paths` spelling still does not create a group

- **GIVEN** two tasks in section 2 that claim `src/a.ts` and `./src/a.ts`
- **WHEN** the classifier follows the prompt
- **THEN** both tasks keep group 2
- **AND** the planner, not a new group number, is what serializes the two spellings

#### Scenario: Cross-file dependency is an edge, not a new group

- **GIVEN** an operator inspects the `plan-waves` prompt
- **WHEN** they read how to express that a task depends on another task editing a different file
- **THEN** the prompt tells the model to add a `dependsOn` edge naming that earlier task
- **AND** it tells the model to prefer that edge over incrementing `group` so independent siblings are not serialized

#### Scenario: Mode recommendation is requested without its bound

- **GIVEN** an operator inspects the assembled `plan-waves` prompt
- **WHEN** they read how the classifier is told to recommend a mode
- **THEN** the prompt asks for `recommendedMode` and `modeReason` at the top level
- **AND** it names the published envelope as the planner's to enforce and does not state its numeric value

### Requirement: A task's implementation wave SHALL be its topological depth over section groups and dependency edges

The planner MUST assign each task an implementation wave equal to its topological depth in the combined partial order formed by the union of (a) the numbered section groups, which remain a barrier, and (b) the explicit `dependsOn` edges. A task's depth MUST be strictly greater than the depth of every task it depends on and every task in an earlier section group. Ordering derived from edges MUST be additive: it can only place a task in a later wave than the section model alone would, never an earlier one. Depth ties MUST be broken by ascending task id so the assignment is a pure, reproducible function of the input. The existing wave→batch→lane pipeline, including the fold of a singleton implementation wave onto the previous wave, then runs unchanged over these depths, so a lone dependent task does not buy an extra inter-wave verification.

#### Scenario: Happy path — a cross-file dependency orders without a new section

- **GIVEN** section 1 holds task `1.1` editing `src/a.ts` and task `1.2` editing `src/b.ts`, and `1.2` carries `dependsOn: ["1.1"]`
- **WHEN** `interlock waves` plans them
- **THEN** `1.2` is scheduled in a strictly later batch or wave than `1.1`
- **AND** a third section-1 task `1.3` editing `src/c.ts` with no edge remains free to run in the same batch as `1.1`

#### Scenario: Failure — an edge cannot pull a task earlier than its section

- **GIVEN** task `2.1` in section 2 and task `1.1` in section 1, where section 2 follows section 1
- **WHEN** the plan is built, even if no edge connects them
- **THEN** `2.1`'s wave is still later than `1.1`'s
- **AND** an edge is never able to schedule a later-section task before an earlier-section task

#### Scenario: Edge case — an edge-free plan keeps today's wave assignment

- **GIVEN** a classified task list in which no task carries a non-empty `dependsOn`
- **WHEN** the planner assigns waves
- **THEN** each task's wave equals its section group as before, and the resulting waves, batches, and lanes are byte-identical to the pre-dependency planner

### Requirement: A task SHALL NOT run concurrently with a task it depends on

The planner MUST NOT schedule a task concurrently with any task it depends on, directly or transitively.

- **Never concurrent.** Two such tasks MUST NOT be separate lanes of the same batch. A dependent task MUST run only after its dependency has completed: in a later batch, or later in the same lane. This MUST hold whether the two tasks are path-disjoint or share a path.
- **Within a layer.** A shared path already forces two tasks into one sequential lane. A dependency edge between path-disjoint tasks orders them across layers. In waves mode a dependency edge MUST NOT by itself join two path-disjoint tasks when lanes are formed within a layer; that lane membership remains a canonical-path collision component or a cohesion lane.
- **After batching.** A dependent task and its dependency whose lanes are each alone in consecutive batches of one wave MAY be fused into one chain lane, the dependent task positioned after its dependency.
- **Solo mode.** The whole change is one ordered lane, and every edge MUST be honoured by the dependent task's position after its dependency in that lane.

#### Scenario: Happy path — dependent path-disjoint tasks never run concurrently

- **GIVEN** path-disjoint tasks `1.1` and `1.2` form a section on their own, with `1.2` depending on `1.1`
- **WHEN** the wave is planned in waves mode
- **THEN** `1.2` runs after `1.1`: the two single-lane batches the edge produces fuse into one chain lane in which `1.1` precedes `1.2`
- **AND** `1.1` and `1.2` are never two lanes of one batch

#### Scenario: Failure — an edge-connected pair is never placed side by side

- **GIVEN** a candidate schedule that would place `1.1` and its dependent `1.2` as two lanes of the same concurrent batch
- **WHEN** the planner finalizes the wave
- **THEN** that schedule is not emitted; `1.2` is deferred to a later batch or wave, or to a later position in a chain lane after `1.1`

#### Scenario: Edge case — a diamond dependency serializes only along its edges

- **GIVEN** `1.2` and `1.3` each depend on `1.1`, `1.4` depends on both `1.2` and `1.3`, all four are tier 4, and all four edit different files
- **WHEN** the plan is built in waves mode
- **THEN** `1.1` runs first, `1.2` and `1.3` share a batch as two concurrent lanes after it, and `1.4` runs after both
- **AND** `1.2` and `1.3`, having no edge between them, are not serialized relative to each other
- **AND** no chain lane is formed, because the middle batch runs two lanes

#### Scenario: Edge case — a solo lane honours the same diamond by order

- **GIVEN** the same diamond
- **WHEN** the plan is built in solo mode
- **THEN** the single lane orders `1.1` before `1.2` and `1.3`, and both before `1.4`

### Requirement: Singleton implementation waves fold onto the previous wave

After classified groups have been turned into implementation waves and path collisions have been packed into batches, the planner MUST fold every implementation wave that contains exactly one task onto the immediately previous implementation wave, as later batches of that wave, preserving task order.

- **Group number.** The surviving wave keeps the previous wave's group number.
- **Recording.** Each fold MUST be recorded on the plan: `folded` entries, and a warning naming the task id, the group it left, and the group it joined.
- **What never folds.** The trailing test wave MUST NOT fold into an implementation wave, and implementation waves MUST NOT fold into the test wave. A one-task implementation wave with no previous implementation wave remains a wave. Two consecutive implementation waves that each contain two or more tasks MUST stay separate waves.
- **Then fusion.** Once folding is done, the wave's batches are subject to chain fusion, so a folded staircase of single-lane batches ends as chain lanes rather than as one agent per batch.

Rationale: a 1-task wave is ordering, not a checkpoint. Each extra wave still spawns a record ping and, until the cap, an inter-wave verify ping.

#### Scenario: Happy path — a same-file staircase becomes one wave

- **GIVEN** six tier-2 implementation tasks in groups 2 through 7, each group holding one task, all claiming `src/planet_wars_engine/match_runner.py`
- **WHEN** `interlock waves` plans them
- **THEN** the plan has `waveCount` 1, and `folded` lists the five tasks that left groups 3–7
- **AND** the wave's six single-lane batches fuse into one chain lane that runs the six tasks in task-id order
- **AND** `formatPlan` does not include an "effectively serial" warning for that collapsed staircase

#### Scenario: Failure — a singleton is not allowed to stay a checkpoint after a previous impl wave

- **GIVEN** group 9 holds two implementation tasks and group 12 holds one implementation task, with group 12 following group 9
- **WHEN** `interlock waves` plans them
- **THEN** group 12 is not a separate wave
- **AND** its task runs after group 9's tasks inside the wave whose group is 9: as a later batch, or, when group 9's tasks occupy one lane, as the last task of the chain lane fused from them

#### Scenario: Edge case — the test wave and a leading singleton are not folded away

- **GIVEN** one implementation task in group 1, no other implementation groups, and sixteen test tasks
- **WHEN** `interlock waves` plans them
- **THEN** the plan has one implementation wave (group 1) and a trailing test wave that still contains every test task
- **AND** two consecutive implementation waves that each contain two or more tasks remain two waves, even when a test wave follows

### Requirement: Creating a run does not merge planned batches

When `interlock wave-state create` starts a run from a plan, it MUST keep the plan's batch boundaries. It MAY split a batch whose width exceeds this run's `maxParallel`. It MUST NOT move a task into an earlier batch than the plan assigned, including when that later batch was created by folding a disjoint-path singleton and `maxParallel` is large enough that a flatten-and-repack would have co-scheduled them.

#### Scenario: Happy path — collision batches stay collision batches

- **GIVEN** `interlock waves` emitted three batches for one file
- **WHEN** `wave-state create` starts a run from that plan with `maxParallel` larger than 1
- **THEN** the run still has three batches for that wave

#### Scenario: Failure — a folded disjoint-path later batch is not pulled forward

- **GIVEN** a plan wave whose batch 0 claims `src/match_runner.py` and whose batch 1 (a folded singleton) claims `scripts/run_match.py`
- **WHEN** `wave-state create` starts a run with `maxParallel` at least 2
- **THEN** those two tasks remain in different batches, with the `run_match.py` task in a later batch
- **AND** they are not placed in the same concurrent batch

#### Scenario: Edge case — a batch wider than the runtime cap is split, not merged with its neighbor

- **GIVEN** a planned batch of 10 disjoint-path tasks followed by a later planned batch of 1 task, and the run's `maxParallel` is 8
- **WHEN** `wave-state create` starts the run
- **THEN** the first planned batch is split to fit 8
- **AND** the later planned task is still not in the first runtime batch

### Requirement: Inter-wave verification is capped and skippable

Finishing a wave MUST NOT unconditionally enter the verify phase. The run MUST skip the checkpoint when every claimed path in the completed wave is documentation (`*.md`/`*.mdx`/`*.txt`/`*.rst`/`*.adoc`, or under `doc/`/`docs/`/`openspec/`/`.claude/`), or when the run has already consumed `LIMITS.interWaveVerifications` checkpoints. A skipped checkpoint MUST be recorded with a non-empty reason and MUST advance to the next wave. A wave whose tasks omit `paths`, or that claims any non-docs path, MUST still be eligible for a checkpoint if the cap has not been spent. Verification MUST still never run after the final wave.

#### Scenario: Docs-only wave skips verify

- **WHEN** wave 1's tasks only claim `docs/foo.md` and `README.md`, and wave 2 follows
- **THEN** `record-batch` of wave 1's last batch advances to wave 2's first batch without a `verify` step, and the skip reason is recorded

#### Scenario: Cap stops further checkpoints

- **WHEN** a run has already completed `LIMITS.interWaveVerifications` inter-wave checks and another impl wave finishes with a following wave
- **THEN** the next step is the following wave's batch, not `verify`, and the skip is recorded

#### Scenario: Limits names the cap

- **WHEN** an operator runs `interlock limits`
- **THEN** the output includes the per-run inter-wave verification cap as a positive integer

### Requirement: Plan preview names the agent bill

`formatPlan` MUST print a projected agent count for the wave loop: implementers, record pings and inter-wave verifies.

- **Serial warning.** It MUST warn that a plan is effectively serial when the plan holds at least two implementation lanes before chain fusion and its wave count exceeds half that pre-fusion lane count. A chain the planner has already fused MUST NOT by itself trigger the warning.
- **Implementer count.** The implementer count MUST be the number of lanes the plan dispatches, after fusion, not the number of tasks it contains, because one lane is one agent however many tasks it carries.
- **Folds.** Every lane holding more than one task MUST be reported in the plan preview with its kind — collision, cohesion, chain or solo — and the model it dispatches on, alongside the existing collision reporting, so a fold is visible rather than inferred from a smaller agent count.
- **Mode and promotions.** The preview MUST open by naming the plan's mode and the source of that decision, and MUST print every model promotion a solo plan made beside the existing clamp report.

#### Scenario: Serial plan warns

- **WHEN** 10 implementation tasks are classified into 8 waves with no lane folding possible
- **THEN** `formatPlan` includes a warning that the plan is effectively serial and prints a projected agent count larger than the lane count

#### Scenario: Happy path — the bill counts lanes, not tasks

- **GIVEN** a plan whose single wave holds one lane of 4 tasks and two lanes of 1 task
- **WHEN** `formatPlan` renders the plan
- **THEN** the projected implementer count is 3
- **AND** the preview names the 4-task lane as a fold with its kind and the model the hardest tier selects

#### Scenario: Happy path — a fused chain lowers the bill

- **GIVEN** a wave planned as four consecutive single-lane batches that fuse into one chain lane
- **WHEN** `formatPlan` renders the plan
- **THEN** the projected implementer count for that wave is 1, not 4
- **AND** the preview names the lane as a chain on the model its hardest tier selects

#### Scenario: Edge case — a plan in which every lane holds one task

- **GIVEN** a plan with no path collisions, no cohesion-eligible siblings and no consecutive single-lane batches, so every lane holds exactly one task
- **WHEN** `formatPlan` renders the plan
- **THEN** the projected implementer count equals the task count
- **AND** no fold is reported, rather than a fold of size one being listed

#### Scenario: Solo preview names the mode and the bill

- **GIVEN** a solo plan of twelve tasks decided by the classifier
- **WHEN** `formatPlan` renders it
- **THEN** its first line names the mode as solo with source `classifier` and the reason
- **AND** the projected agent count is one implementer plus one record ping and no verify pings
- **AND** every promoted task is listed beside the clamp report

### Requirement: Next step includes remaining batches of the current wave

A `run-batch` or `test-wave` step MUST include `remainingBatches`: the lane arrays from the current `batchIndex` through the end of that wave, in order. `tasks` remains the current batch (the first remaining batch). Each entry of a batch is a lane — an ordered list of tasks executed by one agent — so a caller fans out one agent per lane, not one per task. Callers MAY run those batches sequentially and record them in one ping; they MUST still record through `wave-state record-batch` so halt policy stays in the CLI.

#### Scenario: Mid-wave step lists the rest of the wave

- **WHEN** a wave has three batches and the cursor is on batch 0
- **THEN** `wave-state next` includes `remainingBatches` of length 3 and `tasks` equal to `remainingBatches[0]`, and each entry of each batch is a lane rather than a bare task

#### Scenario: Wave-entry next logs every remaining implementer once

- **WHEN** a wave has three path-serialized batches and `wave-state next` is at batch 0
- **THEN** the ship-run trajectory contains one `agent-spawn` per lane across `remainingBatches`, and a subsequent `record-batch --write-state` of batch 0 does not append duplicate spawns for later batches

#### Scenario: Creating a run does not merge collision batches

- **WHEN** `planWaves` emitted three batches for one wave and `wave-state create` starts a run from that plan
- **THEN** the run still has three batches for that wave, even when `maxParallel` is larger than the number of lanes, and no lane is moved into an earlier batch than the planner assigned it

#### Scenario: Failure — spawns are counted per lane, not per task

- **GIVEN** a wave whose batches hold one lane of 3 tasks and one lane of 1 task
- **WHEN** the trajectory for that wave is read
- **THEN** it contains two `agent-spawn` records, not four

### Requirement: Per-task handoff is a fixed schema

Every implemented task MUST be accounted for by a handoff object with `schema`, `taskId`, `status` (`ok`, `blocked`, or `partial`), `summary`, `evidence` (array of strings), `next`, and `blocker` (string or null). `status=ok` MUST have a null `blocker`. `status=blocked` MUST have a non-empty `blocker`. `evidence` entries MUST be locators (`path` or `path:line` / `path:start-end`), not pasted file bodies. A lane result MUST carry one such packet per task it attempted, keyed by `taskId`, rather than one packet per agent result; a single packet standing in for several tasks MUST be rejected. Tasks the lane did not attempt carry no packet, and that absence MUST NOT be treated as an invalid result. This packet is distinct from the opt-in `--handoff` artifacts (`manual-test-plan.md`, `code-explanation.md`, memory).

A packet that does not meet this schema is rejected, and what a rejected packet does to its task is stated by "A rejected packet SHALL fail closed without failing a task that reported success".

#### Scenario: Successful task reports ok with no blocker

- **WHEN** a task completes and returns `ok:true` with a handoff `{ status: "ok", blocker: null, summary, evidence, next }`
- **THEN** `interlock wave-state record-batch` accepts the task as succeeded and stores the packet on the run

#### Scenario: Blocked task requires a blocker string

- **WHEN** a task returns `ok:true` with a handoff whose `status` is `"blocked"` and whose `blocker` is missing or empty
- **THEN** `record-batch` rejects the packet with an invalid-handoff reason and does not store it
- **AND** the task is recorded as done with a rejected report, not as failed

#### Scenario: Happy path — a lane returns one packet per attempted task

- **GIVEN** a lane of three tasks that all complete
- **WHEN** the lane returns its result
- **THEN** it carries three packets, one per `taskId`, and `record-batch` accepts all three tasks as succeeded

#### Scenario: Failure — one packet cannot stand in for several tasks

- **GIVEN** a lane of three attempted tasks, each reported as succeeded, whose result carries a single packet
- **WHEN** `record-batch` processes the result
- **THEN** the two tasks without their own packet are recorded as done with a rejected report naming the missing packet
- **AND** the lone packet is not applied to more than the task whose `taskId` it names

#### Scenario: Edge case — an unattempted task carries no packet

- **GIVEN** a lane of three tasks in which the second fails, so the third is never attempted
- **WHEN** `record-batch` processes the result
- **THEN** the first task's packet is stored, the second is recorded as failed, and the third's absent packet is not itself an invalid-handoff error

### Requirement: Next wave is handed validated packets, not git inference

When the state machine asks for the next `run-batch` or `test-wave` after a prior implementation wave, the step payload MUST include the stored handoff packets from the **immediately previous wave only**. Each implementer prompt for that batch MUST include those packets as structured text and MUST NOT instruct the agent to reconstruct the previous wave from `git log` / `git status` as a substitute for the packet. Fresh-agent isolation is unchanged: one agent per task, no orchestrator-context implementation.

#### Scenario: Wave 2 sees wave 1 packets

- **WHEN** wave 1's tasks recorded valid handoffs and `wave-state next` asks to run wave 2
- **THEN** the step includes those handoff objects, and each wave 2 implementer prompt contains their `status`, `summary`, `evidence`, `next`, and `blocker` fields

#### Scenario: Wave 3 does not accumulate wave 1

- **WHEN** wave 3 starts after wave 2 completed
- **THEN** the injected packets are wave 2's only — wave 1's packets are not appended

#### Scenario: Remaining batches of a wave share the previous wave, not each other

- **WHEN** wave 2 has three path-serialized batches and `wave-state next` is at batch 0
- **THEN** `previousHandoffs` is wave 1's packets on that step, every remaining batch's implementer prompt receives those same packets, and batch 1 does not receive batch 0's handoff

### Requirement: A recorded batch SHALL retain the paths each task changed

Recording a batch result SHALL store, per task, the set of paths that task reported changing, alongside the task's handoff packet. This set is currently requested from every implementer and discarded; it MUST be retained, because it is the cross-check against the packet's own evidence and it cannot be recovered later once the working tree moves on.

The retained set MUST be treated as a report, distinct from an observed path set, and MUST NOT be presented as evidence that those paths changed.

#### Scenario: Happy path — reported paths survive the recording

- **GIVEN** a task result reporting `filesChanged: ["lib/export.mjs", "test/export.test.mjs"]` with a valid packet
- **WHEN** the batch result is recorded
- **THEN** the stored state carries both paths for that task alongside its packet

#### Scenario: Failure — a task reporting no paths is recorded without inventing any

- **GIVEN** a task result with a valid `ok` packet and no reported changed paths
- **WHEN** the batch result is recorded
- **THEN** the stored entry carries an empty reported-path set for that task
- **AND** the recording does not substitute the packet's evidence locators for the missing report

#### Scenario: Edge case — a task not attempted retains no path set

- **GIVEN** a lane of three tasks in which the second fails and the third is never attempted
- **WHEN** the batch result is recorded
- **THEN** the third task has no reported-path entry, and that absence is not itself an error

### Requirement: Retaining paths and verdicts SHALL NOT add a way for a run to stop

Storing reported paths and evidence-audit verdicts on the run state SHALL leave every existing halt condition, failure budget, verification cap, and replan rule unchanged. No new field introduced for auditing may be read by a halt decision.

#### Scenario: Happy path — halt conditions are unchanged by the new fields

- **GIVEN** a run whose accumulated task failures are one below the failure-budget halt
- **WHEN** a batch records successfully with unconfirmed audit verdicts on every packet
- **THEN** the run does not halt and the failure count is unchanged

#### Scenario: Failure — an oversized or invalid packet still fails closed as before

- **GIVEN** a task returning a packet whose counted characters exceed the published handoff cap
- **WHEN** the batch result is recorded
- **THEN** the packet is rejected with the over-budget reason exactly as before and is not stored
- **AND** no audit verdict is stored for that task

#### Scenario: Edge case — a state written before these fields existed records normally

- **GIVEN** an in-flight run state written before reported paths and audit verdicts were retained
- **WHEN** a further batch result is recorded against it
- **THEN** the missing containers are initialized rather than treated as a malformed state, and the run continues

### Requirement: A recorded batch SHALL report its per-task outcomes to its caller

Recording a batch result SHALL report, to the caller that recorded it, the outcome the state machine assigned to each task in that batch: the task id, whether it was recorded as succeeded, failed, or not attempted, and the reason when it was not succeeded. For a task recorded as succeeded whose report was rejected, the report SHALL also say so and SHALL carry the rejection reason. The report SHALL describe only the batch just recorded, not the run's accumulated history.

This exists because the recorded verdict and the reported claim can differ, and today only the claim reaches the caller. A batch result may be adjudicated on arrival — an invalid or over-budget handoff packet has its report rejected, a lane result that omits an outcome fails every task in the lane — and a caller that receives only the next action has no way to learn that a task it was told succeeded was recorded as failed, or that a task recorded as succeeded left no usable report. Every downstream decision that asks "what did this task do" is then made against the wrong answer.

The reason SHALL be a short adjudication reason, not a transcript: it MUST be safe to place in a machine-copied payload, and MUST NOT carry handoff bodies, suite output, or diffs.

#### Scenario: Happy path — a fully succeeded batch reports each task as recorded

- **GIVEN** a batch of two tasks whose results are both valid and successful
- **WHEN** the batch result is recorded
- **THEN** the caller receives an outcome for each of the two task ids, both recorded as succeeded, alongside the next action
- **AND** neither outcome is marked as having a rejected report

#### Scenario: Failure — an adjudicated task reports as failed with its reason

- **GIVEN** a batch of two lanes in which one lane's result omits an outcome for a task it was given
- **WHEN** the batch result is recorded
- **THEN** the caller receives every task of that lane as recorded-failed, with the adjudication reason naming the omitted task
- **AND** the other lane's task is reported as recorded-succeeded, so one bad lane does not blur the batch into a single verdict

#### Scenario: Edge case — a rejected report travels with a succeeded outcome

- **GIVEN** a batch of two tasks in which one reports success with a handoff packet whose status is outside the accepted set
- **WHEN** the batch result is recorded
- **THEN** the caller receives that task's id as recorded-succeeded and marked as having a rejected report, with the reason naming the invalid status
- **AND** the other task's id is reported as recorded-succeeded with no such mark

#### Scenario: Edge case — a batch whose tasks were all not attempted reports them as such

- **GIVEN** a lane whose first task failed, leaving the two behind it reported as not attempted
- **WHEN** the batch result is recorded
- **THEN** the two tasks are reported as recorded not-attempted, distinct from recorded-failed
- **AND** the report distinguishes them from tasks absent from the batch entirely, which are not reported at all

### Requirement: An isolated lane SHALL see every earlier fold of the run

Under `--isolate-waves`, the tree a lane is forked from MUST include the folded writes of every earlier batch and every earlier wave of the same run, including files those lanes created and files that are still untracked in the shared tree. A batch deferred because it shares a path with an earlier batch therefore edits the current file, and its fold MUST carry both its own edit and the earlier batch's. This is why no cross-batch collision check exists: the whole-file fold is correct because the file it copies already holds the earlier work.

#### Scenario: Happy path — a collision-deferred batch keeps the earlier batch's edit

- **GIVEN** a wave whose batch 0 holds a lane that appends a line to `lib/a.mjs` and whose batch 1 holds a lane deferred for sharing `lib/a.mjs`
- **WHEN** batch 0 folds, batch 1 is forked, edits the first line of `lib/a.mjs`, and folds
- **THEN** the shared tree's `lib/a.mjs` holds both the appended line and the edited first line
- **AND** no collision is reported, because the two batches never ran concurrently

#### Scenario: Happy path — a wave-2 lane finds the file a wave-1 lane created

- **GIVEN** an isolated run in which a wave-1 lane creates `lib/new.mjs` and the fold applies it to the shared tree, where it is untracked
- **WHEN** the first wave-2 batch is emitted
- **THEN** the tree of that batch's merge base lists `lib/new.mjs`
- **AND** a lane worktree forked from that base contains it

#### Scenario: Failure — a lane forked from the pre-run commit is refused, and the earlier edit survives

- **GIVEN** the same two-batch wave, where batch 1's lane worktree was created from the pre-run HEAD instead of the batch's merge base
- **WHEN** batch 1 is recorded
- **THEN** the run halts with `LANE BASE MISMATCH` naming the lane, HEAD's sha and the snapshot's sha
- **AND** `lib/a.mjs` in the shared tree still holds batch 0's appended line, unchanged by batch 1

#### Scenario: Edge case — the first isolated batch of a run on a clean tree has nothing earlier to see

- **GIVEN** an isolated run started on a working tree identical to HEAD
- **WHEN** the first isolated batch is emitted
- **THEN** its merge base is HEAD and a lane forked from it holds exactly the committed tree

### Requirement: A rejected packet SHALL fail closed without failing a task that reported success

The total character count of `summary`, `next`, `blocker`, and joined `evidence` MUST NOT exceed the `maxHandoffChars` cap published by `interlock limits`. A missing handoff, an unknown `status`, a wrong field type, an entry that is not a locator, or over-budget text MUST reject the packet. A rejected packet MUST NOT be stored, MUST NOT be truncated to fit, and MUST NOT be passed through as prose for the next wave to interpret. The cap MUST live in the limits CLI, not in workflow prompt text.

What a rejected packet does to its task depends on what the task reported about itself. A task that reported success MUST be recorded as done with a rejected report carrying the validation reason; it MUST NOT be recorded as failed. A task that reported failure MUST be recorded as failed with its own reason, and a rejected or absent packet MUST NOT replace that reason.

It is the packet that fails closed, not the task. A packet's shape was never evidence that the work was done: a well-formed packet is recorded on the same claim a rejected one arrives with, and the evidence audit is recorded without gating anything. Failing the task for the shape of its report threw away finished work and told the reader it had not been done.

#### Scenario: Happy path — an over-budget packet is rejected and its task stays done

- **GIVEN** a task that reports success with a valid-shaped handoff whose counted characters exceed `maxHandoffChars`
- **WHEN** `record-batch` records the result
- **THEN** the packet is rejected with an over-budget reason and is not stored as a wave handoff
- **AND** the task is recorded as done with a rejected report carrying that reason

#### Scenario: Limits names the cap

- **WHEN** an operator runs `interlock limits`
- **THEN** the output includes the per-task handoff character cap as an integer

#### Scenario: Failure — a task that reported failure keeps its own reason

- **GIVEN** a task that reports `ok:false` with the error `could not resolve the build` and no packet
- **WHEN** `record-batch` records the result
- **THEN** the task is recorded as failed with `could not resolve the build`
- **AND** no rejected report is recorded for it

#### Scenario: Edge case — the cap is a boundary, not a neighbourhood

- **GIVEN** two tasks that report success, one whose counted characters equal `maxHandoffChars` exactly and one whose counted characters exceed it by one
- **WHEN** `record-batch` records the result
- **THEN** the first packet is stored whole and the second is rejected
- **AND** neither packet is shortened

### Requirement: A rejected report SHALL NOT count toward the task-failure halt

Rejected reports SHALL be kept on the run state in a record of their own, apart from task failures, each naming its task, its wave and the rejection reason. The task-failure halt SHALL count only tasks recorded as failed, and SHALL NOT read the record of rejected reports. A run SHALL NOT halt because of rejected reports, however many accumulate.

A run state that carries no such record SHALL have it initialized when the next batch is recorded, and SHALL NOT be treated as malformed. A task that an earlier version recorded as failed for an invalid packet SHALL remain the failure it was recorded as.

The failure cap exists because a run that has lost several tasks is not producing a coherent change. A rejected report loses a packet, not a task, and whether the work is sound is established by verification, which gates the commit either way.

#### Scenario: Happy path — three green tasks with malformed packets do not halt the run

- **GIVEN** a batch of three tasks that each report success, the first with an evidence entry `src/DeviceMetricSource.cs:31-73,89`, the second with a packet of 3562 counted characters, and the third with an empty `next`
- **WHEN** the batch result is recorded
- **THEN** the run does not halt and all three tasks are recorded as done
- **AND** three rejected reports are recorded, one per task, each with its own reason
- **AND** the run's count of task failures is zero

#### Scenario: Failure — real failures still halt, and rejected reports do not move the count

- **GIVEN** a run holding as many recorded task failures as the published cap tolerates, and four rejected reports
- **WHEN** one more task reports failure and its batch is recorded
- **THEN** the run halts on the task-failure cap
- **AND** the halt reason counts the failed tasks alone, not the rejected reports

#### Scenario: Edge case — a state from an earlier version is read as it was recorded

- **GIVEN** an in-flight run state written before rejected reports were recorded, whose failures include two tasks failed for invalid packets
- **WHEN** a further batch result is recorded against it
- **THEN** the record of rejected reports is initialized rather than the state being treated as malformed
- **AND** the two earlier failures remain failures and remain counted toward the halt

### Requirement: The next wave SHALL be told which previous-wave tasks filed no usable report

When the state machine asks for the next `run-batch` or `test-wave` after a prior wave, the step payload MUST name each task of the **immediately previous wave** whose report was rejected: its task id, the rejection reason, and the paths that task reported changing. Each implementer prompt for that batch MUST state those tasks as having filed no validated report, in a block separate from the validated packets, and MUST NOT carry any text of a rejected packet. When the previous wave holds no rejected report, the step and every prompt assembled from it MUST be what they would have been before this requirement existed.

A task whose report was rejected is otherwise absent from what the next wave is handed, and a silent absence reads as a task that had nothing to say.

What is handed on for a rejected report MUST NOT exceed what a valid packet may carry. The rejection reason MUST be a short adjudication reason on a single line: where it quotes a value from the rejected packet to say what was wrong with it, the quote MUST be escaped so that it cannot break the line and MUST be clipped to a short diagnostic, never the value in full. The reason MUST be bounded where it is recorded on the run state, so every reader of that record holds the same short reason. The reported paths MUST be listed only while each is a single line and the list fits the `maxHandoffChars` cap published by `interlock limits`; paths left out MUST be counted and the count stated, never dropped in silence. A report whose paths all fit MUST be handed on exactly as it would be without this bound.

The reported paths are the task's own unvalidated strings. Without a bound, a task whose packet was rejected for being too long could hand the next wave more text through its reason and its path list than a task whose packet was accepted.

#### Scenario: Failure — a rejected packet's text does not ride in on the reason or the paths

- **GIVEN** wave 1 in which task `1.2` reported success with an evidence entry holding several thousand characters of pasted file body spread over several lines, and reported forty long paths followed by a multi-line paragraph offered as a path
- **WHEN** wave 2's step and implementer prompts are assembled
- **THEN** the rejection reason is a single line that names the evidence entry as not a locator and quotes only a clipped piece of it
- **AND** the paths listed are a prefix of the reported paths that fits the published handoff cap, none of them multi-line
- **AND** the step states how many reported paths were left out, and each prompt says so beside the listed paths

#### Scenario: Happy path — the next wave is told a task left no report

- **GIVEN** wave 1 in which task `1.2` reported success, reported changing `src/a.cs`, and had its packet rejected as over budget
- **WHEN** `wave-state next` asks to run wave 2
- **THEN** the step names `1.2`, its rejection reason and `src/a.cs`
- **AND** each wave 2 implementer prompt names `1.2` as having filed no validated report, apart from the validated packets of wave 1

#### Scenario: Failure — nothing of a rejected packet reaches the next wave

- **GIVEN** wave 1 in which task `1.2`'s rejected packet carried a `summary` of a known distinctive sentence
- **WHEN** wave 2's step and implementer prompts are assembled
- **THEN** that sentence appears in neither the step nor any prompt

#### Scenario: Edge case — no rejection leaves the prompt as it was, and only the previous wave is named

- **GIVEN** a run in which wave 1 held one rejected report and wave 2 held none
- **WHEN** wave 3's step and implementer prompts are assembled
- **THEN** the step names no rejected report, because wave 1's is not carried forward
- **AND** each wave 3 prompt is byte-identical to the prompt assembled for the same lane with no rejected report anywhere in the run

### Requirement: Unresolved inter-wave checks SHALL warn, be carried forward, and never halt the run

A failed inter-wave check MUST buy the wave the published number of targeted fix attempts, as before. When those are spent and the check still fails, the run MUST record the wave's unresolved errors, raise a warning naming the wave, how many errors remain and how many attempts were spent, and advance to the next wave. It MUST NOT halt, whether or not the verdict reported that the errors block the next wave; that verdict MUST still be recorded beside the unresolved errors. Every batch of the wave that follows MUST be handed those errors, at most ten of them and each cut to 300 characters, and the implementer briefing for that batch MUST carry them under a section saying which checks were still failing after which wave, so the agent knows what it is building on. A briefing for a batch that follows no unresolved wave MUST carry no such section and MUST read exactly as before. An inter-wave check whose verification agent reported no result for a planned check — it was stopped, or its copy was lost — MUST be recorded as a skipped verification whose reason names the unreported checks, with its banner, and the run MUST advance. The final verification is not an inter-wave check: a red or unverified final suite MUST still stop the run before it commits.

#### Scenario: Happy path — red after both fix attempts, the run moves on

- **GIVEN** a run at wave 2's checkpoint whose typecheck still fails after both published fix attempts, and whose verdict reported the errors block wave 3
- **WHEN** the third failed result is recorded
- **THEN** the next step is wave 3's first batch, not a halt
- **AND** the run's unresolved errors name wave 2, its errors and that the verdict reported them as blocking, and a warning names wave 2 and the error count
- **AND** the step carries an `INTER-WAVE CHECKS UNRESOLVED` banner naming wave 2, the error count and the attempts spent

#### Scenario: Happy path — the next wave is told what is still failing

- **GIVEN** the same run
- **WHEN** wave 3's first batch is dispatched
- **THEN** each of its implementer briefings carries a section naming the checks still failing after wave 2 and lists wave 2's errors
- **AND** a briefing in a run with no unresolved wave carries no such section

#### Scenario: Edge case — many long errors are bounded

- **GIVEN** a wave left with fourteen unresolved errors, one of them 2,000 characters long
- **WHEN** the next wave's batch is dispatched
- **THEN** its briefings list ten errors, and none is longer than 300 characters

#### Scenario: Edge case — a checkpoint nobody reported on is skipped, not a stop

- **GIVEN** a run at wave 1's checkpoint whose plan holds a unit check, and a verification agent that returned no result
- **WHEN** `interlock run judge --context inter-wave` reads the empty report
- **THEN** the next step is wave 2's first batch
- **AND** the run's skipped verifications name wave 1 with a reason saying no result was reported for `unit`, and the step carries `VERIFICATION SKIPPED` with that reason

#### Scenario: Failure — the final suite still refuses to commit

- **GIVEN** a run whose waves all finished, one of them with unresolved inter-wave errors
- **WHEN** the final verification reports a red unit suite
- **THEN** the run halts before the commit, as before

### Requirement: A task that depends on a task that did not complete SHALL be skipped, not dispatched

When a batch is recorded, every task the run has not dispatched yet — in the remaining batches of the current wave and in every later wave — whose `dependsOn` names a task that was dispatched and did not complete (recorded as failed, or left not attempted after its lane stopped) or a task already skipped this way, directly or through a chain of such tasks, MUST be removed from the run before the next step is chosen. Each removed task MUST be recorded with its wave and the tasks it depended on that blocked it. A lane, batch or later wave left with no task MUST be removed with it. A skipped task MUST NOT be dispatched, MUST NOT be ticked, and MUST NOT count toward the task-failure halt, and the step that recorded the batch MUST carry a `DEPENDENTS SKIPPED` banner naming each newly skipped task and what it needed. Only `dependsOn` edges are read: a later numbered section is not a dependency of the earlier one. A task already dispatched beside the failed one is not affected.

#### Scenario: Happy path — a direct and a transitive dependent are skipped

- **GIVEN** a run whose wave 2 records task 2.1 as failed, whose wave 3 holds 3.1 depending on 2.1, 3.2 depending on 3.1, and 3.3 depending on nothing
- **WHEN** wave 2's batch is recorded
- **THEN** wave 3 holds only 3.3, and 3.1 and 3.2 are recorded as skipped, 3.1 needing 2.1 and 3.2 needing 3.1
- **AND** the step carries `DEPENDENTS SKIPPED` naming 3.1 and 3.2, and the run's task-failure count is one

#### Scenario: Edge case — a wave emptied by skipping is removed

- **GIVEN** a run whose wave 3 holds only tasks that depend on a task wave 2 failed
- **WHEN** wave 2's last batch is recorded
- **THEN** wave 3 is gone from the run, and the next step is the wave after it, or the run's end when there is none
- **AND** no checkpoint is spent on a wave that ran nothing

#### Scenario: Edge case — the remaining batches of the current wave are pruned too

- **GIVEN** a wave of two batches whose first records 1.1 as failed, and whose second holds 1.4, which depends on 1.1, and 1.5, which does not
- **WHEN** the first batch is recorded
- **THEN** the second batch dispatches 1.5 alone, and 1.4 is recorded as skipped

#### Scenario: Edge case — a task its lane never reached blocks its dependents too

- **GIVEN** a lane holding 1.1 and 1.2 that stopped when 1.1 failed, and a later task 2.1 that depends on 1.2
- **WHEN** the batch is recorded
- **THEN** 2.1 is recorded as skipped needing 1.2, and the run's task-failure count is one

#### Scenario: Failure — three real failures still halt

- **GIVEN** a run with two recorded task failures and four skipped dependents
- **WHEN** a third task is recorded as failed
- **THEN** the run halts on the task-failure cap, and the skipped tasks are not counted in its failures
