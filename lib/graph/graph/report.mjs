/**
 * Generate GRAPH_REPORT.md content from a graph.
 */
export function writeReport(_root, graph, stats) {
  const degree = new Map();
  for (const n of graph.nodes) degree.set(n.id, { in: 0, out: 0, node: n });
  for (const e of graph.links) {
    if (degree.has(e.source)) degree.get(e.source).out += 1;
    if (degree.has(e.target)) degree.get(e.target).in += 1;
  }

  const hubs = [...degree.values()]
    .filter((d) => d.node.type === 'file' || d.node.type === 'symbol')
    .map((d) => ({ ...d, total: d.in + d.out }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);

  const modules = graph.nodes
    .filter((n) => n.type === 'module')
    .map((m) => {
      const members = graph.links
        .filter((e) => e.relation === 'belongs_to' && e.target === m.id)
        .map((e) => e.source.replace(/^file:/, ''));
      return { ...m, members };
    })
    .sort((a, b) => b.members.length - a.members.length);

  const surprising = graph.links
    .filter((e) => e.confidence === 'INFERRED' && (e.relation === 'implements_spec' || e.relation === 'couples_with'))
    .slice(0, 20);

  const crossModule = [];
  const fileModule = new Map();
  for (const e of graph.links) {
    if (e.relation === 'belongs_to' && e.source.startsWith('file:')) {
      fileModule.set(e.source, e.target);
    }
  }
  for (const e of graph.links) {
    if (e.relation !== 'imports') continue;
    if (!e.source.startsWith('file:') || !e.target.startsWith('file:')) continue;
    const a = fileModule.get(e.source);
    const b = fileModule.get(e.target);
    if (a && b && a !== b) {
      crossModule.push(e);
    }
  }

  const lines = [];
  lines.push('# Interlock Graph Report');
  lines.push('');
  lines.push(`Built: ${graph.graph?.built_at || 'unknown'}`);
  lines.push(`Extractor: ${stats.extractor || graph.graph?.extractor || 'unknown'}`);
  lines.push('');
  lines.push('## Corpus stats');
  lines.push('');
  lines.push(`- Files: ${stats.files}`);
  lines.push(`- Nodes: ${stats.nodes}`);
  lines.push(`- Edges: ${stats.edges}`);
  lines.push(`- Symbols: ${stats.symbols}`);
  lines.push(`- Modules: ${stats.modules}`);
  lines.push('');
  lines.push('## God nodes (highest degree)');
  lines.push('');
  if (hubs.length === 0) {
    lines.push('_None_');
  } else {
    for (const h of hubs) {
      lines.push(
        `- **${h.node.label}** (\`${h.node.source_file}${h.node.source_location ? ':' + h.node.source_location : ''}\`) — in:${h.in} out:${h.out} type:${h.node.type}`,
      );
    }
  }
  lines.push('');
  lines.push('## Modules');
  lines.push('');
  for (const m of modules.slice(0, 30)) {
    lines.push(`### ${m.label} (${m.members.length} files)`);
    for (const f of m.members.slice(0, 12)) {
      lines.push(`- \`${f}\``);
    }
    if (m.members.length > 12) lines.push(`- … +${m.members.length - 12} more`);
    lines.push('');
  }
  lines.push('## Surprising / inferred connections');
  lines.push('');
  if (surprising.length === 0) {
    lines.push('_None_');
  } else {
    for (const e of surprising) {
      lines.push(
        `- \`${short(e.source)}\` --${e.relation} [${e.confidence}]--> \`${short(e.target)}\` (${e.source_file}:${e.source_location})`,
      );
    }
  }
  lines.push('');
  lines.push('## Cross-module imports (sample)');
  lines.push('');
  const sample = crossModule.slice(0, 25);
  if (sample.length === 0) {
    lines.push('_None_');
  } else {
    for (const e of sample) {
      lines.push(
        `- \`${short(e.source)}\` → \`${short(e.target)}\` (${e.source_file}:${e.source_location})`,
      );
    }
  }
  lines.push('');
  lines.push('## Suggested questions');
  lines.push('');
  lines.push('- Which files import a given symbol? (`interlock-graph consumers <symbol>`)');
  lines.push('- What is the shortest path between two modules/files? (`interlock-graph path A B`)');
  lines.push('- What are the hub files in this repo? (see God nodes above)');
  lines.push('- Which OpenSpec artifacts mention a symbol? (filter implements_spec edges)');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function short(id) {
  return id.replace(/^(file|symbol|module|openspec|memory|external|unresolved):/, '');
}
