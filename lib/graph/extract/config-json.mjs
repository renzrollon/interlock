/**
 * Lightweight extractor for curated config JSON files.
 * Avoids lockfiles / large generated JSON — walk filters before we get here.
 */

/**
 * @param {string} filePath relative posix path
 * @param {string} source
 */
export function extractConfigJson(filePath, source) {
  const imports = [];
  const exports = [];
  const references = [];

  let data;
  try {
    data = JSON.parse(source);
  } catch {
    return { filePath, imports, exports, references };
  }

  const base = filePath.split('/').pop() || filePath;

  if (base === 'package.json' && data && typeof data === 'object') {
    if (data.scripts && typeof data.scripts === 'object') {
      for (const name of Object.keys(data.scripts)) {
        exports.push({
          name: `script:${name}`,
          kind: 'script',
          line: 1,
          confidence: 'EXTRACTED',
        });
      }
    }
    for (const key of ['main', 'module', 'types', 'typings']) {
      const v = data[key];
      if (typeof v === 'string' && v.length > 0 && !v.includes('*')) {
        imports.push({
          from: v.replace(/^\.\//, ''),
          imported: null,
          local: null,
          line: 1,
          confidence: 'INFERRED',
        });
      }
    }
    if (data.bin && typeof data.bin === 'object') {
      for (const v of Object.values(data.bin)) {
        if (typeof v === 'string') {
          imports.push({
            from: v.replace(/^\.\//, ''),
            imported: null,
            local: null,
            line: 1,
            confidence: 'INFERRED',
          });
        }
      }
    }
  } else if (data && typeof data === 'object' && !Array.isArray(data)) {
    // Surface a few top-level keys so query can find config knobs
    for (const key of Object.keys(data).slice(0, 24)) {
      if (!/^[A-Za-z_][\w.-]*$/.test(key)) continue;
      exports.push({
        name: key,
        kind: 'key',
        line: 1,
        confidence: 'EXTRACTED',
      });
    }
  }

  return { filePath, imports, exports, references };
}
