/**
 * The landing field — deliberately NOT the reference's converging curve fan.
 * Our subject is a SCHEDULE: discrete slices released over time. So the
 * field renders as a skyline of glowing slice-columns (each column's height
 * = the slice size at that step of the selected pace), with the three pace
 * lines above as references and glowing balls riding the selected pace's
 * own cumulative curve. Reduced motion renders one static frame.
 */
import {useEffect, useRef} from "react";
import {progress, WAD} from "./lib/curve";

const LANES = 26;
const SHAPES = [0, 1, 2];
export const PACE_COLOR = ["#ff8a50", "#e9edf5", "#45c4d8"];
export const PACE_NAME = ["Aggressive", "Neutral", "Conservative"];
export const PACE_NOTE = [
  "FRONT-LOADED — MOST OF THE BUDGET LEAVES EARLY",
  "EVEN — THE BUDGET LEAVES AT A CONSTANT RATE",
  "CATCH-UP — THE BUDGET LEAVES LATE",
];
const M = {x: 0.05, y: 0.09};

function fracAt(s: number, shape: number): number {
  return (
    Number(progress(BigInt(Math.round(s * 1000)), 1000n, shape as never)) / Number(WAD)
  );
}

function linePoints(shape: number, w: number, h: number): Array<{x: number; y: number}> {
  const x0 = w * M.x;
  const y0 = h * M.y;
  const iw = w - x0 * 2;
  const ih = h - y0 * 2;
  const pts = new Array(90);
  for (let i = 0; i < 90; i++) {
    const s = i / 89;
    const f = fracAt(s, shape);
    pts[i] = {x: x0 + s * iw, y: y0 + (1 - f) * ih};
  }
  return pts;
}

export function HeroFieldCanvas(props: {pace: number}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paceRef = useRef(props.pace);
  paceRef.current = props.pace;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;

    let lines: Record<number, Array<{x: number; y: number}>> = {};
    let size = {w: 0, h: 0};
    let raf = 0;

    const draw = (time: number) => {
      const {w, h} = size;
      if (!w) return;
      ctx.clearRect(0, 0, w, h);
      const x0 = w * M.x;
      const y0 = h * M.y;
      const iw = w - x0 * 2;
      const ih = h - y0 * 2;
      const floor = y0 + ih;
      const sel = paceRef.current;
      const selColor = PACE_COLOR[sel];
      const laneW = iw / LANES;

      // the skyline: one glowing column per slice, height = that slice's
      // share of the budget under the selected pace
      for (let i = 0; i < LANES; i++) {
        const f1 = fracAt(i / LANES, sel);
        const f2 = fracAt((i + 1) / LANES, sel);
        const slice = Math.max(f2 - f1, 0.004);
        const barH = slice * ih * 0.94;
        const x = x0 + i * laneW + laneW * 0.22;
        const wBar = laneW * 0.56;
        ctx.globalAlpha = 0.16 + Math.min(barH / ih, 1) * 0.14;
        ctx.fillStyle = selColor;
        ctx.fillRect(x, floor - barH, wBar, barH);
        // glowing cap at the column top
        ctx.globalAlpha = 0.9;
        ctx.shadowBlur = 10;
        ctx.shadowColor = selColor;
        ctx.fillRect(x, floor - barH - 1, wBar, 2);
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;

      // floor line + end-of-window tick
      ctx.strokeStyle = "rgba(139, 155, 176, 0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, floor + 0.5);
      ctx.lineTo(x0 + iw, floor + 0.5);
      ctx.stroke();

      // pace reference lines: others faint, selected bright with glow
      const order = SHAPES.filter((s) => s !== sel);
      order.push(sel);
      for (const shape of order) {
        const pts = lines[shape];
        if (!pts) continue;
        const selected = shape === sel;
        ctx.strokeStyle = PACE_COLOR[shape];
        ctx.globalAlpha = selected ? 1 : 0.3;
        ctx.lineWidth = selected ? 2.5 : 1.25;
        ctx.shadowBlur = selected ? 12 : 0;
        ctx.shadowColor = PACE_COLOR[shape];
        ctx.lineJoin = "round";
        ctx.beginPath();
        pts.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      // glowing balls ride the selected pace's cumulative curve, with trails
      const pts = lines[sel];
      if (pts) {
        for (let ball = 0; ball < 8; ball++) {
          const s = (time * 0.0001 + ball / 8) % 1;
          for (let trail = 0; trail < 3; trail++) {
            const ts = Math.max(0, s - trail * 0.014);
            const pt = pts[Math.round(ts * (pts.length - 1))];
            ctx.globalAlpha = (1 - trail / 3) * 0.5;
            ctx.fillStyle = selColor;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 2 - trail * 0.5, 0, Math.PI * 2);
            ctx.fill();
          }
          const pt = pts[Math.round(s * (pts.length - 1))];
          ctx.globalAlpha = 0.95;
          ctx.fillStyle = selColor;
          ctx.shadowColor = selColor;
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2.4 + Math.sin(time * 0.004 + ball) * 0.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
      ctx.globalAlpha = 1;
    };

    const recompute = () => {
      const bounds = canvas.getBoundingClientRect();
      const w = Math.max(bounds.width, 1);
      const h = Math.max(bounds.height, 1);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      size = {w, h};
      lines = {};
      for (const shape of SHAPES) lines[shape] = linePoints(shape, w, h);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(canvas);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      draw(0);
      return () => ro.disconnect();
    }
    const loop = (t: number) => {
      draw(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`Slope field — ${PACE_NAME[props.pace]} pace: glowing slice skyline, balls ride the selected cumulative curve`}
    />
  );
}
