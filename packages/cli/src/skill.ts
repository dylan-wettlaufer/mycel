import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveRepository } from "./repository.js";

export const skillName = "mycel-architecture";

/** Codex reads `.agents/skills`; Claude Code reads `.claude/skills`. */
export const skillDirectories = [".agents/skills", ".claude/skills"];

export async function installSkill(): Promise<void> {
  const { root } = await resolveRepository();
  const content = await readFile(
    new URL(`../skills/${skillName}/SKILL.md`, import.meta.url),
    "utf8",
  );
  for (const directory of skillDirectories) {
    const target = join(root, directory, skillName);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "SKILL.md"), content);
    console.info(`Installed ${join(directory, skillName, "SKILL.md")}`);
  }
}
