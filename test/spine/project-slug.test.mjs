import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectSlug } from '../../lib/project-slug.mjs';

test('projectSlug replaces path separators with hyphens', () => {
  assert.equal(projectSlug('/Users/x/IdeaProjects/specflow'), '-Users-x-IdeaProjects-specflow');
});

test('projectSlug replaces space, dot and underscore with hyphens', () => {
  assert.equal(
    projectSlug('/Users/x/Application Support/repo/.claude/worktrees/w_1'),
    '-Users-x-Application-Support-repo--claude-worktrees-w-1'
  );
});

test('projectSlug throws on a non-string input', () => {
  assert.throws(() => projectSlug(42), TypeError);
  assert.throws(() => projectSlug(undefined), TypeError);
  assert.throws(() => projectSlug(null), TypeError);
});
