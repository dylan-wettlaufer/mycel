import { posix } from "node:path";
import ts from "typescript";
import type {
  GraphNode,
  Project,
  SemanticSource,
  SourceRange,
} from "@mycel/shared";
import type { CapturedFile } from "../graph.js";
import type { ModuleResolver } from "../module-resolution.js";
import { resolveRelativeModule } from "../resolver.js";

export interface SemanticInput {
  project: Project;
  files: readonly CapturedFile[];
  nodes: readonly Omit<GraphNode, "revision">[];
  resolution?: ModuleResolver;
}
export type Callable =
  ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
export interface SemanticCallable {
  declaration: Callable;
  binding: ts.FunctionDeclaration | ts.VariableDeclaration;
  source: ts.SourceFile;
  anchor: Omit<GraphNode, "revision">;
}

/** Additional semantic binding over captured text only; no disk or package execution. */
export function createSemanticContext(input: SemanticInput) {
  const files = input.files.filter((file) => file.parsed.language !== "python");
  const paths = new Set(files.map((file) => file.parsed.path));
  const captured = new Map(files.map((file) => [file.parsed.path, file]));
  const sourceFiles = new Map(
    files
      .filter((file) => file.parsed.status === "parsed")
      .map((file) => [
        file.parsed.path,
        ts.createSourceFile(
          file.parsed.path,
          file.source,
          ts.ScriptTarget.Latest,
          true,
          file.parsed.language === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        ),
      ]),
  );
  const resolve = (from: string, specifier: string) =>
    input.resolution?.resolve(from, specifier) ??
    resolveRelativeModule(from, specifier, paths);
  const normalize = (path: string) => posix.normalize(path).replace(/^\//, "");
  const program = ts.createProgram(
    [...sourceFiles.keys()],
    {
      noLib: true,
      noEmit: true,
      types: [],
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.Latest,
    },
    {
      getSourceFile: (path) => sourceFiles.get(normalize(path)),
      getDefaultLibFileName: () => "",
      writeFile: () => {},
      getCurrentDirectory: () => "/",
      getDirectories: () => [],
      fileExists: (path) => sourceFiles.has(normalize(path)),
      readFile: (path) => captured.get(normalize(path))?.source,
      getCanonicalFileName: normalize,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => "\n",
      resolveModuleNames: (names, from) =>
        names.map((name) => {
          const target = resolve(normalize(from), name);
          return target && sourceFiles.has(target)
            ? { resolvedFileName: target }
            : undefined;
        }),
    },
  );
  const checker = program.getTypeChecker();
  const callables: SemanticCallable[] = [];
  function anchor(declaration: ts.Node, name?: string) {
    const source = declaration.getSourceFile();
    return input.nodes
      .filter(
        (node) =>
          node.path === source.fileName &&
          node.kind !== "file" &&
          (name === undefined || node.name === name) &&
          node.range.start <= declaration.end &&
          node.range.end === declaration.end &&
          node.range.end > declaration.getStart(source),
      )
      .sort((a, b) => b.range.start - a.range.start)[0];
  }
  function visit(node: ts.Node) {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)
    ) {
      let outer: ts.Node = node;
      while (
        ts.isParenthesizedExpression(outer.parent) ||
        ts.isAsExpression(outer.parent) ||
        ts.isSatisfiesExpression(outer.parent)
      )
        outer = outer.parent;
      const binding = ts.isFunctionDeclaration(node)
        ? node
        : ts.isVariableDeclaration(outer.parent)
          ? outer.parent
          : undefined;
      if (binding) {
        const name =
          binding.name && ts.isIdentifier(binding.name)
            ? binding.name.text
            : ts.isFunctionDeclaration(binding)
              ? "default"
              : undefined;
        const structural = name && anchor(binding, name);
        if (structural && structural.kind === "function" && node.body)
          callables.push({
            declaration: node,
            binding,
            source: node.getSourceFile(),
            anchor: structural,
          });
      }
    }
    ts.forEachChild(node, visit);
  }
  for (const source of sourceFiles.values()) visit(source);
  let invalidModules: Set<string> | undefined;
  let invalidReferences: readonly ts.Diagnostic[] = [];
  function runtimeBindingIsKnown(node: ts.Node): boolean {
    if (!invalidModules) {
      // TypeScript may choose the first candidate for an invalid star export. Do
      // not turn that recovery choice or a type-only alias into a runtime fact.
      const diagnostics = program.getSemanticDiagnostics();
      invalidReferences = diagnostics.filter((diagnostic) =>
        [1361, 1362, 2693].includes(diagnostic.code),
      );
      invalidModules = new Set(
        diagnostics
          .filter((diagnostic) => diagnostic.code === 2308 && diagnostic.file)
          .map((diagnostic) => diagnostic.file!.fileName),
      );
      let changed = true;
      while (changed) {
        changed = false;
        for (const file of files) {
          if (invalidModules.has(file.parsed.path)) continue;
          const dependencies = [...file.parsed.imports, ...file.parsed.exports];
          if (
            dependencies.some(
              (item) =>
                item.specifier &&
                invalidModules!.has(
                  resolve(file.parsed.path, item.specifier) ?? "",
                ),
            )
          ) {
            invalidModules.add(file.parsed.path);
            changed = true;
          }
        }
      }
    }
    if (invalidModules.has(node.getSourceFile().fileName)) return false;
    return !invalidReferences.some(
      (diagnostic) =>
        diagnostic.file === node.getSourceFile() &&
        diagnostic.start !== undefined &&
        diagnostic.start < node.end &&
        diagnostic.start + (diagnostic.length ?? 1) > node.getStart(),
    );
  }
  function symbolAt(node: ts.Node): ts.Symbol | undefined {
    if (!runtimeBindingIsKnown(node)) return;
    let symbol = checker.getSymbolAtLocation(node);
    const seen = new Set<ts.Symbol>();
    while (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      if (seen.has(symbol)) return;
      seen.add(symbol);
      symbol = checker.getAliasedSymbol(symbol);
    }
    return symbol;
  }
  function target(node: ts.Node) {
    const declarations = symbolAt(node)?.declarations;
    if (!declarations || declarations.length !== 1) return;
    return callables.find((item) => item.binding === declarations[0]);
  }
  function evidence(
    node: ts.Node,
    structural?: Omit<GraphNode, "revision">,
  ): SemanticSource {
    const source = node.getSourceFile();
    const file = input.nodes.find(
      (item) => item.path === source.fileName && item.kind === "file",
    );
    if (!file) throw new Error(`Missing structural file: ${source.fileName}`);
    return {
      nodeId: structural?.id ?? file.id,
      path: source.fileName,
      range: rangeOf(node),
    };
  }
  return {
    ...input,
    sourceFiles,
    checker,
    callables,
    anchor,
    symbolAt,
    runtimeBindingIsKnown,
    target,
    evidence,
    resolve,
  };
}
export type SemanticContext = ReturnType<typeof createSemanticContext>;

export function rangeOf(node: ts.Node): SourceRange {
  const source = node.getSourceFile();
  const start = node.getStart(source);
  const first = source.getLineAndCharacterOfPosition(start);
  const last = source.getLineAndCharacterOfPosition(node.end);
  return {
    start,
    end: node.end,
    startLine: first.line + 1,
    startColumn: first.character + 1,
    endLine: last.line + 1,
    endColumn: last.character + 1,
  };
}

/** Nested closures are separate owners; their execution is not established by syntax. */
export function walkImplementation(
  callable: Callable,
  visit: (node: ts.Node) => void,
) {
  function walk(node: ts.Node) {
    if (ts.isFunctionLike(node)) return;
    visit(node);
    ts.forEachChild(node, walk);
  }
  if (callable.body) walk(callable.body);
}
