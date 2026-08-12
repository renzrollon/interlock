import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, before } from 'node:test';
import { buildGraph, writeGraphArtifacts, loadGraph } from '../../lib/graph/graph/build.mjs';
import { consumers, findSeedNodes, shortestPath, traverse } from '../../lib/graph/graph/query.mjs';
import { updateGraph } from '../../lib/graph/graph/update.mjs';
import { extractWithRegex } from '../../lib/graph/extract/regex-fallback.mjs';
import { resolveImport } from '../../lib/graph/graph/build.mjs';
import { estimateTokens } from '../../lib/graph/format.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'mini-app');

describe('regex extractor', () => {
  it('extracts named imports and exports', () => {
    const src = `
import { normalizeEmail } from './auth';
export function sessionKey(email) { return normalizeEmail(email); }
`;
    const result = extractWithRegex('lib/session.ts', src);
    assert.ok(result.exports.some((e) => e.name === 'sessionKey'));
    assert.ok(result.imports.some((i) => i.from === './auth' && i.imported === 'normalizeEmail'));
    assert.ok(result.references.some((r) => r.name === 'normalizeEmail'));
  });
});

describe('resolveImport', () => {
  it('resolves relative ts paths', () => {
    const index = new Set(['lib/auth.ts', 'lib/session.ts']);
    const r = resolveImport('lib/session.ts', './auth', index);
    assert.equal(r.kind, 'file');
    assert.equal(r.path, 'lib/auth.ts');
  });
});

describe('build + query on fixture', () => {
  let tmp;
  let graph;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'interlock-graph-'));
    // Copy fixture into temp so we can write .claude/graph without dirtying repo
    copyDir(FIXTURE, tmp);
    const result = buildGraph(tmp);
    writeGraphArtifacts(tmp, result);
    graph = loadGraph(tmp);
  });

  it('builds file/symbol/import edges', () => {
    const files = graph.nodes.filter((n) => n.type === 'file');
    assert.ok(files.length >= 3);
    const symbols = graph.nodes.filter((n) => n.type === 'symbol');
    assert.ok(symbols.some((s) => s.label === 'normalizeEmail'));
    assert.ok(symbols.some((s) => s.label === 'AuthService'));
    const imports = graph.links.filter((e) => e.relation === 'imports');
    assert.ok(imports.some((e) => e.source.includes('session') && e.target.includes('auth')));
  });

  it('indexes openspec and memory overlays', () => {
    assert.ok(graph.nodes.some((n) => n.type === 'openspec'));
    assert.ok(graph.nodes.some((n) => n.type === 'memory'));
    assert.ok(
      graph.links.some((e) => e.relation === 'couples_with' || e.relation === 'implements_spec'),
    );
  });

  it('finds consumers of normalizeEmail', () => {
    const out = consumers(graph, 'normalizeEmail');
    assert.match(out, /session\.ts|login\.ts|Consumers/);
    assert.match(out, /imports|references/);
  });

  it('query respects budget', () => {
    const seeds = findSeedNodes(graph, 'AuthService');
    assert.ok(seeds.length > 0);
    const text = traverse(graph, seeds, { mode: 'bfs', depth: 3, budget: 200 });
    assert.ok(estimateTokens(text) <= 220);
  });

  it('finds a path between login and auth', () => {
    const out = shortestPath(graph, 'login', 'auth');
    assert.match(out, /Traversal: PATH|EDGE/);
  });

  it('update is no-op when unchanged', () => {
    const once = updateGraph(tmp);
    assert.equal(once.updated, false);
    assert.equal(once.reason, 'up-to-date');
  });

  it('update rebuilds when a file changes', () => {
    const target = path.join(tmp, 'lib', 'auth.ts');
    fs.appendFileSync(target, '\nexport const EXTRA = 1;\n');
    const once = updateGraph(tmp);
    assert.equal(once.updated, true);
    const g2 = loadGraph(tmp);
    assert.ok(g2.nodes.some((n) => n.label === 'EXTRA'));
  });
});

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
