import path from 'node:path';
import { readIndexed, rel } from '../paths.mjs';
import { walkMarkdown, OPENSPEC_ARCHIVE_DIR } from './walk.mjs';
import { specPathMentions } from '../../spec-text.mjs';

const SYMBOL_RE = /`([A-Z][A-Za-z0-9_]{2,})`|\b([A-Z][A-Za-z0-9_]{2,}(?:Service|Client|Router|Handler|Store|Provider|Context|Schema|Util|Utils)?)\b/g;

/**
 * Extract OpenSpec artifact nodes and inferred links to code paths/symbols.
 */
export function extractOpenspec(root, knownSymbols = new Set(), knownFiles = new Set(), { skips } = {}) {
  const files = walkMarkdown(root, ['openspec'], { skips, exclude: [OPENSPEC_ARCHIVE_DIR] });
  const nodes = [];
  const edges = [];

  for (const absPath of files) {
    const filePath = rel(root, absPath);
    const read = readIndexed(absPath);
    if (!read.ok) {
      if (skips) skips.add(absPath, read.code);
      continue;
    }
    const text = read.text;
    const id = `openspec:${filePath}`;
    nodes.push({
      id,
      type: 'openspec',
      label: path.basename(filePath),
      source_file: filePath,
      source_location: 'L1',
    });

    const seen = new Set();
    // The rule for "a spec mentions this file" is one function shared with the
    // spec-coverage signal; the gate on files the graph indexed stays here.
    for (const { path: mentioned, index } of specPathMentions(text)) {
      const line = text.slice(0, index).split('\n').length;
      if (knownFiles.has(mentioned)) {
        edges.push({
          source: id,
          target: `file:${mentioned}`,
          relation: 'implements_spec',
          confidence: 'INFERRED',
          source_file: filePath,
          source_location: `L${line}`,
          weight: 1,
        });
      }
    }

    let m;
    SYMBOL_RE.lastIndex = 0;
    while ((m = SYMBOL_RE.exec(text))) {
      const name = m[1] || m[2];
      if (!name || name.length < 3) continue;
      if (!knownSymbols.has(name)) continue;
      const key = `sym:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const line = text.slice(0, m.index).split('\n').length;
      // Link to all symbol nodes with that label — resolved later by build if needed.
      edges.push({
        source: id,
        target: `symbol-name:${name}`,
        relation: 'implements_spec',
        confidence: 'INFERRED',
        source_file: filePath,
        source_location: `L${line}`,
        weight: 0.5,
      });
    }
  }

  return { nodes, edges };
}
