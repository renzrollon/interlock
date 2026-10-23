import fs from 'node:fs';
import path from 'node:path';
import { createExtractor } from '../extract/create-extractor.mjs';
import { extractOpenspec } from '../extract/openspec.mjs';
import { extractMemory } from '../extract/memory.mjs';
import { walkMarkdown, walkSourceFiles } from '../extract/walk.mjs';
import {
  createSkips,
  ensureGraphDir,
  graphPath,
  loadJson,
  manifestPath,
  readIndexed,
  rel,
  reportPath,
  writeJson,
} from '../paths.mjs';
import { linkCsharp } from './link-csharp.mjs';
import { writeReport } from './report.mjs';

function langOf(filePath) {
  const ext = path.posix.extname(filePath).toLowerCase();
  if (ext === '.py' || ext === '.pyi') return 'python';
  if (ext === '.sh' || ext === '.bash') return 'shell';
  if (ext === '.json') return 'json';
  if (ext === '.cs') return 'csharp';
  if (ext === '.csproj') return 'csproj';
  if (ext === '.bicep') return 'bicep';
  return 'js';
}

function resolvePythonImport(fromFile, specifier, fileIndex) {
  let modPath;
  if (specifier.startsWith('.')) {
    let dots = 0;
    while (specifier[dots] === '.') dots += 1;
    const rest = specifier.slice(dots);
    let base = path.posix.dirname(fromFile);
    for (let i = 1; i < dots; i++) {
      const parent = path.posix.dirname(base);
      if (parent === base) break;
      base = parent;
    }
    modPath = rest ? path.posix.normalize(path.posix.join(base, rest.replace(/\./g, '/'))) : base;
  } else {
    modPath = specifier.replace(/\./g, '/');
  }

  const tryPaths = [`${modPath}.py`, `${modPath}.pyi`, `${modPath}/__init__.py`];
  for (const p of tryPaths) {
    if (fileIndex.has(p)) return { kind: 'file', id: `file:${p}`, path: p };
  }

  // Bare `import layer` → package __init__
  if (!specifier.startsWith('.') && fileIndex.has(`${modPath}/__init__.py`)) {
    return { kind: 'file', id: `file:${modPath}/__init__.py`, path: `${modPath}/__init__.py` };
  }

  if (specifier.startsWith('.')) {
    return { kind: 'unresolved', id: `unresolved:${modPath}`, path: modPath };
  }
  return { kind: 'external', id: `external:${specifier}` };
}

function resolveShellImport(fromFile, specifier, fileIndex) {
  const dir = path.posix.dirname(fromFile);
  const cleaned = String(specifier).replace(/^\.\//, '');
  const candidates = [
    cleaned,
    path.posix.normalize(path.posix.join(dir, cleaned)),
    path.posix.basename(cleaned),
  ];
  // Also try basename match when path was variable-stripped (unique hit)
  const basenames = [...fileIndex].filter((f) => f.endsWith(`/${path.posix.basename(cleaned)}`) || f === path.posix.basename(cleaned));

  for (const p of candidates) {
    if (fileIndex.has(p)) return { kind: 'file', id: `file:${p}`, path: p };
  }
  if (basenames.length === 1) {
    const p = basenames[0];
    return { kind: 'file', id: `file:${p}`, path: p };
  }
  return { kind: 'unresolved', id: `unresolved:${cleaned}`, path: cleaned };
}

function resolveJsImport(fromFile, specifier, fileIndex) {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    return { kind: 'external', id: `external:${specifier}` };
  }
  const dir = path.posix.dirname(fromFile);
  let candidate = path.posix.normalize(path.posix.join(dir, specifier));
  if (candidate.startsWith('./')) candidate = candidate.slice(2);

  const tryPaths = [
    candidate,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    `${candidate}.js`,
    `${candidate}.jsx`,
    `${candidate}.mjs`,
    `${candidate}.cjs`,
    `${candidate}/index.ts`,
    `${candidate}/index.tsx`,
    `${candidate}/index.js`,
    `${candidate}/index.mjs`,
  ];

  for (const p of tryPaths) {
    if (fileIndex.has(p)) return { kind: 'file', id: `file:${p}`, path: p };
  }
  return { kind: 'unresolved', id: `unresolved:${candidate}`, path: candidate };
}

/**
 * A project path is an identity compared in a Set, so it is normalized here and
 * nowhere else: backslashes become forward slashes and the result is resolved
 * against the referencing project's directory. A value holding an MSBuild
 * property, and one that names no walked file, is unresolved — no edge to a
 * file is invented for it.
 */
function resolveCsprojImport(fromFile, specifier, fileIndex) {
  const spelled = String(specifier).replace(/\\/g, '/');
  if (spelled.includes('$(') || path.posix.isAbsolute(spelled) || /^[A-Za-z]:\//.test(spelled)) {
    return { kind: 'unresolved', id: `unresolved:${spelled}`, path: spelled };
  }
  const candidate = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spelled));
  if (fileIndex.has(candidate)) return { kind: 'file', id: `file:${candidate}`, path: candidate };
  return { kind: 'unresolved', id: `unresolved:${candidate}`, path: candidate };
}

// A registry (`br:`, `br/<alias>:`) or template-spec (`ts:`, `ts/<alias>:`) module reference.
const BICEP_EXTERNAL_RE = /^(?:br|ts)(?::|\/[^/:]+:)/;

function resolveBicepImport(fromFile, specifier, fileIndex) {
  const spec = String(specifier);
  if (BICEP_EXTERNAL_RE.test(spec)) return { kind: 'external', id: `external:${spec}` };
  const candidate = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  if (fileIndex.has(candidate)) return { kind: 'file', id: `file:${candidate}`, path: candidate };
  return { kind: 'unresolved', id: `unresolved:${candidate}`, path: candidate };
}

/**
 * Resolve an import/require/source specifier against an importing file.
 */
export function resolveImport(fromFile, specifier, fileIndex) {
  const lang = langOf(fromFile);
  if (lang === 'python') return resolvePythonImport(fromFile, specifier, fileIndex);
  if (lang === 'shell') return resolveShellImport(fromFile, specifier, fileIndex);
  if (lang === 'csproj') return resolveCsprojImport(fromFile, specifier, fileIndex);
  if (lang === 'bicep') return resolveBicepImport(fromFile, specifier, fileIndex);
  // A C# `using` names a namespace, not a path; linkCsharp places it. Nothing
  // is resolved against the file set here.
  if (lang === 'csharp') return { kind: 'external', id: `external:${specifier}` };
  if (lang === 'json') {
    // package.json main/bin paths are usually relative to package root
    if (fileIndex.has(specifier)) return { kind: 'file', id: `file:${specifier}`, path: specifier };
    const tryPaths = [
      specifier,
      specifier.replace(/^\.\//, ''),
      `${specifier}.js`,
      `${specifier}.mjs`,
      `${specifier}.ts`,
    ];
    for (const p of tryPaths) {
      if (fileIndex.has(p)) return { kind: 'file', id: `file:${p}`, path: p };
    }
    return { kind: 'unresolved', id: `unresolved:${specifier}`, path: specifier };
  }
  return resolveJsImport(fromFile, specifier, fileIndex);
}

function moduleIdFor(filePath) {
  const parts = filePath.split('/');
  if (parts.length <= 1) return 'module:.';
  // Drop filename; use first dir, or first two dirs when nested (e.g. app/api)
  const dirs = parts.slice(0, -1);
  if (dirs.length === 1) return `module:${dirs[0]}`;
  return `module:${dirs.slice(0, 2).join('/')}`;
}

/** The shape of graph.json this build writes. Recorded in graph.json and in the manifest. */
export const GRAPH_SCHEMA_VERSION = 1;

/**
 * Content hashes of the prose the overlays read: every markdown file under
 * `openspec/` (extractOpenspec) and under `.claude/memory/`, plus
 * `.claude/memory.md` (extractMemory). The source hashes in the manifest do not
 * cover these, so without them an edited living spec leaves a stale graph that
 * `update` reports as current. A file that cannot be read has no hash here; the
 * skips record is what carries it.
 *
 * Returns { relPath: sha256 }.
 */
export function overlayHashes(root) {
  const candidates = [...walkMarkdown(root, ['openspec', '.claude/memory'])];
  const legacy = path.join(root, '.claude', 'memory.md');
  if (fs.existsSync(legacy)) candidates.push(legacy);
  const out = {};
  for (const abs of [...new Set(candidates)].sort()) {
    const got = readIndexed(abs);
    if (got.ok) out[rel(root, abs)] = got.sha256;
  }
  return out;
}

/**
 * Build a full graph for root. Returns { graph, stats, hashes, skipped, extractorMode }.
 *
 * `skips` is the command's collector (`createSkips`). A path under the root that
 * cannot be read is added to it and contributes nothing: no hash, no node, no
 * edge, and no place in the file set imports resolve against. `skipped` is the
 * collector's list when the build ends.
 */
export function buildGraph(root, { fileFilter = null, skips = createSkips(root) } = {}) {
  const extractor = createExtractor(root);
  let files = walkSourceFiles(root, { skips });
  if (fileFilter) {
    const allow = new Set(fileFilter);
    files = files.filter((f) => allow.has(rel(root, f)));
  }

  const nodes = new Map();
  const edges = [];
  const symbolByName = new Map(); // name -> [symbol ids]
  const hashes = {};

  function addNode(node) {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  }

  // Read every file once, before anything is resolved: the file set an import
  // resolves against must hold only what was actually read.
  const read = [];
  for (const absPath of files) {
    const filePath = rel(root, absPath);
    const got = readIndexed(absPath);
    if (!got.ok) {
      skips.add(absPath, got.code);
      continue;
    }
    hashes[filePath] = got.sha256;
    read.push({ filePath, extracted: extractor.extract(filePath, got.text) });
  }
  const fileIndex = new Set(read.map((r) => r.filePath));
  const csharpRecords = [];

  for (const { filePath, extracted } of read) {
    if (extracted.csharp) csharpRecords.push({ filePath, csharp: extracted.csharp });

    addNode({
      id: `file:${filePath}`,
      type: 'file',
      label: path.posix.basename(filePath),
      source_file: filePath,
      source_location: 'L1',
    });

    const mod = moduleIdFor(filePath);
    addNode({
      id: mod,
      type: 'module',
      label: mod.replace(/^module:/, ''),
      source_file: filePath,
      source_location: 'L1',
    });
    edges.push({
      source: `file:${filePath}`,
      target: mod,
      relation: 'belongs_to',
      confidence: 'EXTRACTED',
      source_file: filePath,
      source_location: 'L1',
      weight: 1,
    });

    for (const exp of extracted.exports) {
      const sid = `symbol:${filePath}#${exp.name}`;
      addNode({
        id: sid,
        type: 'symbol',
        label: exp.name,
        source_file: filePath,
        source_location: `L${exp.line}`,
      });
      edges.push({
        source: `file:${filePath}`,
        target: sid,
        relation: 'exports',
        confidence: exp.confidence,
        source_file: filePath,
        source_location: `L${exp.line}`,
        weight: 1,
      });
      if (!symbolByName.has(exp.name)) symbolByName.set(exp.name, []);
      symbolByName.get(exp.name).push(sid);
    }

    for (const imp of extracted.imports) {
      const resolved = resolveImport(filePath, imp.from, fileIndex);
      if (resolved.kind === 'external') {
        addNode({
          id: resolved.id,
          type: 'external',
          label: imp.from,
          source_file: filePath,
          source_location: `L${imp.line}`,
        });
      } else if (resolved.kind === 'unresolved') {
        addNode({
          id: resolved.id,
          type: 'unresolved',
          label: resolved.path,
          source_file: filePath,
          source_location: `L${imp.line}`,
        });
      }
      edges.push({
        source: `file:${filePath}`,
        target: resolved.id,
        relation: 'imports',
        confidence: imp.confidence,
        source_file: filePath,
        source_location: `L${imp.line}`,
        weight: 1,
        imported: imp.imported,
        local: imp.local,
      });

      if (resolved.kind === 'file' && imp.imported && imp.imported !== '*' && imp.imported !== 'default') {
        const targetSym = `symbol:${resolved.path}#${imp.imported}`;
        edges.push({
          source: `file:${filePath}`,
          target: targetSym,
          relation: 'references',
          confidence: 'INFERRED',
          source_file: filePath,
          source_location: `L${imp.line}`,
          weight: 1,
        });
      }
    }

    for (const ref of extracted.references) {
      const resolved = resolveImport(filePath, ref.from, fileIndex);
      if (resolved.kind !== 'file') continue;
      edges.push({
        source: `file:${filePath}`,
        target: resolved.id,
        relation: 'references',
        confidence: ref.confidence,
        source_file: filePath,
        source_location: `L${ref.line}`,
        weight: 0.5,
        name: ref.name,
      });
    }
  }

  // C# is linked across files: a `using` names a namespace, and a namespace is
  // declared in many files. External targets it names get their nodes below.
  const csharp = linkCsharp(csharpRecords);
  for (const n of csharp.nodes) addNode(n);
  for (const e of csharp.edges) edges.push(e);

  const knownSymbols = new Set(symbolByName.keys());
  const openspec = extractOpenspec(root, knownSymbols, fileIndex, { skips });
  for (const n of openspec.nodes) addNode(n);
  for (const e of openspec.edges) {
    if (e.target.startsWith('symbol-name:')) {
      const name = e.target.slice('symbol-name:'.length);
      const ids = symbolByName.get(name) || [];
      for (const sid of ids) {
        edges.push({ ...e, target: sid });
        // ensure symbol node exists (it should)
      }
    } else {
      edges.push(e);
    }
  }

  const memory = extractMemory(root, fileIndex, { skips });
  for (const n of memory.nodes) addNode(n);
  for (const e of memory.edges) {
    if (nodes.has(e.source) && nodes.has(e.target)) edges.push(e);
  }

  // Ensure external/unresolved targets exist as nodes; drop dangling symbol refs
  for (const e of edges) {
    if ((e.target.startsWith('external:') || e.target.startsWith('unresolved:')) && !nodes.has(e.target)) {
      addNode({
        id: e.target,
        type: e.target.startsWith('external:') ? 'external' : 'unresolved',
        label: e.target.replace(/^(external|unresolved):/, ''),
        source_file: e.source_file,
        source_location: e.source_location,
      });
    }
  }
  const cleanEdges = edges.filter((e) => {
    if (!nodes.has(e.source)) return false;
    if (!nodes.has(e.target)) return false;
    return true;
  });

  const graph = {
    directed: true,
    multigraph: true,
    graph: {
      built_at: new Date().toISOString(),
      root: root,
      extractor: extractor.mode,
      schema_version: GRAPH_SCHEMA_VERSION,
    },
    nodes: [...nodes.values()],
    links: cleanEdges.map((e) => ({
      source: e.source,
      target: e.target,
      relation: e.relation,
      confidence: e.confidence,
      source_file: e.source_file,
      source_location: e.source_location,
      weight: e.weight ?? 1,
      ...(e.imported != null ? { imported: e.imported } : {}),
      ...(e.local != null ? { local: e.local } : {}),
      ...(e.name != null ? { name: e.name } : {}),
    })),
  };

  const stats = {
    files: fileIndex.size,
    nodes: graph.nodes.length,
    edges: graph.links.length,
    symbols: graph.nodes.filter((n) => n.type === 'symbol').length,
    modules: graph.nodes.filter((n) => n.type === 'module').length,
    extractor: extractor.mode,
  };

  return { graph, stats, hashes, skipped: skips.list(), extractorMode: extractor.mode };
}

export function writeGraphArtifacts(root, { graph, stats, hashes, skipped = [] }) {
  ensureGraphDir(root);
  writeJson(graphPath(root), graph);
  // The manifest keeps the path and the code; a skip's note is said on stderr.
  const recorded = skipped.map(({ path: skippedPath, code }) => ({ path: skippedPath, code }));
  writeJson(manifestPath(root), {
    built_at: graph.graph.built_at,
    schema_version: graph.graph.schema_version,
    extractor: graph.graph.extractor,
    overlays: overlayHashes(root),
    files: hashes,
    skipped: recorded,
    stats,
  });
  const report = writeReport(root, graph, stats, recorded);
  fs.writeFileSync(reportPath(root), report);
  return { graphPath: graphPath(root), reportPath: reportPath(root), stats };
}

export function loadGraph(root) {
  const g = loadJson(graphPath(root), null);
  if (!g) {
    throw new Error(`No graph found at ${graphPath(root)}. Run: interlock-graph build`);
  }
  return g;
}
