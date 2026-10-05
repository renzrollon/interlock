// interlock-graph in a linked worktree (ship/state-home): a query reads the main
// checkout's graph when the worktree has none, and says so on stderr; `build`
// still writes under the root it was given. The binary is spawned the way a
// lane spawns it, against a real `git worktree add` fixture.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const CLI = path.join(REPO, 'bin', 'interlock-graph');
const FIXTURE = path.join(__dirname, 'fixtures', 'mini-app');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

describe('interlock-graph reads through to the state home', () => {
  let tmp;
  let main;
  let worktree;
  let env;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'interlock-graph-home-')));
    main = path.join(tmp, 'main');
    copyDir(FIXTURE, main);
    // Isolated from the developer's git configuration, and unable to climb out
    // of the temp directory into whatever checkout happens to hold it.
    env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CEILING_DIRECTORIES: tmp,
      INTERLOCK_STATE_HOME: ''
    };
    const git = (args, cwd) => execFileSync('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init', '-q'], main);
    git(['config', 'user.email', 'test@example.com'], main);
    git(['config', 'user.name', 'Test'], main);
    git(['add', '-A'], main);
    git(['commit', '-q', '-m', 'fixture'], main);
    worktree = path.join(main, '.claude', 'worktrees', 'w1');
    git(['worktree', 'add', '-q', worktree, '-b', 'w1'], main);
    const built = spawnSync(process.execPath, [CLI, 'build', main], { env, encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
  });

  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('answers a query from the main checkout graph and names it on stderr', () => {
    assert.equal(fs.existsSync(path.join(worktree, '.claude', 'graph', 'graph.json')), false);
    const out = spawnSync(process.execPath, [CLI, 'query', 'normalizeEmail', '--root', worktree], {
      env,
      encoding: 'utf8'
    });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /normalizeEmail/);
    assert.match(out.stderr, new RegExp(`^GRAPH FROM MAIN CHECKOUT: ${path.join(main, '.claude', 'graph', 'graph.json').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    // Read through, never copied: the worktree still has no graph of its own.
    assert.equal(fs.existsSync(path.join(worktree, '.claude', 'graph')), false);
  });

  it('prefers the worktree graph once it has one, and build writes under the root it was given', () => {
    const built = spawnSync(process.execPath, [CLI, 'build', worktree], { env, encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    assert.equal(fs.existsSync(path.join(worktree, '.claude', 'graph', 'graph.json')), true);
    const out = spawnSync(process.execPath, [CLI, 'consumers', 'normalizeEmail', '--root', worktree], {
      env,
      encoding: 'utf8'
    });
    assert.equal(out.status, 0, out.stderr);
    assert.doesNotMatch(out.stderr, /GRAPH FROM MAIN CHECKOUT/);
  });
});
