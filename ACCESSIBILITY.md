# Accessibility

Interlock should be usable by anyone who uses Claude Code, and open to anyone who wants to contribute to it, whatever keyboard, screen reader, magnifier or other assistive technology they work with. This page covers what Interlock aims for, what is known not to work yet, and how to tell us when something gets in your way.

If you have just hit a barrier, go straight to [Reporting a barrier](#reporting-a-barrier).

## What Interlock is made of

Interlock has four surfaces, and each one has a different accessibility story:

- **Terminal output.** The `interlock`, `interlock-graph` and `interlock-run` CLIs, and the messages the plugin's hooks and skills print inside a Claude Code session.
- **The docs.** `README.md`, `docs/` and the other Markdown files, read on GitHub or npm.
- **The landing site**, [renzrollon.github.io/interlock](https://renzrollon.github.io/interlock/), built from `site/`.
- **The demo media.** The GIF in the README and the recorded run on the release page.

## Priorities

- **Text first.** Everything Interlock decides is reported as text: an exit code and a line saying why. No meaning is carried by colour alone, because the CLIs print no colour at all.
- **A text alternative for anything drawn.** Where output is drawn, such as a wave board or the ship meter, the same information is available as plain text. See [Known limitations](#known-limitations).
- **Plain language in the docs.** Headings in order, descriptive link text, and alt text on every image that carries information.
- **The landing site is meant to work from the keyboard alone** and respects your system's reduced-motion and colour-scheme settings. The site aims for [WCAG 2.2](https://www.w3.org/TR/WCAG22/) level AA. That is a goal, not a claim: nobody has evaluated the site against it.

## Contributor expectations

The [pull request template](./.github/pull_request_template.md) has a short accessibility section; tick what applies to your change, or mark it N/A. In short:

- Docs and skill prose: plain language, headings that do not skip a level, link text that makes sense on its own, alt text on images.
- Terminal output: no meaning in colour, layout or a symbol alone; anything new that is drawn needs a plain-text equivalent.
- The site: keyboard reachable, visible focus, and no new animation that ignores `prefers-reduced-motion`.

No accessibility tool runs in CI. If you checked a change with one, or with a screen reader, say so in the pull request.

## Reporting a barrier

Open an [accessibility issue](https://github.com/renzrollon/interlock/issues/new?template=accessibility.yml). If GitHub's form is itself a barrier for you, email carl.rollon@gmail.com.

Share as much as you are comfortable with; partial reports are useful. It helps to know:

- what you were trying to do, and which surface it was on (terminal, docs, site or video)
- what happened, and what you expected
- your operating system, your terminal or browser, and any assistive technology you use, with versions if you know them

Screenshots and recordings are welcome but never required. You never need to tell us about a disability to report a barrier.

### Severity

The issue form asks you to pick one; it is confirmed or adjusted during triage.

- **Critical**: you cannot complete a core task at all, for example installing the plugin or reading why a run stopped.
- **Serious**: you can complete it, but only with real difficulty or a workaround.
- **Moderate**: it is annoying or inconsistent, but it does not stop you.
- **Minor**: small, with little effect on getting the task done.

### How we respond

- An acknowledgement within 7 days of the report.
- If there is a workaround, you get it in the issue as soon as it is known.
- When a fix lands, you are asked to confirm it works for you before the issue is closed.

### Resolution expectations

Interlock has one maintainer, so there are no guaranteed fix dates. Critical and serious barriers are worked on before features; moderate and minor ones are scheduled with other bugs. If something takes longer than it should, the issue says why.

## Ownership and maintenance

Accessibility is owned by the maintainer, [@renzrollon](https://github.com/renzrollon).

### Responsibilities

- Triaging accessibility reports and confirming their severity.
- Tracking open barriers, and listing the ones not yet fixed under [Known limitations](#known-limitations).
- Posting progress and workarounds in the issue.
- Keeping this page accurate: it is reviewed at each minor release.

## Supported environments

- **Terminal output** is plain text with no ANSI colour or styling, so it reads the same in any terminal and with any screen reader that reads the terminal. Inside a Claude Code session, Claude Code renders that text, so how it reaches assistive technology depends on Claude Code and your terminal, not on Interlock.
- **The docs** are standard GitHub-flavoured Markdown and rely on GitHub's and npm's rendering.
- **The landing site** declares its language, honours `prefers-reduced-motion` and `prefers-color-scheme`, and labels its interactive and decorative parts for assistive technology. It has been checked in current Chrome only.

No surface has been tested with a screen reader. If you use one with Interlock, a report of what works is as useful as a report of what does not.

## Known limitations

- **The wave board and the ship meter are drawn with box-drawing characters.** A screen reader reads them as rows of symbols. The same information is available as text: run `interlock waves` without `--format board` for a plain listing of the plan, and `interlock run-log show <runId>` for a run's events in order.
- **The demo video has no audio, and its captions are drawn into the picture.** A screen reader cannot read them, and there is no transcript yet. The README's GIF has alt text and a one-line summary under it, and [the first hour](./docs/01-first-hour.md) walks through the same flow in text.
- **The landing site has not been audited** with assistive technology or against WCAG.

## Feedback

To suggest a change to this page or to how the project handles accessibility, open an issue or start a [discussion](https://github.com/renzrollon/interlock/discussions). If something is stopping you right now, use [Reporting a barrier](#reporting-a-barrier) instead, so it gets triaged.

---

This page follows the structure of the [Open Source Accessibility toolkit](https://github.com/open-source-accessibility/accessibility-toolkit)'s `ACCESSIBILITY.md` template, which is MIT-licensed.
