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
    description: string;
  } {
    const { attributes, name } = entity;
    const targets = [...(outgoing.get(entity.id) ?? [])].flatMap((id) => {
      const target = entities.get(id);
      return target && target.attributes.traceRole !== "unresolved"
        ? [target]
        : [];
    });
    if (entity.kind === "endpoint") {
      const services = new Set<SemanticEntity>();
      for (const handler of targets) {
        for (const target of outgoing.get(handler.id) ?? []) {
          const candidate = entities.get(target);
          if (candidate && isService(candidate)) services.add(candidate);
        }
      }
      const [service] = services;
      const serviceName = services.size === 1 ? service?.name : undefined;
      const resource = attributes.pattern
        ?.split("/")
        .filter(
          (part) => /^[\p{L}][\p{L}\p{N}_-]*$/u.test(part) && part !== "api",
        )
        .at(-1);
      const action = attributes.method && requestActions[attributes.method];
      const request =
        attributes.method && attributes.pattern
          ? `${attributes.method} requests to ${attributes.pattern}`
          : "incoming HTTP requests";
      return {
        title:
          (serviceName && words(serviceName)) ||
          (action && resource
            ? `${action} ${words(resource)}`
            : "Handle API Request"),
        kind: "endpoint",
        description: `Handles ${request}${serviceName ? ` and calls ${serviceName}` : ""}.`,
      };
    }
    if (entity.kind === "data_model")
      return {
        title: `${words(name)} Data`,
        kind: "model",
        description:
          attributes.provider === "prisma"
            ? `The ${name} model declared in the Prisma schema.`
            : `The ${name} data model referenced in this trace.`,
      };

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
          description:
            attributes.binding === "resolved" && targets.length === 1
              ? `Binds ${name} to ${targets[0]!.name}.`
              : `Records the ${name} event binding in JSX.`,
        };
      }
      case "http_request": {
        const { method, url, client } = attributes;
        return {
          title: method ? `Send ${method} Request` : "Send HTTP Request",
          kind: "request",
          description: `Makes ${method ? `a ${method}` : "an HTTP"} request${url ? ` to ${url}` : ""}${client ? ` using ${client}` : ""}.`,
        };
      }
      case "prisma_operation": {
        const action = dataActions[attributes.operation ?? ""];
        return {
          title:
            action && attributes.model
              ? `${action} ${words(attributes.model)} ${attributes.operation === "findMany" ? "Records" : "Record"}`
              : "Access Data",
          kind: "data",
          description:
            attributes.operation && attributes.model
              ? `Runs Prisma’s ${attributes.operation} on the ${attributes.model} model.`
              : "A data operation recorded in this trace.",
        };
      }
      case "unresolved":
        return {
          title: "Unresolved Step",
          kind: "unresolved",
          description: "Mycel could not follow this step from source.",
        };
      default: {
        const handler = entity.provenance.rule === "http-handler-operation";
        const calls = [...new Set(targets.map((target) => target.name))];
        return {
          title: handler
            ? `Handle ${name} Request`
            : words(name) || "Run Function",
          kind: isService(entity) ? "service" : "function",
          description:
            calls.length === 1
              ? `Calls ${calls[0]}.`
              : handler
                ? `The exported ${name} request handler.`
                : "A function reached by this behaviour trace.",
        };
      }
    }
  }

  return new Map(
    Array.from(entities.values(), (entity) => [entity.id, describe(entity)]),
  );
}
