// Short-axis wall-thickness schematic, pure geometry. Septum is at the left (180°), posterior wall at the right (0°).
// Thickness between the two measured walls is a smooth blend (assumption): CT is not segmented here.

/** Wall thickness (mm) at angle theta (radians, 0 = posterior wall, π = septum). */
export function thicknessAt(theta: number, ivsMm: number, pwMm: number): number {
  return (ivsMm + pwMm) / 2 + ((pwMm - ivsMm) / 2) * Math.cos(theta);
}

/** Blue (8 mm and below) to red (16 mm and above); the scale is a display choice, not a clinical threshold. */
export function thicknessColor(mm: number): string {
  const t = Math.min(1, Math.max(0, (mm - 8) / 8));
  return `hsl(${Math.round(210 * (1 - t))} 70% 50%)`;
}

export interface Segment { path: string; mm: number }

/** The wall as `n` annular segments; radii in mm around the cavity centre. */
export function wallSegments(ivsMm: number, pwMm: number, lvidMm: number, n = 36): Segment[] {
  const rin = lvidMm / 2;
  const out: Segment[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    const mm = thicknessAt(am, ivsMm, pwMm);
    const o0 = rin + thicknessAt(a0, ivsMm, pwMm), o1 = rin + thicknessAt(a1, ivsMm, pwMm);
    const p = (r: number, a: number) => `${(r * Math.cos(a)).toFixed(2)},${(-r * Math.sin(a)).toFixed(2)}`;
    out.push({ mm, path: `M${p(rin, a0)} L${p(o0, a0)} L${p(o1, a1)} L${p(rin, a1)} Z` });
  }
  return out;
}

/** Closed outline of the outer wall, for the ghost of today's heart. */
export function outerOutline(ivsMm: number, pwMm: number, lvidMm: number, n = 72): string {
  const rin = lvidMm / 2;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2, r = rin + thicknessAt(a, ivsMm, pwMm);
    return `${(r * Math.cos(a)).toFixed(2)},${(-r * Math.sin(a)).toFixed(2)}`;
  });
  return `M${pts.join(" L")} Z`;
}
