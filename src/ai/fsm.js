// Minimal finite state machine: named states with enter/update hooks and timed transitions.
export class StateMachine {
  constructor(owner) {
    this.owner = owner;
    this.states = new Map();
    this.current = null;
    this.elapsed = 0;
  }

  add(name, hooks) {
    this.states.set(name, hooks);
    return this;
  }

  set(name) {
    if (this.current === name) return;
    const prev = this.states.get(this.current);
    prev?.exit?.(this.owner);
    this.current = name;
    this.elapsed = 0;
    this.states.get(name)?.enter?.(this.owner);
  }

  update(dt, ctx) {
    this.elapsed += dt;
    const hooks = this.states.get(this.current);
    if (!hooks) throw new Error(`Unknown state ${this.current}`);
    return hooks.update?.(this.owner, dt, ctx);
  }
}
