import { createRequire } from 'node:module';
import path from 'node:path';
import { extractWithRegex } from './regex-fallback.mjs';

/**
 * Try to load typescript from the target project (or cwd), then fall back to regex.
 * @returns {{ mode: 'typescript'|'regex', extract: Function }}
 */
export function createJsExtractor(root) {
  const ts = tryLoadTypescript(root);
  if (!ts) {
    return {
      mode: 'regex',
      extract(filePath, source) {
        return extractWithRegex(filePath, source);
      },
    };
  }

  return {
    mode: 'typescript',
    extract(filePath, source) {
      try {
        return extractWithTypescript(ts, filePath, source);
      } catch {
        return extractWithRegex(filePath, source);
      }
    },
  };
}

/** @deprecated use createExtractor from ./create-extractor.mjs */
export function createExtractor(root) {
  return createJsExtractor(root);
}

function tryLoadTypescript(root) {
  const candidates = [
    path.join(root, 'package.json'),
    path.join(root, 'node_modules', 'typescript', 'package.json'),
  ];
  for (const c of candidates) {
    try {
      return createRequire(c)('typescript');
    } catch {
      // try next
    }
  }
  try {
    return createRequire(import.meta.url)('typescript');
  } catch {
    return null;
  }
}

function lineOf(ts, sourceFile, pos) {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function extractWithTypescript(ts, filePath, source) {
  const scriptKind = filePath.endsWith('x')
    ? filePath.endsWith('.tsx')
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.JSX
    : filePath.endsWith('.ts')
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS;

  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
  const imports = [];
  const exports = [];
  const references = [];
  const importedLocals = new Map();

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const from = stmt.moduleSpecifier.text;
      const line = lineOf(ts, sf, stmt.getStart(sf));
      const clause = stmt.importClause;
      if (!clause) {
        imports.push({ from, imported: null, local: null, line, confidence: 'EXTRACTED' });
        continue;
      }
      if (clause.name) {
        const local = clause.name.text;
        imports.push({ from, imported: 'default', local, line, confidence: 'EXTRACTED' });
        importedLocals.set(local, { from, line });
      }
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          const local = clause.namedBindings.name.text;
          imports.push({ from, imported: '*', local, line, confidence: 'EXTRACTED' });
          importedLocals.set(local, { from, line });
        } else if (ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) {
            const imported = el.propertyName ? el.propertyName.text : el.name.text;
            const local = el.name.text;
            imports.push({ from, imported, local, line, confidence: 'EXTRACTED' });
            importedLocals.set(local, { from, line });
          }
        }
      }
    }

    if (ts.isExportDeclaration(stmt)) {
      const line = lineOf(ts, sf, stmt.getStart(sf));
      if (stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const from = stmt.moduleSpecifier.text;
        if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
          for (const el of stmt.exportClause.elements) {
            const name = el.name.text;
            imports.push({
              from,
              imported: el.propertyName ? el.propertyName.text : name,
              local: name,
              line,
              confidence: 'EXTRACTED',
            });
            exports.push({ name, kind: 'named', line, confidence: 'EXTRACTED' });
          }
        } else {
          imports.push({ from, imported: '*', local: null, line, confidence: 'EXTRACTED' });
        }
      } else if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          exports.push({
            name: el.name.text,
            kind: 'named',
            line,
            confidence: 'EXTRACTED',
          });
        }
      }
    }

    if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt)) {
      if (stmt.name && hasExportModifier(ts, stmt)) {
        exports.push({
          name: stmt.name.text,
          kind: 'named',
          line: lineOf(ts, sf, stmt.getStart(sf)),
          confidence: 'EXTRACTED',
        });
      }
    }

    if (ts.isVariableStatement(stmt) && hasExportModifier(ts, stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          exports.push({
            name: decl.name.text,
            kind: 'named',
            line: lineOf(ts, sf, decl.getStart(sf)),
            confidence: 'EXTRACTED',
          });
        }
      }
    }

    if (
      (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) &&
      hasExportModifier(ts, stmt)
    ) {
      exports.push({
        name: stmt.name.text,
        kind: 'named',
        line: lineOf(ts, sf, stmt.getStart(sf)),
        confidence: 'EXTRACTED',
      });
    }

    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      let name = 'default';
      if (ts.isIdentifier(stmt.expression)) name = stmt.expression.text;
      exports.push({
        name,
        kind: 'default',
        line: lineOf(ts, sf, stmt.getStart(sf)),
        confidence: 'EXTRACTED',
      });
    }
  }

  // Walk identifiers for imported local references
  function visit(node) {
    if (ts.isIdentifier(node)) {
      const name = node.text;
      const meta = importedLocals.get(name);
      if (meta) {
        const line = lineOf(ts, sf, node.getStart(sf));
        if (line !== meta.line) {
          references.push({ name, from: meta.from, line, confidence: 'EXTRACTED' });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  // Cap references per local
  const capped = [];
  const counts = new Map();
  for (const ref of references) {
    const n = counts.get(ref.name) || 0;
    if (n >= 8) continue;
    counts.set(ref.name, n + 1);
    capped.push(ref);
  }

  return { filePath, imports, exports, references: capped };
}

function hasExportModifier(ts, node) {
  return !!node.modifiers?.some(
    (m) => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword,
  );
}
