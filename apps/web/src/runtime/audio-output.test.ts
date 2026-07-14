import { describe, expect, it } from "vitest";

import { KernelAudioOutput, type AudioOutputContext } from "./audio-output.js";

class FakeContext implements AudioOutputContext {
  state = "suspended";
  currentTime = 1;
  destination = {};
  starts: number[] = [];
  channels: Float32Array[] = [];
  sampleRates: number[] = [];
  resumeCalls = 0;

  async resume(): Promise<void> { this.resumeCalls += 1; this.state = "running"; }
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
    await output.destroy();
    expect(context.state).toBe("closed");
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
});
