import type {
  BehaviourHop,
  BehaviourPath,
  BehaviourTrace,
  SemanticEntity,
  SemanticRelationshipKind,
} from "@mycel/shared";
import { expect, test } from "vitest";
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

function role(
  id: string,
  attributes: Record<string, string>,
  rule = "trace",
): SemanticEntity {
  return { ...entity(id), attributes, provenance: { ...provenance, rule } };
}

function orders(readFirst = false) {
  const write = ["submit", "post", "handler", "service", "write", "order"];
  const read = ["submit", "get", "order"];
  const kinds: Partial<Record<string, SemanticRelationshipKind>> = {
    handler: "HANDLES",
    order: "WRITES",
  };
  return trace(
    [
      role("submit", { traceRole: "ui_event", event: "onSubmit" }),
      entity("post", "endpoint"),
      entity("get", "endpoint"),
      role("handler", { traceRole: "callable" }, "http-handler-operation"),
      role(
        "service",
        { traceRole: "callable" },
        "called-service-directory-function",
      ),
      role("write", { traceRole: "prisma_operation", operation: "create" }),
      entity("order", "data_model"),
    ],
    (readFirst ? [read, write] : [write, read]).map((entityIds) => ({
      entityIds,
      hops: entityIds
        .slice(1)
        .map((id, index) => hop(entityIds[index]!, id, kinds[id])),
      end: "data-access",
    })),
  );
}

type Box = { x: number; y: number; width: number; height: number };

function crossesCard(
  graph: ReturnType<typeof layoutBehaviour>,
  edge: (typeof graph.edges)[number],
) {
  const { source, target, bends } = edge.data.route;
  const points = [source, ...bends, target];
  const cards: Box[] = graph.nodes
    .filter(({ id }) => id !== edge.source && id !== edge.target)
    .map(({ position, style }) => ({
      ...position,
      width: Number(style?.width),
      height: Number(style?.height),
    }));
  return points.slice(1).some((end, index) => {
    const start = points[index]!;
    return cards.some(
      (card) =>
        Math.max(start.x, end.x) > card.x &&
        Math.min(start.x, end.x) < card.x + card.width &&
        Math.max(start.y, end.y) > card.y &&
        Math.min(start.y, end.y) < card.y + card.height,
    );
  });
}

/** Approximate rendered size of a short label such as "3 steps" or "writes". */
function labelHidden(
  graph: ReturnType<typeof layoutBehaviour>,
  edge: (typeof graph.edges)[number],
) {
  const { x, y } = edge.data.route.label;
  const [halfWidth, halfHeight] = [36, 11];
  return graph.nodes.some(
    ({ position, style }) =>
      x + halfWidth > position.x &&
      x - halfWidth < position.x + Number(style?.width) &&
      y + halfHeight > position.y &&
      y - halfHeight < position.y + Number(style?.height),
  );
}

function contains(layer: Box, card: Box) {
  return (
    card.x >= layer.x &&
    card.y >= layer.y &&
    card.x + card.width <= layer.x + layer.width &&
    card.y + card.height <= layer.y + layer.height
  );
}

function box(node: {
  position: { x: number; y: number };
  style?: { width?: unknown; height?: unknown } | undefined;
}): Box {
  return {
    ...node.position,
    width: Number(node.style?.width),
    height: Number(node.style?.height),
  };
}

test("operations are grouped into layers derived from their source roles", () => {
  const collapsed = layoutBehaviour([orders()]);
  expect(collapsed.layers.map(({ id }) => id)).toEqual([
    "layer:interface",
    "layer:api",
    "layer:data",
  ]);
  const expanded = layoutBehaviour([orders()], new Set(["post"]));
  expect(Object.fromEntries(expanded.layerOf)).toMatchObject({
    submit: "interface",
    post: "api",
    get: "api",
    handler: "api",
    service: "service",
    write: "data",
    order: "data",
  });
  expect(expanded.layers.map(({ id, data }) => [id, data.count])).toEqual([
    ["layer:interface", 1],
    ["layer:api", 3],
    ["layer:service", 1],
    ["layer:data", 2],
  ]);
  for (const graph of [collapsed, expanded]) {
    for (const layer of graph.layers) {
      const members = graph.nodes.filter(
        ({ id }) => `layer:${graph.layerOf.get(id)}` === layer.id,
      );
      expect(members.every((node) => contains(box(layer), box(node)))).toBe(
        true,
      );
    }
  }
});

test("functions and requests join the layer of the code that calls them", () => {
  const entities = [
    role("submit", { traceRole: "ui_event", event: "onSubmit" }),
    entity("helper"),
    role("request", { traceRole: "http_request", method: "POST" }),
    entity("api", "endpoint"),
  ];
  const ids = ["submit", "helper", "request", "api"];
  const input = trace(entities, [
    {
      entityIds: ids,
      hops: ids.slice(1).map((id, index) => hop(ids[index]!, id)),
      end: "no-supported-calls",
    },
  ]);
  const orphan = {
    ...trace(
      [entity("orphan"), entity("api", "endpoint")],
      [
        {
          entityIds: ["orphan", "api"],
          hops: [hop("orphan", "api")],
          end: "no-supported-calls",
        },
      ],
    ),
    rootId: "orphan",
  };
  const graph = layoutBehaviour([input, orphan], new Set(["submit"]));
  expect(Object.fromEntries(graph.layerOf)).toEqual({
    submit: "interface",
    helper: "interface",
    request: "interface",
    api: "api",
    orphan: "logic",
  });
  expect(graph.steps.get("submit")).toBe(2);
  expect(layoutBehaviour([input, orphan]).edges[0]).toMatchObject({
    source: "submit",
    target: "api",
    label: "2 steps",
    data: {
      description: "Submit Form → Handle API Request: connects via 2 steps",
    },
  });
});

test("layers read left to right and revealed steps stack inside their layer", () => {
  const collapsed = layoutBehaviour([orders()]);
  const at = (graph: typeof collapsed, id: string) =>
    graph.nodes.find((node) => node.id === id)!;
  expect(at(collapsed, "post").position.x).toBe(
    at(collapsed, "get").position.x,
  );
  expect(at(collapsed, "post").position.x).toBeGreaterThan(
    at(collapsed, "submit").position.x,
  );
  expect(at(collapsed, "order").position.x).toBeGreaterThan(
    at(collapsed, "post").position.x,
  );
  expect(
    collapsed.edges.map(({ sourceHandle, targetHandle }) => [
      sourceHandle,
      targetHandle,
    ]),
  ).toEqual(
    Array(collapsed.edges.length).fill(["source-right", "target-left"]),
  );

  const expanded = layoutBehaviour([orders()], new Set(["post"]));
  const post = at(expanded, "post");
  const handler = at(expanded, "handler");
  expect(handler.position.x).toBe(post.position.x);
  expect(handler.position.y).toBeGreaterThan(post.position.y);
  expect(
    expanded.edges.find(({ target }) => target === "handler"),
  ).toMatchObject({
    sourceHandle: "source-bottom",
    targetHandle: "target-top",
  });
  expect(at(expanded, "service").position.y).toBe(handler.position.y);

  const vertical = layoutBehaviour([orders()], new Set(["post"]), "TB");
  const rows = ["submit", "post", "service", "order"].map(
    (id) => at(vertical, id).position.y,
  );
  expect(rows).toEqual([...new Set(rows)].sort((a, b) => a - b));
  expect(
    vertical.edges.find(({ target }) => target === "post")?.sourceHandle,
  ).toBe("source-bottom");

  const readFirst = layoutBehaviour([orders(true)], new Set(["post"]));
  expect(
    readFirst.edges.find(
      ({ source, target }) => source === "write" && target === "order",
    ),
  ).toMatchObject({
    sourceHandle: "source-bottom",
    targetHandle: "target-top",
  });

  for (const graph of [collapsed, expanded, vertical, readFirst]) {
    expect(graph.nodes.every(({ draggable }) => draggable === false)).toBe(
      true,
    );
    for (const edge of graph.edges) {
      expect(crossesCard(graph, edge)).toBe(false);
      expect(labelHidden(graph, edge)).toBe(false);
    }
  }
});
