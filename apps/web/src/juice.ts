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

export type Sound = 'swing' | 'coin' | 'quest' | 'level' | 'error' | 'eat' | 'build' | 'bid';

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
  }
}

// ---------- ambience: birds by day, crickets at night, a slow pentatonic tune ----------

let ambience: ReturnType<typeof setInterval> | null = null;
const SCALE = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3, 587.3, 659.3];

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
  let step = 0;
  ambience = setInterval(() => {
    if (muted) return;
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') return;
    const n = night();
    step++;
    // A soft lute-like note every couple of seconds, wandering the pentatonic scale.
    if (step % 2 === 0) {
      const f = SCALE[Math.floor(Math.random() * SCALE.length)] / (n > 0.5 ? 2 : 1);
      tone(f, 0, 1.6, 'triangle', 0.022);
      if (Math.random() < 0.35) tone(f * 1.5, 0.35, 1.2, 'sine', 0.012);
    }
    if (n < 0.5 && Math.random() < 0.5) [0, 0.12, 0.24].slice(0, 1 + Math.floor(Math.random() * 3)).forEach(t => chirp(t + Math.random() * 0.4));
    if (n > 0.4) for (let i = 0; i < 3; i++) noiseBurst(i * 0.11, 0.05, 4200, 0.02 * n);
  }, 1100);
}
