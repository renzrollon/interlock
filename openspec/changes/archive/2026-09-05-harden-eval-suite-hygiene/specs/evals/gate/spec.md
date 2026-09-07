## MODIFIED Requirements

### Requirement: The eval job is advisory until a baseline exists

The eval job SHALL report its result without failing the build for any case that has not been promoted. Whether the job tolerates a failing verdict SHALL be derived from the promotion decision rather than fixed by hand in the workflow definition, so that promotion is a computed change of posture and not an edit a reviewer argues for in a pull request. No case SHALL be treated as blocking until the promotion decision reports it promotable, and the values the promotion rule turns on SHALL be read from the published limits surface rather than restated in this specification, in a skill, or in the workflow definition.

#### Scenario: Failing eval does not block a pull request

- **WHEN** the eval job records a failing verdict for a case that has not been promoted
- **THEN** the job surfaces the result
- **AND** the pull request remains mergeable on that job's account

#### Scenario: Promotion requires evidence

- **WHEN** promoting a case to blocking is proposed
- **THEN** the promotion decision is consulted over the recorded history of prior runs
- **AND** the posture follows that decision rather than a number chosen in the proposal

#### Scenario: Posture is derived, not hand-edited

- **WHEN** the eval job runs
- **THEN** its tolerance of a failing verdict is computed from the promotion decision
- **AND** no threshold or blocking flag is written directly into the workflow definition

#### Scenario: No history yields the advisory posture

- **WHEN** no recorded history of prior runs is available to the job
- **THEN** the job stays advisory and states that promotion could not be evaluated
- **AND** it does not fail the build on that account
