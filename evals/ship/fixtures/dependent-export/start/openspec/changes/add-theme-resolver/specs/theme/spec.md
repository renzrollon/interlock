## ADDED Requirements

### Requirement: Colour values are written down exactly once

The package SHALL hold every colour value in one exported token table, and every
other module SHALL obtain a colour by reading that table rather than by
repeating the value.

#### Scenario: Happy path — the token table carries both palettes

- **WHEN** the token table is read
- **THEN** it holds a `light` and a `dark` palette and nothing else

### Requirement: A theme is resolved by name, and an unknown name is named

The package SHALL resolve a theme name to its palette with the name attached.
An unresolvable name SHALL raise an error carrying that name.

#### Scenario: Happy path — a known name resolves

- **WHEN** `light` is resolved
- **THEN** the result carries the light palette's values and the name `light`

#### Scenario: Failure — an unknown name is reported, not returned empty

- **WHEN** a name with no palette is resolved
- **THEN** an error naming it is raised
- **AND** no empty or partial palette is returned in its place
