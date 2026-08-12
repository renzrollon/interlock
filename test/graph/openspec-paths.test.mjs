import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, before } from 'node:test';
import { buildGraph, writeGraphArtifacts, loadGraph } from '../../lib/graph/graph/build.mjs';

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
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'specflow-svc-'));
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
