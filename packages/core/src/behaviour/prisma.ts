import ts from "typescript";
import type { BehaviourCallAdapter } from "./adapters.js";

const operations = new Map([
  ["findUnique", "READS"],
  ["findMany", "READS"],
  ["create", "WRITES"],
  ["update", "WRITES"],
  ["delete", "WRITES"],
] as const);

export const extractPrisma: BehaviourCallAdapter = (call, adapter) => {
  const { context, bindings, owner, ownerId, records } = adapter;
  const method = call.expression;
  if (
    !ts.isPropertyAccessExpression(method) ||
    !ts.isPropertyAccessExpression(method.expression)
  )
    return false;
  const delegate = method.expression;
  const client = bindings.declaration(delegate.expression);
  if (
    !client ||
    !ts.isVariableDeclaration(client) ||
    !client.initializer ||
    !ts.isNewExpression(client.initializer) ||
    !ts.isVariableDeclarationList(client.parent) ||
    !(client.parent.flags & ts.NodeFlags.Const)
  )
    return false;
  const constructor = client.initializer.expression;
  if (
    !ts.isIdentifier(constructor) ||
    !context.runtimeBindingIsKnown(constructor)
  )
    return false;
  const imported =
    context.checker.getSymbolAtLocation(constructor)?.declarations;
  if (
    imported?.length !== 1 ||
    !ts.isImportSpecifier(imported[0]!) ||
    imported[0]!.isTypeOnly ||
    (imported[0]!.propertyName ?? imported[0]!.name).text !== "PrismaClient"
  )
    return false;
  const statement = imported[0]!.parent.parent.parent;
  if (
    !ts.isImportDeclaration(statement) ||
    statement.importClause?.isTypeOnly ||
    !ts.isStringLiteral(statement.moduleSpecifier) ||
    statement.moduleSpecifier.text !== "@prisma/client"
  )
    return false;
  if (
    context.resolve(client.getSourceFile().fileName, "@prisma/client") ||
    context.resolution?.isLocal(
      client.getSourceFile().fileName,
      "@prisma/client",
    )
  )
    return false;
  const schema = context.resolution?.prismaSchema?.(
    client.getSourceFile().fileName,
  );
  if (!schema || schema.status === "unresolved") {
    adapter.boundary(
      ownerId,
      call,
      schema?.code ?? "unresolved-prisma-schema",
      schema?.message ?? "No verified Prisma schema was captured.",
    );
    return true;
  }
  const model = schema.models.find(
    (item) => item.delegate === delegate.name.text,
  );
  const access = operations.get(
    method.name.text as
      "findUnique" | "findMany" | "create" | "update" | "delete",
  );
  if (
    !model ||
    !access ||
    call.questionDotToken ||
    method.questionDotToken ||
    delegate.questionDotToken
  ) {
    adapter.boundary(
      ownerId,
      call,
      "unsupported-prisma-operation",
      "Model delegate and operation must resolve to a captured model and a supported CRUD method.",
    );
    return true;
  }
  let complex = false;
  function inspect(node: ts.Node) {
    if (
      ts.isSpreadAssignment(node) ||
      ts.isComputedPropertyName(node) ||
      (ts.isPropertyAssignment(node) &&
        [
          "include",
          "create",
          "createMany",
          "update",
          "upsert",
          "delete",
          "connect",
          "connectOrCreate",
          "disconnect",
        ].includes(node.name.getText().replace(/^['"]|['"]$/g, "")))
    )
      complex = true;
    ts.forEachChild(node, inspect);
  }
  for (const argument of call.arguments) inspect(argument);
  if (complex) {
    adapter.boundary(
      ownerId,
      call,
      "unsupported-prisma-options",
      "Nested writes, relation includes, spreads, and computed options are outside this adapter.",
    );
    return true;
  }
  let consumed: ts.Node = call;
  while (
    ts.isParenthesizedExpression(consumed.parent) ||
    ts.isAsExpression(consumed.parent) ||
    ts.isSatisfiesExpression(consumed.parent) ||
    ts.isNonNullExpression(consumed.parent)
  )
    consumed = consumed.parent;
  if (
    !ts.isAwaitExpression(consumed.parent) &&
    !ts.isReturnStatement(consumed.parent)
  ) {
    adapter.boundary(
      ownerId,
      call,
      "unsupported-prisma-consumption",
      "Prisma promises must be directly awaited or returned; transactions, promise wrappers, and deferred query aliases are not followed.",
    );
    return true;
  }
  const evidence = context.evidence(call, owner.anchor);
  const operation = adapter.step(
    "prisma-operation",
    `${model.name}.${method.name.text}`,
    call,
    {
      traceRole: "prisma_operation",
      provider: "prisma",
      model: model.name,
      operation: method.name.text,
    },
  );
  const modelId = records.entity(
    "data_model",
    `prisma:${schema.path}:${model.name}`,
    model.name,
    context.evidence(delegate.name, owner.anchor),
    "verified-prisma-model",
    {
      provider: "prisma",
      schemaDeclaration: model.declaration,
      delegate: model.delegate,
      schemaLocation: JSON.stringify({ path: schema.path, range: model.range }),
    },
  );
  records.relationship(
    "CALLS",
    ownerId,
    operation,
    evidence,
    "prisma-operation-call",
  );
  records.relationship(
    access,
    operation,
    modelId,
    evidence,
    "verified-prisma-access",
  );
  // The imported constructor and instance declaration are additional binding evidence.
  records.relationship(
    access,
    operation,
    modelId,
    context.evidence(client.initializer),
    "verified-prisma-access",
  );
  records.relationship(
    access,
    operation,
    modelId,
    context.evidence(statement),
    "verified-prisma-access",
  );
  return true;
};
