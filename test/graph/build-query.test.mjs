import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, before } from 'node:test';
import { buildGraph, writeGraphArtifacts, loadGraph } from '../../lib/graph/graph/build.mjs';
import { consumers, findSeedNodes, shortestPath, traverse } from '../../lib/graph/graph/query.mjs';
import { updateGraph } from '../../lib/graph/graph/update.mjs';
import { extractWithRegex } from '../../lib/graph/extract/regex-fallback.mjs';
import { createJsExtractor, resolveJsExtractorMode } from '../../lib/graph/extract/typescript.mjs';
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

describe('update rebuilds when what the graph depends on changed', () => {
  let root;

  const readManifest = () => JSON.parse(fs.readFileSync(path.join(root, '.claude', 'graph', 'manifest.json'), 'utf8'));
  const writeManifest = (m) =>
    fs.writeFileSync(path.join(root, '.claude', 'graph', 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`);

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'interlock-graph-dep-'));
    copyDir(FIXTURE, root);
    writeGraphArtifacts(root, buildGraph(root));
  });

  it('rebuilds on a manifest that predates the schema record, naming it', () => {
    const m = readManifest();
    delete m.schema_version;
    writeManifest(m);
    const once = updateGraph(root);
    assert.equal(once.updated, true);
    assert.match(once.reason, /predates/);
    assert.notEqual(once.reason, 'up-to-date');
    assert.ok(readManifest().schema_version, 'the rebuild records the schema version');
  });

  it('rebuilds on a different extractor', () => {
    const m = readManifest();
    m.extractor = 'some-other-extractor';
    writeManifest(m);
    const once = updateGraph(root);
    assert.equal(once.updated, true);
    assert.match(once.reason, /extractor/);
  });

  it('rebuilds on a different schema version, naming both', () => {
    const m = readManifest();
    m.schema_version = 'schema-from-another-release';
    writeManifest(m);
    const once = updateGraph(root);
    assert.equal(once.updated, true);
    assert.match(once.reason, /schema/);
  });

  it('rebuilds on an edit under openspec/specs, counting one changed overlay', () => {
    assert.equal(updateGraph(root).updated, false, 'a current graph is the starting point');
    fs.appendFileSync(path.join(root, 'openspec', 'specs', 'auth', 'spec.md'), '\nAn added line.\n');
    const once = updateGraph(root);
    assert.equal(once.updated, true);
    assert.match(once.reason, /overlays changed=1/);
  });

  it('reports an untouched tree up to date', () => {
    const once = updateGraph(root);
    assert.equal(once.updated, false);
    assert.equal(once.reason, 'up-to-date');
  });

  it('records the overlay hashes the caller passed instead of reading them again', () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'interlock-graph-overlays-'));
    try {
      copyDir(FIXTURE, scratch);
      const sentinel = { 'openspec/specs/sentinel.md': 'not-a-real-hash' };
      writeGraphArtifacts(scratch, { ...buildGraph(scratch), overlays: sentinel });
      const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.claude', 'graph', 'manifest.json'), 'utf8'));
      assert.deepEqual(manifest.overlays, sentinel);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('the extractor mode an update compares is resolved, never loaded', () => {
  const UPDATE = path.join(__dirname, '..', '..', 'lib', 'graph', 'graph', 'update.mjs');

  /** A project whose `typescript` writes a `loaded` file beside itself when evaluated. */
  function projectWithTracingTypescript() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'interlock-graph-ts-'));
    copyDir(FIXTURE, root);
    const pkg = path.join(root, 'node_modules', 'typescript');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), '{"name":"typescript","version":"0.0.0","main":"index.js"}\n');
    fs.writeFileSync(
      path.join(pkg, 'index.js'),
      "require('node:fs').writeFileSync(require('node:path').join(__dirname, 'loaded'), 'x');\nmodule.exports = {};\n",
    );
    return { root, loaded: path.join(pkg, 'loaded') };
  }

  it('resolves the same mode createJsExtractor picks, without evaluating the module', () => {
    const { root, loaded } = projectWithTracingTypescript();
    try {
      assert.equal(resolveJsExtractorMode(root), 'typescript');
      assert.equal(fs.existsSync(loaded), false, 'resolving the mode evaluated typescript');
      assert.equal(createJsExtractor(root).mode, 'typescript');
      assert.equal(fs.existsSync(loaded), true, 'the tracer records an evaluation');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('a no-op update does not load typescript', () => {
    const { root, loaded } = projectWithTracingTypescript();
    try {
      writeGraphArtifacts(root, buildGraph(root));
      fs.rmSync(loaded, { force: true });
      // A fresh process, so this one's module cache cannot hide a second load.
      const r = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import { updateGraph } from ${JSON.stringify(UPDATE)}; process.stdout.write(updateGraph(${JSON.stringify(root)}).reason)`,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, 'up-to-date');
      assert.equal(fs.existsSync(loaded), false, 'the up-to-date check loaded typescript');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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
