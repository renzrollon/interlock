import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, before } from 'node:test';
import {
  deriveTerms,
  parseMarkdownSections,
  retrieveMarkdownSections,
  scoreSection,
  tokenizeTerms,
} from '../../lib/graph/retrieve/markdown.mjs';
import { retrieveContext } from '../../lib/graph/retrieve/context.mjs';
import {
  buildDocsIndex,
  extractBlurb,
  writeDocsIndex,
} from '../../lib/graph/retrieve/docs-index.mjs';
import { buildGraph, writeGraphArtifacts } from '../../lib/graph/graph/build.mjs';
import { docsIndexPath } from '../../lib/graph/paths.mjs';
import { estimateTokens } from '../../lib/graph/format.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'mini-app');

describe('markdown retrieval', () => {
  it('parses heading sections with line ranges', () => {
    const text = fs.readFileSync(path.join(FIXTURE, 'docs', 'architecture.md'), 'utf8');
    const sections = parseMarkdownSections('docs/architecture.md', text);
    assert.ok(sections.some((s) => s.heading === 'Authentication'));
    const auth = sections.find((s) => s.heading === 'Authentication');
    assert.ok(auth.startLine >= 1);
    assert.match(auth.content, /normalizeEmail/);
  });

  it('scores auth sections higher than unrelated sections', () => {
    const text = fs.readFileSync(path.join(FIXTURE, 'docs', 'architecture.md'), 'utf8');
    const sections = parseMarkdownSections('docs/architecture.md', text);
    const terms = tokenizeTerms('auth session normalizeEmail');
    const auth = sections.find((s) => s.heading === 'Authentication');
    const deploy = sections.find((s) => s.heading === 'Deployment');
    assert.ok(scoreSection(auth, terms, ['lib/auth.ts']) > scoreSection(deploy, terms, ['lib/auth.ts']));
  });

  it('derives terms from changed files and commit subject', () => {
    const terms = deriveTerms({
      query: '',
      changedFiles: ['lib/auth.ts', 'app/api/login.ts'],
      commitSubject: 'fix login session',
    });
    assert.ok(terms.includes('auth'));
    assert.ok(terms.includes('login'));
    assert.ok(terms.includes('session'));
  });

  it('retrieves ranked sections within budget', () => {
    const result = retrieveMarkdownSections(FIXTURE, {
      query: 'authentication AuthService',
      changedFiles: ['lib/auth.ts'],
      dirs: ['docs'],
      budget: 400,
    });
    assert.equal(result.empty, false);
    assert.ok(result.sectionCount >= 1);
    assert.match(result.text, /Authentication/);
    assert.doesNotMatch(result.text, /Deployment/);
    assert.ok(estimateTokens(result.text) <= 450);
  });

  it('returns empty signal when nothing matches', () => {
    const result = retrieveMarkdownSections(FIXTURE, {
      query: 'xyzzy-nonexistent-term',
      dirs: ['docs'],
      budget: 200,
    });
    assert.equal(result.empty, true);
    assert.match(result.text, /No matching documentation sections/);
  });

  it('orders ties deterministically by file then line', () => {
    const a = retrieveMarkdownSections(FIXTURE, {
      query: 'auth',
      dirs: ['docs', 'openspec'],
      budget: 2000,
    });
    const b = retrieveMarkdownSections(FIXTURE, {
      query: 'auth',
      dirs: ['docs', 'openspec'],
      budget: 2000,
    });
    assert.equal(a.text, b.text);
  });
});

describe('docs-index', () => {
  it('extracts short blurbs without headings', () => {
    const blurb = extractBlurb('# Authentication\n\nSession handling lives in lib/session.ts.\n', 20);
    assert.doesNotMatch(blurb, /^#/);
    assert.match(blurb, /Session handling/);
    assert.ok(blurb.length <= 20 * 4 + 1);
  });

  it('builds a deterministic TOC for docs/ + openspec/specs/ by default', () => {
    const a = buildDocsIndex(FIXTURE);
    const b = buildDocsIndex(FIXTURE);
    assert.deepEqual(a.dirs, ['docs', 'openspec/specs']);
    assert.equal(a.totals.files, 2);
    assert.ok(a.totals.sections >= 2);
    assert.equal(a.files[0].path, 'docs/architecture.md');
    assert.equal(a.files[1].path, 'openspec/specs/auth/spec.md');
    assert.ok(a.files[0].sha256.length === 64);
    const auth = a.files[0].sections.find((s) => s.heading === 'Authentication');
    assert.ok(auth);
    assert.ok(auth.startLine >= 1);
    assert.ok(auth.blurb.includes('session') || auth.blurb.includes('Session'));
    // generated_at differs; compare stable payload
    assert.deepEqual(
      { dirs: a.dirs, files: a.files, totals: a.totals },
      { dirs: b.dirs, files: b.files, totals: b.totals },
    );
  });

  it('does not index openspec/changes/ even when present', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'interlock-graph-docs-index-changes-'));
    copyDir(FIXTURE, tmp);
    const changeDir = path.join(tmp, 'openspec', 'changes', 'add-auth');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# Proposal\n\nShould not be indexed.\n');
    const index = buildDocsIndex(tmp);
    assert.ok(index.files.every((f) => !f.path.startsWith('openspec/changes/')));
    assert.ok(index.files.some((f) => f.path === 'openspec/specs/auth/spec.md'));
  });

  it('writes docs-index.json under .claude/graph/', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'interlock-graph-docs-index-'));
    copyDir(FIXTURE, tmp);
    const { index, path: outPath, written } = writeDocsIndex(tmp, { write: true });
    assert.equal(written, true);
    assert.equal(outPath, docsIndexPath(tmp));
    assert.ok(fs.existsSync(outPath));
    const loaded = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.equal(loaded.totals.files, index.totals.files);
    assert.deepEqual(loaded.dirs, ['docs', 'openspec/specs']);
    assert.ok(loaded.files.some((f) => f.path === 'docs/architecture.md'));
    assert.ok(loaded.files.some((f) => f.path === 'openspec/specs/auth/spec.md'));
  });
});

describe('context retrieval', () => {
  let tmp;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'interlock-graph-ctx-'));
    copyDir(FIXTURE, tmp);
    const result = buildGraph(tmp);
    writeGraphArtifacts(tmp, result);
  });

  it('combines graph and documentation excerpts', () => {
    const result = retrieveContext(tmp, {
      query: 'AuthService auth',
      changedFiles: ['lib/auth.ts'],
      budget: 1500,
    });
    assert.equal(result.empty, false);
    assert.match(result.text, /Structural \(graph\)/);
    assert.match(result.text, /Documentation excerpts/);
    assert.ok(result.graphPresent);
    assert.ok(result.docsSectionCount >= 1);
    assert.ok(estimateTokens(result.text) <= 1600);
  });

  it('falls back to docs-only when graph is missing', () => {
    const noGraph = fs.mkdtempSync(path.join(os.tmpdir(), 'interlock-graph-nograph-'));
    copyDir(FIXTURE, noGraph);
    fs.rmSync(path.join(noGraph, '.claude', 'graph'), { recursive: true, force: true });

    const result = retrieveContext(noGraph, {
      query: 'authentication',
      changedFiles: ['lib/session.ts'],
      budget: 800,
    });
    assert.match(result.text, /no graph at/);
    assert.match(result.text, /Authentication/);
    assert.equal(result.graphPresent, false);
    assert.equal(result.docsEmpty, false);
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
