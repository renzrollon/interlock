## Purpose

Makes the Interlock loop — not only ship — reachable from Codex, by shipping an always-on repository instruction file and a set of custom prompts, and by requiring that any Codex invocation asking for something this host cannot do halts instead of quietly running something smaller.

## ADDED Requirements

### Requirement: The repository SHALL ship an always-on agent instruction file that points at docs rather than copying them

The repository SHALL contain an `AGENTS.md` at its root that names the repository's purpose, the commands an agent may run, the test command, and where the deeper documentation lives. It SHALL point at existing documents rather than restating their content, and SHALL NOT restate any published cap, tier definition, or limit as prose.

Rationale: a number restated in prose drifts from the source that publishes it, which is the failure the caps command exists to end.

#### Scenario: Happy path — the file orients an agent and defers for detail

- **GIVEN** an agent starting in this repository with no prior context
- **WHEN** it reads the instruction file
- **THEN** it can determine the test command and where the loop's documentation lives
- **AND** it is directed to the caps command rather than given cap values inline

#### Scenario: Failure — a restated cap value is rejected

- **GIVEN** an instruction file that writes out a specific cap value as prose
- **WHEN** the repository's own checks run
- **THEN** the check fails naming the restated value and the command that publishes it
- **AND** the failure is a test failure rather than a review comment

#### Scenario: Edge case — the file stays useful to a host that has no concept of it

- **GIVEN** a host that does not read this file at all
- **WHEN** a run proceeds on that host
- **THEN** nothing in the loop depends on the file having been read
- **AND** no requirement is satisfied only by the file's presence

### Requirement: Codex custom prompts SHALL mirror the loop's stages and SHALL be installed by a documented step

The repository SHALL ship a set of Codex custom prompts covering the spec, explore, artifact-review, ship and commit stages, held in the repository under version control and installed into the operator's Codex prompt directory by a documented, repeatable step. Installation SHALL NOT overwrite an operator's unrelated prompts, and each shipped prompt SHALL be namespaced so it cannot collide with one the operator wrote.

#### Scenario: Happy path — the documented step installs every stage prompt

- **GIVEN** an operator with a Codex installation and no Interlock prompts
- **WHEN** they run the documented install step
- **THEN** a namespaced prompt exists for each of the spec, explore, artifact-review, ship and commit stages
- **AND** invoking each one starts that stage

#### Scenario: Failure — an unrelated operator prompt is not clobbered

- **GIVEN** an operator whose prompt directory already contains a prompt of their own
- **WHEN** the install step runs
- **THEN** that prompt is left byte-identical
- **AND** the step reports what it added

#### Scenario: Edge case — reinstalling over an existing install is idempotent

- **GIVEN** an operator who has already installed the prompts
- **WHEN** the install step runs a second time with no version change
- **THEN** the resulting prompt set is identical to the first install
- **AND** no duplicate or suffixed copies are created

### Requirement: A Codex invocation asking for an unsupported capability SHALL halt rather than degrade

The Codex ship driver SHALL support the lean loop — waves, verification, commit — and SHALL refuse, with a distinct non-zero exit status and a message naming the unsupported flags, any invocation asking for the adversarial review tail. It SHALL NOT run lean when strict was requested. Documentation SHALL state which capabilities are unavailable on this host and SHALL NOT describe an unsupported capability as supported.

#### Scenario: Happy path — a lean invocation runs to a terminal summary

- **GIVEN** a Codex ship invocation with no unsupported flags
- **WHEN** the run completes
- **THEN** it produces a terminal summary covering the waves, the verification and the commit
- **AND** its exit status distinguishes a completed run from a halted one

#### Scenario: Failure — a strict invocation is refused, not silently downgraded

- **GIVEN** a Codex ship invocation requesting the adversarial review tail
- **WHEN** the driver parses it
- **THEN** it exits with the status reserved for an unsupported invocation, naming each refused flag
- **AND** no wave is executed

#### Scenario: Edge case — an invocation mixing supported and unsupported flags is refused whole

- **GIVEN** an invocation combining a supported flag with an unsupported one
- **WHEN** the driver parses it
- **THEN** it refuses the whole invocation naming only the unsupported flags
- **AND** it does not honor the supported flag while dropping the other

### Requirement: Documentation SHALL state, per host, exactly which stages run

The documentation SHALL carry a single host matrix naming every supported host and, for each, which stages of the loop run on it and which do not. A host that cannot run a stage SHALL appear in that matrix as unable to, rather than being omitted. A capability named as future work SHALL be labeled as such and SHALL NOT appear as supported.

#### Scenario: Happy path — a reader can determine host support from one place

- **GIVEN** a reader deciding whether to adopt Interlock on Codex
- **WHEN** they consult the host matrix
- **THEN** they can determine which stages run on Codex and which are Claude Code only
- **AND** they do not need to read the driver's source to find out

#### Scenario: Failure — documentation claiming unsupported strict support is a defect

- **GIVEN** documentation describing the adversarial review tail as available on Codex
- **WHEN** that claim is compared against what the driver accepts
- **THEN** the mismatch is a defect to be corrected
- **AND** the driver's refusal, not the documentation, is authoritative

#### Scenario: Edge case — future work is labeled, not advertised

- **GIVEN** a capability named in the documentation that no host implements yet
- **WHEN** a reader encounters it
- **THEN** it is labeled as out of scope or future work
- **AND** it is not listed in the host matrix as a supported stage
