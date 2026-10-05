# `claude -p --output-format json` envelopes

What the `claude` host adapter reads (`readClaudeEnvelope` in `lib/host/claude-cli.mjs`).
Provenance matters here, because a fixture invented from memory would pin a guess:

| File | Provenance |
|---|---|
| `no-structured-output.json` | **Captured** from Claude Code 2.1.274 on 2026-10-05 (task 1.1 of `observe-agents-and-resolve-state-home`), scrubbed: session id zeroed, result text replaced. Exit 0, `subtype: "success"`, no `structured_output` (the session ran without `--json-schema`, which gives the same envelope shape `resultMissing` reads). Note `modelUsage` lists `bedrock.claude-haiku-4-5` beside the session's own `bedrock.claude-sonnet-5`: the per-model breakdown is session-scoped and includes host-internal calls. |
| `success.json` | The same capture with a `structured_output` added, the one field a `--json-schema` run adds. |
| `error-subtype.json` | **Documented shape, not captured.** The task-1.2 probe that would have captured an `error_max_turns` envelope could not be run; see the change's design.md, Open Questions. Replace it with a capture when one exists. |
