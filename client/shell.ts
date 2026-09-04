// client/shell.ts — Chrome iOS (WebKit) page chrome: visible-viewport layout so
// Chrome's toolbar does not cover the stick/kick, no pinch-zoom, no rubber-band
// overscroll, one-tap Web Audio unlock. Safari Add to Home Screen is optional.

export interface VisibleBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Layout box Chrome iOS actually draws into. The layout viewport (innerWidth /
 * innerHeight) includes area behind Chrome's top omnibox and bottom toolbar;
 * visualViewport is the unobscured region. Safari A2HS standalone has them equal.
 */
export function readVisibleBox(
  vv: { offsetLeft: number; offsetTop: number; width: number; height: number } | null | undefined,
  innerWidth: number,
  innerHeight: number,
): VisibleBox {
  if (!vv || vv.width < 8 || vv.height < 8) {
    return { left: 0, top: 0, width: innerWidth, height: innerHeight };
  }
  return { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height };
}

let audioCtx: AudioContext | null = null;
let unlocked = false;
let onAudioUnlock: (() => void) | null = null;
let onViewport: (() => void) | null = null;

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

/** Silent buffer + resume — iOS WebKit (Chrome and Safari) will not unmute until a user gesture. */
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

function pinToVisibleBox(el: HTMLElement | null, box: VisibleBox): void {
  if (!el) return;
  el.style.position = 'fixed';
  el.style.top = `${box.top}px`;
  el.style.left = `${box.left}px`;
  el.style.width = `${box.width}px`;
  el.style.height = `${box.height}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
}

export function syncVisibleFrame(): VisibleBox {
  const box = readVisibleBox(window.visualViewport, window.innerWidth, window.innerHeight);
  pinToVisibleBox(document.getElementById('game'), box);
  pinToVisibleBox(document.getElementById('shell'), box);
  pinToVisibleBox(document.getElementById('safe-probe'), box);
  return box;
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
  const vis = readVisibleBox(window.visualViewport, window.innerWidth, window.innerHeight);
  const cs = getComputedStyle(probe);
  const inset = (side: 'Top' | 'Right' | 'Bottom' | 'Left'): number =>
    parseFloat(cs.getPropertyValue(`padding-${side.toLowerCase()}`)) || 0;
  const sx = viewW / rect.width;
  const sy = viewH / rect.height;
  const visRight = vis.left + vis.width;
  const visBottom = vis.top + vis.height;
  return {
    l: Math.max(min, Math.max(0, vis.left + inset('Left') - rect.left) * sx),
    r: Math.max(min, Math.max(0, rect.right - (visRight - inset('Right'))) * sx),
    t: Math.max(min, Math.max(0, vis.top + inset('Top') - rect.top) * sy),
    b: Math.max(min, Math.max(0, rect.bottom - (visBottom - inset('Bottom'))) * sy),
  };
}

function syncUnmute(): void {
  const btn = document.getElementById('unmute-btn');
  if (!btn) return;
  const ctx = audioCtx;
  const need = !!ctx && ctx.state !== 'running';
  btn.hidden = !need;
}

/**
 * Title / team-pick copy can overflow a short phone landscape viewport.
 * Those regions opt in with data-allow-scroll so pan-y still works while the
 * rest of the shell keeps pinch-zoom and rubber-band overscroll locked out.
 */
export function allowsPageScroll(target: EventTarget | null): boolean {
  if (!target || typeof (target as { closest?: unknown }).closest !== 'function') {
    return false;
  }
  return !!(target as Element).closest('[data-allow-scroll]');
}

function preventZoomAndOverscroll(): void {
  const eat = (ev: Event): void => {
    if (ev.cancelable) ev.preventDefault();
  };
  // gesture* is WebKit (Chrome iOS + Safari). Blink desktop ignores it.
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
      if (allowsPageScroll(ev.target)) return;
      if (ev.cancelable) ev.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener('dblclick', eat, { passive: false });
  document.addEventListener(
    'contextmenu',
    (ev) => {
      if (ev.cancelable) ev.preventDefault();
    },
    { passive: false },
  );
}

export function installGameShell(opts?: { onUnlock?: () => void; onViewport?: () => void }): void {
  onAudioUnlock = opts?.onUnlock ?? null;
  onViewport = opts?.onViewport ?? null;
  preventZoomAndOverscroll();

  const applyViewport = (): void => {
    syncVisibleFrame();
    onViewport?.();
  };
  applyViewport();
  window.visualViewport?.addEventListener('resize', applyViewport);
  window.visualViewport?.addEventListener('scroll', applyViewport);
  window.addEventListener('resize', applyViewport);
  window.addEventListener('orientationchange', applyViewport);

  const unmute = document.getElementById('unmute-btn');
  unmute?.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    void unlockAudio();
  });

  // WebKit (Chrome iOS) may deliver touchend without a trusted pointerdown for audio.
  const first = (): void => {
    void unlockAudio();
    window.removeEventListener('pointerdown', first, true);
    window.removeEventListener('touchend', first, true);
    window.removeEventListener('click', first, true);
  };
  window.addEventListener('pointerdown', first, true);
  window.addEventListener('touchend', first, true);
  window.addEventListener('click', first, true);
}
