import type { SourceRange } from "@mycel/shared";

export interface PrismaModel {
  name: string;
  delegate: string;
  range: SourceRange;
  declaration: string;
}
export type PrismaSchema =
  | { status: "supported"; path: string; models: PrismaModel[] }
  | { status: "unresolved"; code: string; message: string };
export const unknownSchema = (code: string, message: string): PrismaSchema => ({
  status: "unresolved",
  code,
  message,
});

/** Narrow lexical reader for complete single-file schemas; never runs Prisma. */
export function parsePrismaSchema(path: string, source: string): PrismaSchema {
  const tokens = [
    ...source.matchAll(
      /\/\/[^\n\r]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|[A-Za-z_][\w]*|[^\s]/g,
    ),
  ].filter((token) => !token[0].startsWith("//") && !token[0].startsWith("/*"));
  if (tokens.some((token) => ["/", '"', "'"].includes(token[0])))
    return unknownSchema(
      "unsupported-prisma-schema",
      "Schema contains an unterminated comment or string.",
    );
  const models: PrismaModel[] = [];
  let clients = 0;
  for (let index = 0; index < tokens.length;) {
    const kind = tokens[index]?.[0];
    const name = tokens[index + 1]?.[0];
    if (
      !["generator", "datasource", "model", "enum", "type", "view"].includes(
        kind ?? "",
      ) ||
      !name ||
      !/^[A-Za-z_]\w*$/.test(name) ||
      tokens[index + 2]?.[0] !== "{"
    )
      return unknownSchema(
        "unsupported-prisma-schema",
        "Schema declarations could not be read unambiguously.",
      );
    let end = index + 3;
    let depth = 1;
    for (; end < tokens.length; end++) {
      if (tokens[end]![0] === "{") depth++;
      if (tokens[end]![0] === "}") depth--;
      if (depth === 0) break;
    }
    if (depth !== 0)
      return unknownSchema(
        "unsupported-prisma-schema",
        "Schema contains an incomplete declaration.",
      );
    const body = tokens.slice(index + 3, end).map((token) => token[0]);
    if (kind === "generator") {
      const provider = body.findIndex((token) => token === "provider");
      if (
        body[provider + 1] === "=" &&
        body[provider + 2] === '"prisma-client-js"'
      ) {
        if (body.includes("output"))
          return unknownSchema(
            "unsupported-prisma-generator",
            "Custom generated-client output is not supported.",
          );
        clients++;
      } else if (body.some((token) => token === '"prisma-client"'))
        return unknownSchema(
          "unsupported-prisma-generator",
          "This adapter supports @prisma/client with prisma-client-js generation.",
        );
    }
    if (kind === "model") {
      const start = tokens[index]!.index;
      const finish = tokens[end]!.index + 1;
      const first = source.slice(0, start).split("\n");
      const last = source.slice(0, finish).split("\n");
      models.push({
        name,
        declaration: source.slice(start, finish),
        delegate: name[0]!.toLowerCase() + name.slice(1),
        range: {
          start,
          end: finish,
          startLine: first.length,
          startColumn: first.at(-1)!.length + 1,
          endLine: last.length,
          endColumn: last.at(-1)!.length + 1,
        },
      });
    }
    index = end + 1;
  }
  if (
    clients !== 1 ||
    new Set(models.map((model) => model.delegate)).size !== models.length
  )
    return unknownSchema(
      "unsupported-prisma-schema",
      "One default Prisma client generator and unique model delegates are required.",
    );
  return { status: "supported", path, models };
}
