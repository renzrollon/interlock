import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, before } from 'node:test';
import { extractPython } from '../../lib/graph/extract/python.mjs';
import { extractShell } from '../../lib/graph/extract/shell.mjs';
import { buildGraph, loadGraph, resolveImport, writeGraphArtifacts } from '../../lib/graph/graph/build.mjs';
import { consumers } from '../../lib/graph/graph/query.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'mini-py');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

describe('python extractor', () => {
  it('extracts from-import and top-level defs', () => {
    const src = `
from pkg.util import Gate, normalize

def run(user):
    return normalize(user)
`;
    const result = extractPython('pkg/service.py', src);
    assert.ok(result.imports.some((i) => i.from === 'pkg.util' && i.imported === 'normalize'));
    assert.ok(result.exports.some((e) => e.name === 'run'));
  });

  it('handles parenthesized multiline imports', () => {
    const src = `
from pkg.util import (
    Gate,
    normalize,
)
`;
    const result = extractPython('pkg/service.py', src);
    assert.ok(result.imports.some((i) => i.imported === 'Gate'));
    assert.ok(result.imports.some((i) => i.imported === 'normalize'));
  });
});

describe('shell extractor', () => {
  it('extracts source and functions', () => {
    const src = `
source "$SCRIPT_DIR/lib.sh"
greet() {
  echo hi
}
`;
    const result = extractShell('scripts/run.sh', src);
    assert.ok(result.imports.some((i) => i.from === 'lib.sh' || i.from.endsWith('lib.sh')));
    assert.ok(result.exports.some((e) => e.name === 'greet'));
  });
});

describe('resolveImport python/shell', () => {
  it('resolves package imports to .py files', () => {
    const index = new Set(['pkg/util.py', 'pkg/service.py']);
    const r = resolveImport('pkg/service.py', 'pkg.util', index);
    assert.equal(r.kind, 'file');
    assert.equal(r.path, 'pkg/util.py');
  });

  it('resolves shell source by basename when unique', () => {
    const index = new Set(['scripts/run.sh', 'scripts/lib.sh']);
    const r = resolveImport('scripts/run.sh', 'lib.sh', index);
    assert.equal(r.kind, 'file');
    assert.equal(r.path, 'scripts/lib.sh');
  });
});

describe('build + query on python/shell fixture', () => {
  let graph;

  before(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'specflow-graph-py-'));
    copyDir(FIXTURE, tmp);
    const result = buildGraph(tmp);
    writeGraphArtifacts(tmp, result);
    graph = loadGraph(tmp);
  });

  it('indexes python files and import edges', () => {
    assert.ok(graph.nodes.some((n) => n.id === 'file:pkg/service.py'));
    assert.ok(graph.nodes.some((n) => n.label === 'normalize'));
    const imports = graph.links.filter((e) => e.relation === 'imports');
    assert.ok(imports.some((e) => e.source.includes('service.py') && e.target.includes('util.py')));
  });

  it('indexes shell source edges', () => {
    assert.ok(graph.nodes.some((n) => n.id === 'file:scripts/run.sh'));
    const imports = graph.links.filter((e) => e.relation === 'imports');
    assert.ok(imports.some((e) => e.source.includes('run.sh') && e.target.includes('lib.sh')));
  });

  it('finds consumers of normalize', () => {
    const out = consumers(graph, 'normalize');
    assert.match(out, /service\.py|Consumers/);
  });
});
