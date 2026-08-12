#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, loadGraph, writeGraphArtifacts } from './graph/build.mjs';
import { consumers, explain, findSeedNodes, shortestPath, traverse } from './graph/query.mjs';
import { updateGraph } from './graph/update.mjs';
import { writeReport } from './graph/report.mjs';
import { formatContextResult, retrieveContext } from './retrieve/context.mjs';
import {
  DOCS_INDEX_DEFAULT_DIRS,
  formatDocsIndexSummary,
  writeDocsIndex,
} from './retrieve/docs-index.mjs';
import { formatDocsResult, retrieveMarkdownSections } from './retrieve/markdown.mjs';
import { graphPath, reportPath, resolveRoot } from './paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  return `specflow-graph — lightweight codebase knowledge graph for agents

Usage:
  specflow-graph build [root]              Build graph into <root>/.claude/graph/
  specflow-graph update [root]             Incremental rebuild when files change
  specflow-graph report [root]             Print / regenerate GRAPH_REPORT.md
  specflow-graph query <q> [options]       Neighborhood query (BFS default)
  specflow-graph consumers <symbol|file>   Reverse imports / references
  specflow-graph path <A> <B>              Shortest path
  specflow-graph explain <node>            Node + neighbors
  specflow-graph docs <q> [options]        Ranked markdown section excerpts
  specflow-graph context <q> [options]     Graph subgraph + doc excerpts (default retrieval)
  specflow-graph docs-index [root]         Deterministic docs/ + openspec/specs TOC → docs-index.json
  specflow-graph which                     Print CLI path (for skills)

Query options:
  --budget <n>     Token budget for output (default 1500; docs=800, context=2000)
  --depth <n>      Traversal depth (default 2)
  --dfs            Use DFS instead of BFS
  --root <path>    Project root (default: cwd)
  --changed <paths> Comma-separated changed file paths (context/docs seeding)
  --commit-subject <text>  Commit subject for term derivation
  --dirs <list>    Comma-separated markdown roots (docs/context default: docs,openspec/…; docs-index default: docs,openspec/specs)
  --graph-budget <n>  Structural slice of context budget
  --docs-budget <n>   Documentation slice of context budget
  --write          Write docs-index.json (default for docs-index)
  --no-write       Print docs-index summary without writing

Examples:
  specflow-graph build .
  specflow-graph query AuthService --budget 1500
  specflow-graph consumers normalizeEmail
  specflow-graph path lib/auth app/api
  specflow-graph docs "authentication session" --budget 800
  specflow-graph context "auth login" --changed lib/auth.ts,app/api/login.ts --budget 2000
  specflow-graph docs-index . --write
`;
}

function parseArgs(argv) {
  const args = {
    _: [],
    budget: null,
    depth: 2,
    dfs: false,
    root: null,
    changed: [],
    commitSubject: '',
    dirs: null,
    graphBudget: null,
    docsBudget: null,
    write: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--budget') args.budget = Number(argv[++i]);
    else if (a === '--depth') args.depth = Number(argv[++i]);
    else if (a === '--dfs') args.dfs = true;
    else if (a === '--root') args.root = argv[++i];
    else if (a === '--changed') {
      args.changed.push(...String(argv[++i]).split(',').map((s) => s.trim()).filter(Boolean));
    } else if (a === '--commit-subject') args.commitSubject = argv[++i];
    else if (a === '--dirs') args.dirs = String(argv[++i]).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--graph-budget') args.graphBudget = Number(argv[++i]);
    else if (a === '--docs-budget') args.docsBudget = Number(argv[++i]);
    else if (a === '--write') args.write = true;
    else if (a === '--no-write') args.write = false;
    else if (a === '-h' || a === '--help') args.help = true;
    else args._.push(a);
  }
  return args;
}

function defaultBudget(cmd, args) {
  if (args.budget != null) return args.budget;
  if (cmd === 'docs') return 800;
  if (cmd === 'context') return 2000;
  return 1500;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._.length === 0) {
    process.stdout.write(usage());
    process.exit(args.help || args._.length === 0 ? 0 : 1);
  }

  const cmd = args._[0];
  const root = resolveRoot(
    args.root ||
      (cmd === 'build' || cmd === 'update' || cmd === 'report' || cmd === 'docs-index'
        ? args._[1]
        : null) ||
      process.cwd(),
  );

  try {
    switch (cmd) {
      case 'which': {
        process.stdout.write(`${path.join(__dirname, 'cli.mjs')}\n`);
        break;
      }
      case 'build': {
        const result = buildGraph(root);
        const written = writeGraphArtifacts(root, result);
        process.stdout.write(
          `Built graph → ${written.graphPath}\nReport → ${written.reportPath}\n` +
            `files=${result.stats.files} nodes=${result.stats.nodes} edges=${result.stats.edges} extractor=${result.stats.extractor}\n`,
        );
        // An empty graph is a legitimate outcome — this repo is written in a
        // language the walker does not structurally index. Saying so is the
        // difference between "unsupported" and "broken".
        if (result.stats.files === 0) {
          process.stdout.write(
            '\nNo source files were indexed. Structural indexing covers ' +
              '.ts .tsx .js .jsx .mjs .cjs .py .pyi .sh .bash\n' +
              'plus curated config JSON. Other languages (Go, Rust, Java, Ruby) ' +
              'are not structurally indexed yet:\n' +
              'docs, OpenSpec specs and spec→file links still work, but there ' +
              'are no import or symbol edges.\n' +
              'Use `specflow-graph docs` and `specflow-graph docs-index` for ' +
              'prose retrieval on this repo.\n',
          );
        }
        break;
      }
      case 'update': {
        const result = updateGraph(root);
        if (!result.updated) {
          process.stdout.write(`Graph up to date (${result.reason})\n`);
        } else {
          process.stdout.write(
            `Updated graph (${result.reason})\n` +
              `files=${result.stats.files} nodes=${result.stats.nodes} edges=${result.stats.edges}\n`,
          );
        }
        break;
      }
      case 'report': {
        const graph = loadGraph(root);
        const stats = {
          files: graph.nodes.filter((n) => n.type === 'file').length,
          nodes: graph.nodes.length,
          edges: graph.links.length,
          symbols: graph.nodes.filter((n) => n.type === 'symbol').length,
          modules: graph.nodes.filter((n) => n.type === 'module').length,
          extractor: graph.graph?.extractor,
        };
        const report = writeReport(root, graph, stats);
        fs.writeFileSync(reportPath(root), report);
        process.stdout.write(report);
        break;
      }
      case 'query': {
        const q = args._.slice(1).join(' ');
        if (!q) throw new Error('query requires a search string');
        const graph = loadGraph(root);
        const seeds = findSeedNodes(graph, q);
        if (!seeds.length) {
          process.stdout.write(`No nodes matched: ${q}\n(graph: ${graphPath(root)})\n`);
          process.exit(1);
        }
        process.stdout.write(
          traverse(graph, seeds, {
            mode: args.dfs ? 'dfs' : 'bfs',
            depth: args.depth,
            budget: defaultBudget('query', args),
          }),
        );
        break;
      }
      case 'consumers': {
        const target = args._.slice(1).join(' ');
        if (!target) throw new Error('consumers requires a symbol or file');
        process.stdout.write(consumers(loadGraph(root), target));
        break;
      }
      case 'path': {
        const a = args._[1];
        const b = args._[2];
        if (!a || !b) throw new Error('path requires two endpoints');
        process.stdout.write(shortestPath(loadGraph(root), a, b));
        break;
      }
      case 'explain': {
        const q = args._.slice(1).join(' ');
        if (!q) throw new Error('explain requires a node query');
        process.stdout.write(explain(loadGraph(root), q));
        break;
      }
      case 'docs': {
        const q = args._.slice(1).join(' ');
        if (!q && args.changed.length === 0) throw new Error('docs requires a query or --changed paths');
        const result = retrieveMarkdownSections(root, {
          query: q,
          changedFiles: args.changed,
          dirs: args.dirs ?? undefined,
          budget: defaultBudget('docs', args),
        });
        process.stdout.write(formatDocsResult(result));
        if (result.empty) process.exit(1);
        break;
      }
      case 'context': {
        const q = args._.slice(1).join(' ');
        if (!q && args.changed.length === 0 && !args.commitSubject) {
          throw new Error('context requires a query, --changed paths, or --commit-subject');
        }
        const result = retrieveContext(root, {
          query: q,
          changedFiles: args.changed,
          commitSubject: args.commitSubject,
          budget: defaultBudget('context', args),
          graphBudget: args.graphBudget ?? undefined,
          docsBudget: args.docsBudget ?? undefined,
          docsDirs: args.dirs ?? undefined,
        });
        process.stdout.write(formatContextResult(result));
        if (result.empty) process.exit(1);
        break;
      }
      case 'docs-index': {
        const write = args.write !== false;
        const { index, path: outPath, written } = writeDocsIndex(root, {
          write,
          // Omit rather than defaulting, so buildDocsIndex can probe for the
          // docs root this repo actually uses (doc/, site/, root README, …).
          dirs: args.dirs ?? undefined,
        });
        process.stdout.write(formatDocsIndexSummary(index, outPath, written));
        if (!written) {
          process.stdout.write(`${JSON.stringify(index, null, 2)}\n`);
        }
        break;
      }
      default:
        process.stderr.write(`Unknown command: ${cmd}\n\n${usage()}`);
        process.exit(1);
    }
  } catch (err) {
    process.stderr.write(`specflow-graph: ${err.message || err}\n`);
    process.exit(1);
  }
}

main();
