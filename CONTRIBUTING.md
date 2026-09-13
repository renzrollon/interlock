# Contributing

## Run it from a checkout

```bash
git clone https://github.com/renzrollon/interlock && cd interlock
npm test                      # no dependencies to install first
claude plugin validate . --strict
claude --plugin-dir .         # load it without installing
```

`/reload-plugins` picks up edits without restarting. There is no lint or build step.

`npm test` is `node --test` over a `find`-piped file list. Run it that way: a bare `node --test 'test/**/*.test.mjs'` relies on runner-side glob expansion, which collects zero tests on Node 18 and 20 and reports success.

## Conventions

- **Zero runtime dependencies.** `package.json` has no `dependencies` key and CI installs nothing. Adding one is a design decision that belongs in a change's `design.md` with a pinned exact version.
- Node ≥ 18, `"type": "module"`, `.mjs` throughout.
- `openspec/` belongs to the OpenSpec CLI. Write into it through `openspec new change` / `openspec instructions`, not by hand-scaffolding directories.
- **Thresholds live in the CLI, not in prose.** Never restate a numeric cap in a skill or a review prompt — read it from `interlock limits`, or let the gate decide.
- **Guards fail open, never closed.** Every hook allows on anything it cannot establish.
- **A prose instruction nobody asserts silently stops running.** When you add an instruction to a skill, pin it in `test/skills.test.mjs` — and assert tokens, not sentences.
- **Degradation is spoken, never silent.** If a path degrades, say so in the output.

Changes to this repository go through its own loop: `/interlock:spec`, read the spec, `/interlock:ship`. See [CLAUDE.md](./CLAUDE.md) for the full set of things to get right.

## Model evals

The deterministic spine is unit-tested; the model-facing surface (prompts, skills, shared contracts) is regression-tested against a real model by the `evals/` case suite. How to run it, what it gates, and how to add a case from an observed failure are in [docs/14 — Evals](./docs/14-evals.md).

## Releasing

Push a `v<MAJOR.MINOR.PATCH>` tag matching the version `package.json` carries, and `.github/workflows/release.yml` runs the suite and publishes to npm with provenance. It uses trusted publishing, which has to be configured once on the registry for this repository and that workflow file name — until it is, the publish step fails with the registry's authentication error rather than skipping.
