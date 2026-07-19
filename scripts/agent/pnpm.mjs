#!/usr/bin/env node
import { spawnPackageManager } from "../lib/package-manager.mjs";

const result = spawnPackageManager(process.argv.slice(2), { stdio: "inherit" });
if (result.error) process.stderr.write(`${result.error.message}\n`);
process.exitCode = result.status ?? 1;
