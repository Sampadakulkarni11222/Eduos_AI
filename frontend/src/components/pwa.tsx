'use client';
import { useEffect, useState } from 'react';

/**
 * EduOS AI as an installable app, from the same website and the same
 * deployment.
 *
 * Nothing here is a second build of the product. Installing adds the website
 * to the phone's home screen, where it opens full screen (see app/manifest.ts);
 * every page, sign-in and record still comes from the one deployment the
 * browser already uses.
 */

/** Registers public/sw.js, which only supplies the offline page. Production only. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    // After the page has loaded, so registration never competes with it.
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Without it the site works exactly as before, minus the offline page.
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}

/** The event Chrome and Edge fire when the site may be installed. Not in the DOM types. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Already running as the installed app (Android, desktop, or an iOS home-screen icon). */
export function isRunningInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  return standalone || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * iPhone or iPad Safari, which has no install prompt: the only way is Share →
 * Add to Home Screen. iPadOS reports itself as a Mac, hence the touch check.
 */
export function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  // Other iOS browsers (Chrome, Firefox, Edge) cannot add to the home screen
  // in the same way, so the instructions would be wrong there.
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

type InstallState =
  | { kind: 'none' }
  | { kind: 'prompt'; event: BeforeInstallPromptEvent }
  | { kind: 'ios' };

/**
 * "Install the app", shown only where installing is possible and has not
 * happened: a button where the browser offers an install prompt, the Add to
 * Home Screen steps on iPhone, and nothing at all otherwise.
 */
export function InstallAppPrompt() {
  const [state, setState] = useState<InstallState>({ kind: 'none' });

  useEffect(() => {
    if (isRunningInstalled()) return;
    if (isIosSafari()) setState({ kind: 'ios' });

    const onPrompt = (e: Event) => {
      // Keep the browser's own mini-bar from appearing; the button replaces it.
      e.preventDefault();
      setState({ kind: 'prompt', event: e as BeforeInstallPromptEvent });
    };
    const onInstalled = () => setState({ kind: 'none' });
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (state.kind === 'none') return null;

  if (state.kind === 'ios') {
    return (
      <p style={{ fontSize: 12.5, color: '#7a6a60', lineHeight: 1.6, margin: '14px 0 0', textAlign: 'center' }}>
        Use EduOS like an app: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
      </p>
    );
  }

  const install = async () => {
    const { event } = state;
    // A prompt can be shown once; whatever the answer, this event is spent.
    setState({ kind: 'none' });
    await event.prompt();
    await event.userChoice.catch(() => null);
  };

  return (
    <button
      type="button"
      onClick={() => void install()}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        marginTop: 14, minHeight: 44, padding: '10px 18px', borderRadius: 12,
        border: '1.5px solid rgba(89,22,32,0.25)', background: '#fff', color: '#591620',
        fontSize: 13.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
      </svg>
      Install the EduOS app
    </button>
  );
}
