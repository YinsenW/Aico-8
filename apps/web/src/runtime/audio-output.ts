const PICO_SAMPLE_RATE = 22050;
const MAX_PENDING_SAMPLES = PICO_SAMPLE_RATE;

interface AudioBufferLike {
  copyToChannel(source: Float32Array, channelNumber: number): void;
}

interface AudioSourceLike {
  buffer: AudioBufferLike | null;
  connect(destination: unknown): void;
  start(when?: number): void;
}

export interface AudioOutputContext {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): AudioSourceLike;
}

export type AudioOutputContextFactory = () => AudioOutputContext;

function browserContext(): AudioOutputContext {
  return new AudioContext({ latencyHint: "interactive" }) as unknown as AudioOutputContext;
}

export class KernelAudioOutput {
  readonly #contextFactory: AudioOutputContextFactory;
  #context: AudioOutputContext | undefined;
  #pending: Int16Array[] = [];
  #pendingSamples = 0;
  #nextStartTime = 0;
  #unlocked = false;
  #unlocking: Promise<void> | undefined;

  constructor(contextFactory: AudioOutputContextFactory = browserContext) {
    this.#contextFactory = contextFactory;
  }

  unlock(): Promise<void> {
    if (this.#unlocked && this.#context?.state === "running") return Promise.resolve();
    if (this.#unlocking) return this.#unlocking;
    if (!this.#context) this.#context = this.#contextFactory();
    const context = this.#context;
    this.#unlocking = (async () => {
      await context.resume();
      this.#unlocked = true;
      const pending = this.#pending;
      this.#pending = [];
      this.#pendingSamples = 0;
      for (const chunk of pending) this.#schedule(chunk);
    })().finally(() => {
      this.#unlocking = undefined;
    });
    return this.#unlocking;
  }

  enqueue(samples: Int16Array): void {
    if (samples.length === 0) return;
    if (this.#unlocked && this.#context?.state === "running") {
      this.#schedule(samples);
      return;
    }
    this.#pending.push(samples.slice());
    this.#pendingSamples += samples.length;
    while (this.#pendingSamples > MAX_PENDING_SAMPLES && this.#pending.length > 1) {
      this.#pendingSamples -= this.#pending.shift()!.length;
    }
  }

  async destroy(): Promise<void> {
    this.#pending = [];
    this.#pendingSamples = 0;
    if (this.#context) await this.#context.close();
    this.#context = undefined;
    this.#unlocked = false;
    this.#nextStartTime = 0;
  }

  #schedule(samples: Int16Array): void {
    const context = this.#context;
    if (!context) return;
    const floats = Float32Array.from(samples, (sample) => sample / 32768);
    const buffer = context.createBuffer(1, floats.length, PICO_SAMPLE_RATE);
    buffer.copyToChannel(floats, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const minimumStart = context.currentTime + 0.03;
    if (this.#nextStartTime < context.currentTime || this.#nextStartTime > context.currentTime + 0.25) {
      this.#nextStartTime = minimumStart;
    }
    const start = Math.max(minimumStart, this.#nextStartTime);
    source.start(start);
    this.#nextStartTime = start + samples.length / PICO_SAMPLE_RATE;
  }
}
