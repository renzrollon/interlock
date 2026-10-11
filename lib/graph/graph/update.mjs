import { extractMemory } from '../extract/memory.mjs';
import { extractOpenspec } from '../extract/openspec.mjs';
import { walkSourceFiles } from '../extract/walk.mjs';
import { createSkips, loadJson, manifestPath, readIndexed, rel } from '../paths.mjs';
import { buildGraph, writeGraphArtifacts } from './build.mjs';

/**
 * Incremental update: rebuild fully if many files changed; otherwise rebuild all
 * (v1 keeps it simple — detect staleness, then full rebuild of affected set + dependents
 * is complex; we do full rebuild when any hash differs, which is still fast for mid-size repos).
 *
 * Readability is compared as well as content. A path that was skipped by the
 * recorded build and is still unreadable is not a change: it can never be
 * hashed, so without the manifest's record it would look changed on every run.
 * A path that was indexed and can no longer be read, and one that was skipped
 * and can now be read, each rebuild.
 *
 * `skips` is the command's collector (`createSkips`). It holds the currently
 * unreadable paths when this returns, whether or not the graph was rebuilt.
 *
 * Returns { updated: boolean, stats, reason, skipped }.
 */
export function updateGraph(root, { skips = createSkips(root) } = {}) {
  const manifest = loadJson(manifestPath(root), null);
  if (!manifest?.files) {
    const result = buildGraph(root, { skips });
    writeGraphArtifacts(root, result);
    return { updated: true, stats: result.stats, reason: 'no-manifest', skipped: result.skipped };
  }

  const prevFiles = new Set(Object.keys(manifest.files));
  const changed = [];

  for (const abs of walkSourceFiles(root, { skips })) {
    const f = rel(root, abs);
    const got = readIndexed(abs);
    if (!got.ok) {
      // Unreadable now, not removed. Whether that is news is decided below,
      // against the recorded skips.
      skips.add(abs, got.code);
      prevFiles.delete(f);
      continue;
    }
    if (manifest.files[f] !== got.sha256) changed.push(f);
    prevFiles.delete(f);
  }
  const removed = [...prevFiles];

  // The overlays read prose the hashes above do not cover, and a build records
  // what they could not read. Run the same readers so the two sets are compared
  // like for like; what they extract is not used here.
  extractOpenspec(root, new Set(), new Set(), { skips });
  extractMemory(root, new Set(), { skips });

  // A manifest written before skips were recorded reads as one with none.
  const recorded = new Set(
    (Array.isArray(manifest.skipped) ? manifest.skipped : []).map((entry) => entry?.path).filter(Boolean),
  );
  const current = skips.list();
  const unreadableNow = current.filter((entry) => !recorded.has(entry.path)).map((entry) => entry.path);
  const currentPaths = new Set(current.map((entry) => entry.path));
  const readableNow = [...recorded].filter((p) => !currentPaths.has(p));

  if (
    changed.length === 0 &&
    removed.length === 0 &&
    unreadableNow.length === 0 &&
    readableNow.length === 0
  ) {
    return { updated: false, stats: manifest.stats, reason: 'up-to-date', skipped: current };
  }

  const result = buildGraph(root, { skips });
  writeGraphArtifacts(root, result);
  const readability =
    unreadableNow.length || readableNow.length
      ? ` unreadable=${unreadableNow.length} readable=${readableNow.length}`
      : '';
  return {
    updated: true,
    stats: result.stats,
    reason: `changed=${changed.length} removed=${removed.length}${readability}`,
    changed,
    removed,
    skipped: result.skipped,
  };
}
