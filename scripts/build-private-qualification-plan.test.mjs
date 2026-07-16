import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repository, "scripts/build-private-qualification-plan.ts");

function hash(digit) {
  return digit.repeat(64);
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aico8-qualification-plan-"));
  const encoded = path.join(root, "encoded");
  fs.mkdirSync(encoded);
  const carts = [];
  const audioCarts = [];
  const candidates = [];
  for (let index = 1; index <= 12; index += 1) {
    const filename = `game-${String(index).padStart(2, "0")}.p8`;
    fs.writeFileSync(path.join(encoded, `${filename}.png`), `encoded-${index}`);
    carts.push({
      path: `/private/${filename}`,
      filename,
      version: 42,
      sha256: hash(index.toString(16).slice(-1)),
      title: `Game ${index}`,
      byline: `Author ${index}`,
      lua_chars: 1000 + index,
      lua_lines: 100,
      sections: ["lua"],
      section_payload_chars: { lua: 1000 + index },
      features: [index % 2 ? "update_30" : "update_60", "controller_input"],
    });
    audioCarts.push({
      path: `/private/${filename}`,
      filename,
      version: 42,
      active_note_count: index,
      waveforms: [0],
      effects: [0],
      filtered_sfx: [],
      custom_instrument_refs: [],
      music_pattern_count: 1,
      music_flow_flags: [],
    });
    candidates.push({
      priority: index,
      filename,
      gameId: `game-${String(index).padStart(2, "0")}`,
      finiteness: {
        status: index === 1 ? "replay-confirmed" : "source-confirmed",
        sourceAnchors: ["lua-line:10-20"],
        boundaries: [{ id: "levels", kind: "level-set", count: index }, { id: "ending", kind: "ending" }],
      },
      riskCoverage: ["timing-30hz", "timing-60hz", "platforming-physics", "rng-entities", "audio-synthesis", "text-p8scii", "advanced-raster", "memory-persistence", "input-progression", "large-code-progression"],
      qualification: index === 1 ? {
        status: "qualified",
        workspaceId: "workspace-01",
        canonicalReplaySha256: hash("a"),
        hdReviewDecisionSha256: hash("b"),
        webPackageSha256: hash("c"),
      } : { status: "selected", workspaceId: `workspace-${String(index).padStart(2, "0")}` },
    });
  }
  const files = {
    analysis: path.join(root, "analysis.json"),
    audio: path.join(root, "audio.json"),
    compile: path.join(root, "compile.json"),
    selection: path.join(root, "selection.json"),
    plan: path.join(root, "plan.json"),
    attestation: path.join(root, "attestation.json"),
  };
  writeJson(files.analysis, { summary: { cart_count: 12, duplicate_groups: [] }, carts });
  writeJson(files.audio, { summary: { cart_count: 12 }, carts: audioCarts });
  writeJson(files.compile, { schema_version: 2, runtime: "pinned-z8lua", runtime_commit: hash("d"), cart_count: 12, pass_count: 12, failure_count: 0, failures: [] });
  writeJson(files.selection, { schemaVersion: "aico8.qualification-selection-input.v1", programId: "private-ten-game-qualification", candidates });
  return { root, encoded, files };
}

function run(item, write) {
  return execFileSync(process.execPath, [
    "--experimental-strip-types", script,
    "--analysis", item.files.analysis,
    "--audio", item.files.audio,
    "--compile", item.files.compile,
    "--selection", item.files.selection,
    "--encoded-dir", item.encoded,
    "--out", item.files.plan,
    "--attestation", item.files.attestation,
    "--write", String(write),
  ], { cwd: repository, encoding: "utf8" });
}

test("builds and then reproduces a private qualification plan", () => {
  const item = fixture();
  assert.match(run(item, true), /12 selected, 1 qualified, 10 risk dimensions/);
  const first = fs.readFileSync(item.files.plan);
  assert.match(run(item, false), /Qualification plan: PASS/);
  assert.deepEqual(fs.readFileSync(item.files.plan), first);
  const attestation = JSON.parse(fs.readFileSync(item.files.attestation, "utf8"));
  assert.equal(attestation.observations.selected_candidate_count, 12);
  assert.equal(attestation.observations.qualified_game_count, 1);
  assert.equal(attestation.observations.all_candidates_formal_release_blocked, true);
});

test("rejects a selected candidate that fails the pinned compiler", () => {
  const item = fixture();
  const compile = JSON.parse(fs.readFileSync(item.files.compile, "utf8"));
  compile.pass_count = 11;
  compile.failure_count = 1;
  compile.failures = [{ cart: "game-02.p8" }];
  writeJson(item.files.compile, compile);
  assert.throws(() => run(item, true), /pinned z8lua compile failed/);
});
