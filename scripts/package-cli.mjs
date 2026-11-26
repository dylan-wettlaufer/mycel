import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "dist", "npm");
const staging = join(output, "package");
const cliDirectory = join(root, "packages", "cli");
const readManifest = async (directory) =>
  JSON.parse(await readFile(join(directory, "package.json"), "utf8"));

const [workspace, cli] = await Promise.all([
  readManifest(root),
  readManifest(cliDirectory),
]);

const internal = {};
const dependencies = {};
const packages = new Set([cli.name]);
for (const name of packages) {
  const directory = join(root, "packages", name.slice("@mycel/".length));
  const manifest = name === cli.name ? cli : await readManifest(directory);
  internal[name] = join(directory, manifest.exports["."].import);
  for (const [dependency, version] of Object.entries(
    manifest.dependencies ?? {},
  )) {
    if (version.startsWith("workspace:")) {
      packages.add(dependency);
    } else {
      if (dependencies[dependency] && dependencies[dependency] !== version)
        throw new Error(`Conflicting runtime versions of ${dependency}`);
      dependencies[dependency] = version;
    }
  }
}

await rm(output, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: [join(cliDirectory, cli.bin.mycel)],
  outdir: join(staging, "dist"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  splitting: true,
  packages: "external",
  alias: internal,
  define: { __MYCEL_STANDALONE__: "true" },
  metafile: true,
});

for (const bundle of Object.values(result.metafile.outputs)) {
  for (const { external, path } of bundle.imports) {
    if (!external || isBuiltin(path)) continue;
    const name = path
      .split("/")
      .slice(0, path.startsWith("@") ? 2 : 1)
      .join("/");
    if (!Object.hasOwn(dependencies, name))
      throw new Error(`Undeclared npm runtime dependency: ${path}`);
  }
}

await Promise.all([
  chmod(join(staging, cli.bin.mycel), 0o755),
  cp(join(root, "apps", "web", "dist"), join(staging, "dist", "web"), {
    recursive: true,
  }),
  cp(join(cliDirectory, "skills"), join(staging, "skills"), {
    recursive: true,
  }),
  cp(join(root, "LICENSE"), join(staging, "LICENSE")),
  cp(join(root, "README.md"), join(staging, "README.md")),
  writeFile(
    join(staging, "package.json"),
    JSON.stringify(
      {
        name: "@dylan-wettlaufer/mycel",
        version: cli.version,
        description: "A local-first architecture map for your repository.",
        type: cli.type,
        license: "MIT",
        repository: {
          type: "git",
          url: "git+https://github.com/dylan-wettlaufer/mycel.git",
        },
        engines: { node: workspace.engines.node },
        bin: cli.bin,
        files: cli.files,
        publishConfig: { access: "public" },
        dependencies,
      },
      null,
      2,
    ) + "\n",
  ),
]);
