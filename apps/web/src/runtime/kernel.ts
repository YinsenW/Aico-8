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
  readonly semanticVectors?: string;
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

export interface KernelMenuItem {
  readonly index: number;
  readonly label: string;
  readonly filter: number;
}

export const KernelAudioCapability = {
  eventLedger: 1 << 0,
  channelStatus: 1 << 1,
  stat57: 1 << 2,
  stat46Through56: 1 << 3,
  filters: 1 << 4,
  customInstruments: 1 << 5,
  customWaveforms: 1 << 6,
} as const;

export const KernelAudioDiagnostic = {
  customInstrument: 1 << 0,
  customWaveform: 1 << 1,
} as const;

export function normalizeAudioDiagnosticMask(mask: number | undefined): number {
  const value = mask ?? 0;
  const allowed = KernelAudioDiagnostic.customInstrument | KernelAudioDiagnostic.customWaveform;
  if (!Number.isSafeInteger(value) || value < 0 || (value & ~allowed) !== 0) {
    throw new Error("Audio diagnostic mask contains unsupported bits");
  }
  return value;
}

export interface KernelAudioChannelStatus {
  readonly sfx: number;
  readonly note: number;
  readonly deferredMusicSfx: number;
  readonly isMusic: boolean;
  readonly isReleasing: boolean;
}

export interface KernelAudioEvent {
  readonly sequence: number;
  readonly sampleLow: number;
  readonly sampleHigh: number;
  readonly kind: number;
  readonly channel: number;
  readonly sfx: number;
  readonly note: number;
  readonly musicPattern: number;
}

export interface KernelHostOptions {
  /** Overrides host storage for deterministic replay/capture sessions. */
  readonly initialPersistence?: Uint8Array;
  /** Defaults to true; validation playback disables external save writes. */
  readonly persistenceWrites?: boolean;
  /** Explicit research-only opt-in. Qualification and release paths omit it. */
  readonly diagnosticAudioMask?: number;
}

export interface ReplayInitializationKernel {
  initializationComplete(): boolean;
  tick60(buttons: number): boolean;
  readAudio(): Int16Array;
}

export interface ReplayInitializationResult {
  hostTicks: number;
  discardedAudioSamples: number;
}

export function prepareKernelForLogicalReplay(
  kernel: ReplayInitializationKernel,
  maximumHostTicks = 36_000,
): ReplayInitializationResult {
  if (!Number.isSafeInteger(maximumHostTicks) || maximumHostTicks < 1) {
    throw new Error("maximumHostTicks must be a positive safe integer");
  }
  let hostTicks = 0;
  let discardedAudioSamples = 0;
  while (!kernel.initializationComplete()) {
    if (hostTicks >= maximumHostTicks) {
      throw new Error(`Cartridge initialization did not finish within ${maximumHostTicks} host ticks`);
    }
    kernel.tick60(0);
    discardedAudioSamples += kernel.readAudio().length;
    hostTicks += 1;
  }
  return { hostTicks, discardedAudioSamples };
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
  _aico8_initialization_complete(runtime: number): number;
  _aico8_tick60(runtime: number, buttons: number): number;
  _aico8_audio_available(runtime: number): number;
  _aico8_read_audio(runtime: number, destination: number, capacity: number): number;
  _aico8_audio_capabilities(runtime: number): number;
  _aico8_set_audio_diagnostic_mask(runtime: number, mask: number): number;
  _aico8_audio_diagnostic_flags(runtime: number): number;
  _aico8_get_audio_channel_status(runtime: number, channel: number, status: number): number;
  _aico8_copy_audio_events(runtime: number, destination: number, capacity: number): number;
  _aico8_framebuffer(runtime: number): number;
  _aico8_framebuffer_size(): number;
  _aico8_draw_commands(runtime: number): number;
  _aico8_draw_command_count(runtime: number): number;
  _aico8_draw_payload(runtime: number): number;
  _aico8_draw_payload_size(runtime: number): number;
  _aico8_copy_map_region(runtime: number, cellX: number, cellY: number, width: number, height: number, destination: number, capacity: number): number;
  _aico8_copy_sprite_region(runtime: number, pixelX: number, pixelY: number, width: number, height: number, destination: number, capacity: number): number;
  _aico8_copy_sprite_flags(runtime: number, firstSprite: number, count: number, destination: number, capacity: number): number;
  _aico8_copy_palette_state(runtime: number, destination: number, capacity: number): number;
  _aico8_get_global_raw(runtime: number, name: number, output: number): number;
  _aico8_get_global_boolean(runtime: number, name: number, output: number): number;
  _aico8_copy_global_string(runtime: number, name: number, destination: number, capacity: number): number;
  _aico8_get_table_length(runtime: number, name: number, output: number): number;
  _aico8_get_table_value_raw(runtime: number, name: number, oneBasedIndex: number, output: number): number;
  _aico8_get_table_field_raw(runtime: number, name: number, field: number, output: number): number;
  _aico8_get_table_field_boolean(runtime: number, name: number, field: number, output: number): number;
  _aico8_get_table_entry_raw(runtime: number, name: number, oneBasedIndex: number, field: number, output: number): number;
  _aico8_get_table_entry_boolean(runtime: number, name: number, oneBasedIndex: number, field: number, output: number): number;
  _aico8_copy_menu_item_label(runtime: number, index: number, destination: number, capacity: number): number;
  _aico8_menu_item_filter(runtime: number, index: number): number;
  _aico8_invoke_menu_item(runtime: number, index: number, buttons: number, keepOpen: number): number;
  _aico8_copy_persistent(runtime: number, destination: number, capacity: number): number;
  _aico8_last_error(runtime: number): number;
  _aico8_diagnostic_output(runtime: number): number;
}

interface KernelModule {
  default(options?: Record<string, unknown>): Promise<EmscriptenKernel>;
}

const DRAW_COMMAND_BYTES = 68;
const DRAW_ARGUMENT_COUNT = 12;
const PERSISTENT_BYTES = 256;
const AUDIO_SCRATCH_SAMPLES = 2048;
const AUDIO_CHANNEL_STATUS_BYTES = 20;
const AUDIO_EVENT_BYTES = 32;
const MENU_LABEL_BYTES = 17;

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
  readonly #audioScratch: number;
  readonly #menuLabelScratch: number;
  readonly #persistenceWrites: boolean;
  readonly #namePointers = new Map<string, number>();
  #lastSaved = "";

  private constructor(
    module: EmscriptenKernel,
    runtime: number,
    manifest: GameManifest,
    options: KernelHostOptions,
  ) {
    this.#module = module;
    this.#runtime = runtime;
    this.#saveScratch = module._malloc(PERSISTENT_BYTES);
    this.#valueScratch = module._malloc(4);
    this.#audioScratch = module._malloc(AUDIO_SCRATCH_SAMPLES * 2);
    this.#menuLabelScratch = module._malloc(MENU_LABEL_BYTES);
    this.#persistenceWrites = options.persistenceWrites ?? true;
    this.manifest = manifest;
  }

  static async create(
    packageBaseUrl: URL,
    manifestUrl: URL,
    manifest: GameManifest,
    options: KernelHostOptions = {},
  ): Promise<Aico8Kernel> {
    const kernelUrl = new URL("kernel/aico8-kernel.js", packageBaseUrl);
    const imported = await import(/* @vite-ignore */ kernelUrl.href) as KernelModule;
    const module = await imported.default();
    const runtime = module._aico8_create();
    if (!runtime) throw new Error("Unable to allocate the Aico 8 runtime");

    const instance = new Aico8Kernel(module, runtime, manifest, options);
    try {
      const [rom, source] = await Promise.all([
        fetchBytes(resolveAsset(manifestUrl, manifest.rom)),
        fetchBytes(resolveAsset(manifestUrl, manifest.source)),
      ]);
      instance.#load(rom, source, options);
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

  #load(rom: Uint8Array, source: Uint8Array, options: KernelHostOptions): void {
    this.#withHeapBytes(rom, (romPointer) => {
      this.#withHeapBytes(source, (sourcePointer) => {
        if (!this.#module._aico8_load_cart(this.#runtime, romPointer, rom.length, sourcePointer, source.length)) {
          throw new Error(this.lastError());
        }
      });
    });

    const diagnosticMask = normalizeAudioDiagnosticMask(options.diagnosticAudioMask);
    if (diagnosticMask !== 0
      && !this.#module._aico8_set_audio_diagnostic_mask(this.#runtime, diagnosticMask)) {
      throw new Error("Unable to select audio diagnostic mode before execution");
    }

    let stored: Uint8Array<ArrayBufferLike> = options.initialPersistence?.slice() ?? new Uint8Array();
    if (!options.initialPersistence) {
      try {
        stored = decodeStoredPersistence(localStorage.getItem(this.manifest.persistenceKey));
      } catch {
        // Storage is optional in private browsing and locked-down WebViews.
      }
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
    if (!this.initializationComplete()) {
      throw new Error("Cartridge initialization must finish before logical replay input begins");
    }
    for (let hostTick = 0; hostTick < 3; hostTick += 1) {
      if (this.tick60(buttons)) return;
    }
    throw new Error("The cartridge did not produce a logical update within three 60 Hz host ticks");
  }

  initializationComplete(): boolean {
    return this.#module._aico8_initialization_complete(this.#runtime) === 1;
  }

  readAudio(): Int16Array {
    const chunks: Int16Array[] = [];
    let total = 0;
    while (this.#module._aico8_audio_available(this.#runtime) > 0) {
      const count = this.#module._aico8_read_audio(
        this.#runtime, this.#audioScratch, AUDIO_SCRATCH_SAMPLES,
      );
      if (count <= 0 || count > AUDIO_SCRATCH_SAMPLES) throw new Error("Unable to drain kernel audio");
      const view = new DataView(this.#module.HEAPU8.buffer, this.#audioScratch, count * 2);
      const chunk = Int16Array.from({ length: count }, (_, index) => view.getInt16(index * 2, true));
      chunks.push(chunk);
      total += count;
    }
    const result = new Int16Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  audioCapabilities(): number {
    return this.#module._aico8_audio_capabilities(this.#runtime) >>> 0;
  }

  audioDiagnosticFlags(): number {
    return this.#module._aico8_audio_diagnostic_flags(this.#runtime) >>> 0;
  }

  audioChannelStatus(channel: number): KernelAudioChannelStatus | undefined {
    if (!Number.isSafeInteger(channel) || channel < 0 || channel > 3) {
      throw new Error("PICO-8 audio channel indices must be integers from 0 through 3");
    }
    const pointer = this.#module._malloc(AUDIO_CHANNEL_STATUS_BYTES);
    if (!pointer) throw new Error("Unable to allocate the audio status snapshot");
    try {
      if (!this.#module._aico8_get_audio_channel_status(this.#runtime, channel, pointer)) {
        return undefined;
      }
      const view = new DataView(this.#module.HEAPU8.buffer);
      return {
        sfx: view.getInt32(pointer, true),
        note: view.getInt32(pointer + 4, true),
        deferredMusicSfx: view.getInt32(pointer + 8, true),
        isMusic: view.getInt32(pointer + 12, true) !== 0,
        isReleasing: view.getInt32(pointer + 16, true) !== 0,
      };
    } finally {
      this.#module._free(pointer);
    }
  }

  audioEvents(maximumEvents = 256): readonly KernelAudioEvent[] {
    if (!Number.isSafeInteger(maximumEvents) || maximumEvents < 1 || maximumEvents > 256) {
      throw new Error("maximumEvents must be an integer from 1 through 256");
    }
    const pointer = this.#module._malloc(maximumEvents * AUDIO_EVENT_BYTES);
    if (!pointer) throw new Error("Unable to allocate the audio event snapshot");
    try {
      const count = this.#module._aico8_copy_audio_events(this.#runtime, pointer, maximumEvents);
      if (count > maximumEvents) throw new Error("Kernel returned too many audio events");
      const view = new DataView(this.#module.HEAPU8.buffer);
      return Array.from({ length: count }, (_, index) => {
        const offset = pointer + index * AUDIO_EVENT_BYTES;
        return {
          sequence: view.getUint32(offset, true),
          sampleLow: view.getUint32(offset + 4, true),
          sampleHigh: view.getUint32(offset + 8, true),
          kind: view.getInt32(offset + 12, true),
          channel: view.getInt32(offset + 16, true),
          sfx: view.getInt32(offset + 20, true),
          note: view.getInt32(offset + 24, true),
          musicPattern: view.getInt32(offset + 28, true),
        };
      });
    } finally {
      this.#module._free(pointer);
    }
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

  spriteRegion(pixelX: number, pixelY: number, width: number, height: number): Uint8Array {
    if (![pixelX, pixelY, width, height].every(Number.isSafeInteger)
      || pixelX < 0 || pixelY < 0 || width < 0 || height < 0
      || pixelX + width > 128 || pixelY + height > 128) {
      throw new Error("Sprite region must be an integer rectangle inside the 128 by 128 sprite sheet");
    }
    const size = width * height;
    const pointer = this.#module._malloc(Math.max(size, 1));
    if (!pointer) throw new Error("Unable to allocate the sprite snapshot");
    try {
      const copied = this.#module._aico8_copy_sprite_region(
        this.#runtime, pixelX, pixelY, width, height, pointer, size,
      );
      if (copied !== size) throw new Error("Unable to copy the sprite region");
      return this.#module.HEAPU8.slice(pointer, pointer + size);
    } finally {
      this.#module._free(pointer);
    }
  }

  spriteFlags(firstSprite = 0, count = 256): Uint8Array {
    if (![firstSprite, count].every(Number.isSafeInteger)
      || firstSprite < 0 || count < 0 || firstSprite + count > 256) {
      throw new Error("Sprite flag range must be an integer interval inside 0 through 255");
    }
    const pointer = this.#module._malloc(Math.max(count, 1));
    if (!pointer) throw new Error("Unable to allocate the sprite flag snapshot");
    try {
      const copied = this.#module._aico8_copy_sprite_flags(
        this.#runtime, firstSprite, count, pointer, count,
      );
      if (copied !== count) throw new Error("Unable to copy sprite flags");
      return this.#module.HEAPU8.slice(pointer, pointer + count);
    } finally {
      this.#module._free(pointer);
    }
  }

  paletteState(): { readonly draw: Uint8Array; readonly display: Uint8Array } {
    const size = 32;
    const pointer = this.#module._malloc(size);
    if (!pointer) throw new Error("Unable to allocate the palette state snapshot");
    try {
      if (this.#module._aico8_copy_palette_state(this.#runtime, pointer, size) !== size) {
        throw new Error("Unable to copy palette state");
      }
      return {
        draw: this.#module.HEAPU8.slice(pointer, pointer + 16),
        display: this.#module.HEAPU8.slice(pointer + 16, pointer + 32),
      };
    } finally {
      this.#module._free(pointer);
    }
  }

  globalNumber(name: string): number | undefined {
    if (!this.#module._aico8_get_global_raw(this.#runtime, this.#namePointer(name), this.#valueScratch)) return undefined;
    return new DataView(this.#module.HEAPU8.buffer).getInt32(this.#valueScratch, true) / 65536;
  }

  globalBoolean(name: string): boolean | undefined {
    if (!this.#module._aico8_get_global_boolean(this.#runtime, this.#namePointer(name), this.#valueScratch)) return undefined;
    return new DataView(this.#module.HEAPU8.buffer).getInt32(this.#valueScratch, true) !== 0;
  }

  globalString(name: string, maximumBytes = 4095): string | undefined {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 65_535) {
      throw new Error("maximumBytes must be an integer from 1 through 65535");
    }
    const capacity = maximumBytes + 1;
    const pointer = this.#module._malloc(capacity);
    if (!pointer) throw new Error("Unable to allocate the string snapshot");
    try {
      const size = this.#module._aico8_copy_global_string(
        this.#runtime, this.#namePointer(name), pointer, capacity,
      );
      return size > 0 ? this.#module.UTF8ToString(pointer) : undefined;
    } finally {
      this.#module._free(pointer);
    }
  }

  tableLength(name: string): number | undefined {
    if (!this.#module._aico8_get_table_length(this.#runtime, this.#namePointer(name), this.#valueScratch)) {
      return undefined;
    }
    return new DataView(this.#module.HEAPU8.buffer).getUint32(this.#valueScratch, true);
  }

  tableValueNumber(name: string, oneBasedIndex: number): number | undefined {
    this.#assertTableIndex(oneBasedIndex);
    if (!this.#module._aico8_get_table_value_raw(
      this.#runtime, this.#namePointer(name), oneBasedIndex, this.#valueScratch,
    )) return undefined;
    return new DataView(this.#module.HEAPU8.buffer).getInt32(this.#valueScratch, true) / 65536;
  }

  tableFieldNumber(name: string, field: string): number | undefined {
    if (!this.#module._aico8_get_table_field_raw(
      this.#runtime, this.#namePointer(name), this.#namePointer(field), this.#valueScratch,
    )) return undefined;
    return new DataView(this.#module.HEAPU8.buffer).getInt32(this.#valueScratch, true) / 65536;
  }

  tableFieldBoolean(name: string, field: string): boolean | undefined {
    if (!this.#module._aico8_get_table_field_boolean(
      this.#runtime, this.#namePointer(name), this.#namePointer(field), this.#valueScratch,
    )) return undefined;
    return new DataView(this.#module.HEAPU8.buffer).getInt32(this.#valueScratch, true) !== 0;
  }

  tableEntryNumber(name: string, oneBasedIndex: number, field: string): number | undefined {
    this.#assertTableIndex(oneBasedIndex);
    if (!this.#module._aico8_get_table_entry_raw(
      this.#runtime, this.#namePointer(name), oneBasedIndex, this.#namePointer(field), this.#valueScratch,
    )) return undefined;
    return new DataView(this.#module.HEAPU8.buffer).getInt32(this.#valueScratch, true) / 65536;
  }

  tableEntryBoolean(name: string, oneBasedIndex: number, field: string): boolean | undefined {
    this.#assertTableIndex(oneBasedIndex);
    if (!this.#module._aico8_get_table_entry_boolean(
      this.#runtime, this.#namePointer(name), oneBasedIndex, this.#namePointer(field), this.#valueScratch,
    )) return undefined;
    return new DataView(this.#module.HEAPU8.buffer).getInt32(this.#valueScratch, true) !== 0;
  }

  menuItems(): readonly KernelMenuItem[] {
    const items: KernelMenuItem[] = [];
    for (let index = 1; index <= 5; index += 1) {
      const size = this.#module._aico8_copy_menu_item_label(
        this.#runtime, index, this.#menuLabelScratch, MENU_LABEL_BYTES,
      );
      if (size === 0) continue;
      items.push({
        index,
        label: this.#module.UTF8ToString(this.#menuLabelScratch),
        filter: this.#module._aico8_menu_item_filter(this.#runtime, index) & 0x3f,
      });
    }
    return items;
  }

  invokeMenuItem(index: number, buttons = 0): boolean | undefined {
    if (!Number.isSafeInteger(index) || index < 1 || index > 5) {
      throw new Error("PICO-8 menu item indices must be integers from 1 through 5");
    }
    const invoked = this.#module._aico8_invoke_menu_item(
      this.#runtime, index, buttons & 0x3f, this.#valueScratch,
    );
    if (!invoked) {
      const error = this.lastError();
      if (error) throw new Error(error);
      return undefined;
    }
    this.#persistIfChanged();
    return new DataView(this.#module.HEAPU8.buffer).getInt32(this.#valueScratch, true) !== 0;
  }

  lastError(): string {
    return this.#module.UTF8ToString(this.#module._aico8_last_error(this.#runtime));
  }

  diagnosticOutput(): string {
    return this.#module.UTF8ToString(this.#module._aico8_diagnostic_output(this.#runtime));
  }

  destroy(): void {
    for (const pointer of this.#namePointers.values()) this.#module._free(pointer);
    this.#namePointers.clear();
    this.#module._free(this.#audioScratch);
    this.#module._free(this.#menuLabelScratch);
    this.#module._free(this.#valueScratch);
    this.#module._free(this.#saveScratch);
    this.#module._aico8_destroy(this.#runtime);
  }

  #namePointer(name: string): number {
    const cached = this.#namePointers.get(name);
    if (cached !== undefined) return cached;
    const encoded = new TextEncoder().encode(`${name}\0`);
    const pointer = this.#module._malloc(encoded.length);
    if (!pointer) throw new Error("Unable to allocate a VM inspection name");
    this.#module.HEAPU8.set(encoded, pointer);
    this.#namePointers.set(name, pointer);
    return pointer;
  }

  #assertTableIndex(oneBasedIndex: number): void {
    if (!Number.isSafeInteger(oneBasedIndex) || oneBasedIndex < 1) {
      throw new Error("VM table indices must be positive one-based safe integers");
    }
  }

  #persistIfChanged(): void {
    if (!this.#persistenceWrites) return;
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
