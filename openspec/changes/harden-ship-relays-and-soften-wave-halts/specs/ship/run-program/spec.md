## MODIFIED Requirements

### Requirement: A briefing SHALL be a file whose first line carries its hash, and a host delivering it by reference SHALL fail closed a result that does not acknowledge that hash

For every spawn, the CLI MUST write the assembled briefing to a file whose first line names the spawn label and the SHA-256 of the briefing text, and MUST place the path, the hash and the text on the spawn. A host that cannot pass the text through its transport MAY deliver the briefing by reference with a fixed bootstrap that names the path and requires the agent to report the hash as `briefing`. Such a host MUST read the reported value after trimming it, lowercasing it and removing a leading `sha256=`, and MUST accept it when it equals the spawn's hash, or when it is at least 16 hexadecimal characters long and its first 16 characters equal the first 16 of the spawn's hash. An accepted result MUST be recorded with `briefing` set to the spawn's full hash, and an acceptance that was not an exact match MUST raise the banner `BRIEFING ACK INEXACT: <label> reported <n> characters whose first 16 match the briefing's sha256 — accepted`. The host MUST treat a result whose `briefing` is absent, shorter than 16 hexadecimal characters, or different within its first 16 as a failed spawn with reason `briefing not acknowledged`. A result that is absent altogether — the runtime returned no result because it stopped the agent, the API failed or a usage limit ended it — MUST be recorded as a failed spawn with the banner `AGENT RETURNED NO RESULT: <label> — the runtime stopped it, the API failed, or a usage limit ended it; the step is recorded as failed`, and MUST NOT be reported as `briefing not acknowledged`. A host that passes the text inline MUST ignore `briefing`.

#### Scenario: Happy path — a Workflow-runtime worker acknowledges its briefing

- **GIVEN** a spawn whose briefing file's first line carries hash `H`
- **WHEN** the Workflow-runtime interpreter spawns the worker with the bootstrap and the worker reports `briefing: "H"`
- **THEN** the result is accepted and recorded as the lane's result
- **AND** no `BRIEFING ACK INEXACT` banner is raised

#### Scenario: Edge case — a worker that dropped a character is accepted and named

- **GIVEN** the same spawn, and a worker that finished its tasks and reported `H` with its last character missing
- **WHEN** the interpreter checks the result
- **THEN** the result is accepted, recorded with `briefing` equal to `H`, and its tasks are recorded on their own outcomes
- **AND** the close carries `BRIEFING ACK INEXACT: <label> reported 63 characters whose first 16 match the briefing's sha256 — accepted`

#### Scenario: Failure — the worker never read the briefing

- **GIVEN** the same spawn
- **WHEN** the worker's result omits `briefing`, reports a value whose first 16 characters differ from `H`'s, or reports only the first 15 characters of `H`
- **THEN** the interpreter records a failed spawn with reason `briefing not acknowledged`
- **AND** the lane's tasks are recorded as failed, not as ok on the strength of the rest of the result

#### Scenario: Failure — the runtime returned no result

- **GIVEN** the same spawn
- **WHEN** the runtime's agent call resolves to no result at all
- **THEN** the interpreter records a failed spawn and carries `AGENT RETURNED NO RESULT: <label>` to the close
- **AND** the summary does not say `BRIEFING NOT ACKNOWLEDGED` for that spawn

#### Scenario: Edge case — an inline host is not penalised for omitting the field

- **GIVEN** the ACP driver, which sends the briefing text inline
- **WHEN** an agent's result carries no `briefing` field
- **THEN** the result is judged on its schema alone
- **AND** no `briefing not acknowledged` failure is recorded

## ADDED Requirements

### Requirement: A step SHALL carry its sequence number, a relayed input SHALL name the step it answers, and an unreadable relay SHALL be recovered before the run halts

Every step a `run` subcommand emits against a run manifest MUST carry `seq`, an integer one greater than the `seq` of the last step emitted in the same root. The count MUST continue across runs in that root rather than restart, so a file written for an earlier run never names a step of a later one. The relay to the Workflow host MUST carry `seq`, and the Workflow driver MAY read it. `run close` MUST write the step it prints to `.claude/ship/last-close.json`, and MUST still leave `.claude/ship/last-step.json` as the last non-close step left it.

An input a driver hands a `run` subcommand through `--results`, `--host-banners` or `--host-observed` MAY be an envelope: a JSON object whose only keys are `answers`, an integer, and `value`, the payload. The subcommand MUST read `value` as the input. It MUST refuse an envelope whose `answers` is not the `seq` of the last step emitted — for `run close`, one that names no step of the current run — by exiting non-zero with a reason on stderr that names the file, the step it answers and the current step, before it changes the run manifest, the run state, the trajectory, the task list or any record file. An input that is not an envelope MUST be read as before.

Once the Workflow driver has read a step, every write it asks a relay to make MUST be an envelope answering that step's `seq`. The relay prompt MUST tell the relay to make every write before it runs the command, to run the command once, and to copy a non-zero exit's output without running the command again. When a relay's copy does not parse as a step, the driver MUST read the CLI's own record — `last-close.json` for a `run close`, `last-step.json` otherwise — through a relay that runs a read-only command, and then:

- continue from that record when its `seq` is one greater than the last step the driver read, or for `run close` any greater;
- relay the original call once more, with the same writes, when that record's `seq` equals the last step the driver read, because the call never took effect;
- otherwise stop through the close, with a reason that quotes up to the first 200 characters the relay copied and names the record file.

A relay of `run start`, which has no earlier step to compare against, MUST be relayed once more when its copy does not parse.

#### Scenario: Happy path — every step is numbered and the relay carries the number

- **GIVEN** a root whose last emitted step was `seq` 11, from a run that has closed
- **WHEN** `interlock run start --json` starts a new run and `interlock run classified --json` follows
- **THEN** the two steps carry `seq` 12 and 13, and the relayed steps carry them too
- **AND** `run close --json` writes its step, with its own `seq`, to `.claude/ship/last-close.json` and leaves `.claude/ship/last-step.json` holding step 13's bytes

#### Scenario: Failure — a relay that runs the command before its write cannot record the stale file

- **GIVEN** a run whose last step is a `run-batch` at `seq` 7, and a `.claude/ship/results.json` still holding the envelope the previous batch's record answered, `answers: 5`
- **WHEN** the relay runs `interlock run record-batch --results .claude/ship/results.json --json` before writing the new envelope
- **THEN** the command exits non-zero, saying the file answers step 5 and the run is at step 7, and the run state, the task list and the trajectory are unchanged
- **AND** the relay writes the envelope answering step 7, runs the command again, and the batch is recorded from that envelope

#### Scenario: Failure — a relay that reruns a call that took effect is refused, and the run continues

- **GIVEN** a relay whose `run record-batch` call took effect and emitted step 8, and which then ran the same command again and copied the refusal as its result
- **WHEN** the driver finds the copy does not parse
- **THEN** it reads `.claude/ship/last-step.json` through a read-only relay, finds `seq` 8 one greater than step 7, and continues from that step
- **AND** the batch is recorded once, and no halt names the relay

#### Scenario: Edge case — a relay whose call never took effect is relayed again once

- **GIVEN** a relay whose results file did not parse, so the CLI refused it and emitted nothing, and which copied an empty result
- **WHEN** the driver reads `.claude/ship/last-step.json` and finds the `seq` of the step it last read
- **THEN** it relays the same call once more with the same writes, and continues from the step that relay copies

#### Scenario: Failure — a record that cannot be read either halts with what the relay copied

- **GIVEN** a relay whose copy does not parse, and a read-only relay whose copy of `last-step.json` does not parse either
- **WHEN** the driver stops the run
- **THEN** the halt reason names the relay's label and subcommand, says how many characters it copied, quotes up to their first 200, and names `.claude/ship/last-step.json`
- **AND** a `RELAY UNREADABLE` banner carries the same text to the close

#### Scenario: Edge case — a host that writes bare inputs is unaffected

- **GIVEN** the runner host, which writes `results.json` as a bare JSON array
- **WHEN** it calls `interlock run record-batch --results .claude/ship/results.json --json`
- **THEN** the batch is recorded exactly as before, with no check against `seq`
