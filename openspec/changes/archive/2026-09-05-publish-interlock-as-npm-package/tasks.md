## 1. Manifest and the two guards

- [x] 1.1 In `package.json`: remove `"private": true`, set `name` to the scoped name recorded in the ledger (default `@renzrollon/interlock` until P1 is answered), add `"files": ["bin", "lib", "workflows", "skills", "hooks", "agents", "shared", ".claude-plugin", "README.md", "LICENSE", "CHANGELOG.md"]`, add `"publishConfig": { "access": "public" }`, and keep `bin`, `engines`, `type` and `scripts` unchanged (design D1, D2).
- [x] 1.2 Create `test/spine/package.test.mjs`: (a) every `bin` entry exists, is a file, starts with `#!/usr/bin/env node`, and is executable; (b) starting from each `bin` entry, follow relative `import ... from` / `export ... from` / `import(` specifiers transitively and assert every reached file is covered by a `files` entry, naming any that is not (design D1); (c) `package.json`, `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (the `plugins[0].version`) carry one identical version matching `/^\d+\.\d+\.\d+$/` (design D4).

## 2. CI pack smoke and the release workflow

- [x] 2.1 In `.github/workflows/ci.yml`, extend the `cli-smoke` job with a step that runs `npm pack --pack-destination "$RUNNER_TEMP"`, installs the tarball with `npm install -g <tgz> --prefix "$RUNNER_TEMP/prefix"`, then for every key of `package.json`'s `bin` map runs `"$RUNNER_TEMP/prefix/bin/<name>" --help` and additionally `interlock limits`, failing on any non-zero exit (design D5). Read the `bin` map with `node -e`, not a hardcoded list.
- [x] 2.2 Create `.github/workflows/release.yml`: trigger on push of tags matching `v[0-9]*`; permissions `contents: read`, `id-token: write`; steps `actions/checkout@v7`, `actions/setup-node@v7` with Node 22 and `registry-url: https://registry.npmjs.org`, `npm test`, then `npm publish --provenance --access public` with no `NODE_AUTH_TOKEN` (design D3). Assert in a comment at the top that trusted publishing must be configured on the registry for this repository and this file name, and that the job fails loudly until it is.

## 3. Docs and changelog

- [x] 3.1 In `README.md`, add an "Install the CLIs without the plugin" subsection under Install: the global install command using the package name from `package.json`, the `npx -p <name> interlock ...` form, a two-row table of what works from the package alone (`interlock`, `interlock-graph`, the runner) versus what needs the Claude Code plugin (`/interlock:spec`, `/interlock:ship`, the hooks), and a one-line "Releasing" note naming the tag format and the one-time trusted-publishing setup (design D3). Add a `CHANGELOG.md` entry.

## 4. Validate

- [x] 4.1 Run `openspec validate publish-interlock-as-npm-package --strict`, `interlock validate publish-interlock-as-npm-package` and `interlock ledger publish-interlock-as-npm-package`; the ledger is expected to report P1 as `needs_human` until the owner answers it — record that in the handoff rather than resolving it.
- [x] 4.2 Run `npm test`, `npm run validate` and `npm pack --dry-run`, and confirm the dry-run lists no file under `test/`, `openspec/`, `docs/`, `evals/` or `.claude/`.
