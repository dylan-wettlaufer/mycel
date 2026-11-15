import { posix } from "node:path";
import ts from "typescript";
import type { SemanticExtraction } from "@mycel/shared";
import type { SemanticContext, SemanticCallable } from "./context.js";
import { semanticRecords } from "./records.js";

const methods = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

export function exportedCallable(
  context: SemanticContext,
  source: ts.SourceFile,
  name: string,
): SemanticCallable | undefined {
  if (!context.runtimeBindingIsKnown(source)) return;
  const parsed = context.files.find(
    (file) => file.parsed.path === source.fileName,
  )?.parsed;
  if (!parsed?.exports.some((item) => item.name === name && !item.typeOnly))
    return;
  const module = context.checker.getSymbolAtLocation(source);
  let symbol =
    module &&
    context.checker
      .getExportsOfModule(module)
      .find((item) => item.name === name);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias)
    symbol = context.checker.getAliasedSymbol(symbol);
  if (symbol?.declarations?.length !== 1) return;
  return context.callables.find(
    (callable) =>
      callable.source === source &&
      callable.binding === symbol.declarations![0],
  );
}

/** Root app/ or src/app/, normal/group/dynamic segments; no slots or interception. */
export function nextRouteLocation(context: SemanticContext, path: string) {
  const root = context.resolution?.dependencyRoot?.(path, "next");
  if (root === undefined) return;
  const app = posix.join(root, "app");
  const sourceApp = posix.join(root, "src/app");
  const directory = [...context.sourceFiles.keys()].some((file) =>
    file.startsWith(`${app}/`),
  )
    ? app
    : sourceApp;
  if (!path.startsWith(`${directory}/`)) return;
  const segments = posix
    .relative(directory, posix.dirname(path))
    .split("/")
    .filter(Boolean);
  const url: string[] = [];
  for (const segment of segments) {
    if (
      segment.startsWith("_") ||
      segment.startsWith("@") ||
      /^\(\./.test(segment)
    )
      return;
    if (/^\([^().]+\)$/.test(segment)) continue;
    if (
      !/^(?:[A-Za-z0-9_-]+|\[[A-Za-z0-9_-]+\]|\[\.\.\.[A-Za-z0-9_-]+\]|\[\[\.\.\.[A-Za-z0-9_-]+\]\])$/.test(
        segment,
      )
    )
      return;
    url.push(segment);
  }
  return {
    pattern: `/${url.join("/")}`,
    directory,
    packageRoot: root,
    segments,
    groups: segments
      .filter((segment) => segment.startsWith("("))
      .map((segment) => segment.slice(1, -1)),
    publicSegments: url,
  };
}

export function extractNext(
  context: SemanticContext,
  current: Readonly<SemanticExtraction>,
) {
  const records = semanticRecords(context.project.id, "next-app-router", "1");
  const candidates = [...context.sourceFiles.values()].flatMap((source) => {
    const name = posix.basename(source.fileName);
    if (name !== "page.tsx" && name !== "route.ts" && name !== "layout.tsx")
      return [];
    const route = nextRouteLocation(context, source.fileName);
    return route ? [{ source, name, ...route }] : [];
  });
  for (const candidate of candidates) {
    const { source, name, pattern, directory } = candidate;
    // Duplicate public paths are invalid Next applications; do not pick an owner.
    if (
      name !== "layout.tsx" &&
      candidates.some(
        (other) =>
          other !== candidate &&
          other.name !== "layout.tsx" &&
          other.directory === directory &&
          other.pattern === pattern,
      )
    )
      continue;
    if (name === "layout.tsx") {
      const callable = exportedCallable(context, source, "default");
      if (
        !callable ||
        current.entities.some(
          (entity) =>
            entity.kind === "component" &&
            entity.sources.some(
              (source) => source.nodeId === callable.anchor.id,
            ),
        )
      )
        continue;
      records.entity(
        "component",
        callable.anchor.id,
        callable.anchor.name,
        {
          nodeId: callable.anchor.id,
          path: callable.anchor.path,
          range: callable.anchor.range,
        },
        "default-layout-export",
        { nextRole: "layout" },
      );
    } else if (name === "page.tsx") {
      const callable = exportedCallable(context, source, "default");
      if (!callable) continue;
      const evidence = {
        nodeId: callable.anchor.id,
        path: callable.anchor.path,
        range: callable.anchor.range,
      };
      const page = records.entity(
        "page",
        callable.anchor.id,
        callable.anchor.name,
        evidence,
        "default-page-export",
        { route: pattern },
      );
      const route = records.entity(
        "route",
        source.fileName,
        pattern,
        evidence,
        "page-file-convention",
        { pattern },
      );
      records.relationship(
        "RENDERS",
        route,
        page,
        evidence,
        "default-page-export",
      );
    } else {
      for (const method of methods) {
        const callable = exportedCallable(context, source, method);
        if (!callable) continue;
        const evidence = {
          nodeId: callable.anchor.id,
          path: callable.anchor.path,
          range: callable.anchor.range,
        };
        const endpoint = records.entity(
          "endpoint",
          `${source.fileName}:${method}`,
          `${method} ${pattern}`,
          evidence,
          "http-method-export",
          { method, pattern },
        );
        const operation = records.entity(
          "service_operation",
          callable.anchor.id,
          callable.anchor.name,
          evidence,
          "http-handler-operation",
        );
        records.relationship(
          "HANDLES",
          operation,
          endpoint,
          evidence,
          "http-method-export",
        );
      }
    }
  }
  return { entities: records.entities, relationships: records.relationships };
}
