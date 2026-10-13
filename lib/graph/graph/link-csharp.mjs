// C# is linked in a pass after the per-file loop: a `using` names a namespace, and a
// namespace is declared across many files, so it cannot be resolved against a set of
// paths. This module is pure (no `node:` import) -- it takes every `extractCsharp`
// record and returns `{ nodes, edges }`, the shape the OpenSpec and memory overlays
// already return.

const INFERRED_REFERENCE_WEIGHT = 0.5;

function nameOf(entry) {
  return typeof entry === 'string' ? entry : entry?.name;
}

function lineOf(entry, fallback = 1) {
  const line = entry && typeof entry === 'object' ? entry.line : undefined;
  return Number.isInteger(line) && line > 0 ? line : fallback;
}

function ascending(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
}

/** `A.B.C` -> ['A.B.C', 'A.B', 'A'] */
function dotPrefixes(name) {
  const parts = name.split('.');
  const out = [];
  for (let i = parts.length; i > 0; i -= 1) out.push(parts.slice(0, i).join('.'));
  return out;
}

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Link C# records into namespace nodes, test nodes and their edges.
 *
 * @param {Array<{filePath: string, csharp?: object}>} records `extractCsharp` results
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function linkCsharp(records) {
  const files = (Array.isArray(records) ? records : [])
    .filter((r) => r && typeof r.filePath === 'string' && r.csharp)
    .sort((a, b) => compare(a.filePath, b.filePath));

  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  const edgeKeys = new Set();

  function addNode(node) {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  }

  function addEdge(edge) {
    const key = `${edge.source}\u0000${edge.target}\u0000${edge.relation}\u0000${edge.source_location}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(edge);
  }

  // Pass 1: every namespace the repository declares, and the types each one holds.
  const declared = new Set();
  const typesByNamespace = new Map(); // namespace -> Map(typeName -> [declFile])
  for (const rec of files) {
    for (const ns of rec.csharp.namespaces || []) {
      const name = nameOf(ns);
      if (!name) continue;
      declared.add(name);
      const id = `namespace:${name}`;
      if (!nodeIds.has(id)) {
        // First declaring file in path order, its first declaration.
        const first = (rec.csharp.namespaces || [])
          .filter((n) => nameOf(n) === name)
          .reduce((best, n) => Math.min(best, lineOf(n)), Infinity);
        addNode({
          id,
          type: 'namespace',
          label: name,
          source_file: rec.filePath,
          source_location: `L${first}`,
        });
      }
    }
    for (const type of rec.csharp.types || []) {
      const name = nameOf(type);
      if (!name) continue;
      const ns = type && typeof type === 'object' && typeof type.namespace === 'string' ? type.namespace : '';
      if (!typesByNamespace.has(ns)) typesByNamespace.set(ns, new Map());
      const byName = typesByNamespace.get(ns);
      if (!byName.has(name)) byName.set(name, []);
      if (!byName.get(name).includes(rec.filePath)) byName.get(name).push(rec.filePath);
    }
  }

  const declaredByLength = [...declared].sort((a, b) => b.length - a.length || compare(a, b));
  function resolveNamespace(name) {
    return declaredByLength.find((d) => name === d || name.startsWith(`${d}.`)) || null;
  }

  // Pass 2: edges, per file in path order.
  for (const rec of files) {
    const fileId = `file:${rec.filePath}`;
    const cs = rec.csharp;
    const visible = new Set();

    for (const ns of cs.namespaces || []) {
      const name = nameOf(ns);
      if (!name) continue;
      addEdge({
        source: fileId,
        target: `namespace:${name}`,
        relation: 'declares',
        confidence: 'EXTRACTED',
        source_file: rec.filePath,
        source_location: `L${lineOf(ns)}`,
        weight: 1,
      });
      for (const p of dotPrefixes(name)) visible.add(p);
    }

    for (const using of cs.usings || []) {
      const name = nameOf(using);
      if (!name) continue;
      const hit = resolveNamespace(name);
      if (hit) visible.add(hit);
      addEdge({
        source: fileId,
        target: hit ? `namespace:${hit}` : `external:${name}`,
        relation: 'imports',
        confidence: 'EXTRACTED',
        source_file: rec.filePath,
        source_location: `L${lineOf(using)}`,
        weight: 1,
      });
    }

    const tests = [];
    for (const t of cs.tests || []) {
      if (!t || !t.name) continue;
      const label = `${t.type}.${t.name}`;
      const id = `test:${rec.filePath}#${label}`;
      addNode({
        id,
        type: 'test',
        label,
        source_file: rec.filePath,
        source_location: `L${lineOf(t)}`,
      });
      addEdge({
        source: fileId,
        target: id,
        relation: 'exports',
        confidence: 'EXTRACTED',
        source_file: rec.filePath,
        source_location: `L${lineOf(t)}`,
        weight: 1,
      });
      tests.push({
        id,
        start: Number.isInteger(t.start) ? t.start : lineOf(t),
        end: Number.isInteger(t.end) ? t.end : Infinity,
      });
    }

    const ownTypes = new Set((cs.types || []).map(nameOf).filter(Boolean));
    const identifiers = cs.identifiers || {};
    for (const ident of Object.keys(identifiers).sort()) {
      if (ownTypes.has(ident)) continue;
      const lines = ascending(identifiers[ident]);
      if (lines.length === 0) continue;
      const targets = new Set();
      for (const ns of visible) {
        for (const declFile of typesByNamespace.get(ns)?.get(ident) || []) {
          targets.add(`symbol:${declFile}#${ident}`);
        }
      }
      for (const target of [...targets].sort()) {
        addEdge({
          source: fileId,
          target,
          relation: 'references',
          confidence: 'INFERRED',
          source_file: rec.filePath,
          source_location: `L${lines[0]}`,
          weight: INFERRED_REFERENCE_WEIGHT,
          name: ident,
        });
        for (const test of tests) {
          const at = lines.find((n) => n >= test.start && n <= test.end);
          if (at === undefined) continue;
          addEdge({
            source: test.id,
            target,
            relation: 'references',
            confidence: 'INFERRED',
            source_file: rec.filePath,
            source_location: `L${at}`,
            weight: INFERRED_REFERENCE_WEIGHT,
            name: ident,
          });
        }
      }
    }
  }

  return { nodes, edges };
}
