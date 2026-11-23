import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolveDatabasePath } from "@mycel/db";
import type { AgentHookSetup, AgentProvider } from "@mycel/shared";

const cliPath = fileURLToPath(new URL("./bin.js", import.meta.url));

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function exists(path: string, mode = constants.F_OK): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

export function managedHookMarker(root: string, databasePath?: string): string {
  return `${databasePath ?? resolveDatabasePath(root)}.agent-hooks`;
}

export async function setManagedHooks(
  root: string,
  enabled: boolean,
  databasePath?: string,
): Promise<void> {
  const path = managedHookMarker(root, databasePath);
  if (enabled) await writeFile(path, "", { mode: 0o600, flag: "a" });
  else await rm(path, { force: true });
}

function hookCommand(provider: AgentProvider): string {
  if (process.platform === "win32")
    return `mycel agent-hook ${provider} --managed`;
  const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  return `${quote(process.execPath)} ${quote(cliPath)} agent-hook ${provider} --managed`;
}

function hasCommand(
  entry: unknown,
  provider: AgentProvider,
  command: string,
): boolean {
  if (!isObject(entry) || typeof entry.command !== "string") return false;
  return (
    entry.command === command ||
    entry.command === `mycel agent-hook ${provider}` ||
    (entry.command.includes(cliPath) &&
      entry.command.trimEnd().endsWith(` agent-hook ${provider}`))
  );
}

function addHooks(
  config: Record<string, unknown>,
  provider: AgentProvider,
): boolean {
  if (config.hooks !== undefined && !isObject(config.hooks))
    throw new Error("The hooks setting must be an object");
  if (
    provider === "cursor" &&
    config.version !== undefined &&
    config.version !== 1
  )
    throw new Error("This Cursor hooks file has an unsupported version");

  const hooks = (config.hooks ?? {}) as Record<string, unknown>;
  const command = hookCommand(provider);
  const names =
    provider === "cursor"
      ? ["afterFileEdit"]
      : provider === "codex"
        ? ["PostToolUse"]
        : ["PreToolUse", "PostToolUse", "PostToolUseFailure"];
  let changed = false;
  for (const name of names) {
    const existing = hooks[name] ?? [];
    if (!Array.isArray(existing)) throw new Error(`${name} must be an array`);
    const alreadyConfigured = existing.some((entry: unknown) => {
      if (provider === "cursor") return hasCommand(entry, provider, command);
      return (
        isObject(entry) &&
        Array.isArray(entry.hooks) &&
        entry.hooks.some((handler: unknown) =>
          hasCommand(handler, provider, command),
        )
      );
    });
    if (alreadyConfigured) continue;
    hooks[name] = [
      ...existing,
      provider === "cursor"
        ? { command }
        : {
            matcher: provider === "codex" ? "^apply_patch$" : "Edit|Write",
            hooks: [{ type: "command", command }],
          },
    ];
    changed = true;
  }
  config.hooks = hooks;
  if (provider === "cursor" && config.version === undefined) {
    config.version = 1;
    changed = true;
  }
  return changed;
}

async function register(path: string, provider: AgentProvider): Promise<void> {
  let original: string | undefined;
  let mode = 0o600;
  try {
    const stat = await lstat(path);
    if (!stat.isFile())
      throw new Error("The settings path must be a regular file");
    mode = stat.mode;
    original = await readFile(path, "utf8");
  } catch (error) {
    if (!(isObject(error) && error.code === "ENOENT")) throw error;
  }
  const config: unknown = original === undefined ? {} : JSON.parse(original);
  if (!isObject(config))
    throw new Error("The settings file must contain an object");
  if (!addHooks(config, provider)) return;

  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.mycel-${randomUUID()}`;
  try {
    await writeFile(temporary, JSON.stringify(config, null, 2) + "\n", {
      mode,
      flag: "wx",
    });
    const latest = await readFile(path, "utf8").catch((error: unknown) => {
      if (isObject(error) && error.code === "ENOENT") return undefined;
      throw error;
    });
    if (latest !== original)
      throw new Error(
        "The settings changed while Mycel was updating them. Restart Mycel to retry",
      );
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function hasProjectAgentHooks(
  root: string,
  provider: AgentProvider,
): Promise<boolean> {
  const localSettings = join(
    root,
    provider === "claude-code" ? ".claude" : `.${provider}`,
    provider === "claude-code" ? "settings.local.json" : "hooks.json",
  );
  try {
    const local: unknown = JSON.parse(await readFile(localSettings, "utf8"));
    return isObject(local) && !addHooks(local, provider);
  } catch {
    return false;
  }
}

/** Register one user-level hook per detected provider, without touching repository files. */
export async function setupAgentHooks(
  root: string,
  home = homedir(),
  environment = process.env,
): Promise<AgentHookSetup[]> {
  const agents: {
    provider: AgentProvider;
    directory: string;
    file: string;
    commands: string[];
  }[] = [
    {
      provider: "codex",
      directory:
        environment.CODEX_HOME && isAbsolute(environment.CODEX_HOME)
          ? environment.CODEX_HOME
          : join(home, ".codex"),
      file: "hooks.json",
      commands: ["codex"],
    },
    {
      provider: "cursor",
      directory: join(home, ".cursor"),
      file: "hooks.json",
      commands: ["cursor", "cursor-agent", "agent"],
    },
    {
      provider: "claude-code",
      directory:
        environment.CLAUDE_CONFIG_DIR &&
        isAbsolute(environment.CLAUDE_CONFIG_DIR)
          ? environment.CLAUDE_CONFIG_DIR
          : join(home, ".claude"),
      file: "settings.json",
      commands: ["claude"],
    },
  ];
  const directories = (environment.PATH ?? "")
    .split(delimiter)
    .filter(isAbsolute);
  const found = await Promise.all(
    agents.map(
      async ({
        provider,
        directory,
        file,
        commands,
      }): Promise<AgentHookSetup | undefined> => {
        const detected =
          (await exists(directory)) ||
          (
            await Promise.all(
              directories.flatMap((path) =>
                commands.flatMap((command) =>
                  (process.platform === "win32"
                    ? [".exe", ".cmd", ".bat"]
                    : [""]
                  ).map((suffix) =>
                    exists(join(path, command + suffix), constants.X_OK),
                  ),
                ),
              ),
            )
          ).some(Boolean);
        if (!detected) return;
        try {
          if (await hasProjectAgentHooks(root, provider))
            return { provider, state: "configured" };
          await register(join(directory, file), provider);
          return { provider, state: "configured" };
        } catch (error) {
          return {
            provider,
            state: "error",
            message: `${join(directory, file)} · ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    ),
  );
  return found.filter((result) => result !== undefined);
}
