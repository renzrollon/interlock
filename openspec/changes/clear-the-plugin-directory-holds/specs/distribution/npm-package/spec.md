## ADDED Requirements

### Requirement: The manifest's listing image SHALL be declared, shipped and an image

The plugin manifest MUST name its listing image under `icon`, as a path that begins `./` and resolves to a file the `files` whitelist covers. That file MUST be a complete PNG that is square and within the pixel bounds the package test records for a listing image. A test MUST fail naming the path and the reason when the key is absent, when the path is not covered, or when the file is not such an image, because the plugin directory reads the listing image from that key and a bundled image nothing declares is an asset it cannot account for.

#### Scenario: Happy path — the declared image ships

- **GIVEN** a manifest whose `icon` is `./assets/icon.png` and a `files` list containing `assets`
- **WHEN** the package test and `npm pack --dry-run` run
- **THEN** the test passes and the image is listed in the tarball
- **AND** `claude plugin validate . --strict` reports no warning for the key

#### Scenario: Failure — the image is named but not shipped

- **GIVEN** a manifest whose `icon` is `./assets/icon.png` and a `files` list without `assets`
- **WHEN** the package test runs
- **THEN** it fails naming `assets/icon.png` as named by the manifest and uncovered
- **AND** it does not pass on the grounds that the file exists in the working tree

#### Scenario: Failure — the key is absent

- **GIVEN** a manifest without an `icon` key and an image under `assets/`
- **WHEN** the package test runs
- **THEN** it fails saying the bundle ships an image the manifest does not declare
- **AND** the message names the image's path

#### Scenario: Edge case — a path without the leading `./`, or an image that is not square

- **GIVEN** a manifest whose `icon` is `assets/icon.png`, or one that names a PNG 512 pixels wide and 256 high
- **WHEN** the package test runs
- **THEN** it fails naming the value in the first case and the two dimensions in the second
- **AND** neither is accepted because the file is a valid PNG

### Requirement: The bundle SHALL stay inside the directory's file limits

Every file the tarball ships that is not an image or a font MUST be under 262,144 bytes, and the tarball MUST hold 512 files or fewer. A test MUST compute both over the file set `npm pack` would ship, record the two limits beside the name of the document they come from, and fail naming each file over the size limit with its size, or the count when the count is over, because the plugin directory holds a version for a reviewer on either and nothing else in the repository measures them.

#### Scenario: Happy path — the bundle as shipped is inside both limits

- **GIVEN** the working tree's `files` whitelist
- **WHEN** the package test runs
- **THEN** it passes
- **AND** it asserts over the same file set the closure test walks, not over a list written by hand

#### Scenario: Failure — a source file grows past the size limit

- **GIVEN** a shipped `.mjs` file of 262,145 bytes
- **WHEN** the package test runs
- **THEN** it fails naming that file, its size and the limit
- **AND** it does not pass on the grounds that `npm pack` succeeded

#### Scenario: Edge case — the boundary, an image and the count

- **GIVEN** a shipped text file of 262,144 bytes, a shipped PNG of 300,000 bytes, and a whitelist that covers 513 files
- **WHEN** the package test runs
- **THEN** it fails for the text file, because the limit is under 262,144 bytes and not at it, and for the count
- **AND** it reports nothing for the PNG, because the size limit is for files that are not images or fonts
