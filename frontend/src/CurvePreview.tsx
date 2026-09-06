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

export const SHAPE_COLOR = ["#ff7a45", "#eae5d6", "#4fb8a9"] as const;
export const SHAPE_NAME = ["Aggressive", "Neutral", "Conservative"] as const;
const SAMPLES = 120;
const M = {left: 44, right: 30, top: 14, bottom: 30};

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

export function CurvePreview(props: {selected: number; durationSeconds: number}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<Float64Array[]>([]);
  const alphasRef = useRef([1, 0.4, 0.4]);
  const springsRef = useRef<Spring[] | null>(null);
  const loopRef = useRef(0);
  const sizeRef = useRef({w: 0, h: 0});
  const drawRef = useRef<() => void>(() => {});

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

      // Guides: quiet hairlines; bare mono numbers on the left (the "%" is
      // in the caption, not repeated per tick).
      ctx.strokeStyle = "#16262c";
      ctx.lineWidth = 1;
      ctx.font = "10px 'IBM Plex Mono', monospace";
      ctx.fillStyle = "#8fa6a3";
      ctx.textAlign = "right";
      for (const p of [0, 0.25, 0.5, 0.75, 1]) {
        const y = M.top + (1 - p) * (h - M.top - M.bottom);
        ctx.beginPath();
        ctx.moveTo(M.left, y + 0.5);
        ctx.lineTo(w - M.right, y + 0.5);
        ctx.stroke();
        ctx.fillText(`${p * 100}`, M.left - 7, y + 3);
      }

      // The ruler: the dominant element — ticks + time labels.
      const rulerY = h - M.bottom + 0.5;
      ctx.strokeStyle = "#254048";
      ctx.beginPath();
      ctx.moveTo(M.left, rulerY);
      ctx.lineTo(w - M.right, rulerY);
      ctx.stroke();
      ctx.textAlign = "center";
      const ticks = 8;
      for (let i = 0; i <= ticks; i++) {
        const x = M.left + (i / ticks) * innerW;
        ctx.beginPath();
        ctx.moveTo(x, rulerY);
        ctx.lineTo(x, rulerY + (i % 4 === 0 ? 5 : 3));
        ctx.stroke();
        if (i % 4 === 0) {
          const seconds = Math.round((i / ticks) * Number(canvas.dataset.duration ?? 900));
          ctx.fillText(seconds === 0 ? "0s" : `${Math.round(seconds / 60)} min`, x, rulerY + 15);
        }
      }

      // Three equal-weight curves; only opacity separates the selection.
      for (let s = 0; s < 3; s++) {
        ctx.strokeStyle = SHAPE_COLOR[s];
        ctx.globalAlpha = alphasRef.current[s];
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        const pts = pointsRef.current[s];
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const x = M.left + (i / (pts.length - 1)) * innerW;
          if (i === 0) ctx.moveTo(x, pts[i]);
          else ctx.lineTo(x, pts[i]);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
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
    // Wire the selection effect to the live springs.
    retargetRef.current = (selected: number) => {
      springsRef.current?.forEach((sp, s) => sp.retarget(s === selected ? 1 : 0.4));
      kickLoop();
    };

    return () => {
      ro.disconnect();
      if (loopRef.current) cancelAnimationFrame(loopRef.current);
      loopRef.current = 0;
      springsRef.current?.forEach((sp) => sp.dispose());
      springsRef.current = null;
      retargetRef.current = null;
    };
  }, []);

  const retargetRef = useRef<((selected: number) => void) | null>(null);

  useEffect(() => {
    // Initial state without waiting for a spring tick.
    if (!retargetRef.current) {
      alphasRef.current = [0, 1, 2].map((s) => (s === props.selected ? 1 : 0.4));
    }
    retargetRef.current?.(props.selected);
  }, [props.selected]);

  // Duration changes only move ruler labels — redraw with the new dataset.
  useEffect(() => {
    drawRef.current();
  }, [props.durationSeconds]);

  return (
    <div className="plot">
      <canvas
        ref={canvasRef}
        style={{height: 300}}
        data-duration={props.durationSeconds}
        aria-label={`Schedule preview — ${SHAPE_NAME[props.selected]} pace`}
      />
    </div>
  );
}
