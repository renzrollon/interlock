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
 * `changed` is one it lists under a hash other than the file's current bytes;
 * `unreadable` is one it lists whose current bytes cannot be read, with the
 * read's error code. That last is a gap, never a match: a file nobody can read
 * cannot be shown to sit in the graph at its current content.
 *
 * Returns { graph: false } with no manifest, else { graph: true, absent,
 * changed, unreadable, builtAt } with every list sorted by path.
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
  const unreadable = [];
  for (const f of indexable) {
    if (!fs.existsSync(path.join(root, f))) continue;
    if (!(f in manifest.files)) {
      absent.push(f);
      continue;
    }
    const got = readIndexed(path.join(root, f));
    if (!got.ok) unreadable.push({ path: f, code: got.code });
    else if (got.sha256 !== manifest.files[f]) changed.push(f);
  }
  return {
    graph: true,
    absent: absent.sort(),
    changed: changed.sort(),
    unreadable: unreadable.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    builtAt: manifest.built_at ?? null,
  };
}
