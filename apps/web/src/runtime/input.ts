const keyButtons = new Map<string, number>([
  ["ArrowLeft", 0], ["KeyA", 0],
  ["ArrowRight", 1], ["KeyD", 1],
  ["ArrowUp", 2], ["KeyW", 2],
  ["ArrowDown", 3], ["KeyS", 3],
  ["KeyZ", 4], ["KeyC", 4], ["KeyN", 4], ["Space", 4],
  ["KeyX", 5], ["KeyV", 5], ["KeyM", 5], ["Enter", 5],
]);

export class InputController {
  readonly #held = new Set<number>();
  #touchMask = 0;
  #pendingMask = 0;

  constructor(target: Window = window) {
    target.addEventListener("keydown", (event) => {
      const button = keyButtons.get(event.code);
      if (button === undefined) return;
      this.#held.add(button);
      this.#pendingMask |= 1 << button;
      event.preventDefault();
    }, { passive: false });
    target.addEventListener("keyup", (event) => {
      const button = keyButtons.get(event.code);
      if (button === undefined) return;
      this.#held.delete(button);
      event.preventDefault();
    }, { passive: false });
    target.addEventListener("blur", () => this.#held.clear());
  }

  bindTouchControls(root: HTMLElement): void {
    for (const control of root.querySelectorAll<HTMLElement>("[data-p8-button]")) {
      const button = Number(control.dataset.p8Button);
      const set = (pressed: boolean) => {
        if (pressed) {
          this.#touchMask |= 1 << button;
          this.#pendingMask |= 1 << button;
        } else {
          this.#touchMask &= ~(1 << button);
        }
      };
      control.addEventListener("pointerdown", (event) => {
        control.setPointerCapture(event.pointerId);
        set(true);
        event.preventDefault();
      });
      for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
        control.addEventListener(eventName, () => set(false));
      }
    }
  }

  mask(): number {
    let mask = this.#touchMask | this.#pendingMask;
    for (const button of this.#held) mask |= 1 << button;
    const gamepad = navigator.getGamepads?.()[0];
    if (gamepad) {
      const axisX = gamepad.axes[0] ?? 0;
      const axisY = gamepad.axes[1] ?? 0;
      if (gamepad.buttons[14]?.pressed || axisX < -0.45) mask |= 1 << 0;
      if (gamepad.buttons[15]?.pressed || axisX > 0.45) mask |= 1 << 1;
      if (gamepad.buttons[12]?.pressed || axisY < -0.45) mask |= 1 << 2;
      if (gamepad.buttons[13]?.pressed || axisY > 0.45) mask |= 1 << 3;
      if (gamepad.buttons[0]?.pressed) mask |= 1 << 4;
      if (gamepad.buttons[1]?.pressed) mask |= 1 << 5;
    }
    return mask & 0x3f;
  }

  commitLogicalUpdate(): void {
    let heldMask = this.#touchMask;
    for (const button of this.#held) heldMask |= 1 << button;
    this.#pendingMask &= heldMask;
  }
}
