/**
 * Prevents the browser tab from being suspended or the OS from sleeping
 * during long-running export operations. Uses three independent layers:
 *
 * 1. Screen Wake Lock API — tells the OS not to sleep the display
 * 2. Silent audio loop — browsers never suspend tabs that play audio
 * 3. beforeunload guard — warns user if they try to close/navigate away
 */

let wakeLockSentinel: WakeLockSentinel | null = null;
let silentAudioCtx: AudioContext | null = null;
let silentOscillator: OscillatorNode | null = null;
let beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;
let visibilityHandler: (() => void) | null = null;
let titleInterval: ReturnType<typeof setInterval> | null = null;
let originalTitle = '';
let active = false;

export interface WakeLockState {
  screenLock: boolean;
  audioLock: boolean;
  unloadGuard: boolean;
}

export type ProgressUpdater = (percent: number, phase: string) => void;

let progressUpdater: ProgressUpdater | null = null;

export function setExportProgress(percent: number, phase: string) {
  if (progressUpdater) progressUpdater(percent, phase);
}

export async function acquireExportLock(): Promise<WakeLockState> {
  if (active) return getState();
  active = true;
  originalTitle = document.title;

  const state: WakeLockState = { screenLock: false, audioLock: false, unloadGuard: false };

  // Layer 1: Screen Wake Lock API
  try {
    if ('wakeLock' in navigator) {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      state.screenLock = true;

      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
        if (active) reacquireScreenLock();
      });

      visibilityHandler = () => {
        if (document.visibilityState === 'visible' && active && !wakeLockSentinel) {
          reacquireScreenLock();
        }
      };
      document.addEventListener('visibilitychange', visibilityHandler);
    }
  } catch {}

  // Layer 2: Silent audio — browser won't suspend a tab producing audio
  try {
    silentAudioCtx = new AudioContext();
    await silentAudioCtx.resume();
    silentOscillator = silentAudioCtx.createOscillator();
    silentOscillator.type = 'sine';
    silentOscillator.frequency.setValueAtTime(0, silentAudioCtx.currentTime);
    const gainNode = silentAudioCtx.createGain();
    gainNode.gain.setValueAtTime(0.001, silentAudioCtx.currentTime);
    silentOscillator.connect(gainNode);
    gainNode.connect(silentAudioCtx.destination);
    silentOscillator.start();
    state.audioLock = true;
  } catch {}

  // Layer 3: beforeunload guard
  beforeUnloadHandler = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = 'Video export is in progress. Are you sure you want to leave?';
    return e.returnValue;
  };
  window.addEventListener('beforeunload', beforeUnloadHandler);
  state.unloadGuard = true;

  // Title bar progress — visible even when tab is in background
  progressUpdater = (percent: number, phase: string) => {
    if (!active) return;
    if (percent >= 100) {
      document.title = `✅ Export Complete — ${originalTitle}`;
    } else {
      document.title = `[${percent}%] ${phase} — ${originalTitle}`;
    }
  };

  return state;
}

export function releaseExportLock() {
  if (!active) return;
  active = false;

  // Release screen wake lock
  if (wakeLockSentinel) {
    wakeLockSentinel.release().catch(() => {});
    wakeLockSentinel = null;
  }
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }

  // Stop silent audio
  if (silentOscillator) {
    try { silentOscillator.stop(); } catch {}
    silentOscillator = null;
  }
  if (silentAudioCtx) {
    silentAudioCtx.close().catch(() => {});
    silentAudioCtx = null;
  }

  // Remove beforeunload guard
  if (beforeUnloadHandler) {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    beforeUnloadHandler = null;
  }

  // Restore title after a short delay so user sees "✅ Complete"
  if (titleInterval) {
    clearInterval(titleInterval);
    titleInterval = null;
  }
  progressUpdater = null;
  setTimeout(() => {
    if (!active) document.title = originalTitle;
  }, 3000);
}

export function isExportLockActive(): boolean {
  return active;
}

export function getExportLockState(): WakeLockState {
  return getState();
}

function getState(): WakeLockState {
  return {
    screenLock: wakeLockSentinel !== null,
    audioLock: silentAudioCtx !== null && silentAudioCtx.state === 'running',
    unloadGuard: beforeUnloadHandler !== null,
  };
}

async function reacquireScreenLock() {
  if (!active || wakeLockSentinel) return;
  try {
    if ('wakeLock' in navigator) {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
        if (active) reacquireScreenLock();
      });
    }
  } catch {}
}
