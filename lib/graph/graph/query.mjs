import { formatSubgraph } from '../format.mjs';

/**
 * Build adjacency maps from graph.
 */
export function indexGraph(graph) {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map();
  const inn = new Map();
  for (const n of graph.nodes) {
    out.set(n.id, []);
    inn.set(n.id, []);
  }
  for (const e of graph.links) {
    if (!out.has(e.source)) out.set(e.source, []);
    if (!inn.has(e.target)) inn.set(e.target, []);
    out.get(e.source).push(e);
    inn.get(e.target).push(e);
  }
  return { nodes, out, inn };
}

/**
 * Expand query tokens against node labels / ids / source_file.
 */
export function findSeedNodes(graph, query) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const scored = [];
  for (const n of graph.nodes) {
    const hay = `${n.id} ${n.label} ${n.source_file || ''}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (n.label?.toLowerCase() === t) score += 10;
      else if (n.id.toLowerCase().endsWith(`#${t}`)) score += 9;
      else if (n.id.toLowerCase().includes(t)) score += 5;
      else if (hay.includes(t)) score += 3;
    }
    if (score > 0) scored.push({ node: n, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8).map((s) => s.node);
}

function tokenize(query) {
  return String(query)
    .split(/[\s,|]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2)
    .map((t) => t.replace(/^file:/, '').replace(/^symbol:/, ''));
}

/**
 * BFS or DFS neighborhood from seeds.
 */
export function traverse(graph, seeds, { mode = 'bfs', depth = 2, budget = 1500 } = {}) {
  const { nodes, out, inn } = indexGraph(graph);
  const seedIds = seeds.map((s) => s.id);
  const visitedNodes = new Map();
  const visitedEdges = [];
  const queue = seedIds.map((id) => ({ id, d: 0 }));
  const seen = new Set();

  while (queue.length) {
    const cur = mode === 'dfs' ? queue.pop() : queue.shift();
    if (!cur || seen.has(cur.id)) continue;
    seen.add(cur.id);
    const node = nodes.get(cur.id);
    if (node) visitedNodes.set(cur.id, node);

    if (cur.d >= depth) continue;

    const edges = [...(out.get(cur.id) || []), ...(inn.get(cur.id) || [])];
    for (const e of edges) {
      visitedEdges.push(e);
      const next = e.source === cur.id ? e.target : e.source;
      if (!seen.has(next)) {
        if (mode === 'dfs') queue.push({ id: next, d: cur.d + 1 });
        else queue.push({ id: next, d: cur.d + 1 });
      }
    }

    // Early stop by rough token budget
    const rough = visitedNodes.size * 20 + visitedEdges.length * 25;
    if (rough > budget) break;
  }

  return formatSubgraph({
    mode,
    seeds: seedIds,
    nodes: [...visitedNodes.values()],
    edges: dedupeEdges(visitedEdges),
    budget,
  });
}

/**
 * Reverse imports + references for a symbol or file.
 */
export function consumers(graph, target) {
  const seeds = findSeedNodes(graph, target);
  if (seeds.length === 0) {
    return `No nodes matched: ${target}\n`;
  }
  const { nodes, inn } = indexGraph(graph);
  const lines = [`Consumers of: ${seeds.map((s) => s.id).join(', ')}`, ''];

  for (const seed of seeds) {
    const incoming = (inn.get(seed.id) || []).filter(
      (e) => e.relation === 'imports' || e.relation === 'references' || e.relation === 'implements_spec',
    );
    // Also: if seed is a symbol, include importers of its file that name the symbol
    if (seed.type === 'symbol') {
      const fileId = `file:${seed.source_file}`;
      for (const e of inn.get(fileId) || []) {
        if (e.relation === 'imports' && (e.imported === seed.label || e.local === seed.label)) {
          incoming.push(e);
        }
      }
    }
    lines.push(`NODE ${seed.id} [${seed.source_file}:${seed.source_location}]`);
    if (incoming.length === 0) {
      lines.push('  (no consumers indexed)');
    } else {
      const seen = new Set();
      for (const e of incoming) {
        const key = `${e.source}|${e.relation}|${e.source_location}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const src = nodes.get(e.source);
        lines.push(
          `  EDGE ${short(e.source)} --${e.relation} [${e.confidence}]--> ${short(e.target)} (${e.source_file}:${e.source_location})`,
        );
        if (src?.type === 'file') {
          lines.push(`    consumer_file: ${src.source_file}`);
        }
      }
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Shortest path between two queries.
 */
export function shortestPath(graph, aQuery, bQuery) {
  const aSeeds = findSeedNodes(graph, aQuery);
  const bSeeds = findSeedNodes(graph, bQuery);
  if (!aSeeds.length || !bSeeds.length) {
    return `Could not resolve path endpoints.\n  A matches: ${aSeeds.length}\n  B matches: ${bSeeds.length}\n`;
  }
  const start = aSeeds[0].id;
  const goals = new Set(bSeeds.map((s) => s.id));
  const { nodes, out } = indexGraph(graph);

  const prev = new Map();
  const prevEdge = new Map();
  const q = [start];
  prev.set(start, null);
  let found = null;

  while (q.length) {
    const cur = q.shift();
    if (goals.has(cur)) {
      found = cur;
      break;
    }
    for (const e of out.get(cur) || []) {
      if (!prev.has(e.target)) {
        prev.set(e.target, cur);
        prevEdge.set(e.target, e);
        q.push(e.target);
      }
    }
  }

  if (!found) {
    // try undirected
    const { inn } = indexGraph(graph);
    prev.clear();
    prevEdge.clear();
    q.length = 0;
    q.push(start);
    prev.set(start, null);
    while (q.length) {
      const cur = q.shift();
      if (goals.has(cur)) {
        found = cur;
        break;
      }
      const edges = [...(out.get(cur) || []), ...(inn.get(cur) || [])];
      for (const e of edges) {
        const next = e.source === cur ? e.target : e.source;
        if (!prev.has(next)) {
          prev.set(next, cur);
          prevEdge.set(next, e);
          q.push(next);
        }
      }
    }
  }

  if (!found) return `No path found between ${start} and ${[...goals].join('|')}\n`;

  const pathNodes = [];
  const pathEdges = [];
  let cur = found;
  while (cur) {
    pathNodes.unshift(nodes.get(cur));
    const e = prevEdge.get(cur);
    if (e) pathEdges.unshift(e);
    cur = prev.get(cur);
  }

  return formatSubgraph({
    mode: 'path',
    seeds: [start, found],
    nodes: pathNodes.filter(Boolean),
    edges: pathEdges,
    budget: 5000,
  });
}

/**
 * Explain a single node and neighbors.
 */
export function explain(graph, query) {
  const seeds = findSeedNodes(graph, query);
  if (!seeds.length) return `No node matched: ${query}\n`;
  return traverse(graph, seeds.slice(0, 1), { mode: 'bfs', depth: 1, budget: 2000 });
}

function dedupeEdges(edges) {
  const seen = new Set();
  const out = [];
  for (const e of edges) {
    const key = `${e.source}|${e.target}|${e.relation}|${e.source_location}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

function short(id) {
  return id.replace(/^(file|symbol|module|openspec|memory|external|unresolved):/, '');
}
