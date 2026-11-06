// Phone helpers: whether we're on a phone-sized screen, a short haptic buzz, and installing
// the game to the home screen.
import { useEffect, useState } from 'react';
import { isMuted } from './juice';

const PHONE = '(max-width: 720px)';

/** True on a phone-sized screen held upright; follows rotation and window resizes. */
export function usePhone() {
  const [phone, setPhone] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(PHONE).matches);
  useEffect(() => {
    const mq = matchMedia(PHONE);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

/** A short vibration on phones that support it (Android); silent when sound is off. */
export function buzz(pattern: number | number[]) {
  if (isMuted()) return;
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

// The browser offers installation once; keep the offer so a button can use it later.
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let offer: InstallPrompt | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); offer = e as InstallPrompt; listeners.forEach(f => f()); });
  window.addEventListener('appinstalled', () => { offer = null; listeners.forEach(f => f()); });
}

export const installed = () =>
  typeof matchMedia !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);
export const isIOS = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

/** How this device can add the game to its home screen: a button, an iPhone hint, or nothing. */
export function useInstall(): { can: 'prompt' | 'ios' | null; install: () => Promise<void> } {
  const [, redraw] = useState(0);
  useEffect(() => {
    const f = () => redraw(n => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  const can = installed() ? null : offer ? 'prompt' : isIOS() ? 'ios' : null;
  return {
    can,
    install: async () => {
      if (!offer) return;
      await offer.prompt();
      await offer.userChoice.catch(() => null);
      offer = null;
      listeners.forEach(f => f());
    },
  };
}
