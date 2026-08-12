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

export function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export function loadJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}
