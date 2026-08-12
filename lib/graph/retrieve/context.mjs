import fs from 'node:fs';
import { graphPath } from '../paths.mjs';
import { loadGraph } from '../graph/build.mjs';
import { findSeedNodes, traverse } from '../graph/query.mjs';
import { deriveTerms, retrieveMarkdownSections } from './markdown.mjs';
import { estimateTokens } from '../format.mjs';

/**
 * Build a combined context bundle: structural graph subgraph + ranked doc sections.
 */
export function retrieveContext(root, {
  query = '',
  changedFiles = [],
  commitSubject = '',
  budget = 2000,
  graphBudget = null,
  docsBudget = null,
  docsDirs = null,
} = {}) {
  const terms = deriveTerms({ query, changedFiles, commitSubject });
  const searchQuery = query || terms.slice(0, 8).join(' ');
  const graphShare = graphBudget ?? Math.floor(budget * 0.45);
  const docsShare = docsBudget ?? budget - graphShare;

  const parts = [];
  parts.push(`# Context bundle`);
  parts.push(`Query: ${searchQuery || '(derived from changed files)'}`);
  parts.push(`Terms: [${terms.join(', ')}] | total budget=${budget}`);
  parts.push('');

  let graphText = '';
  let graphPresent = false;

  if (fs.existsSync(graphPath(root))) {
    try {
      const graph = loadGraph(root);
      const seeds = findSeedNodes(graph, searchQuery);
      if (seeds.length > 0) {
        graphText = traverse(graph, seeds, { mode: 'bfs', depth: 2, budget: graphShare });
        graphPresent = true;
      } else {
        graphText = `Structural: no graph nodes matched "${searchQuery}" — using documentation retrieval only.\n`;
      }
    } catch (err) {
      graphText = `Structural: graph load failed (${err.message}) — documentation retrieval only.\n`;
    }
  } else {
    graphText =
      `Structural: no graph at ${graphPath(root)} — run \`specflow-graph build .\` for import/symbol navigation.\n`;
  }

  parts.push('## Structural (graph)');
  parts.push(graphText.trimEnd());
  parts.push('');

  const docsResult = retrieveMarkdownSections(root, {
    query: searchQuery,
    terms,
    changedFiles,
    dirs: docsDirs ?? undefined,
    budget: docsShare,
  });

  parts.push(docsResult.text.trimEnd());

  const text = `${parts.join('\n')}\n`;
  return {
    text,
    terms,
    graphPresent,
    docsEmpty: docsResult.empty,
    docsSectionCount: docsResult.sectionCount,
    tokens: estimateTokens(text),
    empty: !graphPresent && docsResult.empty,
  };
}

export function formatContextResult(result) {
  if (result.empty) {
    return (
      `${result.text}\n` +
      `(empty bundle — no graph match and no documentation sections; try broader terms or build the graph)\n`
    );
  }
  return result.text;
}
