// Wall-thickness map: today and projected short axis, colour = thickness, dashed ghost = today's outer wall on the projection.
import { outerOutline, thicknessColor, wallSegments } from "./wallGeometry";

interface Walls { ivsMm: number; pwMm: number }

function Ring({ walls, ghost, lvidMm, extent, label }: { walls: Walls; ghost?: Walls; lvidMm: number; extent: number; label: string }) {
  return (
    <svg viewBox={`${-extent} ${-extent} ${extent * 2} ${extent * 2}`} className="aspect-square w-full" role="img" aria-label={label}>
      {wallSegments(walls.ivsMm, walls.pwMm, lvidMm).map((s, i) => <path key={i} d={s.path} fill={thicknessColor(s.mm)} stroke={thicknessColor(s.mm)} strokeWidth="0.15" />)}
      {ghost && <path d={outerOutline(ghost.ivsMm, ghost.pwMm, lvidMm)} fill="none" stroke="var(--ink)" strokeWidth="0.6" strokeDasharray="2 1.5" data-testid="wall-ghost" />}
    </svg>
  );
}

export function WallMap({ today, later, lvidMm, years }: { today: Walls; later: Walls; lvidMm: number; years: number }) {
  const extent = lvidMm / 2 + Math.max(today.ivsMm, today.pwMm, later.ivsMm, later.pwMm) + 3;
  const mm = (w: Walls) => `septum ${w.ivsMm.toFixed(1)} · posterior ${w.pwMm.toFixed(1)} mm`;
  return (
    <div data-testid="wall-map">
      <div className="grid grid-cols-2 gap-2">
        <figure><Ring walls={today} lvidMm={lvidMm} extent={extent} label={`Wall thickness today: ${mm(today)}`} />
          <figcaption className="num text-center text-[10px] text-muted">Today · {mm(today)}</figcaption></figure>
        <figure><Ring walls={later} ghost={today} lvidMm={lvidMm} extent={extent} label={`Wall thickness ${years ? `at +${years} years` : "today"}: ${mm(later)}`} />
          <figcaption className="num text-center text-[10px] text-muted">{years ? `+${years} y` : "Today"} · {mm(later)}</figcaption></figure>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-faint" aria-hidden="true">
        <span>8 mm</span>
        <span className="h-1.5 flex-1 rounded-full" style={{ background: `linear-gradient(90deg, ${thicknessColor(8)}, ${thicknessColor(12)}, ${thicknessColor(16)})` }} />
        <span>16 mm</span>
      </div>
      <p className="mt-1 text-[10px] leading-snug text-faint">Mid-ventricular short axis to scale (septum left, posterior wall right). The dashed line is today&apos;s outer wall. A schematic from the two measured walls with a smooth blend between them (assumption), not a CT segmentation.</p>
    </div>
  );
}
