import {
  architectureFilePath,
  assignFilesToParts,
  discoverSourceFiles,
  findUnmatchedPatterns,
  loadProjectArchitecture,
} from "@mycel/core";
import { resolveRepository } from "./repository.js";

export async function checkArchitecture(): Promise<void> {
  const { root } = await resolveRepository();
  const { paths } = await discoverSourceFiles(root);
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
  const { parts, unassignedFiles, tieWarnings } = assignFilesToParts(
    loaded.architecture,
    paths,
    { fallback: loaded.fallback },
  );
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
