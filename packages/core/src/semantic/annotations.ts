import ts from "typescript";
import type { SemanticExtraction, SemanticSource } from "@mycel/shared";
import type { SemanticContext } from "./context.js";
import { semanticRecords } from "./records.js";

/** Explicit role declarations take precedence over convention-based candidates. */
export function extractAnnotations(
  context: SemanticContext,
  current: Readonly<SemanticExtraction>,
) {
  const records = semanticRecords(context.project.id, "mycel-annotations", "1");
  for (const callable of context.callables) {
    if (
      ts
        .getJSDocTags(callable.binding)
        .some((tag) => tag.tagName.text === "mycelService" && !tag.comment) &&
      !current.entities.some(
        (entity) =>
          entity.kind === "service_operation" &&
          entity.sources.some((source) => source.nodeId === callable.anchor.id),
      )
    )
      records.entity(
        "service_operation",
        callable.anchor.id,
        callable.anchor.name,
        {
          nodeId: callable.anchor.id,
          path: callable.anchor.path,
          range: callable.anchor.range,
        },
        "service-annotation",
      );
  }
  for (const source of context.sourceFiles.values()) {
    for (const declaration of source.statements) {
      if (
        !ts.isInterfaceDeclaration(declaration) &&
        !ts.isTypeAliasDeclaration(declaration) &&
        !ts.isClassDeclaration(declaration)
      )
        continue;
      if (
        !declaration.name ||
        !ts
          .getJSDocTags(declaration)
          .some((tag) => tag.tagName.text === "mycelModel" && !tag.comment)
      )
        continue;
      if (
        source.statements.filter(
          (item) =>
            (ts.isInterfaceDeclaration(item) ||
              ts.isTypeAliasDeclaration(item) ||
              ts.isClassDeclaration(item)) &&
            item.name?.text === declaration.name!.text,
        ).length !== 1
      )
        continue;
      const anchor = context.anchor(declaration, declaration.name.text);
      const evidence = context.evidence(declaration, anchor);
      if (anchor) evidence.range = anchor.range;
      records.entity(
        "data_model",
        `${source.fileName}:${declaration.name.text}`,
        declaration.name.text,
        evidence,
        "model-annotation",
        {
          declarationKind: ts.isClassDeclaration(declaration)
            ? "class"
            : ts.isInterfaceDeclaration(declaration)
              ? "interface"
              : "type",
        },
      );
    }
  }
  return { entities: records.entities, relationships: records.relationships };
}

/** Run after candidate roles so explicit feature tags also govern those roles. */
export function extractFeatureAnnotations(
  context: SemanticContext,
  current: Readonly<SemanticExtraction>,
) {
  const records = semanticRecords(context.project.id, "mycel-annotations", "1");
  function annotate(
    declaration: ts.Declaration,
    ids: string[],
    evidence: SemanticSource,
  ) {
    for (const tag of ts.getJSDocTags(declaration)) {
      if (
        tag.tagName.text !== "mycelFeature" ||
        typeof tag.comment !== "string"
      )
        continue;
      const name = tag.comment.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(name)) continue;
      const feature = records.entity(
        "feature",
        name,
        name,
        context.evidence(tag),
        "feature-annotation",
        { status: "declared" },
      );
      for (const id of ids)
        records.relationship(
          "IMPLEMENTS",
          id,
          feature,
          evidence,
          "feature-annotation",
        );
    }
  }
  for (const callable of context.callables) {
    const ids = current.entities
      .filter(
        (entity) =>
          ["component", "page", "service_operation"].includes(entity.kind) &&
          entity.sources.some((source) => source.nodeId === callable.anchor.id),
      )
      .map((entity) => entity.id);
    annotate(callable.binding, ids, {
      nodeId: callable.anchor.id,
      path: callable.anchor.path,
      range: callable.anchor.range,
    });
  }
  for (const source of context.sourceFiles.values())
    for (const declaration of source.statements) {
      if (
        !ts.isInterfaceDeclaration(declaration) &&
        !ts.isTypeAliasDeclaration(declaration) &&
        !ts.isClassDeclaration(declaration)
      )
        continue;
      const model = current.entities.find(
        (entity) =>
          entity.kind === "data_model" &&
          entity.name === declaration.name?.text &&
          entity.sources.some(
            (mapping) =>
              mapping.path === source.fileName &&
              mapping.range.end === declaration.end,
          ),
      );
      if (model) annotate(declaration, [model.id], model.sources[0]!);
    }
  return { entities: records.entities, relationships: records.relationships };
}
