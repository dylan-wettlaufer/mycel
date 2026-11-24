import {
  getCrossFileLinks,
  getFileContent,
  type SqliteDatabase,
} from "@mycel/db";
import type { AgentProposal, GraphQueryContext } from "@mycel/shared";
import { isMissing, readRepositoryText } from "./files.js";

export const agentProposalsPath = ".mycel/agent-proposals.json";

type Candidate = Pick<
  AgentProposal,
  "agent" | "label" | "path" | "line" | "calls"
> & {
  part: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown, max = 200): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[\r\n]/.test(value)
  );
}

function isCandidate(value: unknown): value is Candidate {
  return (
    isRecord(value) &&
    isText(value.part) &&
    isText(value.agent, 80) &&
    isText(value.label) &&
    isText(value.path, 1024) &&
    !value.path.includes("\\") &&
    value.path
      .split("/")
      .every((segment) => segment && segment !== "." && segment !== "..") &&
    typeof value.line === "number" &&
    Number.isSafeInteger(value.line) &&
    value.line > 0 &&
    (value.calls === undefined || isText(value.calls))
  );
}

export async function loadAgentProposals(
  root: string,
): Promise<{ records: Candidate[]; error?: string }> {
  try {
    const value: unknown = JSON.parse(
      await readRepositoryText(root, agentProposalsPath),
    );
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      !Array.isArray(value.proposals) ||
      value.proposals.length > 100 ||
      !value.proposals.every(isCandidate)
    )
      return {
        records: [],
        error: "Expected version 1 and up to 100 valid agent proposals.",
      };
    return { records: value.proposals };
  } catch (error) {
    if (isMissing(error)) return { records: [] };
    return {
      records: [],
      error:
        "Could not read .mycel/agent-proposals.json. Check UTF-8 encoding, JSON syntax, and file permissions.",
    };
  }
}

export function validateAgentProposals(
  database: SqliteDatabase,
  { projectId, revision }: GraphQueryContext,
  fileToPart: Readonly<Record<string, string>>,
  part: string,
  candidates: Candidate[],
): AgentProposal[] {
  const claims = candidates.filter((candidate) => candidate.part === part);
  const links = claims.some(({ calls }) => calls !== undefined)
    ? getCrossFileLinks(database, projectId).links
    : [];
  return claims.map(({ agent, label, path, line, calls }, id) => {
    const file =
      fileToPart[path] === part
        ? getFileContent(database, projectId, path, revision)
        : undefined;
    const sourceValid =
      file !== undefined && line <= file.content.split(/\r\n|\r|\n/).length;
    return {
      id,
      agent,
      label,
      path,
      line,
      sourceValid,
      ...(calls !== undefined && {
        calls,
        callSupported:
          sourceValid &&
          calls !== part &&
          links.some(
            (link) =>
              link.kind === "CALLS" &&
              !link.approximate &&
              link.sourcePath === path &&
              (link.sourceLine === line ||
                link.additionalLines?.includes(line)) &&
              fileToPart[link.targetPath] === calls,
          ),
      }),
    };
  });
}
