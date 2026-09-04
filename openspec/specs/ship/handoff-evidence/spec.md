# ship/handoff-evidence Specification

## Purpose

Makes a wave handoff packet's evidence auditable, so that `status: "ok"` carries locators the run can confirm actually point at work this task did — rather than a well-shaped string naming a path nobody touched.

## Requirements

### Requirement: Handoff evidence SHALL be audited on two conditions, not one

The system SHALL audit each stored handoff packet's `evidence` against two independent conditions, because either alone is defeatable: the entry MUST have locator **shape** (`path`, `path:line`, or `path:start-end`), and its path MUST canonicalize to one **present in the set of paths that task actually changed**. Shape alone is satisfied by naming a path that does not exist. Membership alone is satisfied by a string that is not a locator.

The audit MUST be a path-membership test only. A cited line number MUST NOT be required to exist in the file, because a locator may legitimately name a line the same wave later moved or deleted, and rejecting it would be a false rejection of a true claim.

The audit MUST NOT judge whether the cited span supports the packet's `summary`. That is a semantic judgement, it requires a model, and a model placed there would recreate the same unverified-claim problem one layer down.

#### Scenario: Happy path — an ok packet citing a changed path is confirmed

- **GIVEN** a task that changed `lib/export.mjs` and returns `status: "ok"` with evidence `["lib/export.mjs:40-58"]`
- **WHEN** the batch result is recorded
- **THEN** the stored packet carries a `confirmed` audit verdict
- **AND** the task is still recorded as succeeded exactly as it is today

#### Scenario: Failure — an ok packet citing an untouched path is unconfirmed

- **GIVEN** a task that changed only `lib/export.mjs` and returns `status: "ok"` with evidence `["lib/nowhere.mjs:1"]`
- **WHEN** the batch result is recorded
- **THEN** the stored packet carries an `unconfirmed` verdict naming the locator that failed membership
- **AND** the task is still recorded as succeeded and its packet is still handed to the next wave

#### Scenario: Edge case — locators differing only in path spelling resolve to one canonical form

- **GIVEN** a task whose changed-path set contains `lib/export.mjs` and whose evidence cites `./lib/export.mjs:12`
- **WHEN** the batch result is recorded
- **THEN** the leading `./` is canonicalized away and the locator is confirmed
- **AND** a locator citing `lib/Export.mjs` on a case-sensitive path set is not confirmed by the differently-cased entry

### Requirement: The authoritative changed-path set SHALL be observed, with a declared fallback

The changed-path set the audit tests against SHALL be observed from version control at the moment the batch result is recorded, because that is the only point at which the working tree still matches what the implementer just claimed. When version control cannot be consulted, the system SHALL fall back to the paths the task itself reported as changed, and the stored verdict MUST name which source was used. A verdict MUST NOT present a self-reported path set as an observed one.

When neither source is available, the verdict MUST be `not-audited` with the reason, never `confirmed`.

#### Scenario: Happy path — the observed path set is used and named

- **GIVEN** a repository where version control reports `lib/export.mjs` as changed
- **WHEN** a batch result carrying a packet citing `lib/export.mjs:40` is recorded
- **THEN** the verdict is `confirmed` and records that the path set came from the observed source

#### Scenario: Failure — an unavailable observed source falls back and says so

- **GIVEN** a working directory where version control cannot be consulted
- **WHEN** a batch result is recorded whose task reported changing `lib/export.mjs` and whose evidence cites `lib/export.mjs:40`
- **THEN** the verdict records that the path set came from the task's own report, not from observation
- **AND** the verdict is distinguishable by a reader from one grounded in an observed path set

#### Scenario: Edge case — no path set from either source yields not-audited

- **GIVEN** a batch result whose task reported no changed paths and a working directory where version control cannot be consulted
- **WHEN** the result is recorded
- **THEN** the verdict is `not-audited` with a reason naming the absent path set
- **AND** the verdict is not `confirmed` and not `unconfirmed`

### Requirement: The audit verdict SHALL be recorded and SHALL NOT gate the run

The audit SHALL record its verdict on the stored packet and SHALL NOT change whether a task succeeded, whether a wave proceeds, whether a verification runs, or whether the run halts. An `unconfirmed` packet MUST still be handed to the next wave, because a report with unverifiable evidence is still more information than no report.

No count derived from these verdicts may be introduced as a halt condition, a failure-budget entry, or a continuity-eligibility input by this capability.

#### Scenario: Happy path — an unconfirmed verdict leaves the run's control flow untouched

- **GIVEN** a wave of three tasks in which one returns an `ok` packet whose evidence fails membership
- **WHEN** the batch result is recorded and the state machine is asked for the next step
- **THEN** all three tasks are recorded as succeeded, the wave advances exactly as it would without the audit, and no failure is accumulated
- **AND** the next wave's implementers receive all three packets including the unconfirmed one

#### Scenario: Failure — an audit that cannot run does not fail the batch

- **GIVEN** a batch result being recorded while the audit's path-set source raises an error
- **WHEN** the result is recorded
- **THEN** the packets are stored with `not-audited` verdicts and the batch is recorded normally
- **AND** the recording call does not throw and does not exit non-zero on account of the audit

#### Scenario: Edge case — every packet in a run unconfirmed still completes the run

- **GIVEN** a run in which no packet's evidence satisfies membership
- **WHEN** the run reaches its final wave and closes
- **THEN** the run completes rather than halting, and the verdicts are readable on the recorded state
