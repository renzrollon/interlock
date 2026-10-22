## OpenSpec change

<!-- Every pull request carries one (see CONTRIBUTING.md). Name it here: the spec is what the diff is reviewed against. -->

Change: `openspec/changes/<name>/`

- [ ] Created through `openspec new change`, not by hand, and `openspec validate <name>` passes.

## What and why

<!-- What the change does, and the problem it solves. Link the issue if there is one. -->

## Verification

<!-- Paste the output. A summary is not evidence. -->

```text
npm test
```

- [ ] `npm run validate` passes, if a manifest (`.claude-plugin/`, `package.json`) changed.

## Conventions

- [ ] No runtime dependency added, or it is in the change's `design.md` with a pinned exact version.
- [ ] A new or reworded skill instruction is pinned in `test/skills.test.mjs`, by tokens rather than sentences.
- [ ] No test was edited to make it pass: not weakened, skipped or deleted.
- [ ] No numeric threshold is restated in a skill or prompt; it is read from `interlock limits` or left to the gate.

## Accessibility

<!-- Tick what applies; mark the rest N/A. See ACCESSIBILITY.md. -->

- [ ] Docs and prose: headings do not skip a level, link text makes sense on its own, images have alt text.
- [ ] Terminal output: nothing is said by colour, layout or a symbol alone, and anything newly drawn has a plain-text equivalent.
- [ ] Site: still usable from the keyboard alone, focus stays visible, and new animation respects `prefers-reduced-motion`.
- [ ] N/A: no docs, output or site change.
