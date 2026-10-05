## MODIFIED Requirements

### Requirement: The hooks module SHALL observe only, and the guarantee SHALL be pinned statically

Every hook in the module SHALL resolve to the engine's own behaviour: `next(e)`, `yield* next(e)`, a drawing, or an empty command reply, with one exception: the launch guard's `tool.call` branch on the Workflow tool MAY return a deny, and only the deny the shared launch rule produced from recorded facts, with no number and no judgement of its own. The module SHALL return no other deny and no substitute result, register no catch handler, and call no model, prompt submission, session message, process, network, file write or permission check. A `node --test` case SHALL read the module as text and assert its engine calls are a subset of a recorded allow-list, that none of the forbidden tokens appears, that the only `deny` it returns is built by the rule module's reason function, and that its session-state keys match the plugin's type contract; `claude plugin validate --strict` SHALL list the same hooks, calls and state keys the design records.

#### Scenario: Happy path — the recorded calls and nothing more

- **GIVEN** the module as shipped
- **WHEN** `claude plugin validate . --strict` runs
- **THEN** its `calls:` line names only `$.ui.status`, `$.ui.toast`, `$.ui.log`, `$.ui.open`, `$.ui.invalidate`, `$.ui.resolve`, `$.command.register`, `$.session.usage`, `$.session.version`, `$.clock.now` and the state read and write calls
- **AND** its `hooks:` line adds `prompt.submit` and `session.receive` to the meter's events

#### Scenario: Failure — a forbidden token fails the pin

- **GIVEN** the module with `.catch(` or `$.model.complete` or `tool.check` or `$.fs.write` added anywhere, or a second `deny` not built by the rule's reason function
- **WHEN** `node --test test/spine/mod-pins.test.mjs` runs
- **THEN** it fails naming the token
- **AND** no session needs to load the module to find it

#### Scenario: Edge case — a hook that throws is skipped and the run continues

- **GIVEN** a Bash result that makes the step reader throw, or a state read that throws under the launch guard
- **WHEN** the engine runs the chain
- **THEN** the tool call resolves as the engine alone would have resolved it
- **AND** the module's later hooks keep working
