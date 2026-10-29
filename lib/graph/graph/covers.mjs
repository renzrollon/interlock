import fs from 'node:fs';
import path from 'node:path';
import { walkSourceFiles } from '../extract/walk.mjs';
import { createSkips, loadJson, manifestPath, readIndexed, rel } from '../paths.mjs';

/**
 * Which of the given paths the graph does not hold, or holds at other content.
 *
 * Only a path the builder would index counts (the walker's own include/exclude
 * rules, so a doc or an ignored file is never "absent"), and only one still on
 * disk: a deleted file is the graph's to drop on its next update, not a gap in
 * what a review can see. `absent` is a source file the manifest does not list;
 * `changed` is one it lists under a hash other than the file's current bytes.
 *
 * Returns { graph: false } with no manifest, else { graph: true, absent,
 * changed, builtAt } with both lists sorted.
 */
export function checkCovers(root, paths) {
  const manifest = loadJson(manifestPath(root), null);
  if (!manifest?.files) return { graph: false };
  const wanted = new Set(paths.map((p) => rel(root, path.resolve(root, p))));
  const indexable = new Set();
  for (const abs of walkSourceFiles(root, { skips: createSkips(root) })) {
    const f = rel(root, abs);
    if (wanted.has(f)) indexable.add(f);
  }
  const absent = [];
  const changed = [];
  for (const f of indexable) {
    if (!fs.existsSync(path.join(root, f))) continue;
    if (!(f in manifest.files)) {
      absent.push(f);
      continue;
    }
    const got = readIndexed(path.join(root, f));
    if (got.ok && got.sha256 !== manifest.files[f]) changed.push(f);
  }
  return {
    graph: true,
    absent: absent.sort(),
    changed: changed.sort(),
    builtAt: manifest.built_at ?? null,
  };
}
