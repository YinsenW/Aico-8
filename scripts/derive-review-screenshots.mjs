#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  RAW_BROWSER_CROP_METHOD,
  crossSceneDuplicateGroups,
  deriveReviewScreenshot,
  sha256File,
} from "./lib/review-screenshot-lineage.mjs";

function parseArguments(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("Expected --name value pairs");
    result.set(key.slice(2), value);
  }
  return result;
}

const argumentsMap = parseArguments(process.argv.slice(2));
const sessionArgument = argumentsMap.get("session");
const outputSize = Number(argumentsMap.get("output-size") ?? "1024");
assert.ok(sessionArgument, "--session is required");
const sessionPath = path.resolve(sessionArgument);
assert.equal(argumentsMap.get("write"), "true", "--write true is required to replace generated evidence");
assert.ok(Number.isSafeInteger(outputSize) && outputSize > 0, "--output-size must be a positive integer");

const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
assert.equal(session.schemaVersion, "aico8.browser-capture-session.v1");
assert.ok(Array.isArray(session.records) && session.records.length > 0, "Capture session must contain records");

const pending = [];
try {
  for (const record of session.records) {
    assert.ok(record.rawPath && record.clipPath && record.clip, `${record.id}: raw capture lineage is incomplete`);
    assert.equal(sha256File(record.rawPath), record.rawSha256, `${record.id}: retained raw browser screenshot changed`);
    const derivedPath = record.derivedPath
      ?? record.rawPath.replace(/-browser\.jpg$/u, ".jpg");
    assert.notEqual(derivedPath, record.rawPath, `${record.id}: raw path must end in -browser.jpg`);
    const derived = deriveReviewScreenshot({
      rawPath: record.rawPath,
      crop: record.clip,
      clipPath: record.clipPath,
      derivedPath,
      outputSize,
      ffmpeg: argumentsMap.get("ffmpeg") ?? "ffmpeg",
    });
    pending.push({ record, derivedPath, ...derived });
  }

  const candidateRecords = pending.map(({ record, derivedPath, clipSha256, derivedSha256, rawDimensions }) => ({
    ...record,
    clipSha256,
    derivedPath,
    derivedSha256,
    derivation: {
      method: RAW_BROWSER_CROP_METHOD,
      coordinateSpace: "retained-raw-browser-pixels",
      rawDimensions,
      outputDimensions: { width: outputSize, height: outputSize },
      resizeKernel: "ffmpeg-lanczos",
    },
  }));
  const duplicateGroups = crossSceneDuplicateGroups(candidateRecords);
  if (duplicateGroups.length > 0) {
    const details = duplicateGroups.map((group) => group.map(({ id, sceneId }) => `${id}:${sceneId}`).join(", ")).join("\n");
    throw new Error(`Derived screenshots are byte-identical across declared scenes:\n${details}`);
  }

  for (const item of pending) {
    fs.renameSync(item.temporaryClip, item.record.clipPath);
    fs.renameSync(item.temporaryDerived, item.derivedPath);
  }
  session.records = candidateRecords;
  session.derivation = {
    method: RAW_BROWSER_CROP_METHOD,
    coordinateSpace: "retained-raw-browser-pixels",
    outputDimensions: { width: outputSize, height: outputSize },
    resizeKernel: "ffmpeg-lanczos",
    crossSceneDuplicatePolicy: "fail-closed-unless-explicitly-declared",
  };
  const temporarySession = `${sessionPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporarySession, `${JSON.stringify(session, null, 2)}\n`);
  fs.renameSync(temporarySession, sessionPath);
  process.stdout.write(`Derived ${session.records.length} review screenshots from retained raw browser pixels\n`);
} catch (error) {
  for (const item of pending) {
    fs.rmSync(item.temporaryClip, { force: true });
    fs.rmSync(item.temporaryDerived, { force: true });
  }
  throw error;
}
