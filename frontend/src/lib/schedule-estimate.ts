/**
 * Derived schedule numbers for the Screen-1 preview — how many slices a
 * pace produces, how big they are, how far apart. Pure math over the shared
 * curve model plus the keeper's 15 s tick; nothing touches the chain.
 */
import {Shape, progress, WAD} from "../../../shared/src/curve";

export interface ScheduleEstimate {
  slices: number;
  avgSliceRaw: bigint;
  intervalSeconds: number | null;
}

const TICK = 15;
const MAX_TICKS = 4000;

export function estimateSchedule(
  budget: bigint,
  duration: bigint,
  shape: Shape,
  minFill: bigint,
): ScheduleEstimate {
  if (budget <= 0n || duration <= 0n) return {slices: 0, avgSliceRaw: 0n, intervalSeconds: null};
  let executed = 0n;
  let slices = 0;
  let firstSliceTick: number | null = null;
  let lastSliceTick = 0;
  for (let tick = 0; tick <= MAX_TICKS; tick++) {
    const elapsed = BigInt(tick * TICK);
    const scheduleElapsed = elapsed < duration ? elapsed : duration;
    // Terminal clamp: at/after the window the full budget is authorized.
    const authorized =
      scheduleElapsed === duration
        ? budget
        : (budget * progress(scheduleElapsed, duration, shape)) / WAD;
    const due = authorized - executed;
    if (due <= 0n) {
      if (scheduleElapsed >= duration) break;
      continue;
    }
    if (due < minFill && scheduleElapsed < duration) continue; // accumulates
    executed += due;
    slices += 1;
    if (firstSliceTick === null) firstSliceTick = tick;
    lastSliceTick = tick;
    if (executed >= budget) break;
  }
  const intervalSeconds =
    slices > 1 ? Math.round(((lastSliceTick - (firstSliceTick ?? 0)) * TICK) / (slices - 1)) : null;
  return {slices, avgSliceRaw: slices > 0 ? budget / BigInt(slices) : 0n, intervalSeconds};
}
