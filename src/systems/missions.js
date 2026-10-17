// Mission progression: ordered missions made of steps (reach, scan, species, collect).
// Steps are data-driven (data/missions.json). Events come from the game loop.

export class Missions {
  constructor(content, saved = {}) {
    this.list = content.missions;
    this.index = Math.min(saved.index ?? 0, this.list.length);
    this.progress = { ...(saved.progress ?? {}) };
    this.completed = [...(saved.completed ?? [])];
  }

  get finished() {
    return this.index >= this.list.length;
  }

  get mission() {
    return this.list[this.index] ?? null;
  }

  /** The first step that is not complete yet, or null. */
  get step() {
    const m = this.mission;
    if (!m) return null;
    return m.steps.find((s) => !this.stepDone(s)) ?? null;
  }

  stepDone(step) {
    return (this.progress[step.id] ?? 0) >= (step.count ?? 1);
  }

  /**
   * Reports an event. Events: { type: 'reach'|'scan', poi } | { type: 'species', id } |
   * { type: 'collect', item, amount }. Returns an array of completion notices.
   */
  notify(event) {
    const notices = [];
    const step = this.step;
    if (!step) return notices;
    if (step.type !== event.type) return notices;
    if (step.poi && step.poi !== event.poi) return notices;
    if (step.item && step.item !== event.item) return notices;

    if (event.type === 'species') {
      const seen = new Set(this.progress[`${step.id}:ids`] ?? []);
      if (seen.has(event.id)) return notices;
      seen.add(event.id);
      this.progress[`${step.id}:ids`] = [...seen];
      this.progress[step.id] = seen.size;
    } else if (event.type === 'collect') {
      this.progress[step.id] = (this.progress[step.id] ?? 0) + (event.amount ?? 1);
    } else {
      this.progress[step.id] = (this.progress[step.id] ?? 0) + 1;
    }
    notices.push({ kind: 'step', text: step.text, mission: this.mission.title });

    if (!this.step) {
      const finished = this.mission;
      this.completed.push(finished.id);
      this.index++;
      notices.push({ kind: 'complete', mission: finished.title, text: finished.completion, reward: finished.reward ?? {} });
    }
    return notices;
  }

  toJSON() {
    return { index: this.index, progress: { ...this.progress }, completed: [...this.completed] };
  }
}
