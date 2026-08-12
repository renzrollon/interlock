import fs from 'node:fs';
import path from 'node:path';
import { rel } from '../paths.mjs';

const DEFAULT_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.cache',
  'vendor',
  'specflow-graph-out',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  'site-packages',
  '.eggs',
  'eggs',
  '.idea',
  '.vscode',
]);

/** Code / scripts always indexed. */
const SOURCE_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.pyi',
  '.sh',
  '.bash',
]);

/**
 * Curated config JSON basenames (and simple globs via endsWith / includes).
 * Lockfiles and large generated JSON are excluded separately.
 */
const CONFIG_JSON_NAMES = new Set([
  'package.json',
  'tsconfig.json',
  'jsconfig.json',
  'pyrightconfig.json',
  'turbo.json',
  'nx.json',
  'components.json',
  'nest-cli.json',
  'openapi.json',
  'swagger.json',
  'settings.json',
  'launch.json',
  'extensions.json',
  'manifest.json',
  'appsscript.json',
]);

const CONFIG_JSON_MAX_BYTES = 64 * 1024;

function loadIgnorePatterns(root) {
  const patterns = [];
  for (const name of ['.gitignore', '.specflowignore']) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      patterns.push(t.replace(/\/$/, ''));
    }
  }
  return patterns;
}

function ignored(relPath, patterns) {
  for (const pat of patterns) {
    if (pat.startsWith('!')) continue;
    if (pat.startsWith('*')) {
      const suffix = pat.slice(1);
      if (relPath.endsWith(suffix) || relPath.includes(`/${suffix}`)) return true;
      continue;
    }
    if (relPath === pat || relPath.startsWith(`${pat}/`) || relPath.includes(`/${pat}/`)) {
      return true;
    }
  }
  return false;
}

function isConfigJson(name, relPath, size) {
  if (!name.endsWith('.json')) return false;
  if (size > CONFIG_JSON_MAX_BYTES) return false;
  const lower = name.toLowerCase();
  if (
    lower.includes('lock') ||
    lower.endsWith('.min.json') ||
    lower === 'package-lock.json' ||
    lower === 'npm-shrinkwrap.json'
  ) {
    return false;
  }
  if (CONFIG_JSON_NAMES.has(name)) return true;
  if (/^tsconfig\..+\.json$/.test(name)) return true;
  if (name.endsWith('.eslintrc.json') || name === '.eslintrc.json') return true;
  if (name.endsWith('mcp.json') || name.endsWith('mcp_config.json')) return true;
  // Root-level small *.json only (avoid sweeping fixture dumps)
  if (!relPath.includes('/') && size <= CONFIG_JSON_MAX_BYTES) return true;
  return false;
}

function shouldSkipDir(root, dir, entName, relPath) {
  // Skip the project's own Carl home (graph artifacts, memory) at repo root only —
  // nested trees like harness/.claude/hooks/*.sh are still indexed.
  if (entName === '.claude' && relPath === '.claude') return true;
  if (DEFAULT_SKIP_DIRS.has(entName)) return true;
  if (entName.endsWith('.egg-info')) return true;
  return false;
}

/**
 * Walk root for source + curated config files. Returns absolute paths.
 */
export function walkSourceFiles(root, { extraSkip = [] } = {}) {
  const skipExtra = new Set(extraSkip);
  const patterns = loadIgnorePatterns(root);
  const out = [];

  function visit(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      const r = rel(root, full);
      if (ent.isDirectory()) {
        if (skipExtra.has(ent.name) || shouldSkipDir(root, dir, ent.name, r) || ignored(r, patterns)) {
          continue;
        }
        visit(full);
        continue;
      }
      if (!ent.isFile()) continue;
      if (ignored(r, patterns)) continue;
      const ext = path.extname(ent.name);
      if (SOURCE_EXTS.has(ext)) {
        if (ent.name.endsWith('.d.ts')) continue;
        out.push(full);
        continue;
      }
      if (ext === '.json') {
        let size = 0;
        try {
          size = fs.statSync(full).size;
        } catch {
          continue;
        }
        if (isConfigJson(ent.name, r, size)) out.push(full);
      }
    }
  }

  visit(root);
  return out.sort();
}

// Accepts directories or individual markdown files, so callers can mix a docs
// directory with root-level files such as README.md — on many repos those root
// files are the only real documentation.
export function walkMarkdown(root, subdirs) {
  const out = [];
  for (const sub of subdirs) {
    const base = path.join(root, sub);
    let stat;
    try {
      stat = fs.statSync(base);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walkMd(base, out);
    else if (/\.mdx?$/i.test(base)) out.push(base);
  }
  return [...new Set(out)].sort();
}

function walkMd(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === '__pycache__') continue;
      walkMd(full, out);
      continue;
    }
    if (ent.isFile() && ent.name.endsWith('.md')) out.push(full);
  }
}

export { SOURCE_EXTS, CONFIG_JSON_NAMES, CONFIG_JSON_MAX_BYTES };

/**
 * Directory names projects actually use for prose, beyond `docs/`. Probed in
 * order when the preferred roots turn up nothing — a repo that keeps its
 * documentation in `doc/` or `site/` should not silently index zero files.
 */
const DOCS_DIR_CANDIDATES = [
  'docs',
  'doc',
  'documentation',
  'site/content',
  'site',
  'website/docs',
  'guides',
  'wiki',
];

/**
 * Root-level markdown worth indexing on any repo. These are frequently the only
 * real documentation a project has, and they live outside every docs directory.
 */
const ROOT_DOC_FILES = [
  'README.md',
  'ARCHITECTURE.md',
  'CONTRIBUTING.md',
  'DESIGN.md',
  'ROADMAP.md',
  'AGENTS.md',
  'CLAUDE.md',
];

/**
 * Resolve which markdown roots to index for a given repo.
 *
 * Returns the preferred roots when they contain anything, otherwise the first
 * candidate directory that exists. `openspec/specs` is always included when
 * present, and root-level docs are always appended, because on many repos
 * (Go projects especially) `README.md` is the documentation.
 */
export function resolveDocsDirs(root, requested) {
  if (requested && requested.length) return requested;

  const has = (p) => {
    try {
      return fs.existsSync(`${root}/${p}`);
    } catch {
      return false;
    }
  };

  const dirs = [];
  const primary = DOCS_DIR_CANDIDATES.find(has);
  if (primary) dirs.push(primary);
  if (has('openspec/specs')) dirs.push('openspec/specs');

  for (const f of ROOT_DOC_FILES) if (has(f)) dirs.push(f);

  return dirs.length ? dirs : ['docs', 'openspec/specs'];
}
