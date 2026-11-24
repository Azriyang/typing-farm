/* ============================================================
   audio.ts — WebAudio 合成音效与背景乐
   ============================================================ */

type Wave = OscillatorType;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let bgmTimer: number | null = null;
let bgmOn = true;

function ac(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.3;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

interface ToneOpts {
  freq: number;
  dur?: number;
  type?: Wave;
  vol?: number;
  delay?: number;
  slideTo?: number;
  atk?: number;
}

function tone(o: ToneOpts): void {
  const c = ac();
  if (!c || !master || muted) return;
  const t0 = c.currentTime + (o.delay ?? 0);
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = o.type ?? 'square';
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slideTo), t0 + (o.dur ?? 0.1));
  const vol = o.vol ?? 0.2;
  const dur = o.dur ?? 0.1;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + (o.atk ?? 0.006));
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

function noise(dur: number, vol: number, freq: number): void {
  const c = ac();
  if (!c || !master || muted) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const flt = c.createBiquadFilter();
  flt.type = 'bandpass';
  flt.frequency.value = freq;
  flt.Q.value = 0.8;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(flt);
  flt.connect(g);
  g.connect(master);
  src.start();
}

/* ---------------- 音效表 ---------------- */

export const SFX = {
  key(): void {
    tone({ freq: 520 + Math.random() * 140, dur: 0.04, type: 'square', vol: 0.05 });
  },
  click(): void {
    tone({ freq: 360, slideTo: 280, dur: 0.07, type: 'triangle', vol: 0.13 });
  },
  error(): void {
    tone({ freq: 200, slideTo: 105, dur: 0.14, type: 'sawtooth', vol: 0.13 });
    noise(0.08, 0.05, 520);
  },
  complete(): void {
    tone({ freq: 660, dur: 0.08, type: 'triangle', vol: 0.16 });
    tone({ freq: 880, dur: 0.12, type: 'triangle', vol: 0.14, delay: 0.06 });
  },
  perfect(): void {
    [784, 988, 1175, 1568].forEach((f, i) => {
      tone({ freq: f, dur: 0.18, type: 'triangle', vol: 0.14, delay: i * 0.05 });
    });
  },
  coin(): void {
    tone({ freq: 1180, dur: 0.06, type: 'square', vol: 0.09 });
    tone({ freq: 1580, dur: 0.12, type: 'square', vol: 0.08, delay: 0.05 });
  },
  harvest(): void {
    noise(0.13, 0.12, 900);
    tone({ freq: 520, slideTo: 780, dur: 0.15, type: 'triangle', vol: 0.14 });
  },
  till(): void {
    noise(0.15, 0.14, 400);
    tone({ freq: 170, slideTo: 95, dur: 0.13, type: 'triangle', vol: 0.14 });
  },
  water(): void {
    noise(0.24, 0.09, 2400);
    tone({ freq: 900, slideTo: 1300, dur: 0.18, type: 'sine', vol: 0.06 });
  },
  plant(): void {
    tone({ freq: 440, slideTo: 640, dur: 0.11, type: 'sine', vol: 0.12 });
  },
  day(): void {
    [392, 523, 659, 784].forEach((f, i) => {
      tone({ freq: f, dur: 0.45, type: 'triangle', vol: 0.1, delay: i * 0.11, atk: 0.04 });
    });
  },
  fail(): void {
    [330, 260, 200].forEach((f, i) => {
      tone({ freq: f, dur: 0.2, type: 'triangle', vol: 0.12, delay: i * 0.09 });
    });
  },
  levelup(): void {
    [523, 659, 784, 1047, 1319].forEach((f, i) => {
      tone({ freq: f, dur: 0.3, type: 'triangle', vol: 0.13, delay: i * 0.08 });
    });
  },
  bite(): void {
    noise(0.12, 0.12, 1600);
    tone({ freq: 880, dur: 0.07, type: 'square', vol: 0.16 });
    tone({ freq: 1240, dur: 0.1, type: 'square', vol: 0.13, delay: 0.06 });
  }
};

/* ---------------- 背景乐 ---------------- */

const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
const BASS = [130.81, 146.83, 164.81, 174.61];
let step = 0;

function bgmTick(): void {
  if (!ctx || muted || !bgmOn) return;
  const t = step++;
  const n = SCALE[(t * 3) % SCALE.length];
  tone({ freq: n, dur: 1.4, type: 'sine', vol: 0.045, atk: 0.08 });
  if (t % 4 === 0) {
    tone({ freq: BASS[(t / 4) % BASS.length], dur: 2.0, type: 'triangle', vol: 0.04, atk: 0.12 });
  }
  if (t % 8 === 4) {
    tone({ freq: n * 2, dur: 0.9, type: 'sine', vol: 0.024, atk: 0.1 });
  }
}

export const Sound = {
  init(): void {
    ac();
  },
  play(name: keyof typeof SFX): void {
    ac();
    SFX[name]();
  },
  toggle(): boolean {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.3;
    return !muted;
  },
  isMuted(): boolean {
    return muted;
  },
  startBGM(): void {
    ac();
    if (bgmTimer != null) return;
    step = 0;
    bgmTimer = window.setInterval(bgmTick, 620);
  },
  stopBGM(): void {
    if (bgmTimer != null) {
      window.clearInterval(bgmTimer);
      bgmTimer = null;
    }
  },
  setBGM(on: boolean): boolean {
    bgmOn = on;
    if (!on) this.stopBGM();
    else this.startBGM();
    return bgmOn;
  }
};
