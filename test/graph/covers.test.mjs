import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'interlock-graph');

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interlock-covers-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.writeFileSync(path.join(dir, 'lib', 'a.mjs'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'lib', 'b.mjs'), "import { a } from './a.mjs';\nexport const b = a;\n");
  return dir;
}

function graph(dir, ...args) {
  return spawnSync(process.execPath, [CLI, ...args, '--root', dir], { encoding: 'utf8' });
}

function covers(dir, paths, ...rest) {
  return graph(dir, 'covers', '--changed', paths.join(','), '--json', ...rest);
}

describe('interlock-graph covers', () => {
  it('lists a file created after the build as absent, exits 1 and prints the build time', () => {
    const dir = repo();
    graph(dir, 'build');
    fs.writeFileSync(path.join(dir, 'lib', 'settle-meter.mjs'), 'export const m = 1;\n');
    const res = covers(dir, ['lib/settle-meter.mjs']);
    assert.equal(res.status, 1);
    const out = JSON.parse(res.stdout);
    assert.deepEqual(out.absent, ['lib/settle-meter.mjs']);
    assert.deepEqual(out.changed, []);
    assert.match(out.builtAt, /^\d{4}-\d{2}-\d{2}T/);
    const text = graph(dir, 'covers', '--changed', 'lib/settle-meter.mjs');
    assert.match(text.stdout, /graph built \d{4}-/);
    assert.match(text.stdout, /absent=1\n {2}lib\/settle-meter\.mjs/);
  });

  it('exits 0 with empty lists when the graph holds every file, paths on stdin included', () => {
    const dir = repo();
    graph(dir, 'build');
    const res = covers(dir, ['lib/a.mjs', 'lib/b.mjs']);
    assert.equal(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.deepEqual([out.absent, out.changed], [[], []]);
    const piped = spawnSync(process.execPath, [CLI, 'covers', '--changed', '-', '--root', dir], {
      encoding: 'utf8',
      input: 'lib/a.mjs\nlib/b.mjs\n',
    });
    assert.equal(piped.status, 0);
  });

  it('lists a file edited after the build as changed; a deleted or non-source file is neither', () => {
    const dir = repo();
    graph(dir, 'build');
    fs.writeFileSync(path.join(dir, 'lib', 'a.mjs'), 'export const a = 2;\n');
    fs.writeFileSync(path.join(dir, 'notes.md'), '# notes\n');
    const res = covers(dir, ['lib/a.mjs', 'notes.md', 'lib/gone.mjs']);
    assert.equal(res.status, 1);
    const out = JSON.parse(res.stdout);
    assert.deepEqual(out.changed, ['lib/a.mjs']);
    assert.deepEqual(out.absent, []);
  });

  it('exits 3 with no graph, and --update builds nothing', () => {
    const dir = repo();
    const res = covers(dir, ['lib/a.mjs'], '--update');
    assert.equal(res.status, 3);
    assert.match(res.stdout, /No graph/);
    assert.equal(fs.existsSync(path.join(dir, '.claude', 'graph')), false);
  });

  it('lists a held file it cannot read as unreadable and exits 1, never as covered', (t) => {
    const dir = repo();
    graph(dir, 'build');
    const target = path.join(dir, 'lib', 'a.mjs');
    fs.chmodSync(target, 0o000);
    try {
      let enforced = true;
      try {
        fs.readFileSync(target);
        enforced = false;
      } catch {
        // mode 000 stops this user, as it should
      }
      if (!enforced) return t.skip('this user can read a mode-000 file');
      const res = covers(dir, ['lib/a.mjs', 'lib/b.mjs']);
      assert.equal(res.status, 1, res.stdout + res.stderr);
      const out = JSON.parse(res.stdout);
      assert.deepEqual([out.absent, out.changed], [[], []]);
      assert.deepEqual(out.unreadable.map((u) => u.path), ['lib/a.mjs']);
      assert.equal(typeof out.unreadable[0].code, 'string');
      const text = graph(dir, 'covers', '--changed', 'lib/a.mjs');
      assert.equal(text.status, 1);
      assert.match(text.stdout, /unreadable=1\n {2}lib\/a\.mjs \(/);
    } finally {
      fs.chmodSync(target, 0o644);
    }
  });

  it('--update that throws still lists the uncovered files and says why, exit 1', () => {
    const dir = repo();
    graph(dir, 'build');
    fs.writeFileSync(path.join(dir, 'lib', 'settle-meter.mjs'), 'export const m = 1;\n');
    // A directory where the graph file goes: the update's write throws EISDIR for any user.
    const graphFile = path.join(dir, '.claude', 'graph', 'graph.json');
    fs.rmSync(graphFile);
    fs.mkdirSync(graphFile);
    const res = covers(dir, ['lib/settle-meter.mjs'], '--update');
    assert.equal(res.status, 1);
    const out = JSON.parse(res.stdout);
    assert.deepEqual(out.absent, ['lib/settle-meter.mjs'], 'the first check\'s list stands');
    assert.match(out.error, /covers --update failed: /);
    assert.match(res.stderr, /covers --update failed: /);
    const text = graph(dir, 'covers', '--changed', 'lib/settle-meter.mjs', '--update');
    assert.equal(text.status, 1);
    assert.match(text.stdout, /absent=1\n {2}lib\/settle-meter\.mjs/);
    assert.match(text.stdout, /covers --update failed: /);
  });

  it('a coverage check that throws lists every asked path under unchecked with the reason, exit 1', () => {
    const dir = repo();
    graph(dir, 'build');
    // A manifest that is not JSON makes the check itself throw.
    fs.writeFileSync(path.join(dir, '.claude', 'graph', 'manifest.json'), '{ not json');
    const res = covers(dir, ['lib/b.mjs', 'lib/a.mjs']);
    assert.equal(res.status, 1);
    const out = JSON.parse(res.stdout);
    assert.deepEqual(out.unchecked, ['lib/a.mjs', 'lib/b.mjs']);
    assert.match(out.error, /the coverage check failed: /);
    const text = graph(dir, 'covers', '--changed', 'lib/a.mjs');
    assert.match(text.stdout, /unchecked=1\n {2}lib\/a\.mjs/);
  });

  it('--update brings a stale graph current and exits 0', () => {
    const dir = repo();
    graph(dir, 'build');
    fs.writeFileSync(path.join(dir, 'lib', 'settle-meter.mjs'), 'export const m = 1;\n');
    fs.writeFileSync(path.join(dir, 'lib', 'a.mjs'), 'export const a = 3;\n');
    const res = covers(dir, ['lib/settle-meter.mjs', 'lib/a.mjs'], '--update');
    assert.equal(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.deepEqual([out.absent, out.changed], [[], []]);
  });
});
