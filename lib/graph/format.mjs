/**
 * Format a subgraph as agent-facing plain text within a token budget.
 * Rough token estimate: chars / 4.
 */
export function formatSubgraph({ mode, seeds, nodes, edges, budget = 1500 }) {
  const lines = [];
  lines.push(`Traversal: ${String(mode).toUpperCase()} | Start: [${seeds.join(', ')}] | ${nodes.length} nodes, ${edges.length} edges`);
  lines.push('');

  const nodeLines = [];
  for (const n of nodes) {
    nodeLines.push(
      `  NODE ${n.id} [type=${n.type} src=${n.source_file || '?'} loc=${n.source_location || '?'}]`,
    );
  }
  const edgeLines = [];
  for (const e of edges) {
    edgeLines.push(
      `  EDGE ${short(e.source)} --${e.relation} [${e.confidence}]--> ${short(e.target)} (${e.source_file}:${e.source_location})`,
    );
  }

  let body = [...nodeLines, '', ...edgeLines];
  let text = `${lines.join('\n')}${body.join('\n')}\n`;
  let tokens = estimateTokens(text);

  if (tokens <= budget) return text;

  // Trim edges first, then nodes
  while (tokens > budget && edgeLines.length > 3) {
    edgeLines.pop();
    body = [...nodeLines, '', ...edgeLines, `  … truncated to fit budget ${budget}`];
    text = `${lines.join('\n')}${body.join('\n')}\n`;
    tokens = estimateTokens(text);
  }
  while (tokens > budget && nodeLines.length > 3) {
    nodeLines.pop();
    body = [...nodeLines, '', ...edgeLines, `  … truncated to fit budget ${budget}`];
    text = `${lines.join('\n')}${body.join('\n')}\n`;
    tokens = estimateTokens(text);
  }
  return text;
}

export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function short(id) {
  return id.replace(/^(file|symbol|module|openspec|memory|external|unresolved):/, '');
}
