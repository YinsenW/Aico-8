import { spawnSync } from "node:child_process";

export function executable(command, args = ["--version"]) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 10_000 });
  return {
    command,
    available: !result.error && result.status === 0,
    version: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n")[0] ?? "",
  };
}

export function packageManager() {
  const direct = executable("pnpm");
  if (direct.available) return { ...direct, args: [] };
  const corepack = executable("corepack");
  if (corepack.available) return { ...corepack, command: "corepack", args: ["pnpm"] };
  const npx = executable("npx");
  if (npx.available) return { ...npx, command: "npx", args: ["--yes", "pnpm@10.30.3"] };
  return { command: "pnpm/corepack/npx", args: [], available: false, version: "" };
}

export function spawnPackageManager(args, options = {}) {
  const manager = packageManager();
  if (!manager.available) {
    return { status: 1, error: new Error("pnpm is unavailable and neither corepack nor npx can provision it"), stdout: "", stderr: "" };
  }
  return spawnSync(manager.command, [...manager.args, ...args], options);
}
