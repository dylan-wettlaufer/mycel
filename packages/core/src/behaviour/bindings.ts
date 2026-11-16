import ts from "typescript";
import type { SemanticContext, Callable } from "../semantic/context.js";
import { runtimeReference } from "../semantic/bindings.js";

export interface BehaviourCallable {
  declaration: Callable;
  source: ts.SourceFile;
  anchor: SemanticContext["nodes"][number];
}

/** Include inline callbacks using existing Tree-sitter symbols, never synthetic anchors. */
export function behaviourBindings(context: SemanticContext) {
  const functions: BehaviourCallable[] = [...context.callables];
  const byDeclaration = new Map(
    functions.map((item) => [item.declaration, item]),
  );
  const writes = new Set<ts.Symbol>();
  function visit(node: ts.Node) {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node)) &&
      node.body &&
      !byDeclaration.has(node)
    ) {
      const anchor = context.anchor(node);
      if (
        anchor?.kind === "function" &&
        anchor.range.start === node.getStart()
      ) {
        const item = {
          declaration: node,
          source: node.getSourceFile(),
          anchor,
        };
        functions.push(item);
        byDeclaration.set(node, item);
      }
    }
    let left: ts.Node | undefined;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    )
      left = node.left;
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(
        node.operator,
      )
    )
      left = node.operand;
    function mark(target: ts.Node) {
      if (ts.isIdentifier(target)) {
        const symbol = context.checker.getSymbolAtLocation(target);
        if (symbol) writes.add(symbol);
      } else if (
        ts.isPropertyAccessExpression(target) ||
        ts.isElementAccessExpression(target)
      )
        mark(target.expression);
      else if (ts.isParenthesizedExpression(target)) mark(target.expression);
      else if (ts.isArrayLiteralExpression(target))
        target.elements.forEach(mark);
      else if (ts.isObjectLiteralExpression(target))
        for (const property of target.properties) {
          if (ts.isShorthandPropertyAssignment(property)) mark(property.name);
          else if (ts.isPropertyAssignment(property))
            mark(property.initializer);
          else if (ts.isSpreadAssignment(property)) mark(property.expression);
        }
      else if (ts.isSpreadElement(target)) mark(target.expression);
    }
    if (left) mark(left);
    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      if (!ts.isVariableDeclarationList(node.initializer))
        mark(node.initializer);
    }
    ts.forEachChild(node, visit);
  }
  for (const source of context.sourceFiles.values()) visit(source);
  function declaration(
    node: ts.Node,
    seen = new Set<ts.Symbol>(),
  ): ts.Declaration | undefined {
    if (!context.runtimeBindingIsKnown(node)) return;
    const raw = context.checker.getSymbolAtLocation(node);
    const symbol = context.symbolAt(node);
    if (
      !symbol ||
      writes.has(symbol) ||
      (raw && writes.has(raw)) ||
      seen.has(symbol) ||
      symbol.declarations?.length !== 1
    )
      return;
    seen.add(symbol);
    const item = symbol.declarations[0]!;
    if (
      ts.isVariableDeclaration(item) &&
      item.initializer &&
      ts.isIdentifier(item.initializer) &&
      ts.isVariableDeclarationList(item.parent) &&
      item.parent.flags & ts.NodeFlags.Const
    )
      return declaration(item.initializer, seen);
    return item;
  }
  function target(expression: ts.Node): BehaviourCallable | undefined {
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression))
      return byDeclaration.get(expression);
    const reference = runtimeReference(context, expression);
    if (!reference) return;
    const item = declaration(
      ts.isPropertyAccessExpression(reference) ? reference.name : reference,
    );
    if (!item) return;
    const named = context.callables.find(
      (callable) => callable.binding === item,
    );
    return named ?? byDeclaration.get(item as Callable);
  }
  return { functions, target, declaration, byDeclaration };
}
export type BehaviourBindings = ReturnType<typeof behaviourBindings>;
