import type { AgentProvider, ChangeAttribution } from "@mycel/shared";
import { Badge } from "@/components/ui/badge";

export const agentNames: Record<AgentProvider, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
};

export function AgentAttribution({
  attribution,
}: {
  attribution: ChangeAttribution | undefined;
}) {
  if (!attribution) return null;
  if (attribution.status === "unknown") {
    return <Badge variant="outline">Agent unknown</Badge>;
  }
  const name = attribution.provider
    ? agentNames[attribution.provider]
    : "Agent";
  return (
    <Badge
      variant={attribution.status === "confirmed" ? "secondary" : "outline"}
      title={
        attribution.sessionId
          ? `${name} session ${attribution.sessionId}`
          : name
      }
    >
      {name}
      {attribution.sessionId && ` · ${attribution.sessionId.slice(0, 8)}`}
      {` · ${attribution.status}`}
    </Badge>
  );
}
