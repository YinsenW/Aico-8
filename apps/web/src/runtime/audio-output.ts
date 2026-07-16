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
  readonly baseLatency?: number;
  readonly outputLatency?: number;
  readonly destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): AudioSourceLike;
}

export type AudioOutputContextFactory = () => AudioOutputContext;

export interface AudioOutputDiagnostics {
  readonly sampleRate: number;
  readonly contextState: string;
  readonly unlocked: boolean;
  readonly pendingSamples: number;
  readonly droppedPendingSamples: number;
  readonly scheduledSamples: number;
  readonly scheduledChunks: number;
  readonly underrunCount: number;
  readonly underrunSeconds: number;
  readonly leadResyncCount: number;
  readonly bufferedLeadSeconds: number;
  readonly maximumBufferedLeadSeconds: number;
  readonly baseLatencySeconds: number | null;
  readonly outputLatencySeconds: number | null;
}

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
  #hasScheduled = false;
  #droppedPendingSamples = 0;
  #scheduledSamples = 0;
  #scheduledChunks = 0;
  #underrunCount = 0;
  #underrunSeconds = 0;
  #leadResyncCount = 0;
  #maximumBufferedLeadSeconds = 0;

  constructor(contextFactory: AudioOutputContextFactory = browserContext) {
    this.#contextFactory = contextFactory;
  }

  unlock(): Promise<void> {
    if (this.#unlocked && this.#context?.state === "running") return Promise.resolve();
    if (this.#unlocking) return this.#unlocking;
    if (!this.#context) {
      try {
        this.#context = this.#contextFactory();
      } catch (error) {
        return Promise.reject(error);
      }
    }
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
      const dropped = this.#pending.shift()!.length;
      this.#pendingSamples -= dropped;
      this.#droppedPendingSamples += dropped;
    }
  }

  diagnostics(): AudioOutputDiagnostics {
    const context = this.#context;
    const now = context?.currentTime ?? 0;
    const bufferedLeadSeconds = this.#hasScheduled
      ? Math.max(0, this.#nextStartTime - now)
      : 0;
    const latency = (candidate: number | undefined): number | null =>
      typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0
        ? candidate
        : null;
    return {
      sampleRate: PICO_SAMPLE_RATE,
      contextState: context?.state ?? "uninitialized",
      unlocked: this.#unlocked,
      pendingSamples: this.#pendingSamples,
      droppedPendingSamples: this.#droppedPendingSamples,
      scheduledSamples: this.#scheduledSamples,
      scheduledChunks: this.#scheduledChunks,
      underrunCount: this.#underrunCount,
      underrunSeconds: this.#underrunSeconds,
      leadResyncCount: this.#leadResyncCount,
      bufferedLeadSeconds,
      maximumBufferedLeadSeconds: this.#maximumBufferedLeadSeconds,
      baseLatencySeconds: latency(context?.baseLatency),
      outputLatencySeconds: latency(context?.outputLatency),
    };
  }

  async destroy(): Promise<void> {
    this.#pending = [];
    this.#pendingSamples = 0;
    if (this.#context) await this.#context.close();
    this.#context = undefined;
    this.#unlocked = false;
    this.#nextStartTime = 0;
    this.#hasScheduled = false;
    this.#droppedPendingSamples = 0;
    this.#scheduledSamples = 0;
    this.#scheduledChunks = 0;
    this.#underrunCount = 0;
    this.#underrunSeconds = 0;
    this.#leadResyncCount = 0;
    this.#maximumBufferedLeadSeconds = 0;
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
    if (this.#hasScheduled && this.#nextStartTime < context.currentTime) {
      this.#underrunCount += 1;
      this.#underrunSeconds += context.currentTime - this.#nextStartTime;
      this.#nextStartTime = minimumStart;
    } else if (this.#nextStartTime > context.currentTime + 0.25) {
      this.#leadResyncCount += 1;
      this.#nextStartTime = minimumStart;
    }
    const start = Math.max(minimumStart, this.#nextStartTime);
    source.start(start);
    this.#nextStartTime = start + samples.length / PICO_SAMPLE_RATE;
    this.#hasScheduled = true;
    this.#scheduledSamples += samples.length;
    this.#scheduledChunks += 1;
    this.#maximumBufferedLeadSeconds = Math.max(
      this.#maximumBufferedLeadSeconds,
      this.#nextStartTime - context.currentTime,
    );
  }
}
