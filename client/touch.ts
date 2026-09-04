// client/touch.ts — on-screen stick + kick/sprint/wrestle/switch/ready/goal.
// Input only; sim still consumes the same Input.move 0..1 vector desktop WASD
// produces (damping lives in /sim integrateControlVelocity). Goal is the touch
// stand-in for desktop E; Sprint is Shift; Wriggle/Rip is F.

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
  sprint = false;
  wrestle = false;
  private abort: AbortController | null = null;
  private stickId: number | null = null;
  private kickId: number | null = null;
  private sprintId: number | null = null;
  private wrestleId: number | null = null;
  private origin = { x: 0, y: 0 };
  private flow: TouchFlow = 'title';
  private enabled = false;
  private atStone = false;
  private wrestleLabel: 'rip' | 'wriggle' | 'none' = 'none';

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

  /** Goal pad exists only while the carrier is in millstone reach. */
  setAtStone(on: boolean): void {
    this.atStone = on;
    const btn = this.el('goal-btn');
    if (!btn) return;
    const show = this.enabled && this.flow === 'playing' && on;
    btn.hidden = !show;
    btn.classList.toggle('at-stone', show);
    btn.textContent = show ? 'TAP' : 'Goal';
    if (!show) btn.classList.remove('held');
  }

  /**
   * Shared Wriggle / Rip pad. Hidden while carrying or when the hug is not
   * live; label follows sim wrestleMode so one hold can wriggle in then rip.
   * A live pointer hold is not cancelled if eligibility flickers for a frame.
   */
  setWrestle(mode: 'rip' | 'wriggle' | 'none', pressure = 0): void {
    this.wrestleLabel = mode;
    const btn = this.el('wrestle-btn');
    if (!btn) return;
    const holding = this.wrestleId !== null;
    const show = this.enabled && this.flow === 'playing' && (mode !== 'none' || holding);
    btn.hidden = !show;
    btn.textContent = mode === 'wriggle' ? 'Wriggle' : 'Rip';
    btn.style.setProperty('--wrestle-pressure', String(Math.max(0, Math.min(1, pressure))));
    btn.classList.toggle('charging', pressure > 0.02);
    if (!show && !holding) {
      btn.classList.remove('held');
      this.wrestle = false;
      this.wrestleId = null;
    }
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
    this.sprintId = null;
    this.wrestleId = null;
    this.sprint = false;
    this.wrestle = false;
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
    const sprint = this.el('sprint-btn');
    const wrestle = this.el('wrestle-btn');
    const sw = this.el('switch-btn');
    const ready = this.el('ready-btn');
    const goal = this.el('goal-btn');
    if (!layer || !well || !kick || !sprint || !wrestle || !sw || !ready || !goal) return;

    well.addEventListener('pointerdown', this.onStickDown, { signal });
    window.addEventListener('pointermove', this.onStickMove, { signal });
    window.addEventListener('pointerup', this.onStickUp, { signal });
    window.addEventListener('pointercancel', this.onStickUp, { signal });

    this.bindHold(kick, {
      onDown: this.onKickDown,
      onUp: this.onKickUp,
      signal,
    });
    this.bindHold(sprint, {
      onDown: this.onSprintDown,
      onUp: this.onSprintUp,
      signal,
    });
    this.bindHold(wrestle, {
      onDown: this.onWrestleDown,
      onUp: this.onWrestleUp,
      signal,
    });
    window.addEventListener('pointerup', this.onKickUp, { signal });
    window.addEventListener('pointercancel', this.onKickUp, { signal });
    window.addEventListener('pointerup', this.onSprintUp, { signal });
    window.addEventListener('pointercancel', this.onSprintUp, { signal });
    window.addEventListener('pointerup', this.onWrestleUp, { signal });
    window.addEventListener('pointercancel', this.onWrestleUp, { signal });

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

  /**
   * Hold pads (Kick / Sprint) must capture the pointer. Chrome iOS often
   * drops the window pointerup after the first tap, which left Kick stuck
   * charging and blocked every later kick.
   */
  private bindHold(
    el: HTMLElement,
    opts: {
      onDown: (ev: PointerEvent) => void;
      onUp: (ev: Event) => void;
      signal: AbortSignal;
    },
  ): void {
    const { onDown, onUp, signal } = opts;
    el.addEventListener(
      'pointerdown',
      (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        try {
          el.setPointerCapture(ev.pointerId);
        } catch {
          /* iOS may throw if the pointer already released */
        }
        onDown(ev);
      },
      { signal },
    );
    el.addEventListener('pointerup', onUp, { signal });
    el.addEventListener('pointercancel', onUp, { signal });
    el.addEventListener('lostpointercapture', onUp, { signal });
  }

  private sync(): void {
    const layer = this.el('touch-layer');
    if (!layer) return;
    const show = this.enabled && this.flow !== 'title';
    layer.hidden = !show;
    layer.setAttribute('data-flow', this.flow);
    const kick = this.el('kick-btn');
    const sprint = this.el('sprint-btn');
    const ready = this.el('ready-btn');
    const sw = this.el('switch-btn');
    if (kick) kick.hidden = this.flow !== 'playing';
    if (sprint) sprint.hidden = this.flow !== 'playing';
    if (ready) ready.hidden = this.flow !== 'placing';
    if (sw) sw.hidden = this.flow === 'title' || this.flow === 'over';
    this.setAtStone(this.flow === 'playing' && this.atStone);
    this.setWrestle(this.flow === 'playing' ? this.wrestleLabel : 'none');
    if (this.flow !== 'playing') {
      this.sprint = false;
      this.sprintId = null;
      this.wrestle = false;
      this.wrestleId = null;
      this.el('sprint-btn')?.classList.remove('held');
      this.el('wrestle-btn')?.classList.remove('held');
    }
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
    this.kickId = ev.pointerId;
    this.el('kick-btn')?.classList.add('held');
    this.handlers.onKickDown();
  };

  private onKickUp = (ev: Event): void => {
    if (this.kickId === null) return;
    if (ev instanceof PointerEvent && ev.type !== 'lostpointercapture') {
      if (ev.pointerId !== this.kickId) return;
    }
    this.kickId = null;
    this.el('kick-btn')?.classList.remove('held');
    this.handlers.onKickUp();
  };

  private onSprintDown = (ev: PointerEvent): void => {
    if (this.flow !== 'playing') return;
    this.sprintId = ev.pointerId;
    this.sprint = true;
    this.el('sprint-btn')?.classList.add('held');
  };

  private onSprintUp = (ev: Event): void => {
    if (this.sprintId === null) return;
    if (ev instanceof PointerEvent && ev.type !== 'lostpointercapture') {
      if (ev.pointerId !== this.sprintId) return;
    }
    this.sprintId = null;
    this.sprint = false;
    this.el('sprint-btn')?.classList.remove('held');
  };

  private onWrestleDown = (ev: PointerEvent): void => {
    if (this.flow !== 'playing' || this.wrestleLabel === 'none') return;
    this.wrestleId = ev.pointerId;
    this.wrestle = true;
    this.el('wrestle-btn')?.classList.add('held');
  };

  private onWrestleUp = (ev: Event): void => {
    if (this.wrestleId === null) return;
    if (ev instanceof PointerEvent && ev.type !== 'lostpointercapture') {
      if (ev.pointerId !== this.wrestleId) return;
    }
    this.wrestleId = null;
    this.wrestle = false;
    this.el('wrestle-btn')?.classList.remove('held');
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
    if (this.flow !== 'playing' || !this.atStone) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.handlers.onGoal();
  };
}
