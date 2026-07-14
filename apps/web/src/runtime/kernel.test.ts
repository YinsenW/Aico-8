import { describe, expect, it } from "vitest";

import {
  normalizeAudioDiagnosticMask,
  prepareKernelForLogicalReplay,
  type ReplayInitializationKernel,
} from "./kernel.js";

describe("audio diagnostic opt-in", () => {
  it("defaults release and qualification hosts to no diagnostic audio", () => {
    expect(normalizeAudioDiagnosticMask(undefined)).toBe(0);
    expect(normalizeAudioDiagnosticMask(0)).toBe(0);
  });

  it("accepts only the two explicit research bits", () => {
    expect(normalizeAudioDiagnosticMask(1)).toBe(1);
    expect(normalizeAudioDiagnosticMask(2)).toBe(2);
    expect(normalizeAudioDiagnosticMask(3)).toBe(3);
    expect(() => normalizeAudioDiagnosticMask(4)).toThrow(/unsupported bits/);
    expect(() => normalizeAudioDiagnosticMask(-1)).toThrow(/unsupported bits/);
  });
});

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
