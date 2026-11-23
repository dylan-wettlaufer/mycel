import { Card } from "@/components/ui/card";
import { useResource } from "@/hooks/use-resource";
import { isAgentHookStatuses } from "@/lib/contracts";
import { formatRecordedTime } from "@/lib/format";
import { agentNames } from "./agent-attribution";

export function AgentHookStatusPanel({ revision }: { revision: number }) {
  const { data } = useResource(
    "/api/agent-hooks",
    isAgentHookStatuses,
    revision,
  );
  if (!data?.length) return null;
  return (
    <Card className="gap-2 px-4 py-3">
      <h3 className="text-sm font-semibold">Agent attribution</h3>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {data.map(({ provider, state, message, lastReceivedAt }) => (
          <li key={provider} className="break-words">
            <span className="font-medium text-foreground">
              {agentNames[provider]}
            </span>
            {" · "}
            {state === "error"
              ? (message ?? "Hook setup failed")
              : lastReceivedAt !== undefined
                ? `Last hook received ${formatRecordedTime(new Date(lastReceivedAt).toISOString())}`
                : provider === "codex"
                  ? "Hook configured. Waiting for a native file edit. Review it in /hooks if Codex prompts you."
                  : "Hook configured. Waiting for a supported edit."}
          </li>
        ))}
      </ul>
    </Card>
  );
}
