import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertReplay, type ReplayV1 } from "../packages/contracts/src/replay.ts";
import {
  CANONICAL_KEY_CODES,
  keyboardButton,
  projectInputTrace,
  type HostInputSurface,
} from "../apps/web/src/runtime/input.ts";
import { validationReplaySemanticsSha256 } from "./lib/release-identities.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArguments(values: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new TypeError(`Expected --name value pairs, received ${key ?? "end of input"}`);
    }
    result.set(key.slice(2), value);
  }
  return result;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function expandCanonicalMasks(replay: ReplayV1): Uint8Array {
  const masks = new Uint8Array(replay.trace.totalUpdates);
  let update = 0;
  for (const span of replay.trace.spans) {
    assert.equal(span.players.length, 1, "Input projection currently requires one PICO-8 player");
    assert.equal(span.startUpdate, update, `Canonical trace gap at logical update ${update}`);
    for (; update < span.endUpdateExclusive; update += 1) masks[update] = span.players[0];
  }
  assert.equal(update, replay.trace.totalUpdates, "Canonical trace must cover every logical update");
  return masks;
}

const argumentsMap = parseArguments(process.argv.slice(2));
const replayPath = path.resolve(argumentsMap.get("replay") ?? "");
const outputPath = path.resolve(argumentsMap.get("out") ?? "");
assert.ok(argumentsMap.get("replay") && fs.statSync(replayPath, { throwIfNoEntry: false })?.isFile(),
  "--replay must name a Replay v1 JSON file");
assert.ok(argumentsMap.get("out"), "--out must name the generated evidence path");

const replay: unknown = JSON.parse(fs.readFileSync(replayPath, "utf8"));
assertReplay(replay);
const canonicalMasks = expandCanonicalMasks(replay);
const canonicalTraceSha256 = sha256(canonicalMasks);

const keyButtons = CANONICAL_KEY_CODES.map((code) => keyboardButton(code));
assert.deepEqual(keyButtons, [0, 1, 2, 3, 4, 5], "Canonical keyboard keys must cover every PICO-8 button exactly once");
const mainSource = fs.readFileSync(path.join(repository, "apps/web/src/main.ts"), "utf8");
const touchButtonIds = [...mainSource.matchAll(/data-p8-button="([0-9]+)"/g)]
  .map((match) => Number(match[1]))
  .sort((left, right) => left - right);
assert.deepEqual(touchButtonIds, [0, 1, 2, 3, 4, 5],
  "Visible touch controls must expose every PICO-8 button exactly once");

const surfaces = {} as Record<HostInputSurface, {
  updates: number;
  updateHz: number;
  maskSha256: string;
  mismatches: number;
}>;
for (const surface of ["keyboard", "controller", "touch"] as const) {
  const projected = projectInputTrace(replay.trace, surface);
  let mismatches = 0;
  for (let update = 0; update < canonicalMasks.length; update += 1) {
    if (projected[update] !== canonicalMasks[update]) mismatches += 1;
  }
  assert.equal(mismatches, 0, `${surface} changed the canonical logical input trace`);
  assert.equal(projected.length, replay.trace.totalUpdates, `${surface} omitted a logical update`);
  surfaces[surface] = {
    updates: projected.length,
    updateHz: replay.trace.updateHz,
    maskSha256: sha256(projected),
    mismatches,
  };
}

const evidence = {
  schemaVersion: "aico8.input-surface-projection.v1",
  replayId: replay.replayId,
  replaySemanticsSha256: validationReplaySemanticsSha256(replay),
  cartSha256: replay.cartSha256,
  canonicalTraceSha256,
  totalUpdates: replay.trace.totalUpdates,
  updateHz: replay.trace.updateHz,
  surfaces,
  bindings: {
    keyboardCodes: CANONICAL_KEY_CODES,
    controllerProfile: "standard-gamepad-dpad-buttons-14-15-12-13-face-0-1",
    touchButtonIds,
    sampling: "one-mask-per-original-logical-update",
    quickTapLatch: "pending-until-consumed-by-logical-update",
  },
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(
  `Input projection: ${replay.trace.totalUpdates} updates at ${replay.trace.updateHz} Hz, keyboard/controller/touch identical\n`,
);
