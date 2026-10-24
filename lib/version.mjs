// Version readers for the CLI and the plugin manifest (design D16).
// stdlib only. cliVersion() reads ../package.json relative to this module;
// pluginVersionAt(root) reads <root>/.claude-plugin/plugin.json and returns
// null on any failure rather than throwing.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function readVersion(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const version = parsed && typeof parsed.version === 'string' ? parsed.version : null;
    return version;
  } catch {
    return null;
  }
}

/** Version of the interlock CLI this module ships with, from package.json. */
export function cliVersion() {
  return readVersion(join(HERE, '..', 'package.json'));
}

/** Version of the plugin rooted at `root`, or null if it cannot be read. */
export function pluginVersionAt(root) {
  if (typeof root !== 'string' || root === '') return null;
  return readVersion(join(root, '.claude-plugin', 'plugin.json'));
}
