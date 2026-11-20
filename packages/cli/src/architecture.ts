import {
  architectureFilePath,
  assignFilesToParts,
  discoverSourceFiles,
  findUnmatchedPatterns,
  inspectComponentAssignments,
  loadProjectArchitecture,
  readWorkingTreeLinks,
} from "@mycel/core";
import type {
  ArchitectureAssignment,
  AssignedArchitecturePart,
} from "@mycel/shared";
import { resolveRepository } from "./repository.js";

type WorkingTreeLink = Awaited<
  ReturnType<typeof readWorkingTreeLinks>
>["links"][number];

export async function checkArchitecture(component?: string): Promise<void> {
  const project = await resolveRepository();
  const { root } = project;
  const graph =
    component === undefined ? undefined : await readWorkingTreeLinks(project);
  const { paths } = graph ?? (await discoverSourceFiles(root));
  const loaded = await loadProjectArchitecture(root, { filePaths: paths });
  if (!loaded.fileFound) {
    throw new Error(
      `No ${architectureFilePath} in ${root}. The dashboard uses a folder map until one exists; run \`mycel install-skill\` and ask your agent to use the mycel-architecture skill.`,
    );
  }
  if (loaded.fileIssues) {
    throw new Error(
      [
        architectureFilePath,
        ...loaded.fileIssues.map(
          ({ path, message }) => `${path || "$"}: ${message}`,
        ),
      ].join("\n"),
    );
  }
  const assignment = assignFilesToParts(loaded.architecture, paths, {
    fallback: loaded.fallback,
  });
  if (component !== undefined && graph) {
    const parent = findComponent(assignment.parts, component);
    reportComponent(assignment, parent, graph.links);
    return;
  }
  const { parts, unassignedFiles, tieWarnings } = assignment;
  const unmatched = findUnmatchedPatterns(loaded.architecture, paths);
  for (const part of parts) {
    if (!part.fallback)
      console.info(`${part.name} (${part.files.length} files)`);
  }
  console.info(`Unassigned files: ${unassignedFiles.length}`);
  for (const path of unassignedFiles) console.info(`  ${path}`);
  console.info(`Tie warnings: ${tieWarnings.length}`);
  for (const tie of tieWarnings) {
    const choices = tie.tiedPartIds.map(
      (id, index) => `${id} (${tie.patterns[index]})`,
    );
    console.info(
      `  ${tie.path}: ${choices.join(", ")}; winner: ${tie.winnerPartId}`,
    );
  }
  console.info(`Unmatched patterns: ${unmatched.length}`);
  for (const { partId, pattern } of unmatched)
    console.info(`  ${partId}: ${pattern}`);
  if (unmatched.length) process.exitCode = 1;
}

function findComponent(parts: AssignedArchitecturePart[], query: string) {
  const candidates = parts.filter((part) => !part.fallback);
  const idMatch = candidates.find((part) => part.id === query);
  if (idMatch) return idMatch;
  const matches = candidates.filter(
    (part) => part.name.toLowerCase() === query.trim().toLowerCase(),
  );
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1)
    throw new Error(
      `Ambiguous component "${query}". Use one of these IDs: ${matches.map(({ id }) => id).join(", ")}`,
    );
  throw new Error(
    `Unknown component "${query}". Available IDs: ${candidates.map(({ id }) => id).join(", ")}`,
  );
}

function reportComponent(
  assignment: ArchitectureAssignment,
  component: AssignedArchitecturePart,
  links: WorkingTreeLink[],
) {
  console.info(`${component.name} (${component.id})`);
  console.info(component.purpose);
  console.info(`Component files: ${component.files.length}`);
  for (const path of component.files) console.info(`  ${path}`);

  const files = new Set(component.files);
  const internal: WorkingTreeLink[] = [];
  const incoming: WorkingTreeLink[] = [];
  const outgoing: WorkingTreeLink[] = [];
  for (const link of links) {
    const from = files.has(link.sourcePath);
    const to = files.has(link.targetPath);
    if (from && to) internal.push(link);
    else if (to) incoming.push(link);
    else if (from) outgoing.push(link);
  }
  const owners = new Map(assignment.parts.map(({ id, name }) => [id, name]));
  const ownerOf = (path: string) =>
    owners.get(assignment.fileToPart[path] ?? "");
  reportLinks("External callers and imports", incoming, (link) =>
    ownerOf(link.sourcePath),
  );
  reportLinks("External dependencies", outgoing, (link) =>
    ownerOf(link.targetPath),
  );
  reportLinks("Internal links", internal);

  if (!component.subcomponents?.length) {
    console.info("No breakdown defined.");
    return;
  }
  const { responsibilities, otherFiles, overlaps, unmatched } =
    inspectComponentAssignments(assignment, component);
  console.info(`Responsibilities: ${responsibilities.length}`);
  for (const [index, responsibility] of responsibilities.entries()) {
    const count = responsibility.files.length;
    console.info(
      `  ${responsibility.name} (${responsibility.id}, ${count} ${count === 1 ? "file" : "files"})${index === 0 ? " [opening focus]" : ""}`,
    );
    for (const path of responsibility.files) console.info(`    ${path}`);
  }
  console.info(`Other files: ${otherFiles.length}`);
  for (const path of otherFiles) console.info(`  ${path}`);
  console.info(`Overlapping responsibilities: ${overlaps.length}`);
  for (const { path, matches, winnerPartId } of overlaps) {
    const choices = matches.map(
      ({ partId, pattern }) => `${partId} (${pattern})`,
    );
    console.info(`  ${path}: ${choices.join(", ")} → ${winnerPartId}`);
  }
  console.info(`Unmatched responsibility patterns: ${unmatched.length}`);
  for (const { partId, pattern } of unmatched)
    console.info(`  ${partId}: ${pattern}`);
  if (unmatched.length) process.exitCode = 1;
}

function reportLinks(
  title: string,
  links: WorkingTreeLink[],
  externalOwner?: (link: WorkingTreeLink) => string | undefined,
) {
  const limit = 30;
  const ranked = [...links].sort(
    (a, b) => Number(b.kind === "CALLS") - Number(a.kind === "CALLS"),
  );
  console.info(
    `${title}: ${links.length}${links.length > limit ? ` (showing ${limit})` : ""}`,
  );
  if (externalOwner && links.length > limit) {
    const neighbors = new Set(links.map(externalOwner));
    neighbors.delete(undefined);
    if (neighbors.size)
      console.info(`  Related components: ${[...neighbors].sort().join(", ")}`);
  }
  for (const link of ranked.slice(0, limit)) {
    const owner = externalOwner?.(link);
    const kind = link.kind === "CALLS" ? "call" : "import";
    const target = link.targetSymbol
      ? `${link.targetPath}#${link.targetSymbol}`
      : link.targetPath;
    console.info(
      `  ${link.sourcePath}:${link.sourceLine} → ${target} (${kind}${owner ? `, ${owner}` : ""})`,
    );
  }
}
