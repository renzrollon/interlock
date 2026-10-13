/**
 * Regex-based Bicep extractor: module imports, param/var/resource/output
 * declarations, and `<module>.outputs.<x>` references.
 */

const MODULE_RE = /^[ \t]*module[ \t]+([A-Za-z_]\w*)[ \t]+'([^'\n]+)'[ \t]*=/;
const DECL_RE = /^[ \t]*(param|var|resource|output)[ \t]+([A-Za-z_]\w*)\b/;
const COMMENT_LINE_RE = /^[ \t]*(?:\/\/|\/\*|\*)/;

/**
 * @param {string} filePath relative posix path
 * @param {string} source
 */
export function extractBicep(filePath, source) {
  const imports = [];
  const exports = [];
  const lines = source.split(/\r?\n/);
  const modules = new Map(); // module symbolic name -> target as written

  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i];
    if (COMMENT_LINE_RE.test(text)) continue;
    const line = i + 1;
    let m = MODULE_RE.exec(text);
    if (m) {
      modules.set(m[1], m[2]);
      imports.push({
        from: m[2],
        imported: null,
        local: m[1],
        line,
        confidence: 'EXTRACTED',
      });
      continue;
    }
    m = DECL_RE.exec(text);
    if (m) {
      exports.push({ name: m[2], kind: m[1], line, confidence: 'EXTRACTED' });
    }
  }

  if (modules.size > 0) {
    const seen = new Set();
    for (let i = 0; i < lines.length; i += 1) {
      const text = lines[i];
      if (COMMENT_LINE_RE.test(text)) continue;
      for (const [name, target] of modules) {
        const re = new RegExp(`(?<![\\w.])${name}(?:\\[[^\\]]*\\])?\\??\\.outputs\\.([A-Za-z_]\\w*)`, 'g');
        let m;
        while ((m = re.exec(text))) {
          const key = `${name}\0${m[1]}`;
          if (seen.has(key)) continue;
          seen.add(key);
          imports.push({
            from: target,
            imported: m[1],
            local: null,
            line: i + 1,
            confidence: 'INFERRED',
          });
        }
      }
    }
  }

  return { filePath, imports, exports, references: [] };
}
