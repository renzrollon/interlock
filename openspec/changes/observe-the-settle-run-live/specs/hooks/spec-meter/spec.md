## MODIFIED Requirements

### Requirement: The spec run SHALL end at the checkpoint, at an accepted ship launch and at the session boundary, and the module SHALL own one status line

When `interlock notify checkpoint` crosses the module, whatever its result, the run SHALL stop at its checkpoint: the status line SHALL read `interlock spec: <change> · checkpoint` and stay, the pane SHALL keep its last results and add the time the checkpoint crossed, and a later keyed line SHALL change nothing and be named once on the debug log. When a Workflow tool call that the launch rule recognises as a ship launch returns a result the launch rule recognises as accepted, the spec run SHALL end before the ship run becomes live, so the ship meter's status line replaces the spec meter's with no second writer; the readiness result that crossed before the launch SHALL stay on the pane until the boundary. At a classic session-start event whose source is `clear`, `resume` or `fork` the spec run SHALL reset in the same hook and on the same event as the ship run and the settle run, the status line cleared and the pane redrawn to its no-run text; a source of `startup` or `compact` SHALL leave it as it is. The module SHALL compose its one status line in one place, a live run ranking above a finished one: the ship position while a ship run is live, otherwise the spec line while a spec run is live, otherwise the settle line while a settle run is live, otherwise the spec line while a spec run is stopped at its checkpoint, otherwise the settle line while a settle run is done, otherwise nothing.

#### Scenario: Happy path — the checkpoint ends the run and the line says so

- **GIVEN** a live spec run named `add-the-thing` whose last stage was `gate PASS`
- **WHEN** `interlock notify checkpoint "add-the-thing"` resolves with `push: not configured — set INTERLOCK_NTFY_TOPIC`
- **THEN** the status line reads `interlock spec: add-the-thing · checkpoint` and is not cleared, and the pane reads `checkpoint reached <ISO>` with the gate line still `gate PASS`
- **AND** a later `openspec status --change "add-the-thing" --json` changes neither, and one debug-log line names a keyed line that crossed after the checkpoint

#### Scenario: Failure — a ship launch mid-spec hands the line over

- **GIVEN** a live spec run named `add-the-thing` on the continuity path, where `interlock ready "add-the-thing" --findings … --json` resolved with `ready: true`
- **WHEN** a Workflow call naming `workflows/ship.js` returns `status: 'async_launched'` with a run id
- **THEN** the spec run is no longer live, the status line reads the ship meter's `interlock: add-the-thing …` form and never both, and the spec pane reads `ready true` from before the launch with a line saying the run handed over to ship at `<ISO>`
- **AND** when the launch returns an error or a deny, the spec run stays live and its line stays

#### Scenario: Edge case — a clear mid-spec, a compaction, a second spec load on the same change, and a settle run beside it

- **GIVEN** a live spec run with a status line set and a table drawn
- **WHEN** a classic session-start event with source `clear` crosses the module
- **THEN** the status line is cleared, the pane reads that no spec run is live, and a later `openspec status … --json` sets no status line and is named once on the debug log
- **AND** a `compact` source leaves the line, the table and the counts unchanged
- **AND** when the spec skill is loaded again in the same session for a change that already has results, the record starts over with `change: unknown until named`, the earlier results are not kept, and one debug-log line says a new spec run replaced the previous one
- **AND** when a settle run is live in the same session, the status line reads the spec line while the spec run is live, and the settle line while the spec run is at its checkpoint, and never both
