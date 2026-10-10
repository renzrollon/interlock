import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before } from 'node:test';
import { buildGraph } from '../../lib/graph/graph/build.mjs';
import { consumers } from '../../lib/graph/graph/query.mjs';
import { walkSourceFiles } from '../../lib/graph/extract/walk.mjs';
import { blankCommentsAndStrings, extractCsharp, extractMsbuildProject } from '../../lib/graph/extract/csharp.mjs';

function writeTree(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
}

const relAll = (root) => walkSourceFiles(root).map((f) => path.relative(root, f).split(path.sep).join('/'));

describe('C# extractor', () => {
  it('reads namespaces, usings, type declarations and test methods', () => {
    const src = [
      'using System;',
      'global using Acme.Core;',
      'using static Acme.Core.Guard;',
      'using Alias = Acme.Core.Models;',
      'namespace Acme.Billing;',
      '',
      'public sealed partial class InvoiceService : IInvoiceService',
      '{',
      '    public record struct Line(int Qty);',
      '    foreach (var record in records) { }',
      '    void M<T>() where T : class { }',
      '}',
      'internal interface IInvoiceService { }',
      'public enum InvoiceState { Open, Paid }',
      'public class InvoiceTests',
      '{',
      '    [Fact]',
      '    public void Totals_add_up() { }',
      '',
      '    [Theory]',
      '    [InlineData(1)]',
      '    public async Task Rejects_negative<T>(int n) { }',
      '}',
    ].join('\n');
    const r = extractCsharp('src/Billing/InvoiceService.cs', src);
    assert.deepEqual(r.csharp.namespaces, ['Acme.Billing']);
    assert.deepEqual(r.csharp.usings.map((u) => u.name), ['System', 'Acme.Core', 'Acme.Core.Guard', 'Acme.Core.Models']);
    assert.deepEqual(r.csharp.globalUsings.map((u) => u.name), ['Acme.Core']);
    assert.equal(r.csharp.usings[2].static, true);
    assert.equal(r.csharp.usings[3].alias, 'Alias');
    const types = r.exports.filter((e) => e.kind !== 'test').map((e) => `${e.kind}:${e.name}@${e.line}`);
    assert.deepEqual(types, [
      'class:InvoiceService@7',
      'struct:Line@9',
      'interface:IInvoiceService@13',
      'enum:InvoiceState@14',
      'class:InvoiceTests@15',
    ]);
    const tests = r.exports.filter((e) => e.kind === 'test').map((e) => `${e.name}@${e.line}`);
    assert.deepEqual(tests, ['Totals_add_up@18', 'Rejects_negative@22']);
  });

  it('ignores declarations inside comments and string literals', () => {
    const src = [
      '// class CommentedOut {}',
      '/* interface Blocked {} */',
      'var a = "class InString {}";',
      'var b = @"class ""Verbatim"" {}";',
      'var c = """',
      'class RawString {}',
      '""";',
      "var d = '\"';",
      'public class Real { }',
    ].join('\n');
    const r = extractCsharp('a.cs', src);
    assert.deepEqual(r.exports.map((e) => `${e.name}@${e.line}`), ['Real@9']);
    assert.equal(blankCommentsAndStrings(src).split('\n').length, src.split('\n').length);
  });

  it('reads <ProjectReference> with Windows separators', () => {
    const r = extractMsbuildProject('src/App/App.csproj', [
      '<Project Sdk="Microsoft.NET.Sdk">',
      '  <ItemGroup>',
      '    <ProjectReference Include="..\\Core\\Core.csproj" />',
      "    <ProjectReference Include='../Legacy/Legacy.vbproj'>",
      '    </ProjectReference>',
      '  </ItemGroup>',
      '</Project>',
    ].join('\n'));
    assert.deepEqual(r.imports.map((i) => `${i.from}@${i.line}`), ['../Core/Core.csproj@3', '../Legacy/Legacy.vbproj@4']);
  });
});

describe('build over a .NET solution', () => {
  let tmp;
  let graph;
  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'interlock-dotnet-'));
    writeTree(tmp, {
      'src/Core/Core.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>\n',
      'src/Core/Invoice.cs': 'namespace Acme.Core;\npublic class Invoice { }\npublic class Constants { }\n',
      'src/Other/Other.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>\n',
      'src/Other/Constants.cs': 'namespace Acme.Other\n{\n    public static class Constants { }\n}\n',
      'src/App/App.csproj':
        '<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup>\n    <ProjectReference Include="..\\Core\\Core.csproj" />\n    <ProjectReference Include="..\\Gone\\Gone.csproj" />\n  </ItemGroup>\n</Project>\n',
      'src/App/Billing.cs':
        'using System.Linq;\nusing Acme.Core;\nnamespace Acme.App;\npublic class Billing\n{\n    Invoice Next() => new Invoice();\n    int X = Constants.Max;\n}\n',
      'src/App/obj/Debug/App.AssemblyInfo.cs': 'public class Generated { }\n',
      'src/App/bin/Debug/Leftover.cs': 'public class Leftover { }\n',
      'tests/App.Tests/App.Tests.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>\n',
      'tests/App.Tests/Usings.cs': 'global using Acme.Core;\n',
      'tests/App.Tests/InvoiceTests.cs':
        'namespace Acme.Tests;\npublic class InvoiceTests\n{\n    [Fact]\n    public void Creates_an_invoice() { var i = new Invoice(); }\n}\n',
      'tools/bin/run.js': "import { x } from './x.js';\n",
      'tools/bin/x.js': 'export const x = 1;\n',
    });
    graph = buildGraph(tmp).graph;
  });

  it('skips bin/ and obj/ beside a .NET project, and keeps bin/ elsewhere', () => {
    const files = relAll(tmp);
    assert.ok(!files.some((f) => f.includes('/obj/') || f.includes('src/App/bin/')), files.join('\n'));
    assert.ok(files.includes('tools/bin/run.js'));
  });

  it('links project references and keeps a missing one as unresolved', () => {
    const refs = graph.links.filter((e) => e.source === 'file:src/App/App.csproj' && e.relation === 'imports');
    assert.deepEqual(refs.map((e) => e.target).sort(), ['file:src/Core/Core.csproj', 'unresolved:src/Gone/Gone.csproj']);
  });

  it('turns using directives into namespace or external imports', () => {
    const imports = graph.links.filter((e) => e.source === 'file:src/App/Billing.cs' && e.relation === 'imports');
    assert.deepEqual(imports.map((e) => e.target).sort(), ['external:System.Linq', 'namespace:Acme.Core']);
    assert.ok(graph.nodes.some((n) => n.id === 'namespace:Acme.Core' && n.type === 'namespace'));
  });

  it('resolves type references through using scope only', () => {
    const refs = graph.links
      .filter((e) => e.source === 'file:src/App/Billing.cs' && e.relation === 'references')
      .map((e) => e.target)
      .sort();
    // Acme.Other.Constants is not in scope for Billing.cs, so it is not linked.
    assert.deepEqual(refs, ['symbol:src/Core/Invoice.cs#Constants', 'symbol:src/Core/Invoice.cs#Invoice']);
  });

  it('answers which tests touch a type, through a project global using', () => {
    const out = consumers(graph, 'Invoice');
    assert.match(out, /consumer_file: tests\/App\.Tests\/InvoiceTests\.cs/);
    assert.match(out, /consumer_file: src\/App\/Billing\.cs/);
    assert.ok(graph.nodes.some((n) => n.id === 'symbol:tests/App.Tests/InvoiceTests.cs#Creates_an_invoice' && n.kind === 'test'));
  });
});

describe('gitignore patterns', () => {
  it('honours **/ prefixes, root anchors and character classes', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'interlock-ignore-'));
    writeTree(tmp, {
      '.gitignore': '**/out\n/rootonly.js\n[Gg]enerated/\n',
      'a/out/x.js': 'export const x = 1;\n',
      'rootonly.js': 'export const r = 1;\n',
      'b/rootonly.js': 'export const r = 2;\n',
      'c/Generated/g.js': 'export const g = 1;\n',
      'c/generated/h.js': 'export const h = 1;\n',
      'c/keep.js': 'export const k = 1;\n',
    });
    assert.deepEqual(relAll(tmp), ['b/rootonly.js', 'c/keep.js']);
  });
});
