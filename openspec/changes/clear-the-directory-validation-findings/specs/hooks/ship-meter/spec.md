## ADDED Requirements

### Requirement: The hooks module SHALL use the capability object only in plain shapes, and the rule SHALL be pinned statically

Every use of `$` in the hooks module SHALL be a plain call `$.noun.method(…)` with nothing around its parts, `$` passed whole to a function declared at the top of the file, or `$` declared as a parameter of such a function or of a hook. No named closure binding SHALL read `$` unless a frozen allow-list names it with its introducing version. Each `on(` SHALL be the first code on its line. A unit test SHALL scan the source and name every other shape.

#### Scenario: Failure — a stored closure that reads `$` is named

- **GIVEN** a function that receives `$` and binds `const send = async () => { await $.ui.notify(text) }`, then calls `void send()`
- **WHEN** the pin runs over that source
- **THEN** it fails naming the function and `send`

#### Scenario: Happy path — a callback handed directly to a capability call passes

- **GIVEN** `$.clock.every(ms, async () => { tell($, fields) })` and an object property `onPress: press => draftLine($, press)`
- **WHEN** the pin runs over that source
- **THEN** it reports nothing, because neither callback is a named binding

#### Scenario: Happy path — `$` passed whole across several lines passes

- **GIVEN** a call whose arguments span lines, with `$` alone on one line followed by a comma, to a function declared at the top of the file
- **WHEN** the pin runs over that source
- **THEN** it reports nothing

#### Scenario: Happy path — a whole call in parentheses and `$` as a parameter pass

- **GIVEN** `(await $.session.version()).version`, a top-level `async function drawBand($, e, next)`, and hooks spelled `async ($, e, next) =>`, `($, e, next) =>`, `async ($, e) =>` and `async function* ($, e, next)`
- **WHEN** the pin runs over that source
- **THEN** it reports nothing, because the parentheses wrap the whole call rather than a part of it, and each `$` is a declared parameter

#### Scenario: Edge case — `$` in a template, a regex literal or a comment is not a use

- **GIVEN** a template literal whose text holds `[${parts.ids}]`, a regex literal `/^b\d+$/`, and a comment that spells `$.fs.read`
- **WHEN** the pin runs over that source
- **THEN** it reports nothing for them, because only code outside strings, template text, regex literals and comments is read

#### Scenario: Failure — a wrapped part or a foreign callee is named

- **GIVEN** any of `$?.ui.log(x)`, `$.ui['log'](x)`, `($.ui).log(x)`, `$.ui.log!(x)`, `pass($)` where `pass` is a local binding, `fn(...$)` where `fn` is declared at the top of the file, or `const api = $`
- **WHEN** the pin runs over that source
- **THEN** it fails naming each shape

#### Scenario: Edge case — an allow-listed older closure passes while it exists and fails once it is gone

- **GIVEN** a frozen allow-list naming the closures the directory has accepted in every scanned version, each with the version that introduced it
- **WHEN** one of those bindings no longer reads `$`
- **THEN** the pin fails naming the stale allow-list entry

#### Scenario: Happy path — the shipped module passes

- **GIVEN** `hooks/mod.mjs` as shipped, with no named closure outside the allow-list reading `$`
- **WHEN** the pin runs
- **THEN** it reports nothing

### Requirement: Every hooked event SHALL be documented, and one the directory has not accepted SHALL carry a recorded engine floor

Each event the hooks module registers SHALL appear in a dated fixture of the mods reference's event list. An event outside the fixture's dated list of events the directory's last scan accepted SHALL have a floors entry naming the first Claude Code version that loads it, at or below the module load floor, and a docs line naming the event, that version and the plugin directory. Every floors entry SHALL name a hooked event. A unit test SHALL check all of them.

#### Scenario: Happy path — a documented, accepted event passes

- **GIVEN** a registration on `turn.complete`, which the reference fixture lists and the directory's 1.15.1 scan accepted
- **WHEN** the pin runs
- **THEN** it reports nothing

#### Scenario: Happy path — `prompt.autocomplete` passes with its floor recorded

- **GIVEN** the floors table names `prompt.autocomplete` at `2.1.292`, the plugin's module load floor is `2.1.292`, and one docs line names that event, that version and the plugin directory
- **WHEN** the pin runs
- **THEN** it reports nothing

#### Scenario: Failure — a documented event the directory has not accepted, with no floor, is named

- **GIVEN** a registration on `prompt.autocomplete`, which the reference fixture lists and the directory's accepted list does not, and no floors entry for it
- **WHEN** the pin runs
- **THEN** it fails naming `prompt.autocomplete` and the missing floor

#### Scenario: Edge case — a settings-hook event matches the reference's `classic.` family

- **GIVEN** a registration on `classic.SessionStart`, which the reference documents as the family `classic.<Event>` and the directory's 1.15.1 scan accepted
- **WHEN** the pin runs
- **THEN** it reports nothing

#### Scenario: Failure — an event the reference does not document is named

- **GIVEN** a registration on `prompt.sparkle`, absent from the reference fixture, even with a floors entry
- **WHEN** the pin runs
- **THEN** it fails naming `prompt.sparkle`

#### Scenario: Edge case — a floors entry for an event the module no longer hooks is stale

- **GIVEN** a floors entry for `prompt.autocomplete` and a module that registers no hook on it
- **WHEN** the pin runs
- **THEN** it fails naming the entry as stale

#### Scenario: Failure — a floor above the load floor is named

- **GIVEN** a floors table entry at `2.1.300` while the module load floor is `2.1.292`
- **WHEN** the pin runs
- **THEN** it fails naming the event, because the module would load on a Claude Code that refuses the hook

#### Scenario: Failure — a floored event the docs do not name is named

- **GIVEN** a floors table entry whose event and version appear in no docs file
- **WHEN** the pin runs
- **THEN** it fails naming the event and the missing docs line
