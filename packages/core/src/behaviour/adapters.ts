import type ts from "typescript";
import type { SemanticContext } from "../semantic/context.js";
import type { BehaviourBindings, BehaviourCallable } from "./bindings.js";
import type { semanticRecords } from "../semantic/records.js";
import type { SemanticExtraction } from "@mycel/shared";

/** Each adapter owns recognition, evidence, and explicit unsupported boundaries. */
export interface BehaviourAdapterContext {
  context: SemanticContext;
  bindings: BehaviourBindings;
  graph: SemanticExtraction;
  records: ReturnType<typeof semanticRecords>;
  owner: BehaviourCallable;
  ownerId: string;
  step(
    category: string,
    name: string,
    node: ts.Node,
    attributes: Record<string, string>,
  ): string;
  boundary(from: string, node: ts.Node, code: string, message: string): void;
}
export type BehaviourCallAdapter = (
  call: ts.CallExpression,
  context: BehaviourAdapterContext,
) => boolean;
