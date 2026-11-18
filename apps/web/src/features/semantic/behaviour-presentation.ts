import type { BehaviourPath, SemanticEntity } from "@mycel/shared";
import type { OperationKind } from "@/features/graph/graph-node";

function words(name: string) {
  return name
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .replace(/[._$-]+/g, " ")
    .trim()
    .replace(/(^|\s)\p{Ll}/gu, (initial) => initial.toUpperCase());
}

function isService(entity: SemanticEntity) {
  return (
    entity.attributes.traceRole === "callable" &&
    ["service-annotation", "called-service-directory-function"].includes(
      entity.provenance.rule,
    )
  );
}

const dataActions: Record<string, string> = {
  findMany: "Read",
  findUnique: "Find",
  create: "Create",
  update: "Update",
  delete: "Delete",
};

const requestActions: Record<string, string> = {
  GET: "Get",
  POST: "Post to",
  PUT: "Put",
  PATCH: "Patch",
  DELETE: "Delete",
};

export function describeBehaviour(
  entities: Map<string, SemanticEntity>,
  paths: BehaviourPath[],
  members: SemanticEntity[],
) {
  const components = new Map<string, string>();
  for (const member of members) {
    if (member.kind === "component")
      for (const source of member.sources)
        components.set(source.nodeId, member.name);
  }

  const outgoing = new Map<string, Set<string>>();
  for (const path of paths) {
    for (const { fromId, toId, relationship } of path.hops) {
      if (relationship.kind !== "CALLS" && relationship.kind !== "HANDLES")
        continue;
      const targets = outgoing.get(fromId) ?? new Set<string>();
      targets.add(toId);
      outgoing.set(fromId, targets);
    }
  }

  function describe(entity: SemanticEntity): {
    title: string;
    kind: OperationKind;
  } {
    const { attributes, name } = entity;
    if (entity.kind === "endpoint") {
      const services = new Set<SemanticEntity>();
      for (const handler of outgoing.get(entity.id) ?? []) {
        for (const target of outgoing.get(handler) ?? []) {
          const candidate = entities.get(target);
          if (candidate && isService(candidate)) services.add(candidate);
        }
      }
      const [service] = services;
      if (services.size === 1 && service) {
        const title = words(service.name);
        if (title) return { title, kind: "endpoint" };
      }
      const resource = attributes.pattern
        ?.split("/")
        .filter(
          (part) => /^[\p{L}][\p{L}\p{N}_-]*$/u.test(part) && part !== "api",
        )
        .at(-1);
      const action = attributes.method && requestActions[attributes.method];
      return {
        title:
          action && resource
            ? `${action} ${words(resource)}`
            : "Handle API Request",
        kind: "endpoint",
      };
    }
    if (entity.kind === "data_model")
      return { title: `${words(name)} Data`, kind: "model" };

    switch (attributes.traceRole) {
      case "ui_event": {
        const owner = entity.sources
          .map(({ nodeId }) => components.get(nodeId))
          .find(Boolean);
        const subject = owner?.match(/^(.+)Form$/)?.[1];
        return {
          title:
            attributes.event === "onSubmit"
              ? `Submit ${subject ? words(subject) : "Form"}`
              : `Click ${words(attributes.element ?? "") || "Element"}`,
          kind: "event",
        };
      }
      case "http_request":
        return {
          title: attributes.method
            ? `Send ${attributes.method} Request`
            : "Send HTTP Request",
          kind: "request",
        };
      case "prisma_operation": {
        const action = dataActions[attributes.operation ?? ""];
        return {
          title:
            action && attributes.model
              ? `${action} ${words(attributes.model)} ${attributes.operation === "findMany" ? "Records" : "Record"}`
              : "Access Data",
          kind: "data",
        };
      }
      case "unresolved":
        return { title: "Unresolved Step", kind: "unresolved" };
      default:
        if (entity.provenance.rule === "http-handler-operation")
          return { title: `Handle ${name} Request`, kind: "function" };
        return {
          title: words(name) || "Run Function",
          kind: isService(entity) ? "service" : "function",
        };
    }
  }

  return new Map(
    Array.from(entities.values(), (entity) => [entity.id, describe(entity)]),
  );
}
