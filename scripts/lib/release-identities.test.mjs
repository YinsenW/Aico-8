import assert from "node:assert/strict";
import test from "node:test";
import {
  validationReplaySemanticsSha256,
  visualRuntimeSha256,
} from "./release-identities.mjs";

const replay = {
  schemaVersion: "aico8.replay.v1",
  replayId: "example-v1",
  gameId: "example",
  cartSha256: "a".repeat(64),
  runtime: { id: "aico8-wasm", revision: "old-revision" },
  canonicality: { logicalUpdatePolicy: "execute-all" },
  trace: { totalUpdates: 2, spans: [{ fromUpdate: 0, toUpdateExclusive: 2, buttonMask: 0 }] },
  requiredMilestoneIds: ["complete"],
  milestones: [{ id: "complete", atUpdate: 2 }],
  checkpoints: [],
  result: { completed: true },
  producer: { name: "qualification", version: "1", sourceRevision: "old-revision" },
};

test("replay semantic identity ignores provenance-only source revisions", () => {
  const regenerated = structuredClone(replay);
  regenerated.runtime.revision = "new-revision";
  regenerated.producer.sourceRevision = "new-revision";
  assert.equal(validationReplaySemanticsSha256(regenerated), validationReplaySemanticsSha256(replay));
});

test("replay semantic identity changes with executed input", () => {
  const changed = structuredClone(replay);
  changed.trace.spans[0].buttonMask = 1;
  assert.notEqual(validationReplaySemanticsSha256(changed), validationReplaySemanticsSha256(replay));
});

test("visual runtime identity excludes only the declared replay artifact", () => {
  const artifacts = [
    { path: "assets/app.js", sha256: "1".repeat(64), bytes: 10 },
    { path: "private/game/validation-replay.json", sha256: "2".repeat(64), bytes: 20 },
  ];
  const regeneratedReplay = structuredClone(artifacts);
  regeneratedReplay[1].sha256 = "3".repeat(64);
  assert.equal(
    visualRuntimeSha256(artifacts, "private/game/validation-replay.json"),
    visualRuntimeSha256(regeneratedReplay, "private/game/validation-replay.json"),
  );
  const changedRuntime = structuredClone(artifacts);
  changedRuntime[0].sha256 = "4".repeat(64);
  assert.notEqual(
    visualRuntimeSha256(artifacts, "private/game/validation-replay.json"),
    visualRuntimeSha256(changedRuntime, "private/game/validation-replay.json"),
  );
});
