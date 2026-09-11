/**
 * The Screen-1 hero: three schedules stacked on ONE ruler. All three curves
 * share the SAME stroke width — selection is expressed by opacity only
 * (selected 100%, others 40%), and each shape keeps its own color in every
 * state (Aggressive ember, Neutral paper, Conservative patina — design rule).
 * Emphasis changes animate through interruptible springs (damping 1.0).
 */
import {useEffect, useRef} from "react";
import {Shape, progress, WAD} from "./lib/curve";
import {Spring} from "./lib/spring";

export const SHAPE_COLOR = ["#ff8a50", "#e9edf5", "#45c4d8"] as const;
export const SHAPE_NAME = ["Aggressive", "Neutral", "Conservative"] as const;
const SAMPLES = 120;
const M = {left: 44, right: 42, top: 14, bottom: 30};

function curvePoints(shape: number, height: number): Float64Array {
  const pts = new Float64Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    const r = i / (SAMPLES - 1);
    // elapsed = r * duration, duration fixed 1000 — the preview is unit-less
    // (% of budget vs % of window), so any duration draws the same shape.
    const p = Number(progress(BigInt(Math.round(r * 1000)), 1000n, shape as Shape)) / Number(WAD);
    pts[i] = M.top + (1 - p) * (height - M.top - M.bottom);
  }
  return pts;
}

export function CurvePreview(props: {
  selected: number;
  durationSeconds: number;
  intro?: boolean;
  aspect?: number;
  /** Create workspace: render the bare canvas so it fills the stage panel. */
  fill?: boolean;
  /** Tranche grid: bars under the selected curve, one per scheduled slice —
   *  the amount/duration/min-slice inputs made visible in the chart. */
  tranches?: number;
  /** Stronger selection contrast (others drop to 25%) for configure views. */
  focus?: boolean;
  /** Show ONLY the selected curve — no comparison curves at all. */
  solo?: boolean;
  /** Budget size for the hover readout; undefined keeps hover time-only. */
  amount?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<Float64Array[]>([]);
  const alphasRef = useRef([1, 0.4, 0.4]);
  const springsRef = useRef<Spring[] | null>(null);
  const loopRef = useRef(0);
  const sizeRef = useRef({w: 0, h: 0});
  const drawRef = useRef<() => void>(() => {});
  // Landing intro: ruler first, then the three curves draw themselves left
  // to right, in sequence. ~2s total, then it stops — no loop, no drift.
  const revealRef = useRef<number[]>(props.intro ? [0, 0, 0] : [1, 1, 1]);
  const rulerRevealRef = useRef(props.intro ? 0 : 1);

  // One permanent effect: canvas setup, drawing, spring loop.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;

    const draw = () => {
      const {w, h} = sizeRef.current;
      if (!w) return;
      ctx.clearRect(0, 0, w, h);
      const innerW = w - M.left - M.right;
      const rulerFrac = rulerRevealRef.current;

      // Guides: quiet hairlines; bare mono numbers on the left (the "%" is
      // in the caption, not repeated per tick).
      ctx.strokeStyle = "#0c1a23";
      ctx.lineWidth = 1;
      ctx.font = "10px 'IBM Plex Mono', monospace";
      ctx.fillStyle = "#8fa6a3";
      ctx.textAlign = "right";
      ctx.globalAlpha = rulerFrac;
      for (const p of [0, 0.25, 0.5, 0.75, 1]) {
        const y = M.top + (1 - p) * (h - M.top - M.bottom);
        ctx.beginPath();
        ctx.moveTo(M.left, y + 0.5);
        ctx.lineTo(M.left + (w - M.left - M.right) * rulerFrac, y + 0.5);
        ctx.stroke();
        ctx.fillText(`${p * 100}`, M.left - 7, y + 3);
      }

      // The ruler: the dominant element — ticks + time labels.
      const rulerY = h - M.bottom + 0.5;
      ctx.strokeStyle = "#13303a";
      ctx.beginPath();
      ctx.moveTo(M.left, rulerY);
      ctx.lineTo(M.left + innerW * rulerFrac, rulerY);
      ctx.stroke();
      ctx.textAlign = "center";
      const ticks = 8;
      if (rulerFrac >= 1) {
        for (let i = 0; i <= ticks; i++) {
          const x = M.left + (i / ticks) * innerW;
          ctx.beginPath();
          ctx.moveTo(x, rulerY);
          ctx.lineTo(x, rulerY + (i % 4 === 0 ? 5 : 3));
          ctx.stroke();
          if (i % 4 === 0) {
            const seconds = Math.round((i / ticks) * Number(canvas.dataset.duration ?? 900));
            const label = seconds === 0 ? "0s" : `${Math.round(seconds / 60)} min`;
            // The last label right-aligns so it never crowds the panel edge.
            if (i === ticks) {
              ctx.textAlign = "right";
              ctx.fillText(label, x, rulerY + 15);
              ctx.textAlign = "center";
            } else {
              ctx.fillText(label, x, rulerY + 15);
            }
          }
        }
      }
      ctx.globalAlpha = 1;

      // Tranche grid: one bar per scheduled slice, its top riding the
      // selected curve (cumulative authorized by that tranche). This is how
      // the amount/duration/min-slice inputs show up in the picture.
      const trancheCount = Math.min(tranchesRef.current, 400);
      if (trancheCount > 0) {
        const pts = pointsRef.current[selectedRef.current];
        const barW = innerW / trancheCount;
        const gap = Math.min(6, Math.max(1.5, barW * 0.22));
        ctx.fillStyle = SHAPE_COLOR[selectedRef.current];
        ctx.globalAlpha = 0.1 * rulerFrac;
        for (let i = 0; i < trancheCount; i++) {
          const frac = (i + 0.5) / trancheCount;
          const yTop = pts[Math.min(pts.length - 1, Math.floor(frac * (pts.length - 1)))];
          ctx.fillRect(M.left + i * barW + gap / 2, yTop, Math.max(1, barW - gap), h - M.bottom - yTop);
        }
        ctx.globalAlpha = 1;
      }

      // Three equal-weight curves — or the selected one alone in solo mode.
      // Selection is expressed by opacity (solo draws it at full strength);
      // the selected curve draws LAST so nothing overlaps it where the
      // shapes converge at the window end.
      const solo = soloRef.current;
      const order = solo
        ? [selectedRef.current]
        : [0, 1, 2].filter((s) => s !== selectedRef.current).concat(selectedRef.current);
      for (const s of order) {
        const reveal = revealRef.current[s];
        if (reveal <= 0) continue;
        ctx.strokeStyle = SHAPE_COLOR[s];
        ctx.globalAlpha = alphasRef.current[s];
        ctx.lineWidth = 2.25;
        ctx.lineJoin = "round";
        // the glow: soft halo behind every stroke (the reference's signature)
        ctx.shadowBlur = 14;
        ctx.shadowColor = SHAPE_COLOR[s];
        const pts = pointsRef.current[s];
        const last = Math.max(1, Math.floor((pts.length - 1) * reveal));
        ctx.beginPath();
        for (let i = 0; i <= last; i++) {
          const x = M.left + (i / (pts.length - 1)) * innerW;
          if (i === 0) ctx.moveTo(x, pts[i]);
          else ctx.lineTo(x, pts[i]);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;

      // Hover: crosshair + the honest numbers at the cursor's moment,
      // drawn last so nothing paints over it.
      const hover = hoverRef.current;
      if (hover && rulerFrac >= 1) {
        const frac = Math.min(1, Math.max(0, (hover.x - M.left) / innerW));
        const ptsSel = pointsRef.current[selectedRef.current];
        const y = ptsSel[Math.min(ptsSel.length - 1, Math.floor(frac * (ptsSel.length - 1)))];
        const spent = Math.min(1, Math.max(0, 1 - (y - M.top) / (h - M.top - M.bottom)));
        const crossX = M.left + frac * innerW;
        ctx.strokeStyle = "#1d3138";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(crossX, M.top);
        ctx.lineTo(crossX, h - M.bottom);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(crossX, y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = "#f4f8ff";
        ctx.fill();
        ctx.strokeStyle = "#070b13";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        const seconds = Math.round(frac * Number(canvas.dataset.duration ?? 900));
        const lines = [
          `T+${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
          `${(spent * 100).toFixed(1)}% spent` +
            (amountRef.current !== undefined ? ` · ${(amountRef.current * spent).toFixed(3)} dETH` : ""),
          `${((1 - spent) * 100).toFixed(1)}% left`,
        ];
        if (tranchesRef.current > 0) {
          lines.push(
            `slice ${Math.min(tranchesRef.current, Math.floor(frac * tranchesRef.current) + 1)}/${tranchesRef.current}`,
          );
        }
        ctx.font = "10px 'IBM Plex Mono', monospace";
        const tw = Math.max(...lines.map((line) => ctx.measureText(line).width)) + 16;
        const th = lines.length * 13 + 10;
        let bx = crossX + 14;
        if (bx + tw > w - 4) bx = crossX - tw - 14;
        const by = Math.max(M.top + 2, y - th - 12);
        ctx.beginPath();
        ctx.roundRect(bx, by, tw, th, 8);
        ctx.fillStyle = "rgba(7, 11, 19, 0.92)";
        ctx.fill();
        ctx.strokeStyle = "#1d3138";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.textAlign = "left";
        lines.forEach((line, i) => {
          ctx.fillStyle = i === 0 ? "#e9edf5" : "#8b9bb0";
          ctx.fillText(line, bx + 8, by + 18 + i * 13);
        });
        ctx.textAlign = "center";
      }
    };
    drawRef.current = draw;

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = {w, h};
      pointsRef.current = [0, 1, 2].map((s) => curvePoints(s, h));
      draw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Hover tracking — the crosshair follows every move, disappears on leave.
    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      hoverRef.current = {x: e.clientX - rect.left};
      draw();
    };
    const onLeave = () => {
      hoverRef.current = null;
      draw();
    };
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);

    // Intro timeline (landing only): ruler 0–0.5s, then curve 1, 2, 3 each
    // 0.5s — about two seconds, then it stops and stays still.
    let introRaf = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (props.intro && !reduced) {
      const t0 = performance.now();
      const tick = (t: number) => {
        const el = (t - t0) / 1000;
        rulerRevealRef.current = Math.min(1, el / 0.5);
        const curveTime = Math.max(0, el - 0.5);
        revealRef.current = [0, 1, 2].map((s) => Math.min(1, Math.max(0, curveTime - s * 0.5) / 0.5));
        draw();
        if (el < 2.2) introRaf = requestAnimationFrame(tick);
      };
      introRaf = requestAnimationFrame(tick);
    } else if (props.intro) {
      rulerRevealRef.current = 1;
      revealRef.current = [1, 1, 1];
    }

    const animate = () => {
      loopRef.current = 0;
      draw();
      if (springsRef.current?.some((sp) => !sp.settled)) {
        loopRef.current = requestAnimationFrame(animate);
      }
    };
    const kickLoop = () => {
      if (!loopRef.current) loopRef.current = requestAnimationFrame(animate);
    };
    springsRef.current = [0, 1, 2].map(
      (s) => new Spring(1.0, 0.3, alphasRef.current[s], () => kickLoop()),
    );
    // Wire the selection effect to the live springs + the draw-on reveal.
    retargetRef.current = (selected: number) => {
      springsRef.current?.forEach((sp, s) => sp.retarget(s === selected ? 1 : othersRef.current));
      if (!props.intro) startReveal(selected);
      kickLoop();
    };

    return () => {
      ro.disconnect();
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      if (loopRef.current) cancelAnimationFrame(loopRef.current);
      if (introRaf) cancelAnimationFrame(introRaf);
      if (revealRafRef.current) cancelAnimationFrame(revealRafRef.current);
      loopRef.current = 0;
      springsRef.current?.forEach((sp) => sp.dispose());
      springsRef.current = null;
      retargetRef.current = null;
    };
  }, []);

  const selectedRef = useRef(props.selected);
  const retargetRef = useRef<((selected: number) => void) | null>(null);
  const tranchesRef = useRef(props.tranches ?? 0);
  const othersRef = useRef(props.focus ? 0.25 : 0.4);
  const soloRef = useRef(props.solo ?? false);
  const amountRef = useRef(props.amount);
  const hoverRef = useRef<{x: number} | null>(null);
  const revealRafRef = useRef(0);

  // Pace change: the newly selected curve redraws itself start → end
  // (~0.65 s, skipped under reduced motion).
  const startReveal = (s: number) => {
    cancelAnimationFrame(revealRafRef.current);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      revealRef.current[s] = 1;
      drawRef.current();
      return;
    }
    const t0 = performance.now();
    const tick = (t: number) => {
      const el = (t - t0) / 1000;
      revealRef.current[s] = Math.min(1, el / 0.65);
      drawRef.current();
      if (el < 0.65) revealRafRef.current = requestAnimationFrame(tick);
      else revealRef.current[s] = 1;
    };
    revealRafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    // Initial state without waiting for a spring tick.
    if (!retargetRef.current) {
      alphasRef.current = [0, 1, 2].map((s) => (s === props.selected ? 1 : othersRef.current));
    }
    selectedRef.current = props.selected;
    retargetRef.current?.(props.selected);
  }, [props.selected]);

  useEffect(() => {
    tranchesRef.current = props.tranches ?? 0;
    drawRef.current();
  }, [props.tranches]);

  useEffect(() => {
    amountRef.current = props.amount;
    drawRef.current();
  }, [props.amount]);

  // Focus mode (configure views): dim the comparison curves further.
  useEffect(() => {
    othersRef.current = props.focus ? 0.25 : 0.4;
    retargetRef.current?.(selectedRef.current);
  }, [props.focus]);

  useEffect(() => {
    soloRef.current = props.solo ?? false;
    drawRef.current();
  }, [props.solo]);

  // Duration changes only move ruler labels — redraw with the new dataset.
  useEffect(() => {
    drawRef.current();
  }, [props.durationSeconds]);

  if (props.fill) {
    return (
      <canvas
        ref={canvasRef}
        style={{width: "100%", height: "100%", display: "block"}}
        data-duration={props.durationSeconds}
        aria-label={`Schedule preview — ${SHAPE_NAME[props.selected]} pace`}
      />
    );
  }

  return (
    <div className="plot" style={{width: "fit-content", maxWidth: "100%"}}>
      {/* The instrument is 760px wide at full size and keeps that shape on
        every screen that fits it. When the viewport cannot fit the fixed
        size, it scales down FLUIDLY (max-width + fixed aspect) — never
        cropped, never stretched. */}
      <canvas
        ref={canvasRef}
        style={{width: 760, maxWidth: "100%", aspectRatio: "2.6", height: "auto"}}
        data-duration={props.durationSeconds}
        aria-label={`Schedule preview — ${SHAPE_NAME[props.selected]} pace`}
      />
    </div>
  );
}
