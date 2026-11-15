import type { SemanticExtraction } from "@mycel/shared";
import { createSemanticContext } from "./context.js";
import type { SemanticContext, SemanticInput } from "./context.js";
import { extractNext } from "./next.js";
import { extractAnnotations } from "./annotations.js";
import { extractReferences } from "./references.js";
import { extractReact } from "./react.js";

export type { SemanticContext, SemanticInput } from "./context.js";
export type SemanticExtractor = (
  context: SemanticContext,
  current: Readonly<SemanticExtraction>,
) => SemanticExtraction;

/** Pure enrichment of captured sources; extractors never own storage or HTTP. */
export function extractSemanticGraph(
  input: SemanticInput,
  extractors: readonly SemanticExtractor[] = [
    extractReact,
    extractNext,
    extractAnnotations,
  ],
): SemanticExtraction {
  const context = createSemanticContext(input);
  const output: SemanticExtraction = { entities: [], relationships: [] };
  for (const extract of extractors) {
    const result = extract(context, output);
    output.entities.push(...result.entities);
    output.relationships.push(...result.relationships);
  }
  const references = extractReferences(context, output);
  output.entities.push(...references.entities);
  output.relationships.push(...references.relationships);
  for (const records of [output.entities, output.relationships]) {
    if (new Set(records.map((record) => record.id)).size !== records.length)
      throw new Error("Semantic extractors produced duplicate identities");
  }
  return output;
}
