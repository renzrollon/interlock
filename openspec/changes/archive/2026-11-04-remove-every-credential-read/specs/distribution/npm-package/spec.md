## ADDED Requirements

### Requirement: No shipped file but the changelog SHALL name a credential variable or file

No file in the published bundle other than `CHANGELOG.md` SHALL spell `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `CODEX_API_KEY`, `OPENAI_API_KEY`, `apiKeyHelper`, `GITHUB_TOKEN`, `GH_TOKEN`, `GITLAB_TOKEN` or `.credentials.json`, because the plugin directory holds a plugin that reads a credential and can send data off the machine. `CHANGELOG.md` is history and is excepted.

#### Scenario: Failure — a shipped file names a credential variable

- **GIVEN** a shipped file other than `CHANGELOG.md` spells one of the names
- **WHEN** `npm test` runs
- **THEN** the package test fails naming the file and the name

#### Scenario: Happy path — the changelog may keep its history

- **GIVEN** `CHANGELOG.md` spells a name in an entry about an earlier version
- **WHEN** `npm test` runs
- **THEN** the package test does not fail on it
