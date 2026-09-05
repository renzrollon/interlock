## Context

See proposal.md — Why. The constraints that shape the how:

- **Zero runtime dependencies, Node >= 18, `.mjs` throughout** (`CLAUDE.md` Conventions). The package must install with nothing to build and nothing to fetch; CI on Node 18/20/22 already proves the code runs (`.github/workflows/ci.yml`).
- **`bin` is already declared** (`package.json` `bin`: `interlock`, `interlock-graph`, `interlock-ship-acp`). The binaries resolve their libraries by path relative to their own location (`bin/interlock-ship-acp:33-35`, `lib/host.mjs:38`), so a tarball that ships `bin/` without every reachable `lib/` file installs cleanly and fails at first use.
- **Three manifests carry the version**: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (all `0.2.0` today). The `bump-release` skill bumps them together; nothing asserts they agree.
- **The plugin is validated by `claude plugin validate . --strict`** (`npm run validate`); the tarball must keep `.claude-plugin/` so a package checkout is still a valid plugin.
- **The repository holds things that must not ship**: `test/`, `openspec/`, `docs/`, `evals/`, `.claude/`, `Interlock Report Design/`, `.docs/`, `.cursor/`, `.github/`, `.idea/`.

No new library. Nothing to pin in the package. The workflow actions are pinned at the major versions `ci.yml` already uses.

## Goals / Non-Goals

**Goals:**

- `npm i -g <package>` puts the declared binaries on PATH and every one of them runs.
- The tarball is a whitelist, so a new directory cannot ship by accident and a new `lib/` file cannot be forgotten without a test failing.
- Releases are reproducible from a tag and carry provenance; no publish token lives in the repository or its secrets.
- The three manifests cannot drift.

**Non-Goals:**

- Changing what the plugin install does, or how `claude plugin validate` sees the repository.
- A build step, a bundler, or TypeScript. There is no lint or build step and one is not being invented (`CLAUDE.md` Commands).
- Publishing `openspec/`, `docs/` or the eval suite. README links to docs on GitHub.

## Decisions

### D1 — `files` is a whitelist, and a test proves it is closed over the binaries' imports

`files` lists `bin`, `lib`, `workflows`, `skills`, `hooks`, `agents`, `shared`, `.claude-plugin`, `README.md`, `LICENSE`, `CHANGELOG.md`. `test/spine/package.test.mjs` starts from every `bin` entry, follows relative `import`/`export ... from` specifiers transitively, and fails naming any reached file that no `files` entry covers. This is the tarball equivalent of the cap-authority test: a shipped surface must have a reader that would notice its absence.

*Alternative rejected:* `.npmignore`. An ignore list ships everything new by default, which is the failure mode a whitelist exists to prevent.

### D2 — The package name is scoped, pending the owner

Unscoped `interlock` on the npm registry is not verified to be free, and a scoped name is always available to its owner. The default in this change is `@renzrollon/interlock`; the ledger carries it as `needs_human` (P1) because a published name is a public commitment the repository cannot make on its own. The plugin name in `.claude-plugin/plugin.json` stays `interlock`; the two namespaces are independent.

### D3 — Publish on a `v*` tag through trusted publishing, in a job that runs the tests first

`.github/workflows/release.yml` triggers on tags matching `v[0-9]*`, checks out, runs `npm test`, then `npm publish --provenance --access public` with `id-token: write` and no `NODE_AUTH_TOKEN`. Trusted publishing must be configured once on the registry for this repository and workflow file name; that is a one-time console action recorded as a step in the README's release notes, not something the workflow can do. Until it is configured the workflow fails loudly at publish, never silently.

### D4 — Version lockstep is a test, not a convention

`test/spine/package.test.mjs` asserts the three manifests carry one version string and that it matches the tag format the release workflow accepts. The `bump-release` skill keeps doing the bumping; the test is what turns a partial bump into a red build.

### D5 — The pack smoke installs the tarball into a temp prefix and runs the real binaries

In `ci.yml`'s `cli-smoke` job: `npm pack --pack-destination "$RUNNER_TEMP"`, `npm install -g "$RUNNER_TEMP"/*.tgz --prefix "$RUNNER_TEMP/prefix"`, then run `interlock limits`, `interlock-graph --help` and each remaining `bin` entry's `--help` from `$RUNNER_TEMP/prefix/bin`. The step reads the `bin` map from `package.json` so a renamed binary cannot fall out of the smoke without a failure.

### D6 — The runner's binary name is read from `package.json`, not hardcoded here

This change ships whatever `bin` declares. If `promote-interlock-run-with-host-adapters` renames `interlock-ship-acp` to `interlock-run` first, the tests, the smoke and the README section pick the new name up from the manifest; if it lands second, that change updates the README section it inherits. Neither change depends on the other's order.

## Risks / Trade-offs

- **`skills/` and `hooks/` in the tarball are inert outside Claude Code.** They ship so a package checkout is still a complete plugin; the README says which parts need the plugin host.
- **Trusted publishing misconfiguration** fails the first release. The failure is a red workflow with the registry's message, and the fix is the console step named in D3.
- **A scoped name changes the `npx` invocation** (`npx -p @renzrollon/interlock interlock ...`). Documented in the README install section.

## Migration Plan

Additive. No existing install path changes. The first publish is a manual `git tag v0.2.x` after trusted publishing is configured.

## Open Questions

- P1 (ledger): the published package name.
