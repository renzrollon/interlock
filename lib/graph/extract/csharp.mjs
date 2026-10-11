/**
 * Regex-based C# extractor. Line-oriented, no parser: type declarations as
 * exports, plus a `csharp` record (namespaces, using directives, types,
 * identifiers, tests) that `graph/link-csharp.mjs` links across files.
 *
 * Known limits: nesting is not tracked, and a declaration-shaped line inside a
 * verbatim or raw string literal reads as a declaration.
 */

const COMMENT_LINE_RE = /^[ \t]*(?:\/\/|\*|\/\*)/;
const NAMESPACE_RE = /^[ \t]*namespace[ \t]+([A-Za-z_][\w.]*)/;
const USING_RE =
  /^[ \t]*(?:global[ \t]+)?using[ \t]+(?:static[ \t]+)?(?:[A-Za-z_]\w*[ \t]*=[ \t]*)?(?:global::)?([A-Za-z_][\w.]*)(?:<[^;]*>)?[ \t]*;/;
const MODIFIERS =
  '(?:(?:public|private|protected|internal|static|sealed|abstract|partial|readonly|unsafe|new|file|ref|required|virtual)[ \\t]+)*';
const TYPE_RE = new RegExp(
  `^[ \\t]*(?:\\[[^\\]\\n]*\\][ \\t]*)*${MODIFIERS}(class|record(?:[ \\t]+(?:class|struct))?|struct|interface|enum)[ \\t]+@?([A-Za-z_]\\w*)`,
);
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/g;
const TEST_ATTRIBUTES = new Set(['Fact', 'Theory', 'Test', 'TestCase', 'TestMethod', 'DataTestMethod']);
const MAX_GROUP_CHARS = 4000;

/** Index of the end of a string or char literal starting at `i`, inclusive. */
function skipLiteral(text, i) {
  const quote = text[i];
  const verbatim = quote === '"' && text[i - 1] === '@';
  for (let j = i + 1; j < text.length; j += 1) {
    const c = text[j];
    if (verbatim) {
      if (c === '"') {
        if (text[j + 1] === '"') j += 1;
        else return j;
      }
    } else if (c === '\\') {
      j += 1;
    } else if (c === quote || c === '\n') {
      return j;
    }
  }
  return text.length - 1;
}

/**
 * Read the `[...]` group opening at `pos`. Returns the index of its closing
 * bracket and the names of the attributes at its top level, or null when it
 * does not close within a plausible span.
 */
function scanGroup(text, pos) {
  let depth = 0;
  const names = [];
  let segmentStart = pos + 1;
  const flush = (end) => {
    const seg = text.slice(segmentStart, end).trim();
    const m = /^(?:[A-Za-z_]\w*[ \t]*:(?!:)[ \t]*)?([A-Za-z_][\w.]*)/.exec(seg);
    if (!m) return;
    let name = m[1].split('.').pop();
    if (name.endsWith('Attribute') && name.length > 'Attribute'.length) name = name.slice(0, -'Attribute'.length);
    names.push(name);
  };
  for (let i = pos; i < text.length && i - pos < MAX_GROUP_CHARS; i += 1) {
    const c = text[i];
    if (c === '"' || c === "'") {
      i = skipLiteral(text, i);
    } else if (c === '[' || c === '(' || c === '{') {
      depth += 1;
    } else if (c === ']' || c === ')' || c === '}') {
      depth -= 1;
      if (depth === 0 && c === ']') {
        flush(i);
        return { end: i, names };
      }
      if (depth <= 0) return null;
    } else if (c === ',' && depth === 1) {
      flush(i);
      segmentStart = i + 1;
    }
  }
  return null;
}

function lastLineOf(source, lines) {
  return source.endsWith('\n') ? lines.length - 1 : lines.length;
}

/**
 * @param {string} filePath relative posix path
 * @param {string} source
 */
export function extractCsharp(filePath, source) {
  const exports = [];
  const namespaces = [];
  const usings = [];
  const types = [];
  const identifierLines = new Map();

  const lines = source.split(/\r?\n/);
  const lineStarts = [];
  {
    let off = 0;
    for (const raw of source.split('\n')) {
      lineStarts.push(off);
      off += raw.length + 1;
    }
  }
  const lineAt = (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const isComment = lines.map((l) => COMMENT_LINE_RE.test(l));

  for (let i = 0; i < lines.length; i += 1) {
    if (isComment[i]) continue;
    const text = lines[i];
    const line = i + 1;

    let m = NAMESPACE_RE.exec(text);
    if (m) {
      namespaces.push({ name: m[1], line });
    } else if ((m = USING_RE.exec(text))) {
      usings.push({ name: m[1], line });
    } else if ((m = TYPE_RE.exec(text))) {
      const name = m[2];
      const kind = m[1].split(/\s+/)[0];
      exports.push({ name, kind, line, confidence: 'EXTRACTED' });
      let ns = '';
      for (const n of namespaces) if (n.line <= line) ns = n.name;
      types.push({ name, line, namespace: ns });
    }

    IDENT_RE.lastIndex = 0;
    let im;
    while ((im = IDENT_RE.exec(text))) {
      const seen = identifierLines.get(im[0]);
      if (!seen) identifierLines.set(im[0], [line]);
      else if (seen[seen.length - 1] !== line) seen.push(line);
    }
  }
  const identifiers = Object.fromEntries(identifierLines);

  // Tests: an attribute stack whose top-level names include a test attribute,
  // followed by a method signature.
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (isComment[i] || !/^[ \t]*\[/.test(lines[i])) continue;
    let p = lineStarts[i] + lines[i].search(/\S/);
    let testLine = 0;
    let groups = 0;
    for (;;) {
      while (p < source.length && /\s/.test(source[p])) p += 1;
      if (source.startsWith('//', p)) {
        const nl = source.indexOf('\n', p);
        p = nl === -1 ? source.length : nl;
        continue;
      }
      if (source[p] !== '[') break;
      const g = scanGroup(source, p);
      if (!g) break;
      groups += 1;
      if (!testLine && g.names.some((n) => TEST_ATTRIBUTES.has(n))) testLine = lineAt(p);
      p = g.end + 1;
    }
    if (groups === 0) continue;
    const sigLine = lineAt(Math.min(p, source.length - 1));
    i = Math.max(i, sigLine - 1);
    if (!testLine) continue;

    const head = source.slice(p, p + 300);
    const paren = head.indexOf('(');
    if (paren === -1) continue;
    const before = head.slice(0, paren);
    if (/[;{}=]/.test(before) || /\b(?:class|struct|interface|enum|record|namespace)\b/.test(before)) continue;
    const nm = /([A-Za-z_]\w*)$/.exec(before.replace(/<[^<>()]*(?:<[^<>()]*>[^<>()]*)*>\s*$/, '').trimEnd());
    if (!nm) continue;
    found.push({ name: nm[1], line: sigLine, start: testLine });
  }

  found.sort((a, b) => a.start - b.start);
  const lastLine = lastLineOf(source, lines);
  const tests = found.map((t, idx) => {
    let type = '';
    for (const ty of types) if (ty.line < t.start) type = ty.name;
    const next = found[idx + 1];
    return {
      type,
      name: t.name,
      line: t.line,
      start: t.start,
      end: next ? next.start - 1 : lastLine,
    };
  });

  return {
    filePath,
    imports: [],
    exports,
    references: [],
    csharp: { namespaces, usings, types, identifiers, tests },
  };
}
