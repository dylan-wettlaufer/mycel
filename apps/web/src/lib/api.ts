import type { HealthResponse } from "@mycel/shared";

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
