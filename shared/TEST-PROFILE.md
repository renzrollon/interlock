# Test Profile — Discovery & Persistence Contract

Durable, machine-readable record of how a project's tests run. Owned by
`/interlock:fix-tests` and reused by `/interlock:ship`, so neither has to
re-sniff `package.json` on every run.

**Path:** `.claude/testing/profile.json`  
**Human mirror:** idempotent `## Testing` block in `CLAUDE.md` (or `AGENTS.md`
on Cursor-only projects) between HTML comment markers (see below).

Learned gotchas discovered mid-fix go to
`.claude/memory/failure-modes/<slug>.md` (max 3 per session) — **not** into
the profile.

---

## Schema (`profile.json`)

```json
{
  "version": 1,
  "updated": "<ISO-8601>",
  "discovered_from": ["package.json#scripts.test", "CI", "interview"],
  "unit": {
    "command": "npm test",
    "cwd": ".",
    "filter_syntax": "node --test --test-name-pattern <pattern> <file>",
    "single_file": "node --test path/to/file.test.mjs",
    "env": {},
    "timeout_ms": 120000,
    "prerequisites": []
  },
  "e2e": {
    "enabled": false,
    "command": null,
    "cwd": ".",
    "filter_syntax": null,
    "single_file": null,
    "env": {},
    "timeout_ms": 600000,
    "prerequisites": []
  },
  "coverage": {
    "enabled": false,
    "command": null,
    "report_path": "coverage/lcov.info",
    "format": "lcov"
  },
  "known_flaky": [],
  "notes": []
}
```

| Field | Meaning |
|-------|---------|
| `unit.command` / `e2e.command` | Full shell command that runs the suite (as in CI / `package.json`) |
| `filter_syntax` | How to run a subset by name/pattern (string with `<pattern>` placeholder) |
| `single_file` | How to run one file (string with path implied, or template) |
| `env` | Extra env vars required for a green run (not secrets — names/placeholders only) |
| `prerequisites` | Human-readable setup steps (dev server, seeded DB, `npx playwright install`, …) |
| `timeout_ms` | Soft budget for one full suite run; do not raise to mask races |
| `coverage.enabled` | Whether a coverage command is known. `false` = not configured (never an error) |
| `coverage.command` | Full shell command that produces a coverage report (e.g. `npm run coverage`) |
| `coverage.report_path` | Where the report lands, relative to `unit.cwd` (`coverage/lcov.info`, `coverage/coverage-summary.json`, …) |
| `coverage.format` | Report format the path holds: `lcov`, `json-summary`, `cobertura`, … |
| `known_flaky` | Paths or test-name patterns that flip on re-run (recorded, not "fixed") |
| `notes` | Short freeform caveats (≤5 lines total) |

`e2e.enabled` defaults to `false`. The skill never runs e2e unless the user
passes `--e2e` **and** `e2e.command` is set.

`coverage.enabled` also defaults to `false`, and coverage is always **advisory**
— a missing coverage tool, a failed coverage run, or 0% covered changed lines
must never fail a gate or turn a green suite red.

---

## Discovery precedence

First run (or `--reconfigure`): derive in order, stop when confident enough to
write a profile. Ask at most **4 questions** only when still ambiguous.

1. **`package.json` / language manifests**
   - `scripts.test`, `scripts.test:unit`, `scripts.test:e2e`, `scripts.test:ci`
   - Python: `pytest` / `tox` / `pyproject.toml` `[tool.pytest]`
   - Go: `go test ./…`
   - Rust: `cargo test`
2. **Runner config files** (infer filter + single-file syntax)
   - `vitest.config.*`, `jest.config.*`, `playwright.config.*`
   - `pytest.ini`, `pyproject.toml`, `.mocharc.*`
   - Node built-in: `node --test` (filter: `--test-name-pattern`)
3. **CI workflows** (`.github/workflows/*`, `.gitlab-ci.yml`, etc.)
   - Prefer the job that runs unit tests on PRs
   - Capture env and prerequisites from the job definition
4. **Ask (≤4 questions, once)** — only for gaps that block a correct run:
   - Unit command (if none found)
   - Single-file / filter syntax (if not inferable)
   - Required env or prerequisites
   - E2e command (only if user asked about e2e / passed `--e2e`)

Every later run is **zero-question** unless `--reconfigure`.

### Coverage discovery

`coverage` is resolved independently of `unit`/`e2e` and **never blocks**. Derive
in this order, stop at the first hit, and persist what you find:

1. `coverage.command` already in the profile → use it as-is
2. `package.json` `scripts.coverage`
3. `package.json` `scripts["test:coverage"]`
4. `vitest --coverage` / `jest --coverage` when vitest or jest is the runner
5. `c8` / `nyc` present in `devDependencies` → wrap `unit.command`
6. `node --test --experimental-test-coverage` when the runner is node:test

Never ask for a coverage command and never install tooling to obtain one —
nothing found → `enabled:false`, report and continue; never block.

**Stale profile:** rewrite when `unit.command` no longer exists in
`package.json` / manifests, or the command exits 127 / "not found". Otherwise
reuse as-is.

---

## Human mirror (`## Testing` block)

Write (or replace) content **between** these markers inside `CLAUDE.md`
(prefer) or `AGENTS.md` (if that is the project's agent doc and `CLAUDE.md`
is absent):

```markdown
## Testing

<!-- BEGIN interlock:testing -->
**Unit:** `<unit.command>` (cwd: `<unit.cwd>`)
**Filter:** `<unit.filter_syntax>`
**Single file:** `<unit.single_file>`
**E2E:** `<e2e.command or "opt-in via /fix-tests --e2e (not configured)">`
**Prerequisites:** <list or "none">
**Profile:** `.claude/testing/profile.json` (managed by `/interlock:fix-tests`)
<!-- END interlock:testing -->
```

**Idempotency rules**

- If both markers exist: replace only the interior; leave surrounding prose alone.
- If `## Testing` exists without markers: insert markers + block immediately
  under the heading (preserve any pre-existing bullet notes above the markers
  only if they are clearly human-authored and outside a prior managed block).
- If no `## Testing` section: append the full section (heading + markers) at
  end of file (or before `## Git` / `## Hooks` if those headings exist).
- Never duplicate the managed block. A second `/interlock:fix-tests` run must leave a
  single pair of markers.

---

## Consumers

Anything that needs to run this project's tests reads
`.claude/testing/profile.json` first instead of sniffing `package.json`.

- `/interlock:fix-tests` — owns discovery, and is the only skill allowed to
  interview the user to fill a field.
- `/interlock:ship` — reads the profile during its test wave and final
  verification. Where the discovery ladder would ask a question, ship leaves the
  field `null` and notes it. **Ship never interviews.**

**Two writers, no fighting.** `/interlock:fix-tests` and `/interlock:ship` both write this file.
Each writes only the fields it actually resolved and preserves every other key
verbatim — `/interlock:ship` never clears `known_flaky`, human-authored `notes`, or
`e2e` settings it did not discover, and `/interlock:fix-tests` leaves `coverage` alone
unless it discovered coverage tooling itself. Neither writer interviews the user
on behalf of the other: `/interlock:ship` is always headless and records
unresolvable fields as `null` plus a line in `notes`, where the ladder above
would have asked.
