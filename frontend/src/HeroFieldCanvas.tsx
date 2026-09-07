/**
 * The landing field instrument — an animated canvas in the reference's
 * structure (grid, orbit rings, core glow, scan sweep, particles traveling
 * the curves), carrying OUR product truth: three curves = three paces, and
 * the glowing balls ride the SELECTED pace's own schedule. A ball's position
 * at time-fraction s is the cumulative fraction the contract would have
 * authorized at s — so Aggressive balls rush up early, Conservative balls
 * hug the floor then sprint. Reduced motion renders one static frame.
 */
import {useEffect, useRef} from "react";
import {progress, WAD} from "./lib/curve";

const SAMPLES = 90;
const SHAPES = [0, 1, 2];
export const PACE_COLOR = ["#ff8a50", "#e9edf5", "#45c4d8"];
export const PACE_NAME = ["Aggressive", "Neutral", "Conservative"];
export const PACE_NOTE = [
  "FRONT-LOADED — MOST OF THE BUDGET LEAVES EARLY",
  "EVEN — THE BUDGET LEAVES AT A CONSTANT RATE",
  "CATCH-UP — THE BUDGET LEAVES LATE",
];
const M = {x: 0.055, y: 0.09}; // inset as fraction of the box

function curvePoints(shape: number, w: number, h: number): Array<{x: number; y: number}> {
  const x0 = w * M.x;
  const y0 = h * M.y;
  const iw = w - x0 * 2;
  const ih = h - y0 * 2;
  const pts = new Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    const s = i / (SAMPLES - 1);
    const p =
      Number(progress(BigInt(Math.round(s * 1000)), 1000n, shape as never)) / Number(WAD);
    pts[i] = {x: x0 + s * iw, y: y0 + (1 - p) * ih};
  }
  return pts;
}

function pointAt(pts: Array<{x: number; y: number}>, s: number) {
  const idx = Math.max(0, Math.min(pts.length - 1, Math.round(s * (pts.length - 1))));
  return pts[idx];
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

    let ptsRef: {current: Array<Array<{x: number; y: number}>>} = {current: []};
    let sizeRef = {w: 0, h: 0};
    let raf = 0;

    const draw = (time: number) => {
      const bounds = canvas.getBoundingClientRect();
      const w = Math.max(bounds.width, 1);
      const h = Math.max(bounds.height, 1);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const x0 = w * M.x;
      const y0 = h * M.y;
      const iw = w - x0 * 2;
      const ih = h - y0 * 2;
      const cx = x0 + iw / 2;
      const cy = y0 + ih / 2;

      // calibrated grid, faint
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(139, 155, 176, 0.07)";
      for (let i = 0; i <= 8; i++) {
        const gx = x0 + (iw * i) / 8;
        const gy = y0 + (ih * i) / 8;
        ctx.beginPath();
        ctx.moveTo(gx, y0);
        ctx.lineTo(gx, y0 + ih);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x0, gy);
        ctx.lineTo(x0 + iw, gy);
        ctx.stroke();
      }

      // orbit rings, breathing
      const pulse = 1 + Math.sin(time * 0.0012) * 0.04;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1.7, 1);
      for (let orbit = 0; orbit < 3; orbit++) {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(69, 196, 216, ${0.1 - orbit * 0.026})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([2 + orbit, 7 + orbit * 3]);
        ctx.arc(0, 0, (30 + orbit * 26) * pulse, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      ctx.setLineDash([]);

      // core glow at the center of the field
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.2);
      core.addColorStop(0, "rgba(233, 237, 245, 0.26)");
      core.addColorStop(0.2, "rgba(69, 196, 216, 0.14)");
      core.addColorStop(1, "rgba(69, 196, 216, 0)");
      ctx.fillStyle = core;
      ctx.fillRect(0, 0, w, h);

      // three pace curves — glow, selected bright and thick
      for (const shape of SHAPES) {
        const selected = shape === paceRef.current;
        const pts = ptsRef.current[shape];
        if (!pts) continue;
        ctx.strokeStyle = PACE_COLOR[shape];
        ctx.globalAlpha = selected ? 1 : 0.42;
        ctx.lineWidth = selected ? 3 : 1.5;
        ctx.shadowBlur = selected ? 16 : 6;
        ctx.shadowColor = PACE_COLOR[shape];
        ctx.lineJoin = "round";
        ctx.beginPath();
        pts.forEach((pt: {x: number; y: number}, i: number) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      // the balls: glowing slices riding the SELECTED pace's own schedule
      const selPts: Array<{x: number; y: number}> = ptsRef.current[paceRef.current] ?? [];
      const selColor = PACE_COLOR[paceRef.current];
      if (selPts) {
        for (let ball = 0; ball < 8; ball++) {
          const s = (time * 0.00012 + ball / 8) % 1;
          const pt = pointAt(selPts, s);
          const fade = Math.min(s / 0.08, (1 - s) / 0.12, 1);
          ctx.globalAlpha = 0.9 * Math.max(0, fade);
          ctx.fillStyle = selColor;
          ctx.shadowColor = selColor;
          ctx.shadowBlur = 13;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 1.8 + Math.sin(time * 0.004 + ball) * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // a calm node at the middle of the selected schedule
        const mid = pointAt(selPts, 0.5);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#e9edf5";
        ctx.shadowColor = PACE_COLOR[paceRef.current];
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.arc(mid.x, mid.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // slow scan sweep
      const scanX = x0 + ((time * 0.00007) % 1) * iw;
      const scan = ctx.createLinearGradient(scanX - 30, 0, scanX + 30, 0);
      scan.addColorStop(0, "rgba(69, 196, 216, 0)");
      scan.addColorStop(0.5, "rgba(233, 237, 245, 0.07)");
      scan.addColorStop(1, "rgba(255, 138, 80, 0)");
      ctx.fillStyle = scan;
      ctx.fillRect(scanX - 30, y0, 60, ih);
    };

    const recompute = () => {
      const bounds = canvas.getBoundingClientRect();
      const w = Math.max(bounds.width, 1);
      const h = Math.max(bounds.height, 1);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef = {w, h};
      ptsRef.current = SHAPES.map((shape) => curvePoints(shape, w, h));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(canvas);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      draw(0);
      return () => ro.disconnect();
    }
    const loop = (time: number) => {
      draw(time);
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
      aria-label={`Animated slope field — ${PACE_NAME[props.pace]} pace, glowing slices ride the selected curve`}
    />
  );
}
