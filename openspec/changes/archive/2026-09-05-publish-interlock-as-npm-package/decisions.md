# Decisions — publish-interlock-as-npm-package

| id | question | class | resolution | evidence |
|----|----------|-------|------------|----------|
| P1 | What is the published package name? | needs_human | Recommended default `@renzrollon/interlock` (a scoped name is always available to its owner; unscoped `interlock` is not verified free). A published name is a public commitment the repository cannot make alone. | design.md D2 |
| D1 | Whitelist (`files`) or ignore list (`.npmignore`)? | agent_resolved | Whitelist, with a test that the binaries' import closure is covered; an ignore list ships new directories by default. | `package.json` `bin` map; `bin/interlock-ship-acp:33-35` and `lib/host.mjs:38` resolve libraries by relative path; design.md D1 |
| D3 | Token-based publish or trusted publishing? | agent_resolved | Trusted publishing with provenance on a `v*` tag, tests first in the same job; no long-lived secret. One-time registry setup is documented, and the workflow fails loudly until it exists. | `.github/workflows/ci.yml` already pins `actions/checkout@v7` / `actions/setup-node@v7`; design.md D3 |
| D4 | Rely on the `bump-release` skill to keep versions aligned, or assert it? | agent_resolved | Assert it: a test compares the three manifests. The skill keeps bumping; the test turns a partial bump into a red build. | `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` both carry `0.2.0` today with nothing asserting it; design.md D4 |
| D6 | Does this change depend on the runner rename? | agent_resolved | No. Tests, the smoke step and the README read the `bin` map from `package.json`; whichever change lands second inherits the name. | design.md D6 |
