import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { buildGraph, loadGraph, resolveImport, writeGraphArtifacts } from '../../lib/graph/graph/build.mjs';
import { consumers, explain } from '../../lib/graph/graph/query.mjs';

// The extractors under test do not exist yet. They are imported inside the
// cases that need them (`loadExtractor`), not at the top of the file: a static
// import of a missing module fails the file at link time and hides every
// graph-level case behind a single ERR_MODULE_NOT_FOUND.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');
const BIN = path.join(__dirname, '..', '..', 'bin', 'interlock-graph');
const EXTRACT = path.join(__dirname, '..', '..', 'lib', 'graph', 'extract');

const tmpRoots = [];
after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
});

function mkTmp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function buildFixture(name) {
  const tmp = mkTmp(`interlock-graph-${name}-`);
  copyDir(path.join(FIXTURES, name), tmp);
  const result = buildGraph(tmp);
  writeGraphArtifacts(tmp, result);
  return loadGraph(tmp);
}

function buildTree(files, prefix) {
  const tmp = mkTmp(prefix);
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
  const result = buildGraph(tmp);
  writeGraphArtifacts(tmp, result);
  return { tmp, graph: loadGraph(tmp) };
}

function runBuild(root) {
  const r = spawnSync(process.execPath, [BIN, 'build', '.'], { cwd: root, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

async function loadExtractor(file, name) {
  const mod = await import(path.join(EXTRACT, file));
  assert.equal(typeof mod[name], 'function', `${file} must export ${name}`);
  return mod[name];
}

const nodesById = (g, id) => g.nodes.filter((n) => n.id === id);
const nodeOf = (g, id) => g.nodes.find((n) => n.id === id);
const linksFrom = (g, source) => g.links.filter((l) => l.source === source);
const nsNames = (namespaces) => namespaces.map((n) => (typeof n === 'string' ? n : n.name));

const DOTNET = {
  core: 'file:src/Core/Core.csproj',
  app: 'file:src/App/App.csproj',
  api: 'file:src/Api/Api.csproj',
  coreTests: 'file:tests/Core.Tests/Core.Tests.csproj',
  dms: 'file:src/Core/DeviceMetricSource.cs',
  dmsSym: 'symbol:src/Core/DeviceMetricSource.cs#DeviceMetricSource',
  dashboard: 'file:src/App/Dashboard.cs',
  probe: 'file:src/Core/Sensors/Probe.cs',
  orphan: 'file:src/Api/Orphan.cs',
  shapes: 'file:src/Core/Shapes.cs',
  cacheExtra: 'file:src/Core/Cache.Extra.cs',
  testFile: 'file:tests/Core.Tests/DeviceMetricSourceTests.cs',
  nsCore: 'namespace:Acme.Core',
};

describe('C# fixture: project references', () => {
  let g;
  before(() => {
    g = buildFixture('mini-dotnet');
  });

  it('consumers of Core.csproj are the three referencing projects, on EXTRACTED imports edges', () => {
    const out = consumers(g, 'src/Core/Core.csproj');
    for (const proj of ['src/App/App.csproj', 'src/Api/Api.csproj', 'tests/Core.Tests/Core.Tests.csproj']) {
      assert.match(out, new RegExp(`EDGE ${proj.replace(/[.]/g, '\\.')} --imports \\[EXTRACTED\\]`), proj);
    }
    for (const src of [DOTNET.app, DOTNET.api, DOTNET.coreTests]) {
      const edge = g.links.find((l) => l.source === src && l.target === DOTNET.core);
      assert.ok(edge, `${src} has an edge to Core.csproj`);
      assert.equal(edge.relation, 'imports');
      assert.equal(edge.confidence, 'EXTRACTED');
    }
  });

  it('the backslash, forward-slash and parent-hopping spellings land on one node', () => {
    assert.equal(nodesById(g, DOTNET.core).length, 1);
    const csprojFileNodes = g.nodes.filter((n) => n.type === 'file' && n.id.endsWith('Core.csproj'));
    assert.equal(csprojFileNodes.length, 1);
  });

  it('a $(RepoRoot) reference is an unresolved target and invents no file edge', () => {
    const edges = linksFrom(g, DOTNET.api).filter((l) => l.relation === 'imports');
    const unresolved = edges.filter((l) => l.target.startsWith('unresolved:'));
    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0].source_location, 'L7');
    assert.ok(!edges.some((l) => l.target.startsWith('file:') && /Gone/.test(l.target)));
    assert.ok(!g.nodes.some((n) => n.type === 'file' && /Gone/.test(n.id)));
  });
});

describe('C# fixture: types', () => {
  let g;
  before(() => {
    g = buildFixture('mini-dotnet');
  });

  it('DeviceMetricSource is a symbol at line 5 of its file', () => {
    const sym = nodeOf(g, DOTNET.dmsSym);
    assert.ok(sym, 'symbol exists');
    assert.equal(sym.type, 'symbol');
    assert.equal(sym.source_file, 'src/Core/DeviceMetricSource.cs');
    assert.equal(sym.source_location, 'L5');
    const out = explain(g, 'DeviceMetricSource');
    assert.match(out, /symbol:src\/Core\/DeviceMetricSource\.cs#DeviceMetricSource \[type=symbol src=src\/Core\/DeviceMetricSource\.cs loc=L5\]/);
  });

  it('record struct, enum, interface and generic class are symbols', () => {
    for (const label of ['Reading', 'Unit', 'IMetricSource']) {
      const found = g.nodes.filter((n) => n.type === 'symbol' && n.label === label);
      assert.equal(found.length, 1, label);
      assert.equal(found[0].source_file, 'src/Core/Shapes.cs');
      assert.match(found[0].source_location, /^L\d+$/);
    }
    const caches = g.nodes.filter((n) => n.type === 'symbol' && n.label === 'Cache');
    assert.deepEqual(caches.map((n) => n.source_file).sort(), ['src/Core/Cache.Extra.cs', 'src/Core/Shapes.cs']);
  });

  it('a commented-out declaration is not a symbol, and a symbol drops its type parameters', () => {
    assert.ok(!g.nodes.some((n) => n.label === 'Ghost'));
    assert.ok(!g.nodes.some((n) => n.type === 'symbol' && n.label === 'Cache<T>'));
    assert.ok(!g.nodes.some((n) => n.type === 'symbol' && /</.test(n.label)));
  });
});

describe('C# fixture: namespaces', () => {
  let g;
  before(() => {
    g = buildFixture('mini-dotnet');
  });

  it('a namespace declared in three files is one node', () => {
    assert.equal(nodesById(g, DOTNET.nsCore).length, 1);
    assert.equal(g.nodes.filter((n) => n.type === 'namespace' && n.label === 'Acme.Core').length, 1);
  });

  it('each declaring file has a declares edge, carrying its own declaration line', () => {
    const declares = g.links.filter((l) => l.relation === 'declares' && l.target === DOTNET.nsCore);
    assert.deepEqual(
      declares.map((l) => l.source).sort(),
      [DOTNET.cacheExtra, DOTNET.dms, DOTNET.shapes].sort(),
    );
    assert.equal(declares.find((l) => l.source === DOTNET.dms).source_location, 'L1');
  });

  it('consumers of the namespace name the importer on an imports edge and no file through declares', () => {
    const out = consumers(g, 'Acme.Core');
    assert.match(out, /EDGE src\/App\/Dashboard\.cs --imports \[[A-Z]+\]--> /);
    assert.doesNotMatch(out, /--declares/);
    assert.doesNotMatch(out, /consumer_file: src\/Core\/DeviceMetricSource\.cs/);
  });
});

describe('C# fixture: using directive forms', () => {
  let g;
  before(() => {
    g = buildFixture('mini-dotnet');
  });

  it('a namespace the repository does not declare is external, not unresolved, and not a namespace node', () => {
    const edges = linksFrom(g, DOTNET.dashboard);
    assert.ok(edges.some((l) => l.relation === 'imports' && l.target === 'external:System.Text'));
    assert.ok(!edges.some((l) => l.target.startsWith('unresolved:')));
    assert.ok(!g.nodes.some((n) => n.id === 'namespace:System.Text'));
  });

  it('plain, global, static and alias directives each resolve to the one Acme.Core node', () => {
    const imports = linksFrom(g, DOTNET.dashboard).filter((l) => l.relation === 'imports');
    for (const line of ['L1', 'L3', 'L4', 'L5']) {
      const edge = imports.find((l) => l.source_location === line);
      assert.ok(edge, `an imports edge at ${line}`);
      assert.equal(edge.target, DOTNET.nsCore, `${line} resolves to Acme.Core`);
    }
    assert.ok(!g.nodes.some((n) => n.id === 'namespace:Acme.Core.Units' || n.id === 'namespace:Acme.Core.Metrics'));
  });

  it('a using statement inside a method body is not an import', () => {
    for (const l of linksFrom(g, DOTNET.dashboard)) {
      assert.doesNotMatch(l.target, /stream|Open/, `${l.relation} -> ${l.target}`);
    }
    assert.ok(!linksFrom(g, DOTNET.dashboard).some((l) => l.relation === 'imports' && l.source_location === 'L13'));
  });
});

describe('C# fixture: inferred references', () => {
  let g;
  before(() => {
    g = buildFixture('mini-dotnet');
  });

  it('a file that names a visible type is its consumer, on an INFERRED references edge', () => {
    const out = consumers(g, 'DeviceMetricSource');
    assert.match(out, /EDGE src\/App\/Dashboard\.cs --references \[INFERRED\]--> /);
    assert.match(out, /EDGE src\/Core\/Sensors\/Probe\.cs --references \[INFERRED\]--> /);
    for (const src of [DOTNET.dashboard, DOTNET.probe]) {
      const edge = g.links.find((l) => l.source === src && l.target === DOTNET.dmsSym && l.relation === 'references');
      assert.ok(edge, `${src} references the symbol`);
      assert.equal(edge.confidence, 'INFERRED');
    }
  });

  it('a file in an invisible namespace, and the declaring file itself, are not consumers', () => {
    const into = g.links.filter((l) => l.target === DOTNET.dmsSym && l.relation === 'references');
    assert.ok(!into.some((l) => l.source === DOTNET.orphan));
    assert.ok(!into.some((l) => l.source === DOTNET.dms));
    const out = consumers(g, 'DeviceMetricSource');
    assert.doesNotMatch(out, /EDGE src\/Api\/Orphan\.cs/);
    assert.doesNotMatch(out, /EDGE src\/Core\/DeviceMetricSource\.cs --references/);
  });

  it('a longer identifier is not a use, and an enclosing namespace is visible', () => {
    assert.ok(!g.nodes.some((n) => n.label === 'DeviceMetricSourceFactory'));
    const fromProbe = linksFrom(g, DOTNET.probe).filter((l) => {
      if (l.relation !== 'references') return false;
      const t = nodeOf(g, l.target);
      return t?.type === 'symbol' && t.label === 'DeviceMetricSource';
    });
    assert.equal(fromProbe.length, 1);
  });
});

describe('C# fixture: tests', () => {
  let g;
  before(() => {
    g = buildFixture('mini-dotnet');
  });

  const testNodes = () => g.nodes.filter((n) => n.type === 'test');

  it('xUnit, NUnit and MSTest attribute layouts each yield a test node with a location', () => {
    const labels = testNodes().map((n) => n.label).sort();
    assert.deepEqual(labels, [
      'DeviceMetricSourceTests.Mstest_style',
      'DeviceMetricSourceTests.Nunit_style',
      'DeviceMetricSourceTests.Reads_metric',
      'DeviceMetricSourceTests.Scales',
      'DeviceMetricSourceTests.Skipped',
    ]);
    for (const n of testNodes()) {
      assert.equal(n.source_file, 'tests/Core.Tests/DeviceMetricSourceTests.cs');
      assert.match(n.source_location, /^L\d+$/);
    }
  });

  it('a method with a non-test attribute, and one with none, are not test nodes', () => {
    assert.ok(!g.nodes.some((n) => n.type === 'test' && /\.(Old|Helper)$/.test(n.label)));
    assert.ok(!g.nodes.some((n) => n.id.startsWith('test:') && /#.*\.(Old|Helper)$/.test(n.id)));
  });

  it('consumers of a type prints a consumer_test line naming the test that touches it', () => {
    const out = consumers(g, 'DeviceMetricSource');
    assert.match(out, /consumer_test:/);
    assert.match(out, /Reads_metric/);
    assert.match(out, /DeviceMetricSourceTests\.cs/);
    const reads = testNodes().find((n) => n.label === 'DeviceMetricSourceTests.Reads_metric');
    const edge = g.links.find((l) => l.source === reads.id && l.target === DOTNET.dmsSym);
    assert.ok(edge, 'the test references the type');
    assert.equal(edge.relation, 'references');
    assert.equal(edge.confidence, 'INFERRED');
  });

  it('a type named only above every test is credited to the file and to no test', () => {
    const iMetric = g.nodes.find((n) => n.type === 'symbol' && n.label === 'IMetricSource');
    const into = g.links.filter((l) => l.target === iMetric.id && l.relation === 'references');
    assert.ok(into.some((l) => l.source === DOTNET.testFile));
    const testIds = new Set(testNodes().map((n) => n.id));
    assert.ok(!into.some((l) => testIds.has(l.source)));
  });
});

describe('C# fixture: build output', () => {
  let g;
  before(() => {
    g = buildFixture('mini-dotnet');
  });

  it('obj/ and bin/ beside a project file are not indexed', () => {
    assert.ok(!g.nodes.some((n) => n.source_file?.startsWith('src/App/obj/')));
    assert.ok(!g.nodes.some((n) => n.source_file?.startsWith('src/App/bin/')));
    assert.ok(!g.nodes.some((n) => n.id === 'namespace:Acme.App.Generated'));
    assert.ok(!g.nodes.some((n) => n.label === 'AssemblyInfoGenerated' || n.label === 'BinGenerated'));
  });

  it('an obj/ directory with no project file beside it is walked', () => {
    const thing = nodeOf(g, 'file:src/App/Models/obj/Thing.cs');
    assert.ok(thing, 'Thing.cs is a file node');
    assert.equal(thing.type, 'file');
  });

  it('bin/cli.js in a tree with no project file is still indexed', () => {
    const { graph } = buildTree({ 'bin/cli.js': 'export const run = () => 1;\n' }, 'interlock-graph-bin-');
    const cli = nodeOf(graph, 'file:bin/cli.js');
    assert.ok(cli, 'bin/cli.js is a file node');
    assert.equal(cli.type, 'file');
  });
});

describe('Bicep fixture', () => {
  let g;
  const MAIN = 'file:infra/main.bicep';
  before(() => {
    g = buildFixture('mini-bicep');
  });

  it('local module paths become EXTRACTED imports edges, beside and across directories', () => {
    const imports = linksFrom(g, MAIN).filter((l) => l.relation === 'imports');
    for (const target of ['file:infra/modules/storage.bicep', 'file:infra/a.bicep', 'file:shared/b.bicep']) {
      const edge = imports.find((l) => l.target === target);
      assert.ok(edge, `main.bicep imports ${target}`);
      assert.equal(edge.confidence, 'EXTRACTED');
    }
  });

  it('a registry module resolves to an external node', () => {
    const external = linksFrom(g, MAIN).filter((l) => l.relation === 'imports' && l.target.startsWith('external:'));
    assert.equal(external.length, 1);
    assert.equal(nodeOf(g, external[0].target).type, 'external');
  });

  it('param, var, resource and output declarations are symbols at their lines', () => {
    const want = { location: 'L1', prefix: 'L3', account: 'L5', accountId: 'L10' };
    for (const [label, loc] of Object.entries(want)) {
      const sym = g.nodes.find((n) => n.type === 'symbol' && n.label === label);
      assert.ok(sym, label);
      assert.equal(sym.source_file, 'infra/modules/storage.bicep', label);
      assert.equal(sym.source_location, loc, label);
    }
  });

  it('a decorated param is at the line of its param keyword', () => {
    const sku = g.nodes.find((n) => n.type === 'symbol' && n.label === 'sku');
    assert.ok(sku);
    assert.equal(sku.source_file, 'infra/main.bicep');
    assert.equal(sku.source_location, 'L5');
  });

  it('module.outputs.name is a reference to the output symbol, and a missing output makes no edge', () => {
    const out = consumers(g, 'accountId');
    assert.match(out, /EDGE infra\/main\.bicep --references \[[A-Z]+\]--> /);
    const edge = g.links.find(
      (l) => l.source === MAIN && l.target === 'symbol:infra/modules/storage.bicep#accountId',
    );
    assert.ok(edge, 'main.bicep references accountId');
    assert.equal(edge.relation, 'references');
    assert.ok(!g.links.some((l) => l.target.endsWith('#missing')));
    assert.ok(!g.nodes.some((n) => n.label === 'missing'));
  });
});

describe('stated language coverage', () => {
  it('a Go-only tree exits 0 and the notice lists .cs, .csproj and .bicep and still says unsupported', () => {
    const tmp = mkTmp('interlock-graph-go-');
    fs.writeFileSync(path.join(tmp, 'main.go'), 'package main\n\nfunc main() {}\n');
    const r = runBuild(tmp);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\.cs\b/);
    assert.match(r.stdout, /\.csproj/);
    assert.match(r.stdout, /\.bicep/);
    assert.match(r.stdout, /not structurally indexed/);
  });

  it('a Bicep-only tree indexes one file and gets no notice', () => {
    const tmp = mkTmp('interlock-graph-bicep-only-');
    fs.mkdirSync(path.join(tmp, 'infra'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'infra', 'main.bicep'), "param location string = 'westeurope'\n");
    const r = runBuild(tmp);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /files=1\b/);
    assert.doesNotMatch(r.stdout, /not structurally indexed/);
  });
});

describe('extractor units', () => {
  const FILE_SCOPED = 'namespace Acme.Core;\n\npublic class Widget\n{\n}\n';
  const BLOCK_SCOPED = 'namespace Acme.Core\n{\n    public class Widget\n    {\n    }\n}\n';

  it('extractCsproj returns each Include as written, in order, with its line', async () => {
    const extractCsproj = await loadExtractor('csproj.mjs', 'extractCsproj');
    const read = (p) => fs.readFileSync(path.join(FIXTURES, 'mini-dotnet', p), 'utf8');
    const api = extractCsproj('src/Api/Api.csproj', read('src/Api/Api.csproj'));
    assert.deepEqual(api.imports.map((i) => i.from), ['../Core/Core.csproj', '$(RepoRoot)src\\Gone\\Gone.csproj']);
    assert.deepEqual(api.imports.map((i) => i.line), [6, 7]);
    assert.ok(api.imports.every((i) => i.confidence === 'EXTRACTED'));
    const app = extractCsproj('src/App/App.csproj', read('src/App/App.csproj'));
    assert.deepEqual(app.imports.map((i) => i.from), ['..\\Core\\Core.csproj']);
    const core = extractCsproj('src/Core/Core.csproj', read('src/Core/Core.csproj'));
    assert.deepEqual(core.imports, []);
  });

  it('extractCsharp reads types as exports with their lines, and none from comments', async () => {
    const extractCsharp = await loadExtractor('csharp.mjs', 'extractCsharp');
    const src = fs.readFileSync(path.join(FIXTURES, 'mini-dotnet', 'src/Core/DeviceMetricSource.cs'), 'utf8');
    const r = extractCsharp('src/Core/DeviceMetricSource.cs', src);
    assert.deepEqual(r.exports.map((e) => [e.name, e.line]), [['DeviceMetricSource', 5]]);
    assert.deepEqual(r.imports, []);
    const shapes = fs.readFileSync(path.join(FIXTURES, 'mini-dotnet', 'src/Core/Shapes.cs'), 'utf8');
    const names = extractCsharp('src/Core/Shapes.cs', shapes).exports.map((e) => e.name);
    assert.deepEqual(names, ['Reading', 'Unit', 'IMetricSource', 'Cache']);
  });

  it('extractCsharp reads the file-scoped and the block-scoped namespace to the same name', async () => {
    const extractCsharp = await loadExtractor('csharp.mjs', 'extractCsharp');
    const a = extractCsharp('src/A.cs', FILE_SCOPED);
    const b = extractCsharp('src/B.cs', BLOCK_SCOPED);
    assert.deepEqual(nsNames(a.csharp.namespaces), ['Acme.Core']);
    assert.deepEqual(nsNames(b.csharp.namespaces), nsNames(a.csharp.namespaces));
  });

  it('extractBicep reads modules as imports, output references as named imports, and declarations as exports', async () => {
    const extractBicep = await loadExtractor('bicep.mjs', 'extractBicep');
    const src = fs.readFileSync(path.join(FIXTURES, 'mini-bicep', 'infra/main.bicep'), 'utf8');
    const r = extractBicep('infra/main.bicep', src);
    const froms = r.imports.map((i) => i.from);
    for (const from of ['./modules/storage.bicep', './a.bicep', '../shared/b.bicep', 'br:acme.azurecr.io/bicep/shared:v1']) {
      assert.ok(froms.includes(from), from);
    }
    assert.ok(r.imports.some((i) => i.from === './modules/storage.bicep' && i.imported === 'accountId'));
    const sku = r.exports.find((e) => e.name === 'sku');
    assert.ok(sku);
    assert.equal(sku.line, 5);
  });

  it('resolveImport reads both csproj separator spellings to the same node id', () => {
    const index = new Set(['src/Core/Core.csproj', 'src/App/App.csproj', 'src/Api/Api.csproj']);
    const back = resolveImport('src/App/App.csproj', '..\\Core\\Core.csproj', index);
    const fwd = resolveImport('src/App/App.csproj', '../Core/Core.csproj', index);
    assert.equal(back.kind, 'file');
    assert.equal(back.id, 'file:src/Core/Core.csproj');
    assert.equal(fwd.id, back.id);
    const deep = resolveImport(
      'tests/Core.Tests/Core.Tests.csproj',
      '..\\..\\src\\Core\\Core.csproj',
      new Set([...index, 'tests/Core.Tests/Core.Tests.csproj']),
    );
    assert.equal(deep.id, 'file:src/Core/Core.csproj');
  });

  it('resolveImport leaves an MSBuild property path unresolved, and a bicep registry path external', () => {
    const index = new Set(['src/Core/Core.csproj', 'infra/main.bicep', 'shared/b.bicep']);
    const prop = resolveImport('src/Api/Api.csproj', '$(RepoRoot)src\\Gone\\Gone.csproj', index);
    assert.equal(prop.kind, 'unresolved');
    assert.match(prop.id, /^unresolved:/);
    const parent = resolveImport('infra/main.bicep', '../shared/b.bicep', index);
    assert.equal(parent.id, 'file:shared/b.bicep');
    const registry = resolveImport('infra/main.bicep', 'br:acme.azurecr.io/bicep/shared:v1', index);
    assert.equal(registry.kind, 'external');
  });
});
