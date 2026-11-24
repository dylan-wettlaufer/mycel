import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  lstat,
  stat,
  rm,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
const run = promisify(execFile);
test("skill preflight preserves custom content and rejects linked directories before writing", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mycel-skill-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "project");
  const external = join(directory, "external");
  await mkdir(root);
  await mkdir(external);
  const cli = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
  const install = () =>
    run(process.execPath, [cli, "install-skill"], { cwd: root });
  const target = join(root, ".claude", "skills", "mycel-architecture");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "SKILL.md"), "custom");
  await assert.rejects(install, /Existing skill differs/);
  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "custom");
  await assert.rejects(lstat(join(root, ".agents")), { code: "ENOENT" });
  await rm(join(root, ".claude"), { recursive: true });
  await symlink(external, join(root, ".claude"), "junction");
  await assert.rejects(install, /symbolic links/);
  await assert.rejects(lstat(join(external, "skills")), {
    code: "ENOENT",
  });
  await rm(join(root, ".claude"));
  await mkdir(target, { recursive: true });
  const externalFile = join(external, "SKILL.md");
  const skill = join(target, "SKILL.md");
  await writeFile(externalFile, "external skill");
  if (process.platform !== "win32") {
    await symlink(externalFile, skill, "file");
    await assert.rejects(install, /not a regular file/);
    assert.equal(await readFile(externalFile, "utf8"), "external skill");
    await assert.rejects(lstat(join(root, ".agents")), { code: "ENOENT" });
    await rm(skill);
  }

  await install();
  const first = await stat(skill);
  assert.match((await install()).stdout, /Already installed/);
  const second = await stat(skill);
  assert.equal(second.ino, first.ino);
  assert.equal(second.mtimeMs, first.mtimeMs);
});
