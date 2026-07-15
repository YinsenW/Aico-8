#!/usr/bin/env node
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import {
  probeHumanAuthorityDeployment,
  type AuthorityProbeRole,
  type AuthorityProbeTransport,
} from "../apps/human-authority-host/src/index.ts";
import {
  validateHostAuthorityProfile,
  type HostAuthorityProfileV1,
} from "../packages/contracts/src/index.ts";

const names = {
  baseUrl: "AICO8_AUTHORITY_BASE_URL",
  profilePath: "AICO8_AUTHORITY_PROFILE_PATH",
  administrator: "AICO8_AUTHORITY_ADMIN_TOKEN",
  agent: "AICO8_AUTHORITY_AGENT_TOKEN",
  reviewer: "AICO8_AUTHORITY_REVIEWER_TOKEN",
} as const;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required in the protected probe environment`);
  return value;
}

async function readProfile(file: string): Promise<HostAuthorityProfileV1> {
  const resolved = path.resolve(file);
  let handle;
  try {
    handle = await fs.open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const status = await handle.stat();
    if (!status.isFile()) throw new Error("profile is not a regular file");
    const value: unknown = JSON.parse(await handle.readFile("utf8"));
    const validation = validateHostAuthorityProfile(value);
    if (!validation.valid) throw new Error(validation.errors.join("; "));
    return value as HostAuthorityProfileV1;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const base = new URL(required(names.baseUrl));
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    throw new Error(`${names.baseUrl} must be a credential-free HTTPS base URL`);
  }
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  const profile = await readProfile(required(names.profilePath));
  const tokens: Record<AuthorityProbeRole, string> = {
    administrator: required(names.administrator),
    agent: required(names.agent),
    reviewer: required(names.reviewer),
  };
  const transport: AuthorityProbeTransport = {
    request(role, resource, init): Promise<Response> {
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${tokens[role]}`);
      return fetch(new URL(resource.replace(/^\//, ""), base), { ...init, headers });
    },
  };
  const result = await probeHumanAuthorityDeployment({ profile, transport });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Human authority deployment probe failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
