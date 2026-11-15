import ts from "typescript";
import type { SemanticExtraction } from "@mycel/shared";
import type { SemanticContext } from "./context.js";
import { walkImplementation } from "./context.js";
import { jsxReturnExpressions } from "./react.js";
import { semanticRecords } from "./records.js";

/** Bind only direct lexical calls and JSX names; runtime member dispatch stays unknown. */
export function extractReferences(
  context: SemanticContext,
  declarations: SemanticExtraction,
) {
  const records = semanticRecords(
    context.project.id,
    "typescript-references",
    "1",
  );
  const externalBindings = new Map<ts.Declaration, string>();
  for (const source of context.sourceFiles.values()) {
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      )
        continue;
      const specifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (
        clause?.isTypeOnly ||
        specifier.startsWith(".") ||
        specifier.startsWith("/") ||
        context.resolve(source.fileName, specifier) ||
        context.resolution?.isLocal(source.fileName, specifier)
      )
        continue;
      // A package/module reference, not a claim that the dependency is installed.
      if (
        !/^(?:node:|@?[A-Za-z0-9_])/.test(specifier) ||
        specifier.startsWith("#")
      )
        continue;
      const id = records.entity(
        "external_dependency",
        specifier,
        specifier,
        context.evidence(statement),
        "external-import",
        { specifier },
      );
      if (clause?.name) externalBindings.set(clause, id);
      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings))
          externalBindings.set(clause.namedBindings, id);
        else
          for (const binding of clause.namedBindings.elements)
            if (!binding.isTypeOnly) externalBindings.set(binding, id);
      }
    }
  }
  const byNode = new Map<string, SemanticExtraction["entities"]>();
  for (const entity of declarations.entities) {
    if (
      !["component", "page", "service_operation", "endpoint"].includes(
        entity.kind,
      )
    )
      continue;
    for (const source of entity.sources) {
      const list = byNode.get(source.nodeId) ?? [];
      if (!list.some((item) => item.id === entity.id)) list.push(entity);
      byNode.set(source.nodeId, list);
    }
  }
  function externalTarget(expression: ts.Node) {
    let base = expression;
    if (ts.isPropertyAccessExpression(expression)) base = expression.expression;
    if (!ts.isIdentifier(base)) return;
    const symbol = context.checker.getSymbolAtLocation(base);
    if (symbol?.declarations?.length !== 1) return;
    return externalBindings.get(symbol.declarations[0]!);
  }
  for (const callable of context.callables) {
    const owners = byNode.get(callable.anchor.id);
    if (!owners) continue;
    const jsxRoots = jsxReturnExpressions(callable.declaration);
    walkImplementation(callable.declaration, (node) => {
      let expression: ts.Node | undefined;
      let kind: "CALLS" | "RENDERS";
      if (ts.isCallExpression(node) && !node.questionDotToken) {
        expression = node.expression;
        kind = "CALLS";
      } else if (
        ts.isJsxOpeningElement(node) ||
        ts.isJsxSelfClosingElement(node)
      ) {
        if (
          !jsxRoots.some((root) => node.pos >= root.pos && node.end <= root.end)
        )
          return;
        expression = node.tagName;
        kind = "RENDERS";
      } else return;
      if (
        !ts.isIdentifier(expression) &&
        !ts.isPropertyAccessExpression(expression)
      )
        return;
      // Property calls are supported only for imported namespaces, never instances.
      if (ts.isPropertyAccessExpression(expression)) {
        if (!ts.isIdentifier(expression.expression)) return;
        const declaration = context.checker.getSymbolAtLocation(
          expression.expression,
        )?.declarations;
        if (declaration?.length !== 1 || !ts.isNamespaceImport(declaration[0]!))
          return;
      }
      const evidence = context.evidence(node, callable.anchor);
      const external = externalTarget(expression);
      if (external) {
        for (const owner of owners)
          records.relationship(
            "DEPENDS_ON",
            owner.id,
            external,
            evidence,
            "external-binding-use",
          );
        return;
      }
      // Lowercase JSX names are host elements even when a lexical binding exists.
      if (
        kind === "RENDERS" &&
        ts.isIdentifier(expression) &&
        !/^[A-Z]/.test(expression.text)
      )
        return;
      const target = context.target(
        ts.isPropertyAccessExpression(expression)
          ? expression.name
          : expression,
      );
      if (!target) return;
      const targets = (byNode.get(target.anchor.id) ?? []).filter((item) =>
        kind === "RENDERS"
          ? item.kind === "component" || item.kind === "page"
          : item.kind === "service_operation",
      );
      for (const owner of owners)
        for (const destination of targets)
          records.relationship(
            kind,
            owner.id,
            destination.id,
            evidence,
            kind === "CALLS" ? "lexical-call" : "jsx-binding",
          );
    });
  }
  return { entities: records.entities, relationships: records.relationships };
}
