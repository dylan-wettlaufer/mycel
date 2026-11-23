export const agentProviders = ["claude-code", "codex", "cursor"] as const;
export type AgentProvider = (typeof agentProviders)[number];

export interface AgentHookSetup {
  provider: AgentProvider;
  state: "configured" | "error";
  message?: string;
}

export interface AgentHookStatus extends AgentHookSetup {
  lastReceivedAt?: number;
}

export function isAgentProvider(value: unknown): value is AgentProvider {
  return agentProviders.some((provider) => provider === value);
}

/** Normalized metadata from a provider hook. Times are epoch milliseconds. */
interface AgentToolMetadata {
  provider: AgentProvider;
  sessionId: string;
  toolUseId: string;
  tool: "Edit" | "Write";
  timestamp: number;
  path: string;
  expectedHash?: string;
}

export type AgentToolEvent = AgentToolMetadata &
  (
    | { phase: "started" | "succeeded" | "failed" }
    | { phase: "observed"; observedHash: string | null }
  );

export interface ChangeAttribution {
  status: "confirmed" | "inferred" | "unknown";
  provider?: AgentProvider;
  /** Provider session ID, separate from the Mycel monitoring session. */
  sessionId?: string;
}
