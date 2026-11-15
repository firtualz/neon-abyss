// LUMENFALL sound engine: every sound is synthesised live with WebAudio.
// No audio files, no network. All calls are safe before the first user gesture
// (the context is created lazily and resumed on input) and in headless runs
// where audio is unavailable.

const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];

export class SoundEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.padNodes = null;
    this.muted = false;
    this.ready = false;
  }

  // Call from a user gesture (or once at boot, guarded). Never throws.
  unlock() {
    if (this.ready) {
      if (this.context && this.context.state === 'suspended') {
        this.context.resume().catch(() => {});
      }
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.context = new AC();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.context.destination);
      this.ready = true;
      this.startPad();
    } catch {
      this.ready = false;
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.context.currentTime, 0.02);
    }
  }

  tone(freq, dur, type, vol, slideTo) {
    if (!this.ready || this.muted) return;
    try {
      const t0 = this.context.currentTime;
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(vol || 0.2, t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch {
      // Silence is fine; the game never depends on sound.
    }
  }

  noise(dur, vol, filterFreq) {
    if (!this.ready || this.muted) return;
    try {
      const t0 = this.context.currentTime;
      const len = Math.max(1, Math.floor(this.context.sampleRate * dur));
      const buffer = this.context.createBuffer(1, len, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.context.createBufferSource();
      src.buffer = buffer;
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterFreq || 1800;
      const gain = this.context.createGain();
      gain.gain.value = vol || 0.25;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      src.start(t0);
    } catch {
      // Ignore.
    }
  }

  paddle() {
    this.tone(220, 0.07, 'triangle', 0.22, 330);
  }

  wall() {
    this.tone(180, 0.05, 'square', 0.08, 160);
  }

  brick(colorIndex, critical, combo) {
    const base = PENTATONIC[colorIndex % PENTATONIC.length];
    const lift = 1 + Math.min(combo, 12) * 0.03;
    this.tone(base * lift, 0.16, 'sine', critical ? 0.3 : 0.18);
    this.tone(base * lift * 2, 0.1, 'sine', critical ? 0.16 : 0.07);
    if (critical) this.noise(0.12, 0.14, 3200);
  }

  armored() {
    this.tone(140, 0.08, 'square', 0.16, 110);
    this.noise(0.06, 0.1, 900);
  }

  powerup() {
    const notes = [660, 830, 990, 1320];
    notes.forEach((f, i) => {
      setTimeout(() => this.tone(f, 0.14, 'sine', 0.16), i * 55);
    });
  }

  loseLife() {
    this.tone(320, 0.5, 'sawtooth', 0.16, 70);
    this.noise(0.25, 0.12, 700);
  }

  levelClear() {
    [523, 659, 784, 1047].forEach((f, i) => {
      setTimeout(() => this.tone(f, 0.3, 'triangle', 0.2), i * 110);
    });
  }

  victory() {
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => {
      setTimeout(() => this.tone(f, 0.42, 'triangle', 0.2), i * 130);
    });
  }

  gameOver() {
    [392, 330, 262, 196].forEach((f, i) => {
      setTimeout(() => this.tone(f, 0.4, 'sawtooth', 0.12), i * 160);
    });
  }

  launch() {
    this.tone(440, 0.12, 'sine', 0.2, 880);
  }

  shoot() {
    this.tone(720, 0.07, 'square', 0.09, 340);
  }

  enemyShoot() {
    this.tone(300, 0.1, 'sawtooth', 0.07, 190);
  }

  hit() {
    this.noise(0.06, 0.1, 2400);
    this.tone(190, 0.06, 'triangle', 0.12, 120);
  }

  explode(big) {
    this.noise(big ? 0.5 : 0.28, big ? 0.3 : 0.18, big ? 900 : 1400);
    this.tone(big ? 120 : 170, big ? 0.5 : 0.3, 'sawtooth', 0.16, 45);
  }

  dash() {
    this.noise(0.16, 0.14, 4200);
    this.tone(520, 0.14, 'sine', 0.12, 980);
  }

  hurt() {
    this.tone(160, 0.25, 'sawtooth', 0.2, 60);
    this.noise(0.15, 0.14, 800);
  }

  heal() {
    this.tone(660, 0.15, 'sine', 0.14, 990);
  }

  upgradePick() {
    [660, 880, 1108].forEach((f, i) => {
      setTimeout(() => this.tone(f, 0.18, 'triangle', 0.16), i * 70);
    });
  }

  bossRoar() {
    this.tone(90, 0.9, 'sawtooth', 0.22, 55);
    this.noise(0.7, 0.16, 500);
  }

  // A quiet two-oscillator pad that drifts under the game. Started once.
  startPad() {
    if (!this.ready || this.padNodes) return;
    try {
      const gain = this.context.createGain();
      gain.gain.value = 0.035;
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      const o1 = this.context.createOscillator();
      o1.type = 'sine';
      o1.frequency.value = 110;
      const o2 = this.context.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = 164.81;
      o2.detune.value = 6;
      const lfo = this.context.createOscillator();
      lfo.frequency.value = 0.08;
      const lfoGain = this.context.createGain();
      lfoGain.gain.value = 220;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      o1.connect(filter);
      o2.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      o1.start();
      o2.start();
      lfo.start();
      this.padNodes = { o1, o2, lfo, gain };
    } catch {
      this.padNodes = null;
    }
  }
}
