export type AgentProvider = "claude-code";

/** Normalized metadata from a provider hook. Times are epoch milliseconds. */
export interface AgentToolEvent {
  provider: AgentProvider;
  sessionId: string;
  toolUseId: string;
  tool: "Edit" | "Write";
  timestamp: number;
  path: string;
  phase: "started" | "succeeded" | "failed";
  expectedHash?: string;
}

export interface ChangeAttribution {
  status: "confirmed" | "inferred" | "unknown";
  provider?: AgentProvider;
  /** Provider session ID, separate from the Mycel monitoring session. */
  sessionId?: string;
}
