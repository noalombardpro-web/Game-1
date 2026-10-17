// Keyboard and mouse input with rebindable actions (see data/controls.json).
// Actions are queried with isDown() (held) or pressed() (edge, once per frame).

export class Input {
  constructor(bindings, element) {
    this.bindings = bindings;
    this.element = element;
    this.held = new Set();
    this.edges = new Set();
    this.look = { dx: 0, dy: 0 };
    this.pointerLocked = false;
    this.onKeyDown = (e) => this.handleKey(e, true);
    this.onKeyUp = (e) => this.handleKey(e, false);
    this.onMouseDown = (e) => this.handleMouse(e, true);
    this.onMouseUp = (e) => this.handleMouse(e, false);
    this.onMouseMove = (e) => {
      if (!this.pointerLocked) return;
      this.look.dx += e.movementX;
      this.look.dy += e.movementY;
    };
    this.onLockChange = () => { this.pointerLocked = document.pointerLockElement === this.element; };
    this.onBlur = () => { this.held.clear(); };
    this.capture = null;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  setBindings(bindings) {
    this.bindings = bindings;
  }

  codesFor(action) {
    return this.bindings[action] ?? [];
  }

  handleKey(e, isDown) {
    if (this.capture && isDown) {
      e.preventDefault();
      const resolve = this.capture;
      this.capture = null;
      resolve(e.code === 'Escape' ? null : e.code);
      return;
    }
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3'].includes(e.code)) e.preventDefault();
    if (isDown) {
      if (!this.held.has(e.code) && !e.repeat) this.edges.add(e.code);
      this.held.add(e.code);
    } else {
      this.held.delete(e.code);
    }
  }

  handleMouse(e, isDown) {
    const code = `Mouse${e.button}`;
    if (this.capture && isDown) {
      const resolve = this.capture;
      this.capture = null;
      resolve(code);
      return;
    }
    if (isDown) {
      this.held.add(code);
      this.edges.add(code);
    } else {
      this.held.delete(code);
    }
  }

  /** Waits for the next key or mouse button press and resolves its code (null on Escape). */
  captureNextCode() {
    return new Promise((resolve) => { this.capture = resolve; });
  }

  isDown(action) {
    return this.codesFor(action).some((c) => this.held.has(c));
  }

  pressed(action) {
    return this.codesFor(action).some((c) => this.edges.has(c));
  }

  /** Movement axes: x = right (+1) / left (-1), z = forward (+1) / back (-1). */
  moveAxis() {
    const x = (this.isDown('move_right') ? 1 : 0) - (this.isDown('move_left') ? 1 : 0);
    const z = (this.isDown('move_forward') ? 1 : 0) - (this.isDown('move_back') ? 1 : 0);
    return { x, z };
  }

  /** Mouse movement accumulated since the last call (only while pointer-locked). */
  consumeLook() {
    const out = { dx: this.look.dx, dy: this.look.dy };
    this.look.dx = 0;
    this.look.dy = 0;
    return out;
  }

  /** Clears one-frame edges. Call at the end of every frame. */
  endFrame() {
    this.edges.clear();
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onLockChange);
  }
}
