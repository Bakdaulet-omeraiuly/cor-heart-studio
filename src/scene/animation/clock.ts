// Per-view cycle clocks, advanced inside the render loop (never through React state).
import type { CyclePhases } from "@/domain/mapping/cycle";

export interface ViewClock {
  phase: number; // 0..1 of the cardiac cycle
}

const clocks = new Map<string, ViewClock>();
const listeners = new Set<() => void>();

export function getClock(id: string): ViewClock {
  let c = clocks.get(id);
  if (!c) clocks.set(id, (c = { phase: 0 }));
  return c;
}
export function dropClock(id: string) { clocks.delete(id); }

/** Advance one clock. In "phase" sync mode every view follows the primary clock's normalized phase. */
export function advance(c: ViewClock, dt: number, phases: CyclePhases, slowMotion: number) {
  c.phase = (c.phase + (dt * slowMotion) / phases.rrSeconds) % 1;
}

let lastNotify = 0;
/** Throttled UI notification (~12 Hz) for the phase indicator; avoids per-frame React updates. */
export function notifyPhase(now: number) {
  if (now - lastNotify < 80) return;
  lastNotify = now;
  for (const l of listeners) l();
}
export function subscribePhase(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
