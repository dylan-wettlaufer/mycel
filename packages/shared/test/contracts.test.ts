// Compile consumer examples against the built public entry point. These are
// type-only contract checks: no Node/browser APIs or runtime test runner needed.
import type {
  ContentHash,
  Diagnostic,
  EdgeKind,
  ErrorResponse,
  FileContent,
  FileContentQuery,
  GraphEdge,
  GraphNode,
  GraphStats,
  HealthResponse,
  IndexProgress,
  IndexingSettings,
  Neighborhood,
  NeighborhoodQuery,
  NodeDetails,
  NodeDetailsQuery,
  NodeId,
  NodeKind,
  NodeList,
  Project,
  ProjectId,
  ProjectInfo,
  Revision,
  SearchQuery,
  SearchResult,
  SourceRange,
  SymbolKind,
} from "@mycel/shared";

export const launchProject = {
  name: "sample",
  root: "/projects/sample",
} satisfies ProjectInfo;

export const indexing = {
  extensions: [".ts", ".tsx"],
  exclude: ["node_modules/**", "dist/**"],
  respectGitignore: true,
} satisfies IndexingSettings;

export const project = {
  ...launchProject,
  id: "project:sample",
  indexing,
} satisfies Project;

export const range = {
  start: 0,
  end: 42,
  startLine: 1,
  startColumn: 1,
  endLine: 3,
  endColumn: 2,
} satisfies SourceRange;

export const file = {
  id: "node:file",
  projectId: project.id,
  kind: "file",
  name: "save.ts",
  qualifiedName: "src/save.ts",
  path: "src/save.ts",
  range,
  contentHash:
    "d04f0a7305d255e69b2a06221f451872c47f35bc539ae913b635b5ac2b3e2ccd",
  revision: 1,
} satisfies GraphNode;

export const save = {
  ...file,
  id: "node:save",
  kind: "function",
  name: "save",
  qualifiedName: "save",
} satisfies GraphNode;

export const validate = {
  ...save,
  id: "node:validate",
  name: "validate",
  qualifiedName: "validate",
} satisfies GraphNode;

export const contains = {
  id: "edge:contains",
  projectId: project.id,
  kind: "CONTAINS",
  sourceId: file.id,
  targetId: save.id,
  revision: 1,
} satisfies GraphEdge;

export const calls = {
  ...contains,
  id: "edge:calls",
  kind: "CALLS",
  sourceId: save.id,
  targetId: validate.id,
} satisfies GraphEdge;

export const parserDiagnostic = {
  path: file.path,
  range,
  source: "parser",
  severity: "error",
  code: "missing-syntax",
  message: "Expected }",
} satisfies Diagnostic;

export const noNodes = { nodes: [], truncated: false } satisfies NodeList;
export const context = { projectId: project.id, revision: 1 };

export const search = {
  ...context,
  nodes: [save],
  truncated: true,
} satisfies SearchResult;

export const neighborhood = {
  ...context,
  rootId: save.id,
  nodes: [save, validate],
  edges: [calls],
  truncated: false,
} satisfies Neighborhood;

export const details = {
  ...context,
  node: save,
  callers: noNodes,
  dependencies: { nodes: [validate], truncated: false },
  relatedFiles: { nodes: [file], truncated: false },
  diagnostics: [parserDiagnostic],
} satisfies NodeDetails;

export const content = {
  ...context,
  path: file.path,
  language: "typescript",
  content: "export function save() { validate(); }",
  contentHash: file.contentHash,
} satisfies FileContent;

export const stats = {
  ...context,
  fileCount: 1,
  symbolCount: 2,
  edgeCount: 2,
  diagnosticCount: 1,
} satisfies GraphStats;

export const requests = {
  search: { q: "save", limit: 20 } satisfies SearchQuery,
  neighborhood: { depth: 2, limit: 50 } satisfies NeighborhoodQuery,
  details: { limit: 10 } satisfies NodeDetailsQuery,
  content: { path: file.path } satisfies FileContentQuery,
};

export const discovering = {
  status: "indexing",
  indexedFiles: 0,
  totalFiles: null,
} satisfies IndexProgress;

// Existing CLI/server/web consumers can still use their minimal payloads.
export const livenessOnly = { status: "ok" } satisfies HealthResponse;
export const indexingHealth = {
  status: "ok",
  index: discovering,
  database: "ready",
} satisfies HealthResponse;
export const failedIndexHealth = {
  status: "ok",
  index: {
    status: "error",
    indexedFiles: 1,
    totalFiles: 2,
    message: "Index failed",
  },
  database: "error",
} satisfies HealthResponse;
export const error = { error: "Node not found" } satisfies ErrorResponse;

declare function acceptNode(_value: GraphNode): void;
declare function acceptEdge(_value: GraphEdge): void;
declare function acceptNeighborhood(_value: Neighborhood): void;
declare function acceptDetails(_value: NodeDetails): void;
declare function acceptProject(_value: Project): void;
declare function acceptSymbolKind(_value: SymbolKind): void;
declare function acceptNodeKind(_value: NodeKind): void;
declare function acceptEdgeKind(_value: EdgeKind): void;
declare function acceptRevision(_value: Revision): void;
declare function acceptHash(_value: ContentHash): void;
declare function acceptNodeId(_value: NodeId): void;
declare function acceptProjectId(_value: ProjectId): void;
declare const missingHash: Omit<GraphNode, "contentHash">;
declare const missingSnapshot: Omit<Neighborhood, "revision">;

// @ts-expect-error Node content hashes are required for change detection.
acceptNode(missingHash);
// @ts-expect-error Graph queries identify the snapshot they describe.
acceptNeighborhood(missingSnapshot);
// @ts-expect-error Launch metadata does not yet have a persistent project identity/settings.
acceptProject(launchProject);
// @ts-expect-error Unresolved relationships cannot become target-less graph edges.
acceptEdge({ ...calls, targetId: undefined });
// @ts-expect-error Relationship lists must retain their truncation information.
acceptDetails({ ...details, callers: [validate] });
// @ts-expect-error Files are graph nodes but not parser symbols.
acceptSymbolKind("file");
// @ts-expect-error The MVP graph does not contain interface/type nodes.
acceptNodeKind("interface");
// @ts-expect-error REFERENCES is reserved until reliable resolution exists.
acceptEdgeKind("REFERENCES");
// @ts-expect-error Revisions serialize as numbers, not SQLite string values.
acceptRevision("1");
// @ts-expect-error Content hashes serialize as text, not binary buffers.
acceptHash(new Uint8Array(32));
// @ts-expect-error IDs stay strings even if SQLite uses integer row keys.
acceptNodeId(42);
// @ts-expect-error Projects also have opaque string identities.
acceptProjectId(42);

export const change = {
  id: "1",
  projectId: project.id,
  timestamp: "2026-01-01T00:00:00Z",
  entityType: "node",
  entityId: "node:1",
  action: "deleted",
  path: "main.ts",
  beforeRevision: 1,
  afterRevision: null,
  before: null,
  after: null,
} satisfies import("@mycel/shared").ChangeEvent;
export const changesPage = {
  items: [change],
  cursor: null,
} satisfies import("@mycel/shared").ChangesPage;
export const diff = {
  changeId: "1",
  path: "main.ts",
  beforeContent: "",
  afterContent: null,
  beforeRevision: 1,
  afterRevision: null,
} satisfies import("@mycel/shared").ChangeDiff;
export function eventId(
  message: import("@mycel/shared").SseMessage,
): string | undefined {
  if (message.type === "change") return message.data.id;
  if (message.type === "architecture") return message.data.reason;
  if (message.type === "diagnostics") return String(message.data.revision);
  return message.data.status;
}
export const architecture = {
  version: 1,
  source: "agent",
  parts: [
    {
      id: "web",
      name: "Web app",
      purpose: "Browser UI for exploring the graph.",
      kind: "app",
      paths: ["apps/web/src/**"],
    },
  ],
} satisfies import("@mycel/shared").ArchitectureFile;
export const architectureIssues = {
  ok: false,
  issues: [{ path: "parts.0.kind", message: "Invalid option" }],
} satisfies import("@mycel/shared").ArchitectureFileResult;
export const architectureConnections = {
  ...architecture,
  // @ts-expect-error Connections are computed from code evidence, never declared.
  connections: [["web", "core"]],
} satisfies import("@mycel/shared").ArchitectureFile;
export const architectureAssignment = {
  parts: [
    {
      ...architecture.parts[0]!,
      files: ["apps/web/src/App.tsx"],
    },
    {
      id: "scripts",
      name: "scripts",
      purpose: "Source files in scripts.",
      kind: "library",
      paths: ["scripts/**"],
      files: ["scripts/build.ts"],
      fallback: true,
    },
  ],
  fileToPart: {
    "apps/web/src/App.tsx": "web",
    "scripts/build.ts": "scripts",
  },
  unassignedFiles: ["scripts/build.ts"],
  tieWarnings: [
    {
      path: "apps/web/src/App.tsx",
      winnerPartId: "web",
      tiedPartIds: ["web", "ui"],
      patterns: ["apps/web/src/**", "apps/web/src/**"],
    },
  ],
} satisfies import("@mycel/shared").ArchitectureAssignment;
export const architectureConnection = {
  id: "core->db",
  sourcePartId: "core",
  targetPartId: "db",
  count: 2,
  importCount: 1,
  callCount: 1,
  evidence: [
    {
      kind: "import",
      file: "packages/core/src/project.ts",
      line: 1,
      targetFile: "packages/db/src/index.ts",
    },
    {
      kind: "call",
      file: "packages/core/src/project.ts",
      line: 29,
      targetFile: "packages/db/src/database.ts",
      sourceSymbol: "openIndexedProject",
      symbol: "openDatabase",
    },
  ],
  truncated: false,
} satisfies import("@mycel/shared").ArchitectureConnection;
export const architectureGitChanges = {
  available: true,
  requestedWindow: "branch",
  resolvedWindow: "branch",
  branch: "feat/orders",
  baseRef: "main",
  baseCommit: "0123456789abcdef0123456789abcdef01234567",
  addedFiles: ["packages/orders/src/index.ts"],
  modifiedFiles: ["packages/core/src/index.ts"],
  deletedFiles: [],
  uncommittedFiles: ["packages/orders/src/index.ts"],
} satisfies import("@mycel/shared").ArchitectureGitChanges;
export const architecturePartWithChanges = {
  ...architectureAssignment.parts[0]!,
  change: {
    status: "changed",
    uncommitted: true,
    addedFiles: 0,
    modifiedFiles: 1,
    uncommittedFiles: 1,
  },
} satisfies import("@mycel/shared").ArchitecturePartWithChanges;
export const architectureConnectionWithChanges = {
  ...architectureConnection,
  change: {
    status: "new",
    uncommitted: false,
  },
} satisfies import("@mycel/shared").ArchitectureConnectionWithChanges;
export const architectureMap = {
  projectId: project.id,
  revision: 1,
  source: "agent",
  parts: [architecturePartWithChanges],
  connections: [architectureConnectionWithChanges],
  changes: architectureGitChanges,
  unassignedFiles: [],
  tieWarnings: [],
} satisfies import("@mycel/shared").ArchitectureMap;
export const architectureUpdate = {
  projectId: project.id,
  revision: 2,
  reason: "file",
  timestamp: "2026-11-18T22:00:00.000Z",
} satisfies import("@mycel/shared").ArchitectureUpdateEvent;
