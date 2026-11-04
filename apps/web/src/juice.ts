// Game feel: small synthesized sounds (no audio files) and a reduced-motion check.
// Feedback scales with importance: a swing is a soft thunk, a sale a chime, a level-up a fanfare.

let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return localStorage.getItem('meridian.muted') === '1';
  } catch {
    return false;
  }
})();

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem('meridian.muted', m ? '1' : '0');
  } catch {}
}

export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function tone(freq: number, at: number, dur: number, type: OscillatorType = 'sine', gain = 0.08) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, ctx.currentTime + at);
  g.gain.setValueAtTime(0, ctx.currentTime + at);
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + at);
  o.stop(ctx.currentTime + at + dur + 0.05);
}

export type Sound = 'swing' | 'coin' | 'quest' | 'level' | 'error' | 'eat' | 'build' | 'bid' | 'firework';

export function play(sound: Sound) {
  if (muted || typeof AudioContext === 'undefined') return;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  switch (sound) {
    case 'swing':
      tone(110, 0, 0.12, 'triangle', 0.12);
      tone(70, 0.03, 0.15, 'sine', 0.1);
      break;
    case 'coin':
      tone(1320, 0, 0.12, 'square', 0.035);
      tone(1760, 0.07, 0.22, 'square', 0.035);
      break;
    case 'eat':
      tone(392, 0, 0.1, 'triangle');
      tone(523, 0.08, 0.15, 'triangle');
      break;
    case 'build':
      [262, 330, 392].forEach((f, i) => tone(f, i * 0.07, 0.18, 'triangle'));
      break;
    case 'bid':
      tone(660, 0, 0.1, 'sawtooth', 0.03);
      tone(880, 0.1, 0.18, 'sawtooth', 0.03);
      break;
    case 'quest':
      [523, 659, 784].forEach((f, i) => tone(f, i * 0.08, 0.25, 'triangle', 0.07));
      break;
    case 'level':
      [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.3, 'square', 0.04));
      break;
    case 'error':
      tone(196, 0, 0.18, 'sawtooth', 0.04);
      tone(147, 0.12, 0.25, 'sawtooth', 0.04);
      break;
    case 'firework':
      // A soft boom, then crackle.
      tone(70 + Math.random() * 20, 0, 0.5, 'sine', 0.09);
      noiseBurst(0, 0.35, 300, 0.06);
      for (let i = 0; i < 6; i++) noiseBurst(0.25 + i * 0.07 + Math.random() * 0.05, 0.04, 5000 + Math.random() * 3000, 0.02);
      break;
  }
}

// ---------- ambience: birds by day, crickets at night ----------

let ambience: ReturnType<typeof setInterval> | null = null;

function noiseBurst(at: number, dur: number, freq: number, gain: number) {
  if (!ctx) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 12;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start(ctx.currentTime + at);
}

function chirp(at: number) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const f = 2400 + Math.random() * 1600;
  o.frequency.setValueAtTime(f, ctx.currentTime + at);
  o.frequency.exponentialRampToValueAtTime(f * 1.35, ctx.currentTime + at + 0.07);
  g.gain.setValueAtTime(0, ctx.currentTime + at);
  g.gain.linearRampToValueAtTime(0.012, ctx.currentTime + at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.09);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + at);
  o.stop(ctx.currentTime + at + 0.12);
}

/** Start the background ambience. `night()` says how dark it is (0 day … 1 night). */
export function startAmbience(night: () => number) {
  if (ambience || typeof AudioContext === 'undefined') return;
  ambience = setInterval(() => {
    if (muted) return;
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') return;
    const n = night();
    if (n < 0.5 && Math.random() < 0.5) [0, 0.12, 0.24].slice(0, 1 + Math.floor(Math.random() * 3)).forEach(t => chirp(t + Math.random() * 0.4));
    if (n > 0.4) for (let i = 0; i < 3; i++) noiseBurst(i * 0.11, 0.05, 4200, 0.02 * n);
  }, 1100);
}

// ---------- music: "Market Day", a small piece in D for lute, pad, bass and drums ----------
//
// 84 bpm, eight bars of eighth notes over I–IV–vi–V (D G Bm A). At night the same tune plays
// softer in D minor over i–VI–III–VII (Dm B♭ F C), without drums.

let musicOn = (() => {
  try {
    return localStorage.getItem('meridian.music') !== '0';
  } catch {
    return true;
  }
})();
export const isMusicOn = () => musicOn;
export function setMusicOn(on: boolean) {
  musicOn = on;
  try {
    localStorage.setItem('meridian.music', on ? '1' : '0');
  } catch {}
  if (bus && ctx) bus.gain.setTargetAtTime(on && !muted ? 0.75 : 0, ctx.currentTime, 0.3);
}

const BPM = 84;
const EIGHTH = 60 / BPM / 2;
const _ = null;
const MELODY: (number | null)[][] = [
  [74, _, 76, 78, 76, 74, _, 69],
  [71, _, 74, 76, 74, _, 71, _],
  [74, _, 78, _, 76, 74, 71, _],
  [73, _, 69, _, 71, 73, 76, _],
  [78, _, 76, 74, 76, _, 78, 81],
  [79, _, 78, 76, 74, _, 71, _],
  [74, 76, 78, _, 76, 74, 71, 69],
  [69, _, 73, _, 74, _, _, _],
];
const DAY_CHORDS = [[62, 66, 69], [67, 71, 74], [71, 74, 78], [69, 73, 76]];
const NIGHT_CHORDS = [[62, 65, 69], [70, 74, 77], [65, 69, 72], [60, 64, 67]];
// Major → minor for the night version: F♯→F, B→B♭, C♯→C.
const TO_MINOR: Record<number, number> = { 66: 65, 78: 77, 71: 70, 83: 82, 73: 72, 85: 84 };
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

let bus: GainNode | null = null;
let music: ReturnType<typeof setInterval> | null = null;

function voice(freq: number, at: number, dur: number, type: OscillatorType, gain: number, cutoff = 4000, attack = 0.01) {
  if (!ctx || !bus) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(f).connect(g).connect(bus);
  o.start(at);
  o.stop(at + dur + 0.05);
}

function lute(midi: number, at: number, soft: boolean) {
  const f = hz(midi);
  voice(f, at, soft ? 1.1 : 0.8, 'triangle', soft ? 0.045 : 0.06, 3200);
  voice(f * 2, at, 0.35, 'square', soft ? 0.006 : 0.01, 2400);
}

function pad(chord: number[], at: number, len: number, soft: boolean) {
  for (const m of chord) {
    voice(hz(m - 12), at, len, 'sine', soft ? 0.018 : 0.014, 1400, 0.5);
    voice(hz(m - 12) * 1.003, at, len, 'triangle', soft ? 0.008 : 0.007, 1200, 0.6);
  }
}

function drumKick(at: number) {
  if (!ctx || !bus) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(120, at);
  o.frequency.exponentialRampToValueAtTime(48, at + 0.18);
  g.gain.setValueAtTime(0.09, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
  o.connect(g).connect(bus);
  o.start(at);
  o.stop(at + 0.3);
}

function shaker(at: number) {
  if (!ctx || !bus) return;
  const len = Math.floor(ctx.sampleRate * 0.05);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 6500;
  const g = ctx.createGain();
  g.gain.value = 0.02;
  src.connect(hp).connect(g).connect(bus);
  src.start(at);
}

/** Start the music. `night()` (0..1) switches it to the soft minor version after dark. */
export function startMusic(night: () => number) {
  if (music || typeof AudioContext === 'undefined') return;
  ctx ??= new AudioContext();
  bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(ctx.destination);
  bus.gain.setTargetAtTime(musicOn && !muted ? 0.75 : 0, ctx.currentTime, 1.5);
  let step = 0;
  let next = ctx.currentTime + 0.3;
  music = setInterval(() => {
    if (!ctx || !bus) return;
    bus.gain.setTargetAtTime(musicOn && !muted ? 0.75 : 0, ctx.currentTime, 0.3);
    // Schedule a little ahead so timing stays tight even if the tab is busy.
    while (next < ctx.currentTime + 0.25) {
      const soft = night() > 0.5;
      const bar = Math.floor(step / 8) % 8;
      const beat = step % 8;
      const chord = (soft ? NIGHT_CHORDS : DAY_CHORDS)[bar % 4];
      if (beat === 0) {
        pad(chord, next, EIGHTH * 8 + 0.4, soft);
        voice(hz(chord[0] - 24), next, 0.6, 'sine', soft ? 0.05 : 0.07, 600);
      }
      if (beat === 4) voice(hz(chord[0] - 24 + (soft ? 0 : 7)), next, 0.5, 'sine', soft ? 0.04 : 0.06, 600);
      const note = MELODY[bar][beat];
      if (note !== null) lute(soft ? (TO_MINOR[note] ?? note) - 12 : note, next, soft);
      if (!soft) {
        if (beat === 0 || beat === 4) drumKick(next);
        if (beat % 2 === 1) shaker(next);
      }
      next += EIGHTH * (soft ? 1.15 : 1);
      step++;
    }
  }, 40);
}
