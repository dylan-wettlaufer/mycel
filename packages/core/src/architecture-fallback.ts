import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { basename, join, posix } from "node:path";
import ignore from "ignore";
import type { Ignore } from "ignore";
import picomatch from "picomatch";
import { parse as parseYaml } from "yaml";
import type {
  ArchitectureFile,
  ArchitecturePart,
  ArchitecturePartKind,
} from "@mycel/shared";
import { excludedDirectories } from "./discovery.js";
import { isMissing, readRepositoryText } from "./files.js";

export interface FallbackArchitectureOptions {
  /** Honor `.gitignore` rules while scanning directories. Defaults to `true`. */
  respectGitignore?: boolean;
  /** Additional repository-relative exclusion globs. */
  exclude?: readonly string[];
  /**
   * Pre-discovered repository-relative file paths. Used by the top-level
   * folder fallback when no workspace packages are present.
   */
  filePaths?: readonly string[];
}

const maxParts = 100;

const extraExcludedDirectories = new Set([
  "target",
  "vendor",
  "__pycache__",
  "venv",
  ".venv",
  "out",
  "tmp",
]);

const sourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
  ".astro",
  ".py",
  ".pyi",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".scala",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".cs",
  ".rb",
  ".php",
  ".swift",
  ".ex",
  ".exs",
  ".zig",
  ".sql",
  ".prisma",
  ".graphql",
  ".gql",
  ".proto",
  ".sh",
]);

const auxiliaryTopLevelDirs = new Set([
  "test",
  "tests",
  "__tests__",
  "spec",
  "specs",
  "scripts",
  "examples",
  "example",
  "benchmarks",
  "benches",
  "fixtures",
  "prisma",
  "migrations",
]);

const appFrameworks = new Set([
  "next",
  "vite",
  "nuxt",
  "astro",
  "expo",
  "electron",
  "react-scripts",
  "@sveltejs/kit",
  "@remix-run/react",
]);

const appNames = new Set([
  "app",
  "web",
  "frontend",
  "client",
  "mobile",
  "desktop",
]);
const cliNames = new Set(["cli", "cmd"]);
const serviceNames = new Set([
  "server",
  "api",
  "backend",
  "service",
  "services",
  "worker",
  "workers",
  "gateway",
  "daemon",
  "proxy",
]);
const dataNames = new Set([
  "db",
  "database",
  "data",
  "storage",
  "store",
  "prisma",
  "migrations",
  "schema",
  "models",
  "persistence",
]);
const integrationNames = new Set([
  "integration",
  "integrations",
  "adapter",
  "adapters",
  "connector",
  "connectors",
  "webhook",
  "webhooks",
  "plugin",
  "plugins",
]);

interface IgnoreRules {
  base: string;
  matcher: Ignore;
}

interface CandidatePart {
  dir: string;
  preferredSlug: string;
  name: string;
  purpose: string;
  kind: ArchitecturePartKind;
  paths: string[];
}

interface ScanContext {
  root: string;
  respectGitignore: boolean;
  excluded: (path: string) => boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isExcludedDirName(name: string): boolean {
  return (
    name.startsWith(".") ||
    excludedDirectories.has(name) ||
    extraExcludedDirectories.has(name)
  );
}

function isSourceFilename(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return sourceExtensions.has(name.slice(dot).toLowerCase());
}

function isIgnored(
  path: string,
  directory: boolean,
  rules: readonly IgnoreRules[],
): boolean {
  let ignored = false;
  for (const rule of rules) {
    const relative = rule.base ? path.slice(rule.base.length + 1) : path;
    const result = rule.matcher.test(relative + (directory ? "/" : ""));
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }
  return ignored;
}

async function extendIgnoreRules(
  context: ScanContext,
  directory: string,
  rules: readonly IgnoreRules[],
): Promise<readonly IgnoreRules[]> {
  if (!context.respectGitignore) return rules;
  const ignorePath = posix.join(directory, ".gitignore");
  try {
    if (!(await lstat(join(context.root, ignorePath))).isFile()) return rules;
  } catch (error) {
    if (isMissing(error)) return rules;
    throw error;
  }
  try {
    const text = await readRepositoryText(context.root, ignorePath);
    return [
      ...rules,
      { base: directory, matcher: ignore({ ignorecase: false }).add(text) },
    ];
  } catch (error) {
    if (isMissing(error)) return rules;
    return rules;
  }
}

async function readOptionalText(
  root: string,
  path: string,
): Promise<string | undefined> {
  try {
    return await readRepositoryText(root, path);
  } catch (error) {
    if (isMissing(error)) return undefined;
    // Symlinks or unreadable files are skipped instead of breaking fallback generation.
    if (error instanceof Error) return undefined;
    throw error;
  }
}

async function isRegularFile(root: string, path: string): Promise<boolean> {
  try {
    const absolute = join(root, path);
    const info = await lstat(absolute);
    if (!info.isFile()) return false;
    return (await realpath(absolute)) === absolute;
  } catch {
    return false;
  }
}

async function isRegularDirectory(
  root: string,
  path: string,
): Promise<boolean> {
  try {
    const absolute = join(root, path);
    const info = await lstat(absolute);
    if (!info.isDirectory()) return false;
    return (await realpath(absolute)) === absolute;
  } catch {
    return false;
  }
}

function normalizeRelativePath(raw: string): string | undefined {
  let value = raw.trim().replaceAll("\\", "/");
  while (value.startsWith("./")) value = value.slice(2);
  while (value.endsWith("/")) value = value.slice(0, -1);
  if (!value || value === ".") return ".";
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) return undefined;
  const segments = value.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  )
    return undefined;
  return segments.join("/");
}

function normalizeWorkspacePattern(raw: string): string | undefined {
  let value = raw.trim().replaceAll("\\", "/");
  while (value.startsWith("./")) value = value.slice(2);
  while (value.endsWith("/")) value = value.slice(0, -1);
  if (!value || value.startsWith("/") || /^[A-Za-z]:/.test(value))
    return undefined;
  const segments = value.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  )
    return undefined;
  return segments.join("/");
}

function normalizeLine(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength - 3).trimEnd()}...`;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, 64).replace(/-+$/, "");
}

function stripScope(packageName: string): string {
  if (packageName.startsWith("@")) {
    const slash = packageName.indexOf("/");
    if (slash > 0 && slash < packageName.length - 1)
      return packageName.slice(slash + 1);
  }
  return packageName;
}

function inferKind(
  dir: string,
  name: string,
  signals: {
    hasCliBin?: boolean;
    hasBinaryTarget?: boolean;
    hasAppFramework?: boolean;
    hasLibraryEntry?: boolean;
  } = {},
): ArchitecturePartKind {
  const segments = dir.toLowerCase().split("/").filter(Boolean);
  const nameLower = name.toLowerCase();
  const base = segments.at(-1) ?? nameLower;
  const parent = segments.length > 1 ? segments[0] : undefined;

  if (
    signals.hasCliBin ||
    cliNames.has(base) ||
    cliNames.has(nameLower) ||
    parent === "cmd"
  )
    return "cli";
  if (
    parent === "apps" ||
    appNames.has(base) ||
    appNames.has(nameLower) ||
    (signals.hasAppFramework &&
      !signals.hasLibraryEntry &&
      parent !== "packages")
  )
    return "app";
  if (
    parent === "services" ||
    parent === "servers" ||
    parent === "workers" ||
    serviceNames.has(base) ||
    serviceNames.has(nameLower)
  )
    return "service";
  if (dataNames.has(base) || dataNames.has(nameLower)) return "data";
  if (
    parent === "integrations" ||
    parent === "adapters" ||
    parent === "connectors" ||
    parent === "plugins" ||
    integrationNames.has(base) ||
    integrationNames.has(nameLower)
  )
    return "integration";
  if (signals.hasBinaryTarget) return "cli";
  return "library";
}

function maxPatternDepth(patterns: readonly string[]): number | undefined {
  let max = 0;
  for (const pattern of patterns) {
    if (pattern.includes("**")) return undefined;
    const depth = pattern.split("/").length;
    if (depth > max) max = depth;
  }
  return max;
}

async function findMatchingDirectories(
  context: ScanContext,
  positivePatterns: readonly string[],
  negativePatterns: readonly string[],
  markerFile: string,
): Promise<string[]> {
  if (positivePatterns.length === 0) return [];
  const include = picomatch([...positivePatterns], { dot: false });
  const excludePattern =
    negativePatterns.length > 0
      ? picomatch([...negativePatterns], { dot: false })
      : () => false;
  const depthLimit = maxPatternDepth(positivePatterns);
  const matched: string[] = [];

  const rootRules = await extendIgnoreRules(context, "", []);
  const stack: {
    path: string;
    depth: number;
    rules: readonly IgnoreRules[];
  }[] = [{ path: "", depth: 0, rules: rootRules }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    if (depthLimit !== undefined && current.depth >= depthLimit) continue;

    const absoluteDir = join(context.root, current.path);
    let children;
    try {
      if ((await realpath(absoluteDir)) !== absoluteDir) continue;
      children = await readdir(absoluteDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const child of children) {
      if (!child.isDirectory() || child.isSymbolicLink()) continue;
      if (child.name.includes("\\") || isExcludedDirName(child.name)) continue;
      const childPath = posix.join(current.path, child.name);
      if (
        context.excluded(childPath) ||
        context.excluded(`${childPath}/`) ||
        isIgnored(childPath, true, current.rules)
      )
        continue;

      if (include(childPath) && !excludePattern(childPath)) {
        if (
          await isRegularFile(context.root, posix.join(childPath, markerFile))
        )
          matched.push(childPath);
      }

      const nextDepth = current.depth + 1;
      if (depthLimit === undefined || nextDepth < depthLimit) {
        const nextRules = await extendIgnoreRules(
          context,
          childPath,
          current.rules,
        );
        stack.push({ path: childPath, depth: nextDepth, rules: nextRules });
      }
    }
  }

  return matched.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

async function discoverJsWorkspacePackages(
  context: ScanContext,
): Promise<CandidatePart[]> {
  let rawPatterns: string[] | undefined;

  for (const filename of ["pnpm-workspace.yaml", "pnpm-workspace.yml"]) {
    const text = await readOptionalText(context.root, filename);
    if (text === undefined) continue;
    try {
      const parsed: unknown = parseYaml(text);
      if (isRecord(parsed) && Array.isArray(parsed.packages)) {
        rawPatterns = stringArray(parsed.packages);
        break;
      }
    } catch {
      // Malformed pnpm-workspace.yaml; fall through to other workspace manifests.
    }
  }

  if (rawPatterns === undefined) {
    const pkgText = await readOptionalText(context.root, "package.json");
    if (pkgText !== undefined) {
      try {
        const parsed: unknown = JSON.parse(pkgText);
        if (isRecord(parsed)) {
          const workspaces = isRecord(parsed.workspaces)
            ? parsed.workspaces.packages
            : parsed.workspaces;
          if (Array.isArray(workspaces)) rawPatterns = stringArray(workspaces);
        }
      } catch {
        // Malformed root package.json.
      }
    }
  }

  if (!rawPatterns || rawPatterns.length === 0) return [];

  const positive: string[] = [];
  const negative: string[] = [];
  for (const pattern of rawPatterns) {
    const trimmed = pattern.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("!")) {
      const normalized = normalizeWorkspacePattern(trimmed.slice(1));
      if (normalized) negative.push(normalized);
    } else {
      const normalized = normalizeWorkspacePattern(trimmed);
      if (normalized) positive.push(normalized);
    }
  }

  const dirs = await findMatchingDirectories(
    context,
    positive,
    negative,
    "package.json",
  );
  const parts: CandidatePart[] = [];

  for (const dir of dirs) {
    const text = await readOptionalText(
      context.root,
      posix.join(dir, "package.json"),
    );
    let manifest: Record<string, unknown> | undefined;
    if (text !== undefined) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (isRecord(parsed)) manifest = parsed;
      } catch {
        // Use folder defaults when a package manifest is malformed.
      }
    }

    const rawName =
      typeof manifest?.name === "string" && manifest.name.trim()
        ? stripScope(manifest.name.trim())
        : posix.basename(dir);
    const name = normalizeLine(rawName, 80) || posix.basename(dir);
    const rawDescription =
      typeof manifest?.description === "string"
        ? normalizeLine(manifest.description, 200)
        : "";
    const purpose =
      rawDescription || normalizeLine(`Workspace package at ${dir}.`, 200);

    const hasCliBin =
      (typeof manifest?.bin === "string" && manifest.bin.trim().length > 0) ||
      (isRecord(manifest?.bin) && Object.keys(manifest.bin).length > 0);
    const deps = [
      manifest?.dependencies,
      manifest?.devDependencies,
      manifest?.peerDependencies,
    ].filter(isRecord);
    const hasAppFramework = deps.some((record) =>
      Object.keys(record).some((dep) => appFrameworks.has(dep)),
    );
    const hasLibraryEntry =
      manifest?.exports !== undefined ||
      typeof manifest?.main === "string" ||
      typeof manifest?.types === "string";

    parts.push({
      dir,
      preferredSlug: rawName,
      name,
      purpose,
      kind: inferKind(dir, name, {
        hasCliBin,
        hasAppFramework,
        hasLibraryEntry,
      }),
      paths: [`${dir}/**`],
    });
  }

  return parts;
}

function stripTomlComment(line: string): string {
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote === '"') {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        quote = undefined;
      }
    } else if (quote === "'") {
      if (ch === "'") quote = undefined;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#") {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseTomlStringValue(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length < 2) return undefined;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const value: unknown = JSON.parse(trimmed);
      return typeof value === "string" ? value : undefined;
    } catch {
      return undefined;
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return undefined;
}

function parseTomlStringArray(raw: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i]!;
    if (ch === '"') {
      let end = i + 1;
      let escaped = false;
      while (end < raw.length) {
        const current = raw[end]!;
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === '"') break;
        end++;
      }
      if (end < raw.length) {
        const parsed = parseTomlStringValue(raw.slice(i, end + 1));
        if (parsed !== undefined) result.push(parsed);
        i = end + 1;
        continue;
      }
      break;
    }
    if (ch === "'") {
      const end = raw.indexOf("'", i + 1);
      if (end > i) {
        result.push(raw.slice(i + 1, end));
        i = end + 1;
        continue;
      }
      break;
    }
    i++;
  }
  return result;
}

function parseTomlSections(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let currentSection = "";
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const cleaned = stripTomlComment(lines[i]!).trim();
    if (!cleaned) continue;

    if (cleaned.startsWith("[")) {
      const match = /^\[\[?\s*([^\]\s]+)\s*\]\]?$/.exec(cleaned);
      currentSection = match ? match[1]! : "";
      if (currentSection && !sections.has(currentSection)) {
        sections.set(currentSection, new Map());
      }
      continue;
    }

    const eq = cleaned.indexOf("=");
    if (eq <= 0) continue;
    const key = cleaned.slice(0, eq).trim();
    let value = cleaned.slice(eq + 1).trim();

    if (value.startsWith("[") && !value.includes("]")) {
      while (i + 1 < lines.length) {
        i++;
        const next = stripTomlComment(lines[i]!).trim();
        value += ` ${next}`;
        if (next.includes("]")) break;
      }
    }

    let entries = sections.get(currentSection);
    if (!entries) {
      entries = new Map();
      sections.set(currentSection, entries);
    }
    if (!entries.has(key)) entries.set(key, value);
  }

  return sections;
}

async function discoverCargoWorkspacePackages(
  context: ScanContext,
): Promise<CandidatePart[]> {
  const text = await readOptionalText(context.root, "Cargo.toml");
  if (text === undefined) return [];

  const sections = parseTomlSections(text);
  const workspace = sections.get("workspace");
  if (!workspace) return [];

  const rawMembers = workspace.get("members");
  if (!rawMembers) return [];
  const members = parseTomlStringArray(rawMembers);
  if (members.length === 0) return [];

  const rawExcludes = workspace.get("exclude");
  const excludes = rawExcludes ? parseTomlStringArray(rawExcludes) : [];

  const positive: string[] = [];
  let includesRoot = false;
  for (const member of members) {
    const trimmed = member.trim();
    if (trimmed === "." || trimmed === "./") {
      includesRoot = true;
      continue;
    }
    const normalized = normalizeWorkspacePattern(trimmed);
    if (normalized) positive.push(normalized);
  }

  const negative: string[] = [];
  for (const excluded of excludes) {
    const normalized = normalizeWorkspacePattern(excluded);
    if (normalized) negative.push(normalized);
  }

  const dirs = await findMatchingDirectories(
    context,
    positive,
    negative,
    "Cargo.toml",
  );
  if (dirs.length === 0) return [];

  const parts: CandidatePart[] = [];

  const rootExcluded = excludes.some(
    (entry) => entry.trim() === "." || entry.trim() === "./",
  );
  if (
    (includesRoot || sections.has("package")) &&
    !rootExcluded &&
    (await isRegularDirectory(context.root, "src"))
  ) {
    const rootPkg = sections.get("package");
    const rawName =
      (rootPkg?.get("name")
        ? parseTomlStringValue(rootPkg.get("name")!)
        : undefined) ?? basename(context.root);
    const name = normalizeLine(rawName, 80) || "root";
    const rawDescription = rootPkg?.get("description")
      ? parseTomlStringValue(rootPkg.get("description")!)
      : undefined;
    const purpose =
      (rawDescription ? normalizeLine(rawDescription, 200) : "") ||
      "Root Cargo workspace package.";
    const hasBinaryTarget =
      sections.has("bin") || (await isRegularFile(context.root, "src/main.rs"));
    parts.push({
      dir: "src",
      preferredSlug: rawName,
      name,
      purpose,
      kind: inferKind("src", name, { hasBinaryTarget }),
      paths: ["src/**"],
    });
  }

  for (const dir of dirs) {
    const memberText = await readOptionalText(
      context.root,
      posix.join(dir, "Cargo.toml"),
    );
    const memberSections = memberText
      ? parseTomlSections(memberText)
      : new Map<string, Map<string, string>>();
    const pkg = memberSections.get("package");
    const rawName =
      (pkg?.get("name") ? parseTomlStringValue(pkg.get("name")!) : undefined) ??
      posix.basename(dir);
    const name = normalizeLine(rawName, 80) || posix.basename(dir);
    const rawDescription = pkg?.get("description")
      ? parseTomlStringValue(pkg.get("description")!)
      : undefined;
    const purpose =
      (rawDescription ? normalizeLine(rawDescription, 200) : "") ||
      normalizeLine(`Workspace package at ${dir}.`, 200);
    const hasBinaryTarget =
      memberSections.has("bin") ||
      (await isRegularFile(context.root, posix.join(dir, "src/main.rs")));

    parts.push({
      dir,
      preferredSlug: rawName,
      name,
      purpose,
      kind: inferKind(dir, name, { hasBinaryTarget }),
      paths: [`${dir}/**`],
    });
  }

  return parts;
}

function stripGoComment(line: string): string {
  let quote: '"' | "`" | undefined;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quote = undefined;
    } else if (quote === "`") {
      if (ch === "`") quote = undefined;
    } else if (ch === '"' || ch === "`") {
      quote = ch;
    } else if (ch === "/" && line[i + 1] === "/") {
      return line.slice(0, i);
    }
  }
  return line;
}

function unquoteGoToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("`") && trimmed.endsWith("`")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseGoWorkUses(text: string): string[] {
  const uses: string[] = [];
  let inUseBlock = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripGoComment(rawLine).trim();
    if (!line) continue;

    if (inUseBlock) {
      if (line === ")") {
        inUseBlock = false;
        continue;
      }
      const closeIndex = line.indexOf(")");
      const content = closeIndex >= 0 ? line.slice(0, closeIndex).trim() : line;
      if (content) uses.push(unquoteGoToken(content));
      if (closeIndex >= 0) inUseBlock = false;
      continue;
    }

    const blockStart = /^use\s*\((.*)$/.exec(line);
    if (blockStart) {
      const rest = blockStart[1]!.trim();
      const closeIndex = rest.indexOf(")");
      if (closeIndex >= 0) {
        const inline = rest.slice(0, closeIndex).trim();
        if (inline) uses.push(unquoteGoToken(inline));
      } else {
        if (rest) uses.push(unquoteGoToken(rest));
        inUseBlock = true;
      }
      continue;
    }

    const single = /^use\s+(.+)$/.exec(line);
    if (single) {
      uses.push(unquoteGoToken(single[1]!));
    }
  }

  return uses;
}

function parseGoModuleName(goModText: string): string | undefined {
  for (const rawLine of goModText.split(/\r?\n/)) {
    const line = stripGoComment(rawLine).trim();
    const match = /^module\s+(.+)$/.exec(line);
    if (match) {
      const modulePath = unquoteGoToken(match[1]!);
      const last = modulePath.split("/").filter(Boolean).at(-1);
      if (last) return last;
    }
  }
  return undefined;
}

async function discoverGoWorkspacePackages(
  context: ScanContext,
): Promise<CandidatePart[]> {
  const text = await readOptionalText(context.root, "go.work");
  if (text === undefined) return [];

  const rootRules = await extendIgnoreRules(context, "", []);
  const uses = parseGoWorkUses(text);
  const dirs = new Set<string>();
  for (const rawUse of uses) {
    const normalized = normalizeRelativePath(rawUse);
    if (!normalized || normalized === ".") continue;
    if (normalized.split("/").some((segment) => isExcludedDirName(segment)))
      continue;
    if (
      context.excluded(normalized) ||
      context.excluded(`${normalized}/`) ||
      isIgnored(normalized, true, rootRules)
    )
      continue;
    if (
      (await isRegularDirectory(context.root, normalized)) &&
      (await isRegularFile(context.root, posix.join(normalized, "go.mod")))
    ) {
      dirs.add(normalized);
    }
  }

  const sortedDirs = [...dirs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const parts: CandidatePart[] = [];

  for (const dir of sortedDirs) {
    const goMod = await readOptionalText(
      context.root,
      posix.join(dir, "go.mod"),
    );
    const modName = goMod ? parseGoModuleName(goMod) : undefined;
    const rawName = modName ?? posix.basename(dir);
    const name = normalizeLine(rawName, 80) || posix.basename(dir);
    const purpose = normalizeLine(`Workspace package at ${dir}.`, 200);
    parts.push({
      dir,
      preferredSlug: rawName,
      name,
      purpose,
      kind: inferKind(dir, name),
      paths: [`${dir}/**`],
    });
  }

  return parts;
}

async function directoryHasSourceFile(
  context: ScanContext,
  directory: string,
  initialRules: readonly IgnoreRules[],
): Promise<boolean> {
  const stack: { path: string; rules: readonly IgnoreRules[] }[] = [
    { path: directory, rules: initialRules },
  ];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;

    const absoluteDir = join(context.root, current.path);
    let children;
    try {
      if ((await realpath(absoluteDir)) !== absoluteDir) continue;
      children = await readdir(absoluteDir, { withFileTypes: true });
    } catch {
      continue;
    }

    const rules = await extendIgnoreRules(context, current.path, current.rules);
    for (const child of children) {
      if (child.isSymbolicLink() || child.name.includes("\\")) continue;
      const childPath = posix.join(current.path, child.name);
      if (child.isFile()) {
        if (
          !isSourceFilename(child.name) ||
          context.excluded(childPath) ||
          isIgnored(childPath, false, rules)
        )
          continue;
        return true;
      }
      if (child.isDirectory()) {
        if (
          isExcludedDirName(child.name) ||
          context.excluded(childPath) ||
          context.excluded(`${childPath}/`) ||
          isIgnored(childPath, true, rules)
        )
          continue;
        stack.push({ path: childPath, rules });
      }
    }
  }

  return false;
}

function makeFolderCandidate(
  dir: string,
  options: { directOnly?: boolean } = {},
): CandidatePart {
  const base = posix.basename(dir);
  const name = normalizeLine(base, 80) || "part";
  const purpose = options.directOnly
    ? normalizeLine(`Top-level source files in ${dir}.`, 200)
    : normalizeLine(`Source files in ${dir}.`, 200);
  return {
    dir,
    preferredSlug: base,
    name,
    purpose,
    kind: inferKind(dir, name),
    paths: [options.directOnly ? `${dir}/*` : `${dir}/**`],
  };
}

function makeRootCandidate(root: string): CandidatePart {
  const base = basename(root);
  const name = normalizeLine(base, 80) || "root";
  return {
    dir: "",
    preferredSlug: "root",
    name,
    purpose: "Source files at the repository root.",
    kind: "app",
    paths: ["**"],
  };
}

function discoverFoldersFromPaths(
  context: ScanContext,
  filePaths: readonly string[],
): CandidatePart[] {
  const topDirs = new Set<string>();
  const srcSubdirs = new Set<string>();
  let hasRootFiles = false;
  let hasDirectSrcFiles = false;

  for (const rawPath of filePaths) {
    const normalized = normalizeRelativePath(rawPath);
    if (!normalized || normalized === ".") continue;
    if (context.excluded(normalized)) continue;
    const segments = normalized.split("/");
    if (segments.length === 1) {
      hasRootFiles = true;
      continue;
    }
    const top = segments[0]!;
    if (isExcludedDirName(top) || context.excluded(`${top}/`)) continue;
    topDirs.add(top);
    if (top === "src") {
      if (segments.length === 2) {
        hasDirectSrcFiles = true;
      } else if (
        !isExcludedDirName(segments[1]!) &&
        !context.excluded(`src/${segments[1]!}/`)
      ) {
        srcSubdirs.add(segments[1]!);
      }
    }
  }

  if (topDirs.size === 0) {
    return hasRootFiles ? [makeRootCandidate(context.root)] : [];
  }

  const shouldUnwrapSrc =
    topDirs.has("src") &&
    srcSubdirs.size >= 2 &&
    [...topDirs].every(
      (dir) => dir === "src" || auxiliaryTopLevelDirs.has(dir),
    );

  const candidates: CandidatePart[] = [];
  for (const dir of [...topDirs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (dir === "src" && shouldUnwrapSrc) {
      if (hasDirectSrcFiles)
        candidates.push(makeFolderCandidate("src", { directOnly: true }));
      for (const sub of [...srcSubdirs].sort((a, b) =>
        a < b ? -1 : a > b ? 1 : 0,
      )) {
        candidates.push(makeFolderCandidate(`src/${sub}`));
      }
    } else {
      candidates.push(makeFolderCandidate(dir));
    }
  }

  return candidates;
}

async function discoverTopLevelSourceFolders(
  context: ScanContext,
): Promise<CandidatePart[]> {
  const rootRules = await extendIgnoreRules(context, "", []);
  let entries;
  try {
    entries = await readdir(context.root, { withFileTypes: true });
  } catch {
    return [];
  }

  let hasRootSourceFile = false;
  const topSourceDirs: string[] = [];

  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.name.includes("\\")) continue;
    if (entry.isFile()) {
      if (
        isSourceFilename(entry.name) &&
        !context.excluded(entry.name) &&
        !isIgnored(entry.name, false, rootRules)
      ) {
        hasRootSourceFile = true;
      }
      continue;
    }
    if (!entry.isDirectory() || isExcludedDirName(entry.name)) continue;
    if (
      context.excluded(entry.name) ||
      context.excluded(`${entry.name}/`) ||
      isIgnored(entry.name, true, rootRules)
    )
      continue;

    if (await directoryHasSourceFile(context, entry.name, rootRules)) {
      topSourceDirs.push(entry.name);
    }
  }

  topSourceDirs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  if (topSourceDirs.length === 0) {
    return hasRootSourceFile ? [makeRootCandidate(context.root)] : [];
  }

  const canUnwrapSrc =
    topSourceDirs.includes("src") &&
    topSourceDirs.every(
      (dir) => dir === "src" || auxiliaryTopLevelDirs.has(dir),
    );

  let srcSubdirs: string[] = [];
  let hasDirectSrcFiles = false;
  if (canUnwrapSrc) {
    const srcRules = await extendIgnoreRules(context, "src", rootRules);
    try {
      const srcEntries = await readdir(join(context.root, "src"), {
        withFileTypes: true,
      });
      for (const entry of srcEntries) {
        if (entry.isSymbolicLink() || entry.name.includes("\\")) continue;
        const entryPath = posix.join("src", entry.name);
        if (entry.isFile()) {
          if (
            isSourceFilename(entry.name) &&
            !context.excluded(entryPath) &&
            !isIgnored(entryPath, false, srcRules)
          ) {
            hasDirectSrcFiles = true;
          }
          continue;
        }
        if (!entry.isDirectory() || isExcludedDirName(entry.name)) continue;
        if (
          context.excluded(entryPath) ||
          context.excluded(`${entryPath}/`) ||
          isIgnored(entryPath, true, srcRules)
        )
          continue;
        if (await directoryHasSourceFile(context, entryPath, srcRules)) {
          srcSubdirs.push(entry.name);
        }
      }
    } catch {
      srcSubdirs = [];
    }
  }

  srcSubdirs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const shouldUnwrapSrc = canUnwrapSrc && srcSubdirs.length >= 2;

  const candidates: CandidatePart[] = [];
  for (const dir of topSourceDirs) {
    if (dir === "src" && shouldUnwrapSrc) {
      if (hasDirectSrcFiles)
        candidates.push(makeFolderCandidate("src", { directOnly: true }));
      for (const sub of srcSubdirs) {
        candidates.push(makeFolderCandidate(`src/${sub}`));
      }
    } else {
      candidates.push(makeFolderCandidate(dir));
    }
  }

  return candidates;
}

function finalizeParts(
  candidates: readonly CandidatePart[],
): ArchitecturePart[] {
  const ordered = [...candidates].sort((a, b) =>
    a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0,
  );
  const limited = ordered.slice(0, maxParts);

  const baseSlugs = limited.map(
    (candidate) =>
      slugify(candidate.preferredSlug) || slugify(candidate.dir) || "part",
  );
  const counts = new Map<string, number>();
  for (const slug of baseSlugs) {
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }

  const usedIds = new Set<string>();
  const parts: ArchitecturePart[] = [];

  for (let i = 0; i < limited.length; i++) {
    const candidate = limited[i]!;
    const base = baseSlugs[i]!;
    let id =
      (counts.get(base) ?? 0) > 1 ? slugify(candidate.dir) || base : base;

    if (usedIds.has(id)) {
      let suffix = 2;
      while (true) {
        const suffixText = `-${suffix}`;
        const prefix = id
          .slice(0, Math.max(1, 64 - suffixText.length))
          .replace(/-+$/, "");
        const nextId = `${prefix || "part"}${suffixText}`;
        if (!usedIds.has(nextId)) {
          id = nextId;
          break;
        }
        suffix++;
      }
    }
    usedIds.add(id);

    parts.push({
      id,
      name: candidate.name,
      purpose: candidate.purpose,
      kind: candidate.kind,
      paths: candidate.paths,
    });
  }

  return parts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Generate a fallback architecture definition when `.mycel/architecture.json`
 * is absent. Prefers workspace packages (pnpm, npm, Cargo, Go) and falls back
 * to top-level source folders.
 */
export async function buildFallbackArchitecture(
  projectRoot: string,
  options: FallbackArchitectureOptions = {},
): Promise<ArchitectureFile> {
  if (typeof projectRoot !== "string" || !projectRoot)
    throw new TypeError("A project root is required");
  const root = await realpath(projectRoot);
  if (!(await stat(root)).isDirectory())
    throw new Error("Project root must be a directory");

  const excludePatterns = options.exclude ?? [];
  if (
    excludePatterns.some(
      (pattern) =>
        typeof pattern !== "string" || !pattern || pattern.includes("\0"),
    )
  ) {
    throw new TypeError("Exclusions must be nonempty glob strings");
  }

  const excluded =
    excludePatterns.length > 0
      ? picomatch([...excludePatterns], {
          dot: true,
          nonegate: true,
          strictBrackets: true,
        })
      : () => false;

  const context: ScanContext = {
    root,
    respectGitignore: options.respectGitignore ?? true,
    excluded,
  };

  const [jsPackages, cargoPackages, goPackages] = await Promise.all([
    discoverJsWorkspacePackages(context),
    discoverCargoWorkspacePackages(context),
    discoverGoWorkspacePackages(context),
  ]);

  const workspaceByDir = new Map<string, CandidatePart>();
  for (const pkg of [...jsPackages, ...cargoPackages, ...goPackages]) {
    if (!workspaceByDir.has(pkg.dir)) workspaceByDir.set(pkg.dir, pkg);
  }

  const candidates =
    workspaceByDir.size > 0
      ? [...workspaceByDir.values()]
      : options.filePaths !== undefined
        ? discoverFoldersFromPaths(context, options.filePaths)
        : await discoverTopLevelSourceFolders(context);

  return {
    version: 1,
    source: "folder-fallback",
    parts: finalizeParts(candidates),
  };
}
