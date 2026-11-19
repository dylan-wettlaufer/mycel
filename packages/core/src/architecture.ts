import type {
  ArchitectureFile,
  ArchitectureFileResult,
  ArchitecturePartKind,
  ArchitectureSource,
} from "@mycel/shared";
import { z } from "zod";

export const architectureFilePath = ".mycel/architecture.json";

const partKinds = [
  "app",
  "service",
  "library",
  "data",
  "integration",
  "cli",
] as const satisfies readonly ArchitecturePartKind[];
const sources = [
  "agent",
  "folder-fallback",
] as const satisfies readonly ArchitectureSource[];

function line(label: string, max: number) {
  return z
    .string()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`)
    .refine((value) => value.trim() === value && !/[\r\n]/.test(value), {
      message: `${label} must be a single line without surrounding whitespace`,
    });
}

/** Globs are matched against canonical repository-relative paths. */
const glob = z.string().superRefine((value, context) => {
  const message = !value
    ? "Path pattern is required"
    : value.includes("\\")
      ? "Use forward slashes in paths"
      : value.startsWith("/") || /^[A-Za-z]:/.test(value)
        ? "Paths must be relative to the repository root"
        : value
              .split("/")
              .some(
                (segment) =>
                  segment === "" || segment === "." || segment === "..",
              )
          ? "Paths must not contain empty, '.', or '..' segments"
          : undefined;
  if (message) context.addIssue({ code: "custom", message });
});

const part = z.strictObject({
  id: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9-]{0,63}$/,
      "Part id must be a lowercase slug of letters, digits, and hyphens",
    ),
  name: line("Part name", 80),
  purpose: line("Part purpose", 200),
  kind: z.enum(partKinds),
  paths: z.array(glob).min(1, "Part needs at least one path pattern"),
});

const architectureFile = z
  .strictObject({
    version: z.literal(1),
    source: z.enum(sources).optional(),
    generatedAt: z.iso.datetime({ offset: true }).optional(),
    parts: z
      .array(part)
      .min(1, "Architecture needs at least one part")
      .max(100, "Architecture can have at most 100 parts"),
  })
  .superRefine((file, context) => {
    const seen = new Set<string>();
    file.parts.forEach((entry, index) => {
      if (seen.has(entry.id))
        context.addIssue({
          code: "custom",
          path: ["parts", index, "id"],
          message: `Duplicate part id "${entry.id}"`,
        });
      seen.add(entry.id);
    });
  });

/** Validate `.mycel/architecture.json` contents without touching the filesystem. */
export function parseArchitectureFile(text: string): ArchitectureFileResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          path: "",
          message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
  const result = architectureFile.safeParse(value);
  if (!result.success)
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    };
  const { source, generatedAt, ...rest } = result.data;
  const file: ArchitectureFile = rest;
  if (source) file.source = source;
  if (generatedAt) file.generatedAt = generatedAt;
  return { ok: true, file };
}
