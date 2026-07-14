import test from "node:test";
import assert from "node:assert/strict";

import { assertQualificationBoundaryMilestones } from "./qualification-boundary.mjs";

const replay = (milestones, requiredMilestoneIds = milestones.map(({ id }) => id)) => ({
  milestones,
  requiredMilestoneIds,
});

test("keeps the legacy course contract for real ordered levels", () => {
  assert.doesNotThrow(() => assertQualificationBoundaryMilestones(
    { kind: "course", required: 2, completed: 2 },
    replay([
      { id: "course-01", kind: "level-complete", atUpdate: 10, levelOrdinal: 1 },
      { id: "course-02", kind: "level-complete", atUpdate: 20, levelOrdinal: 2 },
    ]),
  ));
});

test("requires non-level games to bind their real milestone identities", () => {
  assert.throws(() => assertQualificationBoundaryMilestones(
    { kind: "checkpoint", required: 2, completed: 2 },
    replay([
      { id: "checkpoint-01", kind: "level-complete", atUpdate: 10, levelOrdinal: 1 },
      { id: "checkpoint-02", kind: "level-complete", atUpdate: 20, levelOrdinal: 2 },
    ]),
  ), /must declare exact milestoneIds/);
});

test("accepts explicit ordered checkpoint milestones without relabeling them as levels", () => {
  assert.doesNotThrow(() => assertQualificationBoundaryMilestones(
    {
      kind: "checkpoint",
      required: 2,
      completed: 2,
      milestoneIds: ["checkpoint-01", "checkpoint-02"],
    },
    replay([
      { id: "checkpoint-01", kind: "progression-boundary", atUpdate: 10 },
      { id: "checkpoint-02", kind: "progression-boundary", atUpdate: 20 },
    ]),
  ));
});

test("rejects any non-level boundary disguised as a level even with explicit ids", () => {
  assert.throws(() => assertQualificationBoundaryMilestones(
    { kind: "chapter", required: 1, completed: 1, milestoneIds: ["checkpoint-01"] },
    replay([{ id: "checkpoint-01", kind: "level-complete", atUpdate: 10, levelOrdinal: 1 }]),
  ), /must remain a progression-boundary/);
});

test("rejects missing, duplicate, and out-of-order explicit milestone bindings", () => {
  const value = replay([
    { id: "checkpoint-01", kind: "progression-boundary", atUpdate: 20 },
    { id: "checkpoint-02", kind: "progression-boundary", atUpdate: 10 },
  ]);
  assert.throws(() => assertQualificationBoundaryMilestones(
    {
      kind: "checkpoint",
      required: 2,
      completed: 2,
      milestoneIds: ["checkpoint-01", "checkpoint-02"],
    }, value,
  ), /ordered by logical update/);
  assert.throws(() => assertQualificationBoundaryMilestones(
    {
      kind: "checkpoint",
      required: 2,
      completed: 2,
      milestoneIds: ["checkpoint-01", "checkpoint-01"],
    }, value,
  ), /must be unique/);
});
