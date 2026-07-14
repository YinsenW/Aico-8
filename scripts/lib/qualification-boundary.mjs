import assert from "node:assert/strict";

const ID = /^[a-z0-9][a-z0-9._-]{1,127}$/;

export function assertQualificationBoundaryMilestones(boundary, replay) {
  assert.ok(boundary && typeof boundary === "object" && !Array.isArray(boundary),
    "qualification boundary must be an object");
  assert.match(boundary.kind, /^[a-z][a-z0-9-]{1,39}$/);
  assert.ok(Number.isInteger(boundary.required) && boundary.required > 0);
  assert.equal(boundary.completed, boundary.required);

  const milestoneById = new Map(replay.milestones.map((milestone) => [milestone.id, milestone]));
  if (boundary.milestoneIds !== undefined) {
    assert.ok(Array.isArray(boundary.milestoneIds),
      "qualification boundary milestoneIds must be an array when present");
    assert.equal(boundary.milestoneIds.length, boundary.required,
      "qualification boundary milestoneIds must cover every required boundary");
    assert.equal(new Set(boundary.milestoneIds).size, boundary.milestoneIds.length,
      "qualification boundary milestoneIds must be unique");
    let previousUpdate = -1;
    for (const id of boundary.milestoneIds) {
      assert.match(id, ID, "qualification boundary milestone id is invalid");
      assert.ok(replay.requiredMilestoneIds.includes(id),
        `qualification boundary milestone ${id} is not required by the replay`);
      const milestone = milestoneById.get(id);
      assert.ok(milestone, `qualification boundary milestone ${id} is missing`);
      if (boundary.kind !== "course" && boundary.kind !== "level") {
        assert.equal(milestone.kind, "progression-boundary",
          `${boundary.kind} ${id} must remain a progression-boundary, not a synthetic level`);
      }
      assert.ok(milestone.atUpdate >= previousUpdate,
        "qualification boundary milestones must be ordered by logical update");
      previousUpdate = milestone.atUpdate;
    }
    return;
  }

  assert.ok(boundary.kind === "course" || boundary.kind === "level",
    "non-level qualification boundaries must declare exact milestoneIds");
  const levelMilestones = replay.milestones.filter(({ kind }) => kind === "level-complete");
  assert.equal(levelMilestones.length, boundary.required);
  assert.deepEqual(levelMilestones.map(({ levelOrdinal }) => levelOrdinal),
    Array.from({ length: boundary.required }, (_, index) => index + 1));
}
