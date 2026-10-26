## MODIFIED Requirements

### Requirement: The hooks module SHALL observe only, and the guarantee SHALL be pinned statically

Every hook in the module SHALL resolve to the engine's own behaviour: `next(e)`, `yield* next(e)`, a drawing, or an empty command reply, with one exception: the launch guard's `tool.call` branch on the Workflow tool MAY return a deny, and only the deny the shared launch rule produced from recorded facts, with no number and no judgement of its own. The module SHALL return no other deny and no substitute result, register no catch handler, and call no model, prompt submission, session message, process, network, file write or permission check. Its spec-skill observers SHALL read the first word of a submitted prompt and the skill a Skill call names, and pass both on unchanged; its settle-skill observer SHALL read the same two events for the settle skill and the review-code skill, and of the arguments only the presence of `--review`, and pass both on unchanged. The one timer it holds SHALL be the host's own interval, started only for a live ship run and cancelled with it; the settle meter SHALL add none. Its one file read SHALL be `$.fs.read`, used for the preflight file at a human prompt or when one of its two report commands is run, and for a card the file names when `/interlock-handoff` is drawn, and for nothing else: never the trajectory, the spill, a manifest, a wave state or a settle record. A `node --test` case SHALL read the module as text and assert its engine calls are a subset of a recorded allow-list, that none of the forbidden tokens appears, that the only `deny` it returns is built by the rule module's reason function and that the refusal's toast spells no deny of its own, that the guard names it recognises are exactly the names the four guard scripts print, and that its session-state keys match the plugin's type contract; `claude plugin validate --strict` SHALL list the same hooks, calls and state keys the design records.

#### Scenario: Happy path — the recorded calls and nothing more

- **GIVEN** the module as shipped
- **WHEN** `claude plugin validate . --strict` runs
- **THEN** its `calls:` line names only `$.ui.status`, `$.ui.toast`, `$.ui.log`, `$.ui.open`, `$.ui.invalidate`, `$.ui.resolve`, `$.command.register`, `$.session.usage`, `$.session.version`, `$.clock.now`, `$.clock.every`, `$.fs.read` and the state read and write calls, and nothing the spec meter or the settle meter added
- **AND** its `hooks:` line adds `prompt.submit`, `session.receive`, `classic.SessionStart` and `tool.call` on `Edit` and `Write` to the meter's events, and lists the `AbovePrompt` band, the `interlock-preflight` and `interlock-handoff` panes and their two commands beside the meter's, then `tool.call` on `Skill` and on `Read`, the `interlock-spec` pane and its command, then the `interlock-settle` pane and its command

#### Scenario: Failure — a forbidden token fails the pin

- **GIVEN** the module with `.catch(` or `$.model.complete` or `tool.check` or `$.fs.write` or `$.fs.list` or `$.clock.sleep` added anywhere, or a second `deny` not built by the rule's reason function, or a guard name the four guard scripts do not print, or a prompt or Skill hook that returns `{ text }` of its own, or a `$.clock.every` started for a settle run
- **WHEN** `node --test test/spine/mod-pins.test.mjs` runs
- **THEN** it fails naming the token, the name or the call outside the allow-list
- **AND** no session needs to load the module to find it

#### Scenario: Edge case — a hook that throws is skipped and the run continues

- **GIVEN** a Bash result that makes the step reader, the spec line reader or the settle line reader throw, or a state read that throws under the launch guard, or an interval callback whose clock read rejects, or a pane draw whose launch-guard read rejects, or a preflight file read that rejects
- **WHEN** the engine runs the chain
- **THEN** the tool call, the prompt, the session-start event or the draw resolves as the engine alone would have resolved it
- **AND** the module's later hooks keep working and the interval keeps its next period
