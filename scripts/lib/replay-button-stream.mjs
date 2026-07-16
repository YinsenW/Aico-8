import assert from "node:assert/strict";

export function parseButtonUpdates(value) {
  return value.split(",").filter(Boolean).flatMap((token) => {
    const [maskText, repeatText, extra] = token.split("*");
    assert.equal(extra, undefined, "button-update tokens use mask or mask*repeat");
    const mask = Number(maskText);
    const repeat = repeatText === undefined ? 1 : Number(repeatText);
    assert.ok(Number.isSafeInteger(mask) && mask >= 0 && mask <= 63,
      "button masks must be integers from 0 through 63");
    assert.ok(Number.isSafeInteger(repeat) && repeat >= 1 && repeat <= 36_000,
      "button repeat counts must be integers from 1 through 36000");
    return Array.from({ length: repeat }, () => mask);
  });
}

export function expandCleanSinglePlayerReplay(replay) {
  assert.equal(replay.schemaVersion, "aico8.replay.v1", "--replay must be Replay v1");
  assert.equal(replay.trace?.schemaVersion, "aico8.input-trace.v1");
  assert.equal(replay.trace.initialState?.kind, "clean",
    "cart smoke currently requires a clean replay initial state");
  assert.ok(Number.isSafeInteger(replay.trace.totalUpdates) && replay.trace.totalUpdates > 0);
  const buttons = new Uint8Array(replay.trace.totalUpdates);
  let expectedStart = 0;
  for (const span of replay.trace.spans) {
    assert.equal(span.startUpdate, expectedStart, "replay spans must be contiguous and ordered");
    assert.ok(Number.isSafeInteger(span.endUpdateExclusive)
      && span.endUpdateExclusive > span.startUpdate
      && span.endUpdateExclusive <= buttons.length);
    assert.equal(span.players?.length, 1, "cart smoke currently accepts one PICO-8 player");
    const mask = span.players[0];
    assert.ok(Number.isSafeInteger(mask) && mask >= 0 && mask <= 63);
    buttons.fill(mask, span.startUpdate, span.endUpdateExclusive);
    expectedStart = span.endUpdateExclusive;
  }
  assert.equal(expectedStart, buttons.length, "replay spans must cover every logical update");
  assert.deepEqual(replay.trace.hostActions ?? [], [],
    "cart smoke rejects host actions until their exact invocation boundary is represented");
  return buttons;
}
