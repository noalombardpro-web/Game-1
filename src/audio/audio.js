// Procedural audio (Web Audio API): wind and rain beds, footsteps per surface, rover
// engine, thunder, alarm beeps and a low adaptive drone. No external sound files are used.
const SURFACE_FILTER = { grass: 900, sand: 1500, rock: 2600, mud: 500, water: 350 };

export class GameAudio {
  constructor(volume = 0.6) {
    this.volume = volume;
    this.ctx = null;
    this.targets = { wind: 0, rain: 0, engine: 0, drone: 0, alarm: 0 };
    this.lastStep = 0;
  }

  /** Creates the audio graph. Must be called from a user gesture (browser policy). */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.master.connect(this.muffle).connect(ctx.destination);
    this.noise = this.createNoiseBuffer(2);

    this.wind = this.loopNoise(420, 'lowpass', 0.0);
    this.rain = this.loopNoise(2600, 'highpass', 0.0);

    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 42;
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 380;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(engineFilter).connect(this.engineGain).connect(this.master);
    this.engineOsc.start();

    this.drone = [55, 82.4].map((f) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g).connect(this.master);
      osc.start();
      return g;
    });
    this.alarmGain = ctx.createGain();
    this.alarmGain.gain.value = 0;
    this.alarmOsc = ctx.createOscillator();
    this.alarmOsc.type = 'square';
    this.alarmOsc.frequency.value = 660;
    this.alarmOsc.connect(this.alarmGain).connect(this.master);
    this.alarmOsc.start();
    return true;
  }

  createNoiseBuffer(seconds) {
    const length = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      last = (last + (Math.random() * 2 - 1) * 0.1) * 0.995;
      data[i] = last * 4;
    }
    return buffer;
  }

  loopNoise(frequency, type, gainValue) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    return gain;
  }

  /** Muffles every sound while the listener is underwater. */
  setUnderwater(depth) {
    if (!this.ctx) return;
    const target = depth > 0 ? Math.max(350, 1400 - depth * 25) : 20000;
    this.muffle.frequency.setTargetAtTime(target, this.ctx.currentTime, 0.15);
  }

  playSplash(power = 1) {
    this.burst(900, 0.18 * Math.min(1.5, power), 0.35, 'bandpass');
    this.burst(300, 0.15, 0.5, 'lowpass');
  }

  setVolume(volume) {
    this.volume = volume;
    if (this.master) this.master.gain.value = volume;
  }

  /** Called every frame with the current environment state. Gains glide to their targets. */
  update(dt, state) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const ramp = (param, value) => param.setTargetAtTime(value, t, 0.4);
    ramp(this.wind.gain, 0.05 + 0.25 * Math.min(1, state.wind));
    ramp(this.rain.gain, 0.02 + 0.22 * state.rain);
    ramp(this.engineGain.gain, state.engine * 0.12);
    this.engineOsc.frequency.setTargetAtTime(40 + state.engine * 60, t, 0.2);
    for (const g of this.drone) ramp(g.gain, 0.012 + state.tension * 0.02);
    ramp(this.alarmGain.gain, state.alarm ? 0.05 : 0);
    this.alarmOsc.frequency.setTargetAtTime(state.alarm ? 880 : 660, t, 0.05);
  }

  /** Short filtered noise burst for a footstep. */
  playStep(surface = 'grass', sprint = false) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = performance.now();
    if (now - this.lastStep < 180) return;
    this.lastStep = now;
    this.burst(SURFACE_FILTER[surface] ?? 900, sprint ? 0.16 : 0.1, 0.07, 'bandpass');
  }

  burst(frequency, gain, duration, type = 'bandpass', delay = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const g = ctx.createGain();
    const start = ctx.currentTime + delay;
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start(start, Math.random() * 1.5, duration + 0.05);
  }

  tone(frequency, gain, duration, type = 'sine', delay = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    const g = ctx.createGain();
    const start = ctx.currentTime + delay;
    osc.frequency.setValueAtTime(frequency, start);
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(g).connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  playJump() {
    this.tone(180, 0.05, 0.15, 'triangle');
  }

  playLand(drop) {
    this.tone(90 - Math.min(40, drop * 2), 0.18, 0.25, 'sine');
    this.burst(400, 0.12, 0.15, 'lowpass');
  }

  playThunder(delay = 0) {
    this.burst(140, 0.5, 2.8, 'lowpass', delay);
  }

  playShot() {
    this.tone(1400, 0.08, 0.12, 'sawtooth');
    this.tone(500, 0.05, 0.12, 'square', 0.02);
  }

  playBeep() {
    this.tone(880, 0.06, 0.1, 'square');
  }

  playChime() {
    this.tone(660, 0.06, 0.2, 'sine');
    this.tone(990, 0.05, 0.25, 'sine', 0.1);
  }

  playHit() {
    this.burst(220, 0.3, 0.2, 'lowpass');
  }
}
