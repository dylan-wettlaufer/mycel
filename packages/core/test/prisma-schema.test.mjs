import assert from "node:assert/strict";
import test from "node:test";
import { parsePrismaSchema } from "../dist/prisma-schema.js";

test("Prisma schema evidence ignores comments/strings and rejects incomplete, duplicate, or custom generators", () => {
  const source = `// model Fake { id Int }
    generator client { provider = "prisma-client-js" }
    datasource db { provider = "sqlite" url = env("DATABASE_URL") }
    /* model Other { id Int } */
    model Order { id String @id note String @default("model StringFake { }") }`;
  const result = parsePrismaSchema("prisma/schema.prisma", source);
  assert.equal(result.status, "supported");
  assert.deepEqual(
    result.models.map((model) => model.name),
    ["Order"],
  );
  assert.equal(
    source.slice(result.models[0].range.start, result.models[0].range.end),
    result.models[0].declaration,
  );
  for (const invalid of [
    source + " model Missing {",
    source + " /* never closed",
    source + " model order { id Int }",
    source.replace(
      'provider = "prisma-client-js"',
      'provider = "prisma-client"',
    ),
    source.replace(
      'provider = "prisma-client-js"',
      'provider = "prisma-client-js" output = "../generated"',
    ),
  ])
    assert.equal(
      parsePrismaSchema("prisma/schema.prisma", invalid).status,
      "unresolved",
    );
});
