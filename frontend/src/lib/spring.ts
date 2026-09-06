/**
 * Interruptible spring — the only motion primitive the UI uses.
 *
 * Parameters are the two from the design reference: `damping` (1.0 = critical,
 * no overshoot; the curve-morph exception uses 0.8) and `response` (seconds to
 * roughly reach the target — not a fixed duration). Interruption-safe by
 * construction: retargeting re-bases the animation on the CURRENT presentation
 * value, so rapid clicking morphs from what is on screen, never from a stale
 * origin.
 */
export class Spring {
  private value: number;
  private velocity = 0;
  private target: number;
  private raf = 0;
  private last = 0;

  constructor(
    readonly damping: number,
    readonly response: number,
    initial: number,
    private readonly onValue: (v: number) => void,
  ) {
    this.value = initial;
    this.target = initial;
  }

  /** Retarget with an immediate re-render; safe to call every frame. */
  retarget(target: number): void {
    this.target = target;
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.step);
    }
  }

  /** The value currently on screen — the base for any retarget. */
  get current(): number {
    return this.value;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private step = (now: number) => {
    // Sub-step to keep the integrator stable across frame-time jitter.
    let dt = Math.min((now - this.last) / 1000, 0.032);
    this.last = now;
    const omega0 = (2 * Math.PI) / this.response;
    const zeta = this.damping;
    const settled = () =>
      Math.abs(this.value - this.target) < 1e-4 && Math.abs(this.velocity) < 1e-3;
    for (;;) {
      const h = Math.min(dt, 0.008);
      const accel = -2 * zeta * omega0 * this.velocity - omega0 * omega0 * (this.value - this.target);
      this.velocity += accel * h;
      this.value += this.velocity * h;
      dt -= h;
      if (dt <= 0) break;
    }
    if (settled()) {
      this.value = this.target;
      this.velocity = 0;
      this.onValue(this.value);
      this.raf = 0;
      return;
    }
    this.onValue(this.value);
    this.raf = requestAnimationFrame(this.step);
  };
}
