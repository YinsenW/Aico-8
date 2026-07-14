import { describe, expect, it } from "vitest";

import { prepareKernelForLogicalReplay, type ReplayInitializationKernel } from "./kernel.js";

class InitializingKernel implements ReplayInitializationKernel {
  ticks = 0;
  readonly completeAfter: number;

  constructor(completeAfter: number) {
    this.completeAfter = completeAfter;
  }

  initializationComplete(): boolean { return this.ticks >= this.completeAfter; }
  tick60(buttons: number): boolean {
    expect(buttons).toBe(0);
    this.ticks += 1;
    return true;
  }
  readAudio(): Int16Array { return Int16Array.of(this.ticks); }
}

describe("prepareKernelForLogicalReplay", () => {
  it("advances flip-driven initialization with neutral input before replay update zero", () => {
    const kernel = new InitializingKernel(3);
    expect(prepareKernelForLogicalReplay(kernel)).toEqual({
      hostTicks: 3,
      discardedAudioSamples: 3,
    });
  });

  it("fails closed when initialization never reaches a replay-safe boundary", () => {
    const kernel = new InitializingKernel(4);
    expect(() => prepareKernelForLogicalReplay(kernel, 3)).toThrow(/did not finish/);
  });
});
