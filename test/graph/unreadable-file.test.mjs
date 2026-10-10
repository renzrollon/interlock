import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { tryReadFile } from '../../lib/graph/paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '..', '..', 'lib', 'graph', 'cli.mjs');

// chmod 000 does not make a file unreadable on Windows, nor to root.
const canMakeUnreadable =
  process.platform !== 'win32' && !(typeof process.getuid === 'function' && process.getuid() === 0);

describe('tryReadFile', () => {
  it('returns the bytes of a readable file', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'interlock-read-'));
    fs.writeFileSync(path.join(tmp, 'a.ts'), 'export const a = 1;\n');
    const read = tryReadFile(path.join(tmp, 'a.ts'));
    assert.equal(read.ok, true);
    assert.equal(read.buf.toString('utf8'), 'export const a = 1;\n');
  });

  it('reports the error code instead of throwing', () => {
    const read = tryReadFile(path.join(os.tmpdir(), 'interlock-no-such-file-xyz.ts'));
    assert.deepEqual(read, { ok: false, code: 'ENOENT' });
  });
});

describe('interlock-graph build over an unreadable file', () => {
  it('skips the file, names it, and finishes the build', { skip: !canMakeUnreadable }, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'interlock-unreadable-'));
    fs.writeFileSync(path.join(tmp, 'ok.ts'), "import { b } from './masked';\nexport const a = b;\n");
    const masked = path.join(tmp, 'masked.ts');
    fs.writeFileSync(masked, 'export const b = 1;\n');
    fs.chmodSync(masked, 0o000);
    try {
      const out = spawnSync(process.execPath, [CLI, 'build', tmp], { encoding: 'utf8' });
      assert.equal(out.status, 0, out.stderr);
      assert.match(out.stdout, /SKIPPED unreadable file: masked\.ts \(EACCES\)/);
      assert.match(out.stdout, /files=1 /);
      const graph = JSON.parse(fs.readFileSync(path.join(tmp, '.claude', 'graph', 'graph.json'), 'utf8'));
      assert.ok(!graph.nodes.some((n) => n.id === 'file:masked.ts'));
    } finally {
      fs.chmodSync(masked, 0o644);
    }
  });
});
