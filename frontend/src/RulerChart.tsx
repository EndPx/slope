/**
 * The Screen-2 ruler: planned schedule vs realized execution on the same
 * time axis, with every fill (solid tick, paper) and every skip (hollow
 * tick, amber — identical size) stamped at its instant, and the now-cursor
 * as a hairline. Canvas API, hand-drawn. Redraws once per second (the
 * cursor is the only thing that moves).
 */
import {useEffect, useRef} from "react";
import {Shape, progress, WAD} from "./lib/curve";
import {SHAPE_COLOR} from "./CurvePreview";
import type {Fill, Skip} from "./lib/subgraph";

const M = {left: 44, right: 30, top: 24, bottom: 30};

export function RulerChart(props: {
  startTimestamp: bigint;
  duration: bigint;
  totalBudget: bigint;
  curveShape: number;
  isActive: boolean;
  fills: Fill[];
  skips: Skip[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    let size = {w: 0, h: 0};

    const draw = () => {
      const p = propsRef.current;
      const {w, h} = size;
      if (!w) return;
      ctx.clearRect(0, 0, w, h);
      const innerW = w - M.left - M.right;
      const plotH = h - M.top - M.bottom;
      const start = Number(p.startTimestamp);
      const duration = Number(p.duration);
      const now = Math.floor(Date.now() / 1000);
      const xAt = (unix: number) => M.left + ((unix - start) / duration) * innerW;
      const yAt = (frac: number) => M.top + (1 - frac) * plotH;

      // Percentage guides.
      ctx.font = "10px 'IBM Plex Mono', monospace";
      ctx.textAlign = "right";
      for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
        ctx.strokeStyle = "#16262c";
        ctx.beginPath();
        ctx.moveTo(M.left, yAt(frac) + 0.5);
        ctx.lineTo(w - M.right, yAt(frac) + 0.5);
        ctx.stroke();
        ctx.fillStyle = "#8fa6a3";
        ctx.fillText(`${frac * 100}`, M.left - 7, yAt(frac) + 3);
      }

      // Planned schedule — dashed, in the position's shape color; dashed so
      // it stays readable when the actual line runs exactly along it.
      const planPts = 120;
      ctx.strokeStyle = SHAPE_COLOR[p.curveShape];
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (let i = 0; i < planPts; i++) {
        const r = i / (planPts - 1);
        const elapsed = BigInt(Math.round(r * duration));
        const frac =
          Number(progress(elapsed, BigInt(duration), p.curveShape as Shape)) / Number(WAD);
        const x = M.left + r * innerW;
        if (i === 0) ctx.moveTo(x, yAt(frac));
        else ctx.lineTo(x, yAt(frac));
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // Actual cumulative execution — paper line through the fills.
      const cum: Array<{unix: number; frac: number}> = [{unix: start, frac: 0}];
      let acc = 0n;
      for (const f of p.fills) {
        acc += f.amountIn;
        cum.push({unix: Number(f.timestamp), frac: Number(acc) / Number(p.totalBudget)});
      }
      const nowX = Math.min(Math.max(xAt(now), M.left), w - M.right);
      const cursorUnix = Math.min(now, start + duration);
      cum.push({unix: cursorUnix, frac: Number(acc) / Number(p.totalBudget)});
      ctx.strokeStyle = "#eae5d6";
      ctx.lineWidth = 2;
      ctx.beginPath();
      cum.forEach((pt, i) => {
        const x = Math.min(Math.max(xAt(pt.unix), M.left), w - M.right);
        const y = yAt(pt.frac);
        if (i === 0) ctx.lineTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Direct line labels at the start, no legend boxes.
      ctx.textAlign = "left";
      ctx.fillStyle = "#eae5d6";
      ctx.fillText("actual", M.left + 8, yAt(0) - 10);
      ctx.fillStyle = SHAPE_COLOR[p.curveShape];
      ctx.fillText("planned", M.left + 8, yAt(0) + 14);

      // The ruler with event caps: fills solid (paper), skips hollow (amber) —
      // identical size; the cap IS the decision record.
      const rulerY = h - M.bottom + 0.5;
      ctx.strokeStyle = "#254048";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(M.left, rulerY);
      ctx.lineTo(w - M.right, rulerY);
      ctx.stroke();
      const cap = (unix: number, solid: boolean, color: string) => {
        const x = Math.min(Math.max(xAt(unix), M.left), w - M.right);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.25;
        if (solid) {
          ctx.fillRect(x - 1.25, rulerY - 6, 2.5, 6);
        } else {
          ctx.strokeRect(x - 1.25, rulerY - 6, 2.5, 6);
        }
      };
      for (const s of p.skips) cap(Number(s.timestamp), false, "#d9a441");
      for (const f of p.fills) cap(Number(f.timestamp), true, "#eae5d6");

      // Ruler time labels: start / mid / end.
      ctx.fillStyle = "#8fa6a3";
      ctx.textAlign = "center";
      for (const r of [0, 0.5, 1]) {
        const x = M.left + r * innerW;
        const seconds = Math.round(r * duration);
        ctx.fillText(seconds === 0 ? "0s" : `${Math.round(seconds / 60)} min`, x, rulerY + 15);
      }

      // The now-cursor: a hairline with a mono label; pinned at the window
      // end once the schedule has run out (nothing is forfeited there).
      ctx.strokeStyle = "#8fa6a3";
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(nowX, M.top);
      ctx.lineTo(nowX, rulerY);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#eae5d6";
      ctx.textAlign = nowX > w - 90 ? "right" : "left";
      const label =
        now >= start + duration
          ? p.isActive
            ? "window closed — remainder stays executable"
            : "settled"
          : `now · ${fmtOffset(now - start)}`;
      ctx.fillText(label, nowX + (nowX > w - 90 ? -6 : 6), M.top + 8);
    };

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      size = {w, h};
      draw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const clock = setInterval(draw, 1000);
    return () => {
      ro.disconnect();
      clearInterval(clock);
    };
  }, []);

  return (
    <div className="plot">
      <canvas ref={canvasRef} style={{height: 260}} aria-label="Execution ruler — planned versus actual" />
    </div>
  );
}

function fmtOffset(seconds: number): string {
  if (seconds < 0) return "0s";
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
  return `${seconds}s`;
}
