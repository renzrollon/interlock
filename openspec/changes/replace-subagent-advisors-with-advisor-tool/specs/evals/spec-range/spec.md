## REMOVED Requirements

### Requirement: Each case SHALL seed a frozen change folder without its ledger and carry the human's question as its label

**Reason**: Spec Range measured the checkpoint advisor subagent, which this change removes (decisions D1).
**Migration**: The ten `evals/spec-range-*` cases and their CALIBRATION-DEFERRALS rows are deleted. `test/fixtures/evals/spec-range-2026-10-21.json` stays as a generic triage fixture (decisions D8).

### Requirement: Deterministic graders SHALL pin that the consult ran; judged graders SHALL carry labels or deferrals

**Reason**: There is no consult left to grade (decisions D1).
**Migration**: None. The graders are deleted with their cases.

### Requirement: The labels SHALL be the kill criterion's data, and the suite SHALL say so without a number

**Reason**: The kill criterion belonged to the removed consult (decisions D1).
**Migration**: docs/14-evals.md loses its Spec Range section.
