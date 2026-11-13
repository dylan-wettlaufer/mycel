import { createHash } from "node:crypto";

export const hashContent = (source: string): string =>
  createHash("sha256").update(source, "utf8").digest("hex");
export const hashIdentity = (parts: readonly string[]): string =>
  hashContent(JSON.stringify(parts));
