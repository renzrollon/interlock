import path from 'node:path';
import { createJsExtractor } from './typescript.mjs';
import { extractPython } from './python.mjs';
import { extractShell } from './shell.mjs';
import { extractConfigJson } from './config-json.mjs';
import { extractCsharp, extractMsbuildProject } from './csharp.mjs';

/**
 * Language-dispatching extractor. JS/TS uses typescript AST when available.
 */
export function createExtractor(root) {
  const js = createJsExtractor(root);
  const modes = new Set([js.mode]);

  return {
    get mode() {
      return [...modes].sort().join('+');
    },
    extract(filePath, source) {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.py' || ext === '.pyi') {
        modes.add('python');
        return extractPython(filePath, source);
      }
      if (ext === '.sh' || ext === '.bash') {
        modes.add('shell');
        return extractShell(filePath, source);
      }
      if (ext === '.cs') {
        modes.add('csharp');
        return extractCsharp(filePath, source);
      }
      if (ext === '.csproj' || ext === '.vbproj' || ext === '.fsproj') {
        modes.add('msbuild');
        return extractMsbuildProject(filePath, source);
      }
      if (ext === '.json') {
        modes.add('json');
        return extractConfigJson(filePath, source);
      }
      return js.extract(filePath, source);
    },
  };
}
