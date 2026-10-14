## Context

See proposal.md — Why. Three constraints shape every decision below:

- **The Workflow script can touch nothing.** `workflows/ship.js` has no filesystem, shell or clock of its own; every `interlock` call is a relay, a model that writes files, runs one command and retypes stdout. A relay can mis-order its tools, rerun a command, or garble a copy, and the script cannot observe which.
- **The CLI already refuses a call it did not ask for.** `checkSequence` compares each `run` call to the continuation the last step named. It catches a skipped or invented call. It cannot catch a repeat of a call whose continuation is the same argv (an inter-wave `run judge` that asks for another `run judge`), and it never sees a stale input file, which is read after the guard passes.
- **The run state machine is pure.** `lib/waves.mjs` decides from the state and one result; it reads no file and spawns nothing. Any new behaviour in it is a state transition, testable without a CLI.

## Goals / Non-Goals

**Goals:**

- A relay that mis-orders, reruns or garbles can neither record the wrong input nor halt a run whose CLI answered.
- An acknowledgement that proves the worker had the briefing in hand survives a dropped character.
- An inter-wave checkpoint informs the next wave and stops nothing.
- A task that did not complete stops costing the agents that would have built on it.

**Non-Goals:**

- Changing the task-failure cap or the lost-agent rule (proposal — What Changes, "Left as it is").
- Making the relay copy smaller. The 27 KB verify result is a separate problem; recovery gives that case a second chance, nothing more.
- Teaching the runner host (`bin/interlock-run`) to envelope its inputs. It reads stdout as a process and has no relay to miss.
- Resuming a halted run. The resume card and plan reuse are unchanged.

## Decisions

### D1. A per-root step counter, not a random call id

Each emitted step carries `seq`, kept on the manifest. `run start` seeds the new manifest's counter from the manifest it replaces, so the count runs across runs in one root.

*Why not a random id per driver launch:* the Workflow script has no clock or random source it is known to be allowed (it uses neither today), so the id would have to come from the CLI — a second field to forward for what a counter already gives. *Why across runs:* a counter that restarted at 1 would let a `results.json` left by a dead run answer step 7 of the next run, which is the stale-file defect again with a different run's bytes.

The stamp is applied in `bin/interlock` at the one place every `run` subcommand's JSON is printed (`emitRunStep` for every subcommand but the close, the close's own `emit` for it), through a helper exported from `lib/run.mjs`. A step emitted with no manifest (a `run start` that could not resolve its change, a subcommand reached before any run) carries no `seq`, and the driver treats a missing `seq` as "cannot recover", which is today's behaviour.

### D2. Inputs answer a step; the check runs before anything is read into the run

The envelope is `{"answers": <seq>, "value": <payload>}`, recognised only when those are its only keys and `answers` is an integer — `--host-observed` is itself an object, so a looser test would misread it. The check runs in the `run` case of `bin/interlock`, after the sequence guard and before any subcommand runs, so a refusal leaves the manifest, state, trajectory and task list exactly as they were, and exits through `die` (non-zero, stderr). A refused call never stamps a `seq`.

For `run close` the bound is "a step of the current run" (`seqStart ≤ answers ≤ seq`): the close is exempt from the sequence guard because a driver closes from wherever it is, including after a relay it could not read, when its last-read step lags the CLI's by one.

*Alternative considered:* consume-on-read (rename each input after reading it). It defeats the stale file, but a guard refusal happens before the read, so a refused call would leave its file for the next call to consume; and it does nothing for the rerun of a call whose continuation repeats its own argv. *Alternative considered:* one heredoc command that writes and runs in a single Bash call. It removes the ordering race, but the Workflow harness indents every line of computed text, and a heredoc terminator copied with that indent never terminates.

### D3. Recover from the CLI's record, keyed by `seq`

On a copy that does not parse, the driver relays `cat` of the record file and compares its `seq` with the last step it read (`lastSeq`):

| record `seq` | meaning | driver does |
| --- | --- | --- |
| `lastSeq + 1` (close: any greater) | the call took effect; only the copy was lost | continues from the record |
| `lastSeq` | the call never took effect (refused input, refused sequence, relay gave up) | relays the same call once more, same writes |
| anything else, or unreadable | cannot tell | stops, quoting the relay's copy |

The read is a separate relay rather than a field of the first one so it is read-only by construction: rereading cannot change the run. The re-relay is safe for the same reason D2 is: if the first attempt did take effect after all, the second is refused as stale or out of sequence and changes nothing. Recovery is bounded at one read and one re-relay per call — a relay that cannot copy three times in a row is not a transport blip.

`run close` keeps not writing `last-step.json` (the halt reason points a reader at it) and writes `last-close.json` instead, so a close has its own record to recover from.

### D4. Acknowledgement by 16-character prefix, canonicalised

The bootstrap already prints the expected hash, so the acknowledgement proves the worker followed the bootstrap, not that it computed anything. Sixteen hex characters are 64 bits — no worker produces them by accident — and a model retyping 64 characters of hex drops or swaps one often enough to have cost a finished wave. The driver records the canonical hash so every reader downstream (the recorder join, the trajectory) sees one value per spawn. *Alternative considered:* a short token printed only inside the briefing file. It is a stronger proof of reading but changes the CLI, both drivers, the recorder hook and every briefing fixture; it is deferrable and this change does not need it.

### D5. The inter-wave verdict keeps its words and loses its halt

`run judge --context inter-wave` still renders a verdict and still reports `blocksNextWave`; `recordVerifyResult` records it on the unresolved entry and stops branching on it. A checkpoint whose verify agent reported nothing for a planned check used to halt in `run judge` itself, before the state machine saw it; at an inter-wave checkpoint that absence is now recorded as a skipped verification, the same record a spent budget leaves, and only the final context still halts on it. The carried errors travel on the state machine's `nextStep` for the wave that follows the unresolved one (`unresolvedChecks`), and `decorate` hands them to `assembleImplementerPrompt`, which adds its section only when there is something to say — so every pinned prompt fixture, built without the field, is byte-identical.

### D6. Skipping is a state transition at record time

`recordBatchResult` already owns "what happened to this batch"; pruning there means the cursor, the wave-finished branch and the verification decision all run over the pruned plan in the same call. What blocks is every dispatched task not in `completed`, not only the recorded failures: a task its lane never reached is no more there to build on than one that failed. `nextStep` stays pure and side-effect free. Tasks keep `dependsOn` through `createRunState` (the run state stores the planner's task objects), so no plan change is needed. The CLI raises the banner from the difference between the state before and after the record, the same way it derives `recorded`.

## Risks / Trade-offs

- **A garbled copy can still halt a run** when the record read is garbled too → the halt now quotes what the relay copied, so the cause is on the summary, not in a transcript.
- **A model asked to retype an envelope may drop `answers`** → a bare payload is read as before, so the worst case is today's behaviour, not a refusal.
- **An inexact acknowledgement accepts a result whose hash was mistyped past character 16** → the banner names every such acceptance, and a result is still adjudicated on its own outcomes and handoff.
- **A wave red at its checkpoint may make the next wave's work harder** → the next wave is told what is red, and the final gate still refuses to commit a red suite; what is lost is the early stop, which in the runs this change answers cost the whole wave's finished work.
- **Skipping relies on declared edges** → an undeclared dependency still runs and may fail, exactly as today; nothing here infers edges.

## Migration Plan

All additive for a state or manifest written before the change: a missing counter starts at 0, a missing `skippedDependents` is an empty list, a bare input is read as before. A run in flight when the CLI is upgraded continues; its first stamped step carries `seq` 1 and its driver, started before the upgrade, ignores the field. Rollback is the previous CLI and script together; an older CLI ignores `seq` on nothing it reads and would read an envelope as the payload object, so the two must not be mixed — which a plugin release guarantees, since both ship in one bundle.
