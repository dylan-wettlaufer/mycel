import type { HealthResponse, ProjectInfo } from "@mycel/shared";

export type ConnectionStatus = "checking" | "connected" | "disconnected";

export async function fetchHealth(signal: AbortSignal): Promise<HealthResponse> {
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

  return { status: body.status };
}

export async function fetchProject(signal: AbortSignal): Promise<ProjectInfo> {
  const response = await fetch("/api/project", { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Project request failed: HTTP ${response.status}`);

  const body: unknown = await response.json();
  if (
    typeof body !== "object" || body === null ||
    !("name" in body) || typeof body.name !== "string" || !body.name ||
    !("root" in body) || typeof body.root !== "string" || !body.root
  ) {
    throw new Error("Invalid project response");
  }
  return { name: body.name, root: body.root };
}
