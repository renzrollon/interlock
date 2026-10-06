/**
 * Regex-based Python extractor (imports + top-level defs/classes).
 * No AST dependency — good enough for package/module navigation.
 */

const FROM_IMPORT_RE =
  /^([ \t]*)from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|.+)$/gm;
const IMPORT_RE =
  /^([ \t]*)import[ \t]+([\w.]+)(?:[ \t]+as[ \t]+(\w+))?(?:[ \t]*#.*)?$/gm;
const CLASS_RE = /^class[ \t]+([A-Za-z_]\w*)\s*[:(]/gm;
const DEF_RE = /^(?:async[ \t]+)?def[ \t]+([A-Za-z_]\w*)\s*\(/gm;

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function parseImportedNames(raw) {
  const flat = raw.replace(/[()]/g, ' ').replace(/\\\s*\n/g, ' ').replace(/#.*/g, '');
  const names = [];
  for (const part of flat.split(',')) {
    const t = part.trim();
    if (!t) continue;
    if (t === '*') {
      names.push({ imported: '*', local: null });
      continue;
    }
    const m = t.match(/^(\w+)(?:\s+as\s+(\w+))?$/);
    if (!m) continue;
    names.push({ imported: m[1], local: m[2] || m[1] });
  }
  return names;
}

/**
 * Flatten parenthesized `from x import (` blocks so line-based regex can see them.
 */
function preprocessSource(source) {
  return source.replace(
    /^([ \t]*from[ \t]+\.*[\w.]*[ \t]+import[ \t]+)\(([\s\S]*?)\)/gm,
    (full, head, body) => `${head}${body.replace(/\n/g, ' ')}`,
  );
}

/**
 * @param {string} filePath relative posix path
 * @param {string} source
 */
export function extractPython(filePath, source) {
  const imports = [];
  const exports = [];
  const references = [];
  const importedLocals = new Map();
  const text = preprocessSource(source);

  let m;
  FROM_IMPORT_RE.lastIndex = 0;
  while ((m = FROM_IMPORT_RE.exec(text))) {
    // Only module-level imports (no indent)
    if (m[1] && m[1].length > 0) continue;
    const from = m[2];
    const line = lineOf(text, m.index);
    const names = parseImportedNames(m[3]);
    if (names.length === 0) {
      imports.push({ from, imported: null, local: null, line, confidence: 'EXTRACTED' });
      continue;
    }
    for (const spec of names) {
      imports.push({
        from,
        imported: spec.imported,
        local: spec.local,
        line,
        confidence: 'EXTRACTED',
      });
      if (spec.local) importedLocals.set(spec.local, { from, line });
    }
  }

  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(text))) {
    if (m[1] && m[1].length > 0) continue;
    const from = m[2];
    const local = m[3] || from.split('.')[0];
    const line = lineOf(text, m.index);
    imports.push({
      from,
      imported: m[3] ? from : '*',
      local,
      line,
      confidence: 'EXTRACTED',
    });
    importedLocals.set(local, { from, line });
  }

  CLASS_RE.lastIndex = 0;
  while ((m = CLASS_RE.exec(source))) {
    exports.push({
      name: m[1],
      kind: 'class',
      line: lineOf(source, m.index),
      confidence: 'EXTRACTED',
    });
  }

  DEF_RE.lastIndex = 0;
  while ((m = DEF_RE.exec(source))) {
    const name = m[1];
    if (name.startsWith('_') && !name.startsWith('__')) continue; // skip private helpers
    exports.push({
      name,
      kind: 'function',
      line: lineOf(source, m.index),
      confidence: 'EXTRACTED',
    });
  }

  for (const [local, meta] of importedLocals) {
    if (!local || local.length < 2) continue;
    const useRe = new RegExp(`\\b${local}\\b`, 'g');
    let um;
    let count = 0;
    while ((um = useRe.exec(source))) {
      const line = lineOf(source, um.index);
      if (line === meta.line) continue;
      references.push({
        name: local,
        from: meta.from,
        line,
        confidence: 'EXTRACTED',
      });
      count += 1;
      if (count >= 8) break;
    }
  }

  return { filePath, imports, exports, references };
}
