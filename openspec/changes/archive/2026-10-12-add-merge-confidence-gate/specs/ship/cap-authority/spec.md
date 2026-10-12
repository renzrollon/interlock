## ADDED Requirements

### Requirement: The merge-band group SHALL be published by the limits surface and covered by the reader check

The thresholds the merge verdict applies SHALL form one cap group in the limits definition, published by the limits surface as a group of its own beside the lane-cap table and the solo envelope rather than as entries of the iteration-count limits, printed in the text output, and covered by the reader check on the same terms as every other printed group. A nested table within the group (the band ceilings) SHALL count as one cap for the reader check, on the terms the per-tier lane table does.

#### Scenario: Happy path — the group is printed and published

- **GIVEN** the limits surface
- **WHEN** it is printed, and when it is emitted as JSON
- **THEN** every merge-band threshold appears as a named row in the text
- **AND** the JSON carries the group under its own top-level key, not inside the iteration-count limits

#### Scenario: Failure — a merge band with no reader fails the check

- **GIVEN** a merge-band threshold that the limits surface prints and that the merge-confidence path does not read by name
- **WHEN** the cap-authority check runs
- **THEN** the check fails naming the unread threshold

#### Scenario: Edge case — the group is not held to the positive-integer invariant

- **GIVEN** the merge-band group as a separate export from the iteration-count limits
- **WHEN** the positive-integer invariant over the iteration-count limits runs
- **THEN** the nested ceiling table does not fail it, because the invariant is over the iteration-count group alone
- **AND** the merge-band group is still subject to the reader check
