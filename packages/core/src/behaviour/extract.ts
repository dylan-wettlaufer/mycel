import ts from "typescript";
import type { SemanticExtraction, SemanticSource } from "@mycel/shared";
import type { SemanticContext } from "../semantic/context.js";
import { walkImplementation } from "../semantic/context.js";
import { jsxReturnExpressions } from "../semantic/react.js";
import { semanticRecords } from "../semantic/records.js";
import { behaviourBindings } from "./bindings.js";
import { extractFetch } from "./http.js";
import { extractPrisma } from "./prisma.js";
import type { BehaviourCallable } from "./bindings.js";

/** All function steps are operations; traceRole avoids claiming a business-service role. */
export function extractBehaviour(
  context: SemanticContext,
  current: SemanticExtraction,
) {
  const records = semanticRecords(
    context.project.id,
    "behaviour-bindings",
    "1",
  );
  const bindings = behaviourBindings(context);
  const operations = new Map<ts.Node, string>();
  const serverActions = new Set<ts.Node>();
  function directive(statements: readonly ts.Statement[]) {
    for (const statement of statements) {
      if (
        !ts.isExpressionStatement(statement) ||
        !ts.isStringLiteral(statement.expression)
      )
        break;
      if (statement.expression.text === "use server") return statement;
    }
  }
  for (const fn of bindings.functions) {
    const unsupported =
      directive(fn.source.statements) ??
      (fn.declaration.body && ts.isBlock(fn.declaration.body)
        ? directive(fn.declaration.body.statements)
        : undefined);
    const attributes: Record<string, string> = {
      traceRole: unsupported ? "unresolved" : "callable",
      callableNodeId: fn.anchor.id,
    };
    if (unsupported) {
      serverActions.add(fn.declaration);
      attributes.code = "unsupported-server-action";
      attributes.message =
        "Server Actions and use server modules are outside the supported React/fetch/App Router path.";
    }
    const sources = [
      { nodeId: fn.anchor.id, path: fn.anchor.path, range: fn.anchor.range },
      ...(unsupported ? [context.evidence(unsupported)] : []),
    ];
    const existing = current.entities.find(
      (entity) =>
        entity.kind === "service_operation" &&
        entity.sources.some((source) => source.nodeId === fn.anchor.id),
    );
    if (existing) {
      Object.assign(existing.attributes, attributes);
      if (unsupported) existing.sources.push(context.evidence(unsupported));
      operations.set(fn.declaration, existing.id);
    } else {
      let id = "";
      for (const source of sources)
        id = records.entity(
          "service_operation",
          fn.anchor.id,
          fn.anchor.name,
          source,
          "source-callable",
          attributes,
        );
      operations.set(fn.declaration, id);
    }
  }
  const op = (fn: BehaviourCallable) => operations.get(fn.declaration)!;
  function call(
    from: string,
    to: string,
    evidence: SemanticSource,
    rule: string,
  ) {
    records.relationship("CALLS", from, to, evidence, rule);
  }
  const counts = new Map<string, number>();
  function step(
    fn: BehaviourCallable,
    category: string,
    name: string,
    evidence: SemanticSource,
    attributes: Record<string, string>,
  ) {
    const key = `${fn.anchor.id}:${category}`;
    const ordinal = (counts.get(key) ?? 0) + 1;
    counts.set(key, ordinal);
    return records.entity(
      "service_operation",
      `${key}:${ordinal}`,
      name,
      evidence,
      category,
      attributes,
    );
  }
  function boundary(
    fn: BehaviourCallable,
    from: string,
    node: ts.Node,
    code: string,
    message: string,
  ) {
    const evidence = context.evidence(node, fn.anchor);
    const id = step(
      fn,
      "unresolved-call",
      node.getText().slice(0, 160),
      evidence,
      { traceRole: "unresolved", code, message },
    );
    call(from, id, evidence, "unresolved-boundary");
  }
  const eventHandlers = new Set<ts.Node>();
  for (const fn of bindings.functions) {
    if (serverActions.has(fn.declaration)) continue;
    const roots = jsxReturnExpressions(fn.declaration);
    walkImplementation(fn.declaration, (node) => {
      if (
        !ts.isJsxAttribute(node) ||
        !["onSubmit", "onClick"].includes(node.name.getText()) ||
        !roots.some((root) => node.pos >= root.pos && node.end <= root.end)
      )
        return;
      const opening = node.parent.parent;
      if (
        !ts.isJsxOpeningElement(opening) &&
        !ts.isJsxSelfClosingElement(opening)
      )
        return;
      const tag = opening.tagName.getText();
      const evidence = context.evidence(node, fn.anchor);
      const attributes = {
        traceRole: "ui_event",
        event: node.name.getText(),
        element: tag,
        binding: "unresolved",
      };
      const event = step(
        fn,
        "jsx-event",
        `${tag}.${node.name.getText()}`,
        evidence,
        attributes,
      );
      call(op(fn), event, evidence, "jsx-event-binding");
      if (
        node.parent.properties.some((property) =>
          ts.isJsxSpreadAttribute(property),
        ) ||
        node.parent.properties.filter(
          (property) =>
            ts.isJsxAttribute(property) &&
            property.name.getText() === node.name.getText(),
        ).length !== 1
      ) {
        boundary(
          fn,
          event,
          node,
          "ambiguous-event-props",
          "JSX spreads or duplicate event attributes can replace the handler; their values are not inferred.",
        );
        return;
      }
      const expression =
        node.initializer && ts.isJsxExpression(node.initializer)
          ? node.initializer.expression
          : undefined;
      if (
        !/^[a-z]/.test(tag) ||
        (node.name.getText() === "onSubmit" && tag !== "form")
      ) {
        boundary(
          fn,
          event,
          node,
          "unsupported-event-prop",
          "Only intrinsic DOM onClick and form onSubmit bindings are supported.",
        );
        return;
      }
      const handler = expression && bindings.target(expression);
      if (!handler) {
        boundary(
          fn,
          event,
          node,
          "unresolved-event-handler",
          "The event handler is dynamic, ambiguous, or produced by an unsupported wrapper.",
        );
        return;
      }
      attributes.binding = serverActions.has(handler.declaration)
        ? "unresolved"
        : "resolved";
      eventHandlers.add(handler.declaration);
      call(event, op(handler), evidence, "event-handler-binding");
    });
  }
  function intrinsic(fn: BehaviourCallable, expression: ts.Expression) {
    if (
      !ts.isPropertyAccessExpression(expression) ||
      !ts.isIdentifier(expression.expression)
    )
      return false;
    const base = expression.expression;
    if (
      [
        "JSON",
        "Math",
        "Object",
        "Array",
        "Number",
        "String",
        "Boolean",
        "Response",
        "console",
      ].includes(base.text) &&
      !context.checker
        .getSymbolAtLocation(base)
        ?.declarations?.some((declaration) =>
          context.sourceFiles.has(declaration.getSourceFile().fileName),
        )
    )
      return true;
    const first = fn.declaration.parameters[0]?.name;
    const isHandler = current.relationships.some(
      (edge) => edge.kind === "HANDLES" && edge.sourceId === op(fn),
    );
    if (
      isHandler &&
      first &&
      ts.isIdentifier(first) &&
      first.text === base.text &&
      ["json", "text", "formData", "arrayBuffer", "blob", "bytes"].includes(
        expression.name.text,
      )
    )
      return true;
    return (
      eventHandlers.has(fn.declaration) &&
      first &&
      ts.isIdentifier(first) &&
      first.text === base.text &&
      ["preventDefault", "stopPropagation"].includes(expression.name.text)
    );
  }
  for (const fn of bindings.functions) {
    if (serverActions.has(fn.declaration)) continue;
    walkImplementation(fn.declaration, (node) => {
      if (!ts.isCallExpression(node) || intrinsic(fn, node.expression)) return;
      const adapterContext = {
        context,
        bindings,
        graph: current,
        records,
        owner: fn,
        ownerId: op(fn),
        step: (
          category: string,
          name: string,
          callNode: ts.Node,
          attributes: Record<string, string>,
        ) =>
          step(
            fn,
            category,
            name,
            context.evidence(callNode, fn.anchor),
            attributes,
          ),
        boundary: (
          from: string,
          callNode: ts.Node,
          code: string,
          message: string,
        ) => boundary(fn, from, callNode, code, message),
      };
      if (
        extractFetch(node, adapterContext) ||
        extractPrisma(node, adapterContext)
      )
        return;
      const target = !node.questionDotToken && bindings.target(node.expression);
      if (target)
        call(
          op(fn),
          op(target),
          context.evidence(node, fn.anchor),
          "lexical-call",
        );
      else
        boundary(
          fn,
          op(fn),
          node,
          "unresolved-call",
          "No unique supported callable target; dynamic dispatch, mutable/ambiguous bindings, and external wrappers are not followed.",
        );
    });
  }
  return { entities: records.entities, relationships: records.relationships };
}
