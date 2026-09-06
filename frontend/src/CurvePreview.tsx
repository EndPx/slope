/**
 * The Screen-1 hero: three schedules stacked on ONE ruler, the selected one
 * drawn as a morphing focus curve. Canvas API, no chart library — the ruler,
 * guides, and curves are drawn by hand (design reference: "sumbu waktu
 * diperlakukan sebagai elemen utama").
 *
 * Shape colors are the app-wide identity (AGR ember / NEU paper / CONS
 * patina) — they never mean anything else.
 */
import {useEffect, useRef} from "react";
import {Shape, progress, WAD} from "./lib/curve";
import {Spring} from "./lib/spring";

export const SHAPE_COLOR = ["#ff7a45", "#eae5d6", "#4fb8a9"] as const;
export const SHAPE_NAME = ["Aggressive", "Neutral", "Conservative"] as const;
const SAMPLES = 120;
const M = {left: 44, right: 14, top: 14, bottom: 30};

function curvePoints(shape: number, width: number, height: number): Float64Array {
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
  const ref = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<Float64Array[]>([]);
  const fromRef = useRef<Float64Array | null>(null);
  const sizeRef = useRef({w: 0, h: 0});
  const springRef = useRef<Spring | null>(null);
  const selectedRef = useRef(props.selected);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = {w, h};
      pointsRef.current = [0, 1, 2].map((s) => curvePoints(s, w, h));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    const draw = () => {
      const {w, h} = sizeRef.current;
      ctx.clearRect(0, 0, w, h);
      const innerW = w - M.left - M.right;

      // Guides: four hairlines, quiet; labels in mono on the left (bare
      // numbers — the "%" lives in the caption, not repeated per tick).
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

      // The ruler: the dominant element, ticks + time labels.
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
          const seconds = Math.round((i / ticks) * props.durationSeconds);
          ctx.fillText(seconds === 0 ? "0s" : `${Math.round(seconds / 60)} min`, x, rulerY + 15);
        }
      }

      // Static thin curves for all three shapes — alpha high enough that the
      // shape colors stay recognizable (0.38 read as brown for Ember).
      const thin = ctx;
      for (let s = 0; s < 3; s++) {
        thin.strokeStyle = SHAPE_COLOR[s];
        thin.globalAlpha = s === selectedRef.current ? 0 : 0.55;
        thin.lineWidth = 1.5;
        strokeCurve(thin, pointsRef.current[s], M.left, innerW);
      }
      thin.globalAlpha = 1;

      // …and the morphing focus curve: from the CURRENT on-screen points to
      // the selected shape (interruption-safe; damping 0.8 is the one
      // expressive exception in the motion spec).
      const from = fromRef.current ?? pointsRef.current[selectedRef.current];
      const to = pointsRef.current[selectedRef.current];
      const s01 = springRef.current?.current ?? 1;
      const focus = new Float64Array(SAMPLES);
      for (let i = 0; i < SAMPLES; i++) focus[i] = from[i] + (to[i] - from[i]) * s01;
      ctx.strokeStyle = SHAPE_COLOR[selectedRef.current];
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      strokeCurve(ctx, focus, M.left, innerW);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      springRef.current?.dispose();
      springRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Selection change: freeze the on-screen curve as the morph origin.
  useEffect(() => {
    if (!springRef.current) {
      const {w = 0, h = 0} = sizeRef.current;
      fromRef.current = pointsRef.current[props.selected] ?? curvePoints(props.selected, w, h);
      springRef.current = new Spring(0.8, 0.4, 1, () => {});
      return;
    }
    const {w, h} = sizeRef.current;
    const s01 = springRef.current.current;
    const displayed = new Float64Array(SAMPLES);
    const from = fromRef.current ?? pointsRef.current[selectedRef.current];
    const to = pointsRef.current[selectedRef.current];
    for (let i = 0; i < SAMPLES; i++) displayed[i] = from[i] + (to[i] - from[i]) * s01;
    fromRef.current = displayed;
    selectedRef.current = props.selected;
    springRef.current.retarget(0);
    requestAnimationFrame(() => springRef.current!.retarget(1));
  }, [props.selected]);

  return (
    <div className="plot">
      <canvas ref={ref} style={{height: 300}} aria-label={`Schedule preview — ${SHAPE_NAME[props.selected]} pace`} />
    </div>
  );
}

function strokeCurve(ctx: CanvasRenderingContext2D, pts: Float64Array, x0: number, innerW: number) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const x = x0 + (i / (pts.length - 1)) * innerW;
    const y = pts[i];
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
