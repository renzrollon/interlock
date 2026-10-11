/**
 * Regex-based .csproj extractor: one `imports` entry per <ProjectReference Include>.
 * The Include value is emitted as written (separators, `$(...)` and all);
 * `resolveImport` normalizes it to a project identity.
 */

const PROJECT_REFERENCE_RE =
  /<ProjectReference\b[^>]*?\bInclude\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Blank out XML comments, keeping every newline so line numbers hold. */
function blankComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

function lineOf(text, index) {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) line += 1;
  return line;
}

/**
 * @param {string} filePath relative posix path
 * @param {string} source
 */
export function extractCsproj(filePath, source) {
  const imports = [];
  const text = blankComments(source);
  PROJECT_REFERENCE_RE.lastIndex = 0;
  let m;
  while ((m = PROJECT_REFERENCE_RE.exec(text))) {
    const from = (m[1] ?? m[2] ?? '').trim();
    if (!from) continue;
    imports.push({
      from,
      imported: null,
      local: null,
      line: lineOf(text, m.index),
      confidence: 'EXTRACTED',
    });
  }
  return { filePath, imports, exports: [], references: [] };
}
