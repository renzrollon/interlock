/**
 * Line-oriented C# and MSBuild project extractors. No parser: comments and
 * string literals are blanked first so the declaration and `using` patterns
 * below never match inside them, then a handful of regexes do the rest.
 *
 * A `.cs` file yields its namespaces, its `using` directives, its type
 * declarations (exports), its test methods (exports of kind `test`) and the
 * identifiers it mentions. Type references are resolved later, across files,
 * by `graph/csharp-link.mjs` — a type name only means something once every
 * file's namespace is known.
 */

const CS_KEYWORDS = new Set([
  'class', 'record', 'struct', 'interface', 'enum', 'namespace', 'using', 'static', 'global',
  'public', 'private', 'protected', 'internal', 'partial', 'sealed', 'abstract', 'readonly',
  'ref', 'unsafe', 'new', 'file', 'void', 'async', 'override', 'virtual', 'extern', 'return',
  'if', 'for', 'foreach', 'while', 'switch', 'catch', 'lock', 'nameof', 'typeof', 'sizeof',
  'default', 'var', 'string', 'int', 'bool', 'object', 'Task',
  // `foreach (var record in records)` must not declare a type named `in`.
  'in', 'is', 'as', 'out', 'when', 'where', 'with', 'and', 'or', 'not',
]);

const NAMESPACE_RE = /^[ \t]*namespace[ \t]+([A-Za-z_][\w.]*)[ \t]*[;{]?/gm;
const USING_RE = /^[ \t]*(global[ \t]+)?using[ \t]+(static[ \t]+)?(?:([A-Za-z_]\w*)[ \t]*=[ \t]*)?([A-Za-z_][\w.]*)[ \t]*;/gm;
const TYPE_RE = /\b(class|record|struct|interface|enum)[ \t\r\n]+([A-Za-z_]\w*)/g;
const TEST_ATTR_RE = /\[[ \t]*(?:Fact|Theory|Test|TestMethod|DataTestMethod|TestCase|TestCaseSource)\b/;
const METHOD_NAME_RE = /([A-Za-z_]\w*)[ \t]*(?:<[^>()]*>)?[ \t]*\(/;
const IDENT_RE = /\b[A-Za-z_]\w*\b/g;

/** Index of the first character of every line, for O(log n) offset → line. */
function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function lineAt(starts, index) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Replace comments and string/char literals with spaces, keeping every newline,
 * so offsets and line numbers in the result match the source.
 */
export function blankCommentsAndStrings(src) {
  const out = src.split('');
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end === -1 ? n : end + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '"' || ((c === '@' || c === '$') && (d === '"' || ((d === '@' || d === '$') && src[i + 2] === '"')))) {
      let j = i;
      let verbatim = false;
      while (src[j] === '@' || src[j] === '$') {
        if (src[j] === '@') verbatim = true;
        j++;
      }
      // Raw string literal: three or more quotes, closed by the same run.
      let q = 0;
      while (src[j + q] === '"') q++;
      if (q >= 3) {
        const fence = '"'.repeat(q);
        const end = src.indexOf(fence, j + q);
        const k = end === -1 ? n : end + q;
        blank(i, k);
        i = k;
        continue;
      }
      j++; // opening quote
      while (j < n) {
        if (verbatim) {
          if (src[j] === '"' && src[j + 1] === '"') { j += 2; continue; }
          if (src[j] === '"') { j++; break; }
        } else {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '"' || src[j] === '\n') { j++; break; }
        }
        j++;
      }
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "'") {
      // Char literal: 'x', '\n', 'A'. Bounded so a stray quote cannot eat the file.
      let j = i + 1;
      if (src[j] === '\\') j += 2;
      else j += 1;
      while (j < n && j < i + 10 && src[j] !== "'" && src[j] !== '\n') j++;
      if (src[j] === "'") {
        blank(i, j + 1);
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return out.join('');
}

/**
 * @param {string} filePath relative posix path
 * @param {string} source
 */
export function extractCsharp(filePath, source) {
  const text = blankCommentsAndStrings(source);
  const starts = lineStarts(text);
  const exports = [];
  const namespaces = [];
  const usings = [];
  const globalUsings = [];
  let m;

  NAMESPACE_RE.lastIndex = 0;
  while ((m = NAMESPACE_RE.exec(text))) {
    if (!namespaces.includes(m[1])) namespaces.push(m[1]);
  }

  USING_RE.lastIndex = 0;
  while ((m = USING_RE.exec(text))) {
    const [, isGlobal, isStatic, alias, target] = m;
    const entry = { name: target, line: lineAt(starts, m.index), static: Boolean(isStatic), alias: alias || null };
    usings.push(entry);
    if (isGlobal) globalUsings.push(entry);
  }

  const seenTypes = new Set();
  TYPE_RE.lastIndex = 0;
  while ((m = TYPE_RE.exec(text))) {
    const [, kind, name] = m;
    if (CS_KEYWORDS.has(name)) {
      // `record struct X`: rescan from `struct`; `where T : class` just moves on.
      TYPE_RE.lastIndex = m.index + kind.length;
      continue;
    }
    const line = lineAt(starts, m.index);
    const key = `${name}@${line}`;
    if (seenTypes.has(key)) continue;
    seenTypes.add(key);
    exports.push({ name, kind, line, confidence: 'EXTRACTED' });
  }

  // Test methods: the first method-shaped line after a test attribute.
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!TEST_ATTR_RE.test(lines[i])) continue;
    for (let j = i; j < Math.min(lines.length, i + 12); j++) {
      // The attribute's own line counts only after its closing bracket.
      const tail = j === i ? lines[j].slice(lines[j].lastIndexOf(']') + 1) : lines[j];
      if (/^\s*\[/.test(tail)) continue;
      const mm = METHOD_NAME_RE.exec(tail);
      if (mm && !CS_KEYWORDS.has(mm[1])) {
        exports.push({ name: mm[1], kind: 'test', line: j + 1, confidence: 'EXTRACTED' });
        i = j;
        break;
      }
    }
  }

  // Every identifier with its first line: the candidate type references.
  const identifiers = new Map();
  IDENT_RE.lastIndex = 0;
  while ((m = IDENT_RE.exec(text))) {
    if (!identifiers.has(m[0])) identifiers.set(m[0], lineAt(starts, m.index));
  }

  return {
    filePath,
    imports: [],
    exports,
    references: [],
    csharp: { namespaces, usings, globalUsings, identifiers },
  };
}

const PROJECT_REF_RE = /<ProjectReference\b[^>]*?\bInclude[ \t]*=[ \t]*["']([^"']+)["']/g;

/**
 * `.csproj` / `.vbproj` / `.fsproj`: one import per <ProjectReference>, the
 * project-to-project edge that is the layering boundary in most .NET repos.
 *
 * @param {string} filePath relative posix path
 * @param {string} source
 */
export function extractMsbuildProject(filePath, source) {
  const imports = [];
  const starts = lineStarts(source);
  let m;
  PROJECT_REF_RE.lastIndex = 0;
  while ((m = PROJECT_REF_RE.exec(source))) {
    imports.push({
      from: m[1].replace(/\\/g, '/'),
      imported: null,
      local: null,
      line: lineAt(starts, m.index),
      confidence: 'EXTRACTED',
    });
  }
  return { filePath, imports, exports: [], references: [] };
}
