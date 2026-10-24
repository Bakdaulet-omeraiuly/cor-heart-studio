"use client";
// COR-Fit report for a Tier B heart: how closely each rendered surface follows its CT labels.
import { fmtMm, fmtPct } from "@/imaging/fidelity";
import type { HeartAssetSpec } from "@/scene/asset-adapters/registry";

export function HeartFidelity({ spec }: { spec: HeartAssetSpec }) {
  const f = spec.manifest.fidelity;
  if (!f) return <p className="text-[11px] text-faint">No COR-Fit report for this model.</p>;
  const lod = f.lods.high ?? f.lods.low!;
  return (
    <div className="text-[11px]" data-testid="heart-fidelity">
      <p className="text-ink">
        <span className="num text-[15px] font-medium">{fmtPct(lod.overall.nsdPercent)}</span>
        <span className="text-muted"> of the model surface lies within {lod.toleranceMm} mm (one CT voxel) of the segmentation · mean {fmtMm(lod.overall.meanMm)}</span>
      </p>
      <table className="mt-1.5 w-full">
        <thead className="text-left text-[10px] uppercase tracking-wider text-faint">
          <tr><th className="py-0.5 font-normal">Surface</th><th className="text-right font-normal" title="Normalized surface Dice at one voxel">≤1 vox</th><th className="text-right font-normal">Mean</th><th className="text-right font-normal">HD95</th></tr>
        </thead>
        <tbody className="num">
          {lod.structures.map((r) => (
            <tr key={r.key} className="border-t border-line">
              <td className="max-w-0 truncate py-0.5 font-sans text-muted" title={`${r.name} — ${r.source}`}>{r.name}</td>
              {r.nsdPercent == null
                ? <td colSpan={3} className="text-right font-sans text-faint">{r.source}</td>
                : <><td className="text-right text-ink">{fmtPct(r.nsdPercent)}</td><td className="text-right">{fmtMm(r.meanMm)}</td><td className="text-right">{fmtMm(r.hd95Mm)}</td></>}
            </tr>
          ))}
          <tr className="border-t border-line">
            <td className="py-0.5 font-sans text-muted">LV cavity volume, mesh vs labels</td>
            <td colSpan={3} className="text-right">{f.volume.lvCavityMeshMl} / {f.volume.lvCavityLabelMl} mL ({f.volume.errorPercent >= 0 ? "+" : ""}{f.volume.errorPercent}%)</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-[10px] leading-snug text-faint">
        Fidelity to the source segmentation (both directions), not clinical accuracy. Gate: published only if ≥ 95% within one voxel and volume error ≤ 5%.
      </p>
    </div>
  );
}
