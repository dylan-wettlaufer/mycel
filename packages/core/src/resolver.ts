import type { ModuleResolver } from "./module-resolution.js";
import { posix } from "node:path";
import type { ParsedSymbol } from "@mycel/parser";
import type {
  Diagnostic,
  GraphEdge,
  Project,
  SourceRange,
} from "@mycel/shared";
import { hashIdentity } from "./hash.js";
import type { CapturedFile } from "./graph.js";

/** Resolve repository-relative TS/TSX modules, including emitted .js specifiers. */
export function resolveRelativeModule(
  from: string,
  specifier: string,
  paths: ReadonlySet<string>,
) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return;
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));
  if (base === ".." || base.startsWith("../") || posix.isAbsolute(base)) return;
  const stem = base.replace(/\.(js|jsx)$/, "");
  return [
    base,
    `${stem}.ts`,
    `${stem}.tsx`,
    `${stem}.d.ts`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.d.ts`,
  ].find((candidate) => paths.has(candidate));
}

interface Target {
  path: string;
  symbol: ParsedSymbol;
}

/** Conservative structural resolution: unknown/ambiguous targets produce no edge. */
export function resolveRelationships(
  project: Project,
  captured: readonly CapturedFile[],
  resolution?: ModuleResolver,
) {
  const files = new Map(
    captured.map((file) => [file.parsed.path, file.parsed]),
  );
  const paths = new Set(files.keys());
  const resolveModule = (
    from: string,
    specifier: string,
    _paths: ReadonlySet<string>,
  ) =>
    resolution?.resolve(from, specifier) ??
    resolveRelativeModule(from, specifier, paths);
  const edges = new Map<string, Omit<GraphEdge, "revision">>();
  const edgeSourceLines = new Map<string, Map<number, boolean>>();
  const diagnostics: Diagnostic[] = [];
  const nodeId = (localId: string) =>
    `node:${hashIdentity([project.id, localId])}`;
  function edge(
    kind: "IMPORTS" | "CALLS",
    source: string,
    target: string,
    line: number,
    typeOnly = false,
  ) {
    const sourceId = nodeId(source);
    const targetId = nodeId(target);
    const id = `edge:${hashIdentity([project.id, kind, sourceId, targetId])}`;
    edges.set(id, { id, projectId: project.id, kind, sourceId, targetId });
    const lines = edgeSourceLines.get(id);
    if (lines) lines.set(line, (lines.get(line) ?? true) && typeOnly);
    else edgeSourceLines.set(id, new Map([[line, typeOnly]]));
  }
  function diagnostic(
    path: string,
    range: SourceRange,
    code: string,
    message: string,
  ) {
    diagnostics.push({
      path,
      range,
      code,
      message,
      severity: "warning",
      source: "resolver",
    });
  }
  function unique(targets: Target[]): Target | undefined {
    const byId = new Map(targets.map((target) => [target.symbol.id, target]));
    return byId.size === 1 ? byId.values().next().value : undefined;
  }
  function local(
    path: string,
    name: string,
    seen: ReadonlySet<string>,
  ): Target | undefined {
    const file = files.get(path);
    if (!file) return;
    const symbols = file.symbols.filter(
      (s) => s.qualifiedName === name && s.parentId === file.fileId,
    );
    if (symbols.length)
      return unique(symbols.map((symbol) => ({ path, symbol })));
    const [bindingName, ...members] = name.split(".");
    for (const imported of file.imports) {
      if (imported.typeOnly) continue;
      const binding = imported.bindings.find(
        (b) => b.local === bindingName && !b.typeOnly,
      );
      const dependency = resolveModule(path, imported.specifier, paths);
      if (!binding || !dependency) continue;
      if (binding.kind === "namespace") {
        if (members.length)
          return exported(dependency, members.join("."), seen);
      } else {
        const target = exported(dependency, binding.imported, seen);
        return members.length ? member(target, members) : target;
      }
    }
  }
  function member(
    target: Target | undefined,
    names: string[],
  ): Target | undefined {
    if (!target || names.length !== 1 || target.symbol.kind !== "class") return;
    const candidates =
      files
        .get(target.path)
        ?.symbols.filter(
          (symbol) =>
            symbol.parentId === target.symbol.id &&
            symbol.name === names[0] &&
            symbol.isStatic &&
            symbol.methodKind !== "get" &&
            symbol.methodKind !== "set",
        ) ?? [];
    return unique(candidates.map((symbol) => ({ path: target.path, symbol })));
  }
  function exported(
    path: string,
    name: string,
    seen: ReadonlySet<string>,
  ): Target | undefined {
    const key = JSON.stringify([path, name]);
    if (seen.has(key)) return;
    const next = new Set(seen).add(key);
    const file = files.get(path);
    if (!file) return;
    const explicit = file.exports.filter(
      (item) => !item.typeOnly && item.name === name && item.kind !== "all",
    );
    const targets: Target[] = [];
    for (const item of explicit) {
      const dependency =
        item.specifier && resolveModule(path, item.specifier, paths);
      const target = dependency
        ? exported(dependency, item.localName ?? item.name, next)
        : !item.specifier
          ? local(path, item.localName ?? item.name, next)
          : undefined;
      if (target) targets.push(target);
    }
    if (explicit.length) return unique(targets);
    const [namespace, ...members] = name.split(".");
    if (members.length) {
      for (const item of file.exports) {
        if (
          item.typeOnly ||
          item.kind !== "namespace" ||
          item.name !== namespace ||
          !item.specifier
        )
          continue;
        const dependency = resolveModule(path, item.specifier, paths);
        const target =
          dependency && exported(dependency, members.join("."), next);
        if (target) targets.push(target);
      }
      const target = member(exported(path, namespace!, next), members);
      if (target) targets.push(target);
    }
    if (name !== "default")
      for (const item of file.exports) {
        if (item.typeOnly || item.kind !== "all" || !item.specifier) continue;
        const dependency = resolveModule(path, item.specifier, paths);
        const target = dependency && exported(dependency, name, next);
        if (target) targets.push(target);
      }
    return unique(targets);
  }
  function callTarget(
    path: string,
    callee: string,
    callerId?: string,
  ): Target | undefined {
    if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(callee)) return;
    const file = files.get(path)!;
    const caller = file.symbols.find((s) => s.id === callerId);
    if (
      callee.startsWith("this.") &&
      caller &&
      file.symbols.some((s) => s.id === caller.parentId && s.kind === "class")
    ) {
      const symbol = unique(
        file.symbols
          .filter(
            (s) =>
              s.parentId === caller.parentId &&
              s.name === callee.slice(5) &&
              s.isStatic === caller.isStatic &&
              s.methodKind !== "get" &&
              s.methodKind !== "set",
          )
          .map((symbol) => ({ path, symbol })),
      );
      return symbol;
    }
    const scope = caller?.qualifiedName.split(".") ?? [];
    while (scope.length) {
      const name = [...scope, callee].join(".");
      const candidates = file.symbols.filter((s) => s.qualifiedName === name);
      if (candidates.length)
        return unique(candidates.map((symbol) => ({ path, symbol })));
      scope.pop();
    }
    const target = local(path, callee, new Set());
    if (target) return target;
    const [name, ...members] = callee.split(".");
    return members.length
      ? member(local(path, name!, new Set()), members)
      : undefined;
  }
  for (const [path, file] of files) {
    for (const item of [
      ...file.imports,
      ...file.exports.filter((item) => item.specifier !== undefined),
    ]) {
      const specifier = item.specifier!;
      const dependency = resolveModule(path, specifier, paths);
      if (dependency)
        edge(
          "IMPORTS",
          file.fileId,
          files.get(dependency)!.fileId,
          item.range.startLine,
          item.typeOnly ||
            ("bindings" in item &&
              item.bindings.length > 0 &&
              item.bindings.every((binding) => binding.typeOnly)),
        );
      else if (
        specifier.startsWith(".") ||
        resolution?.isLocal(path, specifier)
      )
        diagnostic(
          path,
          item.range,
          "unresolved-module",
          `Could not resolve local module: ${specifier}`,
        );
    }
    for (const call of file.calls) {
      const target = callTarget(path, call.callee, call.callerId);
      if (target)
        edge(
          "CALLS",
          call.callerId ?? file.fileId,
          target.symbol.id,
          call.calleeRange.startLine,
        );
    }
  }
  return { edges: [...edges.values()], diagnostics, edgeSourceLines };
}
