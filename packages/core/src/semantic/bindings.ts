import ts from "typescript";
import type { SemanticContext } from "./context.js";

/** The shared runtime-reference subset: identifiers and imported namespace members. */
export function runtimeReference(
  context: SemanticContext,
  expression: ts.Node,
) {
  if (
    !ts.isIdentifier(expression) &&
    !ts.isPropertyAccessExpression(expression)
  )
    return;
  if (ts.isPropertyAccessExpression(expression)) {
    if (!ts.isIdentifier(expression.expression)) return;
    const declarations = context.checker.getSymbolAtLocation(
      expression.expression,
    )?.declarations;
    if (declarations?.length !== 1 || !ts.isNamespaceImport(declarations[0]!))
      return;
  }
  return context.runtimeBindingIsKnown(expression) ? expression : undefined;
}
