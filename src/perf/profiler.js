// Frame timing and renderer statistics. Keeps a ring buffer of frame times so that
// average and 95th-percentile values can be reported (overlay with F3, and tests).
export class Profiler {
  constructor(renderer, size = 300) {
    this.renderer = renderer;
    this.size = size;
    this.frames = new Float64Array(size);
    this.updateMs = new Float64Array(size);
    this.renderMs = new Float64Array(size);
    this.count = 0;
    this.last = 0;
    this.stats = { fps: 0, avgMs: 0, p95Ms: 0, updateMs: 0, renderMs: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0 };
  }

  /** CPU time spent in the simulation/update part of a frame (ms). */
  recordUpdate(ms) {
    this.updateMs[this.count % this.size] = ms;
  }

  /** CPU time spent submitting the render call (ms). GPU time is not included. */
  recordRender(ms) {
    this.renderMs[this.count % this.size] = ms;
  }

  /** Call once per frame with the frame timestamp in ms. */
  frame(now) {
    if (this.last) {
      this.frames[this.count % this.size] = now - this.last;
      this.count++;
    }
    this.last = now;
    if (this.count > 0 && this.count % 30 === 0) this.refresh();
  }

  refresh() {
    const n = Math.min(this.count, this.size);
    const samples = Array.from(this.frames.slice(0, n)).filter((v) => v > 0).sort((a, b) => a - b);
    if (samples.length === 0) return;
    const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
    const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))];
    const info = this.renderer.info;
    const mean = (arr) => Array.from(arr.slice(0, n)).reduce((s, v) => s + v, 0) / n;
    this.stats = {
      fps: 1000 / avg,
      avgMs: avg,
      p95Ms: p95,
      updateMs: mean(this.updateMs),
      renderMs: mean(this.renderMs),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures
    };
  }

  /** Summary used by tests and by the overlay. */
  snapshot() {
    this.refresh();
    return { ...this.stats, samples: Math.min(this.count, this.size) };
  }
}
