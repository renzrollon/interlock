## Purpose

A repository owns its review policy in one optional file.

## Requirements

### Requirement: The policy file SHALL NOT be able to change the survival arithmetic

No section of the policy file SHALL move the tolerance band, the nit cap or the survival rule; those live in the CLI so that a model cannot re-argue them.

#### Scenario: Failure — a band key in the file

- **GIVEN** a policy file that sets a band key
- **WHEN** it is parsed
- **THEN** the key is reported and ignored

### Requirement: Exclusions SHALL be enforced by the CLI

A finding on an excluded path SHALL be dropped before any survival decision, so a reviewer cannot vote it back in.

#### Scenario: Happy path — an excluded path drops

- **GIVEN** an exclusion for `dist`
- **WHEN** a finding on `dist/a.js` is adjudicated
- **THEN** it is counted as dropped by policy

### Requirement: A malformed policy SHALL be reported and ignored

A policy file that cannot be read or parsed SHALL leave the review running under the default policy and SHALL report why.

#### Scenario: Edge case — an oversized file

- **GIVEN** a policy file over the byte ceiling
- **WHEN** the policy is read
- **THEN** a problem is reported and the default policy applies
