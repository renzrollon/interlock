import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const GRAPH_DIR = '.claude/graph';
export const GRAPH_FILE = 'graph.json';
export const REPORT_FILE = 'GRAPH_REPORT.md';
export const MANIFEST_FILE = 'manifest.json';
export const DOCS_INDEX_FILE = 'docs-index.json';
export const DOCS_DIGEST_FILE = 'DOCS_DIGEST.md';

export function resolveRoot(cwd = process.cwd()) {
  return path.resolve(cwd);
}

export function graphDir(root) {
  return path.join(root, GRAPH_DIR);
}

export function graphPath(root) {
  return path.join(graphDir(root), GRAPH_FILE);
}

export function reportPath(root) {
  return path.join(graphDir(root), REPORT_FILE);
}

export function manifestPath(root) {
  return path.join(graphDir(root), MANIFEST_FILE);
}

export function docsIndexPath(root) {
  return path.join(graphDir(root), DOCS_INDEX_FILE);
}

export function docsDigestPath(root) {
  return path.join(graphDir(root), DOCS_DIGEST_FILE);
}

export function ensureGraphDir(root) {
  fs.mkdirSync(graphDir(root), { recursive: true });
}

export function rel(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

export function abs(root, relPath) {
  return path.join(root, ...relPath.split('/'));
}

/** Marker on every stderr line naming a path an indexing command could not read. */
export const SKIP_MARKER = 'GRAPH SKIPPED UNREADABLE';

function codeOf(errorOrCode) {
  if (typeof errorOrCode === 'string' && errorOrCode) return errorOrCode;
  const code = errorOrCode && typeof errorOrCode === 'object' ? errorOrCode.code : undefined;
  return typeof code === 'string' && code ? code : 'UNKNOWN';
}

/**
 * Read a file once. Returns its text and the sha256 of the same bytes, or the
 * error code the read failed with. Never throws and never prints: the caller
 * decides what a failed read means (usually: `skips.add`).
 */
export function readIndexed(absPath) {
  let bytes;
  try {
    bytes = fs.readFileSync(absPath);
  } catch (error) {
    return { ok: false, code: codeOf(error) };
  }
  return {
    ok: true,
    text: bytes.toString('utf8'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/**
 * Collector for paths that could not be read. One entry per path, root-relative
 * with forward slashes, listed sorted by path.
 */
export function createSkips(root) {
  const byPath = new Map();
  return {
    add(absPath, errorOrCode, note) {
      const p = rel(root, absPath);
      const entry = { path: p, code: codeOf(errorOrCode) };
      if (note) entry.note = note;
      const prior = byPath.get(p);
      if (prior && (prior.note || !entry.note)) return;
      byPath.set(p, entry);
    },
    list() {
      return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    },
  };
}

/** `GRAPH SKIPPED UNREADABLE: <path> (<code>)`, plus ` — <note>` when there is one. */
export function formatSkip(entry) {
  const note = entry.note ? ` \u2014 ${entry.note}` : '';
  return `${SKIP_MARKER}: ${entry.path} (${entry.code})${note}`;
}

export function loadJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}
