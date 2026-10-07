/**
 * Regex-based shell script extractor (source/. includes, .sh calls, functions).
 */

const SOURCE_RE =
  /(?:^|[\n;&|])\s*(?:source|\.)[ \t]+(?:["']([^"']+)["']|(\S+))/gm;
const SH_PATH_RE = /(?:^|[\n;&|\s`"'])((?:\$[\w{]+\/)?(?:\.\/)?[\w./-]+\.sh)\b/gm;
const FN_RE = /^(?:function[ \t]+)?([A-Za-z_][\w]*)[ \t]*\(\)[ \t]*\{/gm;

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function normalizeShellPath(raw) {
  let p = String(raw || '').trim();
  if (!p) return null;
  // Drop variable prefixes like $SCRIPT_DIR/ or ${APP_DIR}/ — keep trailing path
  p = p.replace(/^\$\{?[\w]+\}?\//, '');
  p = p.replace(/^\.\//, '');
  if (p.includes('$') || p.includes('`')) return null;
  return p;
}

/**
 * @param {string} filePath relative posix path
 * @param {string} source
 */
export function extractShell(filePath, source) {
  const imports = [];
  const exports = [];
  const references = [];
  const seen = new Set();

  let m;
  SOURCE_RE.lastIndex = 0;
  while ((m = SOURCE_RE.exec(source))) {
    const raw = m[1] || m[2];
    const from = normalizeShellPath(raw);
    if (!from) continue;
    const line = lineOf(source, m.index);
    const key = `src:${from}@${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    imports.push({ from, imported: null, local: null, line, confidence: 'EXTRACTED' });
  }

  SH_PATH_RE.lastIndex = 0;
  while ((m = SH_PATH_RE.exec(source))) {
    const from = normalizeShellPath(m[1]);
    if (!from || from === filePath) continue;
    // Skip self basename echoes in comments loosely handled by seen
    const line = lineOf(source, m.index);
    const key = `sh:${from}@${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Don't double-count pure source lines already captured
    imports.push({ from, imported: null, local: null, line, confidence: 'INFERRED' });
  }

  FN_RE.lastIndex = 0;
  while ((m = FN_RE.exec(source))) {
    exports.push({
      name: m[1],
      kind: 'function',
      line: lineOf(source, m.index),
      confidence: 'EXTRACTED',
    });
  }

  return { filePath, imports, exports, references };
}
