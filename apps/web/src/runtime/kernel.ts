export interface GameManifest {
  readonly formatVersion: 1;
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly rom: string;
  readonly source: string;
  readonly presentation: string;
  readonly persistenceKey: string;
  readonly cartSha256?: string;
  readonly validationReplay?: string;
  readonly researchOnly?: boolean;
  readonly sourceLicense?: string;
  readonly sourceUrl?: string;
}

export interface DrawCommand {
  readonly opcode: number;
  readonly flags: number;
  readonly args: readonly number[];
  readonly payload: Uint8Array;
}

interface EmscriptenKernel {
  HEAPU8: Uint8Array;
  UTF8ToString(pointer: number): string;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _aico8_create(): number;
  _aico8_destroy(runtime: number): void;
  _aico8_load_cart(runtime: number, rom: number, romSize: number, source: number, sourceSize: number): number;
  _aico8_load_persistent(runtime: number, data: number, size: number): number;
  _aico8_start(runtime: number): number;
  _aico8_tick60(runtime: number, buttons: number): number;
  _aico8_framebuffer(runtime: number): number;
  _aico8_framebuffer_size(): number;
  _aico8_draw_commands(runtime: number): number;
  _aico8_draw_command_count(runtime: number): number;
  _aico8_draw_payload(runtime: number): number;
  _aico8_draw_payload_size(runtime: number): number;
  _aico8_copy_map_region(runtime: number, cellX: number, cellY: number, width: number, height: number, destination: number, capacity: number): number;
  _aico8_get_global_raw(runtime: number, name: number, output: number): number;
  _aico8_get_global_boolean(runtime: number, name: number, output: number): number;
  _aico8_copy_persistent(runtime: number, destination: number, capacity: number): number;
  _aico8_last_error(runtime: number): number;
}

interface KernelModule {
  default(options?: Record<string, unknown>): Promise<EmscriptenKernel>;
}

const DRAW_COMMAND_BYTES = 68;
const DRAW_ARGUMENT_COUNT = 12;
const PERSISTENT_BYTES = 256;

export function decodeStoredPersistence(value: string | null): Uint8Array {
  if (!value) return new Uint8Array();
  const pairs = value.match(/[0-9a-f]{2}/gi);
  return pairs ? Uint8Array.from(pairs, (pair) => Number.parseInt(pair, 16)) : new Uint8Array();
}

function encodeStoredBytes(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function resolveAsset(manifestUrl: URL, relative: string): URL {
  return new URL(relative, manifestUrl);
}

async function fetchBytes(url: URL): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load ${url.pathname} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function loadGameManifest(url: URL): Promise<GameManifest> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load game manifest (${response.status})`);
  const manifest = await response.json() as GameManifest;
  if (manifest.formatVersion !== 1 || !manifest.id || !manifest.rom || !manifest.source
    || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.presentation)) {
    throw new Error("The game manifest is not an Aico 8 format-1 module");
  }
  return manifest;
}

export class Aico8Kernel {
  readonly manifest: GameManifest;
  readonly #module: EmscriptenKernel;
  readonly #runtime: number;
  readonly #saveScratch: number;
  readonly #valueScratch: number;
  #lastSaved = "";

  private constructor(module: EmscriptenKernel, runtime: number, manifest: GameManifest) {
    this.#module = module;
    this.#runtime = runtime;
    this.#saveScratch = module._malloc(PERSISTENT_BYTES);
    this.#valueScratch = module._malloc(4);
    this.manifest = manifest;
  }

  static async create(baseUrl: string, manifestUrl: URL, manifest: GameManifest): Promise<Aico8Kernel> {
    const kernelUrl = new URL(`${baseUrl}kernel/aico8-kernel.js`, window.location.origin);
    const imported = await import(/* @vite-ignore */ kernelUrl.href) as KernelModule;
    const module = await imported.default();
    const runtime = module._aico8_create();
    if (!runtime) throw new Error("Unable to allocate the Aico 8 runtime");

    const instance = new Aico8Kernel(module, runtime, manifest);
    try {
      const [rom, source] = await Promise.all([
        fetchBytes(resolveAsset(manifestUrl, manifest.rom)),
        fetchBytes(resolveAsset(manifestUrl, manifest.source)),
      ]);
      instance.#load(rom, source);
      return instance;
    } catch (error) {
      instance.destroy();
      throw error;
    }
  }

  #withHeapBytes(bytes: Uint8Array, callback: (pointer: number) => void): void {
    const pointer = this.#module._malloc(Math.max(bytes.length, 1));
    if (!pointer) throw new Error("The Aico 8 runtime ran out of memory");
    try {
      this.#module.HEAPU8.set(bytes, pointer);
      callback(pointer);
    } finally {
      this.#module._free(pointer);
    }
  }

  #load(rom: Uint8Array, source: Uint8Array): void {
    this.#withHeapBytes(rom, (romPointer) => {
      this.#withHeapBytes(source, (sourcePointer) => {
        if (!this.#module._aico8_load_cart(this.#runtime, romPointer, rom.length, sourcePointer, source.length)) {
          throw new Error(this.lastError());
        }
      });
    });

    let stored: Uint8Array<ArrayBufferLike> = new Uint8Array();
    try {
      stored = decodeStoredPersistence(localStorage.getItem(this.manifest.persistenceKey));
    } catch {
      // Storage is optional in private browsing and locked-down WebViews.
    }
    this.#lastSaved = encodeStoredBytes(stored);
    this.#withHeapBytes(stored, (pointer) => {
      if (!this.#module._aico8_load_persistent(this.#runtime, pointer, stored.length)) {
        throw new Error("Unable to restore game progress");
      }
    });
    if (!this.#module._aico8_start(this.#runtime)) throw new Error(this.lastError());
  }

  tick60(buttons: number): boolean {
    const result = this.#module._aico8_tick60(this.#runtime, buttons & 0x3f);
    if (result < 0) throw new Error(this.lastError());
    if (result > 0) this.#persistIfChanged();
    return result > 0;
  }

  tickLogicalUpdate(buttons: number): void {
    for (let hostTick = 0; hostTick < 3; hostTick += 1) {
      if (this.tick60(buttons)) return;
    }
    throw new Error("The cartridge did not produce a logical update within three 60 Hz host ticks");
  }

  framebuffer(): Uint8Array {
    const pointer = this.#module._aico8_framebuffer(this.#runtime);
    const size = this.#module._aico8_framebuffer_size();
    return this.#module.HEAPU8.slice(pointer, pointer + size);
  }

  drawCommands(): readonly DrawCommand[] {
    const commandsPointer = this.#module._aico8_draw_commands(this.#runtime);
    const count = this.#module._aico8_draw_command_count(this.#runtime);
    const payloadPointer = this.#module._aico8_draw_payload(this.#runtime);
    const payloadSize = this.#module._aico8_draw_payload_size(this.#runtime);
    const heap = this.#module.HEAPU8;
    const view = new DataView(heap.buffer);
    const result: DrawCommand[] = [];

    for (let index = 0; index < count; index += 1) {
      const offset = commandsPointer + index * DRAW_COMMAND_BYTES;
      const relativePayload = view.getUint32(offset + 12, true);
      const commandPayloadSize = view.getUint32(offset + 16, true);
      const safePayloadSize = Math.min(commandPayloadSize, Math.max(0, payloadSize - relativePayload));
      result.push({
        opcode: view.getUint16(offset, true),
        flags: view.getUint16(offset + 2, true),
        args: Array.from({ length: DRAW_ARGUMENT_COUNT }, (_, argument) =>
          view.getInt32(offset + 20 + argument * 4, true) / 65536),
        payload: heap.slice(payloadPointer + relativePayload, payloadPointer + relativePayload + safePayloadSize),
      });
    }
    return result;
  }

  mapRegion(cellX: number, cellY: number, width: number, height: number): Uint8Array {
    const size = width * height;
    const pointer = this.#module._malloc(Math.max(size, 1));
    if (!pointer) throw new Error("Unable to allocate the map snapshot");
    try {
      const copied = this.#module._aico8_copy_map_region(
        this.#runtime, cellX, cellY, width, height, pointer, size,
      );
      if (copied !== size) throw new Error("Unable to copy the logical map region");
      return this.#module.HEAPU8.slice(pointer, pointer + size);
    } finally {
      this.#module._free(pointer);
    }
  }

  globalNumber(name: string): number | undefined {
    return this.#withGlobalName(name, (pointer) => {
      if (!this.#module._aico8_get_global_raw(this.#runtime, pointer, this.#valueScratch)) return undefined;
      return new DataView(this.#module.HEAPU8.buffer).getInt32(this.#valueScratch, true) / 65536;
    });
  }

  globalBoolean(name: string): boolean | undefined {
    return this.#withGlobalName(name, (pointer) => {
      if (!this.#module._aico8_get_global_boolean(this.#runtime, pointer, this.#valueScratch)) return undefined;
      return new DataView(this.#module.HEAPU8.buffer).getInt32(this.#valueScratch, true) !== 0;
    });
  }

  lastError(): string {
    return this.#module.UTF8ToString(this.#module._aico8_last_error(this.#runtime));
  }

  destroy(): void {
    this.#module._free(this.#valueScratch);
    this.#module._free(this.#saveScratch);
    this.#module._aico8_destroy(this.#runtime);
  }

  #withGlobalName<T>(name: string, callback: (pointer: number) => T): T {
    const encoded = new TextEncoder().encode(`${name}\0`);
    let result!: T;
    this.#withHeapBytes(encoded, (pointer) => {
      result = callback(pointer);
    });
    return result;
  }

  #persistIfChanged(): void {
    if (this.#module._aico8_copy_persistent(this.#runtime, this.#saveScratch, PERSISTENT_BYTES) !== PERSISTENT_BYTES) {
      return;
    }
    const next = encodeStoredBytes(this.#module.HEAPU8.slice(this.#saveScratch, this.#saveScratch + PERSISTENT_BYTES));
    if (next === this.#lastSaved) return;
    this.#lastSaved = next;
    try {
      localStorage.setItem(this.manifest.persistenceKey, next);
    } catch {
      // The running game remains playable when persistence is unavailable.
    }
  }
}
