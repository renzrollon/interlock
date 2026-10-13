import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, before } from 'node:test';
import { buildGraph, writeGraphArtifacts, loadGraph } from '../../lib/graph/graph/build.mjs';
// Reached through the namespace so a missing export fails its own tests and
// leaves the ones above running.
import * as specText from '../../lib/spec-text.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'mini-svc');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// The spec→file extractor used to gate matches behind a hardcoded top-level
// directory allowlist (src|app|lib|components|packages|tools|...). Repos laid
// out the Go/Rust/Java way — cmd/, internal/, pkg/, apps/, services/ — produced
// zero implements_spec edges even when every file was indexed. Matches are
// already gated by knownFiles, so the allowlist could only ever cause false
// negatives.
describe('openspec spec→file links on non-conventional layouts', () => {
  let graph;

  before(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'interlock-svc-'));
    copyDir(FIXTURE, tmp);
    const result = buildGraph(tmp);
    writeGraphArtifacts(tmp, result);
    graph = loadGraph(tmp);
  });

  const linkedTo = (file) =>
    graph.links.some((e) => e.relation === 'implements_spec' && e.target === `file:${file}`);

  it('links a spec to files under cmd/ and internal/', () => {
    assert.ok(linkedTo('cmd/api/main.py'), 'expected implements_spec edge to cmd/api/main.py');
    assert.ok(
      linkedTo('internal/service/handler.py'),
      'expected implements_spec edge to internal/service/handler.py',
    );
  });

  it('links a spec to a file in a top-level dir outside the old allowlist', () => {
    assert.ok(linkedTo('util/token.py'), 'expected implements_spec edge to util/token.py');
  });

  it('still only links files the graph actually indexed', () => {
    const specLinks = graph.links.filter((e) => e.relation === 'implements_spec');
    const indexed = new Set(graph.nodes.filter((n) => n.type === 'file').map((n) => n.id));
    for (const link of specLinks) {
      if (!link.target.startsWith('file:')) continue;
      assert.ok(indexed.has(link.target), `${link.target} should be an indexed file node`);
    }
  });
});

// The rule for "a spec mentions this file" now lives in one pure function,
// `specMentionedPaths` in lib/spec-text.mjs, which the spec-coverage signal
// reads too. The extractor calls it and keeps its own gate on files the graph
// indexed, so a fresh graph and the signal agree by construction while the
// edges the graph already emitted stay exactly as they were.
// design D7 of complete-and-record-the-merge-verdict.
describe('openspec spec→file links read through specMentionedPaths', () => {
  const FIXTURES = path.join(__dirname, 'fixtures');

  function build(fixture, extra = {}) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'interlock-paths-'));
    copyDir(path.join(FIXTURES, fixture), tmp);
    for (const [rel, text] of Object.entries(extra)) {
      fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
      fs.writeFileSync(path.join(tmp, rel), text);
    }
    const result = buildGraph(tmp);
    writeGraphArtifacts(tmp, result);
    return loadGraph(tmp);
  }

  const fileEdges = (graph) =>
    graph.links
      .filter((e) => e.relation === 'implements_spec' && e.target.startsWith('file:'))
      .map((e) => [e.source, e.target, e.source_location])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  // Pinned from the extractor as it stood before it read through the function.
  // A fixture added later gets its own entry; none of these may move.
  const REFERENCE = {
    'mini-app': [
      ['openspec:openspec/specs/auth/spec.md', 'file:app/api/login.ts', 'L7'],
      ['openspec:openspec/specs/auth/spec.md', 'file:lib/auth.ts', 'L7'],
    ],
    'mini-svc': [
      ['openspec:openspec/specs/api/spec.md', 'file:cmd/api/main.py', 'L7'],
      ['openspec:openspec/specs/api/spec.md', 'file:internal/service/handler.py', 'L7'],
      ['openspec:openspec/specs/api/spec.md', 'file:util/token.py', 'L8'],
    ],
  };

  for (const [fixture, expected] of Object.entries(REFERENCE)) {
    it(`keeps every ${fixture} spec→file edge, with its line`, () => {
      assert.deepEqual(fileEdges(build(fixture)), expected);
    });
  }

  it('has a reference for every fixture that carries a spec', () => {
    const withSpecs = fs
      .readdirSync(FIXTURES, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(FIXTURES, e.name, 'openspec')))
      .map((e) => e.name)
      .sort();
    assert.deepEqual(withSpecs, Object.keys(REFERENCE).sort());
  });

  it('links exactly the mentioned paths the graph indexed, and no others', () => {
    const text = [
      '# Extra',
      '',
      '## Requirements',
      '',
      'Created by `./internal/service/handler.py`, read through "util/token.py",',
      'and bare cmd/api/main.py, never https://example.com/util/not-a-file.py,',
      'and `nowhere/else/ghost.py` is not in the graph.',
      '',
    ].join('\n');
    const spec = 'openspec/specs/extra/spec.md';
    const graph = build('mini-svc', { [spec]: text });
    const indexed = new Set(graph.nodes.filter((n) => n.type === 'file').map((n) => n.id));

    const expected = specText
      .specMentionedPaths(text)
      .map((p) => `file:${p}`)
      .filter((id) => indexed.has(id))
      .sort();
    const linked = fileEdges(graph)
      .filter(([source]) => source === `openspec:${spec}`)
      .map(([, target]) => target)
      .sort();

    assert.ok(expected.length > 0, 'the fixture text should mention at least one indexed file');
    assert.deepEqual(linked, expected);
  });

  it('puts the line a mention is on in the edge it emits', () => {
    const text = ['# Lines', '', 'first', 'second', 'then `util/token.py` here', ''].join('\n');
    const spec = 'openspec/specs/lines/spec.md';
    const graph = build('mini-svc', { [spec]: text });
    const edge = fileEdges(graph).find(
      ([source, target]) => source === `openspec:${spec}` && target === 'file:util/token.py',
    );
    assert.ok(edge, 'expected an edge from the lines spec to util/token.py');
    assert.equal(edge[2], 'L5');
  });
});
