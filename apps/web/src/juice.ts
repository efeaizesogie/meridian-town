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
