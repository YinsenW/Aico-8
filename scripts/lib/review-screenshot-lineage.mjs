import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const RAW_BROWSER_CROP_METHOD = "raw-browser-pixel-crop";

export function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function jpegDimensions(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.subarray(0, 2).toString("hex") !== "ffd8") throw new Error(`${file}: expected JPEG`);
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    const length = bytes.readUInt16BE(offset);
    if (startOfFrameMarkers.has(marker)) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  throw new Error(`${file}: JPEG dimensions were not found`);
}

export function validateRawPixelCrop(crop, rawDimensions) {
  const values = [crop?.x, crop?.y, crop?.width, crop?.height];
  if (!values.every(Number.isInteger) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0) {
    throw new Error("Review screenshot crop must contain positive integer raw-pixel coordinates");
  }
  if (crop.x + crop.width > rawDimensions.width || crop.y + crop.height > rawDimensions.height) {
    throw new Error("Review screenshot crop escapes the retained raw browser screenshot");
  }
}

export function crossSceneDuplicateGroups(records) {
  const byModeAndHash = new Map();
  for (const record of records) {
    if (record.allowCrossSceneDuplicate === true) continue;
    const key = `${record.mode}\0${record.derivedSha256}`;
    const group = byModeAndHash.get(key) ?? [];
    group.push(record);
    byModeAndHash.set(key, group);
  }
  return [...byModeAndHash.values()].filter((group) => new Set(group.map(({ sceneId }) => sceneId)).size > 1);
}

function runFfmpeg(ffmpeg, input, filter, output) {
  const result = spawnSync(ffmpeg, [
    "-nostdin", "-y", "-loglevel", "error", "-i", input,
    "-vf", filter, "-frames:v", "1", "-q:v", "2", "-map_metadata", "-1", "-threads", "1", output,
  ], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed for ${path.basename(input)}: ${result.stderr || `status ${result.status}`}`);
  }
}

export function deriveReviewScreenshot({
  rawPath,
  crop,
  clipPath,
  derivedPath,
  outputSize = 1024,
  ffmpeg = "ffmpeg",
}) {
  const rawDimensions = jpegDimensions(rawPath);
  validateRawPixelCrop(crop, rawDimensions);
  const suffix = `.tmp-${process.pid}-${Math.random().toString(16).slice(2)}.jpg`;
  const temporaryClip = `${clipPath}${suffix}`;
  const temporaryDerived = `${derivedPath}${suffix}`;
  const cropFilter = `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`;
  try {
    runFfmpeg(ffmpeg, rawPath, cropFilter, temporaryClip);
    runFfmpeg(ffmpeg, rawPath, `${cropFilter},scale=${outputSize}:${outputSize}:flags=lanczos`, temporaryDerived);
    if (JSON.stringify(jpegDimensions(temporaryClip)) !== JSON.stringify({ width: crop.width, height: crop.height })) {
      throw new Error("Derived review clip dimensions do not match the declared raw-pixel crop");
    }
    if (JSON.stringify(jpegDimensions(temporaryDerived)) !== JSON.stringify({ width: outputSize, height: outputSize })) {
      throw new Error("Derived review screenshot dimensions do not match the requested square output");
    }
    return {
      temporaryClip,
      temporaryDerived,
      clipSha256: sha256File(temporaryClip),
      derivedSha256: sha256File(temporaryDerived),
      rawDimensions,
    };
  } catch (error) {
    fs.rmSync(temporaryClip, { force: true });
    fs.rmSync(temporaryDerived, { force: true });
    throw error;
  }
}
