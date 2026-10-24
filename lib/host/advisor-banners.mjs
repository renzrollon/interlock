// What the runner says about Claude Code's advisor tool (replace-subagent-advisors-with-advisor-tool D14).
//
// The runner is a transport and may import only node builtins and the host port,
// so the settings read lives here. Only the user can turn the tool on; this
// reads the four settings files and the environment and returns the run notes.
// It counts nothing: the runner does not see per-lane transcripts the way the
// Workflow close does, so the note says consults are not counted on this host.

import { resolve } from 'node:path'
import { advisorNotes, readAdvisorConfig } from '../advisor-tool.mjs'
import { readSettingsSources, settingsSources } from '../settings-sources.mjs'
import { observeClaudeEnv } from './claude-env.mjs'

/**
 * @param {string} root  the repository root the runner was given
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]} banner lines; empty when no scope sets the key
 */
export function advisorBanners(root, env) {
  const read = readAdvisorConfig(readSettingsSources(settingsSources(resolve(root))))
  return advisorNotes({ ...read, disabled: observeClaudeEnv(env).advisorDisabled }, { counted: false })
}
