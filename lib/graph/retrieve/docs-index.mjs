import {
  docsDigestPath,
  docsIndexPath,
  ensureGraphDir,
  readIndexed,
  rel,
  writeJson,
} from '../paths.mjs';
import { walkMarkdown, resolveDocsDirs, OPENSPEC_ARCHIVE_DIR } from '../extract/walk.mjs';
import { estimateTokens } from '../format.mjs';
import { parseMarkdownSections } from './markdown.mjs';

/** Preferred markdown roots for the docs digest index (never openspec/changes/). */
export const DOCS_INDEX_DEFAULT_DIRS = ['docs', 'openspec/specs'];

const DEFAULT_BLURB_TOKENS = 40;

export { docsDigestPath, docsIndexPath, resolveDocsDirs };

/**
 * Extract a short extractive blurb (~blurbTokens) from section content.
 * Strips the heading line when present; prefers non-empty prose/bullet lines.
 */
export function extractBlurb(content, blurbTokens = DEFAULT_BLURB_TOKENS) {
  const lines = String(content || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^#{1,6}\s/.test(l) && !/^```/.test(l));
  const joined = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (!joined) return '';
  const charLimit = blurbTokens * 4;
  if (joined.length <= charLimit) return joined;
  return `${joined.slice(0, charLimit).trimEnd()}…`;
}

/**
 * Build a deterministic TOC index over markdown under dirs
 * (default: docs/ + openspec/specs/; never openspec/changes/). An archived
 * change is left out under any dir that contains it, as the graph and
 * retrieval leave it out (`OPENSPEC_ARCHIVE_DIR`); naming the archive itself
 * as a dir still indexes it.
 */
export function buildDocsIndex(root, {
  dirs: requestedDirs,
  blurbTokens = DEFAULT_BLURB_TOKENS,
  skips,
} = {}) {
  const dirs = resolveDocsDirs(root, requestedDirs);
  const files = [];
  let totalSections = 0;
  let totalTokens = 0;

  for (const absPath of walkMarkdown(root, dirs, { skips, exclude: [OPENSPEC_ARCHIVE_DIR] })) {
    const filePath = rel(root, absPath);
    const read = readIndexed(absPath);
    if (!read.ok) {
      if (skips) skips.add(absPath, read.code);
      continue;
    }
    const { text, sha256 } = read;
    const sections = parseMarkdownSections(filePath, text).map((s) => {
      const tokens_est = estimateTokens(s.content);
      return {
        heading: s.heading,
        level: s.level,
        startLine: s.startLine,
        endLine: s.endLine,
        tokens_est,
        blurb: extractBlurb(s.content, blurbTokens),
      };
    });
    const tokens_est = estimateTokens(text);
    totalSections += sections.length;
    totalTokens += tokens_est;
    files.push({
      path: filePath,
      sha256,
      tokens_est,
      sections,
    });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    generated_at: new Date().toISOString(),
    dirs: [...dirs],
    files,
    totals: {
      files: files.length,
      sections: totalSections,
      tokens_est: totalTokens,
    },
  };
}

/**
 * Build index and optionally write to .claude/graph/docs-index.json.
 * Returns { index, path, written }.
 */
export function writeDocsIndex(root, options = {}) {
  const { write = true, dirs, blurbTokens, skips } = options;
  const index = buildDocsIndex(root, { dirs, blurbTokens, skips });
  const outPath = docsIndexPath(root);
  if (write) {
    ensureGraphDir(root);
    writeJson(outPath, index);
  }
  return { index, path: outPath, written: write };
}

export function formatDocsIndexSummary(index, outPath, written) {
  const lines = [
    written ? `Wrote docs index → ${outPath}` : `Docs index (not written)`,
    `dirs=${index.dirs.join(',')} files=${index.totals.files} sections=${index.totals.sections} tokens_est=${index.totals.tokens_est}`,
  ];
  return `${lines.join('\n')}\n`;
}
