const keyButtons = new Map<string, number>([
  ["ArrowLeft", 0], ["KeyA", 0],
  ["ArrowRight", 1], ["KeyD", 1],
  ["ArrowUp", 2], ["KeyW", 2],
  ["ArrowDown", 3], ["KeyS", 3],
  ["KeyZ", 4], ["KeyC", 4], ["KeyN", 4], ["Space", 4],
  ["KeyX", 5], ["KeyV", 5], ["KeyM", 5], ["Enter", 5],
]);

export interface GamepadLike {
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean }[];
}

export function keyboardButton(code: string): number | undefined {
  return keyButtons.get(code);
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
    this.#pendingMask &= this.#heldMask;
  }
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
      const button = Number(control.dataset.p8Button);
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
