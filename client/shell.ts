// client/shell.ts — page chrome for iPhone Safari PWA: no pinch-zoom, no
// rubber-band overscroll, landscape rotate hint, one-tap Web Audio unlock.

let audioCtx: AudioContext | null = null;
let unlocked = false;
let onAudioUnlock: (() => void) | null = null;

function audioCtor(): typeof AudioContext | null {
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  return window.AudioContext ?? w.webkitAudioContext ?? null;
}

export function getAudioContext(): AudioContext | null {
  const Ctor = audioCtor();
  if (!Ctor) return null;
  if (!audioCtx) {
    audioCtx = new Ctor();
    audioCtx.addEventListener('statechange', syncUnmute);
  }
  return audioCtx;
}

/** Silent buffer + resume — iOS will not unmute until a user gesture. */
export async function unlockAudio(): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) {
    unlocked = true;
    syncUnmute();
    return;
  }
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    unlocked = ctx.state === 'running';
  } catch {
    unlocked = false;
  }
  onAudioUnlock?.();
  syncUnmute();
}

export function canvasSafePad(
  viewW: number,
  viewH: number,
): { l: number; r: number; t: number; b: number } {
  const min = 16;
  const canvas = document.querySelector('#game canvas') as HTMLCanvasElement | null;
  const probe = document.getElementById('safe-probe');
  if (!canvas || !probe) return { l: min, r: min, t: min, b: min };
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return { l: min, r: min, t: min, b: min };
  const cs = getComputedStyle(probe);
  const inset = (side: 'Top' | 'Right' | 'Bottom' | 'Left'): number =>
    parseFloat(cs.getPropertyValue(`padding-${side.toLowerCase()}`)) || 0;
  const sx = viewW / rect.width;
  const sy = viewH / rect.height;
  return {
    l: Math.max(min, Math.max(0, inset('Left') - rect.left) * sx),
    r: Math.max(min, Math.max(0, inset('Right') - (window.innerWidth - rect.right)) * sx),
    t: Math.max(min, Math.max(0, inset('Top') - rect.top) * sy),
    b: Math.max(min, Math.max(0, inset('Bottom') - (window.innerHeight - rect.bottom)) * sy),
  };
}

function syncUnmute(): void {
  const btn = document.getElementById('unmute-btn');
  if (!btn) return;
  const ctx = audioCtx;
  const need = !!ctx && ctx.state !== 'running';
  btn.hidden = !need;
}

function preventZoomAndOverscroll(): void {
  const eat = (ev: Event): void => {
    if (ev.cancelable) ev.preventDefault();
  };
  document.addEventListener('gesturestart', eat, { passive: false });
  document.addEventListener('gesturechange', eat, { passive: false });
  document.addEventListener('gestureend', eat, { passive: false });
  document.addEventListener(
    'touchstart',
    (ev) => {
      if (ev.touches.length > 1 && ev.cancelable) ev.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener(
    'touchmove',
    (ev) => {
      if (ev.cancelable) ev.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener('dblclick', eat, { passive: false });
}

export function installGameShell(opts?: { onUnlock?: () => void }): void {
  onAudioUnlock = opts?.onUnlock ?? null;
  preventZoomAndOverscroll();

  const unmute = document.getElementById('unmute-btn');
  unmute?.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    void unlockAudio();
  });

  const first = (): void => {
    void unlockAudio();
    window.removeEventListener('pointerdown', first, true);
  };
  window.addEventListener('pointerdown', first, true);
}
