import fs from 'node:fs';
import path from 'node:path';
import { rel } from '../paths.mjs';
import { walkMarkdown, resolveDocsDirs } from '../extract/walk.mjs';
import { estimateTokens } from '../format.mjs';

// Preferred roots. When none of them hold markdown, resolveDocsDirs() probes
// for the docs root this repo actually uses (doc/, site/, root README, …), so a
// project that does not happen to use `docs/` still gets prose retrieval.
const DEFAULT_DIRS = ['docs', 'openspec/specs', 'openspec/changes'];
const DEFAULT_PER_SECTION_LINES = 80;
const DEFAULT_PER_SECTION_TOKENS = 600;

/**
 * Split markdown into heading-delimited sections.
 */
export function parseMarkdownSections(filePath, text) {
  const lines = text.split('\n');
  const sections = [];
  let current = {
    file: filePath,
    heading: '(preamble)',
    level: 0,
    startLine: 1,
    lines: [],
  };

  function pushSection(endLine) {
    const content = current.lines.join('\n').trimEnd();
    if (!content && current.heading === '(preamble)') return;
    sections.push({
      file: current.file,
      heading: current.heading,
      level: current.level,
      startLine: current.startLine,
      endLine: endLine,
      content,
    });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^(#{1,6})\s+(.+)$/);
    if (m) {
      pushSection(i);
      current = {
        file: filePath,
        heading: m[2].trim(),
        level: m[1].length,
        startLine: i + 1,
        lines: [line],
      };
    } else {
      current.lines.push(line);
    }
  }
  pushSection(lines.length);
  return sections;
}

/**
 * Tokenize a query string or term list into lowercase search terms (min length 2).
 */
export function tokenizeTerms(input) {
  const raw = Array.isArray(input) ? input.join(' ') : String(input || '');
  return [...new Set(
    raw
      .split(/[\s,|/]+/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length >= 2)
      .map((t) => t.replace(/^file:/, '').replace(/\.(ts|tsx|js|jsx|md)$/, '')),
  )];
}

/**
 * Derive search terms from explicit query, changed paths, and commit subject.
 */
export function deriveTerms({ query = '', changedFiles = [], commitSubject = '' } = {}) {
  const fromQuery = tokenizeTerms(query);
  const fromCommit = tokenizeTerms(commitSubject);
  const fromFiles = [];
  for (const f of changedFiles) {
    const parts = String(f).split(/[/\\]/);
    for (const p of parts) {
      const base = p.replace(/\.[^.]+$/, '');
      if (base.length >= 2 && !['src', 'lib', 'app', 'components', 'types'].includes(base)) {
        fromFiles.push(base.toLowerCase());
      }
    }
    fromFiles.push(...tokenizeTerms(f));
  }
  return [...new Set([...fromQuery, ...fromCommit, ...fromFiles])];
}

/**
 * Score a section for relevance to terms and changed file paths.
 */
export function scoreSection(section, terms, changedPaths = []) {
  if (terms.length === 0 && changedPaths.length === 0) return 0;

  let score = 0;
  const headingLower = section.heading.toLowerCase();
  const contentLower = section.content.toLowerCase();
  const fileLower = section.file.toLowerCase();

  for (const term of terms) {
    if (headingLower === term) score += 15;
    else if (headingLower.includes(term)) score += 10;
    if (fileLower.includes(term)) score += 8;
    if (contentLower.includes(term)) score += 3;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'gi');
    const matches = section.content.match(re);
    if (matches) score += Math.min(matches.length, 5);
  }

  for (const p of changedPaths) {
    const norm = String(p).replace(/\\/g, '/').toLowerCase();
    const base = path.posix.basename(norm, path.posix.extname(norm));
    if (contentLower.includes(norm)) score += 12;
    else if (base.length >= 2 && contentLower.includes(base)) score += 8;
    const topDir = norm.split('/')[0];
    if (topDir && fileLower.includes(topDir)) score += 4;
  }

  return score;
}

function truncateSection(section, { maxLines = DEFAULT_PER_SECTION_LINES, maxTokens = DEFAULT_PER_SECTION_TOKENS } = {}) {
  const lines = section.content.split('\n');
  let out = lines.slice(0, maxLines).join('\n');
  if (estimateTokens(out) > maxTokens) {
    const charLimit = maxTokens * 4;
    out = `${out.slice(0, charLimit)}\n… (section truncated)`;
  } else if (lines.length > maxLines) {
    out = `${out}\n… (${lines.length - maxLines} more lines in section)`;
  }
  return out;
}

/**
 * Retrieve ranked markdown sections within a token budget.
 */
export function retrieveMarkdownSections(root, {
  query = '',
  terms: explicitTerms = null,
  changedFiles = [],
  dirs: requestedDirs = null,
  budget = 800,
  perSectionLines = DEFAULT_PER_SECTION_LINES,
  perSectionTokens = DEFAULT_PER_SECTION_TOKENS,
  minScore = 1,
} = {}) {
  const terms = explicitTerms ?? deriveTerms({ query, changedFiles });
  const changedPaths = changedFiles.map((f) => String(f).replace(/\\/g, '/'));

  // Fall back to probing only when the caller did not name dirs AND the
  // preferred roots are empty on this repo.
  let dirs = requestedDirs ?? DEFAULT_DIRS;
  if (!requestedDirs && walkMarkdown(root, DEFAULT_DIRS).length === 0) {
    dirs = resolveDocsDirs(root, null);
  }

  const allSections = [];
  for (const absPath of walkMarkdown(root, dirs)) {
    const filePath = rel(root, absPath);
    let text;
    try {
      text = fs.readFileSync(absPath, 'utf8');
    } catch {
      continue;
    }
    for (const section of parseMarkdownSections(filePath, text)) {
      const s = scoreSection(section, terms, changedPaths);
      if (s >= minScore) {
        allSections.push({ ...section, score: s });
      }
    }
  }

  allSections.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.startLine - b.startLine;
  });

  const maxScore = allSections[0]?.score ?? 0;
  const scoreFloor = Math.max(minScore, Math.floor(maxScore * 0.4), maxScore - 20);
  const ranked = allSections.filter((s) => s.score >= scoreFloor);

  const selected = [];
  let usedTokens = 0;
  const headerTokens = estimateTokens(
    `# Documentation excerpts\nTerms: [${terms.join(', ')}] | budget=${budget}\n\n`,
  );
  usedTokens += headerTokens;

  for (const section of ranked) {
    const excerpt = truncateSection(section, {
      maxLines: perSectionLines,
      maxTokens: perSectionTokens,
    });
    const block =
      `### ${section.file} — ${section.heading} (L${section.startLine}-L${section.endLine}) [score=${section.score}]\n` +
      `${excerpt}\n`;
    const blockTokens = estimateTokens(block);
    if (usedTokens + blockTokens > budget) {
      if (selected.length === 0 && ranked.length > 0) {
        // Always include at least one hit, truncated to budget
        const trimmed = block.slice(0, Math.max(100, (budget - usedTokens) * 4));
        selected.push(`${trimmed}\n… (truncated to fit budget ${budget})\n`);
        usedTokens = budget;
      }
      break;
    }
    selected.push(block);
    usedTokens += blockTokens;
  }

  if (selected.length === 0) {
    return {
      text:
        `No matching documentation sections.\n` +
        `  Terms searched: ${terms.length ? terms.join(', ') : '(none — pass a query or changed files)'}\n` +
        `  Directories: ${dirs.join(', ')}\n` +
        `  Hint: broaden query terms or add --changed paths from the task.\n`,
      terms,
      sectionCount: 0,
      tokens: estimateTokens(`No matching documentation sections.\n`),
      empty: true,
    };
  }

  const text = `# Documentation excerpts\nTerms: [${terms.join(', ')}] | budget=${budget} | sections=${selected.length}\n\n${selected.join('\n')}`;
  return {
    text,
    terms,
    sectionCount: selected.length,
    tokens: estimateTokens(text),
    empty: false,
  };
}

export function formatDocsResult(result) {
  return result.text;
}
