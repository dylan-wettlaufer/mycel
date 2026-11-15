import ts from "typescript";
import type { SemanticContext, Callable } from "./context.js";
import { walkImplementation } from "./context.js";
import { semanticRecords } from "./records.js";

function returnsJsx(expression: ts.Expression): boolean {
  if (
    ts.isJsxElement(expression) ||
    ts.isJsxSelfClosingElement(expression) ||
    ts.isJsxFragment(expression)
  )
    return true;
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  )
    return returnsJsx(expression.expression);
  if (ts.isConditionalExpression(expression))
    return returnsJsx(expression.whenTrue) || returnsJsx(expression.whenFalse);
  if (
    ts.isBinaryExpression(expression) &&
    [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(expression.operatorToken.kind)
  )
    return returnsJsx(expression.left) || returnsJsx(expression.right);
  return false;
}

export function jsxReturnExpressions(callable: Callable): ts.Expression[] {
  const expressions: ts.Expression[] = [];
  if (callable.body && !ts.isBlock(callable.body) && returnsJsx(callable.body))
    expressions.push(callable.body);
  walkImplementation(callable, (node) => {
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      returnsJsx(node.expression)
    )
      expressions.push(node.expression);
  });
  return expressions;
}

/** Syntactic React/TSX subset: named functions directly returning JSX. */
export function extractReact(context: SemanticContext) {
  const records = semanticRecords(context.project.id, "react-tsx", "1");
  for (const callable of context.callables) {
    if (
      !callable.source.fileName.endsWith(".tsx") ||
      !/^[A-Z]/.test(callable.anchor.name)
    )
      continue;
    if (jsxReturnExpressions(callable.declaration).length)
      records.entity(
        "component",
        callable.anchor.id,
        callable.anchor.name,
        {
          nodeId: callable.anchor.id,
          path: callable.anchor.path,
          range: callable.anchor.range,
        },
        "jsx-return",
      );
  }
  return { entities: records.entities, relationships: records.relationships };
}
