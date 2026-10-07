import fs from 'node:fs';
import path from 'node:path';
import { rel } from '../paths.mjs';
import { walkMarkdown } from './walk.mjs';

const COUPLE_RE =
  /([`'"]?)([\w./-]+\.(?:ts|tsx|js|jsx|mjs))\1[^.\n]{0,80}(?:always changes with|couples with|paired with|together with)[^.\n]{0,80}([`'"]?)([\w./-]+\.(?:ts|tsx|js|jsx|mjs))\3/gi;

const FILE_PAIR_RE =
  /`([\w./-]+\.(?:ts|tsx|js|jsx|mjs))`[^`\n]{0,60}`([\w./-]+\.(?:ts|tsx|js|jsx|mjs))`/g;

/**
 * Extract memory nodes and coupling edges.
 */
export function extractMemory(root, knownFiles = new Set()) {
  const candidates = [];
  const memRoot = path.join(root, '.claude', 'memory');
  if (fs.existsSync(memRoot)) {
    candidates.push(...walkMarkdown(root, ['.claude/memory']));
  }
  const legacy = path.join(root, '.claude', 'memory.md');
  if (fs.existsSync(legacy)) candidates.push(legacy);

  const nodes = [];
  const edges = [];
  const seenNodes = new Set();

  for (const absPath of candidates) {
    const filePath = rel(root, absPath);
    const text = fs.readFileSync(absPath, 'utf8');
    const id = `memory:${filePath}`;
    if (!seenNodes.has(id)) {
      seenNodes.add(id);
      nodes.push({
        id,
        type: 'memory',
        label: path.basename(filePath),
        source_file: filePath,
        source_location: 'L1',
      });
    }

    let m;
    COUPLE_RE.lastIndex = 0;
    while ((m = COUPLE_RE.exec(text))) {
      const a = normalizeMention(m[2], knownFiles);
      const b = normalizeMention(m[4], knownFiles);
      if (!a || !b) continue;
      const line = text.slice(0, m.index).split('\n').length;
      edges.push({
        source: `file:${a}`,
        target: `file:${b}`,
        relation: 'couples_with',
        confidence: 'INFERRED',
        source_file: filePath,
        source_location: `L${line}`,
        weight: 1,
      });
      edges.push({
        source: id,
        target: `file:${a}`,
        relation: 'couples_with',
        confidence: 'INFERRED',
        source_file: filePath,
        source_location: `L${line}`,
        weight: 0.5,
      });
    }

    FILE_PAIR_RE.lastIndex = 0;
    while ((m = FILE_PAIR_RE.exec(text))) {
      const a = normalizeMention(m[1], knownFiles);
      const b = normalizeMention(m[2], knownFiles);
      if (!a || !b || a === b) continue;
      const line = text.slice(0, m.index).split('\n').length;
      edges.push({
        source: `file:${a}`,
        target: `file:${b}`,
        relation: 'couples_with',
        confidence: 'INFERRED',
        source_file: filePath,
        source_location: `L${line}`,
        weight: 0.5,
      });
    }
  }

  return { nodes, edges };
}

function normalizeMention(p, knownFiles) {
  const clean = p.replace(/^\.\//, '');
  if (knownFiles.has(clean)) return clean;
  // Allow basename match
  for (const f of knownFiles) {
    if (f.endsWith(`/${clean}`) || f === clean) return f;
  }
  return null;
}
