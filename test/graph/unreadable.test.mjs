import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
// Namespace import, not a named one: until readIndexed exists a named import
// would fail the module at link time and hide every other case behind it.
import * as paths from '../../lib/graph/paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'mini-app');
const BIN = path.join(__dirname, '..', '..', 'bin', 'interlock-graph');
const MARKER = 'GRAPH SKIPPED UNREADABLE';

const roots = [];
const denied = [];

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interlock-unreadable-'));
  roots.push(dir);
  return dir;
}

function freshRoot() {
  const root = tmpRoot();
  copyDir(FIXTURE, root);
  return root;
}

function write(root, relPath, text) {
  const abs = path.join(root, ...relPath.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return abs;
}

/** Deny reading and remember the old mode so `after` can put it back. */
function deny(abs) {
  denied.push({ abs, mode: fs.statSync(abs).mode & 0o777 });
  fs.chmodSync(abs, 0o000);
}

function allow(abs) {
  const at = denied.findIndex((d) => d.abs === abs);
  const mode = at >= 0 ? denied[at].mode : 0o644;
  fs.chmodSync(abs, mode);
  if (at >= 0) denied.splice(at, 1);
}

after(() => {
  // Parents first: a directory denied listing hides its children from chmod.
  for (const d of [...denied].sort((a, b) => a.abs.length - b.abs.length)) {
    try {
      fs.chmodSync(d.abs, d.mode);
    } catch {
      /* already gone */
    }
  }
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

let enforced = null;
/** True when mode 000 actually stops this user from reading (false for root). */
function permissionsEnforced() {
  if (enforced !== null) return enforced;
  const dir = tmpRoot();
  const probe = path.join(dir, 'probe.txt');
  fs.writeFileSync(probe, 'x');
  fs.chmodSync(probe, 0o000);
  try {
    fs.readFileSync(probe);
    enforced = false;
  } catch {
    enforced = true;
  }
  fs.chmodSync(probe, 0o644);
  return enforced;
}

const NOT_ENFORCED = 'this user can read a mode-000 file';

function run(root, args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const skipLines = (stderr) => stderr.split('\n').filter((l) => l.includes(MARKER));
const summaryLine = (stdout) => stdout.split('\n').find((l) => l.startsWith('files=')) ?? '';
const readGraph = (root) =>
  JSON.parse(fs.readFileSync(path.join(root, '.claude', 'graph', 'graph.json'), 'utf8'));
const readManifest = (root) =>
  JSON.parse(fs.readFileSync(path.join(root, '.claude', 'graph', 'manifest.json'), 'utf8'));
const fileNodeIds = (graph) => graph.nodes.filter((n) => n.type === 'file').map((n) => n.id);

describe('build finishes on an unreadable path', () => {
  it('skips a masked .mcp.json, names it once, and counts it', (t) => {
    if (!permissionsEnforced()) return t.skip(NOT_ENFORCED);
    const root = freshRoot();
    deny(write(root, '.mcp.json', '{"mcpServers":{}}\n'));

    const r = run(root, ['build', '.']);
    assert.equal(r.status, 0, r.stderr);

    const ids = fileNodeIds(readGraph(root));
    assert.ok(ids.includes('file:lib/auth.ts'));
    assert.ok(ids.includes('file:lib/session.ts'));
    assert.ok(!ids.includes('file:.mcp.json'));

    const lines = skipLines(r.stderr);
    assert.equal(lines.length, 1, r.stderr);
    assert.ok(lines[0].includes('.mcp.json'));
    assert.ok(lines[0].includes('EACCES'));
    assert.ok(summaryLine(r.stdout).includes('skipped=1'), r.stdout);
  });

  it('prints nothing new on a fully readable tree', () => {
    const root = freshRoot();
    const r = run(root, ['build', '.']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '');
    assert.ok(summaryLine(r.stdout).startsWith('files='));
    assert.ok(!summaryLine(r.stdout).includes('skipped='));
  });

  it('skips an unreadable directory as one path', (t) => {
    if (!permissionsEnforced()) return t.skip(NOT_ENFORCED);
    const root = freshRoot();
    write(root, 'vault/x.mjs', 'export const x = 1;\n');
    deny(path.join(root, 'vault'));

    const r = run(root, ['build', '.']);
    assert.equal(r.status, 0, r.stderr);
    const lines = skipLines(r.stderr);
    assert.equal(lines.length, 1, r.stderr);
    assert.ok(lines[0].includes('vault'));
    const sources = readGraph(root)
      .nodes.map((n) => n.source_file)
      .filter(Boolean);
    assert.ok(!sources.some((s) => s === 'vault' || s.startsWith('vault/')));
  });

  it('skips an unreadable ignore file and applies none of its patterns', (t) => {
    if (!permissionsEnforced()) return t.skip(NOT_ENFORCED);
    const root = freshRoot();
    deny(write(root, '.gitignore', 'generated/\n'));
    write(root, 'generated/g.mjs', 'export const g = 1;\n');

    const r = run(root, ['build', '.']);
    assert.equal(r.status, 0, r.stderr);
    const lines = skipLines(r.stderr);
    assert.equal(lines.length, 1, r.stderr);
    assert.ok(lines[0].includes('.gitignore'));
    assert.ok(lines[0].includes('its patterns were not applied'));
    assert.ok(fileNodeIds(readGraph(root)).includes('file:generated/g.mjs'));
  });

  it('reports a tree with nothing readable as unreadable, not as unsupported', (t) => {
    if (!permissionsEnforced()) return t.skip(NOT_ENFORCED);
    const root = freshRoot();
    const sources = ['lib/auth.ts', 'lib/session.ts', 'app/api/login.ts'];
    for (const s of sources) deny(path.join(root, ...s.split('/')));

    const r = run(root, ['build', '.']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(summaryLine(r.stdout).includes('files=0'), r.stdout);
    for (const s of sources) assert.ok(r.stderr.includes(s), `${s} not named in:\n${r.stderr}`);
    assert.ok(!r.stdout.includes('are not structurally indexed yet'), r.stdout);
  });
});

describe('skips are recorded beside the graph', () => {
  it('lists the skip in the manifest apart from files, and in the report', (t) => {
    if (!permissionsEnforced()) return t.skip(NOT_ENFORCED);
    const root = freshRoot();
    deny(write(root, '.mcp.json', '{"mcpServers":{}}\n'));

    const r = run(root, ['build', '.']);
    assert.equal(r.status, 0, r.stderr);

    const manifest = readManifest(root);
    assert.deepEqual(manifest.skipped, [{ path: '.mcp.json', code: 'EACCES' }]);
    assert.ok(!('.mcp.json' in manifest.files));

    const report = fs.readFileSync(path.join(root, '.claude', 'graph', 'GRAPH_REPORT.md'), 'utf8');
    const lines = report.split('\n');
    const heading = lines.findIndex((l) => /^#+\s.*Not indexed/.test(l));
    assert.ok(heading >= 0, 'no "Not indexed" heading in the report');
    const next = lines.findIndex((l, i) => i > heading && /^#+\s/.test(l));
    const section = lines.slice(heading, next === -1 ? undefined : next).join('\n');
    assert.ok(section.includes('.mcp.json'));
  });

  it('records an empty list and no report section on a clean tree', () => {
    const root = freshRoot();
    const r = run(root, ['build', '.']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readManifest(root).skipped, []);
    const report = fs.readFileSync(path.join(root, '.claude', 'graph', 'GRAPH_REPORT.md'), 'utf8');
    assert.ok(!/^#+\s.*Not indexed/m.test(report));
  });

  it('reads a manifest with no skipped key as one with no skips', () => {
    const root = freshRoot();
    assert.equal(run(root, ['build', '.']).status, 0);
    const file = path.join(root, '.claude', 'graph', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete manifest.skipped;
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));

    const r = run(root, ['update', '.']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('up to date'), r.stdout);
  });
});

describe('update stays stable across a skip and notices a change in readability', () => {
  it('does not rebuild for a file that is still unreadable, and names it', (t) => {
    if (!permissionsEnforced()) return t.skip(NOT_ENFORCED);
    const root = freshRoot();
    deny(write(root, '.mcp.json', '{"mcpServers":{}}\n'));
    assert.equal(run(root, ['build', '.']).status, 0);
    const builtAt = readGraph(root).graph.built_at;

    const r = run(root, ['update', '.']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('up to date'), r.stdout);
    assert.equal(readGraph(root).graph.built_at, builtAt);
    const lines = skipLines(r.stderr);
    assert.equal(lines.length, 1, r.stderr);
    assert.ok(lines[0].includes('.mcp.json'));
  });

  it('rebuilds when an indexed file becomes unreadable and drops its node', (t) => {
    if (!permissionsEnforced()) return t.skip(NOT_ENFORCED);
    const root = freshRoot();
    assert.equal(run(root, ['build', '.']).status, 0);
    assert.ok(fileNodeIds(readGraph(root)).includes('file:lib/auth.ts'));

    deny(path.join(root, 'lib', 'auth.ts'));
    const r = run(root, ['update', '.']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.startsWith('Updated graph'), r.stdout);
    assert.ok(!fileNodeIds(readGraph(root)).includes('file:lib/auth.ts'));
    assert.ok(r.stderr.includes('lib/auth.ts'), r.stderr);
  });

  it('rebuilds when a skipped file becomes readable and indexes it', (t) => {
    if (!permissionsEnforced()) return t.skip(NOT_ENFORCED);
    const root = freshRoot();
    const target = path.join(root, 'lib', 'auth.ts');
    deny(target);
    assert.equal(run(root, ['build', '.']).status, 0);
    assert.ok(!fileNodeIds(readGraph(root)).includes('file:lib/auth.ts'));

    allow(target);
    const r = run(root, ['update', '.']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.startsWith('Updated graph'), r.stdout);
    assert.ok(fileNodeIds(readGraph(root)).includes('file:lib/auth.ts'));
    assert.ok(!r.stderr.includes('lib/auth.ts'), r.stderr);
  });
});

describe('prose retrieval skips an unreadable document', () => {
  const GUIDE = '# Guide\n\nThe guide explains how a person signs in.\n';

  function docsTree({ unreadable }) {
    const root = freshRoot();
    write(root, 'docs/guide.md', GUIDE);
    const internal = write(root, 'docs/internal.md', '# Internal\n\nNot for the guide.\n');
    if (unreadable) deny(internal);
    return root;
  }

  it('names internal.md on docs-index and docs, and exits as it would without it', (t) => {
    if (!permissionsEnforced()) return t.skip(NOT_ENFORCED);
    const baseline = docsTree({ unreadable: false });
    const expectedIndex = run(baseline, ['docs-index', '.']).status;
    const expectedDocs = run(baseline, ['docs', 'guide']).status;

    const root = docsTree({ unreadable: true });
    const index = run(root, ['docs-index', '.']);
    assert.equal(index.status, expectedIndex, index.stderr);
    assert.ok(skipLines(index.stderr).some((l) => l.includes('docs/internal.md')), index.stderr);

    const docs = run(root, ['docs', 'guide']);
    assert.equal(docs.status, expectedDocs, docs.stderr);
    assert.ok(skipLines(docs.stderr).some((l) => l.includes('docs/internal.md')), docs.stderr);
  });

  it('names a path with a space and a non-ASCII character whole, on one line', (t) => {
    if (!permissionsEnforced()) return t.skip(NOT_ENFORCED);
    const root = freshRoot();
    write(root, 'docs/guide.md', GUIDE);
    deny(write(root, 'docs/My Notes ü.md', '# Notes\n\nPrivate.\n'));

    const r = run(root, ['docs-index', '.']);
    assert.equal(r.status, 0, r.stderr);
    const lines = skipLines(r.stderr);
    assert.equal(lines.length, 1, r.stderr);
    assert.ok(lines[0].includes('docs/My Notes ü.md'), lines[0]);
    assert.ok(!lines[0].includes('\\'));
  });
});

// A build names each path it skips. A query runs later, often in another
// session, and answers from the graph alone: "no consumers" from a graph that
// never read the file is not evidence the file is unused. So a query says, once,
// when the graph it reads was built past skipped paths.
describe('a query says when its graph was built past skipped paths', () => {
  const PARTIAL = 'GRAPH PARTIAL';
  const partialLines = (stderr) => stderr.split('\n').filter((l) => l.includes(PARTIAL));
  const QUERIES = [
    ['query', 'AuthService'],
    ['consumers', 'normalizeEmail'],
    ['path', 'lib/auth.ts', 'lib/session.ts'],
    ['explain', 'AuthService'],
    ['context', 'AuthService'],
  ];

  /** A clean graph whose manifest records `paths` as skipped by the build. */
  function builtWithSkips(skipped) {
    const root = freshRoot();
    assert.equal(run(root, ['build', '.']).status, 0);
    const file = path.join(root, '.claude', 'graph', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (skipped === undefined) delete manifest.skipped;
    else manifest.skipped = skipped;
    fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    return root;
  }

  it('prints one GRAPH PARTIAL line with the count, on stderr, for every query command', () => {
    const root = builtWithSkips([
      { path: '.mcp.json', code: 'EACCES' },
      { path: 'vault', code: 'EACCES' },
    ]);
    for (const args of QUERIES) {
      const r = run(root, args);
      const lines = partialLines(r.stderr);
      assert.equal(lines.length, 1, `${args[0]}: ${r.stderr}`);
      assert.match(lines[0], /\b2 path\(s\)/, args[0]);
      assert.ok(!r.stdout.includes(PARTIAL), `${args[0]}: the notice must stay off stdout`);
    }
  });

  it('leaves stdout and the exit code exactly as they are without the record', () => {
    const partial = builtWithSkips([{ path: '.mcp.json', code: 'EACCES' }]);
    const clean = builtWithSkips([]);
    for (const args of QUERIES) {
      const a = run(partial, args);
      const b = run(clean, args);
      assert.equal(a.status, b.status, args[0]);
      assert.equal(a.stdout, b.stdout, args[0]);
      assert.equal(b.stderr, '', `${args[0]}: a graph built with no skips prints nothing new`);
    }
  });

  it('prints nothing for a manifest from before skips were recorded, or one it cannot read', () => {
    const older = builtWithSkips(undefined);
    assert.deepEqual(partialLines(run(older, ['consumers', 'normalizeEmail']).stderr), []);

    const broken = builtWithSkips([]);
    fs.writeFileSync(path.join(broken, '.claude', 'graph', 'manifest.json'), '{ not json');
    const r = run(broken, ['consumers', 'normalizeEmail']);
    assert.equal(r.status, 0, 'a query that never needed the manifest does not start failing on it');
    assert.deepEqual(partialLines(r.stderr), []);
  });

  it('follows a real build: a masked file is named by the build and counted by the query', (t) => {
    if (!permissionsEnforced()) return t.skip(NOT_ENFORCED);
    const root = freshRoot();
    deny(write(root, '.mcp.json', '{"mcpServers":{}}\n'));
    assert.equal(run(root, ['build', '.']).status, 0);

    const r = run(root, ['consumers', 'normalizeEmail']);
    const lines = partialLines(r.stderr);
    assert.equal(lines.length, 1, r.stderr);
    assert.match(lines[0], /\b1 path\(s\)/);
  });
});

describe('readIndexed and createSkips', () => {
  it('reads a readable file once and returns its text and sha256', () => {
    const dir = tmpRoot();
    const file = path.join(dir, 'a.txt');
    const bytes = Buffer.from('hello ü world\n', 'utf8');
    fs.writeFileSync(file, bytes);

    const got = paths.readIndexed(file);
    assert.equal(got.ok, true);
    assert.equal(got.text, bytes.toString('utf8'));
    assert.equal(got.sha256, createHash('sha256').update(bytes).digest('hex'));
  });

  it('returns the error code for a path that is not a file', () => {
    const dir = tmpRoot();
    assert.deepEqual(paths.readIndexed(dir), { ok: false, code: 'EISDIR' });
  });

  it('lists an error without a code as UNKNOWN, root-relative with forward slashes', () => {
    const root = tmpRoot();
    const skips = paths.createSkips(root);
    skips.add(path.join(root, 'sub', 'file.txt'), {});
    const list = skips.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].path, 'sub/file.txt');
    assert.equal(list[0].code, 'UNKNOWN');
  });
});
