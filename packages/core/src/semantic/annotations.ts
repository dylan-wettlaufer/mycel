import ts from "typescript";
import type { SemanticExtraction, SemanticSource } from "@mycel/shared";
import type { SemanticContext } from "./context.js";
import { semanticRecords } from "./records.js";

/** Explicit author declarations only; directory/name heuristics carry no meaning. */
export function extractAnnotations(
  context: SemanticContext,
  current: Readonly<SemanticExtraction>,
) {
  const records = semanticRecords(context.project.id, "mycel-annotations", "1");
  function annotate(
    declaration: ts.Declaration,
    implementationIds: string[],
    evidence: SemanticSource,
  ) {
    const tags = ts.getJSDocTags(declaration);
    for (const tag of tags) {
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
      );
      for (const id of implementationIds)
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
    const evidence = {
      nodeId: callable.anchor.id,
      path: callable.anchor.path,
      range: callable.anchor.range,
    };
    const existing = current.entities.filter((entity) =>
      entity.sources.some((source) => source.nodeId === callable.anchor.id),
    );
    const ids = existing
      .filter((entity) =>
        ["component", "page", "service_operation"].includes(entity.kind),
      )
      .map((entity) => entity.id);
    if (
      ts
        .getJSDocTags(callable.binding)
        .some((tag) => tag.tagName.text === "mycelService" && !tag.comment) &&
      !existing.some((entity) => entity.kind === "service_operation")
    ) {
      ids.push(
        records.entity(
          "service_operation",
          callable.anchor.id,
          callable.anchor.name,
          evidence,
          "service-annotation",
        ),
      );
    }
    annotate(callable.binding, ids, evidence);
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
      // Declaration merging and duplicate model names are outside this subset.
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
      // Export modifiers can precede a Tree-sitter class range; use its exact anchor.
      if (anchor) evidence.range = anchor.range;
      const model = records.entity(
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
      annotate(declaration, [model], evidence);
    }
  }
  return { entities: records.entities, relationships: records.relationships };
}
