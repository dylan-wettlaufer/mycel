import { parsePrismaSchema, unknownSchema } from "./prisma-schema.js";
import type { PrismaSchema } from "./prisma-schema.js";
import { posix } from "node:path";
import ts from "typescript";
import { parse as parseYaml } from "yaml";
import picomatch from "picomatch";
import type { Diagnostic } from "@mycel/shared";
import { isMissing, readRepositoryText } from "./files.js";

export interface ModuleResolver {
  resolve(from: string, specifier: string): string | undefined;
  isLocal(from: string, specifier: string): boolean;
  diagnostics: Diagnostic[];
  prismaSchema?(from: string): PrismaSchema;
  packageRoot?(from: string): string | undefined;
  /** Nearest owning package directory, only when it declares this dependency. */
  dependencyRoot?(from: string, dependency: string): string | undefined;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
function inside(path: string, directory: string) {
  return path === directory || path.startsWith(`${directory}/`);
}
function matchesAlias(pattern: string, name: string) {
  const index = pattern.indexOf("*");
  return index < 0
    ? pattern === name
    : name.startsWith(pattern.slice(0, index)) &&
        name.endsWith(pattern.slice(index + 1)) &&
        name.length >= pattern.length - 1;
}

/** Capture config as data, then resolve exclusively against indexed source and manifests. */
export async function loadModuleResolver(
  root: string,
  sourcePaths: readonly string[],
  metadataPaths: readonly string[],
): Promise<ModuleResolver> {
  // Virtual POSIX paths also make resolution independent of the host platform.
  const base = "/repository";
  const absolute = (path: string) => posix.join(base, path);
  const sources = new Set(sourcePaths.map(absolute));
  const metadata = new Map<string, string>();
  const available = new Set(metadataPaths);
  const diagnostics: Diagnostic[] = [];
  function report(path: string, message: string) {
    diagnostics.push({
      path,
      source: "resolver",
      severity: "warning",
      code: "resolution-config",
      message,
      range: {
        start: 0,
        end: 0,
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 1,
      },
    });
  }
  const pending = metadataPaths.filter((path) =>
    /(^|\/)(package\.json|tsconfig[^/]*\.json|pnpm-workspace\.ya?ml|prisma\.config\.[cm]?[jt]s|[^/]+\.prisma)$/.test(
      path,
    ),
  );
  for (let index = 0; index < pending.length; index++) {
    const path = pending[index]!;
    if (metadata.has(absolute(path)) || !available.has(path)) continue;
    let text: string;
    try {
      text = await readRepositoryText(root, path);
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    metadata.set(absolute(path), text);
    if (path.endsWith(".json") && !path.endsWith("package.json")) {
      const raw: unknown = ts.parseConfigFileTextToJson(path, text).config;
      if (record(raw))
        for (const entry of typeof raw.extends === "string"
          ? [raw.extends]
          : strings(raw.extends)) {
          if (!entry.startsWith(".")) continue;
          const target = posix.normalize(
            posix.join(posix.dirname(path), entry),
          );
          const candidate = available.has(target) ? target : `${target}.json`;
          if (available.has(candidate)) pending.push(candidate);
        }
    }
  }
  // Parse includes/excludes against the captured source list, never node_modules or disk.
  const parseHost: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: true,
    readFile: (path) => metadata.get(posix.normalize(path)),
    fileExists: (path) =>
      metadata.has(posix.normalize(path)) || sources.has(posix.normalize(path)),
    readDirectory: (directory, extensions, excludes, includes) => {
      const pattern = (value: string) => {
        const path = posix.resolve(directory, value);
        return /[*?[\]{}]/.test(path) || /\.[^/]+$/.test(path)
          ? path
          : `${path}/**/*`;
      };
      const include = picomatch((includes ?? ["**/*"]).map(pattern), {
        dot: true,
      });
      const exclude = picomatch((excludes ?? []).map(pattern), { dot: true });
      return [...sources].filter(
        (path) =>
          inside(path, directory) &&
          (!extensions ||
            extensions.some((extension) => path.endsWith(extension))) &&
          include(path) &&
          !exclude(path),
      );
    },
  };
  const configs = new Map<string, ts.ParsedCommandLine>();
  for (const [path, text] of metadata) {
    if (!path.endsWith(".json") || path.endsWith("package.json")) continue;
    const parsed = ts.parseConfigFileTextToJson(path, text);
    if (parsed.error) {
      report(
        posix.relative(base, path),
        ts.flattenDiagnosticMessageText(parsed.error.messageText, " "),
      );
      continue;
    }
    const config = ts.parseJsonConfigFileContent(
      parsed.config,
      parseHost,
      posix.dirname(path),
      undefined,
      path,
    );
    configs.set(path, config);
    for (const error of config.errors.filter(
      (error) => error.code !== 18003 && error.code !== 18002,
    ))
      report(
        posix.relative(base, path),
        ts.flattenDiagnosticMessageText(error.messageText, " "),
      );
  }
  function referencedOptions(
    config: ts.ParsedCommandLine,
    path: string,
    seen = new Set<ts.ParsedCommandLine>(),
  ): ts.CompilerOptions | undefined {
    if (seen.has(config)) return;
    seen.add(config);
    for (const reference of config.projectReferences ?? []) {
      const child =
        configs.get(reference.path) ??
        configs.get(posix.join(reference.path, "tsconfig.json"));
      if (!child) continue;
      const nested = referencedOptions(child, path, seen);
      if (nested) return nested;
      if (child.fileNames.includes(path)) return child.options;
    }
  }
  const optionsByFile = new Map<string, ts.CompilerOptions>();
  function configFor(path: string): ts.CompilerOptions {
    const cached = optionsByFile.get(path);
    if (cached) return cached;
    for (
      let directory = posix.dirname(path);
      inside(directory, base);
      directory = posix.dirname(directory)
    ) {
      const config = configs.get(posix.join(directory, "tsconfig.json"));
      if (!config) continue;
      const options = referencedOptions(config, path) ?? config.options;
      optionsByFile.set(path, options);
      return options;
    }
    return {};
  }
  const manifests = new Map<string, Record<string, unknown>>();
  for (const [path, text] of metadata) {
    if (!path.endsWith("/package.json")) continue;
    try {
      const value: unknown = JSON.parse(text);
      if (record(value)) manifests.set(posix.dirname(path), value);
      else
        report(
          posix.relative(base, path),
          "Expected a package manifest object",
        );
    } catch {
      report(posix.relative(base, path), "Invalid package.json");
    }
  }
  const rootManifest = manifests.get(base);
  let workspacePatterns = strings(
    record(rootManifest?.workspaces)
      ? rootManifest.workspaces.packages
      : rootManifest?.workspaces,
  );
  for (const name of ["pnpm-workspace.yaml", "pnpm-workspace.yml"]) {
    const text = metadata.get(absolute(name));
    if (!text) continue;
    try {
      const yaml: unknown = parseYaml(text);
      if (record(yaml)) workspacePatterns = strings(yaml.packages);
    } catch {
      report(name, "Invalid workspace configuration");
    }
  }
  const includePackage = picomatch(
    workspacePatterns.filter((pattern) => !pattern.startsWith("!")),
    { dot: true },
  );
  const excludePackage = picomatch(
    workspacePatterns
      .filter((pattern) => pattern.startsWith("!"))
      .map((pattern) => pattern.slice(1)),
    { dot: true },
  );
  const packages = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const [directory, manifest] of manifests) {
    const path = posix.relative(base, directory);
    if (directory !== base && (!includePackage(path) || excludePackage(path)))
      continue;
    if (
      typeof manifest.name !== "string" ||
      !/^(?:@[^/]+\/)?[^/]+$/.test(manifest.name)
    )
      continue;
    if (packages.has(manifest.name) || ambiguous.has(manifest.name)) {
      packages.delete(manifest.name);
      ambiguous.add(manifest.name);
      report(
        posix.relative(base, posix.join(directory, "package.json")),
        `Ambiguous workspace package: ${manifest.name}`,
      );
    } else packages.set(manifest.name, directory);
  }
  // Mirror emitted entry points back to indexed source even before packages are built.
  const outputs = new Map<string, string>();
  for (const source of sources) {
    if (source.endsWith(".d.ts")) continue;
    const options = configFor(source);
    if (!options.outDir) continue;
    let sourceRoot = options.rootDir;
    if (!sourceRoot) {
      const configDirectory = [...configs.keys()]
        .filter((path) => inside(source, posix.dirname(path)))
        .map(posix.dirname)
        .sort((a, b) => b.length - a.length)[0];
      const siblings = [...sources].filter(
        (path) =>
          !path.endsWith(".d.ts") &&
          configDirectory &&
          inside(path, configDirectory),
      );
      sourceRoot = siblings.reduce((common, path) => {
        while (!inside(path, common)) common = posix.dirname(common);
        return common;
      }, posix.dirname(source));
    }
    if (!inside(source, sourceRoot)) continue;
    const relative = posix.relative(sourceRoot, source).replace(/\.tsx?$/, "");
    for (const directory of [options.outDir, options.declarationDir].filter(
      (value): value is string => Boolean(value),
    ))
      for (const extension of [".js", ".jsx", ".d.ts"])
        outputs.set(posix.join(directory, relative + extension), source);
  }
  // Bundlers can declare an explicit source entry without a tsc outDir.
  const entryTargets = (value: unknown): string[] =>
    typeof value === "string"
      ? [value]
      : record(value)
        ? Object.values(value).flatMap(entryTargets)
        : [];
  for (const [directory, manifest] of manifests) {
    if (typeof manifest.source !== "string") continue;
    const source = posix.resolve(directory, manifest.source);
    if (!sources.has(source)) continue;
    const exports =
      record(manifest.exports) &&
      Object.keys(manifest.exports).some((key) => key.startsWith("."))
        ? manifest.exports["."]
        : manifest.exports;
    for (const target of [
      ...entryTargets(exports),
      ...[manifest.main, manifest.types, manifest.typings, "index.js"].filter(
        (value): value is string => typeof value === "string",
      ),
    ]) {
      const path = posix.resolve(directory, target);
      if (inside(path, directory)) outputs.set(path, source);
    }
  }
  function workspacePath(path: string): string {
    const normalized = posix.normalize(path);
    const marker = normalized.lastIndexOf("/node_modules/");
    if (marker < 0) return normalized;
    const parts = normalized.slice(marker + 14).split("/");
    const length = parts[0]?.startsWith("@") ? 2 : 1;
    const name = parts.slice(0, length).join("/");
    const directory = packages.get(name);
    return directory
      ? posix.join(directory, ...parts.slice(length))
      : normalized;
  }
  const directories = new Set<string>();
  for (const path of [...sources, ...metadata.keys(), ...outputs.keys()])
    for (
      let directory = posix.dirname(path);
      inside(directory, base);
      directory = posix.dirname(directory)
    )
      directories.add(directory);
  const host: ts.ModuleResolutionHost = {
    fileExists: (path) => {
      const actual = workspacePath(path);
      return sources.has(actual) || metadata.has(actual) || outputs.has(actual);
    },
    readFile: (path) => metadata.get(workspacePath(path)),
    directoryExists: (path) => {
      const normalized = posix.normalize(path);
      if (normalized.endsWith("/node_modules")) return packages.size > 0;
      if (/\/node_modules\/@[^/]+$/.test(normalized))
        return [...packages.keys()].some((name) =>
          name.startsWith(`${posix.basename(normalized)}/`),
        );
      return directories.has(workspacePath(path));
    },
    realpath: workspacePath,
    getCurrentDirectory: () => base,
    useCaseSensitiveFileNames: true,
  };
  const cache = new Map<string, string | undefined>();
  return {
    diagnostics,
    prismaSchema(from) {
      let directory = posix.dirname(absolute(from));
      while (
        inside(directory, base) &&
        !metadata.has(posix.join(directory, "package.json"))
      )
        directory = posix.dirname(directory);
      if (!inside(directory, base)) directory = base;
      if (
        [
          "prisma.config.ts",
          "prisma.config.js",
          "prisma.config.mts",
          "prisma.config.cts",
          "prisma.config.mjs",
          "prisma.config.cjs",
        ].some((name) => metadata.has(posix.join(directory, name)))
      )
        return unknownSchema(
          "unsupported-prisma-config",
          "Runtime Prisma configuration is not evaluated by this adapter.",
        );
      const manifest = manifests.get(directory);
      if (record(manifest?.prisma) && manifest.prisma.schema !== undefined)
        return unknownSchema(
          "unsupported-prisma-config",
          "Custom schema locations are not supported by this adapter.",
        );
      const paths = [
        posix.join(directory, "prisma/schema.prisma"),
        posix.join(directory, "schema.prisma"),
      ].filter((path) => metadata.has(path));
      if (paths.length !== 1)
        return unknownSchema(
          "unresolved-prisma-schema",
          "Exactly one conventional single-file Prisma schema must be captured.",
        );
      const path = paths[0]!;
      return parsePrismaSchema(posix.relative(base, path), metadata.get(path)!);
    },
    packageRoot(from) {
      for (
        let directory = posix.dirname(absolute(from));
        inside(directory, base);
        directory = posix.dirname(directory)
      )
        if (metadata.has(posix.join(directory, "package.json")))
          return posix.relative(base, directory);
    },
    dependencyRoot(from, dependency) {
      for (
        let directory = posix.dirname(absolute(from));
        inside(directory, base);
        directory = posix.dirname(directory)
      ) {
        const path = posix.join(directory, "package.json");
        if (!metadata.has(path)) continue;
        const manifest = manifests.get(directory);
        const declared = [
          manifest?.dependencies,
          manifest?.devDependencies,
          manifest?.peerDependencies,
          manifest?.optionalDependencies,
        ].some(
          (dependencies) =>
            record(dependencies) &&
            typeof dependencies[dependency] === "string",
        );
        return declared ? posix.relative(base, directory) : undefined;
      }
    },
    resolve(from, specifier) {
      const key = JSON.stringify([from, specifier]);
      if (cache.has(key)) return cache.get(key);
      const options = configFor(absolute(from));
      const resolved = ts.resolveModuleName(
        specifier,
        absolute(from),
        {
          ...options,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          customConditions: ["source", ...(options.customConditions ?? [])],
        },
        host,
      ).resolvedModule;
      const path = resolved
        ? workspacePath(resolved.resolvedFileName)
        : undefined;
      const source = path ? (outputs.get(path) ?? path) : undefined;
      const target =
        source && sources.has(source)
          ? posix.relative(base, source)
          : undefined;
      cache.set(key, target);
      return target;
    },
    isLocal(from, specifier) {
      const name = specifier
        .split("/")
        .slice(0, specifier.startsWith("@") ? 2 : 1)
        .join("/");
      return (
        specifier.startsWith(".") ||
        specifier.startsWith("#") ||
        packages.has(name) ||
        ambiguous.has(name) ||
        Object.keys(configFor(absolute(from)).paths ?? {}).some((pattern) =>
          matchesAlias(pattern, specifier),
        )
      );
    },
  };
}
