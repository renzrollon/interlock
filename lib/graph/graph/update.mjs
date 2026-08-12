import fs from 'node:fs';
import { walkSourceFiles } from '../extract/walk.mjs';
import { loadJson, manifestPath, rel, sha256File } from '../paths.mjs';
import { buildGraph, writeGraphArtifacts } from './build.mjs';

/**
 * Incremental update: rebuild fully if many files changed; otherwise rebuild all
 * (v1 keeps it simple — detect staleness, then full rebuild of affected set + dependents
 * is complex; we do full rebuild when any hash differs, which is still fast for mid-size repos).
 *
 * Returns { updated: boolean, stats, reason }.
 */
export function updateGraph(root) {
  const manifest = loadJson(manifestPath(root), null);
  if (!manifest?.files) {
    const result = buildGraph(root);
    writeGraphArtifacts(root, result);
    return { updated: true, stats: result.stats, reason: 'no-manifest' };
  }

  const currentFiles = walkSourceFiles(root).map((f) => rel(root, f));
  const prevFiles = new Set(Object.keys(manifest.files));
  const changed = [];

  for (const f of currentFiles) {
    const abs = `${root}/${f}`;
    if (!fs.existsSync(abs)) continue;
    const hash = sha256File(abs);
    if (manifest.files[f] !== hash) changed.push(f);
    prevFiles.delete(f);
  }
  const removed = [...prevFiles];

  if (changed.length === 0 && removed.length === 0) {
    return { updated: false, stats: manifest.stats, reason: 'up-to-date' };
  }

  const result = buildGraph(root);
  writeGraphArtifacts(root, result);
  return {
    updated: true,
    stats: result.stats,
    reason: `changed=${changed.length} removed=${removed.length}`,
    changed,
    removed,
  };
}
