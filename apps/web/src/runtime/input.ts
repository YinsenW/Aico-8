import type { InputTraceV1 } from "@aico8/contracts";

const keyButtons = new Map<string, number>([
  ["ArrowLeft", 0], ["KeyA", 0],
  ["ArrowRight", 1], ["KeyD", 1],
  ["ArrowUp", 2], ["KeyW", 2],
  ["ArrowDown", 3], ["KeyS", 3],
  ["KeyZ", 4], ["KeyC", 4], ["KeyN", 4], ["Space", 4],
  ["KeyX", 5], ["KeyV", 5], ["KeyM", 5], ["Enter", 5],
]);

export const CANONICAL_KEY_CODES = [
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyZ", "KeyX",
] as const;

export type HostInputSurface = "keyboard" | "controller" | "touch";

export interface GamepadLike {
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean }[];
}

export function keyboardButton(code: string): number | undefined {
  return keyButtons.get(code);
}

export function touchButton(value: string | number | undefined): number | undefined {
  if (typeof value === "string" && !/^[0-5]$/.test(value)) return undefined;
  const button = typeof value === "number" ? value : Number(value);
  return Number.isInteger(button) && button >= 0 && button <= 5 ? button : undefined;
}

export function gamepadMask(gamepad: GamepadLike | null | undefined): number {
  if (!gamepad) return 0;
  let mask = 0;
  const axisX = gamepad.axes[0] ?? 0;
  const axisY = gamepad.axes[1] ?? 0;
  if (gamepad.buttons[14]?.pressed || axisX < -0.45) mask |= 1 << 0;
  if (gamepad.buttons[15]?.pressed || axisX > 0.45) mask |= 1 << 1;
  if (gamepad.buttons[12]?.pressed || axisY < -0.45) mask |= 1 << 2;
  if (gamepad.buttons[13]?.pressed || axisY > 0.45) mask |= 1 << 3;
  if (gamepad.buttons[0]?.pressed) mask |= 1 << 4;
  if (gamepad.buttons[1]?.pressed) mask |= 1 << 5;
  return mask & 0x3f;
}

export class LogicalInputLatch {
  #heldMask = 0;
  #pendingMask = 0;

  press(button: number): void {
    if (button < 0 || button > 5) return;
    this.#heldMask |= 1 << button;
    this.#pendingMask |= 1 << button;
  }

  release(button: number): void {
    if (button < 0 || button > 5) return;
    this.#heldMask &= ~(1 << button);
  }

  reset(): void {
    this.#heldMask = 0;
  }

  mask(): number {
    return (this.#heldMask | this.#pendingMask) & 0x3f;
  }

  commitLogicalUpdate(): void {
    // Pending records a press that has not reached a logical sample yet. Once a
    // sample is committed, heldMask alone carries a continuing press; retaining
    // pending here would keep a released key/touch active for one extra update.
    this.#pendingMask = 0;
  }
}

function applyLatchTransition(
  latch: LogicalInputLatch,
  previousMask: number,
  desiredMask: number,
  resolveButton: (button: number) => number | undefined,
): number {
  for (let button = 0; button < 6; button += 1) {
    const bit = 1 << button;
    if ((previousMask & bit) !== 0 && (desiredMask & bit) === 0) {
      const resolved = resolveButton(button);
      if (resolved !== undefined) latch.release(resolved);
    }
  }
  for (let button = 0; button < 6; button += 1) {
    const bit = 1 << button;
    if ((previousMask & bit) === 0 && (desiredMask & bit) !== 0) {
      const resolved = resolveButton(button);
      if (resolved !== undefined) latch.press(resolved);
    }
  }
  const sampled = latch.mask();
  latch.commitLogicalUpdate();
  return sampled;
}

function gamepadForLogicalMask(mask: number): GamepadLike {
  const buttonForLogical = [14, 15, 12, 13, 0, 1];
  return {
    axes: [0, 0],
    buttons: Array.from({ length: 16 }, (_, index) => ({
      pressed: buttonForLogical.some((gamepadButton, logicalButton) =>
        gamepadButton === index && (mask & (1 << logicalButton)) !== 0),
    })),
  };
}

/**
 * Projects one validated PICO-8 input trace through the same mappings and latch
 * semantics used by each browser input surface. One output byte is emitted for
 * every original logical update; no wall-clock acceleration may omit a sample.
 */
export function projectInputTrace(trace: InputTraceV1, surface: HostInputSurface): Uint8Array {
  const projected = new Uint8Array(trace.totalUpdates);
  const latch = surface === "controller" ? undefined : new LogicalInputLatch();
  let previousMask = 0;
  let update = 0;
  for (const span of trace.spans) {
    if (span.players.length !== 1) {
      throw new TypeError("Browser host input projection currently supports one PICO-8 player");
    }
    if (span.startUpdate !== update || span.endUpdateExclusive > trace.totalUpdates) {
      throw new TypeError(`Input trace lost contiguous coverage at logical update ${update}`);
    }
    const desiredMask = span.players[0];
    for (; update < span.endUpdateExclusive; update += 1) {
      if (surface === "controller") {
        projected[update] = gamepadMask(gamepadForLogicalMask(desiredMask));
      } else if (surface === "keyboard") {
        projected[update] = applyLatchTransition(
          latch!,
          previousMask,
          desiredMask,
          (button) => keyboardButton(CANONICAL_KEY_CODES[button]!),
        );
      } else {
        projected[update] = applyLatchTransition(latch!, previousMask, desiredMask, touchButton);
      }
      previousMask = desiredMask;
    }
  }
  if (update !== trace.totalUpdates) {
    throw new TypeError(`Input trace ended at ${update}; expected ${trace.totalUpdates} logical updates`);
  }
  return projected;
}

export class InputController {
  readonly #keyboard = new LogicalInputLatch();
  readonly #touch = new LogicalInputLatch();

  constructor(target: Window = window) {
    target.addEventListener("keydown", (event) => {
      const button = keyboardButton(event.code);
      if (button === undefined) return;
      this.#keyboard.press(button);
      event.preventDefault();
    }, { passive: false });
    target.addEventListener("keyup", (event) => {
      const button = keyboardButton(event.code);
      if (button === undefined) return;
      this.#keyboard.release(button);
      event.preventDefault();
    }, { passive: false });
    target.addEventListener("blur", () => this.#keyboard.reset());
  }

  bindTouchControls(root: HTMLElement): void {
    for (const control of root.querySelectorAll<HTMLElement>("[data-p8-button]")) {
      const button = touchButton(control.dataset.p8Button);
      if (button === undefined) continue;
      control.addEventListener("pointerdown", (event) => {
        control.setPointerCapture(event.pointerId);
        this.#touch.press(button);
        event.preventDefault();
      });
      for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
        control.addEventListener(eventName, () => this.#touch.release(button));
      }
    }
  }

  mask(): number {
    const mask = this.#keyboard.mask() | this.#touch.mask()
      | gamepadMask(navigator.getGamepads?.()[0]);
    return mask & 0x3f;
  }

  commitLogicalUpdate(): void {
    this.#keyboard.commitLogicalUpdate();
    this.#touch.commitLogicalUpdate();
  }
}
