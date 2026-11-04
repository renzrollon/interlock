## 1. The hook reads the host's option variables

- [x] 1.1 `hooks/notify-option.mjs`, `.claude-plugin/plugin.json`, `lib/session-env.mjs`: the hook takes no argument and exports `INTERLOCK_NTFY_TOPIC` from `CLAUDE_PLUGIN_OPTION_NTFY_TOPIC` and `INTERLOCK_NTFY_URL` from `CLAUDE_PLUGIN_OPTION_NTFY_URL` (design D1-D2); the manifest's two option entries become one `node "${CLAUDE_PLUGIN_ROOT}/hooks/notify-option.mjs"`; the session-env header comment says where the value comes from.
- [x] 1.2 `test/hooks.test.mjs`: the notify-option cases pass the value in the hook's environment, not as an argument; the registration pin becomes the command-path pin of design D3, with a self-test that names a `${user_config.…}` argument, a `$(…)`, a wildcard and a second variable.
- [x] 1.3 `test/spine/package.test.mjs`: `hooks/notify-option.mjs` is the only shipped file that spells `CLAUDE_PLUGIN_OPTION_`.
- [x] 1.4 `README.md`, `docs/13-the-guards.md`, `docs/07-cli-and-configuration.md`, `hooks/preflight.mjs` and `lib/notify.mjs` comments, `CHANGELOG.md` `[Unreleased]`: one hook, read from the environment.

## 2. Verify

- [x] 2.1 `npm test` and `npm run validate` green.
- [ ] 2.2 A host probe: a session with a saved `ntfy_topic` gets `INTERLOCK_NTFY_TOPIC` in a Bash command. Not runnable by an agent: the host reads saved options from user settings only, which a probe must not write; the owner checks it in a real session.
- [ ] 2.3 Owner: a portal Validate of a `temp/plugin-scan` pack of this change.
