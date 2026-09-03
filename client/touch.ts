// client/touch.ts — on-screen stick + kick/switch/ready/goal. Input only; sim still
// consumes the same Input.move 0..1 vector desktop WASD produces (damping lives
// in /sim integrateControlVelocity). Goal is the touch stand-in for desktop E.

export type TouchFlow = 'title' | 'placing' | 'playing' | 'over';

export interface StickVec {
  x: number;
  y: number;
}

const STICK_RADIUS = 56;

/**
 * Map a pointer offset (px) inside the stick well to a 0..1 move vector.
 * Full deflection = magnitude 1, matching a WASD key. Partial tilt is analog;
 * the sim deadzone + accel model is what gives the same damped feel.
 */
export function stickVector(dx: number, dy: number, radius = STICK_RADIUS): StickVec {
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: 0, y: 0 };
  const mag = Math.min(1, len / radius);
  return { x: (dx / len) * mag, y: (dy / len) * mag };
}

export function isTouchPlay(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.has('touch') || params.get('controls') === 'touch') return true;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const noHover = window.matchMedia('(hover: none)').matches;
  return coarse || (navigator.maxTouchPoints > 0 && noHover);
}

export interface TouchHandlers {
  onKickDown: () => void;
  onKickUp: () => void;
  onSwitch: () => void;
  onReady: () => void;
  onGoal: () => void;
}

/**
 * Binds to the static #touch-layer in index.html. Rebind on scene restart
 * (AbortController) so stale GameScene handlers cannot fire.
 */
export class TouchControls {
  readonly move: StickVec = { x: 0, y: 0 };
  private abort: AbortController | null = null;
  private stickId: number | null = null;
  private kickId: number | null = null;
  private origin = { x: 0, y: 0 };
  private flow: TouchFlow = 'title';
  private enabled = false;

  constructor(private readonly handlers: TouchHandlers) {
    this.enabled = isTouchPlay();
    this.bind();
    this.sync();
  }

  get active(): boolean {
    return this.enabled;
  }

  setFlow(flow: TouchFlow): void {
    this.flow = flow;
    this.sync();
  }

  /** Teach/flow copy in the DOM rail (never overlaps Whistle/Kick/Switch). */
  setCaption(text: string): void {
    const node = this.el('caption-text');
    if (node) node.textContent = text;
    this.syncCaption();
  }

  /** Light up the Goal pad when the carrier is on the millstone. */
  setAtStone(on: boolean): void {
    const btn = this.el('goal-btn');
    if (!btn) return;
    btn.classList.toggle('at-stone', on);
    btn.textContent = on ? 'TAP' : 'Goal';
  }

  /** Goal pips under the caption. Pass null to hide. */
  setPips(taps: number | null): void {
    const pips = this.el('caption-pips');
    if (!pips) return;
    if (taps === null) {
      pips.hidden = true;
    } else {
      pips.hidden = false;
      const dots = pips.querySelectorAll('i');
      dots.forEach((dot, i) => {
        dot.classList.toggle('filled', i < taps);
      });
    }
    this.syncCaption();
  }

  dispose(): void {
    this.abort?.abort();
    this.abort = null;
    this.stickId = null;
    this.kickId = null;
    this.move.x = 0;
    this.move.y = 0;
    this.nudgeKnob(0, 0);
  }

  private el<T extends HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
  }

  private bind(): void {
    this.abort?.abort();
    this.abort = new AbortController();
    const { signal } = this.abort;
    const layer = this.el('touch-layer');
    const well = this.el('stick-well');
    const kick = this.el('kick-btn');
    const sw = this.el('switch-btn');
    const ready = this.el('ready-btn');
    const goal = this.el('goal-btn');
    if (!layer || !well || !kick || !sw || !ready || !goal) return;

    well.addEventListener('pointerdown', this.onStickDown, { signal });
    window.addEventListener('pointermove', this.onStickMove, { signal });
    window.addEventListener('pointerup', this.onStickUp, { signal });
    window.addEventListener('pointercancel', this.onStickUp, { signal });

    kick.addEventListener('pointerdown', this.onKickDown, { signal });
    window.addEventListener('pointerup', this.onKickUp, { signal });
    window.addEventListener('pointercancel', this.onKickUp, { signal });

    sw.addEventListener('pointerdown', this.onSwitch, { signal });
    ready.addEventListener('pointerdown', this.onReady, { signal });
    goal.addEventListener('pointerdown', this.onGoal, { signal });
    const rail = this.el('caption-rail');
    rail?.addEventListener(
      'pointerdown',
      (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
      },
      { signal },
    );
  }

  private sync(): void {
    const layer = this.el('touch-layer');
    if (!layer) return;
    const show = this.enabled && this.flow !== 'title';
    layer.hidden = !show;
    layer.setAttribute('data-flow', this.flow);
    const kick = this.el('kick-btn');
    const ready = this.el('ready-btn');
    const sw = this.el('switch-btn');
    const goal = this.el('goal-btn');
    if (kick) kick.hidden = this.flow !== 'playing';
    if (ready) ready.hidden = this.flow !== 'placing';
    if (goal) goal.hidden = this.flow !== 'playing';
    if (sw) sw.hidden = this.flow === 'title' || this.flow === 'over';
    if (this.flow !== 'playing') this.setAtStone(false);
    if (!show) {
      this.move.x = 0;
      this.move.y = 0;
      this.nudgeKnob(0, 0);
    }
    this.syncCaption();
  }

  private syncCaption(): void {
    const rail = this.el('caption-rail');
    if (!rail) return;
    const text = this.el('caption-text')?.textContent?.trim() ?? '';
    const pips = this.el('caption-pips');
    const pipsOn = !!pips && !pips.hidden;
    const show = this.enabled && this.flow !== 'title' && this.flow !== 'over' && (text.length > 0 || pipsOn);
    rail.hidden = !show;
  }

  private onStickDown = (ev: PointerEvent): void => {
    if (!this.enabled || this.flow === 'title') return;
    ev.preventDefault();
    const well = this.el('stick-well');
    if (!well) return;
    this.stickId = ev.pointerId;
    well.setPointerCapture?.(ev.pointerId);
    const rect = well.getBoundingClientRect();
    this.origin.x = rect.left + rect.width / 2;
    this.origin.y = rect.top + rect.height / 2;
    this.applyStick(ev.clientX, ev.clientY);
  };

  private onStickMove = (ev: PointerEvent): void => {
    if (ev.pointerId !== this.stickId) return;
    ev.preventDefault();
    this.applyStick(ev.clientX, ev.clientY);
  };

  private onStickUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== this.stickId) return;
    this.stickId = null;
    this.move.x = 0;
    this.move.y = 0;
    this.nudgeKnob(0, 0);
  };

  private applyStick(cx: number, cy: number): void {
    const dx = cx - this.origin.x;
    const dy = cy - this.origin.y;
    const v = stickVector(dx, dy, STICK_RADIUS);
    this.move.x = v.x;
    this.move.y = v.y;
    const len = Math.hypot(dx, dy);
    const clamp = len > STICK_RADIUS && len > 0 ? STICK_RADIUS / len : 1;
    this.nudgeKnob(dx * clamp, dy * clamp);
  }

  private nudgeKnob(dx: number, dy: number): void {
    const knob = this.el('stick-knob');
    if (!knob) return;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  private onKickDown = (ev: PointerEvent): void => {
    if (this.flow !== 'playing') return;
    ev.preventDefault();
    ev.stopPropagation();
    this.kickId = ev.pointerId;
    this.el('kick-btn')?.classList.add('held');
    this.handlers.onKickDown();
  };

  private onKickUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== this.kickId) return;
    this.kickId = null;
    this.el('kick-btn')?.classList.remove('held');
    this.handlers.onKickUp();
  };

  private onSwitch = (ev: PointerEvent): void => {
    ev.preventDefault();
    ev.stopPropagation();
    this.handlers.onSwitch();
  };

  private onReady = (ev: PointerEvent): void => {
    ev.preventDefault();
    ev.stopPropagation();
    this.handlers.onReady();
  };

  private onGoal = (ev: PointerEvent): void => {
    if (this.flow !== 'playing') return;
    ev.preventDefault();
    ev.stopPropagation();
    this.handlers.onGoal();
  };
}
