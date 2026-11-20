import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { relative, sep } from "node:path";
import { promisify } from "node:util";
import type {
  ArchitectureAssignment,
  ArchitectureChangeStatus,
  ArchitectureChangeWindow,
  ArchitectureConnection,
  ArchitectureConnectionWithChanges,
  ArchitectureGitChanges,
  ArchitecturePartWithChanges,
} from "@mycel/shared";
import { assignFilesToParts } from "./architecture-assign.js";

const execFileAsync = promisify(execFile);

/** Git's universal empty tree object hash (SHA-1). */
const emptyTreeSha1 = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const windowDays: Record<"7d" | "30d", number> = {
  "7d": 7,
  "30d": 30,
};

export interface GitChangesOptions {
  /** Desired comparison window. Defaults to `"branch"`. */
  window?: ArchitectureChangeWindow;
  /** Reference timestamp for `"7d"` and `"30d"` windows. Defaults to `new Date()`. */
  now?: Date;
}

interface GitResult {
  ok: boolean;
  stdout: string;
  code?: string | number | undefined;
}

async function runGit(
  cwd: string,
  args: readonly string[],
): Promise<GitResult> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-c", "core.quotepath=false", ...args],
      {
        cwd,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    return { ok: true, stdout };
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? (error as { code?: string | number }).code
        : undefined;
    return { ok: false, stdout: "", code };
  }
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedArray(set: ReadonlySet<string>): string[] {
  return [...set].sort(compareStrings);
}

function toProjectRelative(
  gitRelativePath: string,
  subpathPrefix: string,
): string | undefined {
  const normalized = gitRelativePath.replaceAll("\\", "/").replace(/\/+$/, "");
  if (!normalized) return undefined;
  if (!subpathPrefix) return normalized;
  if (!normalized.startsWith(`${subpathPrefix}/`)) return undefined;
  const trimmed = normalized.slice(subpathPrefix.length + 1);
  return trimmed || undefined;
}

interface ParsedStatus {
  uncommitted: Set<string>;
  untracked: Set<string>;
  added: Set<string>;
  modified: Set<string>;
  deleted: Set<string>;
}

function parsePorcelainStatus(
  stdout: string,
  subpathPrefix: string,
): ParsedStatus {
  const uncommitted = new Set<string>();
  const untracked = new Set<string>();
  const added = new Set<string>();
  const modified = new Set<string>();
  const deleted = new Set<string>();

  const tokens = stdout.split("\0");
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (!entry || entry.length < 4) continue;

    const x = entry[0]!;
    const y = entry[1]!;
    const rawPath = entry.slice(3);
    const hasOrig = x === "R" || x === "C" || y === "R" || y === "C";
    const rawOrig = hasOrig ? tokens[++i] : undefined;

    const filePath = toProjectRelative(rawPath, subpathPrefix);
    const origPath = rawOrig
      ? toProjectRelative(rawOrig, subpathPrefix)
      : undefined;

    if (origPath && (x === "R" || y === "R")) {
      uncommitted.add(origPath);
      deleted.add(origPath);
    }

    if (!filePath) continue;

    if (x === "?" && y === "?") {
      uncommitted.add(filePath);
      untracked.add(filePath);
      added.add(filePath);
      continue;
    }

    if (x === "!" && y === "!") continue;

    uncommitted.add(filePath);

    if (y === "D" || (x === "D" && y === " ")) {
      deleted.add(filePath);
    } else if (
      x === "A" ||
      x === "C" ||
      x === "R" ||
      y === "R" ||
      (x === "A" && y === "A")
    ) {
      added.add(filePath);
    } else {
      modified.add(filePath);
    }
  }

  return { uncommitted, untracked, added, modified, deleted };
}

function parseNameStatus(
  stdout: string,
  subpathPrefix: string,
): { added: Set<string>; modified: Set<string>; deleted: Set<string> } {
  const added = new Set<string>();
  const modified = new Set<string>();
  const deleted = new Set<string>();

  const tokens = stdout.split("\0");
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const status = tokens[i];
    const rawPath = tokens[i + 1];
    if (!status || !rawPath) continue;
    const filePath = toProjectRelative(rawPath, subpathPrefix);
    if (!filePath) continue;

    const code = status[0];
    if (code === "A" || code === "C") added.add(filePath);
    else if (code === "D") deleted.add(filePath);
    else modified.add(filePath);
  }

  return { added, modified, deleted };
}

async function resolveDefaultBaseRef(
  root: string,
): Promise<{ ref: string; branchName: string } | undefined> {
  const candidates: { ref: string; verify: string; branchName: string }[] = [
    { ref: "main", verify: "refs/heads/main", branchName: "main" },
    { ref: "master", verify: "refs/heads/master", branchName: "master" },
    {
      ref: "origin/main",
      verify: "refs/remotes/origin/main",
      branchName: "main",
    },
    {
      ref: "origin/master",
      verify: "refs/remotes/origin/master",
      branchName: "master",
    },
  ];

  for (const candidate of candidates) {
    const check = await runGit(root, [
      "rev-parse",
      "--verify",
      "--quiet",
      candidate.verify,
    ]);
    if (check.ok && check.stdout.trim()) {
      return { ref: candidate.ref, branchName: candidate.branchName };
    }
  }

  const originHead = await runGit(root, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (originHead.ok && originHead.stdout.trim()) {
    const ref = originHead.stdout.trim();
    const branchName = ref.startsWith("origin/") ? ref.slice(7) : ref;
    return { ref, branchName };
  }

  return undefined;
}

async function resolveEmptyTreeHash(root: string): Promise<string> {
  const result = await runGit(root, ["hash-object", "-t", "tree", "/dev/null"]);
  return result.ok && result.stdout.trim()
    ? result.stdout.trim()
    : emptyTreeSha1;
}

function unavailableResult(
  requestedWindow: ArchitectureChangeWindow,
  reason: string,
): ArchitectureGitChanges {
  return {
    available: false,
    reason,
    requestedWindow,
    resolvedWindow: requestedWindow,
    branch: null,
    baseRef: null,
    baseCommit: null,
    addedFiles: [],
    modifiedFiles: [],
    deletedFiles: [],
    uncommittedFiles: [],
  };
}

/**
 * Inspect git state for a repository and list added, modified, deleted, and
 * uncommitted files for the selected window.
 *
 * Defaults to `"branch"`, which compares against the branch split from the
 * default branch (`main`/`master`) or falls back to `"7d"` when already on the
 * default branch or detached HEAD.
 */
export async function collectGitChanges(
  projectRoot: string,
  options: GitChangesOptions = {},
): Promise<ArchitectureGitChanges> {
  if (typeof projectRoot !== "string" || !projectRoot)
    throw new TypeError("A project root is required");
  const root = await realpath(projectRoot);
  if (!(await stat(root)).isDirectory())
    throw new Error("Project root must be a directory");

  const requestedWindow: ArchitectureChangeWindow = options.window ?? "branch";
  const now = options.now ?? new Date();

  const inside = await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok) {
    if (inside.code === "ENOENT")
      return unavailableResult(requestedWindow, "git-unavailable");
    return unavailableResult(requestedWindow, "not-a-git-repo");
  }
  if (inside.stdout.trim() !== "true") {
    return unavailableResult(requestedWindow, "not-a-git-repo");
  }

  const topLevelResult = await runGit(root, ["rev-parse", "--show-toplevel"]);
  const topLevel = topLevelResult.ok
    ? await realpath(topLevelResult.stdout.trim()).catch(() => root)
    : root;
  const relFromTop = relative(topLevel, root).split(sep).join("/");
  const subpathPrefix =
    relFromTop && !relFromTop.startsWith("..") ? relFromTop : "";

  const branchResult = await runGit(root, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "HEAD",
  ]);
  const branch =
    branchResult.ok && branchResult.stdout.trim()
      ? branchResult.stdout.trim()
      : null;

  const headResult = await runGit(root, [
    "rev-parse",
    "--verify",
    "--quiet",
    "HEAD",
  ]);
  const hasHead = headResult.ok && Boolean(headResult.stdout.trim());

  const statusResult = await runGit(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "-uall",
  ]);
  const status = statusResult.ok
    ? parsePorcelainStatus(statusResult.stdout, subpathPrefix)
    : {
        uncommitted: new Set<string>(),
        untracked: new Set<string>(),
        added: new Set<string>(),
        modified: new Set<string>(),
        deleted: new Set<string>(),
      };

  if (requestedWindow === "uncommitted" || !hasHead) {
    return {
      available: true,
      requestedWindow,
      resolvedWindow:
        requestedWindow === "uncommitted" ? "uncommitted" : requestedWindow,
      branch,
      baseRef: null,
      baseCommit: null,
      addedFiles: sortedArray(status.added),
      modifiedFiles: sortedArray(status.modified),
      deletedFiles: sortedArray(status.deleted),
      uncommittedFiles: sortedArray(status.uncommitted),
    };
  }

  let resolvedWindow: ArchitectureChangeWindow = requestedWindow;
  let baseRef: string | null = null;
  let baseCommit: string | null = null;

  if (requestedWindow === "branch") {
    const defaultBase = await resolveDefaultBaseRef(root);
    const onDefaultBranch =
      branch === null ||
      branch === "main" ||
      branch === "master" ||
      (defaultBase !== undefined && branch === defaultBase.branchName);

    if (onDefaultBranch || !defaultBase) {
      resolvedWindow = "7d";
    } else {
      baseRef = defaultBase.ref;
      const mergeBase = await runGit(root, [
        "merge-base",
        "HEAD",
        defaultBase.ref,
      ]);
      baseCommit =
        mergeBase.ok && mergeBase.stdout.trim()
          ? mergeBase.stdout.trim()
          : null;
    }
  }

  if (resolvedWindow === "7d" || resolvedWindow === "30d") {
    const days = windowDays[resolvedWindow];
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const rev = await runGit(root, [
      "rev-list",
      "-n",
      "1",
      `--before=${cutoff.toISOString()}`,
      "HEAD",
    ]);
    baseCommit = rev.ok && rev.stdout.trim() ? rev.stdout.trim() : null;
  }

  const diffTarget = baseCommit ?? (await resolveEmptyTreeHash(root));
  const diffResult = await runGit(root, [
    "diff",
    "--name-status",
    "--no-renames",
    "-z",
    diffTarget,
  ]);
  const diff = diffResult.ok
    ? parseNameStatus(diffResult.stdout, subpathPrefix)
    : {
        added: new Set<string>(),
        modified: new Set<string>(),
        deleted: new Set<string>(),
      };

  // Combine tracked working-tree diff against `diffTarget` with untracked files.
  for (const untrackedFile of status.untracked) {
    diff.added.add(untrackedFile);
    diff.deleted.delete(untrackedFile);
  }

  return {
    available: true,
    requestedWindow,
    resolvedWindow,
    branch,
    baseRef,
    baseCommit,
    addedFiles: sortedArray(diff.added),
    modifiedFiles: sortedArray(diff.modified),
    deletedFiles: sortedArray(diff.deleted),
    uncommittedFiles: sortedArray(status.uncommitted),
  };
}

/**
 * Annotate assigned architecture parts and cross-part connections with recent
 * git change status (`new`, `changed`, or `unchanged`) and uncommitted flags.
 */
export function applyGitChangesToArchitecture(
  assignment: ArchitectureAssignment,
  connections: readonly ArchitectureConnection[],
  gitChanges: ArchitectureGitChanges,
  deletedFileOwners?: Readonly<Record<string, string>>,
): {
  parts: ArchitecturePartWithChanges[];
  connections: ArchitectureConnectionWithChanges[];
} {
  const addedSet = new Set(gitChanges.addedFiles);
  const modifiedSet = new Set(gitChanges.modifiedFiles);
  const uncommittedSet = new Set(gitChanges.uncommittedFiles);

  // Map deleted files back to existing parts so deletions mark a part as changed.
  const deletedByPart = new Map<string, string[]>();
  if (gitChanges.deletedFiles.length > 0 && assignment.parts.length > 0) {
    const deletedAssignment = deletedFileOwners
      ? undefined
      : assignFilesToParts(
          { version: 1, parts: assignment.parts },
          gitChanges.deletedFiles,
        );
    const unassignedDeleted = new Set(deletedAssignment?.unassignedFiles);
    for (const deletedFile of gitChanges.deletedFiles) {
      if (unassignedDeleted.has(deletedFile)) continue;
      const partId = (deletedFileOwners ?? deletedAssignment?.fileToPart)?.[
        deletedFile
      ];
      if (!partId) continue;
      let list = deletedByPart.get(partId);
      if (!list) {
        list = [];
        deletedByPart.set(partId, list);
      }
      list.push(deletedFile);
    }
  }

  const partStatusById = new Map<string, ArchitectureChangeStatus>();
  const parts: ArchitecturePartWithChanges[] = assignment.parts.map((part) => {
    let addedCount = 0;
    let modifiedCount = 0;
    let uncommittedCount = 0;

    for (const file of part.files) {
      if (addedSet.has(file)) addedCount++;
      else if (modifiedSet.has(file)) modifiedCount++;
      if (uncommittedSet.has(file)) uncommittedCount++;
    }

    const deletedInPart = deletedByPart.get(part.id) ?? [];
    for (const deletedFile of deletedInPart) {
      if (uncommittedSet.has(deletedFile)) uncommittedCount++;
    }

    let status: ArchitectureChangeStatus;
    if (part.files.length === 0) {
      status = deletedInPart.length > 0 ? "changed" : "unchanged";
    } else if (addedCount === part.files.length && deletedInPart.length === 0) {
      status = "new";
    } else if (
      addedCount > 0 ||
      modifiedCount > 0 ||
      deletedInPart.length > 0
    ) {
      status = "changed";
    } else {
      status = "unchanged";
    }

    partStatusById.set(part.id, status);

    return {
      ...part,
      change: {
        status,
        uncommitted: uncommittedCount > 0,
        addedFiles: addedCount,
        modifiedFiles: modifiedCount,
        uncommittedFiles: uncommittedCount,
      },
    };
  });

  const annotatedConnections: ArchitectureConnectionWithChanges[] =
    connections.map((connection) => {
      const sourceStatus = partStatusById.get(connection.sourcePartId);
      const targetStatus = partStatusById.get(connection.targetPartId);

      let hasAnyChangedEndpoint = false;
      let allEvidenceHasNewEndpoint = connection.evidence.length > 0;
      let uncommitted = false;

      for (const item of connection.evidence) {
        const fileAdded = addedSet.has(item.file);
        const targetAdded = addedSet.has(item.targetFile);
        const fileModified = modifiedSet.has(item.file);
        const targetModified = modifiedSet.has(item.targetFile);

        if (fileAdded || targetAdded || fileModified || targetModified) {
          hasAnyChangedEndpoint = true;
        }
        if (!fileAdded && !targetAdded) {
          allEvidenceHasNewEndpoint = false;
        }
        if (
          uncommittedSet.has(item.file) ||
          uncommittedSet.has(item.targetFile)
        ) {
          uncommitted = true;
        }
      }

      let status: ArchitectureChangeStatus;
      if (
        sourceStatus === "new" ||
        targetStatus === "new" ||
        allEvidenceHasNewEndpoint
      ) {
        status = "new";
      } else if (hasAnyChangedEndpoint) {
        status = "changed";
      } else {
        status = "unchanged";
      }

      return {
        ...connection,
        change: {
          status,
          uncommitted,
        },
      };
    });

  return { parts, connections: annotatedConnections };
}
