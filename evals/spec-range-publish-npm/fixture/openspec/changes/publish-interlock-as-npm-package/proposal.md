## Why

`package.json` already declares three executables — `interlock`, `interlock-graph` and `interlock-ship-acp` — and is marked `"private": true`, so the only way to get them onto a PATH is a git checkout or the Claude Code plugin install. The policy engine, the graph and the second host are ordinary Node with no dependencies (`CLAUDE.md` Conventions), and each is useful without the plugin: the runner drives non-Claude agents, `interlock` gates a CI job, `interlock-graph` indexes a repo for any agent. The explore brief's answer to "should the harness live in another repo" was to keep one repository and publish it two ways — as the plugin and as an npm package — rather than split the runner away from the tests that pin its boundary (`.claude/handoff/explore-creating-or-reusing-harness-20260904-171500.md` §Recommended Direction 4).

## What Changes

- **Publishable `package.json`.** `private` is removed, a `files` whitelist names exactly what ships (`bin/`, `lib/`, `workflows/`, `skills/`, `hooks/`, `agents/`, `shared/`, `.claude-plugin/`, `README.md`, `LICENSE`, `CHANGELOG.md`), `publishConfig.access` is `public`, and the package name becomes a scoped name pending the owner's confirmation (ledger P1).
- **Two tests guard the tarball.** One walks the import graph of every declared `bin` entry and fails if a reachable file is outside `files`; one asserts `package.json`, `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` carry one version.
- **CI packs the tarball and smokes the installed binaries.** The existing `cli-smoke` job gains an `npm pack` step that installs the tarball into a temp prefix and runs `interlock limits`, `interlock-graph --help` and the runner's `--help` from that PATH.
- **A release workflow publishes on a version tag** with npm provenance through trusted publishing, after `npm test` in the same job; no long-lived token is stored.
- **README gains an install section for the package** naming what works without Claude Code and what still needs it.

## Capabilities

### New Capabilities

- `distribution/npm-package`: what the published tarball contains, what a global install puts on PATH, and how the three version-bearing manifests stay in lockstep.

### Modified Capabilities

_None._

## Impact

- **Code**: `package.json`; `.github/workflows/ci.yml` (pack smoke step); `.github/workflows/release.yml` (new); `test/spine/package.test.mjs` (new: files closure, version lockstep, `bin` entries exist and are executable).
- **Docs**: `README.md` (Install), `CHANGELOG.md`.
- **Dependencies**: none in the package. The release workflow uses `actions/checkout@v7` and `actions/setup-node@v7`, which `ci.yml` already pins.
- **Compatibility**: the plugin install path is untouched. The `bump-release` skill already bumps every version-bearing manifest in lockstep; the new test makes that a build failure rather than a habit.
