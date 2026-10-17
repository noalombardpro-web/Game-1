// Mission progression. A main chain of missions (made of steps) advances in order, while side
// contracts are all active in parallel. Steps are data-driven (data/missions.json) and are
// completed by gameplay events:
//   reach/scan {poi} · species {id} · collect {item, amount} · build {structure} · craft {recipe}
//   dive {depth} · drive {vehicle} · destroy {kind} · kill {species} · loot {poi} · cave {poi}
//   orbit · dock · land {planet}
const MATCH_KEYS = ['poi', 'item', 'structure', 'vehicle', 'planet', 'recipe', 'kind', 'species'];

const target = (step) => step.depth ?? step.count ?? 1;

export class Missions {
  constructor(content, saved = {}) {
    this.main = content.missions;
    this.side = content.sideMissions ?? [];
    this.index = Math.min(saved.index ?? 0, this.main.length);
    this.progress = { ...(saved.progress ?? {}) };
    this.completed = [...(saved.completed ?? [])];
  }

  get list() {
    return this.main;
  }

  get finished() {
    return this.index >= this.main.length;
  }

  get mission() {
    return this.main[this.index] ?? null;
  }

  /** The first step of the current main mission that is not complete yet, or null. */
  get step() {
    const m = this.mission;
    return m ? this.nextStep(m) : null;
  }

  nextStep(mission) {
    return mission.steps.find((s) => !this.stepDone(s)) ?? null;
  }

  /** Side contracts that are not completed yet. */
  get activeSide() {
    return this.side.filter((m) => !this.completed.includes(m.id));
  }

  stepDone(step) {
    return (this.progress[step.id] ?? 0) >= target(step);
  }

  /** Whether an event satisfies (or advances) a step. */
  matches(step, event) {
    if (step.type !== event.type) return false;
    for (const key of MATCH_KEYS) {
      if (step[key] !== undefined && step[key] !== event[key]) return false;
    }
    return true;
  }

  /** Applies an event to one mission; returns the notices produced. */
  advance(mission, event, isMain) {
    const notices = [];
    const step = this.nextStep(mission);
    if (!step || !this.matches(step, event)) return notices;
    if (event.type === 'species') {
      const seen = new Set(this.progress[`${step.id}:ids`] ?? []);
      if (seen.has(event.id)) return notices;
      seen.add(event.id);
      this.progress[`${step.id}:ids`] = [...seen];
      this.progress[step.id] = seen.size;
    } else if (event.type === 'dive') {
      this.progress[step.id] = Math.max(this.progress[step.id] ?? 0, event.depth);
      if (!this.stepDone(step)) return notices;
    } else {
      this.progress[step.id] = (this.progress[step.id] ?? 0) + (event.amount ?? 1);
    }
    if (this.stepDone(step)) notices.push({ kind: 'step', text: step.text, mission: mission.title });
    if (!this.nextStep(mission)) {
      this.completed.push(mission.id);
      if (isMain) this.index++;
      notices.push({ kind: 'complete', mission: mission.title, text: mission.completion, reward: mission.reward ?? {} });
    }
    return notices;
  }

  /** Reports an event to the main mission and to every active side contract. */
  notify(event) {
    const notices = [];
    if (this.mission) notices.push(...this.advance(this.mission, event, true));
    for (const contract of this.activeSide) notices.push(...this.advance(contract, event, false));
    return notices;
  }

  /**
   * Completes, without reward, the steps that refer to places that do not exist in this world
   * (some places only appear where the terrain allows them).
   */
  skipMissing(knownPoiIds) {
    let guard = 0;
    while (this.mission && guard++ < 100) {
      const step = this.step;
      if (!step) break;
      if (step.poi && !knownPoiIds.has(step.poi)) {
        this.progress[step.id] = target(step);
        if (!this.step) { this.completed.push(this.mission.id); this.index++; }
      } else break;
    }
  }

  toJSON() {
    return { index: this.index, progress: { ...this.progress }, completed: [...this.completed] };
  }
}
