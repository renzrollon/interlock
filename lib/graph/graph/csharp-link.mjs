import path from 'node:path';

const MSBUILD_PROJECT_EXTS = new Set(['.csproj', '.vbproj', '.fsproj']);

export function isMsbuildProject(filePath) {
  return MSBUILD_PROJECT_EXTS.has(path.posix.extname(filePath).toLowerCase());
}

/** `A.B.C` → ['A.B.C', 'A.B', 'A']: a file sees the types of every enclosing namespace. */
function namespacePrefixes(ns) {
  const parts = ns.split('.');
  const out = [];
  for (let i = parts.length; i > 0; i--) out.push(parts.slice(0, i).join('.'));
  return out;
}

function parentNamespace(name) {
  const i = name.lastIndexOf('.');
  return i === -1 ? null : name.slice(0, i);
}

/**
 * Resolve C# `using` directives and type mentions across files.
 *
 * C# references a type by its bare name, so a file-to-file edge cannot come
 * from the file alone: it needs every file's namespace first. A mention of a
 * repo-declared type counts as a reference only when the declaring namespace
 * is in scope for the mentioning file — its `using` directives, the global
 * usings of its project, or its own enclosing namespaces. That keeps two
 * unrelated `Constants` classes from cross-linking.
 *
 * @param {Array<{ filePath: string, exports: object[], csharp: object }>} csFiles
 * @param {Set<string>} fileIndex
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function linkCsharp(csFiles, fileIndex) {
  const nodes = [];
  const edges = [];
  if (csFiles.length === 0) return { nodes, edges };

  const projectDirs = new Set(
    [...fileIndex].filter(isMsbuildProject).map((f) => path.posix.dirname(f)),
  );
  const projectOf = (filePath) => {
    let dir = path.posix.dirname(filePath);
    for (;;) {
      if (projectDirs.has(dir)) return dir;
      const up = path.posix.dirname(dir);
      if (up === dir) return null;
      dir = up;
    }
  };

  const declared = new Set();
  const typeIndex = new Map(); // type name -> [{ id, file, namespaces }]
  const globalUsings = new Map(); // project dir -> Set<namespace>
  for (const f of csFiles) {
    for (const ns of f.csharp.namespaces) declared.add(ns);
    for (const exp of f.exports) {
      if (exp.kind === 'test') continue;
      if (!typeIndex.has(exp.name)) typeIndex.set(exp.name, []);
      typeIndex.get(exp.name).push({
        id: `symbol:${f.filePath}#${exp.name}`,
        file: f.filePath,
        namespaces: f.csharp.namespaces,
      });
    }
    if (f.csharp.globalUsings.length) {
      const key = projectOf(f.filePath) ?? '';
      if (!globalUsings.has(key)) globalUsings.set(key, new Set());
      for (const u of f.csharp.globalUsings) globalUsings.get(key).add(u.name);
    }
  }

  const nsNodeSeen = new Set();
  const nsNode = (ns, filePath, line) => {
    const id = `namespace:${ns}`;
    if (!nsNodeSeen.has(id)) {
      nsNodeSeen.add(id);
      nodes.push({ id, type: 'namespace', label: ns, source_file: filePath, source_location: `L${line}` });
    }
    return id;
  };

  for (const f of csFiles) {
    const { filePath, csharp } = f;
    const fileId = `file:${filePath}`;
    const scope = new Set(['']);

    for (const ns of csharp.namespaces) {
      edges.push({
        source: fileId,
        target: nsNode(ns, filePath, 1),
        relation: 'declares',
        confidence: 'EXTRACTED',
        source_file: filePath,
        source_location: 'L1',
        weight: 1,
      });
      for (const p of namespacePrefixes(ns)) scope.add(p);
    }

    const extraTypes = new Map(); // a `using static` / alias target type -> line
    for (const u of csharp.usings) {
      let target = u.name;
      let imported = null;
      if ((u.static || u.alias) && !declared.has(target)) {
        // `using static A.B.Type;` / `using X = A.B.Type;` name a type, not a namespace.
        const parent = parentNamespace(target);
        imported = target.slice(target.lastIndexOf('.') + 1);
        extraTypes.set(imported, u.line);
        if (parent) target = parent;
      }
      if (declared.has(target)) {
        scope.add(target);
        edges.push({
          source: fileId,
          target: nsNode(target, filePath, u.line),
          relation: 'imports',
          confidence: 'EXTRACTED',
          source_file: filePath,
          source_location: `L${u.line}`,
          weight: 1,
          imported,
          local: u.alias,
        });
      } else {
        edges.push({
          source: fileId,
          target: `external:${target}`,
          relation: 'imports',
          confidence: 'EXTRACTED',
          source_file: filePath,
          source_location: `L${u.line}`,
          weight: 1,
          imported,
          local: u.alias,
        });
      }
    }
    for (const ns of globalUsings.get(projectOf(filePath) ?? '') || []) {
      if (declared.has(ns)) scope.add(ns);
    }

    const mentions = new Map(csharp.identifiers);
    for (const [name, line] of extraTypes) if (!mentions.has(name)) mentions.set(name, line);
    for (const [name, line] of mentions) {
      const candidates = typeIndex.get(name);
      if (!candidates) continue;
      for (const c of candidates) {
        if (c.file === filePath) continue;
        const visible = c.namespaces.length === 0 || c.namespaces.some((ns) => scope.has(ns));
        if (!visible) continue;
        edges.push({
          source: fileId,
          target: c.id,
          relation: 'references',
          confidence: 'INFERRED',
          source_file: filePath,
          source_location: `L${line}`,
          weight: 0.5,
          name,
        });
      }
    }
  }

  return { nodes, edges };
}
