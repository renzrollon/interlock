/**
 * Regex-based JS/TS extractor. Used when typescript package is unavailable.
 * Extracts imports, exports, and best-effort same-file references.
 */

const IMPORT_RE =
  /(?:import\s+(?:type\s+)?(?:([\w*{}\s,]+)\s+from\s+)?|export\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?|require\s*\(\s*)['"]([^'"]+)['"]/g;

const NAMED_IMPORT_RE = /(?:import|export)\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
const DEFAULT_IMPORT_RE =
  /import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s+['"]([^'"]+)['"]/g;
const NS_IMPORT_RE = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/g;
const REQUIRE_RE = /(?:const|let|var)\s+(?:\{([^}]+)\}|([A-Za-z_$][\w$]*))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const EXPORT_NAMED_RE =
  /export\s+(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST_RE = /export\s+(?:type\s+)?\{([^}]+)\}/g;
const EXPORT_DEFAULT_RE = /export\s+default\s+(?:async\s+)?(?:function|class)?\s*([A-Za-z_$][\w$]*)?/g;

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function parseSpecifiers(raw) {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const parts = s.split(/\s+as\s+/i);
      const local = (parts[1] || parts[0]).trim();
      const imported = parts[0].replace(/^type\s+/, '').trim();
      return { imported, local };
    })
    .filter((s) => s.local && s.local !== 'type');
}

/**
 * @param {string} filePath relative posix path
 * @param {string} source
 */
export function extractWithRegex(filePath, source) {
  const imports = [];
  const exports = [];
  const references = [];
  const importedLocals = new Map(); // localName -> { from, line }

  let m;
  NAMED_IMPORT_RE.lastIndex = 0;
  while ((m = NAMED_IMPORT_RE.exec(source))) {
    const line = lineOf(source, m.index);
    const from = m[2];
    for (const spec of parseSpecifiers(m[1])) {
      imports.push({
        from,
        imported: spec.imported,
        local: spec.local,
        line,
        confidence: 'EXTRACTED',
      });
      importedLocals.set(spec.local, { from, line });
    }
  }

  DEFAULT_IMPORT_RE.lastIndex = 0;
  while ((m = DEFAULT_IMPORT_RE.exec(source))) {
    const line = lineOf(source, m.index);
    const local = m[1];
    const from = m[2];
    imports.push({ from, imported: 'default', local, line, confidence: 'EXTRACTED' });
    importedLocals.set(local, { from, line });
  }

  NS_IMPORT_RE.lastIndex = 0;
  while ((m = NS_IMPORT_RE.exec(source))) {
    const line = lineOf(source, m.index);
    imports.push({
      from: m[2],
      imported: '*',
      local: m[1],
      line,
      confidence: 'EXTRACTED',
    });
    importedLocals.set(m[1], { from: m[2], line });
  }

  REQUIRE_RE.lastIndex = 0;
  while ((m = REQUIRE_RE.exec(source))) {
    const line = lineOf(source, m.index);
    const from = m[3];
    if (m[1]) {
      for (const spec of parseSpecifiers(m[1])) {
        imports.push({
          from,
          imported: spec.imported,
          local: spec.local,
          line,
          confidence: 'EXTRACTED',
        });
        importedLocals.set(spec.local, { from, line });
      }
    } else if (m[2]) {
      imports.push({
        from,
        imported: 'default',
        local: m[2],
        line,
        confidence: 'EXTRACTED',
      });
      importedLocals.set(m[2], { from, line });
    }
  }

  // Bare side-effect imports / export-from without binding already covered partially;
  // catch remaining import 'x' and export ... from 'x'
  IMPORT_RE.lastIndex = 0;
  const seenFrom = new Set(imports.map((i) => `${i.from}@${i.line}`));
  while ((m = IMPORT_RE.exec(source))) {
    const from = m[2];
    const line = lineOf(source, m.index);
    const key = `${from}@${line}`;
    if (seenFrom.has(key)) continue;
    // Only add if this looks like a side-effect import (no binding captured in m[1] meaningfully)
    if (!m[1] || !m[1].trim()) {
      imports.push({ from, imported: null, local: null, line, confidence: 'EXTRACTED' });
      seenFrom.add(key);
    }
  }

  EXPORT_NAMED_RE.lastIndex = 0;
  while ((m = EXPORT_NAMED_RE.exec(source))) {
    exports.push({
      name: m[1],
      kind: 'named',
      line: lineOf(source, m.index),
      confidence: 'EXTRACTED',
    });
  }

  EXPORT_LIST_RE.lastIndex = 0;
  while ((m = EXPORT_LIST_RE.exec(source))) {
    // skip re-exports that have `from` — handled as imports + export list
    const after = source.slice(m.index, m.index + m[0].length + 40);
    if (/\bfrom\b/.test(after.slice(m[0].length))) {
      // still record exported names
    }
    for (const spec of parseSpecifiers(m[1])) {
      exports.push({
        name: spec.local,
        kind: 'named',
        line: lineOf(source, m.index),
        confidence: 'EXTRACTED',
      });
    }
  }

  EXPORT_DEFAULT_RE.lastIndex = 0;
  while ((m = EXPORT_DEFAULT_RE.exec(source))) {
    exports.push({
      name: m[1] || 'default',
      kind: 'default',
      line: lineOf(source, m.index),
      confidence: 'EXTRACTED',
    });
  }

  // Cross-file references only for imported locals (identifier use after import)
  for (const [local, meta] of importedLocals) {
    const useRe = new RegExp(`\\b${local}\\b`, 'g');
    let um;
    let count = 0;
    while ((um = useRe.exec(source))) {
      const line = lineOf(source, um.index);
      if (line === meta.line) continue; // the import site itself
      references.push({
        name: local,
        from: meta.from,
        line,
        confidence: 'EXTRACTED',
      });
      count += 1;
      if (count >= 8) break; // cap per local
    }
  }

  return { filePath, imports, exports, references };
}
