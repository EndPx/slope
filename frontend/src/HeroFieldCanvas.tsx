/**
 * The landing field — animated canvas in the reference's structural spirit,
 * speaking our own language. Three pace schedules over ONE time axis drawn
 * as a prominent ruler (minor tick per slice, major tick with a real time
 * label every fifth slice, direction arrow). Columns show each step's slice
 * size under the selected pace; glowing balls ride the selected pace's own
 * cumulative curve — their speed profile IS the pace semantics. Reduced
 * motion renders one static frame.
 */
import {useEffect, useRef} from "react";
import {progress, WAD} from "./lib/curve";

const LANES = 30; // majors every 10 lanes -> clean 0 / 5 / 10 / 15 min labels on a 15-min example
const SHAPES = [0, 1, 2];
export const PACE_COLOR = ["#ff8a50", "#e9edf5", "#45c4d8"];
export const PACE_NAME = ["Aggressive", "Neutral", "Conservative"];
const M = {x: 0.05, y: 0.1};

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
  const pts = new Array(LANES + 1);
  for (let i = 0; i <= LANES; i++) {
    const s = i / LANES;
    const f = fracAt(s, shape);
    pts[i] = {x: x0 + s * iw, y: y0 + (1 - f) * ih};
  }
  return pts;
}

export function HeroFieldCanvas(props: {pace: number; durationSeconds?: number}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paceRef = useRef(props.pace);
  paceRef.current = props.pace;
  const duration = props.durationSeconds ?? 900;

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

      // slice skyline: one column per slice, height = that slice's share of
      // the budget under the selected pace — it re-shapes on every pace switch
      for (let i = 0; i < LANES; i++) {
        const slice = Math.max(fracAt((i + 1) / LANES, sel) - fracAt(i / LANES, sel), 0.004);
        const barH = Math.max(slice * ih * 0.94, 3);
        const x = x0 + i * laneW + laneW * 0.19;
        const wBar = laneW * 0.62;
        ctx.globalAlpha = 0.16 + Math.min(barH / ih, 1) * 0.14;
        ctx.fillStyle = selColor;
        ctx.fillRect(x, floor - barH, wBar, barH);
      }
      ctx.globalAlpha = 1;

      // THE ruler — the loudest element: baseline, minor tick per slice,
      // major tick + real time label every fifth, direction arrow
      ctx.strokeStyle = "rgba(139, 155, 176, 0.55)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, floor + 0.5);
      ctx.lineTo(x0 + iw + 6, floor + 0.5);
      ctx.stroke();
      ctx.fillStyle = "rgba(139, 155, 176, 0.75)";
      ctx.beginPath();
      ctx.moveTo(x0 + iw + 13, floor + 0.5);
      ctx.lineTo(x0 + iw + 5, floor - 3.5);
      ctx.lineTo(x0 + iw + 5, floor + 4.5);
      ctx.closePath();
      ctx.fill();
      ctx.font = '10px "IBM Plex Mono", monospace';
      let lastLabelX = -1e9;
      for (let i = 0; i <= LANES; i++) {
        const x = x0 + (i / LANES) * iw;
        const major = i % 10 === 0;
        ctx.strokeStyle = major ? "rgba(139, 155, 176, 0.6)" : "rgba(139, 155, 176, 0.3)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, floor + 0.5);
        ctx.lineTo(x, floor + (major ? 7 : 3.5));
        ctx.stroke();
        if (!major) continue;
        // label collision guard: skip a label closer than 40px to the last
        if (x - lastLabelX < 40 && lastLabelX > 0) continue;
        lastLabelX = x;
        const minutes = Math.round((i / LANES) * (duration / 60));
        const label = minutes === 0 ? "0 min" : `${minutes} min`;
        ctx.fillStyle = "rgba(139, 155, 176, 0.85)";
        if (i === LANES) {
          ctx.textAlign = "right";
          ctx.fillText(label, x + 4, floor + 21);
          ctx.textAlign = "center";
        } else {
          ctx.fillText(label, x, floor + 21);
        }
      }
      // axis micro-labels
      ctx.fillStyle = "rgba(139, 155, 176, 0.75)";
      ctx.textAlign = "left";
      ctx.fillText("% BUDGET EXECUTED", x0, y0 - 8);
      ctx.textAlign = "right";
      ctx.fillText("COLUMNS = SLICE SIZE / STEP", x0 + iw, y0 - 8);

      // three pace lines: others faint, selected bright with glow
      const order = SHAPES.filter((s) => s !== sel);
      order.push(sel);
      for (const shape of order) {
        const pts = lines[shape];
        if (!pts) continue;
        const selected = shape === sel;
        ctx.strokeStyle = PACE_COLOR[shape];
        ctx.globalAlpha = selected ? 1 : 0.32;
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

      // glowing slices-in-flight along the selected pace's cumulative curve:
      // bright white core + blue halo + blue trail, dark outline keeps them
      // visible on every pace color
      const pts = lines[sel];
      if (pts) {
        for (let ball = 0; ball < 8; ball++) {
          const s = (time * 0.0001 + ball / 8) % 1;
          for (let trail = 1; trail <= 3; trail++) {
            const ts = Math.max(0, s - trail * 0.016);
            const pt = pts[Math.round(ts * (pts.length - 1))];
            ctx.globalAlpha = (1 - trail / 4) * 0.5;
            ctx.fillStyle = "#5b8cff";
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 2.4 - trail * 0.5, 0, Math.PI * 2);
            ctx.fill();
          }
          const pt = pts[Math.round(s * (pts.length - 1))];
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#f4f8ff";
          ctx.strokeStyle = "#070b13";
          ctx.lineWidth = 1.5;
          ctx.shadowColor = "#5b8cff";
          ctx.shadowBlur = 16;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 3.4 + Math.sin(time * 0.004 + ball) * 0.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }
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
      aria-label={`Slope pace ruler — ${PACE_NAME[props.pace]} schedule preview with slices in flight`}
    />
  );
}
