import ts from "typescript";
import type { SemanticExtraction } from "@mycel/shared";
import type { SemanticContext } from "./context.js";
import { walkImplementation } from "./context.js";
import { runtimeReference } from "./bindings.js";
import { exportedCallable } from "./next.js";
import { semanticRecords } from "./records.js";

/** Directory names suggest a role; a resolved call is required to include it. */
export function extractServiceCandidates(
  context: SemanticContext,
  current: Readonly<SemanticExtraction>,
) {
  const records = semanticRecords(
    context.project.id,
    "service-candidates",
    "1",
    { kind: "heuristic", confidence: 0.65 },
  );
  const owners = new Set(
    current.entities
      .filter((entity) =>
        ["component", "page", "endpoint", "service_operation"].includes(
          entity.kind,
        ),
      )
      .flatMap((entity) => entity.sources.map((source) => source.nodeId)),
  );
  const pending = context.callables.filter((callable) =>
    owners.has(callable.anchor.id),
  );
  for (let index = 0; index < pending.length; index++) {
    const caller = pending[index]!;
    walkImplementation(caller.declaration, (node) => {
      if (!ts.isCallExpression(node) || node.questionDotToken) return;
      const reference = runtimeReference(context, node.expression);
      if (!reference) return;
      const target = context.target(
        ts.isPropertyAccessExpression(reference) ? reference.name : reference,
      );
      if (
        !target ||
        owners.has(target.anchor.id) ||
        !/(^|\/)services\//.test(target.anchor.path)
      )
        return;
      const module = context.checker.getSymbolAtLocation(target.source);
      const exports = module && context.checker.getExportsOfModule(module);
      if (
        !exports?.some(
          (symbol) =>
            exportedCallable(context, target.source, symbol.name) === target,
        )
      )
        return;
      records.entity(
        "service_operation",
        target.anchor.id,
        target.anchor.name,
        {
          nodeId: target.anchor.id,
          path: target.anchor.path,
          range: target.anchor.range,
        },
        "called-service-directory-function",
        { status: "candidate" },
      );
      owners.add(target.anchor.id);
      pending.push(target);
    });
  }
  return { entities: records.entities, relationships: records.relationships };
}
