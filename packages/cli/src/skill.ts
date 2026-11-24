import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { resolveRepository } from "./repository.js";

export const skillName = "mycel-architecture";

/** Codex reads `.agents/skills`; Claude Code reads `.claude/skills`. */
export const skillDirectories = [".agents/skills", ".claude/skills"];

async function inspectDirectory(path: string, create: boolean) {
  if (create) {
    await mkdir(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  }
  const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" && !create) return undefined;
    throw error;
  });
  if (stat && (!stat.isDirectory() || (await realpath(path)) !== path)) {
    throw new Error(
      `Expected a repository directory without symbolic links: ${path}`,
    );
  }
}

async function existingSkillMatches(path: string, content: Buffer) {
  const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!stat) return undefined;
  if (!stat.isFile()) return false;

  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    if (!(await file.stat()).isFile()) return false;
    return (await file.readFile()).equals(content);
  } finally {
    await file.close();
  }
}

export async function installSkill(): Promise<void> {
  const { root } = await resolveRepository();
  const content = await readFile(
    new URL(`../skills/${skillName}/SKILL.md`, import.meta.url),
  );
  const pending = [];
  const installed = [];
  for (const destination of skillDirectories) {
    let directory = root;
    const directories = [];
    for (const part of [...destination.split("/"), skillName]) {
      directory = join(directory, part);
      await inspectDirectory(directory, false);
      directories.push(directory);
    }

    const relativePath = join(destination, skillName, "SKILL.md");
    const path = join(root, relativePath);
    const matches = await existingSkillMatches(path, content);
    if (matches === false)
      throw new Error(
        `Existing skill differs or is not a regular file: ${relativePath}. Move it aside to install the packaged version.`,
      );
    if (matches === undefined)
      pending.push({ directories, path, relativePath });
    else installed.push(relativePath);
  }

  // Complete directory setup for both destinations before writing either file.
  for (const { directories } of pending)
    for (const directory of directories)
      await inspectDirectory(directory, true);

  const created = [];
  try {
    for (const { path } of pending) {
      const parent = dirname(path);
      await inspectDirectory(parent, false);
      const file = await open(path, "wx", 0o644);
      try {
        const entry = { path, stat: await file.stat() };
        created.push(entry);
        try {
          if ((await realpath(parent)) !== parent)
            throw new Error(`Skill destination changed: ${path}`);
          await file.writeFile(content);
        } finally {
          entry.stat = await file.stat();
        }
      } finally {
        await file.close();
      }
    }
  } catch (error) {
    const cleanupErrors = [];
    for (const { path, stat } of created) {
      try {
        const current = await lstat(path);
        if (
          current.ino === stat.ino &&
          current.dev === stat.dev &&
          current.ctimeMs === stat.ctimeMs &&
          current.mtimeMs === stat.mtimeMs &&
          (await realpath(dirname(path))) === dirname(path)
        )
          await unlink(path);
      } catch (cleanupError) {
        if (!(
          cleanupError instanceof Error &&
          "code" in cleanupError &&
          cleanupError.code === "ENOENT"
        ))
          cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length)
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Could not finish or roll back skill installation",
        { cause: error },
      );
    throw error;
  }

  for (const path of installed) console.info(`Already installed ${path}`);
  for (const { relativePath } of pending)
    console.info(`Installed ${relativePath}`);
}
