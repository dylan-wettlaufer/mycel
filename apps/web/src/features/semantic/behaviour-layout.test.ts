import type {
  BehaviourHop,
  BehaviourPath,
  BehaviourTrace,
  SemanticEntity,
  SemanticRelationshipKind,
} from "@mycel/shared";
import { expect, test } from "vitest";
import { layoutBehaviour } from "./behaviour-layout";

const context = { projectId: "project", revision: 1 };
const provenance = {
  kind: "deterministic",
  confidence: 1,
  extractor: "test",
  version: "1",
  rule: "trace",
} as const;

function entity(
  id: string,
  kind: SemanticEntity["kind"] = "service_operation",
): SemanticEntity {
  return {
    ...context,
    id,
    name: id,
    kind,
    attributes: {},
    sources: [],
    provenance,
  };
}

function hop(
  fromId: string,
  toId: string,
  kind: SemanticRelationshipKind = "CALLS",
): BehaviourHop {
  return {
    fromId,
    toId,
    relationship: {
      ...context,
      id: `${kind}:${fromId}:${toId}`,
      sourceId: kind === "HANDLES" ? toId : fromId,
      targetId: kind === "HANDLES" ? fromId : toId,
      kind,
      sources: [],
      provenance,
    },
  };
}

function trace(
  entities: SemanticEntity[],
  paths: BehaviourPath[],
): BehaviourTrace {
  return {
    ...context,
    rootId: "submit",
    direction: "forward",
    entities,
    paths,
    truncated: false,
  };
}

test("condensed connections retain distinct paths and use the trace direction for handlers", () => {
  const service = (id: string): SemanticEntity => ({
    ...entity(id),
    attributes: { traceRole: "callable" },
    provenance: { ...provenance, rule: "called-service-directory-function" },
  });
  const entities = [
    entity("submit"),
    entity("dispatch"),
    {
      ...entity("api", "endpoint"),
      name: "POST /api/orders",
      attributes: { method: "POST", pattern: "/api/orders" },
    },
    entity("handler"),
    service("read"),
    service("write"),
    entity("order", "data_model"),
  ];
  const toApi = [hop("submit", "dispatch"), hop("dispatch", "api")];
  const handles = hop("api", "handler", "HANDLES");
  const read = [handles, hop("handler", "read"), hop("read", "order", "READS")];
  const write = [
    handles,
    hop("handler", "write"),
    hop("write", "order", "WRITES"),
  ];
  const input = trace(entities, [
    {
      entityIds: ["submit", "dispatch", "api", "handler", "read", "order"],
      hops: [...toApi, ...read],
      end: "data-access",
    },
    {
      entityIds: ["submit", "dispatch", "api", "handler", "write", "order"],
      hops: [...toApi, ...write],
      end: "data-access",
    },
  ]);
  const compact = layoutBehaviour([input], false);
  expect(compact.nodes.map(({ id }) => id)).toEqual(["submit", "api", "order"]);
  expect(compact.nodes.find(({ id }) => id === "api")?.data).toMatchObject({
    label: "Post to Orders",
    name: "POST /api/orders",
    operationKind: "endpoint",
  });
  expect(compact.edges).toMatchObject([
    { source: "submit", target: "api", data: { paths: [toApi] } },
    {
      source: "api",
      target: "order",
      label: "reads / writes",
      data: { paths: [read, write] },
    },
  ]);
  const expanded = layoutBehaviour([input], true);
  expect(
    expanded.edges.filter(({ label }) => label === "handled by"),
  ).toMatchObject([{ source: "api", target: "handler" }]);
});

test("cycle steps remain visible and terminal evidence stays on the affected node", () => {
  const input = trace(
    ["submit", "a", "b", "dynamic"].map((id) => entity(id)),
    [
      {
        entityIds: ["submit", "a", "b", "a"],
        hops: [hop("submit", "a"), hop("a", "b"), hop("b", "a")],
        end: "cycle",
      },
      {
        entityIds: ["submit", "dynamic"],
        hops: [hop("submit", "dynamic")],
        end: "unresolved",
        boundary: { code: "dynamic-call", message: "The target is dynamic." },
      },
    ],
  );
  const result = layoutBehaviour([input], false);
  expect(result.edges.map(({ source, target }) => [source, target])).toEqual([
    ["submit", "a"],
    ["a", "b"],
    ["b", "a"],
    ["submit", "dynamic"],
  ]);
  expect([...result.notices.get("dynamic")!]).toEqual([
    "The target is dynamic.",
  ]);
});
