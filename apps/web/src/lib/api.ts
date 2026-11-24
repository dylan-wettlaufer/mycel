import type { HealthResponse, IndexProgress, ProjectInfo } from "@mycel/shared";

export type ConnectionStatus = "checking" | "connected" | "disconnected";

function isIndexProgress(index: unknown): index is IndexProgress {
  return (
    typeof index === "object" &&
    index !== null &&
    "status" in index &&
    (index.status === "ready" || index.status === "error") &&
    "indexedFiles" in index &&
    typeof index.indexedFiles === "number" &&
    "totalFiles" in index &&
    typeof index.totalFiles === "number" &&
    "revision" in index &&
    typeof index.revision === "number" &&
    "committedAt" in index &&
    typeof index.committedAt === "string" &&
    (!("message" in index) || typeof index.message === "string")
  );
}

export async function fetchHealth(
  signal: AbortSignal,
): Promise<HealthResponse> {
  const response = await fetch("/api/health", { signal, cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Health check failed: HTTP ${response.status}`);
  }

  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("status" in body) ||
    body.status !== "ok"
  ) {
    throw new Error("Invalid health response");
  }

  const warnings = "sourceWarnings" in body ? body.sourceWarnings : undefined;
  if (
    warnings !== undefined &&
    !(
      Array.isArray(warnings) &&
      warnings.every((value: unknown) => typeof value === "string")
    )
  ) {
    throw new Error("Invalid source warnings");
  }
  const index = "index" in body ? body.index : undefined;
  if (index !== undefined && !isIndexProgress(index))
    throw new Error("Invalid index status");
  return {
    status: body.status,
    ...(warnings && { sourceWarnings: warnings }),
    ...(index && { index }),
  };
}

export async function fetchProject(signal: AbortSignal): Promise<ProjectInfo> {
  const response = await fetch("/api/project", { signal, cache: "no-store" });
  if (!response.ok)
    throw new Error(`Project request failed: HTTP ${response.status}`);

  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("name" in body) ||
    typeof body.name !== "string" ||
    !body.name ||
    !("root" in body) ||
    typeof body.root !== "string" ||
    !body.root
  ) {
    throw new Error("Invalid project response");
  }
  return { name: body.name, root: body.root };
}

export async function request<T>(
  url: string,
  validate: (value: unknown) => value is T,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Request failed: HTTP ${response.status}`);
  const value: unknown = await response.json();
  if (!validate(value)) throw new Error("Invalid server response");
  return value;
}
