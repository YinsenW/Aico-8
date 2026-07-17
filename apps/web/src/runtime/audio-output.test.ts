import { describe, expect, it } from "vitest";

import { KernelAudioOutput, type AudioOutputContext } from "./audio-output.js";

class FakeContext implements AudioOutputContext {
  state = "suspended";
  currentTime = 1;
  baseLatency = 0.01;
  outputLatency = 0.02;
  destination = {};
  starts: number[] = [];
  channels: Float32Array[] = [];
  sampleRates: number[] = [];
  resumeCalls = 0;
  suspendCalls = 0;

  async resume(): Promise<void> { this.resumeCalls += 1; this.state = "running"; }
  async suspend(): Promise<void> { this.suspendCalls += 1; this.state = "suspended"; }
  async close(): Promise<void> { this.state = "closed"; }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    this.sampleRates.push(sampleRate);
    return {
      copyToChannel: (source: Float32Array) => {
        expect(source.length).toBe(length);
        this.channels.push(source.slice());
      },
    };
  }
  createBufferSource() {
    return {
      buffer: null,
      connect: () => undefined,
      start: (when = 0) => { this.starts.push(when); },
    };
  }
}

describe("KernelAudioOutput", () => {
  it("queues before browser unlock and schedules the kernel PCM in order", async () => {
    const context = new FakeContext();
    const output = new KernelAudioOutput(() => context);
    output.enqueue(Int16Array.of(-32768, 0, 16384));
    expect(context.starts).toEqual([]);
    await output.unlock();
    output.enqueue(Int16Array.of(32767));
    expect(context.sampleRates).toEqual([22050, 22050]);
    expect([...context.channels[0]!]).toEqual([-1, 0, 0.5]);
    expect(context.starts[1]!).toBeGreaterThan(context.starts[0]!);
    expect(output.diagnostics()).toMatchObject({
      sampleRate: 22050,
      contextState: "running",
      unlocked: true,
      pendingSamples: 0,
      droppedPendingSamples: 0,
      scheduledSamples: 4,
      scheduledChunks: 2,
      underrunCount: 0,
      leadResyncCount: 0,
      baseLatencySeconds: 0.01,
      outputLatencySeconds: 0.02,
    });
    expect(output.diagnostics().maximumBufferedLeadSeconds).toBeGreaterThan(0.03);
    await output.destroy();
    expect(context.state).toBe("closed");
    expect(output.diagnostics()).toMatchObject({
      contextState: "uninitialized",
      unlocked: false,
      scheduledSamples: 0,
      scheduledChunks: 0,
    });
  });

  it("coalesces simultaneous gesture unlocks without duplicating queued PCM", async () => {
    const context = new FakeContext();
    const output = new KernelAudioOutput(() => context);
    output.enqueue(Int16Array.of(1024));
    await Promise.all([output.unlock(), output.unlock()]);
    expect(context.resumeCalls).toBe(1);
    expect(context.channels).toHaveLength(1);
    expect(context.starts).toHaveLength(1);
  });

  it("resumes and drains audio again after the browser suspends its context", async () => {
    const context = new FakeContext();
    const output = new KernelAudioOutput(() => context);
    await output.unlock();
    context.state = "suspended";
    output.enqueue(Int16Array.of(2048));
    expect(context.channels).toHaveLength(0);
    await output.unlock();
    expect(context.resumeCalls).toBe(2);
    expect(context.channels).toHaveLength(1);
  });

  it("suspends and resumes an unlocked context across a native interruption", async () => {
    const context = new FakeContext();
    const output = new KernelAudioOutput(() => context);
    await output.unlock();
    await output.suspend();
    expect(context.state).toBe("suspended");
    expect(context.suspendCalls).toBe(1);
    await output.resumeAfterInterruption();
    expect(context.state).toBe("running");
    expect(context.resumeCalls).toBe(2);
  });

  it("records a scheduler underrun and its missing duration", async () => {
    const context = new FakeContext();
    const output = new KernelAudioOutput(() => context);
    await output.unlock();
    output.enqueue(new Int16Array(2205));
    context.currentTime = 1.2;
    output.enqueue(Int16Array.of(1));
    expect(output.diagnostics()).toMatchObject({
      underrunCount: 1,
      scheduledSamples: 2206,
      scheduledChunks: 2,
    });
    expect(output.diagnostics().underrunSeconds).toBeCloseTo(0.07, 8);
  });

  it("bounds locked-context PCM and reports every dropped sample", async () => {
    const context = new FakeContext();
    const output = new KernelAudioOutput(() => context);
    output.enqueue(new Int16Array(12_000));
    output.enqueue(new Int16Array(12_000));
    output.enqueue(new Int16Array(12_000));
    expect(output.diagnostics()).toMatchObject({
      pendingSamples: 12_000,
      droppedPendingSamples: 24_000,
      scheduledSamples: 0,
    });
    await output.unlock();
    expect(output.diagnostics()).toMatchObject({
      pendingSamples: 0,
      droppedPendingSamples: 24_000,
      scheduledSamples: 12_000,
      scheduledChunks: 1,
    });
  });

  it("reports when an excessive queued lead is resynchronized", async () => {
    const context = new FakeContext();
    const output = new KernelAudioOutput(() => context);
    await output.unlock();
    output.enqueue(new Int16Array(6000));
    output.enqueue(Int16Array.of(1));
    expect(output.diagnostics()).toMatchObject({
      leadResyncCount: 1,
      underrunCount: 0,
      scheduledSamples: 6001,
      scheduledChunks: 2,
    });
  });

  it("turns a synchronous browser context failure into an unlock rejection", async () => {
    const output = new KernelAudioOutput(() => {
      throw new Error("audio unavailable");
    });
    await expect(output.unlock()).rejects.toThrow("audio unavailable");
    expect(output.diagnostics()).toMatchObject({
      contextState: "uninitialized",
      unlocked: false,
    });
  });
});
