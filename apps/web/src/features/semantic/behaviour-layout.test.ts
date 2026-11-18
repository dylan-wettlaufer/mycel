import type {
  BehaviourHop,
  BehaviourPath,
  BehaviourTrace,
  SemanticEntity,
  SemanticRelationshipKind,
} from "@mycel/shared";
import { expect, test } from "vitest";
import { Position } from "@xyflow/react";
import { getBehaviourDetails } from "./behaviour-details-data";
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
  const compact = layoutBehaviour([input]);
  expect(compact.nodes.map(({ id }) => id)).toEqual(["submit", "api", "order"]);
  expect(compact.nodes.find(({ id }) => id === "api")?.data).toMatchObject({
    label: "Post to Orders",
    name: "POST /api/orders",
    operationKind: "endpoint",
  });
  expect(compact.presentation.get("api")?.description).toBe(
    "Handles POST requests to /api/orders.",
  );
  expect(compact.edges).toMatchObject([
    { source: "submit", target: "api", data: { paths: [toApi] } },
    {
      source: "api",
      target: "order",
      label: "reads / writes",
      data: { paths: [read, write] },
    },
  ]);
  expect([...compact.expandable]).toEqual(["submit", "api"]);
  expect(getBehaviourDetails(compact, "api", [])?.groups).toEqual([
    {
      title: "Called from / triggered by",
      connections: [
        { id: "submit", labels: new Set(["Connects via 1 step"]) },
        { id: "dispatch", labels: new Set(["Calls"]), revealFrom: "submit" },
      ],
    },
    {
      title: "Calls / connects to",
      connections: [
        { id: "handler", labels: new Set(["Handled by"]), revealFrom: "api" },
      ],
    },
    {
      title: "Reads or writes",
      connections: [
        {
          id: "order",
          labels: new Set(["Reads via 2 steps", "Writes via 2 steps"]),
        },
      ],
    },
  ]);
  expect(getBehaviourDetails(compact, "order", [])?.groups.at(-1)).toEqual({
    title: "Reads or writes",
    connections: [
      {
        id: "api",
        labels: new Set([
          "Reads from this model via 2 steps",
          "Writes to this model via 2 steps",
        ]),
      },
      {
        id: "read",
        labels: new Set(["Reads from this model"]),
        revealFrom: "api",
      },
      {
        id: "write",
        labels: new Set(["Writes to this model"]),
        revealFrom: "api",
      },
    ],
  });
  const expanded = layoutBehaviour([input], new Set(["api"]));
  expect(expanded.nodes.map(({ id }) => id)).toEqual([
    "submit",
    "api",
    "order",
    "handler",
    "read",
    "write",
  ]);
  expect(expanded.edges[0]).toMatchObject({
    source: "submit",
    target: "api",
    data: { paths: [toApi] },
  });
  expect(
    expanded.edges.filter(({ label }) => label === "handled by"),
  ).toMatchObject([
    { source: "api", target: "handler", data: { paths: [[handles]] } },
  ]);
  const expandedGroups = getBehaviourDetails(expanded, "api", [])?.groups;
  expect(expandedGroups?.[1]?.connections).toEqual([
    { id: "handler", labels: new Set(["Handled by"]) },
  ]);
  expect(expandedGroups?.[2]).toEqual(
    getBehaviourDetails(compact, "api", [])?.groups[2],
  );
});

test("independent regions keep shared operations visible while any expanded region uses them", () => {
  const sharedRead = hop("load", "order", "READS");
  const postToLoad = hop("post", "load");
  const getToLoad = hop("get", "load");
  const input = trace(
    [
      entity("submit"),
      entity("post", "endpoint"),
      entity("get", "endpoint"),
      entity("load"),
      entity("order", "data_model"),
    ],
    [
      {
        entityIds: ["submit", "post", "load", "order"],
        hops: [hop("submit", "post"), postToLoad, sharedRead],
        end: "data-access",
      },
      {
        entityIds: ["submit", "get", "load", "order"],
        hops: [hop("submit", "get"), getToLoad, sharedRead],
        end: "data-access",
      },
    ],
  );
  const both = layoutBehaviour([input], new Set(["post", "get"]));
  expect(both.nodes.filter(({ id }) => id === "load")).toHaveLength(1);
  expect(both.edges.filter(({ source }) => source === "load")).toMatchObject([
    { target: "order", data: { paths: [[sharedRead]] } },
  ]);

  const one = layoutBehaviour([input], new Set(["get"]));
  const ranks = new Map(one.nodes.map(({ id, position }) => [id, position.x]));
  expect(ranks.get("post")).toEqual(ranks.get("get"));
  expect(one.nodes.some(({ id }) => id === "load")).toBe(true);
  expect(one.edges.find(({ source }) => source === "post")).toMatchObject({
    target: "order",
    data: { paths: [[postToLoad, sharedRead]] },
  });
  expect(one.edges.find(({ source }) => source === "get")).toMatchObject({
    target: "load",
    data: { paths: [[getToLoad]] },
  });
  expect(layoutBehaviour([input]).nodes.some(({ id }) => id === "load")).toBe(
    false,
  );
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
  const result = layoutBehaviour([input]);
  expect(result.edges.map(({ source, target }) => [source, target])).toEqual([
    ["submit", "a"],
    ["a", "b"],
    ["b", "a"],
    ["submit", "dynamic"],
  ]);
  expect([...result.notices.get("dynamic")!]).toEqual([
    "The target is dynamic.",
  ]);
  expect(result.edges.find(({ target }) => target === "dynamic")).toMatchObject(
    {
      label: "unresolved",
      className: "graph-edge-uncertain",
      style: { strokeDasharray: "2 5" },
    },
  );
});

test("wide graphs lay out shallow branches horizontally and layer deep traces vertically", () => {
  const write = ["submit", "post", "handler", "service", "write", "order"];
  const read = ["submit", "get", "order"];
  const result = trace(
    [
      entity("submit"),
      entity("post", "endpoint"),
      entity("get", "endpoint"),
      entity("handler"),
      entity("service"),
      entity("write"),
      entity("order", "data_model"),
    ],
    [write, read].map((entityIds) => ({
      entityIds,
      hops: entityIds.slice(1).map((id, index) => hop(entityIds[index]!, id)),
      end: "data-access",
    })),
  );

  const collapsed = layoutBehaviour([result]);
  expect(
    collapsed.nodes.every((node) => node.sourcePosition === Position.Right),
  ).toBe(true);
  const branches = collapsed.nodes
    .filter(({ id }) => id === "get" || id === "post")
    .sort((a, b) => a.position.y - b.position.y);
  const [upper, lower] = branches;
  expect(
    lower!.position.y - upper!.position.y - Number(upper!.style?.height),
  ).toBeGreaterThanOrEqual(60);
  expect(
    collapsed.edges.find(
      ({ source, target }) => source === "post" && target === "order",
    )?.style,
  ).toEqual({ strokeDasharray: "7 4" });

  const expanded = layoutBehaviour([result], new Set(["post"]));
  const nodes = new Map(expanded.nodes.map((node) => [node.id, node]));
  expect(
    expanded.nodes.every((node) => node.sourcePosition === Position.Bottom),
  ).toBe(true);
  expect(nodes.get("post")?.position.y).toBe(nodes.get("get")?.position.y);
  const rows = write.map((id) => nodes.get(id)!.position.y);
  expect(rows).toEqual([...new Set(rows)].sort((a, b) => a - b));
  const post = nodes.get("post")!;
  const handler = nodes.get("handler")!;
  expect(
    handler.position.y - post.position.y - Number(post.style?.height),
  ).toBeGreaterThanOrEqual(72);
  const shortcut = expanded.edges.find(
    ({ source, target }) => source === "get" && target === "order",
  );
  expect(shortcut?.data.route.bends.length).toBeGreaterThan(1);
  expect(shortcut?.data.route.source.y).toBeLessThan(
    shortcut!.data.route.target.y,
  );
  expect(shortcut?.data.route.label.y).toBeGreaterThan(
    shortcut!.data.route.source.y,
  );
});
