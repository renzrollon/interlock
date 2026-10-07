import fs from 'node:fs';
import path from 'node:path';
import { rel } from '../paths.mjs';
import { walkMarkdown } from './walk.mjs';

// Any repo-relative path with an extension. Deliberately NOT restricted to a
// directory allowlist or an extension allowlist: every match is gated below by
// `knownFiles.has(mentioned)`, so the graph itself decides what is real. An
// allowlist here can only produce false negatives — it used to drop Go/Rust/Java
// layouts (cmd/, internal/, pkg/, apps/, services/) and indexed config files
// entirely. The leading boundary class excludes URL path segments, which are
// always preceded by `/`.
const PATH_RE = /(?:^|[\s`"'(\[])((?:[\w.@-]+\/)+[\w.@-]+\.[A-Za-z0-9]{1,6})\b/gm;
const SYMBOL_RE = /`([A-Z][A-Za-z0-9_]{2,})`|\b([A-Z][A-Za-z0-9_]{2,}(?:Service|Client|Router|Handler|Store|Provider|Context|Schema|Util|Utils)?)\b/g;

/**
 * Extract OpenSpec artifact nodes and inferred links to code paths/symbols.
 */
export function extractOpenspec(root, knownSymbols = new Set(), knownFiles = new Set()) {
  const files = walkMarkdown(root, ['openspec']);
  const nodes = [];
  const edges = [];

  for (const absPath of files) {
    const filePath = rel(root, absPath);
    const text = fs.readFileSync(absPath, 'utf8');
    const id = `openspec:${filePath}`;
    nodes.push({
      id,
      type: 'openspec',
      label: path.basename(filePath),
      source_file: filePath,
      source_location: 'L1',
    });

    const seen = new Set();
    let m;
    PATH_RE.lastIndex = 0;
    while ((m = PATH_RE.exec(text))) {
      const mentioned = m[1];
      if (seen.has(mentioned)) continue;
      seen.add(mentioned);
      const line = text.slice(0, m.index).split('\n').length;
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
